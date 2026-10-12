// generate.mjs — Netlify Function (v2, streaming)
// Streams the article as NDJSON so the page can tell a finished article from a cut one.
// Proofreading runs as a separate request (proofread.mjs), so each gets its own 60 s limit.
// ANTHROPIC_API_KEY and ACCESS_PASSWORD live only here, as Netlify environment variables.

import Anthropic from "@anthropic-ai/sdk";
import { parseMatchId, fetchMatch } from "../../lib/match.mjs";
import { huPlaceNames } from "../../lib/places-hu.mjs";
import {
  MODEL, PROMPTS, PROMPTS_VERSION, json, checkAccess, apiErrorMessage, letterFixer, stripStockOpeners,
} from "../../lib/common.mjs";

// low: the model starts writing within seconds. At "medium" the richer humor prompt made it
// think so long that Netlify's 60 s limit cut the function before any text appeared.
// Grammar is checked afterwards by the proofreading request anyway.
const EFFORT = "low";
const MAX_TOKENS = 8000;           // article + thinking; also caps the cost of one request
const MAX_BODY = 100_000;          // bytes; an old-bookmarklet JSON is ~12 KB
const LIMITS = { context: 300, youtube: 300, home: 100, away: 100, time: 50, venue: 150, city: 100 };
const REGIONAL_CHANCE = 0.7;       // share of posts that get one regional expression; the rest get none
const PING_EVERY = 10_000;         // ms; keeps the connection visibly alive while the model thinks

// n distinct random items from a list.
function pick(list, n) {
  const copy = [...list];
  return Array.from({ length: Math.min(n, copy.length) }, () => copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
}

// Hungarian names only for the localities that appear in this request (lib/places-hu.mjs).
function huPlaceLine(texts) {
  const places = huPlaceNames(texts);
  return places.length
    ? `Magyar helységnevek (csak ezeket használd): ${places.map((p) => `${p.ro} = ${p.hu}`).join("; ")}`
    : "Magyar helységnevek: nincs ilyen — minden település a hivatalos román nevén szerepeljen.";
}

export default async (req) => {
  const denied = await checkAccess(req);
  if (denied) return denied;

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "Cerere prea mare." }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Cerere invalidă." }, 400);
  }
  for (const [field, max] of Object.entries(LIMITS)) {
    if (body[field] != null && String(body[field]).length > max)
      return json({ error: `Câmpul „${field}” e prea lung (max ${max} caractere).` }, 400);
  }

  if (body.lang != null && !Object.hasOwn(PROMPTS, body.lang)) return json({ error: "Limbă necunoscută." }, 400);
  const lang = body.lang || "ro";
  const hu = lang === "hu";

  let system, userText, match = null;

  if (body.mode === "pre") {
    system = PROMPTS[lang].pre;
    userText = (hu
      ? [
          `Csapatok: ${body.home || "?"} – ${body.away || "?"}`,
          body.context ? `Kontextus (a felhasználó románul is írhatta): ${body.context}` : null,
          body.time ? `Időpont: ${body.time}` : null,
          body.venue ? `Helyszín: ${body.venue}` : null,
          body.city ? `Város: ${body.city}` : null,
          body.youtube ? `ÉLŐ YouTube-link: ${body.youtube}` : null,
          huPlaceLine([body.home, body.away, body.venue, body.city]),
        ]
      : [
          `Echipe: ${body.home || "?"} vs ${body.away || "?"}`,
          body.context ? `Context: ${body.context}` : null,
          body.time ? `Ora: ${body.time}` : null,
          body.venue ? `Locație: ${body.venue}` : null,
          body.city ? `Oraș: ${body.city}` : null,
          body.youtube ? `Link YouTube LIVE: ${body.youtube}` : null,
        ]
    ).filter(Boolean).join("\n");
  } else {
    if (body.matchData) {
      // Rezerva: JSON lipit de la vechiul bookmarklet.
      match = body.matchData;
      if (typeof match === "string") {
        try { match = JSON.parse(match); }
        catch { return json({ error: "JSON-ul lipit nu e valid." }, 400); }
      }
      if (!match || !match.home) return json({ error: "JSON-ul lipit nu conține datele meciului." }, 400);
    } else {
      const id = parseMatchId(body.match);
      if (!id) return json({ error: "Lipește linkul meciului de pe frhlive2 (…?utakmica=NUMĂR) sau doar numărul." }, 400);
      try {
        match = await fetchMatch(id);
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }
    system = PROMPTS[lang].post;
    userText = hu
      ? `Kontextus (a felhasználó románul is írhatta): ${body.context || "(nincs megadva — következtesd ki a bajnokságból és az eredményből)"}` +
        (body.youtube ? `\nYouTube-visszajátszás: ${body.youtube}` : "") +
        `\n${huPlaceLine([match.home, match.away, match.venue, match.city])}` +
        `\n\nA mérkőzés adatai (JSON):\n${JSON.stringify(match)}`
      : `Context: ${body.context || "(fără context — deduce din competiție și scor)"}` +
        (body.youtube ? `\nLink YouTube replay: ${body.youtube}` : "") +
        `\n\nDate meci (JSON):\n${JSON.stringify(match)}`;
  }
  // Random opening angle, humor devices and (sometimes) one regional expression per post:
  // with the same prompt the model keeps reaching for the same formula ("Păi ce să zic, frate",
  // "nu-i bai"), so variety has to come from the request.
  const v = PROMPTS[lang].variety;
  const pre = body.mode === "pre";
  const lines = [
    `${v.label}: ${pick(v[pre ? "pre" : "post"], 1)[0]}`,
    `${v.humorLabel}: ${(pre ? pick(v.humorPre, 1) : pick(v.humor, 2)).join("; ")}`,
  ];
  if (Math.random() < REGIONAL_CHANCE) lines.push(`${v.regionalLabel}: „${pick(v.regional, 1)[0]}”`);
  userText += `\n\n${lines.join("\n")}`;
  const fixLetters = letterFixer(lang, userText);

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY; retries 429/5xx before the stream opens
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT },
    // On a safety decline, the API retries on Anthropic's recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: userText }],
  });

  // NDJSON events: match (post only) → ping/text… → draft → done; or error.
  // "draft" carries the final text (stock openers removed) for the proofreading request.
  const encoder = new TextEncoder();
  let ping;
  const out = new ReadableStream({
    async start(controller) {
      // try/catch: after cancel() the controller is closed and enqueue would throw.
      const send = (obj) => { try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch {} };
      ping = setInterval(() => send({ type: "ping" }), PING_EVERY);
      try {
        if (match) {
          const { home, away, score, ht, competition, venue, city } = match;
          send({ type: "match", match: { home, away, score, ht, competition, venue, city } });
        }
        let draft = "";
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            const text = fixLetters(ev.delta.text);
            draft += text;
            send({ type: "text", text });
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          send({ type: "error", error: "Claude a refuzat să scrie acest text. Reformulează contextul și încearcă din nou." });
        } else if (final.stop_reason === "max_tokens") {
          send({ type: "error", error: "Articolul a atins limita de lungime și e tăiat la final." });
        } else {
          const cleaned = stripStockOpeners(draft, lang);
          send({ type: "draft", text: cleaned.text, corrections: cleaned.corrections });
          send({ type: "done" });
        }
      } catch (e) {
        if (!(e instanceof Anthropic.APIUserAbortError)) send({ type: "error", error: apiErrorMessage(e) });
      } finally {
        clearInterval(ping);
      }
      try { controller.close(); } catch {}
    },
    cancel() {
      clearInterval(ping);
      stream.abort(); // the page was closed — stop paying for tokens nobody reads
    },
  });

  return new Response(out, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-prompts-version": PROMPTS_VERSION,
    },
  });
};

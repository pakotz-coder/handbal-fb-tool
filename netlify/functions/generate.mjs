// generate.mjs — Netlify Function (v2, streaming)
// Streams the article as NDJSON so the page can tell a finished article from a cut one,
// then runs a proofreading pass that returns only the corrections to apply.
// ANTHROPIC_API_KEY and ACCESS_PASSWORD live only here, as Netlify environment variables.

import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { createHash, timingSafeEqual } from "node:crypto";
import { parseMatchId, fetchMatch } from "../../lib/match.mjs";
import { huPlaceNames } from "../../lib/places-hu.mjs";
import { RO } from "../../lib/prompts-ro.mjs";
import { HU } from "../../lib/prompts-hu.mjs";

const MODEL = "claude-sonnet-5-5"; // swap to "claude-opus-5-5" for richer flavor (slower, ~2x price)
const EFFORT = "medium";           // medium = more care with grammar and stats; "low" starts faster
const MAX_TOKENS = 8000;           // article + thinking; also caps the cost of one request
const PROOF_MAX_TOKENS = 6000;     // proofreading: thinking + a short list of corrections
const MAX_BODY = 100_000;          // bytes; an old-bookmarklet JSON is ~12 KB
const LIMITS = { context: 300, youtube: 300, home: 100, away: 100, time: 50, venue: 150, city: 100 };

const PROMPTS = { ro: RO, hu: HU };

// Fingerprint of the prompts, sent on every response (even a 401), so a deploy can be
// verified from outside: compare it with the same hash computed from the repo.
const PROMPTS_VERSION = createHash("sha256").update(JSON.stringify(PROMPTS)).digest("hex").slice(0, 10);

// Stock openers the model falls back to ("Păi ce să zic, frate, …"). The prompt asks for a
// direct first sentence; this is the safety net. Only removed at the start of a paragraph,
// and the next word gets a capital: "Păi ce să zic, frate, Brăila a…" → "Brăila a…".
const STOCK_OPENERS = {
  ro: /^(?:păi|pai)(?:\s+ce\s+(?:să|sa)\s+(?:zic|spun))?(?:\s*,\s*(?:frate|fraților|fratilor|dragilor))?\s*[,:;!.…—–-]*\s+|^(?:frate|fraților|fratilor)\s*[,:;!…—–-]+\s*/iu,
  hu: /^(?:hát\s+mit\s+mondjak|hát|na|nos)\s*[,:;!.…—–-]+\s*/iu,
};
function stripStockOpeners(text, lang) {
  const removed = [];
  const out = text.split("\n").map((line) => {
    const m = line.match(STOCK_OPENERS[lang]);
    if (!m || m[0].length >= line.length) return line;
    const rest = line.slice(m[0].length);
    removed.push(m[0].trim());
    return rest.charAt(0).toLocaleUpperCase(lang) + rest.slice(1);
  }).join("\n");
  return { text: out, removed };
}

// Look-alike letters the model occasionally writes: cedilla ş/ţ instead of comma ș/ț (RO),
// õ/û instead of double-acute ő/ű (HU). A letter that appears in the source data
// (e.g. a foreign player's name) is left alone, so names are never altered.
const LOOKALIKES = {
  ro: [["ş", "ș"], ["Ş", "Ș"], ["ţ", "ț"], ["Ţ", "Ț"]],
  hu: [["õ", "ő"], ["Õ", "Ő"], ["û", "ű"], ["Û", "Ű"]],
};
function letterFixer(lang, source) {
  const pairs = LOOKALIKES[lang].filter(([bad]) => !source.includes(bad));
  return (s) => pairs.reduce((t, [bad, good]) => t.split(bad).join(good), s);
}

// Hungarian names only for the localities that appear in this request (lib/places-hu.mjs).
function huPlaceLine(texts) {
  const places = huPlaceNames(texts);
  return places.length
    ? `Magyar helységnevek (csak ezeket használd): ${places.map((p) => `${p.ro} = ${p.hu}`).join("; ")}`
    : "Magyar helységnevek: nincs ilyen — minden település a hivatalos román nevén szerepeljen.";
}

const CORRECTIONS_FORMAT = betaJSONSchemaOutputFormat({
  type: "object",
  properties: {
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          corrected: { type: "string" },
          reason: { type: "string" },
        },
        required: ["original", "corrected", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["corrections"],
  additionalProperties: false,
});

// Applies only corrections that are safe: the original must occur exactly once,
// and the digits must stay the same, so a correction can never change a statistic.
function applyCorrections(text, corrections) {
  const digits = (s) => (s.match(/\d+/g) || []).join(",");
  const applied = [];
  for (const c of corrections || []) {
    const { original, corrected, reason } = c;
    if (!original || original === corrected) continue;
    if (digits(original) !== digits(corrected)) continue;
    const at = text.indexOf(original);
    if (at < 0 || text.indexOf(original, at + 1) >= 0) continue;
    text = text.slice(0, at) + corrected + text.slice(at + original.length);
    applied.push({ original, corrected, reason });
  }
  return { text, applied };
}

async function proofread(client, draft, lang, signal) {
  const msg = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: PROOF_MAX_TOKENS,
      output_config: { effort: "medium", format: CORRECTIONS_FORMAT },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: PROMPTS[lang].proof,
      messages: [{ role: "user", content: `<articol>\n${draft}\n</articol>` }],
    },
    { signal },
  );
  if (msg.stop_reason !== "end_turn" || !msg.parsed_output)
    throw new Error(`corectorul nu a răspuns complet (${msg.stop_reason})`);
  return applyCorrections(draft, msg.parsed_output.corrections);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-prompts-version": PROMPTS_VERSION,
    },
  });
}

// Constant-time compare; hashing first makes both sides the same length.
function samePassword(given, expected) {
  const a = createHash("sha256").update(String(given)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function apiErrorMessage(e) {
  if (e instanceof Anthropic.AuthenticationError) return "Cheia ANTHROPIC_API_KEY din Netlify e invalidă sau a expirat.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Cheia API nu are acces la modelul " + MODEL + ".";
  if (e instanceof Anthropic.RateLimitError) return "Limita de cereri Claude a fost atinsă. Încearcă din nou peste un minut.";
  // Mid-stream errors arrive without an HTTP status, so check the API error type too.
  if (e instanceof Anthropic.InternalServerError || (e instanceof Anthropic.APIError && e.type === "overloaded_error"))
    return "Serverele Claude sunt suprasolicitate. Încearcă din nou peste un minut.";
  if (e instanceof Anthropic.APIConnectionError) return "Conexiunea cu Claude s-a întrerupt. Încearcă din nou.";
  if (e instanceof Anthropic.APIError) return "Eroare Claude: " + (e.error?.error?.message || e.message);
  return "Eroare neașteptată: " + (e?.message || e);
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = process.env.ACCESS_PASSWORD;
  if (!expected) return json({ error: "Lipsește ACCESS_PASSWORD în setările Netlify (Environment variables)." }, 500);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "Lipsește ANTHROPIC_API_KEY în setările Netlify." }, 500);

  if (!samePassword(req.headers.get("x-access-password") || "", expected)) {
    await new Promise((r) => setTimeout(r, 1000)); // slows down guessing
    return json({ error: "Parolă de acces greșită.", auth: true }, 401);
  }

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
  // A random opening angle per post: with the same prompt the model keeps reaching for the
  // same opener ("Păi ce să zic, frate"), so variety has to come from the request.
  const { angles } = PROMPTS[lang];
  const pool = angles[body.mode === "pre" ? "pre" : "post"];
  userText += `\n\n${angles.label}: ${pool[Math.floor(Math.random() * pool.length)]}`;
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

  // NDJSON events: match (post only) → text… → proof_start → proof | proof_error → done;
  // or error at any point before proof_start.
  const encoder = new TextEncoder();
  const proofAbort = new AbortController();
  const out = new ReadableStream({
    async start(controller) {
      // try/catch: after cancel() the controller is closed and enqueue would throw.
      const send = (obj) => { try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch {} };
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
          // The draft is complete; a failed proofreading pass only means it stays uncorrected.
          const opener = stripStockOpeners(draft, lang);
          if (opener.removed.length) {
            draft = opener.text;
            send({ type: "replace", text: draft });
          }
          const openerFixes = opener.removed.map((original) => ({
            original,
            corrected: "—",
            reason: hu ? "sablonos kezdés törölve" : "formulă de început, eliminată",
          }));
          send({ type: "proof_start" });
          try {
            const { text, applied } = await proofread(client, draft, lang, proofAbort.signal);
            send({ type: "proof", text: fixLetters(text), corrections: [...openerFixes, ...applied] });
          } catch (e) {
            if (e instanceof Anthropic.APIUserAbortError) return;
            send({ type: "proof_error", error: e instanceof Anthropic.APIError ? apiErrorMessage(e) : e.message });
          }
          send({ type: "done" });
        }
      } catch (e) {
        if (e instanceof Anthropic.APIUserAbortError) return; // page closed; stream already cancelled
        send({ type: "error", error: apiErrorMessage(e) });
      }
      try { controller.close(); } catch {}
    },
    cancel() {
      // The page was closed — stop paying for tokens nobody reads.
      stream.abort();
      proofAbort.abort();
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

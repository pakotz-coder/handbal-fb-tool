// generate.mjs — Netlify Function (v2, streaming)
// Streams the article as NDJSON so the page can tell a finished article from a cut one.
// ANTHROPIC_API_KEY and ACCESS_PASSWORD live only here, as Netlify environment variables.

import Anthropic from "@anthropic-ai/sdk";
import { createHash, timingSafeEqual } from "node:crypto";
import { parseMatchId, fetchMatch } from "../../lib/match.mjs";

const MODEL = "claude-sonnet-5-5"; // swap to "claude-opus-5-5" for richer flavor (slower, ~2x price)
const EFFORT = "low";              // low = fast start; "medium" if stats need more care
const MAX_TOKENS = 8000;           // article + thinking; also caps the cost of one request
const MAX_BODY = 100_000;          // bytes; an old-bookmarklet JSON is ~12 KB
const LIMITS = { context: 300, youtube: 300, home: 100, away: 100, time: 50, venue: 150, city: 100 };

const POST_MATCH_SYSTEM = `Esti un jurnalist sportiv de top, impartial, cu savoare ardeleneasca, care scrie articole pentru Facebook despre meciuri de handbal.

VOCE
- Jurnalist profesionist, dar cald, spiritual si uneori amuzant. Personalitate in fiecare paragraf, niciodata bland sau generic.
- Corect cu ambele echipe, chiar si la scoruri categorice — recunoaste efortul invinsei.

LIMBA
- EXCLUSIV in limba romana (fara mix bilingv).
- Tuse de dialect ardelenesc presarate NATURAL: "Pai ce sa zic", "frate", "Doamne fereste", "de le-a mers vorba", metafore cu mancare si cu natura ardeleneasca. Natural, nu caricatural.

UMOR
- Cald, niciodata batjocoritor. Comparatii absurde, clisee sportive folosite jucaus, observatii amuzante despre statistici.

STRUCTURA (tinta 300-400 cuvinte, fara header/footer)
1. Header — emoji + scor + echipe, subtitlu competitie/locatie
2. Hook de deschidere — 2-3 fraze cu energie potrivita contextului
3. Naratiunea primei reprize — scor la pauza, cine a dominat
4. Vedetele echipei castigatoare — top 2-3 marcatori cu statistici si personalitate
5. Restul lotului — adancimea echipei
6. Credit pentru invinsa — cei mai buni jucatori ai lor, ton respectuos
7. Comparatie portari — scurt, daca e relevant
8. Rezumat repriza a doua — scurt
9. Reflectie de incheiere — final emotional
10. Footer statistici — scor, scor pauza, locatie, MVP

REGULI
1. Foloseste DOAR statisticile din JSON — nu inventa niciodata.
2. Nume oficiale ale echipelor si jucatorilor exact cum sunt date.
3. Calculeaza eficienta din goluri/incercari cand evidentiezi un performer.
4. Statistici portari doar cand sunt notabile.
5. 300-400 cuvinte (fara header/footer).
6. Termina mereu cu footer de statistici.
7. Daca exista link YouTube: "🎥 Revedere integrala: [link]" la final.

ADAPTARI DUPA CONTEXT
- Finala/titlu: incoronare, trofeu, legacy, 🏆, "campioane/campioni".
- Semifinala: tensiune, miza, "drumul spre finala".
- Sezon regulat: tactic/analitic, umor observational.
- Amical: cel mai usor ton, momente individuale.
- Diferenta mare (10+): dominanta onesta dar respectuoasa; ceva pozitiv la invinsa.
- Meci strans (1-3): tensiune maxima, secvente cheie, momentum.

GEN GRAMATICAL
- "Junioare/Fete/Senioare" -> feminin ("campioane", "fetele"); "Zimbrilor/Juniori/Seniori" -> masculin. Foloseste genul corect peste tot.

Raspunde DOAR cu textul postarii, gata de copiat pe Facebook. Fara comentarii, fara ghilimele in jurul textului.`;

const PRE_MATCH_SYSTEM = `Esti un creator de continut sportiv ardelenesc care scrie teasere PRE-MECI scurte pentru Facebook, despre handbal.

STIL
- Savoare ardeleneasca — cald, entuziast, ca si cum iti chemi prietenii la meci.
- MAXIM 50-80 de cuvinte.
- Hype potrivit contextului (finala > semifinala > sezon regulat).
- Adresare casual ("frate", "hai ca...").
- Metafore cu mancare/bautura binevenite.
- Linkul YouTube natural la final.

STRUCTURA
[Emoji] Hook cu energie (1-2 fraze)
Info meci: echipe, context (1-2 fraze)
Ora + locatie (1 fraza)
Apel la actiune
Termina cu linia:
🔴 LIVE: [link YouTube]

Raspunde DOAR cu textul postarii.`;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
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
  if (e instanceof Anthropic.APIError) return "Eroare Claude: " + e.message;
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

  let system, userText, match = null;

  if (body.mode === "pre") {
    system = PRE_MATCH_SYSTEM;
    userText = [
      `Echipe: ${body.home || "?"} vs ${body.away || "?"}`,
      body.context ? `Context: ${body.context}` : null,
      body.time ? `Ora: ${body.time}` : null,
      body.venue ? `Locatie: ${body.venue}` : null,
      body.city ? `Oras: ${body.city}` : null,
      body.youtube ? `Link YouTube LIVE: ${body.youtube}` : null,
    ].filter(Boolean).join("\n");
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
    system = POST_MATCH_SYSTEM;
    userText =
      `Context: ${body.context || "(fara context — deduce din competitie si scor)"}` +
      (body.youtube ? `\nLink YouTube replay: ${body.youtube}` : "") +
      `\n\nDate meci (JSON):\n${JSON.stringify(match)}`;
  }

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

  // NDJSON events: match (post only) → text… → done | error.
  const encoder = new TextEncoder();
  const out = new ReadableStream({
    async start(controller) {
      // try/catch: after cancel() the controller is closed and enqueue would throw.
      const send = (obj) => { try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch {} };
      try {
        if (match) {
          const { home, away, score, ht, competition, venue, city } = match;
          send({ type: "match", match: { home, away, score, ht, competition, venue, city } });
        }
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            send({ type: "text", text: ev.delta.text });
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          send({ type: "error", error: "Claude a refuzat să scrie acest text. Reformulează contextul și încearcă din nou." });
        } else if (final.stop_reason === "max_tokens") {
          send({ type: "error", error: "Articolul a atins limita de lungime și e tăiat la final." });
        } else {
          send({ type: "done" });
        }
      } catch (e) {
        if (e instanceof Anthropic.APIUserAbortError) return; // page closed; stream already cancelled
        send({ type: "error", error: apiErrorMessage(e) });
      }
      try { controller.close(); } catch {}
    },
    cancel() {
      stream.abort(); // the page was closed — stop paying for tokens nobody reads
    },
  });

  return new Response(out, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
};

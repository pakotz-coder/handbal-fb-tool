// generate.mjs — Netlify Function (v2, streaming)
// Streams the article as NDJSON so the page can tell a finished article from a cut one,
// then runs a proofreading pass that returns only the corrections to apply.
// ANTHROPIC_API_KEY and ACCESS_PASSWORD live only here, as Netlify environment variables.

import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { createHash, timingSafeEqual } from "node:crypto";
import { parseMatchId, fetchMatch } from "../../lib/match.mjs";

const MODEL = "claude-sonnet-5-5"; // swap to "claude-opus-5-5" for richer flavor (slower, ~2x price)
const EFFORT = "medium";           // medium = more care with grammar and stats; "low" starts faster
const MAX_TOKENS = 8000;           // article + thinking; also caps the cost of one request
const PROOF_MAX_TOKENS = 6000;     // proofreading: thinking + a short list of corrections
const MAX_BODY = 100_000;          // bytes; an old-bookmarklet JSON is ~12 KB
const LIMITS = { context: 300, youtube: 300, home: 100, away: 100, time: 50, venue: 150, city: 100 };

// Shared by both prompts. The prompts themselves are written with diacritics on purpose:
// the model mirrors the prompt's spelling.
const LANGUAGE_RULES = `LIMBA
- EXCLUSIV în limba română (fără mix bilingv), cu toate diacriticele: ă, â, î, ș, ț (ș și ț cu virgulă dedesubt, nu cu sedilă).
- Română literară corectă: acord gramatical (subiect–predicat, substantiv–adjectiv, genul echipei), articulare corectă, cratimă (s-a, n-a, într-un, le-a, i-au), „să” față de „sa”, „o dată” față de „odată”, „decât” doar cu negație. Fără anacoluturi și fără repetiții supărătoare.
- Exprimare naturală, ca a unui vorbitor nativ: fără calcuri din engleză, fără cuvinte inventate sau folosite cu alt sens.
- Fiecare frază trebuie să fie corectă gramatical și să sune firesc; dacă o formulare e nesigură, alege una simplă și corectă.`;

const POST_MATCH_SYSTEM = `Ești un jurnalist sportiv de top, imparțial, cu savoare ardelenească, care scrie articole pentru Facebook despre meciuri de handbal.

VOCE
- Jurnalist profesionist, dar cald, spiritual și uneori amuzant. Personalitate în fiecare paragraf, niciodată fad sau generic.
- Corect cu ambele echipe, chiar și la scoruri categorice — recunoaște efortul învinsei.

${LANGUAGE_RULES}
- Tușe de dialect ardelenesc presărate NATURAL: „Păi ce să zic”, „frate”, „Doamne ferește”, „de le-a mers vorba”, metafore cu mâncare și cu natura ardelenească. Dialectul stă în expresii, nu în greșeli de limbă. Natural, nu caricatural.

TERMINOLOGIE (câmpurile din JSON)
- goals = goluri; attempts = aruncări; eficiența = goluri / aruncări, în procente.
- assists = pase decisive (niciodată „assisturi”); steals = mingi recuperate; sus = eliminări de 2 minute.
- La portari: saves = parade; faced = aruncări pe poartă (ex.: „10 parade din 19 aruncări”).
- val = indicele de valoare al jucătorului din statistici; folosește-l doar ca să alegi MVP-ul, nu-l cita în text.
- goals[] = golurile, de la ultimul spre primul: min = minutul, team 1 = gazdele, team 2 = oaspeții, r1-r2 = scorul după gol.
- Numele câmpurilor (val, sus, steals etc.) nu apar niciodată în text; scrie doar termenii românești de mai sus.

UMOR
- Cald, niciodată batjocoritor. Comparații absurde, clișee sportive folosite jucăuș, observații amuzante despre statistici.

STRUCTURĂ (țintă 300-400 de cuvinte, fără header/footer)
1. Header — emoji + scor + echipe, subtitlu competiție/locație
2. Hook de deschidere — 2-3 fraze cu energie potrivită contextului
3. Narațiunea primei reprize — scorul la pauză, cine a dominat
4. Vedetele echipei câștigătoare — top 2-3 marcatori, cu statistici și personalitate
5. Restul lotului — adâncimea echipei
6. Aprecieri pentru învinsă — cei mai buni jucători ai lor, ton respectuos
7. Comparație între portari — scurt, dacă e relevant
8. Rezumatul reprizei a doua — scurt
9. Reflecție de încheiere — final emoțional
10. Footer cu statistici — scor, scor la pauză, locație, MVP

REGULI
1. Folosește DOAR informațiile din JSON și din context — nu inventa niciodată statistici, puncte în clasament, istoric sau declarații.
   Data meciului nu e în date: nu scrie „azi”, „aseară” sau „ieri” decât dacă reiese din context.
2. Numele jucătorilor rămân exact cum sunt în date. La echipele, orașele și sălile românești adaugă doar diacriticele care lipsesc din date (Brasov → Brașov, Targu Mures → Târgu Mureș, Stiinta → Știința, Bucuresti → București), fără alte schimbări.
3. Calculează eficiența din goluri/aruncări când evidențiezi un jucător.
4. Statistici de portar doar când sunt notabile.
5. 300-400 de cuvinte (fără header/footer).
6. Termină mereu cu footer-ul de statistici.
7. Dacă există link YouTube: „🎥 Revedere integrală: [link]” la final.

ADAPTĂRI DUPĂ CONTEXT
- Finală/titlu: încoronare, trofeu, moștenire, 🏆, „campioane/campioni”.
- Semifinală: tensiune, miză, „drumul spre finală”.
- Sezon regulat: tactic/analitic, umor observațional.
- Amical: cel mai lejer ton, momente individuale.
- Diferență mare (10+): dominanță onestă, dar respectuoasă; ceva pozitiv la învinsă.
- Meci strâns (1-3): tensiune maximă, secvențe-cheie, momentum.

GEN GRAMATICAL
- „Junioare/Fete/Senioare/Liga Florilor” → feminin („campioane”, „fetele”); „Zimbrilor/Juniori/Seniori” → masculin. Folosește genul corect peste tot.

Răspunde DOAR cu textul postării, gata de copiat pe Facebook. Fără comentarii, fără ghilimele în jurul textului.`;

const PRE_MATCH_SYSTEM = `Ești un creator de conținut sportiv ardelenesc care scrie teasere PRE-MECI scurte pentru Facebook, despre handbal.

STIL
- Savoare ardelenească — cald, entuziast, ca și cum îți chemi prietenii la meci.
- MAXIM 50-80 de cuvinte.
- Entuziasm potrivit contextului (finală > semifinală > sezon regulat).
- Adresare familiară („frate”, „hai că...”).
- Metafore cu mâncare/băutură binevenite.
- Linkul YouTube vine natural, la final.

${LANGUAGE_RULES}
- La echipele, orașele și sălile românești adaugă diacriticele care lipsesc (Brasov → Brașov, Bistrita → Bistrița).

STRUCTURĂ
[Emoji] Hook cu energie (1-2 fraze)
Info meci: echipe, context (1-2 fraze)
Ora + locația (1 frază)
Apel la acțiune
Termină cu linia:
🔴 LIVE: [link YouTube]

Răspunde DOAR cu textul postării.`;

const PROOF_SYSTEM = `Ești corector profesionist de limba română pentru postări sportive pe Facebook.

Primești între etichetele <articol> un text deja scris. Găsește DOAR greșelile reale de limbă:
- gramatică: acord (subiect–predicat, substantiv–adjectiv, gen), articulare, forme verbale, cratimă (s-a, n-a, într-un, i-au);
- ortografie și diacritice (ș și ț cu virgulă dedesubt, nu cu sedilă);
- punctuație greșită;
- cuvinte inexistente, folosite cu alt sens sau calcuri stângace din engleză;
- formulări nefirești sau ambigue pentru un vorbitor nativ.

NU schimba nimic din:
- stil, ton, umor, metafore, emoji-uri și expresiile ardelenești intenționate („Păi ce să zic”, „frate”, „Doamne ferește”);
- cifre, scoruri, minute și procente;
- numele jucătorilor și ale echipelor, scrise exact ca în text (chiar și fără diacritice);
- structura textului și liniile de statistici de la final.

Pentru fiecare greșeală:
- original = fragmentul copiat EXACT din text, caracter cu caracter, suficient de lung cât să apară o singură dată (de obicei 3-8 cuvinte);
- corrected = același fragment, corectat, cu cât mai puține schimbări;
- reason = motivul, în câteva cuvinte.

Nu propune rescrieri de gust, doar greșeli. Dacă textul nu are greșeli, întoarce o listă goală.`;

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

async function proofread(client, draft, signal) {
  const msg = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: PROOF_MAX_TOKENS,
      output_config: { effort: "medium", format: CORRECTIONS_FORMAT },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: PROOF_SYSTEM,
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

  let system, userText, match = null;

  if (body.mode === "pre") {
    system = PRE_MATCH_SYSTEM;
    userText = [
      `Echipe: ${body.home || "?"} vs ${body.away || "?"}`,
      body.context ? `Context: ${body.context}` : null,
      body.time ? `Ora: ${body.time}` : null,
      body.venue ? `Locație: ${body.venue}` : null,
      body.city ? `Oraș: ${body.city}` : null,
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
      `Context: ${body.context || "(fără context — deduce din competiție și scor)"}` +
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
            draft += ev.delta.text;
            send({ type: "text", text: ev.delta.text });
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          send({ type: "error", error: "Claude a refuzat să scrie acest text. Reformulează contextul și încearcă din nou." });
        } else if (final.stop_reason === "max_tokens") {
          send({ type: "error", error: "Articolul a atins limita de lungime și e tăiat la final." });
        } else {
          // The draft is complete; a failed proofreading pass only means it stays uncorrected.
          send({ type: "proof_start" });
          try {
            const { text, applied } = await proofread(client, draft, proofAbort.signal);
            send({ type: "proof", text, corrections: applied });
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
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
};

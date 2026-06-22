// generate.js — Netlify Function (v2, streaming)
// Streams the article token-by-token so generation never hits the 10s sync limit.
// ANTHROPIC_API_KEY lives only here, as a Netlify environment variable.

const MODEL = "claude-sonnet-4-6"; // swap to "claude-opus-4-8" for richer flavor (slower)
const ANTHROPIC_VERSION = "2023-06-01";

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
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!process.env.ANTHROPIC_API_KEY)
    return json({ error: "Lipseste ANTHROPIC_API_KEY in setarile Netlify." });

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cerere invalida." });
  }

  let system, userText;

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
    let matchData = body.matchData;
    if (typeof matchData === "string") {
      try { matchData = JSON.parse(matchData); }
      catch { return json({ error: "JSON-ul lipit nu e valid. Re-ruleaza bookmarkletul si copiaza din nou." }); }
    }
    if (!matchData || !matchData.home)
      return json({ error: "Lipsesc datele meciului. Ruleaza bookmarkletul si lipeste JSON-ul." });
    system = POST_MATCH_SYSTEM;
    userText =
      `Context: ${body.context || "(fara context — deduce din competitie si scor)"}` +
      (body.youtube ? `\nLink YouTube replay: ${body.youtube}` : "") +
      `\n\nDate meci (JSON):\n${JSON.stringify(matchData)}`;
  }

  // Call Claude with streaming enabled.
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      stream: true,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const e = await upstream.json().catch(() => ({}));
    return json({ error: e?.error?.message || "Eroare la API-ul Claude." });
  }

  // Transform Anthropic SSE -> plain text stream of just the article words.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const out = new ReadableStream({
    async start(controller) {
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const ev = JSON.parse(payload);
              if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                controller.enqueue(encoder.encode(ev.delta.text));
              }
            } catch (_) { /* skip non-JSON keepalives */ }
          }
        }
      } catch (_) { /* upstream closed */ }
      controller.close();
    },
  });

  return new Response(out, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};

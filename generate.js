// generate.js — Netlify Function
// Scrapes match data server-side (no CORS) and generates the FB post via Claude API.
// The ANTHROPIC_API_KEY lives only here, as a Netlify environment variable.

const MODEL = "claude-sonnet-4-6"; // swap to "claude-opus-4-8" for richer Transylvanian flavor (slower/costlier)
const ANTHROPIC_VERSION = "2023-06-01";

// ---- System prompts (faithful to the fb-handball-post skill) -----------------

const POST_MATCH_SYSTEM = `Esti un jurnalist sportiv de top, impartial, cu savoare ardeleneasca, care scrie articole pentru Facebook despre meciuri de handbal.

VOCE
- Jurnalist profesionist, dar cald, spiritual si uneori amuzant. Personalitate in fiecare paragraf, niciodata bland sau generic.
- Corect cu ambele echipe, chiar si la scoruri categorice — recunoaste efortul invinsei.

LIMBA
- EXCLUSIV in limba romana (fara mix bilingv).
- Tuse de dialect ardelenesc presarate NATURAL, nu fortat: "Pai ce sa zic", "frate", "Doamne fereste", "de le-a mers vorba", "ca sa fie treaba treaba", metafore cu mancare ("de parca le asteptau sarmalele la cuptor"), metafore cu natura/geografie ardeleneasca. A nu se exagera — sa para natural, nu caricatural.

UMOR
- Cald, niciodata batjocoritor. Comparatii absurde, clisee sportive folosite jucaus, observatii amuzante despre statistici (ex: "4/4 — perfecta! Pacat ca nu i-au dat mingea mai des").

STRUCTURA (tinta 300-400 cuvinte, fara header/footer)
1. Header — emoji + scor + echipe, subtitlu competitie/locatie
2. Hook de deschidere — 2-3 fraze cu energie potrivita contextului
3. Naratiunea primei reprize — ce s-a intamplat, scor la pauza, cine a dominat
4. Vedetele (echipa castigatoare) — top 2-3 marcatoare/marcatori cu statistici si personalitate
5. Restul lotului — alti contributori, adancimea lotului
6. Credit pentru invinsa — cei mai buni jucatori ai lor, ce au facut bine, ton respectuos
7. Comparatie portari — scurt, daca e relevant
8. Rezumat repriza a doua — scurt, mai ales daca meciul s-a decis in prima repriza
9. Reflectie de incheiere — ce inseamna pentru viitor, final emotional
10. Footer statistici — scor, scor pauza, locatie, MVP

REGULI
1. Foloseste DOAR statisticile din JSON-ul furnizat — nu inventa niciodata.
2. Foloseste numele oficiale ale echipelor si jucatorilor exact cum sunt date.
3. Calculeaza procentaje de eficienta din goluri/incercari cand evidentiezi un performer.
4. Mentioneaza statistici portari doar cand sunt notabile (multe aparari sau record perfect).
5. Tine articolul intre 300-400 cuvinte (fara header/footer).
6. Termina mereu cu un bloc footer de statistici.
7. Daca se da un link YouTube, adauga-l la final: "🎥 Revedere integrala: [link]".

ADAPTARI DUPA CONTEXT
- Finala / titlu: limbaj de incoronare, trofeu, semnificatie istorica; inchidere despre legacy/mandrie; emoji 🏆 si medalii; "campioane/campioni" proeminent.
- Semifinala / eliminatorie: tensiune, miza, naratiune "drumul spre finala".
- Sezon regulat: ton mai tactic/analitic, umor mai observational.
- Amical / fara miza: cel mai usor si amuzant ton, accent pe momente individuale.
- Diferenta mare (10+ goluri): nu inventa drama; recunoaste dominanta onest dar respectuos; gaseste ceva pozitiv la invinsa.
- Meci strans (1-3 goluri): tensiune maxima, naratiune gol-cu-gol pentru secventele cheie, schimbari de momentum.

GEN GRAMATICAL
- Detecteaza din numele competitiei: "Junioare/Fete/Florilor/Senioare" -> feminin ("campioane", "fetele"); "Zimbrilor/Juniori/Baieti/Seniori" -> masculin ("campioni", "baietii"). Foloseste genul corect peste tot.

Raspunde DOAR cu textul postarii, gata de copiat pe Facebook. Fara comentarii, fara explicatii, fara ghilimele in jurul intregului text.`;

const PRE_MATCH_SYSTEM = `Esti un creator de continut sportiv ardelenesc care scrie teasere PRE-MECI scurte pentru Facebook, despre handbal.

STIL
- Savoare ardeleneasca — cald, entuziast, ca si cum iti chemi prietenii la meci.
- Scurt si la obiect — MAXIM 50-80 de cuvinte.
- Hype potrivit contextului (finala > semifinala > sezon regulat).
- Adresare casual catre cititor ("frate", "hai ca...").
- Metafore cu mancare/bautura binevenite ("puneti cafeaua pe foc", "pregatiti floricele").
- Include linkul YouTube natural la final.

STRUCTURA
[Emoji] Hook cu energie ardeleneasca (1-2 fraze)
Info meci: echipe, context competitie (1-2 fraze)
Ora + locatie (1 fraza)
Apel la actiune cu linkul YouTube
[Emoji]

ADAPTARE DUPA CONTEXT
- Finala/titlu: hype maxim ("Azi se decide!", "E ziua cea mare!"), emoji trofeu/coroana.
- Semifinala: tensiune ("Cine merge mai departe?", "Drumul spre finala trece prin...").
- Sezon regulat/grupa: mai usor, invitational.

Termina mereu cu linia LIVE:
🔴 LIVE: [linkul YouTube]

Raspunde DOAR cu textul postarii, gata de copiat pe Facebook.`;

// ---- Match data scraper (mirrors the console script, server-side) -------------

async function scrapeMatch(id) {
  const url =
    "https://www.sportinfocentar2.com/coman/utakmice/" + id + ".js?" + Date.now();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Sursa de date a raspuns cu " + res.status + ". Verifica ID-ul meciului.");
  }
  const text = await res.text();
  let d;
  try {
    d = new Function("return(" + text + ")")();
  } catch (e) {
    throw new Error("Nu am putut interpreta datele meciului (format neasteptat).");
  }

  const u = (d.ut || [])[0];
  if (!u) throw new Error("Datele meciului sunt goale. Meciul s-a terminat? Mai incearca in 1-2 minute.");
  const pl = d.sastavi || [];
  const ev = d.dogadjaji || [];

  const topScorers = (eid) =>
    pl
      .filter((p) => p.ekipa === eid)
      .map((p) => ({
        name: `${p.ime} ${p.prezime}`,
        goals: p.sutd || 0,
        attempts: p.sutp || 0,
        assists: p.asistencija || 0,
        steals: p.osvojenih || 0,
        sus: p.iskljucenja || 0,
        val: p.valigrac,
        isGK: p.tipigraca == 1 || p.obranep > 0,
        saves: p.obraned || 0,
        faced: p.obranep || 0,
      }))
      .sort((a, b) => b.goals - a.goals);

  const goals = ev
    .filter((e) => e.td === 0 && e.ig && (e.ish === 0 || e.ish === 4))
    .map((e) => ({
      min: e.vr,
      team: e.e,
      name: `${e.i} ${e.p}`,
      num: e.pz,
      r1: e.r1,
      r2: e.r2,
    }));

  return {
    home: u.n1,
    away: u.n2,
    score: `${u.r1}-${u.r2}`,
    ht: `${u.p11}-${u.p12}`,
    competition: u.nn,
    venue: u.mn,
    city: u.mm,
    homeScorers: topScorers(u.ekipa1),
    awayScorers: topScorers(u.ekipa2),
    goals,
    matchId: id,
  };
}

// ---- Claude call --------------------------------------------------------------

async function callClaude(system, userText) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Eroare la API-ul Claude.");
  }
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// ---- Handler ------------------------------------------------------------------

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Lipseste ANTHROPIC_API_KEY in setarile Netlify." }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Cerere invalida." }) };
  }

  try {
    if (body.mode === "pre") {
      const lines = [
        `Echipe: ${body.home || "?"} vs ${body.away || "?"}`,
        body.context ? `Context: ${body.context}` : null,
        body.time ? `Ora: ${body.time}` : null,
        body.venue ? `Locatie: ${body.venue}` : null,
        body.city ? `Oras: ${body.city}` : null,
        body.youtube ? `Link YouTube LIVE: ${body.youtube}` : null,
      ].filter(Boolean);
      const article = await callClaude(PRE_MATCH_SYSTEM, lines.join("\n"));
      return { statusCode: 200, body: JSON.stringify({ article }) };
    }

    // default: post-match
    if (!body.matchId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Lipseste ID-ul meciului." }) };
    }
    const matchData = await scrapeMatch(String(body.matchId).trim());
    const userText =
      `Context: ${body.context || "(fara context — deduce din competitie si scor)"}` +
      (body.youtube ? `\nLink YouTube replay: ${body.youtube}` : "") +
      `\n\nDate meci (JSON):\n${JSON.stringify(matchData)}`;
    const article = await callClaude(POST_MATCH_SYSTEM, userText);
    return { statusCode: 200, body: JSON.stringify({ article, matchData }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};

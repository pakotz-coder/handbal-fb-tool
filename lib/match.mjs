// match.mjs — ia datele unui meci de pe sportinfocentar2 si le reduce
// la ce are nevoie articolul. Aceeasi selectie ca vechiul bookmarklet,
// dar pe server si fara eval (looseParse).

import { looseParse } from "./loose.mjs";

const SRC = "https://www.sportinfocentar2.com/coman/utakmice/";

// Accepta linkul frhlive2 (...?utakmica=1655852) sau doar numarul.
export function parseMatchId(input) {
  const s = String(input || "").trim();
  const m = s.match(/utakmica=(\d{3,12})/i) || s.match(/^(\d{3,12})$/);
  return m ? m[1] : null;
}

function teamPlayers(players, teamId) {
  return players
    .filter((p) => p.ekipa === teamId)
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
}

export function summarizeMatch(d, id) {
  const u = d?.ut?.[0];
  if (!u) return null;
  const players = d.sastavi || [];
  const events = d.dogadjaji || [];
  // ish 0 = gol. Bookmarkletul vechi lua si ish 4 (aruncari ratate/aparate),
  // ~20/meci; doar ish 0 se aduna exact la scorul final (verificat pe 5 meciuri).
  const goals = events
    .filter((e) => e.td === 0 && e.ig && e.ish === 0)
    .map((e) => ({ min: e.vr, team: e.e, name: `${e.i} ${e.p}`, num: e.pz, r1: e.r1, r2: e.r2 }));
  return {
    home: u.n1,
    away: u.n2,
    score: `${u.r1}-${u.r2}`,
    ht: `${u.p11}-${u.p12}`,
    competition: u.nn,
    venue: u.mn,
    city: u.mm,
    homeScorers: teamPlayers(players, u.ekipa1),
    awayScorers: teamPlayers(players, u.ekipa2),
    goals,
    matchId: id,
  };
}

// Arunca Error cu mesaj in romana, gata de afisat.
export async function fetchMatch(id) {
  let r;
  try {
    r = await fetch(`${SRC}${id}.js?${Date.now()}`, { signal: AbortSignal.timeout(12000) });
  } catch {
    throw new Error("Nu am putut contacta sportinfocentar2.com. Încearcă din nou peste câteva secunde.");
  }
  if (r.status === 404) throw new Error(`Meciul ${id} nu există pe sportinfocentar2.com. Verifică linkul.`);
  if (!r.ok) throw new Error(`sportinfocentar2.com a răspuns cu eroarea ${r.status}.`);

  let data;
  try {
    data = looseParse(await r.text());
  } catch {
    throw new Error("Datele meciului au un format neașteptat (poate sportinfocentar și-a schimbat formatul).");
  }
  const match = summarizeMatch(data, id);
  if (!match || !match.home) throw new Error(`Meciul ${id} nu are încă date (echipe/scor).`);
  return match;
}

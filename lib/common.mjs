// common.mjs — ce folosesc ambele functii Netlify (generate si proofread):
// modelul, prompturile, verificarea parolei, raspunsurile JSON, mesajele de eroare, literele.

import Anthropic from "@anthropic-ai/sdk";
import { createHash, timingSafeEqual } from "node:crypto";
import { RO } from "./prompts-ro.mjs";
import { HU } from "./prompts-hu.mjs";

export const MODEL = "claude-sonnet-5-5"; // swap to "claude-opus-5-5" for richer flavor (slower, ~2x price)
export const PROMPTS = { ro: RO, hu: HU };

// Fingerprint of the prompts, sent on every response (even a 401), so a deploy can be
// verified from outside: compare it with the same hash computed from the repo.
export const PROMPTS_VERSION = createHash("sha256").update(JSON.stringify(PROMPTS)).digest("hex").slice(0, 10);

export function json(obj, status = 200) {
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

// Returns an error Response when the request may not use the API, or null when it may.
export async function checkAccess(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expected = process.env.ACCESS_PASSWORD;
  if (!expected) return json({ error: "Lipsește ACCESS_PASSWORD în setările Netlify (Environment variables)." }, 500);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "Lipsește ANTHROPIC_API_KEY în setările Netlify." }, 500);
  if (!samePassword(req.headers.get("x-access-password") || "", expected)) {
    await new Promise((r) => setTimeout(r, 1000)); // slows down guessing
    return json({ error: "Parolă de acces greșită.", auth: true }, 401);
  }
  return null;
}

export function apiErrorMessage(e) {
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

// Look-alike letters the model occasionally writes: cedilla ş/ţ instead of comma ș/ț (RO),
// õ/û instead of double-acute ő/ű (HU). A letter that appears in the source text
// (e.g. a foreign player's name) is left alone, so names are never altered.
const LOOKALIKES = {
  ro: [["ş", "ș"], ["Ş", "Ș"], ["ţ", "ț"], ["Ţ", "Ț"]],
  hu: [["õ", "ő"], ["Õ", "Ő"], ["û", "ű"], ["Û", "Ű"]],
};
export function letterFixer(lang, source) {
  const pairs = LOOKALIKES[lang].filter(([bad]) => !source.includes(bad));
  return (s) => pairs.reduce((t, [bad, good]) => t.split(bad).join(good), s);
}

// Stock openers the model falls back to ("Păi ce să zic, frate, …"). The prompt asks for a
// direct first sentence; this is the safety net. Only removed at the start of a paragraph,
// and the next word gets a capital: "Păi ce să zic, frate, Brăila a…" → "Brăila a…".
const STOCK_OPENERS = {
  ro: /^(?:păi|pai)(?:\s+ce\s+(?:să|sa)\s+(?:zic|spun))?(?:\s*,\s*(?:frate|fraților|fratilor|dragilor))?\s*[,:;!.…—–-]*\s+|^(?:frate|fraților|fratilor)\s*[,:;!…—–-]+\s*/iu,
  hu: /^(?:hát\s+mit\s+mondjak|hát|na|nos)\s*[,:;!.…—–-]+\s*/iu,
};
const OPENER_REASON = { ro: "formulă de început", hu: "sablonos kezdés" };
const OPENER_REMOVED = { ro: "(eliminată)", hu: "(törölve)" };
// Returns the cleaned text and the removals, in the same shape as proofreading corrections.
export function stripStockOpeners(text, lang) {
  const corrections = [];
  const out = text.split("\n").map((line) => {
    const m = line.match(STOCK_OPENERS[lang]);
    if (!m || m[0].length >= line.length) return line;
    const rest = line.slice(m[0].length);
    const shown = m[0].trim().replace(/[\s,:;!.…—–-]+$/u, "");
    corrections.push({ original: shown, corrected: OPENER_REMOVED[lang], reason: OPENER_REASON[lang] });
    return rest.charAt(0).toLocaleUpperCase(lang) + rest.slice(1);
  }).join("\n");
  return { text: out, corrections };
}

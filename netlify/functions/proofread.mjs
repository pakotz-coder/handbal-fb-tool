// proofread.mjs — Netlify Function: corectura unui articol deja scris.
// Separata de generate.mjs ca sa aiba propriile 60 de secunde (limita Netlify per functie):
// scrierea si corectura impreuna puteau depasi limita, iar functia era oprita la jumatate.
// Intoarce doar textul corectat si lista corecturilor aplicate.

import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, PROMPTS, json, checkAccess, apiErrorMessage, letterFixer } from "../../lib/common.mjs";

const PROOF_MAX_TOKENS = 6000; // thinking + a short list of corrections
const MAX_TEXT = 20_000;       // characters; an article is ~3,000

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

export default async (req) => {
  const denied = await checkAccess(req);
  if (denied) return denied;

  let body;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ error: "Cerere invalidă." }, 400);
  }
  const lang = body.lang || "ro";
  if (!Object.hasOwn(PROMPTS, lang)) return json({ error: "Limbă necunoscută." }, 400);
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return json({ error: "Lipsește textul de corectat." }, 400);
  if (text.length > MAX_TEXT) return json({ error: "Text prea lung pentru corectură." }, 413);

  try {
    const msg = await new Anthropic().beta.messages.parse(
      {
        model: MODEL,
        max_tokens: PROOF_MAX_TOKENS,
        output_config: { effort: "medium", format: CORRECTIONS_FORMAT },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: PROMPTS[lang].proof,
        messages: [{ role: "user", content: `<articol>\n${text}\n</articol>` }],
      },
      { signal: req.signal },
    );
    if (msg.stop_reason !== "end_turn" || !msg.parsed_output)
      return json({ error: `corectorul nu a răspuns complet (${msg.stop_reason})` }, 502);
    const { text: corrected, applied } = applyCorrections(text, msg.parsed_output.corrections);
    // The draft is the source: a look-alike letter it already contains on purpose stays.
    return json({ text: letterFixer(lang, text)(corrected), corrections: applied });
  } catch (e) {
    return json({ error: apiErrorMessage(e) }, 502);
  }
};

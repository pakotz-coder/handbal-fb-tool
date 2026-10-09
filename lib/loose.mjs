/* ============================================================
   loose.mjs — parser tolerant pentru fisierele .js de la sursa,
   FARA eval/new Function (copiat din Handball-AI-overlay).

   Sursa (sportinfocentar2.com) returneaza obiecte JS neglijente:
   - chei ne-ghilimelate  (poredakkraj: [], mvp: 0)
   - numere cu zero in fata (mu: 02  -> octal legacy)
   - caractere de control brute (TAB) in interiorul string-urilor
   - eventuale virgule finale

   Strategie: parcurgem textul si sarim peste literalii string
   (respectand escape-urile), aplicand reparatiile DOAR in afara
   string-urilor; in interiorul lor escapam caracterele de control.
   Apoi JSON.parse. Fara eval, deci merge in Workers.
   ============================================================ */

// escapeaza caractere de control brute (TAB/newline etc.) dintr-un string
function escCtl(str) {
  return str.replace(/[\u0000-\u001F]/g, ch => JSON.stringify(ch).slice(1, -1));
}

function fixSeg(seg) {
  return seg
    // chei ne-ghilimelate: {key:  sau  ,key:  ->  "key":
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    // numere cu zero in fata: : 02 -> : 2  (dar 0 singur ramane 0)
    .replace(/([:\[,]\s*)0+(\d)/g, '$1$2')
    // virgule finale inainte de } sau ]
    .replace(/,(\s*[}\]])/g, '$1');
}

/** Repara si intoarce text JSON valid dintr-un obiect JS neglijent. */
export function looseFix(text) {
  const s = text;
  let out = '';
  let seg = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"' || c === "'") {
      out += fixSeg(seg); seg = '';
      const q = c;
      let str = '';
      i++;
      while (i < n) {
        const ch = s[i];
        if (ch.charCodeAt(0) === 92) { str += ch + (s[i + 1] ?? ''); i += 2; continue; }
        if (ch === q) { i++; break; }
        str += ch; i++;
      }
      if (q === '"') out += '"' + escCtl(str) + '"';
      else out += JSON.stringify(escCtl(str));
      continue;
    }
    seg += c; i++;
  }
  out += fixSeg(seg);
  return out;
}

/** Extrage valoarea unei variabile `var NAME = {...};` fara eval. */
export function looseParse(text, varName) {
  let body = text;
  if (varName) {
    const idx = text.indexOf(varName);
    if (idx >= 0) {
      const eq = text.indexOf('=', idx);
      if (eq >= 0) body = text.slice(eq + 1);
    }
  }
  body = body.trim().replace(/;\s*$/, '').trim();
  try { return JSON.parse(body); } catch (_) { /* fall through */ }
  return JSON.parse(looseFix(body));
}

# HandbaLiveBV — Generator postări (Level 2)

Link meci frhlive2 + context → articol gata de copiat pe Facebook. Datele meciului se iau
pe server, de pe sportinfocentar2.com; cheia API și parola de acces stau doar în Netlify.

## Structură
```
public/index.html               → interfața (după meci / înainte de meci, temă luminoasă/întunecată)
netlify/functions/generate.mjs  → verifică parola, ia datele meciului, apelează Claude (streaming)
lib/match.mjs                   → descarcă și rezumă meciul de pe sportinfocentar2
lib/loose.mjs                   → parser pentru fișierele .js ale sursei (fără eval)
netlify.toml                    → config (publică doar public/)
```

## Deploy pe Netlify
1. Site settings → Environment variables → adaugă **ambele**:
   - `ANTHROPIC_API_KEY = sk-ant-...` (cheia din console.anthropic.com)
   - `ACCESS_PASSWORD = ...` — parola cerută de pagină. Fără ea funcția refuză orice cerere.
     Folosește o frază lungă (12+ caractere); o parolă scurtă se poate ghici.
2. Deploy din GitHub (push pe ramura conectată). Netlify instalează singur `@anthropic-ai/sdk`
   din `package.json`.

## Folosire (după meci)
1. Deschide meciul pe frhlive2.com și copiază adresa (`…indexut.html?utakmica=NUMĂR`).
2. Lipește-o la „Link meci” (merge și doar numărul).
3. Scrie contextul (sau apasă un chip), opțional linkul YouTube.
4. „Generează articol” → scorul + articolul → „Copiază” → pune pe Facebook.

Prima dată pagina cere parola de acces; după prima generare reușită rămâne salvată în browser
(„Schimbă parola” jos în pagină).

Dacă generarea se întrerupe (Claude suprasolicitat, conexiune căzută, limită de lungime), sub
articol apare un avertisment galben: **nu posta textul fără să verifici finalul**.

Rezervă: dacă sportinfocentar ar bloca serverul Netlify, în câmpul „Link meci” se poate lipi și
JSON-ul vechiului bookmarklet (textul care începe cu `{`).

Înainte de meci: tab-ul al doilea, doar nume echipe + context + oră + locație + link.

## Model
În `generate.mjs`, sus:
- `MODEL = "claude-sonnet-5-5"` — schimbă în `"claude-opus-5-5"` pentru savoare mai bogată
  (mai lent, cam de 2× mai scump).
- `EFFORT = "medium"` — mai multă grijă la gramatică și statistici; `"low"` pornește mai repede.
- `MAX_TOKENS = 8000` — plafonează și costul maxim al unei cereri.
- Fallback automat: dacă filtrele de siguranță ar refuza o cerere (n-ar trebui, la handbal),
  API-ul o reîncearcă singur pe modelul recomandat de Anthropic.

## Securitate
- Funcția cere header-ul `x-access-password` egal cu `ACCESS_PASSWORD`; parolă greșită → 401 după 1s.
- Câmpurile au lungimi maxime, corpul cererii max 100 KB.
- Se publică doar `public/`, deci codul funcției nu mai e accesibil la `/netlify/functions/…`.

## Note
- Costul per articol e mic (câțiva cenți), plătit pe cheia ta API — separat de abonamentul claude.ai.
- Pasul de postare pe Facebook rămâne manual (copy → paste). Automatizarea lui = Level 3
  (Graph API + token de Pagină).

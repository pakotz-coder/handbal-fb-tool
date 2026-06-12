# HandbaLiveBV — Generator postări (Level 2)

Match ID + context → articol gata de copiat pe Facebook. Scraping-ul se face server-side
(fără probleme CORS), iar cheia API stă doar în Netlify, nu în pagină.

## Structură
```
index.html                      → interfața (după meci / înainte de meci)
netlify/functions/generate.js   → scrape + apel Claude API (ține cheia)
netlify.toml                    → config
```

## Deploy pe Netlify (o singură dată)

1. Urcă folderul ca site nou pe Netlify (drag-and-drop folderul în app.netlify.com,
   sau conectează un repo GitHub cu aceste fișiere).
2. Site settings → Environment variables → adaugă:
   `ANTHROPIC_API_KEY = sk-ant-...`  (cheia ta din console.anthropic.com)
3. Trigger deploy. Gata.

## Folosire (după meci)
1. Deschide site-ul, tab "După meci".
2. Lipește ID-ul meciului (numărul din `...?utakmica=NUMAR`).
3. Scrie linia de context (sau apasă un chip), opțional linkul YouTube.
4. "Generează articol" → apare scorul + articolul → "Copiază" → pune pe Facebook.

Înainte de meci: tab-ul al doilea, doar nume echipe + context + oră + locație + link.

## Model
În `generate.js`, sus: `const MODEL = "claude-sonnet-4-6"`.
Schimbă în `"claude-opus-4-8"` dacă vrei savoare ardelenească mai bogată (mai lent / mai scump).

## Note
- Costul per articol e mic (câțiva cenți), plătit pe cheia ta API — separat de abonamentul claude.ai.
- Pasul de postare pe Facebook rămâne manual (copy → paste). Automatizarea lui = Level 3 (Graph API + token de Pagină).

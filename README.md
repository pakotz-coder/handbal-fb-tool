# HandbaLiveBV — Generator postări (Level 2)

Link meci frhlive2 + context → articol gata de copiat pe Facebook. Datele meciului se iau
pe server, de pe sportinfocentar2.com; cheia API și parola de acces stau doar în Netlify.

## Structură
```
public/index.html               → interfața (după meci / înainte de meci, temă luminoasă/întunecată)
netlify/functions/generate.mjs  → verifică parola, ia datele meciului, apelează Claude (streaming)
lib/prompts-ro.mjs              → prompturile în română (articol, teaser, corector)
lib/prompts-hu.mjs              → prompturile în maghiară (aceeași structură)
lib/places-hu.mjs               → nume maghiare ale orașelor (listă verificată manual, în repo)
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

Corectură automată: după ce articolul e scris, un al doilea apel Claude îl recitește și întoarce
doar greșelile de gramatică și exprimare. Ele se aplică pe server, iar sub articol apare lista
„Corectură automată: N modificări”. O corectură se aplică doar dacă fragmentul apare o singură
dată în text și nu schimbă nicio cifră, deci statisticile nu pot fi atinse. „Copiază” devine
activ abia după corectură.

Dacă generarea se întrerupe (Claude suprasolicitat, conexiune căzută, limită de lungime), sub
articol apare un avertisment galben: **nu posta textul fără să verifici finalul**. Dacă doar
corectura eșuează, textul e complet, dar necorectat; avertismentul spune asta.

Rezervă: dacă sportinfocentar ar bloca serverul Netlify, în câmpul „Link meci” se poate lipi și
JSON-ul vechiului bookmarklet (textul care începe cu `{`).

Înainte de meci: tab-ul al doilea, doar nume echipe + context + oră + locație + link.

## Limbi: română, maghiară sau ambele
Sus în pagină, „Limba postării”: **Română**, **Magyar** sau **Ambele**. La „Ambele” pagina trimite
două cereri în paralel (fiecare cu corectura ei) și afișează două carduri, fiecare cu „Copiază”.
Costul se dublează. Interfața rămâne în română; contextul se poate scrie tot în română.

- Prompturile maghiare (`lib/prompts-hu.mjs`) au aceeași structură și aceleași reguli ca cele
  românești: ton cald cu tentă ardelenească discretă, glosar de handbal (gólpassz, labdaszerzés,
  kiállítás, védés), corector propriu în maghiară.
- **Orașe:** numele maghiare vin doar din `lib/places-hu.mjs` — o listă scrisă manual pentru
  Transilvania, Banat, Crișana, Maramureș și București (Bukarest). Restul localităților rămân cu
  numele oficial românesc (Ploiești, Craiova). Pentru un oraș nou se adaugă o linie în listă.
- **Jucătoarele** rămân cu numele exact ca în date (prenume întâi), iar echipele cu numele oficial.
- Literele greșite care seamănă cu cele corecte se repară automat pe server: ş/ţ (sedilă) → ș/ț
  în română, õ/û → ő/ű în maghiară. Excepție: litera apare chiar în datele meciului (un nume străin).

## Model
În `generate.mjs`, sus:
- `MODEL = "claude-sonnet-5-5"` — schimbă în `"claude-opus-5-5"` pentru savoare mai bogată
  (mai lent, cam de 2× mai scump).
- `EFFORT = "medium"` — mai multă grijă la gramatică și statistici; `"low"` pornește mai repede.
- `MAX_TOKENS = 8000` — plafonează și costul maxim al unei cereri.
- `PROOF_MAX_TOKENS = 6000` — plafonul pentru corectură (gândire + lista de corecturi).
  Corectura adaugă cam 5-10 secunde și ~1 cent pe articol.
- Ton: glumeț (măcar o poantă pe paragraf), tentă ardelenească fină. Ca postările să nu semene
  între ele, serverul alege la întâmplare, pentru fiecare postare: un „unghi de deschidere”, două
  „procedee de umor” și, în ~70% din cazuri, o singură expresie regională. Listele sunt în
  `VARIETY` din `lib/prompts-ro.mjs` și `lib/prompts-hu.mjs`; pentru idei noi se adaugă o linie.
- Versiunea live se poate verifica: funcția trimite antetul `x-prompts-version` (hash al
  prompturilor), care trebuie să fie identic cu cel calculat din repo.
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

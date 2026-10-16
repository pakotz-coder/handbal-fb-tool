# AGENTS.md — handbal-fb-tool (HandbaLiveBV post generator)

Instructions for any AI coding agent or human developer. Details in `README.md` (Romanian).
This repo is PUBLIC: never commit keys, passwords or private links.

## What it is
A one-page tool: paste a frhlive2.com match link + a short context → it writes a ready-to-post
Facebook article (Romanian, Hungarian or both), then proofreads it. Pre-match teasers too.

## Stack & hosting
- Netlify: static `public/index.html` + two functions in `netlify/functions/`:
  `generate.mjs` (writes the article, NDJSON streaming) and `proofread.mjs` (separate request:
  Netlify stops a function after 60 s).
- Deploy = push to the connected GitHub branch (Netlify builds automatically).
- Netlify environment variables (never in the repo): `ANTHROPIC_API_KEY`, `ACCESS_PASSWORD`.
- Match data is fetched server-side from sportinfocentar2.com (`lib/match.mjs`, parser `lib/loose.mjs`).

## Repo map
- `lib/common.mjs` — MODEL, access check, JSON helpers, API error messages, letter fixer, stock-opener filter.
- `lib/prompts-ro.mjs`, `lib/prompts-hu.mjs` — all prompts (article, teaser, proofreader) and the
  `VARIETY` lists (opening angles, humour devices, regional expressions). Provider-independent.
- `lib/places-hu.mjs` — hand-checked Hungarian place names (add a line for a new town).

## Run locally
`npm install`, then `npx netlify dev` with `ANTHROPIC_API_KEY` and `ACCESS_PASSWORD` in a local `.env`
(gitignored). The response header `x-prompts-version` must match the hash of the prompts in the repo.

## Rules
- Only statistics from the match data; never invent numbers (the proofreader may not change digits).
- Romanian with correct comma diacritics (ș, ț); Hungarian with ő/ű — `letterFixer` repairs look-alikes.
- Keep both languages structurally identical: a change in `prompts-ro.mjs` usually needs the same
  change in `prompts-hu.mjs`.
- Commit messages: Romanian, no diacritics, explain why.

## Switching the AI provider by hand (OpenAI or DeepSeek) — documented, not implemented
Use this if Anthropic's API is unavailable for a long time or the key is lost. Work on a branch;
Netlify deploy previews let you test before merging.

**Provider-independent (keep as is):** prompts and `VARIETY`, `match.mjs`, `letterFixer`,
`stripStockOpeners`, `applyCorrections`, the UI and the NDJSON event protocol
(`match` → `ping`/`text`… → `draft` → `done`, or `error`).

**Anthropic-specific (replace):**
| Where | Today (Anthropic) | OpenAI | DeepSeek |
|---|---|---|---|
| `package.json` | `@anthropic-ai/sdk` | `openai` | `openai` (OpenAI-compatible API) |
| client | `new Anthropic()` | `new OpenAI()` (reads `OPENAI_API_KEY`) | `new OpenAI({ baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY })` |
| `MODEL` (`common.mjs`) | `claude-sonnet-5-5` | current GPT model | current DeepSeek chat model |
| key check (`checkAccess`) | `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` | `DEEPSEEK_API_KEY` |
| system prompt | `system:` field | first message `{ role: "system" }` | same as OpenAI |
| streaming (`generate.mjs`) | `client.beta.messages.stream`, `content_block_delta` / `text_delta` | `chat.completions.create({ stream: true })`, read `choice.delta.content` | same as OpenAI |
| end reason | `stop_reason` `refusal` / `max_tokens` | `finish_reason` `content_filter` / `length` | `finish_reason` `length` |
| `effort` | `output_config: { effort }` | `reasoning_effort` (reasoning models only) | drop it |
| server-side fallback | `betas: [...]`, `fallbacks: "default"` | drop it | drop it |
| proofread JSON (`proofread.mjs`) | `beta.messages.parse` + JSON schema | `response_format: { type: "json_schema", … }` | `response_format: { type: "json_object" }` + validate the JSON yourself |
| errors (`apiErrorMessage`) | `Anthropic.*Error` classes | `OpenAI.*Error` classes (similar names) | same as OpenAI |

Steps: (1) branch; (2) swap the rows above; (3) set the new key in Netlify (deploy-preview context);
(4) **quality check before merging** — generate posts for the same 5 past matches (RO and HU) with the
old and new provider and compare tone, humour, diacritics and facts; (5) merge; (6) to roll back,
revert the merge (the Anthropic key can stay in Netlify).
Note: DeepSeek processes data in China — acceptable for public match data, not for personal data.

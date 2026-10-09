# AliVocab

A themed vocabulary trainer, built Polish-first but language-agnostic. A user enters a **theme**
(e.g. "at the bakery"). An AI proposes N words (default 30, configurable). The user tags each word
**known / recognize / not known**, and the words then feed spaced-repetition flashcards and exercises
(multiple choice, fill-in, listening scripts, grammar drills, sentence building, AI role-play).

Multi-user with login (invite-only sign-up), self-hosted later on a VPS with Docker.

> The roadmap, data model and phase breakdown live in **[PLAN.md](PLAN.md)**. Read it before
> starting a new feature, and update it when a decision changes.

## Stack

| Layer      | Choice |
|------------|--------|
| Monorepo   | pnpm workspaces + Turborepo, Node 24 LTS, ESM everywhere, TypeScript `strict` |
| Frontend   | React 19 + Vite, TanStack Router (file-based) + TanStack Query, Tailwind CSS v4 + shadcn/ui, `vite-plugin-pwa` (installable, mobile-first) |
| Appearance | Semantic CSS-variable tokens (OKLCH), curated color palettes (language/flag-inspired + neutrals), each with light and dark variants; light/dark/system mode |
| Backend    | Hono on Node (`@hono/node-server`), zod validation (`@hono/zod-validator`), Hono RPC client (`hc`) for end-to-end types |
| Database   | SQLite (WAL mode) via `better-sqlite3` + Drizzle ORM, migrations with `drizzle-kit` |
| Auth       | Better Auth (email + password, cookie sessions, Drizzle adapter) + custom invite-code gate |
| AI         | Vercel AI SDK (`ai`) with direct provider packages: Anthropic, OpenAI, DeepSeek, Google (Gemini free tier), OpenRouter / any OpenAI-compatible endpoint. In browser: WebLLM (`@mlc-ai/web-llm`) and Chrome built-in AI (Prompt API). Plus a manual copy-prompt → paste-result flow |
| SRS        | FSRS via `ts-fsrs` |
| TTS        | Web Speech API (default, free) + optional cloud TTS (OpenAI / Azure / ElevenLabs) with server-side audio cache |
| Tooling    | Biome (lint + format), Vitest (unit), Playwright (e2e, later), GitHub Actions CI |
| Deploy     | Single Docker image (API also serves the built SPA), docker-compose + Caddy (HTTPS), SQLite on a volume, Litestream or nightly backup |

## Repository layout (target)

```
apps/
  web/            React SPA (PWA)
  api/            Hono server, the only process that touches the DB
packages/
  db/             Drizzle schema, migrations, seed, db client
  core/           Pure domain logic: import parsers (CSV/JSON), prompt templates,
                  SRS helpers (tag→seed, rating mapping), answer checking, normalization
  shared/         zod schemas + TS types shared by web and api (DTOs, enums)
  ai/             Provider registry & adapters on top of the AI SDK (server side)
  ui/             (optional) shared shadcn components if a second frontend appears
docker/           Dockerfile, compose, Caddyfile
```

Workspace packages are **source-only**: their `exports` point at `src/*.ts`. Vite, tsx and tsup
compile them, and the API's tsup build bundles `@alivocab/*` into `dist/`. Relative imports use
explicit `.ts` extensions. `apps/web/src/styles/palettes.generated.css` is generated from
`packages/shared/src/appearance` on `dev`/`build` (gitignored). `routeTree.gen.ts` is generated
by the TanStack Router plugin and committed.

Rules for dependencies between packages:
- `core` and `shared` are **pure**. No DB, no network, no Node-only APIs, so both web and api
  can use them.
- Only `apps/api` imports `packages/db` and `packages/ai`.
- In-browser AI (WebLLM, Chrome AI) lives in `apps/web`. Its output goes through the **same import
  endpoint** as pasted text, so all AI output is validated in one place.

## Commands

```bash
pnpm install
pnpm dev              # turbo: web (Vite :5180) + api (:3180) in parallel, Vite proxies /api
pnpm build
pnpm test             # vitest across packages
pnpm lint             # biome check
pnpm format           # biome format --write
pnpm db:generate      # drizzle-kit generate (after editing packages/db/src/schema)
pnpm db:seed          # first admin from ADMIN_EMAIL/ADMIN_PASSWORD + prints a fresh invite code
pnpm db:studio        # browse the SQLite DB (drizzle-kit studio)
pnpm --filter @alivocab/api <script>   # run a script in one package
```

Package names use the `@alivocab/*` scope. The API applies pending migrations on boot. The dev DB
lives at `data/alivocab.db` (gitignored). Copy `.env.example` → `.env` and fill in the secrets first.

## Domain concepts (keep these consistent)

- **Lexeme**: a word in the shared dictionary, unique on `(lang, normalized_lemma, pos)`. It holds
  part of speech, gender, aspect / aspect pair, grammatical forms (JSON), pronunciation, translations
  (per native language) and example sentences. It is shared across users so the same word is
  never stored twice.
- **Theme**: owned by a user. Many-to-many with lexemes (`theme_lexemes`). A word proposed again
  under a new theme is **linked**, not duplicated, and keeps its existing tag and SRS state.
- **UserLexeme**: per-user state of a lexeme: `status` (`unknown | recognize | known`,
  plus `untagged` before review), notes and mnemonic, exposure counters.
- **Card**: per user, per lexeme, per direction (`recognition`: target→native, `recall`:
  native→target). Holds the FSRS state. Every graded interaction writes a `review_log` row.
- **Exposure**: any time a word is shown (flashcard, exercise, listening script). Exposures are
  counted separately from graded reviews.
- **Tag → SRS seeding**: `unknown` creates new cards due now. `recognize` gives the recognition card
  a short seeded interval and makes the recall card due now. `known` seeds both cards with long
  intervals. After that, the status is **derived from performance** (with manual override allowed).
- **Appearance / palette**: the user's color scheme. **Never call it "theme"** in code, routes or
  UI copy, because *theme* means a vocabulary theme. `color_palette` is `'auto'` (follow
  `target_lang`, fallback `slate`) or a preset id. `color_mode` is `system | light | dark`.
  Both are stored in `user_profiles` (synced across devices). See PLAN.md §7.
- **Generation**: every AI call or paste import is stored (`ai_generations`: prompt, raw output,
  provider, model, status) so it can be audited and re-parsed.

## Auth & API patterns

- `apps/api/src/app.ts` exports `createApp(deps)`. Tests build it with `createTestApp()`
  (`src/test/helpers.ts`: in-memory DB, mocked fetch). Never import `env.ts` from code under test.
- Protected routes use `requireAuth(auth)` (and `requireAdmin`) from `src/middleware/auth.ts`, then
  `c.get('user')`. Lookups of user-owned rows filter on both id **and** `user_id`, and return 404
  (not 403) for other users' ids.
- Sign-up requires the `x-invite-code` header (`INVITE_HEADER`). Roles, banning and admin password
  resets use Better Auth's admin plugin (`authClient.admin.*` on the web).
- Vocabulary writes go through `saveWords()` (`apps/api/src/lib/vocab.ts`): it dedupes on
  `(lang, normalized_lemma, pos)`, only *fills* missing shared fields, links the word to the theme and
  records the user's tag. Never insert into `lexemes` directly from a route.
- AI output of any origin goes through `parseVocabulary()` (`packages/core/src/import`). When a new
  messy-output case shows up, add it to `parse.test.ts` first.
- Scheduling: FSRS math only in `packages/core/src/srs` (plain `CardState`, no ts-fsrs types leak).
  `apps/api/src/lib/srs.ts` owns the queue, grading and summary. Every graded interaction must go
  through `gradeCard()`, which writes the review log, the exposure, the counters and the status.
  New words get cards via `createCards()` in `saveWords()`. Manual re-tags call `reseedCards()`.
- Lessons: `apps/api/src/lib/lessons.ts` builds them from the review queue; which exercise a card
  gets and how a result maps to a rating live in `packages/core/src/exercises` (pure, used by the
  web app to check answers). Graded answers still go through `gradeCard()`; extra practice
  (`mode=practice`) goes through `recordPractice()` and never touches cards.
- Pictures: everything goes through the picture service (`apps/api/src/lib/pictures`, `deps.pictures`).
  Which picture a user sees is decided only by `resolvePictures()` (hidden → own choice → shared
  default). Downloads must go through `downloadImage()` (SSRF guard, size cap, sharp re-encode).
  Never hotlink provider URLs. Pictures a learner brings (`upload`, `link`) are private to them
  and never become the shared default. New words are queued with `pictures.enqueue(lexemeIds)` after
  `saveWords()` when the profile's `autoPictures` is on. Tests use `createTestApp()`'s temp media
  dir and mocked fetch, never the real providers. See PLAN.md §4.4.
- `packages/ai` is server-only (AI SDK + provider SDKs). In-browser models live in
  `apps/web/src/features/browser-ai` and are lazy-loaded (WebLLM is about 6 MB).
- The web app calls the API via `api` (Hono RPC) + `unwrap()` (`src/lib/api.ts`). Query options
  live in `src/lib/queries.ts`. Profile changes go through `useUpdateProfile()` (optimistic, and
  also applies appearance).

## Conventions

- TypeScript strict. No `any` (use `unknown` + zod). Prefer `type` over `interface` unless extending.
- Validate **every** API input with zod schemas from `packages/shared`. Never trust AI output:
  parse it with the same zod schemas before it touches the DB.
- Text normalization: Unicode NFC, trim, collapse whitespace, and lowercase for matching keys.
  **Keep diacritics** in stored data and dedupe keys (`kość` ≠ `kosc`). Answer checking may be
  diacritic-tolerant but must flag the missing diacritics to the learner.
- Language codes: ISO 639-1 (`pl`, `en`, `pt`). Never hard-code `pl` outside seeds and defaults.
- Prompt templates live in `packages/core/src/prompts/`, are versioned (`PROMPT_VERSION`) and are
  unit-tested with snapshot tests. The same template feeds API calls, in-browser models and the
  copy-prompt UI.
- DB: timestamps are integer unix ms. IDs are text (`nanoid` / cuid2). Every user-owned table has
  `user_id` and every query filters on it. Schema changes go through `drizzle-kit generate`, and
  generated migrations are never edited by hand once committed.
- Secrets: provider API keys are AES-256-GCM encrypted with `APP_ENCRYPTION_KEY` and never sent back
  to the client (show only the provider and the last 4 characters). `.env` is gitignored.
  `.env.example` documents every variable.
- Colors: components use **only semantic token utilities** (`bg-primary`, `text-muted-foreground`,
  `text-status-known`, …). No raw Tailwind palette classes (`bg-red-500`) or hex/rgb values in
  components, and CI checks for this. New presets go in
  `packages/shared/src/appearance/palettes.ts` with both `light` and `dark` token sets and must pass
  the contrast tests. Never show status or correctness by color alone. Pair it with an icon or label.
- UI: mobile-first and touch-friendly. Keyboard shortcuts on desktop (1/2/3 for tagging,
  space to flip a flashcard). All UI strings in English for now, kept in one place so they can
  be translated later.
- Tests: domain logic in `core` needs unit tests (parsers, normalization, SRS seeding, answer
  checks). API routes get integration tests against an in-memory SQLite DB.

## Git workflow

- Default branch is `main`. Do feature work on short-lived branches (`feat/…`, `fix/…`, `chore/…`).
- Use Conventional Commits (`feat(api): add theme import endpoint`).
- Do not commit `.env`, `data/*.db*` or audio cache files.
- The remote (GitHub) will be added later with `gh repo create`. Don't push without being asked.

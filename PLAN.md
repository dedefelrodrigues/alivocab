# AliVocab: Implementation Plan

Status: **Phase 3 done: MVP** (SRS + flashcards). Next: Phase 4 (multiple choice, cloze, lessons, stats). Each phase ends in a usable, committed state.
The core loop (MVP) is done at the end of **Phase 3**.

---

## 1. Decisions log

| # | Topic | Decision |
|---|-------|----------|
| D1 | Framework | React SPA (Vite) + Hono API, pnpm + Turborepo monorepo, TypeScript end-to-end |
| D2 | DB | SQLite (WAL) + Drizzle ORM + better-sqlite3 |
| D3 | Auth | Email/password via Better Auth, cookie sessions, **invite codes** (admin-issued) |
| D4 | API keys | Stored on the server, AES-256-GCM encrypted per user. AI calls go through the backend |
| D5 | Languages | Per-user `target_lang` (default `pl`) + `native_lang` (e.g. `en`, `pt`). UI in English |
| D6 | Word data | lemma, translation(s), POS, gender, aspect / aspect pair, grammatical forms, example sentences, pronunciation, notes / mnemonic |
| D7 | Data sharing | Shared dictionary of lexemes. Themes, tags, SRS state and exposures are private per user |
| D8 | SRS | FSRS (`ts-fsrs`), two cards per word (recognition and recall) |
| D9 | Tags → SRS | Tags seed the initial FSRS state, then the status is derived from performance (manual override allowed) |
| D10 | AI sources | (a) API providers: Claude, OpenAI, DeepSeek, Gemini free tier, OpenRouter (incl. `:free` models), custom OpenAI-compatible; (b) in-browser: WebLLM + Chrome built-in AI; (c) copy-prompt → paste CSV/JSON |
| D11 | TTS | Web Speech API by default. Optional cloud TTS with your own key, audio cached on the server |
| D12 | Exercise content | Hybrid: deterministic where possible (flashcards, MCQ, cloze from stored sentences). AI output (scripts, grammar notes, new sentences) is cached in the DB |
| D13 | Hosting | VPS / home server, Docker + Caddy, SQLite on a volume, Litestream / nightly backups |
| D14 | Name | **AliVocab**, package scope `@alivocab/*` |
| D15 | Exercise roadmap | Flashcards, MCQ, fill-in, listening, declension/conjugation drills, sentence building/translation, AI role-play |
| D16 | Color palettes | **Curated presets only** (no free color picker): language/flag-inspired palettes + neutrals. Every preset ships a light and a dark variant that are contrast-tested (WCAG AA) |
| D17 | Palette selection | Default `auto` = follow the user's target language (learning Polish → Polish palette, fallback neutral). The user can pin a specific preset instead |
| D18 | Light/dark | `system` (default) / `light` / `dark`. Palette and mode are **both saved to the account** and follow the user across devices |
| D19 | Roles & user admin | Better Auth **admin plugin**: `user.role` (`user`/`admin`), ban/unban, admin-set password, role changes. No custom role column |
| D20 | Key check | "Test connection" lists the provider's models (no tokens spent) and offers them as default-model suggestions |
| D21 | Shared-word edits | Dictionary fields (gender, forms, translations, IPA) are editable only while no other user has the word (or by an admin). Notes/mnemonics are always private and editable |
| D22 | Generation transport | All AI output (API, browser, paste) is parsed by the same tolerant `core/import`. API calls use plain `generateText` + the parser (not provider-specific structured output), so every provider and free model behaves the same |
| D23 | Pictures | Optional picture per word from free photo search (Wikimedia Commons and Openverse, no key; Pexels with an optional server key) or the user's own upload. **Auto-picked in the background after saving** (on by default, a profile setting), changeable later. The shared default lives on the lexeme; each user can pick their own or hide it. Stored locally as resized WebP, never hotlinked. See §4.4 |

### Open questions (decide when we reach that phase)
- Q1. Should themes be shareable or public between users (a theme "library")? The schema leaves room (`visibility`), but there's no UI yet.
- Q2. Usage limits per user for server-paid AI, if you ever provide a shared key: probably not needed (BYOK only).
- Q3. A native mobile wrapper (Capacitor) later, or is the PWA enough?
- Q4. UI translation (i18n) into Portuguese/Polish: strings are centralized now, translations come later.

---

## 2. Architecture

```
┌──────────── Browser (PWA) ─────────────┐        ┌──────────── apps/api (Hono, Node 24) ────────────┐
│ React + TanStack Router/Query          │  HTTPS │ /api/auth/*      Better Auth (+ invite gate)     │
│ Hono RPC client (typed)                │◄──────►│ /api/settings    user prefs, AI credentials      │
│ Web Speech TTS                         │ cookie │ /api/themes      themes, proposals, tagging      │
│ WebLLM / Chrome AI (optional, local)   │        │ /api/generate    prompt, AI, paste/browser import│
│ Copy-prompt / paste-import UI          │        │ /api/review      SRS queue, grading              │
└────────────────────────────────────────┘        │ /api/lessons     exercises, scripts, drills      │
                                                  │ /api/tts         cloud TTS proxy + cache         │
                                                  │ packages/ai ──► Anthropic/OpenAI/DeepSeek/...    │
                                                  │ packages/db ──► SQLite file (/data)              │
                                                  └──────────────────────────────────────────────────┘
```

- In production, a single Node process serves `/api/*` and the static SPA build.
- **One ingestion path**: whatever the AI source is, the raw text or object goes through
  `core/import` (tolerant parser → zod validation → normalization → dedupe) before it is stored.
  The only difference is who calls the model: the server for API providers, the browser for
  local models, a human for copy-paste.

---

## 3. Data model (Drizzle / SQLite)

Auth tables (`user`, `session`, `account`, `verification`) follow Better Auth's schema; `user` also
carries the admin plugin's `role`, `banned`, `ban_reason`, `ban_expires`. App tables:

```
invite_codes        id, code (unique), created_by, max_uses, uses, expires_at, created_at
user_profiles       user_id PK, target_lang, native_lang,
                    default_word_count (30), default_ai_source, tts_provider, tts_voice,
                    daily_new_limit (20), daily_review_limit (200),
                    color_palette ('auto' | preset id, default 'auto'),
                    color_mode (system|light|dark, default 'system'),
                    auto_pictures (default true), created_at, updated_at
ai_credentials      id, user_id, provider (anthropic|openai|deepseek|google|openrouter|openai_compat),
                    label, base_url?, default_model, key_ciphertext, key_iv, key_tag, key_last4,
                    created_at, updated_at

lexemes             id, lang, lemma, normalized_lemma, pos, gender?, aspect?, aspect_pair_lemma?,
                    forms_json?, pronunciation?, frequency_rank?,
                    image_query? (English search phrase, '' = not picturable),
                    image_id? → lexeme_images (shared default), image_searched_at?, created_at
                    UNIQUE(lang, normalized_lemma, pos)
lexeme_images       id, lexeme_id, provider (openverse|pexels|upload), provider_id?, file_key,
                    width, height, title?, creator?, creator_url?, license?, license_url?,
                    source_url?, created_by?, created_at
                    UNIQUE(lexeme_id, provider, provider_id)
lexeme_translations id, lexeme_id, lang, text, sort
                    UNIQUE(lexeme_id, lang, text)
example_sentences   id, lexeme_id, lang, text, translation, translation_lang,
                    cloze_target (word form as it appears in the sentence), source (ai|user|import), created_at

themes              id, user_id, name, slug, description?, target_lang, native_lang,
                    visibility (private), created_at, updated_at
                    UNIQUE(user_id, slug)
theme_lexemes       theme_id, lexeme_id, position, added_at, generation_id?
                    PK(theme_id, lexeme_id)

user_lexemes        user_id, lexeme_id, status (untagged|unknown|recognize|known),
                    status_source (manual|derived), note?, mnemonic?,
                    image_id? (personal picture), image_hidden,
                    exposure_count, correct_count, incorrect_count, first_seen_at, last_seen_at
                    PK(user_id, lexeme_id)
cards               id, user_id, lexeme_id, direction (recognition|recall),
                    due, stability, difficulty, elapsed_days, scheduled_days,
                    reps, lapses, state, last_review, suspended
                    UNIQUE(user_id, lexeme_id, direction)
review_logs         id, card_id, user_id, rating (1-4), exercise_type, correct, response_ms,
                    answer_given?, reviewed_at, fsrs snapshot (state/due/stability before)
exposures           id, user_id, lexeme_id, context (flashcard|mcq|cloze|listening|drill|
                    sentence|roleplay|proposal), lesson_id?, at

ai_generations      id, user_id, kind (vocab_proposal|example_sentences|listening_script|
                    grammar_note|drill|sentence_grade|roleplay), source (api|browser|manual),
                    provider?, model?, prompt_version, prompt, raw_output, parsed_ok,
                    error?, tokens_in?, tokens_out?, created_at
lessons             id, user_id, theme_id, kind (listening|grammar|drill|sentence|roleplay),
                    title, content_json, generation_id?, created_at
lesson_lexemes      lesson_id, lexeme_id
tts_cache           hash (text+lang+provider+voice) PK, file_path, mime, bytes, created_at
```

Indexes: `cards(user_id, due)`, `user_lexemes(user_id, status)`, `theme_lexemes(lexeme_id)`,
`exposures(user_id, lexeme_id)`, `review_logs(user_id, reviewed_at)`.

---

## 4. Vocabulary generation & import

### 4.1 Proposal flow (UI)
1. **New theme** → name and optional description, word count (slider 5–100, default from settings),
   difficulty hint (A1–C1), and AI source (the provider list from settings, *Browser model*, or
   *Copy prompt*).
2. The prompt is built by `core/prompts/vocabProposal.ts` and contains the target/native language,
   count, CEFR level, the required output schema, and an *avoid list* (lemmas the user already
   has in this theme). The prompt asks for **JSON** (primary) and accepts CSV as a fallback.
3. Generation:
   - **API**: the server calls the provider with AI SDK structured output (`generateObject` / output
     schema) against the zod schema. Counts above 30 are split into batches of ~25 run in sequence,
     with the avoid list growing between batches.
   - **Browser**: WebLLM (e.g. Qwen2.5-3B / Llama-3.2-3B) or Chrome's `LanguageModel` runs the
     same prompt (in batches of 10), and the raw text is POSTed to `/api/generate/import`.
   - **Manual**: the UI shows the prompt with a *Copy* button. The user pastes the reply into a
     textarea → `/api/generate/import`.
4. **Review screen**: a list or one card at a time (mobile). Each row shows the lemma, translation,
   POS/gender and an example, with three big buttons: *Known* / *Recognize* / *Don't know* (keys
   1/2/3), plus *Edit* and *Discard*. Words already in the user's dictionary show a "already
   learning — linked" badge with their current status. Bulk actions: "mark remaining as …".
5. **Save** → upsert lexemes (dedupe), link `theme_lexemes`, upsert `user_lexemes`, and create or
   seed `cards` (see §5.2).

### 4.2 Import formats (documented in-app, accepted by `core/import`)
JSON (preferred):
```json
{ "words": [ {
  "lemma": "chleb", "pos": "noun", "gender": "m",
  "translations": ["bread"],
  "forms": { "gen_sg": "chleba", "nom_pl": "chleby" },
  "pronunciation": "xlɛp",
  "examples": [ { "text": "Kupiłem świeży chleb.", "translation": "I bought fresh bread.", "cloze": "chleb" } ],
  "notes": "Final -b devoices to [p]."
} ] }
```
CSV (header required; `;` or `,` auto-detected; quoted fields OK; `|` separates multi-values;
`forms` as `key=value|key=value`):
```
lemma;translation;pos;gender;aspect;aspect_pair;forms;pronunciation;example;example_translation;notes
chleb;bread;noun;m;;;gen_sg=chleba|nom_pl=chleby;xlɛp;Kupiłem świeży chleb.;I bought fresh bread.;
```
The parser is tolerant. It strips markdown code fences, leading prose and trailing commentary,
and fixes trailing commas. Every row is validated individually, invalid rows are reported with
the reason, and the valid rows still import.

### 4.3 AI provider layer (`packages/ai`)
- `ProviderId = anthropic | openai | deepseek | google | openrouter | openai_compat`.
- `getModel(userId, credentialId?, modelOverride?)` decrypts the key and returns an AI SDK
  `LanguageModel`.
- Settings page: add/test/delete credentials (*Test* runs a tiny call), choose the default model per
  provider, and a curated list of suggested models with an "enter any model id" fallback.
- Errors (bad key, rate limit, refusal, invalid JSON) are mapped to user-friendly messages, and
  the raw output is always stored in `ai_generations` so the user can retry parsing or edit it by hand.
- Rate limit AI endpoints per user (simple token bucket in memory, later SQLite).

### 4.4 Pictures (`apps/api/src/lib/pictures`)
- **Sources**, best first: Pexels when `PEXELS_API_KEY` is set, Wikimedia Commons (no key, about
  1 s, bitmap files only, the 500 px thumbnail is downloaded), then Openverse (no key, but often
  10–25 s for a new query and limited to about 20/min and 200/day per server). Auto-pick asks them
  in that order and stops at the first usable hit. The picker sends one request per provider
  (`/api/pictures/providers`, `?provider=`) and shows each provider's photos as they arrive.
- **Politeness**: Wikimedia refuses parallel bursts (429 with `Retry-After` of a few seconds), so its
  calls run one at a time. A short `Retry-After` (≤ 10 s) is waited out and retried once; otherwise
  the provider is skipped for as long as it asks (5 min without a header). Every request carries a
  `User-Agent`, with the optional `PICTURES_CONTACT` that Wikimedia asks API clients for. Uploads (any image sharp can read,
  ≤ 8 MB) are private to the uploader and never become the shared default.
- **Search phrase**: the vocab prompt (`vocab-proposal@4`) asks for 1–3 English words per word
  (`image_query`, "orange fruit", not a scene description: long phrases match nothing), or `none`
  for words that can't be pictured (adjectives like *dojrzały*, abstract verbs). For nouns the
  English (or first) translation is tried as well, and pasted lists without the column use only it.
- **Auto-pick**: `saveWords()` returns the lexeme ids, and the theme routes queue them
  (`pictures.enqueue`) when `user_profiles.auto_pictures` is on. A small background queue in the API
  process searches, downloads the top hit and stores it. A word is marked `image_searched_at` only
  when every provider answered. After a timeout, limit or outage it is retried once at the end of the
  queue (Openverse usually has the query cached by then), and otherwise left for later ("Find missing
  pictures" in the theme menu forces a retry). The theme page polls while `picturesPending > 0`.
- **Storage**: downloads go through `assertPublicUrl` with manual redirects (SSRF guard), are resized
  with sharp to a 480 px WebP + a 96 px thumbnail under `MEDIA_DIR`, and are served by
  `/api/media/:name` (auth, immutable cache, PWA runtime cache). Never hotlink provider URLs.
- **Who sees what** (`resolvePictures`): hidden → none, else the user's own choice, else the shared
  default on the lexeme. Choosing a search result replaces the shared default only while no other
  user has the word (or as admin), mirroring D21.
- **UI**: a 40 px thumbnail in each theme word row (first-letter tile fallback, pulsing while
  pending), a larger figure with the attribution line and *Change picture* when the row is
  expanded, and a picker dialog (search, upload, "No picture for this word"). On flashcards the
  picture shows on the recall front (native → target) and on the answer side, never on the
  recognition front, where it would give the answer away.
- Later: picture-based exercises in Phase 4 ("pick the picture" MCQ, "name what you see").

---

## 5. Learning engine

### 5.1 Cards & ratings
- Two cards per lexeme: **recognition** (see Polish → recall the meaning) and **recall** (see the
  meaning → produce Polish).
- Exercises map to FSRS ratings: wrong → `Again`, correct with hint or slow → `Hard`, correct →
  `Good`, correct and fast (under a threshold) or self-rated easy → `Easy`. Flashcards use explicit
  self-rating with 4 buttons.
- Recognition-type exercises (MCQ PL→native, listening comprehension) grade the **recognition**
  card. Production-type exercises (typing the Polish word, cloze, drills, sentence building) grade
  the **recall** card.

### 5.2 Tag seeding (`core/srs/seed.ts`)
| Tag | recognition card | recall card |
|-----|------------------|-------------|
| Don't know | new, due now | new, due after the recognition card's first success |
| Recognize | review state, stability ≈ 4d, due in 1–3d | new, due now |
| Known | review state, stability ≈ 30d, due in 20–40d (fuzzed) | review state, stability ≈ 10d, due in 7–14d |

### 5.3 Derived status (`core/srs/status.ts`)
- `known`: both cards in review state with stability ≥ 21d and no lapse in the last 3 reviews.
- `recognize`: the recognition card is stable (≥ 4d, the stability a "recognize" tag seeds) and the recall card is not.
- `unknown`: anything else, or two or more consecutive lapses.
- A manual tag change sets `status_source = manual` and re-seeds both cards from the new tag
  (no confirm dialog: the review history stays in `review_logs`).
- After each review the status only moves in the direction of the result (`core/srs/status.ts`):
  a success can raise it, a failure can lower it. A manual "known" isn't downgraded by an easy
  answer, and a manual "don't know" still climbs as the cards are learned.

### 5.4 Daily queue
`/api/review/queue?themeId=&limit=` returns due cards first (ordered by due date and retrievability),
then new cards up to `daily_new_limit`. The queue can be filtered by theme, or run across all themes.

### 5.5 Exposure tracking
Every rendered word in an exercise or script writes an `exposures` row (batched, async) and bumps
`user_lexemes.exposure_count`. The stats page shows exposures vs. reviews per word.

---

## 6. Exercises

| Type | Phase | AI needed? | Notes |
|------|-------|------------|-------|
| Flashcards | 3 | no | Flip animation, 4-button rating, swipe on mobile, TTS button, picture on the recall front and the answer side |
| Multiple choice | 4 | no | Distractors: same theme + same POS (+ same gender for nouns) first, then the global pool. Both directions, plus a picture variant (word → pick the picture, picture → pick the word) |
| Fill-in (cloze) | 4 | optional | Uses `example_sentences.cloze_target`. Lemma hint and word bank, or free typing. Answers are diacritic-tolerant with a warning. If a word has no sentences, it gets them from AI on demand (cached) |
| Listening scripts | 5 | yes (cached) | AI writes a short dialogue or monologue using N theme words at the user's level, with a transcript (hidden until revealed), comprehension MCQs and a word list. Playback uses Web Speech or cloud TTS per sentence, with speed control and per-speaker voices |
| Grammar notes | 5 | yes (cached) | Per-theme mini lesson ("Instrumental after *z*", "aspect pairs of the verbs in this theme") using examples from the user's words |
| Declension / conjugation drills | 5 | partly | Forms come from `lexemes.forms_json` (deterministic). Prompts like "kot → instrumental: Idę z ___". Missing forms are filled by AI and cached. Grades the recall card |
| Sentence building | 6 | no / optional | Scrambled words → order them (deterministic, from stored examples) |
| Translation | 6 | yes | Translate a short sentence. The AI grades it and returns corrections and an explanation (structured output) |
| AI role-play | 6 | yes | Themed chat scenario. System prompt restricts vocabulary to theme words at the user's level and asks the model to correct mistakes inline. Words used are logged as exposures. Streams over SSE |

Lesson builder (Phase 4+): "Start lesson on theme X" builds a 10–15 minute mix of due reviews +
new words + one or two exercise types, then shows a summary screen.

Other ideas for later: minimal-pair listening (sz/ś/ż/rz/cz/ć), typing/dictation, a "word of the day"
push notification (PWA), streaks/heatmap, and Anki CSV export.

---

## 7. Appearance: color palettes & light/dark mode

> Naming: in code this is **"appearance" / "palette"**, never "theme", because *theme* already
> means a vocabulary theme in this app.

### 7.1 Design tokens
- All UI colors are **semantic CSS variables** (shadcn/Tailwind v4 convention, OKLCH values):
  `--background`, `--foreground`, `--card`, `--muted`, `--primary`, `--primary-foreground`,
  `--accent`, `--ring`, `--border`, `--destructive`, plus app-specific tokens:
  `--status-unknown`, `--status-recognize`, `--status-known`, `--correct`, `--incorrect`,
  `--chart-1..5`, `--flashcard-front`, `--flashcard-back`.
- Components **never** use raw colors (`bg-red-500`, hex values). Only token utilities
  (`bg-primary`, `text-status-known`). Biome/grep check in CI to enforce it.
- Light/dark mode is set with `class="dark"` on `<html>` and the palette with `data-palette="pl"`.
  `system` mode follows `prefers-color-scheme` live, so it changes when the OS changes.

### 7.2 Presets (`packages/shared/src/appearance/palettes.ts`)
- Each preset is `{ id, label, languages: string[], light: Tokens, dark: Tokens }` in TypeScript.
  A build step generates `palettes.css` with one `[data-palette=…]` block per mode.
- Initial set (more can be added cheaply):

  | id | Inspired by | Primary / accent idea |
  |----|-------------|-----------------------|
  | `pl` | Polish | crimson red / warm white |
  | `pt` | Portuguese | deep green / red, gold accent |
  | `es` | Spanish | red / saffron yellow |
  | `de` | German | black-charcoal / red, gold accent |
  | `fr` | French | blue / red |
  | `it` | Italian | green / red |
  | `uk` | Ukrainian | blue / yellow |
  | `en` | English | navy / red |
  | `slate` | neutral (fallback) | slate / indigo |
  | `forest`, `ocean` | neutral | green / teal, blue / cyan |

- Flag colors are *inspiration*: they get toned down so they work as UI colors (e.g. Polish red
  is the primary and buttons, not a red background).
- Status colors (`unknown`/`recognize`/`known`) and `correct`/`incorrect` stay recognizable in
  every preset (e.g. on a red-primary palette, "incorrect" shifts hue or uses an icon + pattern).
  Status is never shown by color alone: there is always an icon or label too.

### 7.3 Resolution logic (`packages/shared/src/appearance/resolve.ts`, pure + unit-tested)
- `resolvePalette(profile)`: if `color_palette !== 'auto'` use it, otherwise find the preset whose
  `languages` include `target_lang`, falling back to `slate`.
- `resolveMode(color_mode, prefersDark)` → `light | dark`.

### 7.4 Persistence & first paint
- Source of truth: `user_profiles.color_palette` / `color_mode`, edited on the Settings page.
  The change applies **instantly** (optimistic update), then saves.
- To avoid a flash of the wrong colors on load, the last resolved palette and mode are cached in
  `localStorage` and applied by a tiny inline script in `index.html` before React mounts. The
  account value overwrites it once `/api/me` loads. Logged-out pages (login/register) use the
  cached appearance, or `system` + `slate` when there is none.
- Also update the PWA `theme-color` meta tag (light and dark values) to the active palette's
  primary or background, so the phone's status bar matches.

### 7.5 Settings UI
- An "Appearance" section with a light / dark / system segmented control and a palette grid of
  swatch cards. Each card shows a live mini-preview (button, flashcard, status chips) in the
  current mode. The first option is "Auto: follow learning language (currently 🇵🇱 Polish)".

### 7.6 Tests
- Vitest: every preset × mode passes WCAG AA (4.5:1 body text, 3:1 large text and UI parts) for
  key foreground/background pairs, and status colors are distinguishable from each other.
  Adding a bad preset fails CI.
- Playwright (later): visual snapshots of the dashboard and a flashcard for `pl` light/dark.

---

## 8. Auth & security
- Better Auth email/password with scrypt hashing (the library default), HTTP-only `SameSite=Lax`
  secure cookies, and session rotation.
- **Invite gate**: `POST /api/auth/sign-up/email` must carry the code in an `x-invite-code` header.
  A `user.create.before` hook consumes it atomically (`UPDATE … WHERE uses < max_uses AND not
  expired/revoked RETURNING`). Taken emails are rejected before the hook, so they don't use up
  invites. Admin-created users (`/admin/create-user`) are exempt. The first admin is bootstrapped by
  `pnpm db:seed` from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Admin page: create/revoke invite codes (with a shareable `/register?invite=` link), list users,
  enable/disable, make/remove admin, set a new password for a locked-out user.
- **SSRF guard** for user-supplied AI base URLs: http(s) only, no redirects, and private/loopback
  targets are rejected unless `ALLOW_PRIVATE_AI_BASE_URLS` (default: on in dev, off in prod).
- API keys are encrypted with AES-256-GCM and bound to the owner's user id (AAD), so a ciphertext
  copied to another row can't be decrypted.
- Rate limiting: auth endpoints (Better Auth built-in) and AI/import endpoints (per user).
- Every user-scoped query filters by `user_id` (helper `scoped(db, userId)`), with tests that check
  isolation between two users.
- `APP_ENCRYPTION_KEY` (32-byte base64) for API keys and `BETTER_AUTH_SECRET`. Both are required at
  boot, and the app refuses to start without them.
- Secure headers via Hono (`secureHeaders`), with a CSP that allows the WebLLM model CDN only when it is enabled.
- Password reset: admin sets a new password (above) for now. Self-service reset by email (SMTP) is optional later.

---

## 9. Phases & milestones

### Phase 0: Repository & tooling
- [x] `git init`, `.gitignore`
- [x] `.editorconfig`, `.nvmrc` (24), `.env.example`
- [x] pnpm workspace + Turborepo; `apps/web`, `apps/api`, `packages/{db,core,shared,ai}`
- [x] Shared `tsconfig.base.json` (strict, ESM, `moduleResolution: bundler`), Biome, Vitest
- [x] Vite + React + Tailwind v4 + shadcn/ui init, TanStack Router; Vite dev proxy `/api → :3180` (non-default ports: web 5180, api 3180)
- [x] Appearance foundation (§7): semantic token set, `palettes.ts` with `slate` + `pl` (light/dark), CSS generation, `<html>` class/`data-palette` switching, no-flash inline script, contrast test, CI check against raw color classes
- [x] Hono app with `/api/health`, typed RPC client wired into web
- [x] GitHub Actions CI: install → lint → typecheck → test → build
- [ ] Create the GitHub repo with `gh repo create alivocab --private --source . --push` (when you're ready)

**Done when** `pnpm dev` shows the web app calling `/api/health`, and CI is green.

### Phase 1: Database, auth, settings
- [x] Drizzle schema (§3), first migration (applied on API boot), `db:seed` (admin + invite). The sample theme moved to Phase 2, when themes exist
- [x] Better Auth + invite gate; login / register (with invite) / logout pages; route guards
- [x] Settings page: languages, default word count, daily limits, TTS voice picker (lists `speechSynthesis` voices for the target lang)
- [x] Settings → Appearance: light/dark/system control, palette grid with live previews, "Auto: follow learning language", saved to account; remaining presets (`pt es de fr it uk en forest ocean`); PWA `theme-color` sync
- [x] AI credentials CRUD with encryption + "Test connection"
- [x] Admin page: invite codes + user management (Better Auth admin plugin)
- [x] Tests: crypto round-trip, invite gate, user-isolation

**Done when** you can register with an invite, log in on phone and desktop, and save an encrypted API key.

### Phase 2: Themes, generation, import, tagging
- [x] Seed a sample theme for the dev admin
- [x] `core/prompts/vocabProposal` + snapshot tests
- [x] `core/import`: tolerant JSON/CSV parser + normalization + per-row validation report (heavily unit-tested with messy LLM outputs)
- [x] `packages/ai` provider registry (Anthropic, OpenAI, DeepSeek, Google, OpenRouter, OpenAI-compatible) + batching
- [x] Endpoints: create theme, generate (API), import (paste/browser), save tagged proposal
- [x] UI: new-theme wizard, AI-source picker, copy-prompt panel, paste box with live parse preview, review/tag screen (keyboard + mobile)
- [x] Browser AI: Chrome Prompt API detection, WebLLM with a model picker, download progress and a WebGPU capability check (lazy-loaded chunk)
- [x] Dedupe + multi-theme linking, "already learning" badges
- [x] Theme list + theme detail (words, status filter, edit word, add word manually)

**Done when** a 30-word theme can be created via each of: API key, Gemini free key, copy-paste, browser model, and the words are tagged and stored.

> Verified: copy-paste (JSON with prose, broken JSON, simple lists, Polish POS/gender labels), keyboard
> tagging, dedupe across themes and users, shared-field guard. API generation is covered by tests with
> a mocked model; **real provider keys and in-browser model downloads still need a manual run** with
> your own key and device.

### Phase 3: SRS + flashcards (**MVP**)
- [x] `ts-fsrs` integration, `core/srs/seed` + `status` (unit-tested)
- [x] Card creation on save, review queue endpoint, grade endpoint (writes review_log + exposure)
- [x] Flashcards UI (both directions, flip, 4 ratings, TTS button, swipe, shortcuts)
- [x] Dashboard: due today, new available, per-theme progress (unknown/recognize/known bars)
- [x] PWA manifest + icons + offline shell

**Done when** daily reviews work end-to-end on mobile and status changes based on performance.

> Notes: cards are backfilled for words saved before SRS existed. "Today" uses the client's time
> zone (`tzOffset`). In a session, "Again" comes back three cards later and other learning steps at the
> end. The offline shell caches the app only: reviewing offline (queued grades) is a later item.
> The service worker is only active in production builds.

### Pictures (between Phases 3 and 4, see §4.4)
- [x] `lexeme_images` + per-user choice/hide, Openverse + optional Pexels, sharp storage, media route
- [x] Prompt `image_query`, background auto-pick after save, "Find missing pictures"
- [x] Theme list thumbnails + expanded figure with attribution, picker (search/upload/hide)
- [x] Pictures on flashcards (recall front + answer side), PWA cache for pictures

### Phase 4: MCQ, cloze, lessons, stats
- [ ] Picture exercises: "pick the picture" MCQ and "name what you see" (words with a picture only)
- [ ] Distractor selection (`core/exercises/mcq`), cloze builder, answer checker (diacritic-aware, Levenshtein ≤ 1 typo tolerance → `Hard`)
- [ ] On-demand example-sentence generation (cached)
- [ ] Lesson builder + session summary
- [ ] Stats page: reviews/day, retention, exposures per word, streak

### Phase 5: Listening, grammar, drills
- [ ] Listening script generation (structured: speakers, lines, translation, questions) + player (Web Speech, per-line, speed)
- [ ] Optional cloud TTS provider + `tts_cache` on disk
- [ ] Grammar note generation per theme
- [ ] Declension/conjugation drills from `forms_json` (+ AI fill of missing forms)

### Phase 6: Sentence building, translation, role-play
- [ ] Scrambled-sentence exercise
- [ ] AI-graded translation (structured feedback)
- [ ] Role-play chat with streaming (SSE), vocabulary-constrained system prompt, inline corrections

### Phase 7: Hosting & operations
- [ ] Multi-stage Dockerfile (build → slim runtime), `docker-compose.yml` with Caddy (auto-HTTPS), `/data` volume
- [ ] Migrations on boot, health check, structured logs (pino)
- [ ] Backups: Litestream to S3-compatible storage or a nightly `sqlite3 .backup` cron
- [ ] Deployment guide in `docs/deploy.md`

---

## 10. Testing strategy
- **Unit (Vitest)**: `core` (parsers with a corpus of real messy LLM outputs, normalization, SRS seeding and status, distractors, answer checking) and `ai` (provider mapping with mocked models).
- **Integration**: Hono `app.request()` against an in-memory SQLite DB with migrations applied, covering auth, isolation, import and grading.
- **E2E (Playwright, Phase 3+)**: register → create theme via paste → tag → review flashcards. Runs on desktop and mobile viewports.

## 11. Risks & mitigations
| Risk | Mitigation |
|------|------------|
| LLMs return malformed or inconsistent JSON/CSV | Structured output where supported, a tolerant parser, per-row validation, stored raw output with a re-parse/edit UI |
| Small in-browser models produce poor Polish grammar (wrong gender/forms) | Label them "experimental" in the UI and let the user edit before saving. Suggest the copy-prompt flow for quality |
| Web Speech has no pl-PL voice on some devices | Detect voices, warn, and offer cloud TTS |
| Shared dictionary accumulates wrong data from one user's bad generation | Translations and examples carry the `source` and `generation_id`. Per-user edits are stored as user overrides if needed (revisit when multi-user is real) |
| Flag-colored palettes become garish or unreadable, especially in dark mode | Curated presets only, toned-down flag hues, automated WCAG AA contrast tests per preset × mode, status never conveyed by color alone |
| SQLite write contention | WAL mode, a single API process, short transactions. Fine for a small user base |

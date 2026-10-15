# Changelog

All notable changes to AliVocab. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the app uses [Semantic Versioning](https://semver.org/) for the whole product (see PLAN.md §12).

## [1.1.0] - 2026-10-15

### Added
- **Several learning languages.** Learn more than one language side by side: switch from the
  language menu in the header, add, remove and bring back languages in Settings → Languages.
  Each language has its own themes, reviews, daily limits, translation language and voice.
- New themes and word proposals can be made in any of your languages (a language picker in the
  new-theme wizard when you have more than one).
- `/api/languages` (list, add, update, archive) and an optional `lang` on the queue, summary,
  lessons, stats and theme list.
- The home greeting and the "auto" color palette follow the language you are learning.

### Changed
- Home, Review, Lessons, Themes and Stats show the language you are learning now. Learners who
  switched languages in 1.0 find their older themes under that language in the language menu.
- Daily new-word and review limits count per language; the streak still counts every language.
- Choosing a new voice provider starts every language on that provider's default voice.
- Settings → Learning keeps only the settings shared by all languages.

### Upgrade notes
- Migrations `0005` and `0006` run on start: they add `user_languages` and fill it from each
  learner's profile, themes and words. Nothing to do by hand.
- Rolling back to 1.0.0 is possible: 1.1 keeps the old profile columns up to date. They are
  removed in 1.2.0, after which 1.0 can no longer run on the database.
- `APP_VERSION` now comes from `git describe --tags --always` (docs/deploy.md).

## [1.0.0] - 2026-10-13

First release: Phases 0–7 of PLAN.md. Themed vocabulary from AI (API keys, in-browser models or
copy-paste), tagging, FSRS flashcards, lessons (multiple choice, fill-in, typing, drills,
sentence building, translation), listening scripts, grammar notes, AI role-play, pictures, cloud
voices, stats, invite-only accounts, and a Docker image with Caddy, health check and nightly
backups.

[1.1.0]: https://github.com/dedefelrodrigues/alivocab/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dedefelrodrigues/alivocab/releases/tag/v1.0.0

-- Several learning languages (PLAN.md D31). Every learner gets a row for the language their
-- profile is set to, with the profile's translation language, limits and voice.
INSERT INTO `user_languages` (`user_id`, `lang`, `native_lang`, `daily_new_limit`, `daily_review_limit`, `tts_voice`, `created_at`, `updated_at`)
SELECT `user_id`, `target_lang`, `native_lang`, `daily_new_limit`, `daily_review_limit`, `tts_voice`, `created_at`, `updated_at`
FROM `user_profiles`;
--> statement-breakpoint
-- Languages of older themes (from before the learner switched), translated into the language of
-- their most recently updated theme, since that is what their stored translations are in.
INSERT OR IGNORE INTO `user_languages` (`user_id`, `lang`, `native_lang`, `daily_new_limit`, `daily_review_limit`, `tts_voice`, `created_at`, `updated_at`)
SELECT
  t.`user_id`,
  t.`target_lang`,
  (SELECT t2.`native_lang` FROM `themes` t2
    WHERE t2.`user_id` = t.`user_id` AND t2.`target_lang` = t.`target_lang`
    ORDER BY t2.`updated_at` DESC LIMIT 1),
  COALESCE(p.`daily_new_limit`, 20),
  COALESCE(p.`daily_review_limit`, 200),
  p.`tts_voice`,
  MIN(t.`created_at`),
  MAX(t.`updated_at`)
FROM `themes` t
LEFT JOIN `user_profiles` p ON p.`user_id` = t.`user_id`
GROUP BY t.`user_id`, t.`target_lang`;
--> statement-breakpoint
-- Languages left only in the learner's words (their themes were deleted, the progress was kept).
INSERT OR IGNORE INTO `user_languages` (`user_id`, `lang`, `native_lang`, `daily_new_limit`, `daily_review_limit`, `tts_voice`, `created_at`, `updated_at`)
SELECT
  ul.`user_id`,
  l.`lang`,
  COALESCE(p.`native_lang`, 'en'),
  COALESCE(p.`daily_new_limit`, 20),
  COALESCE(p.`daily_review_limit`, 200),
  p.`tts_voice`,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `user_lexemes` ul
JOIN `lexemes` l ON l.`id` = ul.`lexeme_id`
LEFT JOIN `user_profiles` p ON p.`user_id` = ul.`user_id`
GROUP BY ul.`user_id`, l.`lang`;

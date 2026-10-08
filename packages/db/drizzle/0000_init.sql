CREATE TABLE `ai_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`base_url` text,
	`default_model` text,
	`key_ciphertext` text NOT NULL,
	`key_iv` text NOT NULL,
	`key_tag` text NOT NULL,
	`key_last4` text NOT NULL,
	`last_tested_at` integer,
	`last_test_ok` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_credentials_user_idx` ON `ai_credentials` (`user_id`);--> statement-breakpoint
CREATE TABLE `ai_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`provider` text,
	`model` text,
	`prompt_version` text NOT NULL,
	`prompt` text NOT NULL,
	`raw_output` text,
	`parsed_ok` integer DEFAULT false NOT NULL,
	`error` text,
	`tokens_in` integer,
	`tokens_out` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_generations_user_idx` ON `ai_generations` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lexeme_id` text NOT NULL,
	`direction` text NOT NULL,
	`due` integer NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`elapsed_days` real DEFAULT 0 NOT NULL,
	`scheduled_days` real DEFAULT 0 NOT NULL,
	`learning_steps` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`state` integer DEFAULT 0 NOT NULL,
	`last_review` integer,
	`suspended` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_user_lexeme_dir_uq` ON `cards` (`user_id`,`lexeme_id`,`direction`);--> statement-breakpoint
CREATE INDEX `cards_user_due_idx` ON `cards` (`user_id`,`due`);--> statement-breakpoint
CREATE TABLE `example_sentences` (
	`id` text PRIMARY KEY NOT NULL,
	`lexeme_id` text NOT NULL,
	`lang` text NOT NULL,
	`text` text NOT NULL,
	`translation` text,
	`translation_lang` text,
	`cloze_target` text,
	`source` text NOT NULL,
	`generation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `ai_generations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `example_sentences_lexeme_idx` ON `example_sentences` (`lexeme_id`);--> statement-breakpoint
CREATE TABLE `exposures` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lexeme_id` text NOT NULL,
	`context` text NOT NULL,
	`lesson_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `exposures_user_lexeme_idx` ON `exposures` (`user_id`,`lexeme_id`);--> statement-breakpoint
CREATE TABLE `invite_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`note` text,
	`created_by` text,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_codes_code_unique` ON `invite_codes` (`code`);--> statement-breakpoint
CREATE TABLE `lesson_lexemes` (
	`lesson_id` text NOT NULL,
	`lexeme_id` text NOT NULL,
	PRIMARY KEY(`lesson_id`, `lexeme_id`),
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`theme_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content_json` text NOT NULL,
	`generation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `ai_generations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `lessons_user_theme_idx` ON `lessons` (`user_id`,`theme_id`);--> statement-breakpoint
CREATE TABLE `lexeme_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`lexeme_id` text NOT NULL,
	`lang` text NOT NULL,
	`text` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lexeme_translations_uq` ON `lexeme_translations` (`lexeme_id`,`lang`,`text`);--> statement-breakpoint
CREATE TABLE `lexemes` (
	`id` text PRIMARY KEY NOT NULL,
	`lang` text NOT NULL,
	`lemma` text NOT NULL,
	`normalized_lemma` text NOT NULL,
	`pos` text NOT NULL,
	`gender` text,
	`aspect` text,
	`aspect_pair_lemma` text,
	`forms_json` text,
	`pronunciation` text,
	`frequency_rank` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lexemes_lang_lemma_pos_uq` ON `lexemes` (`lang`,`normalized_lemma`,`pos`);--> statement-breakpoint
CREATE TABLE `review_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`user_id` text NOT NULL,
	`rating` integer NOT NULL,
	`exercise_type` text NOT NULL,
	`correct` integer NOT NULL,
	`response_ms` integer,
	`answer_given` text,
	`state_before` integer NOT NULL,
	`stability_before` real NOT NULL,
	`due_before` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_logs_user_time_idx` ON `review_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `theme_lexemes` (
	`theme_id` text NOT NULL,
	`lexeme_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`generation_id` text,
	PRIMARY KEY(`theme_id`, `lexeme_id`),
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `ai_generations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `theme_lexemes_lexeme_idx` ON `theme_lexemes` (`lexeme_id`);--> statement-breakpoint
CREATE TABLE `themes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`target_lang` text NOT NULL,
	`native_lang` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `themes_user_slug_uq` ON `themes` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `tts_cache` (
	`hash` text PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_lexemes` (
	`user_id` text NOT NULL,
	`lexeme_id` text NOT NULL,
	`status` text DEFAULT 'untagged' NOT NULL,
	`status_source` text DEFAULT 'manual' NOT NULL,
	`note` text,
	`mnemonic` text,
	`exposure_count` integer DEFAULT 0 NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`incorrect_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer,
	`last_seen_at` integer,
	PRIMARY KEY(`user_id`, `lexeme_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_lexemes_user_status_idx` ON `user_lexemes` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`target_lang` text DEFAULT 'pl' NOT NULL,
	`native_lang` text DEFAULT 'en' NOT NULL,
	`default_word_count` integer DEFAULT 30 NOT NULL,
	`default_ai_source` text DEFAULT 'manual' NOT NULL,
	`tts_provider` text DEFAULT 'browser' NOT NULL,
	`tts_voice` text,
	`daily_new_limit` integer DEFAULT 20 NOT NULL,
	`daily_review_limit` integer DEFAULT 200 NOT NULL,
	`color_palette` text DEFAULT 'auto' NOT NULL,
	`color_mode` text DEFAULT 'system' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`ban_expires` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
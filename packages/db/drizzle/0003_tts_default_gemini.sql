PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`target_lang` text DEFAULT 'pl' NOT NULL,
	`native_lang` text DEFAULT 'en' NOT NULL,
	`default_word_count` integer DEFAULT 30 NOT NULL,
	`default_ai_source` text DEFAULT 'manual' NOT NULL,
	`tts_provider` text DEFAULT 'google' NOT NULL,
	`tts_voice` text,
	`daily_new_limit` integer DEFAULT 20 NOT NULL,
	`daily_review_limit` integer DEFAULT 200 NOT NULL,
	`color_palette` text DEFAULT 'auto' NOT NULL,
	`color_mode` text DEFAULT 'system' NOT NULL,
	`auto_pictures` integer DEFAULT true NOT NULL,
	`advanced_mode` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_profiles`("user_id", "target_lang", "native_lang", "default_word_count", "default_ai_source", "tts_provider", "tts_voice", "daily_new_limit", "daily_review_limit", "color_palette", "color_mode", "auto_pictures", "advanced_mode", "created_at", "updated_at") SELECT "user_id", "target_lang", "native_lang", "default_word_count", "default_ai_source", "tts_provider", "tts_voice", "daily_new_limit", "daily_review_limit", "color_palette", "color_mode", "auto_pictures", "advanced_mode", "created_at", "updated_at" FROM `user_profiles`;--> statement-breakpoint
DROP TABLE `user_profiles`;--> statement-breakpoint
ALTER TABLE `__new_user_profiles` RENAME TO `user_profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
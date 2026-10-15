CREATE TABLE `user_languages` (
	`user_id` text NOT NULL,
	`lang` text NOT NULL,
	`native_lang` text NOT NULL,
	`daily_new_limit` integer DEFAULT 20 NOT NULL,
	`daily_review_limit` integer DEFAULT 200 NOT NULL,
	`tts_voice` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `lang`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

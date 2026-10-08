CREATE TABLE `lexeme_images` (
	`id` text PRIMARY KEY NOT NULL,
	`lexeme_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text,
	`file_key` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`title` text,
	`creator` text,
	`creator_url` text,
	`license` text,
	`license_url` text,
	`source_url` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `lexeme_images_lexeme_idx` ON `lexeme_images` (`lexeme_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lexeme_images_provider_uq` ON `lexeme_images` (`lexeme_id`,`provider`,`provider_id`);--> statement-breakpoint
ALTER TABLE `lexemes` ADD `image_query` text;--> statement-breakpoint
ALTER TABLE `lexemes` ADD `image_id` text REFERENCES lexeme_images(id);--> statement-breakpoint
ALTER TABLE `lexemes` ADD `image_searched_at` integer;--> statement-breakpoint
ALTER TABLE `user_lexemes` ADD `image_id` text REFERENCES lexeme_images(id);--> statement-breakpoint
ALTER TABLE `user_lexemes` ADD `image_hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `auto_pictures` integer DEFAULT true NOT NULL;
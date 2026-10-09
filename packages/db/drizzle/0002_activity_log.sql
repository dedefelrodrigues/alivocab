CREATE TABLE `app_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`level` text NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`status` integer,
	`duration_ms` integer,
	`details_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_logs_user_idx` ON `app_logs` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `advanced_mode` integer DEFAULT false NOT NULL;
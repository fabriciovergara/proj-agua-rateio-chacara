CREATE TABLE `app_password` (
	`id` integer PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "app_password_singleton" CHECK("app_password"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`credentials` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);

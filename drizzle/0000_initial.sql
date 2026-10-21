CREATE TABLE `bank_account` (
	`id` integer PRIMARY KEY NOT NULL,
	`bank_name` text,
	`bank_code` text,
	`branch` text,
	`account_number` text,
	`account_type` text,
	`pix_key_type` text,
	`pix_key` text,
	`holder_name` text,
	`holder_city` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "bank_account_singleton" CHECK("bank_account"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `owners` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`document` text,
	`phone` text,
	`email` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`owner_id` integer,
	`street` text,
	`number` text,
	`district` text,
	`city` text,
	`state` text,
	`zip_code` text,
	`meter_number` text,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `properties_owner_idx` ON `properties` (`owner_id`);--> statement-breakpoint
CREATE TABLE `readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`previous_reading` integer NOT NULL,
	`current_reading` integer NOT NULL,
	`kwh_price_micros` integer NOT NULL,
	`reserve_fund_cents` integer NOT NULL,
	`paid` integer DEFAULT false NOT NULL,
	`paid_at` text,
	`reading_date` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "readings_month_range" CHECK("readings"."month" between 1 and 12),
	CONSTRAINT "readings_consumption_non_negative" CHECK("readings"."current_reading" >= "readings"."previous_reading")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `readings_property_period_uq` ON `readings` (`property_id`,`year`,`month`);--> statement-breakpoint
CREATE INDEX `readings_period_idx` ON `readings` (`year`,`month`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`group_name` text,
	`kwh_price_micros` integer,
	`reserve_fund_cents` integer,
	`due_day` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "settings_singleton" CHECK("settings"."id" = 1)
);

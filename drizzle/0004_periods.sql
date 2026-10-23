-- Billing periods replace calendar months. A period has its own dates, the
-- pump's electricity bill (split among the chácaras by the m³ each one used)
-- and the reserve fund. Each month that had readings or values becomes a
-- period ending on day 10, when the meters were read in the old app too,
-- and starting where the period before ended when that was at most three
-- months earlier (the old app also billed two or three months at once).
CREATE TABLE `periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`energy_bill_cents` integer,
	`reserve_fund_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "periods_dates" CHECK("periods"."start_date" < "periods"."end_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `periods_start_uq` ON `periods` (`start_date`);--> statement-breakpoint
-- The bill is what the month's readings charged for energy (their kWh price
-- × consumption, as the old screens did), so its split charges the same.
WITH `months` AS (
	SELECT `year`, `month` FROM `readings`
	UNION
	SELECT `year`, `month` FROM `month_rates`
), `ranges` AS (
	SELECT `year`, `month`,
		printf('%04d-%02d-10', `year`, `month`) AS `end_date`,
		LAG(printf('%04d-%02d-10', `year`, `month`)) OVER (ORDER BY `year`, `month`) AS `previous_end`
	FROM `months`
)
INSERT INTO `periods` (`start_date`, `end_date`, `energy_bill_cents`, `reserve_fund_cents`)
SELECT
	CASE
		WHEN `previous_end` >= date(`end_date`, '-3 months') THEN `previous_end`
		ELSE date(`end_date`, '-1 month')
	END,
	`end_date`,
	(
		SELECT sum(((r.`current_reading` - r.`previous_reading`) * r.`kwh_price_micros` + 5000) / 10000)
		FROM `readings` r
		WHERE r.`year` = `ranges`.`year` AND r.`month` = `ranges`.`month`
	),
	coalesce(
		(
			SELECT m.`reserve_fund_cents` FROM `month_rates` m
			WHERE m.`year` = `ranges`.`year` AND m.`month` = `ranges`.`month`
		),
		(
			SELECT r.`reserve_fund_cents` FROM `readings` r
			WHERE r.`year` = `ranges`.`year` AND r.`month` = `ranges`.`month`
			GROUP BY r.`reserve_fund_cents`
			ORDER BY count(*) DESC, r.`reserve_fund_cents` DESC
			LIMIT 1
		),
		0
	)
FROM `ranges`
ORDER BY `end_date`;
--> statement-breakpoint
-- Readings keep what they charged. Dates follow the period: a reading starts
-- when the chácara's previous one ended, so a chácara skipped in a month
-- spans both, as in the old app ("10 Set 08 / 10 Dez 08"). The checks name
-- bare columns: SQLite can't rename a table whose checks name the table.
CREATE TABLE `__new_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`period_id` integer NOT NULL,
	`previous_reading` integer NOT NULL,
	`current_reading` integer NOT NULL,
	`start_date` text,
	`end_date` text,
	`energy_cents` integer,
	`reserve_fund_cents` integer NOT NULL,
	`paid` integer DEFAULT false NOT NULL,
	`paid_at` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "readings_consumption_non_negative" CHECK("current_reading" >= "previous_reading"),
	CONSTRAINT "readings_paid_has_amount" CHECK("paid" = 0 or "energy_cents" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_readings` (`id`, `property_id`, `period_id`, `previous_reading`, `current_reading`, `energy_cents`, `reserve_fund_cents`, `paid`, `paid_at`, `notes`, `created_at`, `updated_at`)
SELECT r.`id`, r.`property_id`, p.`id`, r.`previous_reading`, r.`current_reading`,
	((r.`current_reading` - r.`previous_reading`) * r.`kwh_price_micros` + 5000) / 10000,
	r.`reserve_fund_cents`, r.`paid`, r.`paid_at`, r.`notes`, r.`created_at`, r.`updated_at`
FROM `readings` r
JOIN `periods` p ON p.`end_date` = printf('%04d-%02d-10', r.`year`, r.`month`);
--> statement-breakpoint
DROP TABLE `readings`;--> statement-breakpoint
ALTER TABLE `__new_readings` RENAME TO `readings`;--> statement-breakpoint
CREATE UNIQUE INDEX `readings_property_period_uq` ON `readings` (`property_id`,`period_id`);--> statement-breakpoint
CREATE INDEX `readings_period_idx` ON `readings` (`period_id`);--> statement-breakpoint
DROP TABLE `month_rates`;

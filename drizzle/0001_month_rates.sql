CREATE TABLE `month_rates` (
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`kwh_price_micros` integer NOT NULL,
	`reserve_fund_cents` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`year`, `month`),
	CONSTRAINT "month_rates_month_range" CHECK("month_rates"."month" between 1 and 12)
);
--> statement-breakpoint
-- Each month with readings gets the price and fund most of its readings used.
INSERT INTO `month_rates` (`year`, `month`, `kwh_price_micros`, `reserve_fund_cents`)
SELECT `year`, `month`, `kwh_price_micros`, `reserve_fund_cents`
FROM (
	SELECT `year`, `month`, `kwh_price_micros`, `reserve_fund_cents`,
		ROW_NUMBER() OVER (
			PARTITION BY `year`, `month`
			ORDER BY COUNT(*) DESC, `kwh_price_micros` DESC
		) AS `rank`
	FROM `readings`
	GROUP BY `year`, `month`, `kwh_price_micros`, `reserve_fund_cents`
)
WHERE `rank` = 1;
--> statement-breakpoint
-- The old defaults become the values of the current month (Brazil, UTC-3).
INSERT INTO `month_rates` (`year`, `month`, `kwh_price_micros`, `reserve_fund_cents`)
SELECT
	CAST(strftime('%Y', 'now', '-3 hours') AS INTEGER),
	CAST(strftime('%m', 'now', '-3 hours') AS INTEGER),
	`kwh_price_micros`,
	`reserve_fund_cents`
FROM `settings`
WHERE `id` = 1 AND `kwh_price_micros` IS NOT NULL AND `reserve_fund_cents` IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `kwh_price_micros`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `reserve_fund_cents`;

-- Readings of the meter of the water tank (caixa d'água) that supplies the
-- chácaras, on any day, to compare with the sum of the chácaras' meters.
-- The reading is in liters (m³ × 1000); `meter_replaced`: a new meter since
-- the reading before (the water used in between is unknown).
CREATE TABLE `tank_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`reading_liters` integer NOT NULL,
	`meter_replaced` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "tank_readings_reading_non_negative" CHECK("tank_readings"."reading_liters" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tank_readings_date_uq` ON `tank_readings` (`date`);

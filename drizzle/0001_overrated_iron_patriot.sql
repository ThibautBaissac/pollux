CREATE TABLE `recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);

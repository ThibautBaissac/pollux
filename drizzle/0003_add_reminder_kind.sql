ALTER TABLE `reminders` ADD `kind` text DEFAULT 'notify' NOT NULL;--> statement-breakpoint
ALTER TABLE `reminders` ADD `running_since` integer;
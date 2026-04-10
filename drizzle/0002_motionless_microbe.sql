CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`schedule_type` text NOT NULL,
	`cron_expr` text,
	`scheduled_at` integer,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`conversation_id` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);

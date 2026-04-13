CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`source_id` text,
	`fired_at` integer NOT NULL,
	`summary` text NOT NULL,
	`conversation_id` text,
	`message_id` text,
	`read_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `executions_fired_at_idx` ON `executions` (`fired_at` DESC);
--> statement-breakpoint
CREATE INDEX `executions_unread_fired_at_idx` ON `executions` (`read_at`, `fired_at` DESC);

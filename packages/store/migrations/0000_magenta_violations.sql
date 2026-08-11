CREATE TABLE `agent_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text,
	`engine` text NOT NULL,
	`task_kind` text NOT NULL,
	`prompt_path` text,
	`result_path` text,
	`tokens_in` integer,
	`tokens_out` integer,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`session_ref` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_tasks_kind` ON `agent_tasks` (`task_kind`);--> statement-breakpoint
CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`source_root` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conformance_gaps` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `coverage_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`at` integer NOT NULL,
	`states_total` integer NOT NULL,
	`states_covered_by_tests` integer NOT NULL,
	`transitions_total` integer NOT NULL,
	`transitions_covered` integer NOT NULL,
	`flaky_test_count` integer NOT NULL,
	`avg_selector_score` real NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `design_components` (
	`id` text PRIMARY KEY NOT NULL,
	`screen_id` text NOT NULL,
	`label` text NOT NULL,
	`role` text,
	`matched_element_id` text,
	FOREIGN KEY (`screen_id`) REFERENCES `design_screens`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `design_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`screen_ids_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `design_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `design_screens` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`image_path` text,
	`figma_node_id` text,
	`matched_page_state_id` text,
	`match_confidence` real,
	FOREIGN KEY (`source_id`) REFERENCES `design_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_page_state_id`) REFERENCES `page_states`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `design_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	`ingested_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `elements` (
	`id` text PRIMARY KEY NOT NULL,
	`state_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`test_id` text,
	`text` text,
	`tag_name` text,
	`bounds_json` text,
	`source_component_id` text,
	FOREIGN KEY (`state_id`) REFERENCES `page_states`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `elements_state` ON `elements` (`state_id`);--> statement-breakpoint
CREATE INDEX `elements_fingerprint` ON `elements` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `failures` (
	`id` text PRIMARY KEY NOT NULL,
	`test_result_id` text NOT NULL,
	`classification` text NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`triaged_by_task_id` text,
	FOREIGN KEY (`test_result_id`) REFERENCES `test_results`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `flows` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`state_ids_json` text DEFAULT '[]' NOT NULL,
	`transition_ids_json` text DEFAULT '[]' NOT NULL,
	`importance_score` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `healing_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`failure_id` text NOT NULL,
	`action` text NOT NULL,
	`diff_json` text,
	`rerun_result_id` text,
	`outcome` text,
	FOREIGN KEY (`failure_id`) REFERENCES `failures`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `issue_events` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`event` text NOT NULL,
	`run_id` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`repro_steps_json` text DEFAULT '[]' NOT NULL,
	`severity` text DEFAULT 'major' NOT NULL,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`first_seen_run_id` text,
	`last_seen_run_id` text,
	`external_ref` text,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_fingerprint` ON `issues` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `issues_app_status` ON `issues` (`app_id`,`status`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`app_id` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress_json` text,
	`started_at` integer,
	`finished_at` integer,
	`error` text,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `learnings` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text,
	`scope` text NOT NULL,
	`scope_ref` text,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_by_task_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `learnings_scope` ON `learnings` (`app_id`,`scope`,`kind`);--> statement-breakpoint
CREATE TABLE `page_states` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`state_hash` text NOT NULL,
	`url` text NOT NULL,
	`aria_digest` text NOT NULL,
	`snapshot_path` text NOT NULL,
	`screenshot_path` text,
	`discovered_via` text,
	`visit_count` integer DEFAULT 1 NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_states_hash` ON `page_states` (`state_hash`);--> statement-breakpoint
CREATE INDEX `page_states_page` ON `page_states` (`page_id`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`url_pattern` text NOT NULL,
	`title` text,
	`first_seen_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_app_pattern` ON `pages` (`app_id`,`url_pattern`);--> statement-breakpoint
CREATE TABLE `requirement_coverage` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`test_case_draft_id` text NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `req_coverage_pair` ON `requirement_coverage` (`requirement_id`,`test_case_draft_id`);--> statement-breakpoint
CREATE TABLE `requirement_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`path` text NOT NULL,
	`content_hash` text NOT NULL,
	`parsed_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`req_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`acceptance_criteria_json` text DEFAULT '[]' NOT NULL,
	`priority` text NOT NULL,
	`ui_relevant` integer DEFAULT true NOT NULL,
	`linked_page_ids_json` text DEFAULT '[]' NOT NULL,
	`linked_flow_ids_json` text DEFAULT '[]' NOT NULL,
	`source_section` text,
	FOREIGN KEY (`doc_id`) REFERENCES `requirement_docs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirements_doc_req` ON `requirements` (`doc_id`,`req_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`trigger` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`playwright_version` text,
	`git_sha` text,
	`summary_json` text,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `selectors` (
	`id` text PRIMARY KEY NOT NULL,
	`element_id` text NOT NULL,
	`strategy` text NOT NULL,
	`value` text NOT NULL,
	`score` real NOT NULL,
	`verified_at` integer,
	`broken_count` integer DEFAULT 0 NOT NULL,
	`healed_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `selectors_element` ON `selectors` (`element_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`path` text NOT NULL,
	`triggers_json` text DEFAULT '{}' NOT NULL,
	`origin` text DEFAULT 'built-in' NOT NULL,
	`app_id` text,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`success_rate` real DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_name_app` ON `skills` (`name`,`app_id`);--> statement-breakpoint
CREATE TABLE `source_components` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`file_path` text NOT NULL,
	`export_name` text NOT NULL,
	`framework` text NOT NULL,
	`test_ids_json` text DEFAULT '[]' NOT NULL,
	`class_names_json` text DEFAULT '[]' NOT NULL,
	`route_path` text,
	`props_summary` text,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `test_case_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`title` text NOT NULL,
	`priority` text DEFAULT 'should' NOT NULL,
	`preconditions` text,
	`steps_json` text NOT NULL,
	`expected_results` text NOT NULL,
	`coverage_refs_json` text DEFAULT '{}' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`reviewer_comments` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`markdown_path` text,
	`content_hash` text,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `drafts_app_status` ON `test_case_drafts` (`app_id`,`status`);--> statement-breakpoint
CREATE TABLE `test_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`draft_id` text,
	`draft_version` integer,
	`flow_id` text,
	`spec_path` text NOT NULL,
	`page_object_paths_json` text DEFAULT '[]' NOT NULL,
	`generated_by_task_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`draft_id`) REFERENCES `test_case_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`flow_id`) REFERENCES `flows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `test_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`test_case_id` text NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`trace_path` text,
	`video_path` text,
	`error_message` text,
	`error_stack` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `results_run` ON `test_results` (`run_id`);--> statement-breakpoint
CREATE TABLE `transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`from_state_id` text NOT NULL,
	`to_state_id` text,
	`action_type` text NOT NULL,
	`element_id` text,
	`input_value_class` text,
	`destructive` integer DEFAULT false NOT NULL,
	`executed` integer DEFAULT false NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_state_id`) REFERENCES `page_states`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_state_id`) REFERENCES `page_states`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transitions_from` ON `transitions` (`from_state_id`);--> statement-breakpoint
CREATE INDEX `transitions_app` ON `transitions` (`app_id`);
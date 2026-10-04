CREATE TABLE "discovery_daily_budget" (
	"day" date PRIMARY KEY NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "discovery_daily_cap" CHECK ("discovery_daily_budget"."processed" between 0 and 30)
);
--> statement-breakpoint
CREATE TABLE "discovery_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_query" text NOT NULL,
	"original_query" text NOT NULL,
	"first_requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"next_eligible_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"latest_result_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "discovery_query_lengths" CHECK (length("discovery_queries"."normalized_query") between 3 and 80 and length("discovery_queries"."original_query") between 1 and 240),
	CONSTRAINT "discovery_counts" CHECK ("discovery_queries"."request_count" > 0 and "discovery_queries"."latest_result_count" between 0 and 30),
	CONSTRAINT "discovery_status" CHECK ("discovery_queries"."status" in ('pending','processing','completed','no_results','partial','failed')),
	CONSTRAINT "discovery_times" CHECK ("discovery_queries"."last_requested_at" >= "discovery_queries"."first_requested_at" and ("discovery_queries"."last_attempted_at" is null or "discovery_queries"."next_eligible_at" >= "discovery_queries"."last_attempted_at" + interval '24 hours'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_query_identity" ON "discovery_queries" USING btree ("normalized_query");--> statement-breakpoint
CREATE INDEX "discovery_eligibility" ON "discovery_queries" USING btree ("next_eligible_at");
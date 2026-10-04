ALTER TABLE "retailer_listings" ADD COLUMN "first_seen_via" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD COLUMN "discovery_query_id" uuid;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD COLUMN "last_category_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD COLUMN "last_targeted_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD COLUMN "targeted_status" text;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD CONSTRAINT "retailer_listings_discovery_query_id_discovery_queries_id_fk" FOREIGN KEY ("discovery_query_id") REFERENCES "public"."discovery_queries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD CONSTRAINT "listing_origin" CHECK ("retailer_listings"."first_seen_via" in ('unknown','category','discovery'));--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD CONSTRAINT "listing_targeted_status" CHECK ("retailer_listings"."targeted_status" is null or "retailer_listings"."targeted_status" in ('observed','unavailable','not-found','failed'));
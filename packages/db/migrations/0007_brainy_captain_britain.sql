ALTER TABLE "retailer_listings" ADD COLUMN "availability_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD COLUMN "exact_missing_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD COLUMN "last_exact_missing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD CONSTRAINT "listing_missing_count" CHECK ("retailer_listings"."exact_missing_count" >= 0);--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD CONSTRAINT "listing_availability_evidence" CHECK ("retailer_listings"."availability_verified_at" is null or "retailer_listings"."available" is not null);
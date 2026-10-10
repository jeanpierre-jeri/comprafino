CREATE TABLE "catalog_source_listings" (
	"source_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	CONSTRAINT "catalog_source_listings_source_id_listing_id_pk" PRIMARY KEY("source_id","listing_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" text NOT NULL,
	"source_key" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_eligible_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"requested_at" timestamp with time zone,
	"last_attempted_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"pages_observed" integer DEFAULT 0 NOT NULL,
	"products_observed" integer DEFAULT 0 NOT NULL,
	"cycle_products" integer DEFAULT 0 NOT NULL,
	"cycle_capacity_skips" integer DEFAULT 0 NOT NULL,
	"last_cycle_products" integer,
	"last_cycle_capacity_skips" integer,
	"error" text,
	CONSTRAINT "catalog_source_counts" CHECK ("catalog_sources"."cursor">=0 and "catalog_sources"."pages_observed">=0 and "catalog_sources"."products_observed">=0 and "catalog_sources"."cycle_products">=0
        and "catalog_sources"."cycle_capacity_skips">=0 and ("catalog_sources"."last_cycle_capacity_skips" is null or "catalog_sources"."last_cycle_capacity_skips">=0))
);
--> statement-breakpoint
ALTER TABLE "discovery_daily_budget" DROP CONSTRAINT "discovery_daily_cap";--> statement-breakpoint
ALTER TABLE "discovery_queries" DROP CONSTRAINT "discovery_counts";--> statement-breakpoint
ALTER TABLE "discovery_queries" ADD COLUMN "requested_retailers" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_normalizations" ADD COLUMN "matched_fingerprint" text;--> statement-breakpoint
ALTER TABLE "listing_normalizations" ADD COLUMN "matched_version" integer;--> statement-breakpoint
ALTER TABLE "listing_normalizations" ADD COLUMN "search_identity" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_source_listings" ADD CONSTRAINT "catalog_source_listings_source_id_catalog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."catalog_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_source_listings" ADD CONSTRAINT "catalog_source_listings_listing_id_retailer_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."retailer_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_sources" ADD CONSTRAINT "catalog_sources_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_source_listing_lookup" ON "catalog_source_listings" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_source_identity" ON "catalog_sources" USING btree ("retailer_id","source_key");--> statement-breakpoint
CREATE INDEX "catalog_source_due" ON "catalog_sources" USING btree ("retailer_id","next_eligible_at");--> statement-breakpoint
CREATE INDEX "normalization_brand" ON "listing_normalizations" USING btree ("brand_key");--> statement-breakpoint
CREATE INDEX "normalization_search_tokens" ON "listing_normalizations" USING gin (to_tsvector('simple',"search_identity"));--> statement-breakpoint
ALTER TABLE "discovery_daily_budget" ADD CONSTRAINT "discovery_daily_cap" CHECK ("discovery_daily_budget"."processed" between 0 and 240);--> statement-breakpoint
ALTER TABLE "discovery_queries" ADD CONSTRAINT "discovery_counts" CHECK ("discovery_queries"."request_count" > 0 and "discovery_queries"."latest_result_count" between 0 and 80);
--> statement-breakpoint
-- Derived search metadata only. Match identity and historical prices are untouched.
UPDATE "listing_normalizations" SET "search_identity" = trim(regexp_replace(regexp_replace(regexp_replace(
  lower(normalize(normalized_title || ' ' || coalesce(brand,''), NFKC)),
  '([0-9])([[:alpha:]])', '\1 \2', 'g'), '([[:alpha:]])([0-9])', '\1 \2', 'g'), '[^[:alnum:]]+', ' ', 'g'));

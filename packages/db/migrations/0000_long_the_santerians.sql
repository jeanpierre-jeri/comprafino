CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"listings_fetched" integer DEFAULT 0 NOT NULL,
	"listings_persisted" integer DEFAULT 0 NOT NULL,
	"listings_changed" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "run_status" CHECK ("ingestion_runs"."status" in ('running', 'success', 'failed')),
	CONSTRAINT "run_counts" CHECK ("ingestion_runs"."listings_fetched" >= 0 and "ingestion_runs"."listings_persisted" >= 0 and "ingestion_runs"."listings_changed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"current_price_cents" integer NOT NULL,
	"regular_price_cents" integer,
	"currency" text NOT NULL,
	"price_unit" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	CONSTRAINT "history_times" CHECK ("price_history"."valid_until" is null or "price_history"."valid_until" > "price_history"."valid_from"),
	CONSTRAINT "history_money" CHECK ("price_history"."current_price_cents" >= 0 and ("price_history"."regular_price_cents" is null or "price_history"."regular_price_cents" >= 0)),
	CONSTRAINT "history_currency" CHECK ("price_history"."currency" = 'PEN'),
	CONSTRAINT "history_unit" CHECK ("price_history"."price_unit" in ('KG', 'UN'))
);
--> statement-breakpoint
CREATE TABLE "retailer_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" text NOT NULL,
	"external_id" text NOT NULL,
	"product_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"image_url" text,
	"current_price_cents" integer NOT NULL,
	"regular_price_cents" integer,
	"currency" text NOT NULL,
	"price_unit" text NOT NULL,
	"available" boolean,
	"package_text" text,
	"category" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "listing_money" CHECK ("retailer_listings"."current_price_cents" >= 0 and ("retailer_listings"."regular_price_cents" is null or "retailer_listings"."regular_price_cents" >= 0)),
	CONSTRAINT "listing_currency" CHECK ("retailer_listings"."currency" = 'PEN'),
	CONSTRAINT "listing_unit" CHECK ("retailer_listings"."price_unit" in ('KG', 'UN')),
	CONSTRAINT "listing_times" CHECK ("retailer_listings"."last_seen_at" >= "retailer_listings"."first_seen_at")
);
--> statement-breakpoint
CREATE TABLE "retailers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "retailer_identity" CHECK ("retailers"."id" in ('tottus', 'plaza-vea', 'metro'))
);
--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_listing_id_retailer_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."retailer_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD CONSTRAINT "retailer_listings_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_started" ON "ingestion_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_current_price_state" ON "price_history" USING btree ("listing_id") WHERE "price_history"."valid_until" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "price_state_start" ON "price_history" USING btree ("listing_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_source_identity" ON "retailer_listings" USING btree ("retailer_id","external_id");--> statement-breakpoint
CREATE INDEX "listing_last_seen" ON "retailer_listings" USING btree ("last_seen_at");
--> statement-breakpoint
INSERT INTO retailers (id, name) VALUES ('tottus', 'Tottus'), ('plaza-vea', 'Plaza Vea'), ('metro', 'Metro');

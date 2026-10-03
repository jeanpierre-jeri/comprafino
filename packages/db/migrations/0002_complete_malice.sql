CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
--> statement-breakpoint
CREATE TABLE "canonical_product_listings" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"canonical_product_id" uuid NOT NULL,
	"retailer_id" text NOT NULL,
	"confidence" numeric NOT NULL,
	"matching_version" integer NOT NULL,
	"method" text NOT NULL,
	"reasons" text[] NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_confidence" CHECK ("canonical_product_listings"."confidence">=0 and "canonical_product_listings"."confidence"<=1 and "canonical_product_listings"."matching_version">0),
	CONSTRAINT "canonical_method" CHECK ("canonical_product_listings"."method" in ('automatic','manual'))
);
--> statement-breakpoint
CREATE TABLE "canonical_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"brand_key" text NOT NULL,
	"quantity_value" integer NOT NULL,
	"quantity_unit" text NOT NULL,
	"package_count" integer NOT NULL,
	"total_quantity_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_content" CHECK ("canonical_products"."quantity_value">0 and "canonical_products"."quantity_unit" in ('g','ml','unit') and "canonical_products"."package_count">0 and "canonical_products"."total_quantity_value"::bigint="canonical_products"."quantity_value"::bigint*"canonical_products"."package_count"::bigint)
);
--> statement-breakpoint
ALTER TABLE "canonical_product_listings" ADD CONSTRAINT "canonical_product_listings_listing_id_retailer_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."retailer_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_product_listings" ADD CONSTRAINT "canonical_product_listings_canonical_product_id_canonical_products_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."canonical_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_product_listings" ADD CONSTRAINT "canonical_product_listings_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_one_retailer" ON "canonical_product_listings" USING btree ("canonical_product_id","retailer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "listing_id_retailer" ON "retailer_listings" USING btree ("id","retailer_id");
--> statement-breakpoint
ALTER TABLE "canonical_product_listings" ADD CONSTRAINT "canonical_listing_retailer" FOREIGN KEY ("listing_id","retailer_id") REFERENCES "public"."retailer_listings"("id","retailer_id") ON DELETE cascade ON UPDATE no action;

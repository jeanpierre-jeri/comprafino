CREATE TABLE "listing_normalizations" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"normalization_version" integer NOT NULL,
	"input_fingerprint" text NOT NULL,
	"normalized_title" text NOT NULL,
	"brand" text,
	"brand_key" text,
	"brand_source" text,
	"quantity_value" integer,
	"quantity_unit" text,
	"package_count" integer,
	"total_quantity_value" integer,
	"total_quantity_unit" text,
	"pricing_basis" text NOT NULL,
	"sold_by_weight" boolean NOT NULL,
	"issues" text[] NOT NULL,
	"normalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "normalization_version" CHECK ("listing_normalizations"."normalization_version" > 0),
	CONSTRAINT "normalization_brand" CHECK (("listing_normalizations"."brand" is null and "listing_normalizations"."brand_key" is null and "listing_normalizations"."brand_source" is null) or ("listing_normalizations"."brand" is not null and "listing_normalizations"."brand_key" is not null and "listing_normalizations"."brand_source" is not null and "listing_normalizations"."brand_source" in ('source', 'title'))),
	CONSTRAINT "normalization_quantity" CHECK (("listing_normalizations"."quantity_value" is null and "listing_normalizations"."quantity_unit" is null) or ("listing_normalizations"."quantity_value" is not null and "listing_normalizations"."quantity_value" > 0 and "listing_normalizations"."quantity_unit" is not null and "listing_normalizations"."quantity_unit" in ('g', 'ml', 'unit'))),
	CONSTRAINT "normalization_count" CHECK ("listing_normalizations"."package_count" is null or "listing_normalizations"."package_count" > 0),
	CONSTRAINT "normalization_total" CHECK (("listing_normalizations"."total_quantity_value" is null and "listing_normalizations"."total_quantity_unit" is null) or ("listing_normalizations"."total_quantity_value" is not null and "listing_normalizations"."total_quantity_value" > 0 and "listing_normalizations"."quantity_value" is not null and "listing_normalizations"."package_count" is not null and "listing_normalizations"."total_quantity_unit" is not null and "listing_normalizations"."total_quantity_unit" = "listing_normalizations"."quantity_unit" and "listing_normalizations"."total_quantity_value"::bigint = "listing_normalizations"."quantity_value"::bigint * "listing_normalizations"."package_count"::bigint)),
	CONSTRAINT "normalization_basis" CHECK (("listing_normalizations"."pricing_basis" = 'kg' and "listing_normalizations"."sold_by_weight" and "listing_normalizations"."quantity_value" is null and "listing_normalizations"."package_count" is null) or ("listing_normalizations"."pricing_basis" = 'unit' and not "listing_normalizations"."sold_by_weight"))
);
--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD COLUMN "source_brand" text;--> statement-breakpoint
ALTER TABLE "retailer_listings" ADD COLUMN "source_unit_multiplier" numeric;--> statement-breakpoint
ALTER TABLE "listing_normalizations" ADD CONSTRAINT "listing_normalizations_listing_id_retailer_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."retailer_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "normalization_dimensions" ON "listing_normalizations" USING btree ("brand_key","quantity_unit","quantity_value","package_count");
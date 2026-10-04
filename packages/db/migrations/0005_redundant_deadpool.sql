CREATE TABLE "retailer_listing_offers" (
	"listing_id" uuid NOT NULL,
	"program_key" text NOT NULL,
	"condition_type" text NOT NULL,
	"condition_label" text NOT NULL,
	"price_cents" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	CONSTRAINT "listing_offer_price" CHECK ("retailer_listing_offers"."price_cents" > 0),
	CONSTRAINT "listing_offer_condition" CHECK ("retailer_listing_offers"."condition_type"='payment_card' and "retailer_listing_offers"."program_key"='cmr' and "retailer_listing_offers"."condition_label"='Requiere tarjeta CMR'),
	CONSTRAINT "listing_offer_window" CHECK ("retailer_listing_offers"."starts_at" is null or "retailer_listing_offers"."ends_at" is null or "retailer_listing_offers"."starts_at"<"retailer_listing_offers"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "retailer_listing_offers" ADD CONSTRAINT "retailer_listing_offers_listing_id_retailer_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."retailer_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_offer_program" ON "retailer_listing_offers" USING btree ("listing_id","program_key");
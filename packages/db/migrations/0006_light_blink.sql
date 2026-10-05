CREATE TABLE "listing_observation_days" (
	"listing_id" uuid NOT NULL,
	"observation_date" date NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"observation_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "listing_observation_days_listing_id_observation_date_pk" PRIMARY KEY("listing_id","observation_date"),
	CONSTRAINT "observation_day_count" CHECK ("listing_observation_days"."observation_count" > 0),
	CONSTRAINT "observation_day_times" CHECK ("listing_observation_days"."first_observed_at" <= "listing_observation_days"."last_observed_at"
      and ("listing_observation_days"."first_observed_at" at time zone 'America/Lima')::date = "listing_observation_days"."observation_date"
      and ("listing_observation_days"."last_observed_at" at time zone 'America/Lima')::date = "listing_observation_days"."observation_date")
);
--> statement-breakpoint
ALTER TABLE "listing_observation_days" ADD CONSTRAINT "listing_observation_days_listing_id_retailer_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."retailer_listings"("id") ON DELETE cascade ON UPDATE no action;
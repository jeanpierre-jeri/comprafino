ALTER TABLE "retailers" DROP CONSTRAINT "retailer_identity";--> statement-breakpoint
ALTER TABLE "retailers" ADD CONSTRAINT "retailer_identity" CHECK ("retailers"."id" in ('tottus', 'plaza-vea', 'metro', 'makro'));
--> statement-breakpoint
INSERT INTO "retailers" ("id", "name") VALUES ('makro', 'Makro');

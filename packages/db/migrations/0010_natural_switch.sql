CREATE TABLE "user_shopping_lists" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_shopping_lists_revision" CHECK ("user_shopping_lists"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "user_shopping_lists" ADD CONSTRAINT "user_shopping_lists_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
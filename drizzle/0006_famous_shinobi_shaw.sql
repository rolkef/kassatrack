CREATE TABLE "shopping_list" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_list_name_nicht_leer" CHECK (btrim("shopping_list"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "shopping_list_item" (
	"id" text PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"product_id" text,
	"freitext" text,
	"stueckzahl" integer DEFAULT 1 NOT NULL,
	"abgehakt_am" timestamp with time zone,
	CONSTRAINT "shopping_list_item_genau_eine_quelle" CHECK (("shopping_list_item"."product_id" is not null) <> ("shopping_list_item"."freitext" is not null)),
	CONSTRAINT "shopping_list_item_stueckzahl_positiv" CHECK ("shopping_list_item"."stueckzahl" > 0)
);
--> statement-breakpoint
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_list_id_shopping_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;
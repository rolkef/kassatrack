CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "category_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "chain" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kuerzel" text NOT NULL,
	"sortierung" integer NOT NULL,
	CONSTRAINT "chain_kuerzel_unique" UNIQUE("kuerzel"),
	CONSTRAINT "chain_kuerzel_klein" CHECK ("chain"."kuerzel" = lower("chain"."kuerzel"))
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"marke" text,
	"kategorie_id" text,
	"menge" integer NOT NULL,
	"einheit" text NOT NULL,
	"bild_schluessel" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_menge_positiv" CHECK ("product"."menge" > 0),
	CONSTRAINT "product_einheit_bekannt" CHECK ("product"."einheit" in ('G','ML','STK')),
	CONSTRAINT "product_name_nicht_leer" CHECK (btrim("product"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "product_ean" (
	"ean" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_product" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"product_id" text NOT NULL,
	"roh_namen" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer" (
	"id" text PRIMARY KEY NOT NULL,
	"store_product_id" text NOT NULL,
	"preis" numeric(10, 4) NOT NULL,
	"gueltig_von" timestamp with time zone NOT NULL,
	"gueltig_bis" timestamp with time zone NOT NULL,
	"bedingung" text,
	"quelle" text NOT NULL,
	CONSTRAINT "offer_zeitraum" CHECK ("offer"."gueltig_bis" > "offer"."gueltig_von"),
	CONSTRAINT "offer_preis_positiv" CHECK ("offer"."preis" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_observation" (
	"id" text PRIMARY KEY NOT NULL,
	"store_product_id" text NOT NULL,
	"chain_id" text NOT NULL,
	"product_id" text NOT NULL,
	"beobachtet_am" timestamp with time zone DEFAULT now() NOT NULL,
	"quelle" text NOT NULL,
	"preisart" text NOT NULL,
	"einzelpreis" numeric(10, 4) NOT NULL,
	"menge" numeric(10, 3) DEFAULT '1' NOT NULL,
	"zeilensumme" numeric(10, 4) NOT NULL,
	"grundpreis" numeric(12, 4) NOT NULL,
	"aktions_hinweis" text,
	"aktion_gueltig_bis" timestamp with time zone,
	"pfand_betrag" numeric(10, 4) DEFAULT '0' NOT NULL,
	"konfidenz" numeric(4, 3) DEFAULT '1' NOT NULL,
	"pruefen_noetig" boolean DEFAULT false NOT NULL,
	CONSTRAINT "preis_quelle_bekannt" CHECK ("price_observation"."quelle" in ('RECEIPT','BARCODE','MANUAL','CHAIN_API','FLYER')),
	CONSTRAINT "preis_art_bekannt" CHECK ("price_observation"."preisart" in ('NORMAL','PROMO','LOYALTY','MULTIBUY')),
	CONSTRAINT "preis_positiv" CHECK ("price_observation"."einzelpreis" > 0 and "price_observation"."zeilensumme" > 0 and "price_observation"."grundpreis" > 0),
	CONSTRAINT "preis_aktion_hat_ende" CHECK ("price_observation"."preisart" <> 'PROMO' or "price_observation"."aktion_gueltig_bis" is not null)
);
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_kategorie_id_category_id_fk" FOREIGN KEY ("kategorie_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ean" ADD CONSTRAINT "product_ean_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product" ADD CONSTRAINT "store_product_chain_id_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product" ADD CONSTRAINT "store_product_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_store_product_id_store_product_id_fk" FOREIGN KEY ("store_product_id") REFERENCES "public"."store_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_store_product_id_store_product_id_fk" FOREIGN KEY ("store_product_id") REFERENCES "public"."store_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_chain_id_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_product_kette_produkt" ON "store_product" USING btree ("chain_id","product_id");--> statement-breakpoint
CREATE INDEX "preis_produkt_kette_zeit" ON "price_observation" USING btree ("product_id","chain_id","beobachtet_am");
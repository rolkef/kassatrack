CREATE TABLE "chain_sync_ungeklaert" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"feed_id" text NOT NULL,
	"rohname" text NOT NULL,
	"menge" integer NOT NULL,
	"einheit" text NOT NULL,
	"letzter_preis" numeric(10, 4) NOT NULL,
	"zuerst_gesehen_am" timestamp with time zone DEFAULT now() NOT NULL,
	"zuletzt_gesehen_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_sync_ungeklaert_menge_positiv" CHECK ("chain_sync_ungeklaert"."menge" > 0),
	CONSTRAINT "chain_sync_ungeklaert_einheit_bekannt" CHECK ("chain_sync_ungeklaert"."einheit" in ('G','ML','STK')),
	CONSTRAINT "chain_sync_ungeklaert_preis_positiv" CHECK ("chain_sync_ungeklaert"."letzter_preis" > 0)
);
--> statement-breakpoint
ALTER TABLE "chain_sync_ungeklaert" ADD CONSTRAINT "chain_sync_ungeklaert_chain_id_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_sync_ungeklaert_kette_feed_id" ON "chain_sync_ungeklaert" USING btree ("chain_id","feed_id");
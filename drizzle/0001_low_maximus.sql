CREATE TABLE "abweisung" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"weg" text,
	"zeitpunkt" timestamp with time zone DEFAULT now() NOT NULL
);

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { istBetreiber, pruefeBetreiber } from "@/lib/zugriff";

export type Benutzer = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
};

export async function holeSitzung() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser(): Promise<Benutzer> {
  const sitzung = await holeSitzung();
  if (!sitzung) redirect("/anmelden");

  return {
    id: sitzung.user.id,
    email: sitzung.user.email,
    name: sitzung.user.name,
    image: sitzung.user.image,
  };
}

/**
 * Wie `requireUser`, verlangt zusätzlich die Betreiber-Rolle.
 *
 * Für **Server-Aktionen** gedacht: Die werfen bei fehlender Berechtigung, und
 * die Aktion macht daraus eine Meldung. Nicht angemeldet führt weiterhin auf
 * die Anmeldeseite, angemeldet-aber-unberechtigt wirft `NichtBetreiber` —
 * das sind zwei verschiedene Lagen und brauchen zwei verschiedene Antworten.
 *
 * Server-Aktionen sind eigene Endpunkte und über ihre Kennung auch ohne die
 * zugehörige Seite aufrufbar. Eine Prüfung nur auf der Seite schützt sie
 * deshalb nicht.
 */
export async function requireBetreiber(): Promise<Benutzer> {
  const benutzer = await requireUser();
  await pruefeBetreiber(db, benutzer.email);
  return benutzer;
}

/**
 * Für **Seiten**: Liefert die angemeldete Person und ob sie verwalten darf,
 * statt zu werfen. Die Seite kann damit eine Erklärung zeigen, statt in eine
 * Fehlerseite zu laufen — wer nicht berechtigt ist, hat nichts falsch gemacht.
 */
export async function holeBerechtigung(): Promise<{ benutzer: Benutzer; darfVerwalten: boolean }> {
  const benutzer = await requireUser();
  return { benutzer, darfVerwalten: await istBetreiber(db, benutzer.email) };
}

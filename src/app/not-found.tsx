import { connection } from "next/server";

/**
 * Ohne diese Datei liefert Next seine eingebaute 404-Seite statisch aus
 * (zur Build-Zeit vorgerendert, ohne Anfrage-Header). Unter der Nonce-CSP
 * bekommt eine statische Seite kein Token und ihre eigenen Hydration-Skripte
 * werden dadurch blockiert. `connection()` erzwingt dynamisches Rendern,
 * wodurch die Seite denselben Pro-Anfrage-Nonce wie jede andere Route erhält.
 */
export default async function NichtGefunden() {
  await connection();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold">Seite nicht gefunden</h1>
      <p className="text-balance opacity-70">Diese Seite gibt es nicht.</p>
    </main>
  );
}

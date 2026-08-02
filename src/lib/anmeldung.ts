/**
 * Gemeinsames Vokabular der Anmeldung.
 *
 * Eine Abweisung erreicht die Anmeldeseite auf zwei völlig verschiedenen
 * Wegen, und beide brauchen denselben Wortlaut:
 *
 * 1. **Als Rückleitung.** Der Google-Weg entscheidet erst im OAuth-Callback,
 *    also serverseitig, lange nachdem `signIn.social()` aufgelöst und der
 *    Browser die Seite verlassen hat. Better Auth macht daraus keine Antwort,
 *    sondern eine Umleitung auf `errorCallbackURL` mit `?error=<code>`. Das
 *    ist der Weg, den eine nicht eingeladene Person in der Praxis nimmt.
 * 2. **Als Antwort.** Wo eine Anmeldung synchron abgelehnt wird, kommt der
 *    Fehler mit HTTP-Status zurück. Für den Allowlist-Fall passiert das heute
 *    nirgends; die Behandlung bleibt als zweite Verteidigungslinie stehen.
 *
 * Diese Datei wird vom Server (`auth.ts`, `page.tsx`) und vom Client
 * (`anmelde-formular.tsx`) importiert und darf deshalb nichts enthalten, was
 * nur auf einer Seite läuft — nur Konstanten und reine Funktionen.
 */

/**
 * Der Code, den das Allowlist-Gate an Better Auth mitgibt. Better Auth
 * schreibt ihn beim Callback-Fehler als `?error=…` in die Rückleitung; die
 * Anmeldeseite erkennt daran, dass es um die Freischaltung geht und nicht um
 * einen der eingebauten OAuth-Fehler.
 *
 * Beide Enden importieren diese Konstante, damit die Zeichenkette nicht
 * auseinanderlaufen kann.
 */
export const ZUGANG_NICHT_FREIGESCHALTET = "ZUGANG_NICHT_FREIGESCHALTET";

/** Wohin Better Auth zurückleitet, wenn der Google-Weg scheitert. */
export const ANMELDE_PFAD = "/anmelden";

/**
 * `abgewiesen` heißt: die Adresse steht nicht auf der Liste. Nur dann ist der
 * Rat „frag die Person, die dich eingeladen hat" richtig.
 */
export type Meldung = { text: string; abgewiesen: boolean };

export const ABWEISUNG = "Diese Adresse ist für KassaTrack nicht freigeschaltet.";
export const ABGEBROCHEN = "Die Anmeldung wurde nicht abgeschlossen. Versuch es noch einmal.";
export const KEINE_VERBINDUNG =
  "Keine Verbindung zum Server. Prüf dein Internet und versuch es noch einmal.";

/**
 * Deutet einen Fehler, der als Antwort auf einen laufenden Aufruf zurückkommt.
 *
 * 403 vergibt ausschließlich das Allowlist-Gate in `src/lib/auth.ts`. Alles
 * andere kommt von Better Auth auf Englisch und in Entwicklersprache
 * („Auth cancelled") — das zeigen wir niemandem, wir sagen selbst, was los ist.
 * Am Text zu erkennen, was passiert ist, wäre brüchig; der Status ist die
 * verlässliche Auskunft.
 */
export function deuteAntwort(fehler: { status?: number }): Meldung {
  if (fehler.status === 403) return { text: ABWEISUNG, abgewiesen: true };
  return { text: ABGEBROCHEN, abgewiesen: false };
}

/**
 * Deutet den `?error=…`-Parameter einer Rückleitung aus dem OAuth-Callback.
 *
 * Neben unserem eigenen Code stehen dort Better-Auth-Codes (`invalid_code`,
 * `email_not_found`, `unable_to_get_user_info`, …) und Googles eigene
 * (`access_denied`, wenn jemand die Zustimmung abbricht). Alle diese sind
 * „hat nicht geklappt", nicht „du bist nicht eingeladen" — der Ratschlag muss
 * also ein anderer sein.
 */
export function deuteRueckleitung(code: string | string[] | undefined): Meldung | null {
  const eindeutig = Array.isArray(code) ? code[0] : code;
  if (!eindeutig) return null;
  if (eindeutig === ZUGANG_NICHT_FREIGESCHALTET) return { text: ABWEISUNG, abgewiesen: true };
  return { text: ABGEBROCHEN, abgewiesen: false };
}

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
 * Die Marke, an der die Anmeldeseite eine Abweisung erkennt.
 *
 * `src/lib/auth.ts` setzt sie **doppelt** — als `code` und als `message` des
 * APIError —, weil Better Auth je nach Weg das eine oder das andere in die
 * Rückleitung schreibt:
 *
 * - Der Weg, den Google tatsächlich nimmt, wird schon in
 *   `handleOAuthUserInfo` abgefangen und landet über
 *   `redirectOnError(…, result.error.split(" ").join("_"))` in der URL —
 *   dort zählt die **Meldung**.
 * - Fliegt ein APIError außerhalb jenes inneren try, greift
 *   `if (isAPIError(e) && e.body?.code)` — dort zählt der **Code**.
 *
 * Deshalb ist das hier eine Marke ohne Leerzeichen und kein Satz: `split(" ")`
 * ließe einen Satz zu `Diese_Adresse_ist_…` werden und `deuteRueckleitung`
 * liefe daran vorbei. Der Satz für Menschen steht in `ABWEISUNG` und wird
 * erst hier auf der Seite eingesetzt.
 *
 * Beide Enden importieren diese Konstante, damit sie nicht auseinanderlaufen.
 * `tests/auth-gate.test.ts` prüft zusätzlich den **ausgesendeten** Wert, nicht
 * bloß die Konstante — genau daran ist die erste Fassung gescheitert.
 */
export const ZUGANG_NICHT_FREIGESCHALTET = "ZUGANG_NICHT_FREIGESCHALTET";

/**
 * Die Marke für einen Einladungslink, der nicht mehr gilt.
 *
 * Sie reist über denselben `?error=`-Parameter wie die Abweisung, weil die
 * Anmeldeseite nur diesen einen Kanal liest. Ein eigener Parameter (etwa
 * `?fehler=einladung`) käme dort nie an und die Person stünde ohne Erklärung
 * vor der Seite.
 *
 * Wie oben: keine Leerzeichen, damit nichts daran zerbricht, falls der Wert
 * je durch `split(" ").join("_")` läuft.
 */
export const EINLADUNG_UNGUELTIG = "EINLADUNG_UNGUELTIG";

/** Wohin Better Auth zurückleitet, wenn der Google-Weg scheitert. */
export const ANMELDE_PFAD = "/anmelden";

/**
 * `abgewiesen` heißt: die Adresse steht nicht auf der Liste. Nur dann ist der
 * Rat „frag die Person, die dich eingeladen hat" richtig.
 */
export type Meldung = { text: string; abgewiesen: boolean };

export const ABWEISUNG = "Diese Adresse ist für KassaTrack nicht freigeschaltet.";
export const ABGEBROCHEN = "Die Anmeldung wurde nicht abgeschlossen. Versuch es noch einmal.";
/**
 * Der Rat am Ende ist kein Trost, sondern meistens zutreffend: Freigeschaltet
 * wird beim Erstellen der Einladung, nicht beim Öffnen des Links. Ein Link, den
 * die Linkvorschau eines Messengers schon eingelöst hat, sagt also nichts
 * darüber aus, ob die Adresse hereinkommt. Wer wirklich nicht freigeschaltet
 * ist, erfährt das gleich darauf über `ABWEISUNG`.
 */
export const EINLADUNG_ABGELAUFEN =
  "Dieser Einladungslink gilt nicht mehr. Melde dich trotzdem an — " +
  "wenn du eingeladen wurdest, ist deine Adresse bereits freigeschaltet.";
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
  // `abgewiesen: false`, obwohl der Link abgelaufen ist: Der Zusatzrat „frag
  // die Person, die dich eingeladen hat" wäre hier falsch. Der richtige
  // nächste Schritt steht schon im Satz selbst.
  if (eindeutig === EINLADUNG_UNGUELTIG) return { text: EINLADUNG_ABGELAUFEN, abgewiesen: false };
  return { text: ABGEBROCHEN, abgewiesen: false };
}

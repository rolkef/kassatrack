"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";

export type Decoder = { erkenne(bild: ImageBitmapSource): Promise<string[]> };

/**
 * Der echte Decoder: eine `BarcodeDetector`-Instanz für EAN-13. Nur aufrufen,
 * wenn `istScanFaehig()` zuvor bestanden hat — der Konstruktor existiert sonst
 * nicht. `BarcodeDetector` fehlt in der DOM-Bibliothek von TypeScript noch,
 * daher der ausdrückliche Cast statt eines globalen Typs.
 */
export function echterDecoder(): Decoder {
  type BarcodeDetectorCtor = new (optionen: { formats: string[] }) => {
    detect(bild: ImageBitmapSource): Promise<{ rawValue: string }[]>;
  };
  const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
  const detector = new Ctor({ formats: ["ean_13"] });
  return {
    async erkenne(bild) {
      const treffer = await detector.detect(bild);
      return treffer.map((t) => t.rawValue);
    },
  };
}

/** Das Feature-Gate für `echterDecoder()`. */
export function istScanFaehig(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

type Zustand = "bereit" | "fordert_kamera" | "scannt" | "keine_berechtigung";

/**
 * Kamera-Ansicht zum Scannen eines Strichcodes.
 *
 * Zwei Abhängigkeiten sind austauschbare Eigenschaften statt fester Aufrufe:
 * `decoder` (native `BarcodeDetector`-API in Produktion) und `kameraStarten`
 * (`navigator.mediaDevices.getUserMedia` in Produktion). Beides fehlt in
 * `happy-dom`, und ein globaler Ersatz dafür wäre dieselbe Fallenklasse wie ein
 * unbedachtes `mock.module` — Tests reichen stattdessen Fake-Funktionen durch.
 *
 * Fehlt der Decoder (kein `BarcodeDetector` im Browser), verschwindet die
 * Schaltfläche zugunsten eines Hinweistexts. Verweigert die Person die
 * Kamera-Berechtigung, erscheint ein zweiter, eigener Hinweis — beide Male
 * bleibt die manuelle Eingabe im Formular daneben unverändert erreichbar.
 * Keiner der beiden Hinweise ist rot: Ein Gerät ohne Scanner und eine
 * abgelehnte Berechtigung sind kein Fehler, den jemand gemacht hat.
 */
export function StrichcodeScanner({
  onErkannt,
  decoder,
  kameraStarten = () =>
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }),
}: {
  onErkannt: (ean: string) => void;
  decoder?: Decoder;
  kameraStarten?: () => Promise<MediaStream>;
}) {
  const [zustand, setZustand] = useState<Zustand>("bereit");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stoppe = useCallback(() => {
    streamRef.current?.getTracks().forEach((spur) => spur.stop());
    streamRef.current = null;
    setZustand("bereit");
  }, []);

  /* Verlässt jemand den Bildschirm mitten im Scan, bleibt die Kamera sonst an. */
  useEffect(() => stoppe, [stoppe]);

  /*
   * Die Vorschau wird erst hier angehängt, nicht schon in `starte()`.
   *
   * Das ist kein Stilfrage: React zeichnet nach `setZustand("scannt")` nicht
   * sofort neu, `videoRef.current` ist unmittelbar danach also noch `null`.
   * Der Stream landete dort nie — die Vorschau bliebe schwarz, obwohl die
   * Kamera läuft.
   */
  useEffect(() => {
    if (zustand !== "scannt") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    try {
      video.srcObject = stream;
      // `play()` wird ohne Geste abgewiesen und liefert nicht überall ein
      // Promise. Die Vorschau ist Komfort — die Erkennung läuft auch ohne sie.
      void Promise.resolve(video.play?.()).catch(() => {});
    } catch {
      // bewusst leer, siehe oben
    }
  }, [zustand]);

  /*
   * Die Leseschleife — aus demselben Grund ein Effekt: Sie liest das
   * `<video>`-Element, und das steht erst nach dem Zeichnen im Baum. Ein Aufruf
   * direkt nach `setZustand` hätte der ersten Runde `null` gereicht, woran
   * `BarcodeDetector.detect` scheitert; der Scan wäre lautlos nie angelaufen.
   */
  useEffect(() => {
    if (zustand !== "scannt") return;
    const leser = decoder;
    if (!leser) return;

    let aktiv = true;
    let rahmen = 0;

    async function schleife() {
      if (!aktiv) return;
      let treffer: string[] = [];
      try {
        treffer = await leser!.erkenne(videoRef.current as unknown as ImageBitmapSource);
      } catch {
        // Ein einzelnes Bild, das der Decoder nicht mag, beendet den Scan
        // nicht — sonst reichte ein verwackelter Moment, um abzubrechen.
      }
      if (!aktiv) return;
      const ean = treffer[0];
      if (ean) {
        stoppe();
        onErkannt(ean);
        return;
      }
      rahmen = requestAnimationFrame(() => void schleife());
    }

    void schleife();
    return () => {
      aktiv = false;
      cancelAnimationFrame(rahmen);
    };
  }, [zustand, decoder, onErkannt, stoppe]);

  async function starte() {
    setZustand("fordert_kamera");
    try {
      streamRef.current = await kameraStarten();
    } catch {
      setZustand("keine_berechtigung");
      return;
    }
    setZustand("scannt");
  }

  if (!decoder) {
    return (
      <Hinweistext>
        Strichcode-Scan wird auf diesem Gerät nicht unterstützt. Name, Marke und Menge lassen sich
        weiterhin von Hand eintragen.
      </Hinweistext>
    );
  }

  if (zustand === "keine_berechtigung") {
    return (
      <Hinweistext dringend>
        Kein Zugriff auf die Kamera. Die Berechtigung dafür steht in den Einstellungen des
        Browsers. Name, Marke und Menge lassen sich weiterhin von Hand eintragen.
      </Hinweistext>
    );
  }

  if (zustand === "scannt") {
    return (
      <div data-auftritt className="flex animate-auftritt flex-col gap-3">
        <div className="relative overflow-hidden rounded-block bg-vordergrund">
          {/*
            Für Hilfstechnik ausgeblendet: Ein Live-Kamerabild ist nicht
            beschreibbar. Was gerade passiert, sagt stattdessen die Zeile
            darunter — in Worten, nicht über die Farbe des Rahmens.
          */}
          <video
            ref={videoRef}
            muted
            playsInline
            aria-hidden="true"
            className="block aspect-[4/3] w-full object-cover"
          />
          <Zielrahmen />
        </div>

        <p role="status" className="text-[0.8125rem] leading-snug text-gedaempft">
          Kamera läuft. Halt den Strichcode in den Rahmen — der Scan endet von selbst, sobald er
          gelesen ist.
        </p>

        {/*
          Der Abbruch steht unter der Vorschau und nicht darüber: Am Handy liegt
          dort der Daumen, und die Hand verdeckt nichts, was man gerade
          anvisiert. Volle Breite, damit er blind zu treffen ist.
        */}
        <Schaltflaeche variante="neben" onClick={stoppe}>
          Abbrechen
        </Schaltflaeche>
      </div>
    );
  }

  return (
    <Schaltflaeche
      variante="neben"
      symbol={<Strichcode />}
      // Zwischen Tippen und Kamerabild liegt die Berechtigungsabfrage des
      // Browsers, und die dauert Sekunden. Ohne diese Rückmeldung tippt man ein
      // zweites Mal.
      laedt={zustand === "fordert_kamera"}
      onClick={starte}
    >
      Strichcode scannen
    </Schaltflaeche>
  );
}

/**
 * Der Zielrahmen: vier Ecken über einem leicht abgedunkelten Bild.
 *
 * Die Abdunklung ist kein Effekt, sondern die Bedingung dafür, dass die hellen
 * Ecken auf jeder Verpackung lesbar bleiben — auf einer weißen Milchpackung
 * verschwänden sie sonst. Ecken statt eines geschlossenen Rechtecks, weil der
 * Strichcode selbst aus Linien besteht: Ein durchgehender Rahmen legte sich
 * optisch über das, was gelesen werden soll.
 */
function Zielrahmen() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-vordergrund/20">
      <div className="absolute inset-6 sm:inset-10">
        <Ecke className="top-0 left-0 rounded-tl-klein border-t-2 border-l-2" />
        <Ecke className="top-0 right-0 rounded-tr-klein border-t-2 border-r-2" />
        <Ecke className="bottom-0 left-0 rounded-bl-klein border-b-2 border-l-2" />
        <Ecke className="right-0 bottom-0 rounded-br-klein border-r-2 border-b-2" />
      </div>
    </div>
  );
}

function Ecke({ className }: { className: string }) {
  return <span className={`absolute size-7 border-auf-marke ${className}`} />;
}

/** Ein Satz statt einer Schaltfläche — dort, wo das Scannen nicht geht. */
function Hinweistext({ children, dringend = false }: { children: string; dringend?: boolean }) {
  return (
    <p
      role={dringend ? "alert" : undefined}
      className="rounded-block bg-hinweis px-4 py-3.5 text-[0.9375rem] leading-relaxed text-auf-hinweis"
    >
      {children}
    </p>
  );
}

/** Ungleich breite Striche — ein Strichcode ist an seinem Rhythmus zu erkennen. */
function Strichcode() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
      <rect x="2" y="4.5" width="1.5" height="11" rx="0.5" />
      <rect x="5" y="4.5" width="1" height="11" rx="0.5" />
      <rect x="7.5" y="4.5" width="2" height="11" rx="0.5" />
      <rect x="10.5" y="4.5" width="1" height="11" rx="0.5" />
      <rect x="12.5" y="4.5" width="1.5" height="11" rx="0.5" />
      <rect x="15" y="4.5" width="1" height="11" rx="0.5" />
      <rect x="17" y="4.5" width="1" height="11" rx="0.5" />
    </svg>
  );
}

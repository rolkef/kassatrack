// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { StrichcodeScanner } from "@/app/erfassen/strichcode-scanner";

afterEach(cleanup);

/**
 * Eine Kamera mit genau einer Spur — kein Test hängt am tatsächlichen Videobild.
 *
 * Warum das kein handgeschriebenes `{}` sein darf, zeigte erst der Lauf, und
 * zwar von zwei Seiten: `video.srcObject` wirft in happy-dom einen `TypeError`,
 * sobald der Wert kein echtes `MediaStream` ist — ein Fremdobjekt liefe also
 * stillschweigend ins `catch` der Vorschau, und der Test prüfte nur noch, dass
 * dieses `catch` greift. happy-doms `MediaStream` ist umgekehrt ein reiner
 * Datenhalter ohne `getTracks` — und genau darüber schaltet die Komponente die
 * Kamera wieder ab. Erst beides zusammen ergibt eine Kamera, die sich auch
 * ausschalten lässt; `stop` macht nachprüfbar, dass das auch geschieht.
 */
function fakeKamera() {
  const stop = mock(() => {});
  const kamera = mock(async () =>
    Object.assign(new MediaStream(), {
      getTracks: () => [{ stop } as unknown as MediaStreamTrack],
    }),
  );
  return { kamera, stop };
}

describe("StrichcodeScanner", () => {
  it("ruft onErkannt mit dem erkannten Code auf, sobald der injizierte Decoder liefert", async () => {
    const onErkannt = mock((_ean: string) => {});
    const decoder = { erkenne: mock(async (_bild: ImageBitmapSource) => ["9001234567892"]) };

    render(
      <StrichcodeScanner
        onErkannt={onErkannt}
        decoder={decoder}
        kameraStarten={fakeKamera().kamera}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Strichcode scannen" }));

    await waitFor(() => {
      expect(onErkannt).toHaveBeenCalledWith("9001234567892");
    });

    /*
     * Nicht nebensächlich: Der Decoder muss das gezeichnete `<video>` bekommen.
     * Wird die Schleife direkt nach `setZustand("scannt")` gestartet, steht das
     * Element noch nicht im Baum und der Decoder bekommt `null` — die
     * Fake-Funktion hier liefert trotzdem einen Treffer, in einem echten
     * Browser wirft `BarcodeDetector.detect(null)` dagegen, und der Scan liefe
     * lautlos nie an. Diese Zeile hält den Unterschied fest.
     */
    const [bild] = decoder.erkenne.mock.calls[0]!;
    expect((bild as unknown as HTMLElement).tagName).toBe("VIDEO");
  });

  it("zeigt einen Hinweis statt eines Absturzes, wenn kein Decoder verfügbar ist", () => {
    render(<StrichcodeScanner onErkannt={() => {}} decoder={undefined} />);
    expect(
      screen.getByText(/Strichcode-Scan wird auf diesem Gerät nicht unterstützt/),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Strichcode scannen" })).toBeNull();
  });

  it("zeigt einen Hinweis, wenn die Kamera-Berechtigung verweigert wird", async () => {
    const decoder = { erkenne: mock(async () => []) };
    const kameraStarten = mock(async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    });

    render(
      <StrichcodeScanner onErkannt={() => {}} decoder={decoder} kameraStarten={kameraStarten} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Strichcode scannen" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Kein Zugriff auf die Kamera");
    });
  });

  it("lässt sich jederzeit abbrechen", async () => {
    const decoder = { erkenne: mock(async () => []) };
    const { kamera, stop } = fakeKamera();
    render(<StrichcodeScanner onErkannt={() => {}} decoder={decoder} kameraStarten={kamera} />);

    await userEvent.click(screen.getByRole("button", { name: "Strichcode scannen" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDefined();
    });

    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull();
    // Der Abbruch muss die Kamera wirklich freigeben. Bliebe die Spur offen,
    // leuchtete die Kameraleuchte weiter — sichtbar nur am Gerät, von keiner
    // Zustandsprüfung erfasst.
    expect(stop).toHaveBeenCalled();
  });
});

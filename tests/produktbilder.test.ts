import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { legeProduktAn, holeProdukt } from "@/lib/katalog";
import {
  erzeugeBildSchluessel,
  ladeUndSpeichereBild,
  lesePfadZuBild,
  schreibeBild,
} from "@/lib/produktbilder";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

const umgebung: TestDatenbank = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });

afterAll(() => umgebung.stop());

let wurzel: string;
let verzeichnis: string;

afterEach(async () => {
  if (wurzel) await rm(wurzel, { recursive: true, force: true });
});

describe("erzeugeBildSchluessel", () => {
  it("liefert einen dateisystemsicheren Schlüssel aus der EAN", () => {
    expect(erzeugeBildSchluessel("9001234567892")).toBe("9001234567892.jpg");
  });

  it("weist eine EAN mit Pfadtrennzeichen ab", () => {
    expect(() => erzeugeBildSchluessel("../../etc/passwd")).toThrow();
  });
});

describe("schreibeBild / lesePfadZuBild", () => {
  it("schreibt die Bytes unverändert und liefert denselben Pfad beim Lesen", async () => {
    wurzel = await mkdtemp(join(tmpdir(), "produktbilder-"));
    verzeichnis = wurzel;
    const schluessel = erzeugeBildSchluessel("9001234567892");
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    await schreibeBild(verzeichnis, schluessel, bytes);

    const pfad = lesePfadZuBild(verzeichnis, schluessel);
    const gelesen = await readFile(pfad);
    expect(gelesen).toEqual(bytes);
  });

  it("legt das Zielverzeichnis an, falls es noch nicht existiert", async () => {
    wurzel = await mkdtemp(join(tmpdir(), "produktbilder-"));
    verzeichnis = join(wurzel, "tiefer", "verschachtelt");
    const schluessel = erzeugeBildSchluessel("9001234567892");

    await schreibeBild(verzeichnis, schluessel, Buffer.from([1, 2, 3]));

    const gelesen = await readFile(lesePfadZuBild(verzeichnis, schluessel));
    expect(gelesen).toEqual(Buffer.from([1, 2, 3]));
  });
});

function fakeBildAbruf(bytes: Uint8Array, ok = true) {
  return mock(
    async () => new Response((ok ? bytes : null) as BodyInit | null, { status: ok ? 200 : 404 }),
  ) as unknown as typeof fetch;
}

describe("ladeUndSpeichereBild", () => {
  it("lädt das Bild, speichert es und setzt bild_schluessel", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: null,
      menge: 250,
      einheit: "G",
    });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const abrufen = fakeBildAbruf(bytes);

    const schluessel = await ladeUndSpeichereBild(
      umgebung.db,
      produkt.id,
      "9001234567892",
      "https://images.openfoodfacts.org/butter.jpg",
      abrufen,
    );

    expect(schluessel).toBe("9001234567892.jpg");
    const aktualisiert = await holeProdukt(umgebung.db, produkt.id);
    expect(aktualisiert?.bildSchluessel).toBe("9001234567892.jpg");
  });

  it("liefert null und lässt bild_schluessel leer, wenn der Download fehlschlägt", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Milch",
      marke: null,
      menge: 1000,
      einheit: "ML",
    });
    const abrufen = fakeBildAbruf(new Uint8Array(), false);

    const schluessel = await ladeUndSpeichereBild(
      umgebung.db,
      produkt.id,
      "9007654321098",
      "https://images.openfoodfacts.org/kaputt.jpg",
      abrufen,
    );

    expect(schluessel).toBeNull();
    const aktualisiert = await holeProdukt(umgebung.db, produkt.id);
    expect(aktualisiert?.bildSchluessel).toBeNull();
  });

  it("wirft nicht weiter, wenn der Abruf selbst eine Ausnahme auslöst", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Joghurt",
      marke: null,
      menge: 500,
      einheit: "G",
    });
    const abrufen = mock(async () => {
      throw new Error("Netzwerk nicht erreichbar");
    }) as unknown as typeof fetch;

    const schluessel = await ladeUndSpeichereBild(
      umgebung.db,
      produkt.id,
      "9001111111111",
      "https://images.openfoodfacts.org/joghurt.jpg",
      abrufen,
    );

    expect(schluessel).toBeNull();
  });
});

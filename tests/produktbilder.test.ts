import { describe, expect, it, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  erzeugeBildSchluessel,
  lesePfadZuBild,
  schreibeBild,
} from "@/lib/produktbilder";

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

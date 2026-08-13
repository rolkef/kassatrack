import { describe, expect, it, mock } from "bun:test";
import { holeOffProdukt } from "@/lib/open-food-facts";

function fakeAbruf(antwort: unknown, status = 200) {
  return mock(async () => new Response(JSON.stringify(antwort), { status })) as unknown as typeof fetch;
}

describe("holeOffProdukt", () => {
  it("liefert Name, Marke, Menge und Bild-URL bei einem Treffer", async () => {
    const abrufen = fakeAbruf({
      status: 1,
      product: {
        product_name: "Butter",
        brands: "Berglandmilch,Andere Marke",
        quantity: "250 g",
        image_front_url: "https://images.openfoodfacts.org/butter.jpg",
      },
    });

    const treffer = await holeOffProdukt("9001234567892", abrufen);

    expect(treffer).toEqual({
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
      bildUrl: "https://images.openfoodfacts.org/butter.jpg",
    });
    expect(abrufen).toHaveBeenCalledTimes(1);
    const [url, optionen] = (abrufen as unknown as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("9001234567892");
    expect((optionen.headers as Record<string, string>)["User-Agent"]).toContain("KassaTrack");
  });

  it("liefert null, wenn Open Food Facts das Produkt nicht kennt (status 0)", async () => {
    const abrufen = fakeAbruf({ status: 0 });
    expect(await holeOffProdukt("0000000000000", abrufen)).toBeNull();
  });

  it("liefert null bei HTTP 404", async () => {
    const abrufen = fakeAbruf({}, 404);
    expect(await holeOffProdukt("0000000000000", abrufen)).toBeNull();
  });

  it("liefert null, wenn die Menge sich nicht zerlegen lässt", async () => {
    const abrufen = fakeAbruf({
      status: 1,
      product: { product_name: "Mysteriöses Produkt", quantity: "ein bisschen" },
    });
    expect(await holeOffProdukt("9001234567892", abrufen)).toBeNull();
  });

  it("liefert bildUrl als null, wenn kein Bild vorhanden ist", async () => {
    const abrufen = fakeAbruf({
      status: 1,
      product: { product_name: "Butter", quantity: "250 g" },
    });
    const treffer = await holeOffProdukt("9001234567892", abrufen);
    expect(treffer?.bildUrl).toBeNull();
  });

  it("liefert marke als null, wenn keine Marke angegeben ist", async () => {
    const abrufen = fakeAbruf({
      status: 1,
      product: { product_name: "Butter", quantity: "250 g" },
    });
    const treffer = await holeOffProdukt("9001234567892", abrufen);
    expect(treffer?.marke).toBeNull();
  });

  it("gibt einen Netzwerkfehler weiter, statt ihn zu verschlucken", async () => {
    const abrufen = mock(async () => {
      throw new Error("Netzwerk nicht erreichbar");
    }) as unknown as typeof fetch;

    await expect(holeOffProdukt("9001234567892", abrufen)).rejects.toThrow(
      "Netzwerk nicht erreichbar",
    );
  });
});

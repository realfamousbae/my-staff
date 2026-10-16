import { describe, expect, it } from "vitest";
import { CATALOG_SEEDS, filterCatalogSeeds } from "../catalog-seeds";

describe("catalog seeds and search", () => {
  it("contains pre-seeded energy drinks and pringles editions", () => {
    expect(CATALOG_SEEDS.length).toBeGreaterThanOrEqual(10);
    expect(CATALOG_SEEDS.some((e) => e.category === "energy")).toBe(true);
    expect(CATALOG_SEEDS.some((e) => e.category === "pringles")).toBe(true);
  });

  it("filters editions by category", () => {
    const energyOnly = filterCatalogSeeds("", "energy");
    expect(energyOnly.every((e) => e.category === "energy")).toBe(true);
    const pringlesOnly = filterCatalogSeeds("", "pringles");
    expect(pringlesOnly.every((e) => e.category === "pringles")).toBe(true);
  });

  it("searches editions by brand or flavor keyword", () => {
    const redBull = filterCatalogSeeds("Red Bull", "energy");
    expect(redBull.length).toBeGreaterThanOrEqual(2);
    expect(redBull.every((e) => e.brand === "Red Bull")).toBe(true);

    const sourCream = filterCatalogSeeds("sour cream", "pringles");
    expect(sourCream.length).toBeGreaterThanOrEqual(1);
    expect(sourCream[0]?.name).toBe("Sour Cream & Onion");
  });

  it("searches editions by barcode", () => {
    const byBarcode = filterCatalogSeeds("9002490100070");
    expect(byBarcode.length).toBe(1);
    expect(byBarcode[0]?.brand).toBe("Red Bull");
  });
});

import { describe, expect, it } from "vitest";

import { buildVendorNormalizedConfig } from "../src/core/normalizer.js";
import { normalizeQuoteRequest } from "../src/core/quoteRequest.js";
import { DEFAULT_VENDORS, type QuoteToolProfile } from "../src/core/types.js";

const profile: QuoteToolProfile = {
  profileId: "standard-cnc-6061-us",
  description: "test",
  process: "cnc",
  fileFormat: "step",
  material: "aluminum_6061",
  finish: "standard",
  quantity: 1,
  geography: "us",
  shipToRegion: "IL",
  shipToPostalCode: "60611",
  preferredLeadTime: "standard",
};

describe("normalizeQuoteRequest", () => {
  it("applies the narrow default contract", () => {
    const request = normalizeQuoteRequest(
      {
        filePath: "/tmp/part.step",
      },
      profile,
    );

    expect(request).toMatchObject({
      filePath: "/tmp/part.step",
      material: "aluminum_6061",
      finish: "standard",
      quantity: 1,
      geography: "us",
      shipToRegion: "IL",
      shipToPostalCode: "60611",
      preferredLeadTime: "standard",
    });
    expect(request.vendors).toEqual([...DEFAULT_VENDORS]);
  });

  it("rejects non-step files", () => {
    expect(() =>
      normalizeQuoteRequest(
        {
          filePath: "/tmp/part.sldprt",
        },
        profile,
      ),
    ).toThrow("Phase 1 only supports STEP files.");
  });

  it("accepts a supported non-default material override", () => {
    const request = normalizeQuoteRequest(
      {
        filePath: "/tmp/part.step",
        material: "aluminum_7075",
      },
      profile,
    );

    expect(request.material).toBe("aluminum_7075");
  });

  it("rejects unsupported materials", () => {
    expect(() =>
      normalizeQuoteRequest(
        {
          filePath: "/tmp/part.step",
          material: "steel_1018",
        },
        profile,
      ),
    ).toThrow("Unsupported material 'steel_1018'.");
  });
});

describe("buildVendorNormalizedConfig", () => {
  const request = normalizeQuoteRequest({ filePath: "/tmp/part.step" }, profile);
  const request7075 = normalizeQuoteRequest(
    { filePath: "/tmp/part.step", material: "aluminum_7075" },
    profile,
  );

  it("maps Hubs to the API-specific normalization contract", () => {
    expect(buildVendorNormalizedConfig(request, "hubs")).toMatchObject({
      process: "cnc-machining",
      material: "cnc-machining_aluminum-6061",
      finish: "as-machined-standard",
      extra: {
        units: "mm",
        expectedCurrency: "USD",
      },
    });
  });

  it("maps Hubs and RapidDirect to the selected 7075 material", () => {
    expect(buildVendorNormalizedConfig(request7075, "hubs")).toMatchObject({
      material: "cnc-machining_aluminum-7075",
      extra: {
        hubsMaterialSubsetId: 124,
        requestedMaterialLabel: "Aluminum 7075",
      },
    });

    expect(buildVendorNormalizedConfig(request7075, "rapiddirect")).toMatchObject({
      material: "Aluminum 7075",
    });
  });
});

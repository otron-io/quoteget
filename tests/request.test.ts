import { describe, expect, it } from "vitest";

import { buildVendorNormalizedConfig } from "../src/core/normalizer.js";
import { normalizeQuoteRequest } from "../src/core/quoteRequest.js";
import type { QuoteToolProfile } from "../src/core/types.js";

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
    expect(request.vendors).toHaveLength(4);
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
});

describe("buildVendorNormalizedConfig", () => {
  const request = normalizeQuoteRequest({ filePath: "/tmp/part.step" }, profile);

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
});

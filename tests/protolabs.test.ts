import { describe, expect, it } from "vitest";

import {
  classifyProtolabsQuote,
  extractProtolabsReviewPricing,
} from "../src/vendors/protolabs.js";

describe("classifyProtolabsQuote", () => {
  it("classifies bracket-like quote-request-needed states as manual review", () => {
    const result = classifyProtolabsQuote({
      number: "9101-803",
      totalPrice: null,
      quoteRequestNeeded: true,
      minimumConfigurationNeeded: false,
      isReadyForPricing: true,
      lineItems: [
        {
          status: "New",
          quoteRequestNeeded: true,
          minimumConfigurationNeeded: false,
          isReadyForPricing: true,
          statusChecklist: [
            { code: "ConfigurePart", state: "Checked" },
            { code: "RequestAnalysisAndPricing", state: "Unchecked" },
            { code: "ChooseOrDismissThreading", state: "Unchecked" },
          ],
          concerns: null,
        },
      ],
    });

    expect(result.kind).toBe("manual_review_required");
    expect(result.blockerReason).toContain("RequestAnalysisAndPricing");
  });

  it("classifies priced states as quoted", () => {
    const result = classifyProtolabsQuote({
      number: "5559-695",
      totalPrice: 305.66,
      quoteRequestNeeded: false,
      minimumConfigurationNeeded: false,
      isReadyForPricing: true,
      lineItems: [
        {
          status: "Orderable",
          quoteRequestNeeded: false,
          minimumConfigurationNeeded: false,
          isReadyForPricing: true,
        },
      ],
    });

    expect(result).toEqual({ kind: "quoted" });
  });
});

describe("extractProtolabsReviewPricing", () => {
  it("parses the visible review-page order summary", () => {
    const parsed = extractProtolabsReviewPricing(`
      Ready to Order!
      Subtotal $241.64
      Shipping $35.60
      Estimated Tax $28.42
      Total $305.66
      Standard Tue, Apr 7
      Sharp internal corners with minimum tool radius
    `);

    expect(parsed.currency).toBe("USD");
    expect(parsed.price).toBe(241.64);
    expect(parsed.shippingIfVisible).toBe(35.6);
    expect(parsed.taxIfVisible).toBe(28.42);
    expect(parsed.totalIfVisible).toBe(305.66);
    expect(parsed.leadTime).toBe("Standard Tue, Apr 7");
  });
});

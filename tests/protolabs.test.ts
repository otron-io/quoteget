import { describe, expect, it } from "vitest";

import { extractFromQuoteSnapshot } from "../src/vendors/protolabs.js";

describe("extractFromQuoteSnapshot", () => {
  it("returns error for quote-request-needed snapshots", () => {
    const result = extractFromQuoteSnapshot({
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
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.error).toMatch(/rfq|quote request/i);
  });

  it("returns price and lead time for priced snapshots", () => {
    const result = extractFromQuoteSnapshot({
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
          totalPrice: 305.66,
          fulfillmentOptions: [
            {
              isActive: true,
              priority: "standard",
              manufacturingTime: { daysToManufacture: 5 },
            },
          ],
        },
      ],
    });

    expect(result?.price).toBe(305.66);
    expect(result?.currency).toBe("USD");
    expect(result?.quoteId).toBe("5559-695");
    expect(result?.leadTime).toBe("5 business days");
  });

  it("returns null when no line items are present", () => {
    const result = extractFromQuoteSnapshot({
      totalPrice: null,
      quoteRequestNeeded: false,
      lineItems: [],
    });

    expect(result).toBeNull();
  });
});

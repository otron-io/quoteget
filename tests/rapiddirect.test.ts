import { describe, expect, it } from "vitest";

import { extractRapidDirectPricing } from "../src/vendors/rapiddirect.js";

describe("extractRapidDirectPricing", () => {
  it("prefers the labeled total price over quantity-break rows", () => {
    const parsed = extractRapidDirectPricing(`
      Quote QC004260020
      Standard
      0 business days
      USD 66.80
      Qty Unit Price Total Price
      1 USD 66.80 / pcs USD 66.80
      Total price
      USD 66.80
    `);

    expect(parsed).toMatchObject({
      quoteId: "QC004260020",
      currency: "USD",
      price: 66.8,
      leadTime: "Standard 0 business days",
    });
  });

  it("falls back to the lead-time block when total price is absent", () => {
    const parsed = extractRapidDirectPricing(`
      Lead time
      Standard
      USD 72.40
      6 business days
    `);

    expect(parsed).toMatchObject({
      currency: "USD",
      price: 72.4,
      leadTime: "Standard 6 business days",
    });
  });
});

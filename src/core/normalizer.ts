import type { QuoteRequest, VendorName, VendorNormalizedConfig } from "./types.js";

export function buildVendorNormalizedConfig(
  request: QuoteRequest,
  vendor: VendorName,
): VendorNormalizedConfig {
  switch (vendor) {
    case "hubs":
      return {
        vendor,
        process: "cnc-machining",
        material: "cnc-machining_aluminum-6061",
        finish: "as-machined-standard",
        quantity: request.quantity,
        geography: request.geography,
        shipToRegion: request.shipToRegion,
        shipToPostalCode: request.shipToPostalCode,
        preferredLeadTime: request.preferredLeadTime,
        extra: {
          units: "mm",
          expectedCurrency: "USD",
        },
      };
    case "xometry":
      return {
        vendor,
        process: "CNC machining",
        material: "Aluminum 6061",
        finish: "Standard",
        quantity: request.quantity,
        geography: request.geography,
        shipToRegion: request.shipToRegion,
        shipToPostalCode: request.shipToPostalCode,
        preferredLeadTime: request.preferredLeadTime,
        extra: {},
      };
    case "rapiddirect":
      return {
        vendor,
        process: "CNC machining",
        material: "Aluminum 6061",
        finish: "Brushed (#120)",
        quantity: request.quantity,
        geography: request.geography,
        shipToRegion: request.shipToRegion,
        shipToPostalCode: request.shipToPostalCode,
        preferredLeadTime: request.preferredLeadTime,
        extra: {},
      };
    case "protolabs":
      return {
        vendor,
        process: "CNC machining",
        material: "Aluminum 6061-T651/T6",
        finish: "Standard",
        quantity: request.quantity,
        geography: request.geography,
        shipToRegion: request.shipToRegion,
        shipToPostalCode: request.shipToPostalCode,
        preferredLeadTime: request.preferredLeadTime,
        extra: {},
      };
  }
}

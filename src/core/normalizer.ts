import { getMaterialDefinition } from "./materials.js";
import type { QuoteRequest, VendorName, VendorNormalizedConfig } from "./types.js";

export function buildVendorNormalizedConfig(
  request: QuoteRequest,
  vendor: VendorName,
): VendorNormalizedConfig {
  const material = getMaterialDefinition(request.material);

  switch (vendor) {
    case "hubs":
      return {
        vendor,
        process: "cnc-machining",
        material: material.hubs.material,
        finish: "as-machined-standard",
        quantity: request.quantity,
        geography: request.geography,
        shipToRegion: request.shipToRegion,
        shipToPostalCode: request.shipToPostalCode,
        preferredLeadTime: request.preferredLeadTime,
        extra: {
          units: "mm",
          expectedCurrency: "USD",
          hubsMaterialSubsetId: material.hubs.subsetId,
          requestedMaterialLabel: material.label,
        },
      };
    case "xometry":
      return {
        vendor,
        process: "CNC machining",
        material: material.xometry.material,
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
        material: material.rapiddirect.material,
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
        material: material.protolabs.material,
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

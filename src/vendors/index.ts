import type { VendorName } from "../core/types.js";
import type { VendorAdapter } from "./base.js";
import { HubsAdapter } from "./hubs.js";
import { ProtolabsAdapter } from "./protolabs.js";
import { RapidDirectAdapter } from "./rapiddirect.js";
import { XometryAdapter } from "./xometry.js";

export const adapters: Record<VendorName, VendorAdapter> = {
  hubs: new HubsAdapter(),
  xometry: new XometryAdapter(),
  rapiddirect: new RapidDirectAdapter(),
  protolabs: new ProtolabsAdapter(),
};

import path from "node:path";
import { z } from "zod";

import { DEFAULT_MATERIAL, isMaterialSlug, SUPPORTED_MATERIALS, type MaterialSlug } from "./materials.js";
import {
  DEFAULT_VENDORS,
  SUPPORTED_VENDORS,
  type QuoteRequest,
  type QuoteRequestInput,
  type QuoteToolProfile,
  type VendorName,
} from "./types.js";

const requestSchema = z.object({
  filePath: z.string().min(1),
  process: z.string().optional(),
  fileFormat: z.string().optional(),
  material: z.string().optional(),
  finish: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  geography: z.string().optional(),
  shipToRegion: z.string().optional(),
  shipToPostalCode: z.string().optional(),
  preferredLeadTime: z.string().optional(),
  vendors: z.array(z.enum(SUPPORTED_VENDORS)).optional(),
});

export function normalizeQuoteRequest(
  input: QuoteRequestInput,
  profile: QuoteToolProfile,
): QuoteRequest {
  const parsed = requestSchema.parse(input);
  const fileName = path.basename(parsed.filePath);
  const extension = path.extname(fileName).toLowerCase();
  const derivedFormat = extension === ".step" || extension === ".stp" ? "step" : undefined;

  if (!derivedFormat && !parsed.fileFormat) {
    throw new Error("Phase 1 only supports STEP files.");
  }

  const request: QuoteRequest = {
    filePath: path.resolve(parsed.filePath),
    fileName,
    process: normalizeLockedValue("process", parsed.process, profile.process),
    fileFormat: normalizeLockedValue(
      "fileFormat",
      parsed.fileFormat ?? derivedFormat,
      profile.fileFormat,
    ),
    material: normalizeMaterial(parsed.material, profile.material),
    finish: normalizeLockedValue("finish", parsed.finish, profile.finish),
    quantity: normalizeLockedNumber("quantity", parsed.quantity, profile.quantity),
    geography: normalizeLockedValue("geography", parsed.geography, profile.geography),
    shipToRegion: parsed.shipToRegion ?? profile.shipToRegion,
    shipToPostalCode: parsed.shipToPostalCode ?? profile.shipToPostalCode,
    preferredLeadTime: normalizeLockedValue(
      "preferredLeadTime",
      parsed.preferredLeadTime,
      profile.preferredLeadTime,
    ),
    vendors: normalizeVendors(parsed.vendors),
  };

  return request;
}

function normalizeMaterial(
  value: string | undefined,
  defaultMaterial: MaterialSlug,
): MaterialSlug {
  const resolved = (value ?? defaultMaterial ?? DEFAULT_MATERIAL).toLowerCase();
  if (!isMaterialSlug(resolved)) {
    throw new Error(
      `Unsupported material '${value ?? resolved}'. Supported materials: ${SUPPORTED_MATERIALS.join(", ")}.`,
    );
  }
  return resolved;
}

function normalizeLockedValue<T extends string>(
  field: string,
  value: string | undefined,
  lockedValue: T,
): T {
  const resolved = (value ?? lockedValue).toLowerCase();
  if (resolved !== lockedValue) {
    throw new Error(`Phase 1 ${field} is locked to '${lockedValue}'.`);
  }
  return lockedValue;
}

function normalizeLockedNumber(
  field: string,
  value: number | undefined,
  lockedValue: number,
): number {
  const resolved = value ?? lockedValue;
  if (resolved !== lockedValue) {
    throw new Error(`Phase 1 ${field} is locked to '${lockedValue}'.`);
  }
  return lockedValue;
}

function normalizeVendors(vendors?: VendorName[]): VendorName[] {
  if (!vendors || vendors.length === 0) {
    return [...DEFAULT_VENDORS];
  }
  return Array.from(new Set(vendors));
}

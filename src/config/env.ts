import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { QuoteToolEnv } from "../core/types.js";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  QUOTE_TOOL_ARTIFACT_ROOT: z.string().default("./artifacts"),
  QUOTE_TOOL_STORAGE_ROOT: z.string().default("./storage"),
  QUOTE_TOOL_HEADED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  QUOTE_TOOL_PORT: z.coerce.number().int().positive().default(4310),
  HUBS_EMAIL: optionalString,
  HUBS_UNITS: z.enum(["mm", "inch"]).default("mm"),
  HUBS_FINISH_SLUG: z.string().default("as-machined-standard"),
  HUBS_MATERIAL_SUBSET_ID: z.coerce.number().int().positive().default(124),
  HUBS_TECHNOLOGY_ID: z.coerce.number().int().positive().default(1),
  XOMETRY_STORAGE_STATE: z.string().default("./storage/auth/xometry.json"),
  RAPIDDIRECT_STORAGE_STATE: z.string().default("./storage/auth/rapiddirect.json"),
  PROTOLABS_STORAGE_STATE: z.string().default("./storage/auth/protolabs.json"),
});

export function loadEnv(cwd: string): QuoteToolEnv {
  const fileEnv = loadDotEnvFile(cwd);
  const parsed = envSchema.parse({
    ...fileEnv,
    ...process.env,
  });

  return {
    ...parsed,
    artifactRootAbs: path.resolve(cwd, parsed.QUOTE_TOOL_ARTIFACT_ROOT),
    storageRootAbs: path.resolve(cwd, parsed.QUOTE_TOOL_STORAGE_ROOT),
    XOMETRY_STORAGE_STATE: path.resolve(cwd, parsed.XOMETRY_STORAGE_STATE),
    RAPIDDIRECT_STORAGE_STATE: path.resolve(cwd, parsed.RAPIDDIRECT_STORAGE_STATE),
    PROTOLABS_STORAGE_STATE: path.resolve(cwd, parsed.PROTOLABS_STORAGE_STATE),
  };
}

export function browserStorageStateMap(env: QuoteToolEnv): Record<string, string> {
  return {
    xometry: env.XOMETRY_STORAGE_STATE,
    rapiddirect: env.RAPIDDIRECT_STORAGE_STATE,
    protolabs: env.PROTOLABS_STORAGE_STATE,
  };
}

export function storageStateExists(filePath: string): boolean {
  return existsSync(filePath);
}

function loadDotEnvFile(cwd: string): Record<string, string> {
  const envPath = path.join(cwd, ".env");
  if (!existsSync(envPath)) {
    return {};
  }

  const payload = readFileSync(envPath, "utf8");
  const entries: Record<string, string> = {};
  for (const line of payload.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = stripOptionalQuotes(value);
  }
  return entries;
}

function stripOptionalQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

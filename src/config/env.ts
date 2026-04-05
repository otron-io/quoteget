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
  QUOTE_TOOL_SESSION_SECRET: optionalString,
  HUBS_EMAIL: optionalString,
  HUBS_UNITS: z.enum(["mm", "inch"]).default("mm"),
  HUBS_FINISH_SLUG: z.string().default("as-machined-standard"),
  HUBS_MATERIAL_SUBSET_ID: z.coerce.number().int().positive().default(86),
  HUBS_TECHNOLOGY_ID: z.coerce.number().int().positive().default(1),
  BROWSERBASE_API_KEY: optionalString,
  BROWSERBASE_PROJECT_ID: optionalString,
  BROWSERBASE_REGION: z.enum(["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"]).default("us-west-2"),
  BROWSERBASE_KEEP_ALIVE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  BROWSERBASE_ENABLE_PROXIES: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  BROWSERBASE_SOLVE_CAPTCHAS: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  BROWSERBASE_ADVANCED_STEALTH: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  XOMETRY_STORAGE_STATE: z.string().default("./storage/auth/xometry.json"),
  RAPIDDIRECT_STORAGE_STATE: z.string().default("./storage/auth/rapiddirect.json"),
  PROTOLABS_STORAGE_STATE: z.string().default("./storage/auth/protolabs.json"),
  TWOCAPTCHA_API_KEY: optionalString,
  STAGEHAND_MODEL: z.string().default("google/gemini-2.5-flash"),
  STAGEHAND_API_KEY: optionalString,
  STAGEHAND_USE_CACHE: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
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
    TWOCAPTCHA_API_KEY: parsed.TWOCAPTCHA_API_KEY,
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

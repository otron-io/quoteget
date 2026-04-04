import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { QuoteToolProfile } from "./types.js";

const profileSchema = z.object({
  profileId: z.string().min(1),
  description: z.string().min(1),
  process: z.literal("cnc"),
  fileFormat: z.literal("step"),
  material: z.literal("aluminum_6061"),
  finish: z.literal("standard"),
  quantity: z.number().int().positive(),
  geography: z.literal("us"),
  shipToRegion: z.string().min(1),
  shipToPostalCode: z.string().min(1),
  preferredLeadTime: z.literal("standard"),
});

export const DEFAULT_PROFILE_PATH = "profiles/standard-cnc-6061-us.json";

export async function loadDefaultProfile(cwd: string): Promise<QuoteToolProfile> {
  return loadProfile(path.join(cwd, DEFAULT_PROFILE_PATH));
}

export async function loadProfile(profilePath: string): Promise<QuoteToolProfile> {
  const payload = JSON.parse(await readFile(profilePath, "utf8")) as unknown;
  return profileSchema.parse(payload);
}

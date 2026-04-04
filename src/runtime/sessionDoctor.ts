import { access } from "node:fs/promises";

import { chromium } from "playwright";

import type { BrowserVendorName, QuoteToolEnv } from "../core/types.js";
import { browserStorageStateMap } from "../config/env.js";
import { browserSessionDefinitions } from "./browserSessions.js";

interface DoctorCheck {
  vendor: BrowserVendorName;
  storageStatePath: string;
  exists: boolean;
  valid: boolean;
  detail: string;
}

export async function runDoctor(
  env: QuoteToolEnv,
): Promise<{ ok: boolean; report: string }> {
  const storageMap = browserStorageStateMap(env) as Record<BrowserVendorName, string>;
  const checks: DoctorCheck[] = [];

  for (const vendor of Object.keys(storageMap) as BrowserVendorName[]) {
    const storageStatePath = storageMap[vendor];
    const exists = await fileExists(storageStatePath);
    if (!exists) {
      checks.push({
        vendor,
        storageStatePath,
        exists: false,
        valid: false,
        detail: "missing storage state",
      });
      continue;
    }

    const validation = await validateSession(vendor, storageStatePath);
    checks.push({
      vendor,
      storageStatePath,
      exists: true,
      valid: validation.valid,
      detail: validation.detail,
    });
  }

  const ok = checks.every((check) => check.exists && check.valid);
  const lines = [
    ["Vendor".padEnd(12), "State File".padEnd(8), "Session".padEnd(8), "Detail"].join(" "),
    ...checks.map((check) =>
      [
        check.vendor.padEnd(12),
        (check.exists ? "present" : "missing").padEnd(8),
        (check.valid ? "valid" : "invalid").padEnd(8),
        `${check.detail} (${check.storageStatePath})`,
      ].join(" "),
    ),
  ];

  return {
    ok,
    report: lines.join("\n"),
  };
}

async function validateSession(
  vendor: BrowserVendorName,
  storageStatePath: string,
): Promise<{ valid: boolean; detail: string }> {
  const definition = browserSessionDefinitions[vendor];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: storageStatePath,
      locale: "en-US",
    });
    const page = await context.newPage();
    await page.goto(definition.baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const text = await page.locator("body").innerText().catch(() => "");
    const url = page.url();
    const valid = definition.isAuthenticated(url, text);
    await context.close();
    return {
      valid,
      detail: valid ? "authenticated session looks usable" : "auth gate detected",
    };
  } catch (error) {
    return {
      valid: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

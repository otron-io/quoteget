import { chromium } from "playwright";

import type { BrowserVendorName, QuoteToolEnv } from "../core/types.js";
import { browserSessionDefinitions } from "./browserSessions.js";
import { createBrowserSessionProvider } from "./browserSessionStore.js";

interface DoctorCheck {
  vendor: BrowserVendorName;
  source: string;
  exists: boolean;
  valid: boolean;
  detail: string;
}

export async function runDoctor(
  env: QuoteToolEnv,
): Promise<{ ok: boolean; report: string }> {
  const sessionProvider = createBrowserSessionProvider(env);
  const checks: DoctorCheck[] = [];

  for (const vendor of ["xometry", "rapiddirect", "protolabs"] as BrowserVendorName[]) {
    const session = await sessionProvider.resolve(vendor, vendor === "rapiddirect");
    if (!session) {
      checks.push({
        vendor,
        source: "none",
        exists: false,
        valid: false,
        detail: "missing stored session",
      });
      continue;
    }

    if (session.mode === "anonymous_probe") {
      checks.push({
        vendor,
        source: session.source,
        exists: true,
        valid: true,
        detail: "anonymous probe available; no stored session required",
      });
      continue;
    }

    const validation = await validateSession(vendor, session.storageStatePath!);
    checks.push({
      vendor,
      source: session.source,
      exists: true,
      valid: validation.valid,
      detail: validation.detail,
    });
    await session.cleanup?.();
  }

  const ok = checks.every((check) => check.valid);
  const lines = [
    ["Vendor".padEnd(12), "Source".padEnd(16), "Session".padEnd(8), "Detail"].join(" "),
    ...checks.map((check) =>
      [
        check.vendor.padEnd(12),
        (check.exists ? check.source : "missing").padEnd(16),
        (check.valid ? "valid" : "invalid").padEnd(8),
        check.detail,
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

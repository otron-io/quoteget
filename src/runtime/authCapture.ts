import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { chromium } from "playwright";

import type { BrowserVendorName } from "../core/types.js";
import { browserSessionDefinitions } from "./browserSessions.js";

export async function captureVendorAuthSession(options: {
  vendor: BrowserVendorName;
  storageStatePath: string;
}): Promise<void> {
  const definition = browserSessionDefinitions[options.vendor];
  await mkdir(path.dirname(options.storageStatePath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto(definition.baseUrl, { waitUntil: "domcontentloaded" });

  const rl = readline.createInterface({ input, output });
  try {
    output.write(
      `\nLog in to ${options.vendor} in the opened browser.\n` +
        `When the authenticated quote page is ready, press Enter to save storage state:\n` +
        `${options.storageStatePath}\n\n`,
    );
    await rl.question("");
    await context.storageState({ path: options.storageStatePath });
  } finally {
    rl.close();
    await context.close();
    await browser.close();
  }
}

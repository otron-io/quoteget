import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { chromium } from "playwright";

import type { BrowserVendorName, QuoteToolEnv } from "../core/types.js";
import { createBrowserSessionProvider } from "./browserSessionStore.js";
import { browserSessionDefinitions } from "./browserSessions.js";

export async function captureVendorAuthSession(options: {
  vendor: BrowserVendorName;
  env: QuoteToolEnv;
}): Promise<string> {
  const definition = browserSessionDefinitions[options.vendor];
  const storageStatePath = path.join(
    options.env.storageRootAbs,
    "auth",
    `${options.vendor}.capture.json`,
  );
  await mkdir(path.dirname(storageStatePath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto(definition.baseUrl, { waitUntil: "domcontentloaded" });
  const sessionProvider = createBrowserSessionProvider(options.env);

  const rl = readline.createInterface({ input, output });
  try {
    output.write(
      `\nLog in to ${options.vendor} in the opened browser.\n` +
        `When the authenticated quote page is ready, press Enter to save storage state:\n` +
        `${storageStatePath}\n\n`,
    );
    await rl.question("");
    const location = await sessionProvider.saveAuthenticated(
      options.vendor,
      await context.storageState(),
    );
    output.write(`Saved authenticated session to ${location}\n`);
    return location;
  } finally {
    rl.close();
    await context.close();
    await browser.close();
  }
}

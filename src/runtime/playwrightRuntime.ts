import { access } from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { ArtifactCollector } from "../core/artifactStore.js";

function moneyTokensFromText(text: string): number[] {
  const matches =
    text.match(/(?:USD|EUR|GBP|\$)\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/gi) ?? [];
  return matches
    .map((token) => Number(token.replace(/(?:USD|EUR|GBP|\$|,|\s)/gi, "")))
    .filter((value) => Number.isFinite(value));
}

export interface BrowserSessionConfig {
  vendor: string;
  baseUrl: string;
  storageStatePath: string;
  headed: boolean;
}

export class PlaywrightQuoteRuntime {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly networkEvents: Array<Record<string, unknown>> = [];
  readonly actionLog: Array<Record<string, unknown>> = [];

  private constructor(browser: Browser, context: BrowserContext, page: Page) {
    this.browser = browser;
    this.context = context;
    this.page = page;
  }

  static async create(
    config: BrowserSessionConfig,
    artifacts: ArtifactCollector,
  ): Promise<PlaywrightQuoteRuntime> {
    const storageState =
      (await fileExists(config.storageStatePath)) ? config.storageStatePath : undefined;
    if (!storageState) {
      throw new Error(`Missing browser storage state at ${config.storageStatePath}`);
    }

    const browser = await chromium.launch({
      headless: !config.headed,
    });
    const context = await browser.newContext({
      storageState,
      acceptDownloads: true,
      locale: "en-US",
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();

    const runtime = new PlaywrightQuoteRuntime(browser, context, page);
    runtime.registerNetworkLogging();
    await artifacts.writeJson("session", {
      vendor: config.vendor,
      baseUrl: config.baseUrl,
      storageStatePath: config.storageStatePath,
      headed: config.headed,
    });
    return runtime;
  }

  private registerNetworkLogging(): void {
    this.page.on("request", (request) => {
      this.networkEvents.push({
        type: "request",
        method: request.method(),
        url: request.url(),
        timestamp: new Date().toISOString(),
      });
    });
    this.page.on("response", (response) => {
      this.networkEvents.push({
        type: "response",
        status: response.status(),
        url: response.url(),
        timestamp: new Date().toISOString(),
      });
    });
  }

  private recordAction(action: string, detail: Record<string, unknown> = {}): void {
    this.actionLog.push({
      timestamp: new Date().toISOString(),
      action,
      ...detail,
    });
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    this.recordAction("goto", { url });
  }

  async visibleText(): Promise<string> {
    return this.page.locator("body").innerText().catch(() => "");
  }

  async dismissCommonPopups(extraLabels: string[] = []): Promise<number> {
    const labels = [
      "Allow all",
      "Accept all",
      "Accept",
      "Close",
      "Dismiss",
      "Skip",
      "Skip tour",
      "No thanks",
      "Maybe later",
      "Got it",
      "I understand",
      "Continue",
      ...extraLabels,
    ];

    let dismissed = 0;
    for (const label of labels) {
      dismissed += await this.maybeClickRole(label, "button");
      dismissed += await this.maybeClickRole(label, "link");
    }
    this.recordAction("dismiss_common_popups", { dismissed });
    return dismissed;
  }

  async maybeClickRole(label: string, role: "button" | "link"): Promise<number> {
    const locator =
      role === "button"
        ? this.page.getByRole("button", { name: new RegExp(`^${escapeRegex(label)}$`, "i") })
        : this.page.getByRole("link", { name: new RegExp(`^${escapeRegex(label)}$`, "i") });

    try {
      const first = locator.first();
      if (await first.isVisible({ timeout: 1500 })) {
        await first.click({ timeout: 1500 });
        await this.page.waitForTimeout(250);
        this.recordAction("click_role", { role, label });
        return 1;
      }
    } catch {
      return 0;
    }
    return 0;
  }

  async clickSelector(selectors: string[], description: string): Promise<boolean> {
    for (const selector of selectors) {
      try {
        const locator = this.page.locator(selector).first();
        if (await locator.isVisible({ timeout: 1500 })) {
          await locator.click({ timeout: 3000 });
          await this.page.waitForTimeout(250);
          this.recordAction("click_selector", { selector, description });
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  async fillSelector(selectors: string[], value: string): Promise<boolean> {
    for (const selector of selectors) {
      try {
        const locator = this.page.locator(selector).first();
        if (await locator.isVisible({ timeout: 1500 })) {
          await locator.fill(value, { timeout: 3000 });
          this.recordAction("fill_selector", { selector, value });
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  async uploadPart(filePath: string): Promise<boolean> {
    const input = this.page.locator('input[type="file"]').first();
    try {
      await input.setInputFiles(filePath, { timeout: 5000 });
      this.recordAction("upload_part", { filePath });
      return true;
    } catch {
      return false;
    }
  }

  async waitForPriceNotDash(timeoutMs = 8000): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const text = await this.visibleText();
      if (
        /(?:USD|EUR|GBP|\$)\s*\d/i.test(text) &&
        !/Please configure your part to get a quote\./i.test(text)
      ) {
        this.recordAction("wait_for_price", { status: "materialized" });
        return true;
      }
      await this.page.waitForTimeout(500);
    }
    this.recordAction("wait_for_price", { status: "timeout", timeoutMs });
    return false;
  }

  async collectMoneyTokens(): Promise<number[]> {
    const tokens = moneyTokensFromText(await this.visibleText());
    this.recordAction("collect_money_tokens", { tokens });
    return tokens;
  }

  async screenshot(artifacts: ArtifactCollector, label: string): Promise<void> {
    const filePath = `${artifacts.runDir}/${safeLabel(label)}.png`;
    await this.page.screenshot({ path: filePath, fullPage: true });
    artifacts.files.push(filePath);
  }

  async shutdown(artifacts: ArtifactCollector): Promise<void> {
    const html = await this.page.content().catch(() => "");
    if (html) {
      await artifacts.writeText("final-dom", html, "html");
    }
    await artifacts.writeJson("runtime-action-log", this.actionLog);
    await artifacts.writeJson("network-log", this.networkEvents);
    const tracePath = `${artifacts.runDir}/playwright-trace.zip`;
    await this.context.tracing.stop({ path: tracePath }).catch(() => undefined);
    if (!artifacts.files.includes(tracePath)) {
      artifacts.files.push(tracePath);
    }
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
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

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeLabel(input: string): string {
  return input.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").toLowerCase();
}

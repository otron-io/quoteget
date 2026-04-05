import { readFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright";
import { Stagehand } from "@browserbasehq/stagehand";
import type { AgentConfig, Variables } from "@browserbasehq/stagehand";
import type { z } from "zod";

import type { ArtifactCollector } from "../core/artifactStore.js";
import type { QuoteToolEnv } from "../core/types.js";
import type { BrowserSessionDescriptor } from "./browserSessionStore.js";

export interface StagehandRuntimeConfig {
  vendor: string;
  env: QuoteToolEnv;
  session: BrowserSessionDescriptor;
  headed: boolean;
}

/**
 * A browser runtime backed by Stagehand for AI-driven navigation.
 * Stagehand owns the Chromium instance; we connect Playwright to it via CDP
 * so we can still use the Playwright API for file uploads, tracing, etc.
 */
export class StagehandVendorRuntime {
  readonly stagehand: Stagehand;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly networkEvents: Array<Record<string, unknown>> = [];

  private constructor(
    stagehand: Stagehand,
    context: BrowserContext,
    page: Page,
  ) {
    this.stagehand = stagehand;
    this.context = context;
    this.page = page;
  }

  static async create(
    config: StagehandRuntimeConfig,
    artifacts: ArtifactCollector,
  ): Promise<StagehandVendorRuntime> {
    const cacheDir = path.join(config.env.storageRootAbs, "stagehand-cache");

    // Stagehand accepts either a model name string or an object with { modelName, apiKey }
    // when the provider API key is passed explicitly rather than via env var.
    const model: string | { modelName: string; apiKey: string } = config.env.STAGEHAND_API_KEY
      ? { modelName: config.env.STAGEHAND_MODEL, apiKey: config.env.STAGEHAND_API_KEY }
      : config.env.STAGEHAND_MODEL;

    const stagehand = new Stagehand({
      env: "LOCAL",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      localBrowserLaunchOptions: {
        headless: !config.headed,
        acceptDownloads: true,
        locale: "en-US",
      },
      cacheDir: config.env.STAGEHAND_USE_CACHE ? cacheDir : undefined,
      verbose: 0,
      disablePino: true,
      logger: () => undefined,
    });

    await stagehand.init();

    // Connect Playwright to Stagehand's Chromium via CDP
    const cdpBrowser = await chromium.connectOverCDP(stagehand.connectURL());
    const context = cdpBrowser.contexts()[0]!;
    const page = context.pages()[0] ?? await context.newPage();

    // Inject authenticated session cookies if available
    if (config.session.storageStatePath) {
      await injectStorageState(context, page, config.session.storageStatePath);
    }

    await context.tracing.start({ screenshots: true, snapshots: true }).catch(() => undefined);

    const runtime = new StagehandVendorRuntime(stagehand, context, page);
    runtime.registerNetworkLogging();

    await artifacts.writeJson("session", {
      vendor: config.vendor,
      sessionMode: config.session.mode,
      sessionSource: config.session.source,
      storageStatePath: config.session.storageStatePath,
      headed: config.headed,
      stagehandModel: config.env.STAGEHAND_MODEL,
    });

    return runtime;
  }

  /** Navigate to a URL. */
  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  /** AI-driven single action. */
  async act(instruction: string, variables?: Variables): Promise<boolean> {
    const result = await this.stagehand.act(instruction, {
      page: this.page,
      variables,
    });
    return result.success;
  }

  /** AI-driven structured data extraction. */
  async extract<T extends z.ZodTypeAny>(
    instruction: string,
    schema: T,
  ): Promise<z.infer<T>> {
    return this.stagehand.extract(instruction, schema, { page: this.page });
  }

  /** Run an autonomous multi-step agent task. */
  async runAgentTask(
    instruction: string,
    options?: {
      maxSteps?: number;
      variables?: Variables;
      agentConfig?: Omit<AgentConfig, "stream">;
    },
  ): Promise<{ output: string; completed: boolean }> {
    const agent = this.stagehand.agent({
      mode: "dom",
      ...options?.agentConfig,
      stream: false,
    });

    const result = await agent.execute({
      instruction,
      maxSteps: options?.maxSteps ?? 40,
      page: this.page,
      variables: options?.variables,
    });

    return {
      output: result.message ?? "",
      completed: result.completed,
    };
  }

  /**
   * Register a file chooser interceptor. Any time a file chooser dialog opens
   * (triggered by an agent click or Playwright action), it is automatically
   * accepted with the given file path. Call this once before the agent runs.
   */
  registerFileChooserInterceptor(filePath: string): void {
    this.page.on("filechooser", async (chooser) => {
      await chooser.setFiles(filePath).catch(() => undefined);
    });
  }

  /** Upload a file to a file input on the current page (Playwright-native, not AI). */
  async uploadFile(filePath: string): Promise<boolean> {
    try {
      const input = this.page.locator('input[type="file"]').first();
      await input.setInputFiles(filePath, { timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Export the current browser storage state (cookies + localStorage). */
  async exportStorageState(): Promise<Record<string, unknown>> {
    return this.context.storageState() as Promise<Record<string, unknown>>;
  }

  /** Get all visible text on the current page. */
  async visibleText(): Promise<string> {
    return this.page.locator("body").innerText().catch(() => "");
  }

  /** Take a screenshot and save it as an artifact. */
  async screenshot(artifacts: ArtifactCollector, label: string): Promise<void> {
    const safeLabel = label.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").toLowerCase();
    const filePath = `${artifacts.runDir}/${safeLabel}.png`;
    await this.page.screenshot({ path: filePath, fullPage: true }).catch(() => undefined);
    artifacts.files.push(filePath);
  }

  /** Save final DOM, network log, and Playwright trace as artifacts. */
  async shutdown(artifacts: ArtifactCollector): Promise<void> {
    const html = await this.page.content().catch(() => "");
    if (html) {
      await artifacts.writeText("final-dom", html, "html");
    }
    await artifacts.writeJson("network-log", this.networkEvents);
    const tracePath = `${artifacts.runDir}/playwright-trace.zip`;
    await this.context.tracing.stop({ path: tracePath }).catch(() => undefined);
    if (!artifacts.files.includes(tracePath)) {
      artifacts.files.push(tracePath);
    }
    await this.context.close().catch(() => undefined);
    await this.stagehand.close().catch(() => undefined);
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
}

/**
 * Inject a Playwright storage state JSON file into a browser context.
 * Loads cookies and, if possible, localStorage entries.
 */
async function injectStorageState(
  context: BrowserContext,
  page: Page,
  storageStatePath: string,
): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(storageStatePath, "utf8")) as {
      cookies?: Parameters<BrowserContext["addCookies"]>[0];
      origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
    };

    if (raw.cookies?.length) {
      await context.addCookies(raw.cookies).catch(() => undefined);
    }

    if (raw.origins?.length) {
      for (const origin of raw.origins) {
        if (!origin.localStorage?.length) continue;
        try {
          await page.goto(origin.origin, { waitUntil: "domcontentloaded", timeout: 8000 });
          await page.evaluate((entries) => {
            for (const { name, value } of entries) {
              localStorage.setItem(name, value);
            }
          }, origin.localStorage);
        } catch {
          // Best-effort: if we can't navigate to this origin, skip localStorage
        }
      }
    }
  } catch (err) {
    // If the storage state file can't be read/parsed, proceed without it but log
    console.warn(`[stagehand] Could not inject storage state from ${storageStatePath}:`, err instanceof Error ? err.message : String(err));
  }
}

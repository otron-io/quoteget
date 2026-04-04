import path from "node:path";

import { storageStateExists } from "../config/env.js";
import { ArtifactCollector } from "../core/artifactStore.js";
import { fingerprintFile } from "../core/fingerprint.js";
import { buildVendorNormalizedConfig } from "../core/normalizer.js";
import type {
  BrowserVendorName,
  IntegrationTier,
  VendorExecutionContext,
  VendorName,
  VendorNormalizedConfig,
  VendorQuoteResult,
  VendorStatus,
} from "../core/types.js";
import {
  ensureProtolabsEphemeralSession,
  ensureRapidDirectEphemeralSession,
  ensureXometryEphemeralSession,
} from "../runtime/ephemeralSessions.js";
import { PlaywrightQuoteRuntime } from "../runtime/playwrightRuntime.js";

export interface VendorAdapter<
  TPrepared = unknown,
  TRaw = unknown,
> {
  readonly vendor: VendorName;
  readonly integrationTier: IntegrationTier;
  prepare(ctx: VendorExecutionContext): Promise<TPrepared>;
  quote(ctx: TPrepared): Promise<TRaw>;
  classify(raw: TRaw, ctx: TPrepared): Promise<VendorQuoteResult>;
  collectArtifacts(result: VendorQuoteResult, raw: TRaw, ctx: TPrepared): Promise<void>;
  run(ctx: VendorExecutionContext): Promise<VendorQuoteResult>;
}

export class VendorFailure extends Error {
  readonly code: string;
  readonly note?: string;
  readonly status: VendorStatus;

  constructor(code: string, message: string, status: VendorStatus = "failed", note?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.note = note;
  }
}

export interface PreparedVendorContext {
  execution: VendorExecutionContext;
  collector: ArtifactCollector;
  normalizedConfig: VendorNormalizedConfig;
}

export interface BrowserExtraction {
  quoteId?: string;
  price?: number;
  currency?: string;
  leadTime?: string;
  material?: string;
  error?: string;
  failureCode?: string;
  rawExtracted?: Record<string, unknown>;
}

export interface BrowserStepResult {
  outcome: "success" | "manual_review_required" | "failed" | "not_supported";
  note?: string;
  failureCode?: string;
  data?: Record<string, unknown>;
}

export interface BrowserStepLogEntry {
  id: string;
  description: string;
  outcome: BrowserStepResult["outcome"];
  note?: string;
  failureCode?: string;
}

export interface BrowserPreparedContext extends PreparedVendorContext {
  runtime: PlaywrightQuoteRuntime;
  storageStatePath: string;
  partFingerprint: string;
  extraction: BrowserExtraction;
  stepLog: BrowserStepLogEntry[];
  addExtraction: (patch: Partial<BrowserExtraction>) => void;
}

export interface BrowserQuoteRawResult {
  status: VendorStatus;
  note?: string;
  failureCode?: string;
  extraction: BrowserExtraction;
  stepLog: BrowserStepLogEntry[];
}

export interface BrowserVendorStep {
  id: string;
  description: string;
  run: (ctx: BrowserPreparedContext) => Promise<BrowserStepResult>;
}

export abstract class BrowserVendorAdapter
  implements VendorAdapter<BrowserPreparedContext, BrowserQuoteRawResult>
{
  abstract readonly vendor: BrowserVendorName;
  readonly integrationTier = "browser" as const;
  abstract readonly baseUrl: string;

  protected abstract storageStatePath(env: VendorExecutionContext["env"]): string;
  protected abstract buildSteps(ctx: BrowserPreparedContext): BrowserVendorStep[];

  async prepare(execution: VendorExecutionContext): Promise<BrowserPreparedContext> {
    const collector = await ArtifactCollector.create(execution.artifactRoot, [
      "vendors",
      this.vendor,
    ]);
    const normalizedConfig = buildVendorNormalizedConfig(execution.request, this.vendor);
    const storageStatePath = this.storageStatePath(execution.env);
    const hasSavedSession = storageStateExists(storageStatePath);

    const runtime = await PlaywrightQuoteRuntime.create(
      {
        vendor: this.vendor,
        baseUrl: this.baseUrl,
        storageStatePath: hasSavedSession ? storageStatePath : undefined,
        headed: execution.env.QUOTE_TOOL_HEADED,
      },
      collector,
    );

    if (!hasSavedSession) {
      try {
        if (this.vendor === "rapiddirect") {
          await ensureRapidDirectEphemeralSession(runtime);
        } else if (this.vendor === "xometry") {
          await ensureXometryEphemeralSession(runtime);
        } else if (this.vendor === "protolabs") {
          const key = execution.env.TWOCAPTCHA_API_KEY;
          if (!key) {
            throw new VendorFailure(
              "session_missing",
              "Missing browser storage state for protolabs and no TWOCAPTCHA_API_KEY is set for automatic signup.",
            );
          }
          await ensureProtolabsEphemeralSession(runtime, key);
        }
      } catch (error) {
        await collector.writeJson("preflight-error", {
          failureCode: "ephemeral_session_failed",
          storageStatePath,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error instanceof VendorFailure
          ? error
          : new VendorFailure(
              "ephemeral_session_failed",
              error instanceof Error ? error.message : String(error),
            );
      }
    }

    const prepared: BrowserPreparedContext = {
      execution,
      collector,
      normalizedConfig,
      runtime,
      storageStatePath,
      partFingerprint: await fingerprintFile(execution.inputFilePath),
      extraction: {},
      stepLog: [],
      addExtraction(patch) {
        Object.assign(this.extraction, patch);
      },
    };

    return prepared;
  }

  async quote(ctx: BrowserPreparedContext): Promise<BrowserQuoteRawResult> {
    let status: VendorStatus = "failed";
    let note: string | undefined;
    let failureCode: string | undefined;

    for (const step of this.buildSteps(ctx)) {
      const result = await step.run(ctx);
      ctx.stepLog.push({
        id: step.id,
        description: step.description,
        outcome: result.outcome,
        note: result.note,
        failureCode: result.failureCode,
      });
      await ctx.runtime.screenshot(ctx.collector, `${this.vendor}-${step.id}-${result.outcome}`);

      if (result.data) {
        ctx.addExtraction({
          rawExtracted: {
            ...(ctx.extraction.rawExtracted ?? {}),
            ...result.data,
          },
        });
      }

      if (result.outcome === "manual_review_required") {
        status = "manual_review_required";
        note = result.note;
        failureCode = result.failureCode;
        break;
      }

      if (result.outcome === "not_supported") {
        status = "not_supported";
        note = result.note;
        failureCode = result.failureCode;
        break;
      }

      if (result.outcome === "failed") {
        status = "failed";
        note = result.note;
        failureCode = result.failureCode;
        break;
      }
    }

    if (ctx.extraction.price !== undefined && status === "failed") {
      status = "quoted";
    }
    if (ctx.extraction.price !== undefined && note === undefined) {
      status = "quoted";
    }

    return {
      status,
      note,
      failureCode: failureCode ?? ctx.extraction.failureCode,
      extraction: ctx.extraction,
      stepLog: ctx.stepLog,
    };
  }

  async classify(raw: BrowserQuoteRawResult, ctx: BrowserPreparedContext): Promise<VendorQuoteResult> {
    return {
      vendor: this.vendor,
      status: raw.status,
      price: raw.extraction.price,
      currency: raw.extraction.currency,
      leadTime: raw.extraction.leadTime,
      material: raw.extraction.material ?? ctx.normalizedConfig.material,
      error:
        raw.status === "failed" || raw.status === "not_supported"
          ? raw.note ?? raw.extraction.error ?? raw.failureCode
          : undefined,
      integrationTier: this.integrationTier,
      quoteId: raw.extraction.quoteId,
      normalizedConfig: ctx.normalizedConfig,
      artifactRef: {
        runDir: ctx.collector.runDir,
        files: [...ctx.collector.files],
      },
    };
  }

  async collectArtifacts(
    result: VendorQuoteResult,
    raw: BrowserQuoteRawResult,
    ctx: BrowserPreparedContext,
  ): Promise<void> {
    await ctx.collector.writeJson("step-log", raw.stepLog);
    await ctx.collector.writeJson("raw-result", raw);
    await ctx.collector.writeJson("result", result);
  }

  async run(execution: VendorExecutionContext): Promise<VendorQuoteResult> {
    let prepared: BrowserPreparedContext | undefined;
    try {
      prepared = await this.prepare(execution);
      const raw = await this.quote(prepared);
      const result = await this.classify(raw, prepared);
      await this.collectArtifacts(result, raw, prepared);
      return {
        ...result,
        artifactRef: {
          runDir: prepared.collector.runDir,
          files: [...prepared.collector.files],
        },
      };
    } catch (error) {
      const collector =
        prepared?.collector ??
        (await ArtifactCollector.create(execution.artifactRoot, ["vendors", this.vendor]));
      const normalizedConfig = buildVendorNormalizedConfig(execution.request, this.vendor);
      const failure = error instanceof VendorFailure
        ? error
        : new VendorFailure("runtime_error", error instanceof Error ? error.message : String(error));

      await collector.writeJson("error", {
        code: failure.code,
        message: failure.message,
      });

      return {
        vendor: this.vendor,
        status: failure.status,
        error: failure.note ?? failure.message,
        integrationTier: this.integrationTier,
        normalizedConfig,
        artifactRef: {
          runDir: collector.runDir,
          files: [...collector.files],
        },
      };
    } finally {
      if (prepared) {
        await prepared.runtime.shutdown(prepared.collector);
      }
    }
  }
}

export function success(note?: string): BrowserStepResult {
  return { outcome: "success", note };
}

export function manualReview(note: string, failureCode = "manual_review_required"): BrowserStepResult {
  return { outcome: "manual_review_required", note, failureCode };
}

export function notSupported(note: string, failureCode = "not_supported"): BrowserStepResult {
  return { outcome: "not_supported", note, failureCode };
}

export function failed(note: string, failureCode = "vendor_failed"): BrowserStepResult {
  return { outcome: "failed", note, failureCode };
}

export function pickLikelySubtotal(tokens: number[]): number | undefined {
  const sorted = [...tokens].sort((a, b) => a - b);
  return sorted.find((value) => value > 1);
}

export function parseQuoteId(text: string): string | undefined {
  const match = text.match(/\b(?:QC\d{5,}|Q\d[\d-]{4,})\b/i);
  return match?.[0];
}

export function rememberPriceSignals(ctx: BrowserPreparedContext, text: string, tokens: number[]): void {
  const price = pickLikelySubtotal(tokens);
  ctx.addExtraction({
    quoteId: parseQuoteId(text),
    currency: price ? "USD" : undefined,
    price,
    material: ctx.extraction.material ?? materialFromVisibleText(text),
    rawExtracted: {
      ...(ctx.extraction.rawExtracted ?? {}),
      visibleTextExcerpt: text.slice(0, 5000),
      moneyTokens: tokens,
    },
  });
}

export function projectNameForPart(partPath: string): string {
  const stem = path.basename(partPath).replace(/\.[^.]+$/, "");
  const cleaned = stem.replace(/[-_]+/g, " ").trim();
  return cleaned.slice(0, 40) || "CNC Quote";
}

function materialFromVisibleText(text: string): string | undefined {
  const patterns = [
    /Aluminum 6061-T651\/T6/i,
    /Aluminum 6061/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern)?.[0];
    if (match) {
      return match;
    }
  }

  return undefined;
}

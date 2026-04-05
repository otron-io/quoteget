import type { Variables } from "@browserbasehq/stagehand";

import { ArtifactCollector } from "../core/artifactStore.js";
import { buildVendorNormalizedConfig } from "../core/normalizer.js";
import { generateFakeIdentity, type FakeIdentity } from "../core/fakeIdentity.js";
import type {
  BrowserVendorName,
  VendorExecutionContext,
  VendorNormalizedConfig,
  VendorQuoteResult,
  VendorStatus,
} from "../core/types.js";
import { fingerprintFile } from "../core/fingerprint.js";
import {
  createBrowserSessionProvider,
  type BrowserSessionDescriptor,
} from "../runtime/browserSessionStore.js";
import { StagehandVendorRuntime } from "../runtime/stagehandRuntime.js";
import type { VendorAdapter } from "./base.js";
import { VendorFailure } from "./base.js";

export interface AgentQuoteTask {
  startUrl: string;
  instruction: string;
  maxSteps?: number;
  variables?: Variables;
}

export interface AgentSignupTask {
  startUrl: string;
  instruction: string;
  maxSteps?: number;
  /** After signup, navigate here to confirm auth before saving session. */
  confirmUrl?: string;
}

export interface AgentExtraction {
  price?: number;
  currency?: string;
  leadTime?: string;
  material?: string;
  quoteId?: string;
  error?: string;
  rawOutput?: string;
}

export interface AgentPreparedContext {
  execution: VendorExecutionContext;
  collector: ArtifactCollector;
  normalizedConfig: VendorNormalizedConfig;
  runtime: StagehandVendorRuntime;
  session: BrowserSessionDescriptor;
  extraction: AgentExtraction;
  addExtraction: (patch: Partial<AgentExtraction>) => void;
}

export abstract class AgentVendorAdapter
  implements VendorAdapter<AgentPreparedContext, AgentExtraction>
{
  abstract readonly vendor: BrowserVendorName;
  readonly integrationTier = "browser" as const;

  protected abstract buildAgentTask(ctx: AgentPreparedContext): AgentQuoteTask;

  /**
   * Return signup instructions so the app can auto-create an account when no
   * session exists. Return null to disable auto-signup for this vendor.
   */
  protected buildSignupTask(_identity: FakeIdentity): AgentSignupTask | null {
    return null;
  }

  /** Called before the agent runs. Use for Playwright setup (file chooser interceptor, network listeners). */
  protected async beforeAgent(_ctx: AgentPreparedContext): Promise<void> {}

  protected parseAgentOutput(output: string, ctx: AgentPreparedContext): Partial<AgentExtraction> {
    return parseDefaultAgentOutput(output, ctx);
  }

  async prepare(execution: VendorExecutionContext): Promise<AgentPreparedContext> {
    const collector = await ArtifactCollector.create(execution.artifactRoot, [
      "vendors",
      this.vendor,
    ]);
    const normalizedConfig = buildVendorNormalizedConfig(execution.request, this.vendor);

    const sessionProvider = createBrowserSessionProvider(execution.env);
    let session = await sessionProvider.resolve(this.vendor, false).catch(async (error) => {
      const failure = error instanceof VendorFailure
        ? error
        : new VendorFailure("runtime_error", error instanceof Error ? error.message : String(error));
      await collector.writeJson("preflight-error", { failureCode: failure.code, message: failure.message });
      throw failure;
    });

    // No session — try to auto-create an account
    if (!session) {
      const identity = generateFakeIdentity();
      const signupTask = this.buildSignupTask(identity);

      if (!signupTask) {
        const failure = new VendorFailure("auth_required", `Missing browser session for ${this.vendor}.`, "auth_required");
        await collector.writeJson("preflight-error", { failureCode: failure.code, message: failure.message });
        throw failure;
      }

      await collector.writeJson("auto-signup-identity", {
        vendor: this.vendor,
        email: identity.email,
        company: identity.company,
        note: "auto-generated fake account",
      });

      session = await this.runAutoSignup(execution, identity, signupTask, collector);

      await collector.writeJson("auto-signup-result", {
        vendor: this.vendor,
        success: true,
        sessionSource: session.source,
      });
    }

    const runtime = await StagehandVendorRuntime.create(
      { vendor: this.vendor, env: execution.env, session, headed: execution.env.QUOTE_TOOL_HEADED },
      collector,
    ).catch(async (error) => {
      await session!.cleanup?.();
      throw error;
    });

    const extraction: AgentExtraction = {};
    const prepared: AgentPreparedContext = {
      execution,
      collector,
      normalizedConfig,
      runtime,
      session,
      extraction,
      addExtraction(patch) { Object.assign(this.extraction, patch); },
    };
    return prepared;
  }

  async quote(ctx: AgentPreparedContext): Promise<AgentExtraction> {
    const task = this.buildAgentTask(ctx);

    await ctx.runtime.goto(task.startUrl);
    await ctx.runtime.screenshot(ctx.collector, `${this.vendor}-start`);

    await this.beforeAgent(ctx);

    const { output, completed } = await ctx.runtime.runAgentTask(task.instruction, {
      maxSteps: task.maxSteps ?? 40,
      variables: task.variables,
    });

    await ctx.runtime.screenshot(ctx.collector, `${this.vendor}-after-agent`);

    const parsed = this.parseAgentOutput(output, ctx);
    ctx.addExtraction({ ...parsed, rawOutput: output });
    await ctx.collector.writeJson("agent-output", { output, completed, extraction: ctx.extraction });

    return ctx.extraction;
  }

  async classify(extraction: AgentExtraction, ctx: AgentPreparedContext): Promise<VendorQuoteResult> {
    let status: VendorStatus;
    let error: string | undefined;

    if (extraction.price !== undefined) {
      status = "quoted";
    } else if (/rfq|request.{0,10}quote|manual.{0,10}review|quote request needed/i.test(extraction.error ?? "")) {
      status = "manual_review_required";
      error = extraction.error;
    } else if (/auth|login|sign.?in/i.test(extraction.error ?? "")) {
      status = "auth_required";
      error = extraction.error;
    } else if (/captcha/i.test(extraction.error ?? "")) {
      status = "failed";
      error = extraction.error;
    } else {
      status = "failed";
      error = extraction.error ?? "Agent did not return a price.";
    }

    return {
      vendor: this.vendor,
      status,
      price: extraction.price,
      currency: extraction.currency,
      leadTime: extraction.leadTime,
      material: extraction.material ?? ctx.normalizedConfig.material,
      error: status === "quoted" ? undefined : error,
      integrationTier: this.integrationTier,
      quoteId: extraction.quoteId,
      normalizedConfig: ctx.normalizedConfig,
      artifactRef: { runDir: ctx.collector.runDir, files: [...ctx.collector.files] },
    };
  }

  async collectArtifacts(
    result: VendorQuoteResult,
    extraction: AgentExtraction,
    ctx: AgentPreparedContext,
  ): Promise<void> {
    await ctx.collector.writeJson("raw-result", extraction);
    await ctx.collector.writeJson("result", result);
  }

  async run(execution: VendorExecutionContext): Promise<VendorQuoteResult> {
    let prepared: AgentPreparedContext | undefined;
    try {
      prepared = await this.prepare(execution);
      const raw = await this.quote(prepared);
      const result = await this.classify(raw, prepared);
      await this.collectArtifacts(result, raw, prepared);
      return { ...result, artifactRef: { runDir: prepared.collector.runDir, files: [...prepared.collector.files] } };
    } catch (error) {
      const collector = prepared?.collector
        ?? (await ArtifactCollector.create(execution.artifactRoot, ["vendors", this.vendor]));
      const normalizedConfig = buildVendorNormalizedConfig(execution.request, this.vendor);
      const failure = error instanceof VendorFailure
        ? error
        : new VendorFailure("runtime_error", error instanceof Error ? error.message : String(error));
      await collector.writeJson("error", { code: failure.code, message: failure.message });
      return {
        vendor: this.vendor,
        status: failure.status,
        error: failure.note ?? failure.message,
        failureCode: failure.code,
        integrationTier: this.integrationTier,
        normalizedConfig,
        artifactRef: { runDir: collector.runDir, files: [...collector.files] },
      };
    } finally {
      if (prepared) {
        await prepared.runtime.shutdown(prepared.collector);
        await prepared.session.cleanup?.();
      }
    }
  }

  /**
   * Fill a registration/signup form. Values go directly to the browser via
   * Stagehand variables — the LLM only sees placeholder names, never actual values.
   */
  protected async fillRegistrationForm(
    ctx: AgentPreparedContext,
    fields: Record<string, string>,
    instruction?: string,
  ): Promise<void> {
    const variables: Variables = {};
    const placeholders = Object.keys(fields).map((key) => `${key}: %${key}%`).join(", ");
    for (const [key, value] of Object.entries(fields)) {
      variables[key] = { value, description: `Registration field: ${key}` };
    }
    await ctx.runtime.act(
      instruction ?? `Fill the registration form with: ${placeholders}. Then submit.`,
      variables,
    );
  }

  private async runAutoSignup(
    execution: VendorExecutionContext,
    identity: FakeIdentity,
    task: AgentSignupTask,
    collector: ArtifactCollector,
  ): Promise<BrowserSessionDescriptor> {
    const sessionProvider = createBrowserSessionProvider(execution.env);

    // Use a temporary anonymous session descriptor for the signup browser
    const anonSession: BrowserSessionDescriptor = {
      vendor: this.vendor,
      mode: "anonymous_probe",
      status: "anonymous_probe",
      source: "anonymous_probe",
      createdAt: new Date().toISOString(),
    };

    const runtime = await StagehandVendorRuntime.create(
      { vendor: this.vendor, env: execution.env, session: anonSession, headed: execution.env.QUOTE_TOOL_HEADED },
      collector,
    );

    try {
      await runtime.goto(task.startUrl);

      const variables: Variables = {
        firstName: { value: identity.firstName, description: "First name" },
        lastName: { value: identity.lastName, description: "Last name" },
        fullName: { value: identity.fullName, description: "Full name" },
        email: { value: identity.email, description: "Email address" },
        company: { value: identity.company, description: "Company name" },
        phone: { value: identity.phone, description: "Phone number" },
        password: { value: identity.password, description: "Account password" },
      };

      const { output, completed } = await runtime.runAgentTask(task.instruction, {
        maxSteps: task.maxSteps ?? 50,
        variables,
      });

      if (!completed) {
        throw new VendorFailure("signup_failed", `Auto-signup for ${this.vendor} did not complete.`);
      }

      // Detect failure signals in the agent's output text
      if (/email.{0,20}verif|verify.{0,20}email|check.{0,20}email/i.test(output)) {
        throw new VendorFailure("signup_email_verification_required", `Auto-signup for ${this.vendor} requires email verification.`);
      }
      if (/captcha/i.test(output)) {
        throw new VendorFailure("signup_captcha", `Auto-signup for ${this.vendor} was blocked by a CAPTCHA.`);
      }

      if (task.confirmUrl) {
        await runtime.goto(task.confirmUrl);
        await runtime.page.waitForTimeout(2000);

        // Confirm we landed on the expected page, not a login redirect
        const currentUrl = runtime.page.url();
        if (currentUrl.includes("login") || currentUrl.includes("sign-in") || currentUrl.includes("signin")) {
          throw new VendorFailure("signup_failed", `Auto-signup for ${this.vendor} did not result in an authenticated session (landed on ${currentUrl}).`);
        }
      }

      const storageState = await runtime.exportStorageState();
      const savedPath = await sessionProvider.saveAuthenticated(this.vendor, storageState);

      return {
        vendor: this.vendor,
        mode: "authenticated_session",
        status: "active",
        source: "legacy_storage_state",
        createdAt: new Date().toISOString(),
        storageStatePath: savedPath,
      };
    } finally {
      await runtime.shutdown(collector);
    }
  }
}

// Matches explicit currency prefix: $108.63, USD 108.63, EUR 50.00
const MONEY_EXPLICIT_RE = /(?:USD|EUR|GBP|\$)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi;
// Matches "Total: 108.63" or "Price: 1,234.56" style (no currency prefix)
const MONEY_LABEL_RE = /(?:total|price|cost|amount|subtotal)[:\s]+(\d{1,3}(?:,\d{3})*\.\d{2})\b/gi;
const LEAD_TIME_RE = /(\d+)\s*(?:business\s+)?(?:calendar\s+)?days?(?:\s+(?:lead\s+time|to\s+ship|delivery))?/i;

function parseDefaultAgentOutput(
  output: string,
  ctx: AgentPreparedContext,
): Partial<AgentExtraction> {
  const result: Partial<AgentExtraction> = {};

  // Prefer explicit currency matches first; fall back to labeled amounts
  const explicitMatches = [...output.matchAll(MONEY_EXPLICIT_RE)];
  const labelMatches = explicitMatches.length === 0 ? [...output.matchAll(MONEY_LABEL_RE)] : [];
  const allMatches = explicitMatches.length > 0 ? explicitMatches : labelMatches;

  if (allMatches.length > 0) {
    const amounts = allMatches
      .map((m) => Number.parseFloat(m[1].replace(/,/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0 && n < 1_000_000);
    if (amounts.length > 0) {
      result.price = amounts.at(-1);
      result.currency = "USD";
    }
  }

  const leadMatch = output.match(LEAD_TIME_RE);
  if (leadMatch) {
    result.leadTime = leadMatch[0];
  }

  const expectedMaterial = ctx.normalizedConfig.material;
  if (new RegExp(escapeRegExp(expectedMaterial), "i").test(output)) {
    result.material = expectedMaterial;
  }

  if (!result.price) {
    if (/rfq|request.{0,10}quote|manual.{0,10}review|get.{0,10}custom.{0,10}quote/i.test(output)) {
      result.error = "Manual review required: vendor requires an RFQ for this part.";
    } else if (/authentication required|login required|sign.?in required|not logged in/i.test(output)) {
      result.error = "Vendor requires authentication.";
    } else if (/login|sign.?in/i.test(output) && !/sign.?in.*successful|signed.?in/i.test(output)) {
      result.error = "Vendor requires authentication.";
    } else if (/captcha/i.test(output)) {
      result.error = "CAPTCHA challenge encountered.";
    } else {
      result.error = output.slice(0, 300) || "Agent did not find a price.";
    }
  }

  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

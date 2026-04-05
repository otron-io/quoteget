import type { Locator, Page } from "playwright";
import { z } from "zod";

import type { AgentExtraction, AgentPreparedContext, AgentQuoteTask, AgentSignupTask } from "./agentBase.js";
import { AgentVendorAdapter } from "./agentBase.js";
import { generateFakeIdentity, type FakeIdentity } from "../core/fakeIdentity.js";

const rapidDirectLeadIdentityCache = new WeakMap<AgentPreparedContext, FakeIdentity>();

export class RapidDirectAdapter extends AgentVendorAdapter {
  readonly vendor = "rapiddirect" as const;

  protected buildAgentTask(ctx: AgentPreparedContext): AgentQuoteTask {
    const { quantity } = ctx.execution.request;
    const { material } = ctx.normalizedConfig;

    return {
      startUrl: "https://app.rapiddirect.com/",
      instruction: `
You are getting a CNC machining quote on RapidDirect (app.rapiddirect.com).

Goal: upload the part file, configure it for CNC machining with ${material} material and quantity ${quantity}, and get a price in USD.

Important notes:
- If you see a login page at any point, stop and report "Authentication required."
- The file upload will be handled automatically when you trigger the file chooser — just click the upload area and wait.
- Dismiss tours and tip overlays, but do not close any form that asks for company, job role, or phone details to unlock instant pricing.
- If you see a "Go to Complete" step or a form asking for company/job role/phone, complete it with plausible business details and continue.
- For the finish/surface treatment, pick the simplest default option (e.g. "as machined") so pricing can proceed without extra inputs.
- If RapidDirect shows multiple delivery options such as Standard, Economy, and Expedited, use the Standard option as the canonical quote and report that price and lead time from the same visible card.
- After configuring, confirm/apply the settings and wait for a price to appear.

Report: total price in USD, lead time in business days, material confirmed.
If no price appears: report exactly what the page shows instead.
If CAPTCHA appears: stop and report "CAPTCHA encountered."
      `.trim(),
      maxSteps: 70,
    };
  }

  protected async beforeAgent(ctx: AgentPreparedContext): Promise<void> {
    ctx.runtime.registerFileChooserInterceptor(ctx.execution.inputFilePath);
    await seedRapidDirectGuideState(ctx);
    await hardenRapidDirectPageLifecycle(ctx);
    void monitorRapidDirectQuoteState(ctx);

    await ctx.runtime.context.route("**/rapiddirect.com/api/**", async (route) => {
      const url = route.request().url();

      if (url.includes("article_type=2") || url.includes("article_type=3") || url.includes("63aaa9048c430")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ code: 0, data: { list: [], total: 0 }, msg: "success" }),
        });
        return;
      }

      // For quote detail endpoint, capture the response body before continuing
      if (url.includes("6047361aa5aa3")) {
        const response = await route.fetch();
        const body = await response.text();
        try {
          const json = JSON.parse(body) as Record<string, unknown>;
          const extracted = extractFromRapidDirectResponse(json);
          if (extracted) {
            addRapidDirectExtraction(ctx, extracted);
            void ctx.collector.writeJson("rapiddirect-quote-api", json);
          }
        } catch {
          // Non-JSON — ignore
        }
        await route.fulfill({ response });
        return;
      }

      await route.continue();
    });

    ctx.runtime.page.on("response", async (response) => {
      const url = response.url();
      if (!/app\.rapiddirect\.com\/api\//i.test(url) || response.status() >= 400) {
        return;
      }

      try {
        const body = await response.json() as Record<string, unknown>;
        const extracted = extractFromRapidDirectResponse(body);
        if (!extracted) {
          return;
        }

        addRapidDirectExtraction(ctx, extracted);
        await ctx.collector.writeJson(`rapiddirect-api-${apiArtifactLabel(url)}`, body);
      } catch {
        // Non-JSON or unreadable payload — ignore.
      }
    });

    const filePath = ctx.execution.inputFilePath;
    const page = ctx.runtime.page;
    void (async () => {
      let uploaded = false;
      for (let i = 0; i < 60 && !uploaded; i++) {
        await page.waitForTimeout(3000).catch(() => undefined);
        try {
          if (!page.url().includes("rapiddirect.com")) continue;
          const input = page.locator('input[type="file"]').first();
          if (await input.count() > 0) {
            await input.setInputFiles(filePath, { timeout: 5000 });
            uploaded = true;
          }
        } catch {
          // Ignore — page may be navigating
        }
      }
    })();
  }

  protected buildSignupTask(identity: FakeIdentity): AgentSignupTask {
    return {
      startUrl: "https://app.rapiddirect.com/register",
      confirmUrl: "https://app.rapiddirect.com/",
      instruction: `
Create an account on RapidDirect.

Fill in the registration form with:
- Full name or first/last name: %fullName%
- Email: %email%
- Company: %company%
- Phone: %phone%
- Password: %password%

Submit the form. If a CAPTCHA appears, solve it.
If email verification is required, stop and report "Email verification required."
`.trim(),
      maxSteps: 30,
    };
  }

  protected parseAgentOutput(output: string, ctx: AgentPreparedContext): Partial<AgentExtraction> {
    if (hasMeaningfulRapidDirectExtraction(ctx.extraction)) {
      return {
        ...super.parseAgentOutput(output, ctx),
        ...ctx.extraction,
        rawOutput: output,
      };
    }
    return super.parseAgentOutput(output, ctx);
  }

  override async quote(ctx: AgentPreparedContext): Promise<AgentExtraction> {
    let agentError: unknown;
    try {
      await Promise.race([
        super.quote(ctx),
        delay(75_000).then(() => {
          throw new Error("RapidDirect agent timed out while awaiting a stable quote state.");
        }),
      ]);
    } catch (error) {
      agentError = error;
      await ctx.collector.writeJson("rapiddirect-agent-error", {
        message: error instanceof Error ? error.message : String(error),
        extraction: ctx.extraction,
      });
    }

    if (!ctx.runtime.page.isClosed()) {
      await captureRapidDirectQuoteSnapshot(ctx, "post-agent");
      await enrichRapidDirectQuoteFromVisiblePage(ctx);
    }

    if (hasResolvedRapidDirectExtraction(ctx.extraction)) {
      return ctx.extraction;
    }

    if (ctx.runtime.page.isClosed()) {
      if (agentError) {
        throw agentError;
      }
      return ctx.extraction;
    }

    if (!isRapidDirectQuoteDetailUrl(ctx.runtime.page.url())) {
      if (agentError) {
        throw agentError;
      }
      return ctx.extraction;
    }

    await bestEffortDismissRapidDirectGuideOverlays(ctx.runtime.page);
    await bestEffortConfigureQuoteDetail(ctx);
    await captureRapidDirectQuoteSnapshot(ctx, "post-configure");
    await bestEffortSubmitCouponPopup(ctx);
    await captureRapidDirectQuoteSnapshot(ctx, "post-coupon");
    await waitForRapidDirectPricing(ctx);
    await captureRapidDirectQuoteSnapshot(ctx, "post-pricing");

    if (agentError && !hasResolvedRapidDirectExtraction(ctx.extraction)) {
      throw agentError;
    }

    return ctx.extraction;
  }
}

export function extractFromRapidDirectResponse(body: Record<string, unknown>): Partial<AgentExtraction> | null {
  const data = asRecord(body.data) ?? body;
  const attachQuoteList = Array.isArray(data.attachQuoteList)
    ? data.attachQuoteList.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item != null)
    : [];
  const parts = Array.isArray(data.parts_base_info)
    ? data.parts_base_info.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item != null)
    : [];
  const attachParts = attachQuoteList.flatMap((attach) =>
    Array.isArray(attach.partsList)
      ? attach.partsList.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item != null)
      : [],
  );

  const price =
    toPositiveNumber(data.quote_price)
    ?? attachQuoteList.map((item) => toPositiveNumber(item.quote_price)).find((item) => item != null)
    ?? findNumber(data, ["total_price", "totalPrice", "price", "amount", "total_amount"]);
  const leadDays = toPositiveNumber(data.lead_time) ?? findNumber(data, ["lead_time", "leadTime", "delivery_days", "production_days", "days"]);
  const quoteId = firstNonEmptyString(
    asString(data.quote_no),
    asString(data.quote_name),
    ...attachQuoteList.map((attach) => asString(attach.quote_no)),
    ...attachQuoteList.map((attach) => asString(attach.quote_name)),
    asString(data.quoteNo),
    asString(data.order_no),
    findString(data, ["quote_no", "quote_name", "quoteNo", "order_no", "id"]),
  );
  const currency = firstNonEmptyString(
    asString(data.currency_en_name),
    asString(data.currency),
    ...attachQuoteList.map((attach) => asString(attach.currency_en_name)),
    "USD",
  );
  const material = firstNonEmptyString(
    ...parts.map((part) => asString(part.material)),
    ...attachParts.map((part) => asString(part.material)),
    ...attachParts.map((part) => asString(part.custom_material)),
  );
  const failReason = firstNonEmptyString(
    asString(data.quote_fail_reason),
    ...attachQuoteList.map((attach) => asString(attach.quote_fail_reason)),
    ...parts.map((part) => asString(part.quote_fail_reason)),
    ...attachParts.map((part) => asString(part.quote_fail_reason)),
  );

  if (price != null) {
    return {
      price: normalizeCurrencyAmount(price),
      currency: currency ?? undefined,
      leadTime: formatLeadTime(leadDays),
      material: material ?? undefined,
      quoteId: quoteId ?? undefined,
      error: undefined,
    };
  }

  if (quoteId || currency || material || failReason || leadDays != null) {
    return {
      currency: currency ?? undefined,
      leadTime: formatLeadTime(leadDays),
      material: material ?? undefined,
      quoteId: quoteId ?? undefined,
      error: failReason ?? undefined,
    };
  }

  return null;
}

function findNumber(obj: unknown, keys: string[]): number | null {
  if (obj == null || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    if (key in record) {
      const val = Number(record[key]);
      if (Number.isFinite(val) && val > 0) return val;
    }
  }
  for (const val of Object.values(record)) {
    if (val && typeof val === "object") {
      const found = findNumber(val, keys);
      if (found != null) return found;
    }
  }
  return null;
}

function findString(obj: unknown, keys: string[]): string | null {
  if (obj == null || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    if (key in record) {
      const value = asString(record[key]);
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCurrencyAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function firstNonEmptyString(...values: Array<string | null>): string | null {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return null;
}

function formatLeadTime(days: number | null): string | undefined {
  if (days == null) {
    return undefined;
  }
  return `${days} business days`;
}

function isRapidDirectQuoteDetailUrl(url: string): boolean {
  return /app\.rapiddirect\.com\/quote\/detail3\.0/i.test(url);
}

function extractQuoteNo(url: string): string | null {
  try {
    return new URL(url).searchParams.get("quote_no");
  } catch {
    return null;
  }
}

async function seedRapidDirectGuideState(ctx: AgentPreparedContext): Promise<void> {
  const patchGuideState = () => {
    try {
      const email = localStorage.getItem("email") ?? localStorage.getItem("mail");
      const visibleGuide = JSON.parse(localStorage.getItem("VisibleSolidWorksGuideObj") ?? "{}") as Record<string, unknown>;
      if (email) {
        visibleGuide[email] = 1;
      }
      localStorage.setItem("VisibleSolidWorksGuideObj", JSON.stringify(visibleGuide));

      const rawUserInfo = localStorage.getItem("userInfo");
      if (rawUserInfo) {
        const userInfo = JSON.parse(rawUserInfo) as Record<string, unknown>;
        if (typeof userInfo.quote_guide_steps === "number" && userInfo.quote_guide_steps < 1) {
          userInfo.quote_guide_steps = 1;
        }
        localStorage.setItem("userInfo", JSON.stringify(userInfo));
      }

      localStorage.setItem("guide1_PartCfg0Skip", "true");
    } catch {
      // Ignore bad/missing localStorage values.
    }
  };

  await ctx.runtime.context.addInitScript(patchGuideState).catch(() => undefined);
  await ctx.runtime.page.evaluate(patchGuideState).catch(() => undefined);
}

async function hardenRapidDirectPageLifecycle(ctx: AgentPreparedContext): Promise<void> {
  const patchPageLifecycle = () => {
    try {
      window.close = () => undefined;
      window.onbeforeunload = null;
      window.addEventListener("beforeunload", (event) => {
        event.stopImmediatePropagation();
      }, true);
    } catch {
      // Ignore browser lifecycle patch failures.
    }
  };

  await ctx.runtime.context.addInitScript(patchPageLifecycle).catch(() => undefined);
  await ctx.runtime.page.evaluate(patchPageLifecycle).catch(() => undefined);
}

function apiArtifactLabel(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split("/").filter(Boolean).pop() ?? "response";
  } catch {
    return "response";
  }
}

function hasMeaningfulRapidDirectExtraction(extraction: Partial<AgentExtraction>): boolean {
  return extraction.price !== undefined || extraction.error !== undefined;
}

function hasResolvedRapidDirectExtraction(extraction: Partial<AgentExtraction>): boolean {
  if (extraction.price !== undefined) {
    return true;
  }

  return isRapidDirectTerminalError(extraction.error);
}

function isRapidDirectManualReviewError(error: string | undefined): boolean {
  return /manual quote|instant price/i.test(error ?? "");
}

function isRapidDirectTerminalError(error: string | undefined): boolean {
  return /auth|login|sign.?in|captcha/i.test(error ?? "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureRapidDirectQuoteSnapshot(
  ctx: AgentPreparedContext,
  label: string,
): Promise<void> {
  const snapshot = await readRapidDirectQuoteSnapshot(ctx);
  if (!snapshot?.body) {
    return;
  }

  try {
    const json = JSON.parse(snapshot.body) as Record<string, unknown>;
    const extracted = extractFromRapidDirectResponse(json);
    if (extracted) {
      addRapidDirectExtraction(ctx, extracted);
    }
    await ctx.collector.writeJson(`rapiddirect-quote-snapshot-${label}`, json);
  } catch {
    await ctx.collector.writeText(`rapiddirect-quote-snapshot-${label}`, snapshot.body);
  }
}

async function monitorRapidDirectQuoteState(ctx: AgentPreparedContext): Promise<void> {
  let configured = false;
  let couponHandled = false;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(2_000);

    if (ctx.runtime.page.isClosed()) {
      return;
    }

    if (!isRapidDirectQuoteDetailUrl(ctx.runtime.page.url())) {
      continue;
    }

    await bestEffortDismissRapidDirectGuideOverlays(ctx.runtime.page);

    if (!configured) {
      await bestEffortConfigureQuoteDetail(ctx);
      configured = true;
    }

    if (!couponHandled) {
      await bestEffortSubmitCouponPopup(ctx);
      couponHandled = true;
    }

    await captureRapidDirectQuoteSnapshot(ctx, "watchdog");
    if (hasResolvedRapidDirectExtraction(ctx.extraction)) {
      return;
    }
  }
}

async function bestEffortConfigureQuoteDetail(ctx: AgentPreparedContext): Promise<void> {
  const page = ctx.runtime.page;
  if (!isRapidDirectQuoteDetailUrl(page.url())) {
    return;
  }

  await bestEffortDismissRapidDirectGuideOverlays(page);

  const desiredMaterial = ctx.normalizedConfig.material;
  const desiredMaterialPattern = new RegExp(escapeRegExp(desiredMaterial), "i");

  const configureButton = page.locator("button.configure:not(.is-disabled)").first();
  if (await configureButton.isVisible().catch(() => false)) {
    await configureButton.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(1_000).catch(() => undefined);
  }

  const materialInput = page.locator('input[placeholder="Please select material"]').first();
  const materialValue = await materialInput.inputValue().catch(() => "");
  if (await materialInput.isVisible().catch(() => false) && !desiredMaterialPattern.test(materialValue)) {
    await selectRapidDirectDropdownOption(page, materialInput, desiredMaterialPattern);
  }

  const roughnessInput = page.locator('input[placeholder="Please select roughness"]').first();
  const roughnessValue = await roughnessInput.inputValue().catch(() => "");
  if (await roughnessInput.isVisible().catch(() => false) && roughnessValue.trim() === "") {
    await selectRapidDirectDropdownOption(page, roughnessInput, /Machined Ra3\.?2/i);
  }

  const quantityInput = page.getByRole("spinbutton").first();
  if (await quantityInput.isVisible().catch(() => false)) {
    await quantityInput.fill(String(ctx.execution.request.quantity)).catch(() => undefined);
    await page.waitForTimeout(300).catch(() => undefined);
  }

  const applyButton = page.getByRole("button", { name: "Apply", exact: true });
  if (await applyButton.isVisible().catch(() => false)) {
    await applyButton.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(2_000).catch(() => undefined);
  }
}

async function bestEffortSubmitCouponPopup(ctx: AgentPreparedContext): Promise<void> {
  const page = ctx.runtime.page;
  await bestEffortDismissRapidDirectGuideOverlays(page);
  await bestEffortOpenRapidDirectLeadForm(page);

  if (!await isRapidDirectLeadFormVisible(page)) {
    return;
  }

  const identity = getRapidDirectLeadIdentity(ctx);

  const countryRegion = page.locator('input[placeholder="Select country/region"]').last();
  const countryRegionValue = await countryRegion.inputValue().catch(() => "");
  if (await countryRegion.isVisible().catch(() => false) && countryRegionValue.trim() === "") {
    await selectRapidDirectDropdownOption(page, countryRegion, /United States/i);
  }

  const companyName = page.locator('input[placeholder="Enter your company name"]').last();
  if (await companyName.isVisible().catch(() => false)) {
    await companyName.fill(identity.company).catch(() => undefined);
  }

  const jobRole = page.locator('input[placeholder="Select your job role"]').last();
  const jobRoleValue = await jobRole.inputValue().catch(() => "");
  if (await jobRole.isVisible().catch(() => false) && jobRoleValue.trim() === "") {
    await selectRapidDirectDropdownOption(page, jobRole, /Purchasing/i);
  }

  const phoneCode = page.locator('input[placeholder="Select"]').last();
  const phoneCodeValue = await phoneCode.inputValue().catch(() => "");
  if (await phoneCode.isVisible().catch(() => false) && phoneCodeValue.trim() === "") {
    await selectRapidDirectDropdownOption(page, phoneCode, /United States|\+1\b/i);
  }

  const phoneNumber = page.locator('input[placeholder="Enter your phone number"]').last();
  if (await phoneNumber.isVisible().catch(() => false)) {
    await phoneNumber.fill(normalizeRapidDirectPhone(identity.phone)).catch(() => undefined);
  }

  const continueButton = page.locator("#AB_SignUpFinishButton").last();
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(1_500).catch(() => undefined);
    await page.waitForFunction(
      () => !document.querySelector("#AB_SignUpFinishButton"),
      undefined,
      { timeout: 10_000 },
    ).catch(() => undefined);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function bestEffortDismissRapidDirectGuideOverlays(page: Page): Promise<void> {
  const skipTipsButton = page.getByRole("button", { name: /Skip tips/i }).first();
  if (await skipTipsButton.isVisible().catch(() => false)) {
    await skipTipsButton.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500).catch(() => undefined);
  }

  const startNowButton = page.getByRole("button", { name: /Start now/i }).first();
  if (await startNowButton.isVisible().catch(() => false)) {
    await startNowButton.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500).catch(() => undefined);
  }
}

async function bestEffortOpenRapidDirectLeadForm(page: Page): Promise<void> {
  if (await isRapidDirectLeadFormVisible(page)) {
    return;
  }

  const goToCompleteButton = page.getByRole("button", { name: /Go to Complete/i }).first();
  if (await goToCompleteButton.isVisible().catch(() => false)) {
    await goToCompleteButton.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(1_000).catch(() => undefined);
    return;
  }

  const goToCompleteText = page.getByText(/Go to Complete/i).first();
  if (await goToCompleteText.isVisible().catch(() => false)) {
    await goToCompleteText.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(1_000).catch(() => undefined);
  }
}

async function isRapidDirectLeadFormVisible(page: Page): Promise<boolean> {
  const continueButton = page.locator("#AB_SignUpFinishButton").last();
  if (await continueButton.isVisible().catch(() => false)) {
    return true;
  }

  const companyInput = page.locator('input[placeholder="Enter your company name"]').last();
  if (await companyInput.isVisible().catch(() => false)) {
    return true;
  }

  const popupTitle = page.getByText(/Fill in y(?:ou|our) details and get instant coupons!/i).first();
  return popupTitle.isVisible().catch(() => false);
}

async function selectRapidDirectDropdownOption(
  page: Page,
  input: Locator,
  optionPattern: RegExp,
): Promise<void> {
  await input.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(300).catch(() => undefined);

  const matchingOption = page.locator(".el-select-dropdown__item").filter({ hasText: optionPattern }).last();
  if (await matchingOption.isVisible().catch(() => false)) {
    await matchingOption.click({ force: true }).catch(() => undefined);
  } else {
    await page.keyboard.press("ArrowDown").catch(() => undefined);
    await page.keyboard.press("Enter").catch(() => undefined);
  }

  await page.waitForTimeout(500).catch(() => undefined);
}

function getRapidDirectLeadIdentity(ctx: AgentPreparedContext): FakeIdentity {
  let identity = rapidDirectLeadIdentityCache.get(ctx);
  if (!identity) {
    identity = generateFakeIdentity();
    rapidDirectLeadIdentityCache.set(ctx, identity);
  }
  return identity;
}

function normalizeRapidDirectPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-10) : "5551234567";
}

async function waitForRapidDirectPricing(ctx: AgentPreparedContext): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (ctx.runtime.page.isClosed()) {
      return;
    }

    await delay(1_500);
    await refreshRapidDirectQuoteSnapshot(ctx);

    if (ctx.extraction.price !== undefined || isRapidDirectTerminalError(ctx.extraction.error)) {
      return;
    }

    const visibleText = await ctx.runtime.visibleText().catch(() => "");
    const visibleQuote = extractRapidDirectVisibleQuote(visibleText);
    if (visibleQuote) {
      addRapidDirectExtraction(ctx, visibleQuote);
      return;
    }

    if (!await isRapidDirectLeadFormVisible(ctx.runtime.page) && !isRapidDirectManualReviewError(ctx.extraction.error)) {
      continue;
    }

    await bestEffortSubmitCouponPopup(ctx);
  }
}

async function enrichRapidDirectQuoteFromVisiblePage(ctx: AgentPreparedContext): Promise<void> {
  if (ctx.extraction.price === undefined || ctx.extraction.leadTime !== undefined || ctx.runtime.page.isClosed()) {
    return;
  }

  const structuredQuote = await extractRapidDirectStructuredPageQuote(ctx);
  if (structuredQuote && isCompatibleRapidDirectQuote(ctx.extraction, structuredQuote)) {
    addRapidDirectExtraction(ctx, structuredQuote);
    return;
  }

  const visibleText = await ctx.runtime.visibleText().catch(() => "");
  const visibleQuote = extractRapidDirectVisibleQuote(visibleText);
  if (visibleQuote) {
    addRapidDirectExtraction(ctx, visibleQuote);
  }
}

async function refreshRapidDirectQuoteSnapshot(ctx: AgentPreparedContext): Promise<void> {
  const snapshot = await readRapidDirectQuoteSnapshot(ctx);
  if (!snapshot?.body) {
    return;
  }

  try {
    const json = JSON.parse(snapshot.body) as Record<string, unknown>;
    const extracted = extractFromRapidDirectResponse(json);
    if (extracted) {
      addRapidDirectExtraction(ctx, extracted);
    }
  } catch {
    // Ignore unreadable snapshots during polling.
  }
}

async function readRapidDirectQuoteSnapshot(
  ctx: AgentPreparedContext,
): Promise<{ status: number; body: string } | null> {
  const quoteNo = extractQuoteNo(ctx.runtime.page.url());
  if (!quoteNo) {
    return null;
  }

  return ctx.runtime.page.evaluate(async (currentQuoteNo) => {
    const response = await fetch(`/api/6047361aa5aa3?quoteNo=${encodeURIComponent(currentQuoteNo)}&is_re_order=0`, {
      credentials: "include",
    });
    return {
      status: response.status,
      body: await response.text(),
    };
  }, quoteNo).catch(() => null);
}

export function extractRapidDirectVisibleQuote(text: string): Partial<AgentExtraction> | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!/Standard/i.test(normalized) || !/(Economy|Expedited)/i.test(normalized)) {
    return null;
  }

  const standardSegment = normalized.match(/Standard\s+(?:USD|\$)\s*([0-9]+(?:\.[0-9]{2})?).{0,80}?(\d+)\s+business\s+days/i);
  if (!standardSegment) {
    return null;
  }

  return {
    price: normalizeCurrencyAmount(Number(standardSegment[1])),
    currency: "USD",
    leadTime: formatRapidDirectTierLeadTime("Standard", `${standardSegment[2]} business days`),
    error: undefined,
  };
}

async function extractRapidDirectStructuredPageQuote(
  ctx: AgentPreparedContext,
): Promise<Partial<AgentExtraction> | null> {
  try {
    const schema = z.object({
      tierLabel: z.string().nullable(),
      priceUsd: z.number().positive().nullable(),
      leadTimeText: z.string().nullable(),
      material: z.string().nullable(),
    });

    const extracted = await ctx.runtime.extract(
      `On this RapidDirect quote page, identify the visible Standard pricing card.
If Standard, Economy, and Expedited are shown, return the Standard card only.
Return the exact displayed USD price and the exact displayed lead-time text from that same card.
If only one pricing option is visible, return that option instead.
Do not infer from hidden/backend values. Only use visible on-page quote information.`,
      schema,
    );

    if (extracted.priceUsd == null) {
      return null;
    }

    return {
      price: normalizeCurrencyAmount(extracted.priceUsd),
      currency: "USD",
      leadTime: formatRapidDirectTierLeadTime(extracted.tierLabel, extracted.leadTimeText),
      material: normalizeNullableString(extracted.material) ?? undefined,
      error: undefined,
    };
  } catch {
    return null;
  }
}

function isCompatibleRapidDirectQuote(
  current: Partial<AgentExtraction>,
  candidate: Partial<AgentExtraction>,
): boolean {
  if (current.price === undefined || candidate.price === undefined) {
    return true;
  }

  return Math.abs(current.price - candidate.price) <= 0.5;
}

function formatRapidDirectTierLeadTime(
  tierLabel: string | null | undefined,
  leadTimeText: string | null | undefined,
): string | undefined {
  const normalizedLeadTime = normalizeNullableString(leadTimeText);
  if (!normalizedLeadTime) {
    return undefined;
  }

  const normalizedTier = normalizeNullableString(tierLabel);
  if (!normalizedTier) {
    return normalizedLeadTime;
  }

  if (normalizedLeadTime.toLowerCase().includes(normalizedTier.toLowerCase())) {
    return normalizedLeadTime;
  }

  return `${normalizedTier} / ${normalizedLeadTime}`;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function addRapidDirectExtraction(
  ctx: AgentPreparedContext,
  patch: Partial<AgentExtraction>,
): void {
  const nextPatch: Partial<AgentExtraction> = { ...patch };

  if (nextPatch.price !== undefined) {
    nextPatch.error = undefined;
  } else if (ctx.extraction.price !== undefined && nextPatch.error !== undefined) {
    delete nextPatch.error;
  }

  ctx.addExtraction(nextPatch);
}

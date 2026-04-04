import path from "node:path";

import { browserStorageStateMap } from "../config/env.js";
import type { BrowserPreparedContext, BrowserStepResult, BrowserVendorStep } from "./base.js";
import {
  BrowserVendorAdapter,
  failed,
  manualReview,
  projectNameForPart,
  success,
} from "./base.js";

interface ProtolabsChecklistItem {
  code?: string;
  state?: string;
}

interface ProtolabsConcern {
  issueMessage?: string | null;
}

interface ProtolabsManufacturingTime {
  daysToManufacture?: number | null;
}

interface ProtolabsFulfillmentOption {
  isActive?: boolean;
  priority?: string | null;
  manufacturingTime?: ProtolabsManufacturingTime | null;
}

interface ProtolabsGroupedShipment {
  shippingCost?: number | null;
}

interface ProtolabsGroupedShipping {
  groupedShipments?: ProtolabsGroupedShipment[];
}

interface ProtolabsLineItem {
  status?: string;
  totalPrice?: number | null;
  unitPrice?: number | null;
  extendedPrice?: number | null;
  quoteRequestNeeded?: boolean;
  minimumConfigurationNeeded?: boolean;
  isReadyForPricing?: boolean;
  statusChecklist?: ProtolabsChecklistItem[];
  concerns?: ProtolabsConcern[] | null;
  fulfillmentOptions?: ProtolabsFulfillmentOption[];
}

interface ProtolabsQuoteSnapshot {
  number?: string;
  totalPrice?: number | null;
  estimatedTax?: number | null;
  quoteRequestNeeded?: boolean;
  minimumConfigurationNeeded?: boolean;
  isReadyForPricing?: boolean;
  lineItems?: ProtolabsLineItem[];
  groupedShipping?: ProtolabsGroupedShipping | null;
}

interface ProtolabsClassification {
  kind: "quoted" | "manual_review_required" | "configuration_blocked" | "unknown";
  blockerReason?: string;
}

export class ProtolabsAdapter extends BrowserVendorAdapter {
  readonly vendor = "protolabs" as const;
  readonly baseUrl = "https://buildit.protolabs.com/?lang=en-US&getaquote=true";

  protected storageStatePath(env: BrowserPreparedContext["execution"]["env"]): string {
    return browserStorageStateMap(env).protolabs;
  }

  protected buildSteps(ctx: BrowserPreparedContext): BrowserVendorStep[] {
    return [
      {
        id: "open-quote-home",
        description: "Open Protolabs quoting home.",
        run: async () => {
          await ctx.runtime.goto(this.baseUrl);
          await ctx.runtime.dismissCommonPopups(["Save", "Close modal"]);
          return success("Opened Protolabs quoting home.");
        },
      },
      {
        id: "authenticated-entry",
        description: "Ensure the session is already authenticated.",
        run: async () => {
          const text = await ctx.runtime.visibleText();
          if (
            /sign in|sign up|create account/i.test(text) ||
            /identity\.protolabs\.com/i.test(ctx.runtime.page.url())
          ) {
            return failed(
              "Protolabs is still asking for authentication.",
              "auth_blocked",
            );
          }
          return success("Authenticated session looks available.");
        },
      },
      {
        id: "start-quote",
        description: "Start a CNC quote flow and continue to upload.",
        run: async () => {
          if (isQuoteFlowRoute(ctx.runtime.page.url())) {
            return success("Already inside a Protolabs quote flow.");
          }

          await ctx.runtime.page.waitForTimeout(2500);
          await ctx.runtime.dismissCommonPopups(["Close modal", "Close"]);
          const opened =
            (await ctx.runtime.clickSelector(
              [
                'button[t-sel="createNewQuoteBtn"]',
                '[t-sel="home.newQuote"] button',
                'button[aria-label="New Quote"]',
              ],
              "Open a new quote from the authenticated home page.",
            )) ||
            (await clickFirstVisibleButton(ctx, [
              /^New Quote$/i,
              /^Get a new quote/i,
              /^Start a quote$/i,
              /^Start your first quote$/i,
              /^Get a Quote$/i,
            ]));

          await ctx.runtime.page.waitForTimeout(2000);
          const setupText = await ctx.runtime.visibleText();
          if (!opened && !/Name your project|Choose a service|Continue to CAD Upload|Select project/i.test(setupText)) {
            const projectId = await findExistingProjectId(ctx);
            if (projectId) {
              await ctx.runtime.goto(
                `https://buildit.protolabs.com/quotes/new/${projectId}?service=CNC&question`,
              );
              await ctx.runtime.page.waitForTimeout(1000);
              if (isUploadRoute(ctx.runtime.page.url())) {
                return success("Advanced into the Protolabs CAD upload flow via direct project route.");
              }
            }
            return failed("Protolabs did not open a new quote flow.", "quote_flow_start_failed");
          }

          const projectName = projectNameForPart(ctx.execution.inputFilePath);
          if (/Select project|Create or select a project/i.test(setupText)) {
            await ctx.runtime.clickSelector(
              ['button[t-sel="selectProject-selectItemBtn"]'],
              "Open the Protolabs project selector.",
            );
            await ctx.runtime.page.waitForTimeout(500);
            const selectedExistingProject = await selectProjectOption(ctx);
            if (!selectedExistingProject) {
              return failed(
                "Protolabs did not expose a selectable project in the modal.",
                "project_selection_failed",
              );
            }
            await ctx.runtime.page.waitForTimeout(1000);
          }

          await ctx.runtime.fillSelector(
            ['input[placeholder*="Insulin Pump" i]', 'input[aria-label="Name your project"]'],
            projectName,
          );
          await ctx.runtime.clickSelector(
            ['button:has-text("CNC Machining")'],
            "Choose the Protolabs CNC Machining service.",
          );
          await ctx.runtime.clickSelector(
            ['button[t-sel="cncServiceCardBtn"]:not([disabled])'],
            "Choose the enabled Protolabs CNC card.",
          );
          await clickFirstVisibleButton(ctx, [/^CNC Machining$/i]);
          await ctx.runtime.clickSelector(
            [
              'button:has-text("Protolabs Fast, reliable")',
              'button:has-text("Protolabs Network")',
            ],
            "Choose the default Protolabs supplier path.",
          );
          await clickFirstVisibleButton(ctx, [/^Protolabs Fast, reliable/i, /^Protolabs Network/i]);
          await ctx.runtime.clickSelector(
            ['button:has-text("Continue to CAD Upload")'],
            "Continue into CAD upload.",
          );
          await ctx.runtime.clickSelector(
            ['button[t-sel="createNewQuoteDialog-actionBtn"]:not([disabled])'],
            "Continue from the enabled quote dialog button.",
          );
          await clickFirstVisibleButton(ctx, [/^Continue to CAD Upload$/i]);
          await ctx.runtime.page.waitForTimeout(1000);

          if (isUploadRoute(ctx.runtime.page.url())) {
            return success("Advanced into the Protolabs CAD upload flow.");
          }

          return failed("Protolabs did not transition into CAD upload.", "upload_route_missing");
        },
      },
      {
        id: "upload-cad",
        description: "Upload the STEP file and clear export prompts.",
        run: async () => {
          const currentText = await ctx.runtime.visibleText();
          if (!isUploadRoute(ctx.runtime.page.url()) && !/Drag-and-drop your CNC Machining files/i.test(currentText)) {
            return failed("Protolabs never reached the CAD upload page.", "upload_route_missing");
          }

          const uploaded = await uploadCadWithRetry(ctx, ctx.execution.inputFilePath);
          if (!uploaded) {
            return failed("Upload input not found.", "upload_input_missing");
          }

          const uploadState = await waitForUploadSettlement(ctx);
          if (uploadState === "file_error") {
            return failed("Protolabs marked the uploaded CAD file as failed.", "upload_rejected");
          }
          if (uploadState !== "ready") {
            return failed("Protolabs upload did not settle into a ready state.", "upload_timeout");
          }

          await ctx.runtime.clickSelector(['button:has-text("No")'], "Answer No to ITAR prompts.");
          await ctx.runtime.clickSelector(['button:has-text("Done")'], "Close ITAR prompt.");
          await waitForUploadSettlement(ctx);
          await ctx.runtime.clickSelector(
            [
              'button[t-sel="continueWithXFilesBtn"]:not([disabled])',
              'button:has-text("Continue with 1 file")',
            ],
            "Continue from upload into configuration.",
          );
          await ctx.runtime.page.waitForTimeout(3000);

          if (isConfigureRoute(ctx.runtime.page.url())) {
            return success("Uploaded CAD and advanced into configuration.");
          }

          return failed("Protolabs did not transition into part configuration.", "configuration_route_missing");
        },
      },
      {
        id: "configure-material",
        description: "Apply the standard 6061 material.",
        run: async () => {
          if (/\/review$/i.test(ctx.runtime.page.url())) {
            return success("Already on the review page.");
          }

          const configureText = await ctx.runtime.visibleText();
          if (!isConfigureRoute(ctx.runtime.page.url()) && !/Select parts to configure|Material|Quantity/i.test(configureText)) {
            return failed("Protolabs never reached the part-configuration surface.", "configuration_route_missing");
          }

          await ctx.runtime.clickSelector(
            ['.quote-rail-card', 'p:has-text(".step")'],
            "Select the uploaded Protolabs part.",
          );

          const selectedMaterial = await ctx.runtime.clickSelector(
            ['button:has-text("Aluminum 6061-T651/T6")'],
            "Reuse the standard Protolabs Aluminum 6061 material.",
          );

          if (!selectedMaterial) {
            await ctx.runtime.clickSelector(
              [
                'button:has-text("Make a selection")',
                'button[aria-haspopup="dialog"]:has-text("Material")',
              ],
              "Open the Protolabs material selector.",
            );
            await ctx.runtime.clickSelector(
              [
                'text=Aluminum 6061-T651/T6',
                'text=Aluminum 6061-T651 UT/ with Material Cert',
              ],
              "Select the standard aluminum CNC material.",
            );
          }

          await ctx.runtime.page.waitForTimeout(2500);
          const postConfigureText = await ctx.runtime.visibleText();
          if (!/Aluminum 6061|Request for Quote|\$|Review Quote/i.test(postConfigureText)) {
            return failed(
              "Protolabs configuration did not reach a pricing or RFQ state.",
              "configuration_blocked",
            );
          }
          return success("Applied the standard Protolabs material path.");
        },
      },
      {
        id: "capture-quote-or-review",
        description: "Capture instant quote details or classify RFQ/manual review.",
        run: async () => captureQuoteOrReview(ctx),
      },
    ];
  }
}

export function classifyProtolabsQuote(snapshot: ProtolabsQuoteSnapshot): ProtolabsClassification {
  const firstLineItem = snapshot.lineItems?.[0];
  const quoteRequestNeeded = Boolean(
    snapshot.quoteRequestNeeded ?? firstLineItem?.quoteRequestNeeded,
  );
  const minimumConfigurationNeeded = Boolean(
    snapshot.minimumConfigurationNeeded ?? firstLineItem?.minimumConfigurationNeeded,
  );
  const totalPrice = snapshot.totalPrice ?? firstLineItem?.totalPrice ?? null;

  if (typeof totalPrice === "number" && totalPrice > 0 && !quoteRequestNeeded) {
    return { kind: "quoted" };
  }

  if (minimumConfigurationNeeded) {
    return {
      kind: "configuration_blocked",
      blockerReason: "Protolabs still requires additional configuration before pricing can render.",
    };
  }

  if (quoteRequestNeeded) {
    const concernMessage = firstLineItem?.concerns?.find(
      (concern) => concern.issueMessage,
    )?.issueMessage;
    const uncheckedChecklist = (firstLineItem?.statusChecklist ?? [])
      .filter((item) => item.state === "Unchecked" && item.code)
      .map((item) => item.code);

    const checklistReason =
      uncheckedChecklist.length > 0
        ? `Pending Protolabs checklist items: ${uncheckedChecklist.join(", ")}.`
        : undefined;

    return {
      kind: "manual_review_required",
      blockerReason:
        concernMessage ??
        checklistReason ??
        "Protolabs requires an RFQ/manual-review path for this part.",
    };
  }

  return { kind: "unknown" };
}

export function extractProtolabsReviewPricing(text: string): {
  currency?: string;
  price?: number;
  shippingIfVisible?: number;
  taxIfVisible?: number;
  totalIfVisible?: number;
  leadTime?: string;
  material?: string;
  dfmFlagsIfVisible?: string[];
  rawExtracted?: Record<string, unknown>;
} {
  const price = amountAfterLabel(text, "Subtotal");
  const shippingIfVisible = amountAfterLabel(text, "Shipping");
  const taxIfVisible = amountAfterLabel(text, "Estimated Tax");
  const totalIfVisible = amountAfterLabel(text, "Total");

  const leadTimeMatch = text.match(/Standard\s+([A-Z][a-z]{2},\s+[A-Z][a-z]{2}\s+\d{1,2})/);
  const dfmFlags = [
    ...new Set(
      [
        text.match(/Sharp internal corners with minimum tool radius/i)?.[0],
        text.match(/This part needs to be configured/i)?.[0],
      ].filter((value): value is string => Boolean(value)),
    ),
  ];

  return {
    currency:
      price !== undefined ||
      shippingIfVisible !== undefined ||
      taxIfVisible !== undefined ||
      totalIfVisible !== undefined
        ? "USD"
        : undefined,
    price,
    shippingIfVisible,
    taxIfVisible,
    totalIfVisible,
    leadTime: leadTimeMatch ? `Standard ${leadTimeMatch[1]}` : undefined,
    material: /Aluminum 6061-T651\/T6/i.test(text) ? "Aluminum 6061-T651/T6" : undefined,
    dfmFlagsIfVisible: dfmFlags.length > 0 ? dfmFlags : undefined,
    rawExtracted: {
      visibleTextExcerpt: text.slice(0, 5000),
    },
  };
}

async function captureQuoteOrReview(ctx: BrowserPreparedContext): Promise<BrowserStepResult> {
  let snapshot = await fetchQuoteSnapshot(ctx);
  if (snapshot) {
    ctx.addExtraction({
      quoteId: snapshot.number,
      rawExtracted: {
        ...(ctx.extraction.rawExtracted ?? {}),
        protolabsQuoteApi: snapshot,
      },
    });
  }

  if (snapshot && isStillAnalyzing(snapshot)) {
    snapshot = (await waitForStableQuoteSnapshot(ctx, snapshot)) ?? snapshot;
    ctx.addExtraction({
      quoteId: snapshot.number,
      rawExtracted: {
        ...(ctx.extraction.rawExtracted ?? {}),
        protolabsQuoteApi: snapshot,
      },
    });
  }

  const classification = classifyProtolabsQuote(snapshot ?? {});

  if (classification.kind === "quoted") {
    const reviewUrl = reviewRouteFromCurrentUrl(ctx.runtime.page.url());
    if (reviewUrl) {
      await ctx.runtime.goto(reviewUrl);
    } else {
      await ctx.runtime.clickSelector(
        ['button:has-text("Review Quote")', 'a:has-text("Review")'],
        "Open the Protolabs review page.",
      );
    }
    await ctx.runtime.page.waitForTimeout(1500);

    const text = await ctx.runtime.visibleText();
    const parsed = extractProtolabsReviewPricing(text);
    const firstLineItem = snapshot?.lineItems?.[0];
    const activeFulfillment = firstLineItem?.fulfillmentOptions?.find((option) => option.isActive);
    const shippingCost = snapshot?.groupedShipping?.groupedShipments?.[0]?.shippingCost;
    ctx.addExtraction({
      quoteId: snapshot?.number,
      currency: parsed.currency ?? "USD",
      price:
        parsed.price ??
        firstLineItem?.unitPrice ??
        firstLineItem?.extendedPrice ??
        undefined,
      leadTime:
        parsed.leadTime ??
        (activeFulfillment
          ? `${activeFulfillment.priority} ${activeFulfillment.manufacturingTime?.daysToManufacture ?? ""} day`
              .trim()
          : undefined),
      material: parsed.material ?? "Aluminum 6061-T651/T6",
      rawExtracted: {
        ...(ctx.extraction.rawExtracted ?? {}),
        ...(parsed.rawExtracted ?? {}),
        shippingIfVisible: parsed.shippingIfVisible ?? shippingCost ?? undefined,
        taxIfVisible: parsed.taxIfVisible ?? snapshot?.estimatedTax ?? undefined,
        totalIfVisible:
          parsed.totalIfVisible ??
          (typeof snapshot?.totalPrice === "number" ? snapshot.totalPrice : undefined),
      },
    });

    return success("Captured Protolabs review-page pricing.");
  }

  if (classification.kind === "manual_review_required") {
    ctx.addExtraction({
      error: classification.blockerReason,
      material: "Aluminum 6061-T651/T6",
    });
    return manualReview(
      "Protolabs routed this part into an RFQ/manual-review branch.",
      "manual_review_required",
    );
  }

  if (classification.kind === "configuration_blocked") {
    return failed(
      "Protolabs still requires additional configuration before pricing can render.",
      "configuration_blocked",
    );
  }

  const text = await ctx.runtime.visibleText();
  if (/Request for Quote|This part needs to be configured/i.test(text)) {
    return manualReview(
      "Protolabs surfaced an RFQ/manual-review state in the visible flow.",
      "manual_review_required",
    );
  }

  return failed("No stable Protolabs quote or RFQ classification was detected.", "classification_missing");
}

async function fetchQuoteSnapshot(
  ctx: BrowserPreparedContext,
): Promise<ProtolabsQuoteSnapshot | undefined> {
  const match = ctx.runtime.page.url().match(/\/quotes\/([^/]+)/i);
  const quoteGuid = match?.[1];
  if (!quoteGuid) {
    return undefined;
  }

  try {
    return await ctx.runtime.page.evaluate(
      async (id) => {
        const response = await fetch(
          `/commerce/api/quotes/${id}?includePricing=true&includePromoCodes=true&context=Configure&forceNoCache=true`,
        );
        return (await response.json()) as ProtolabsQuoteSnapshot;
      },
      quoteGuid,
    );
  } catch {
    return undefined;
  }
}

function isStillAnalyzing(snapshot: ProtolabsQuoteSnapshot): boolean {
  const firstLineItem = snapshot.lineItems?.[0];
  return (
    !snapshot.quoteRequestNeeded &&
    !snapshot.minimumConfigurationNeeded &&
    !snapshot.isReadyForPricing &&
    !firstLineItem?.quoteRequestNeeded &&
    !firstLineItem?.minimumConfigurationNeeded &&
    /analy/i.test(firstLineItem?.status ?? "")
  );
}

async function waitForStableQuoteSnapshot(
  ctx: BrowserPreparedContext,
  initialSnapshot: ProtolabsQuoteSnapshot,
): Promise<ProtolabsQuoteSnapshot | undefined> {
  let latest = initialSnapshot;
  const deadline = Date.now() + 45000;

  while (Date.now() < deadline) {
    await ctx.runtime.page.waitForTimeout(5000);
    const next = await fetchQuoteSnapshot(ctx);
    if (!next) {
      continue;
    }

    latest = next;
    if (!isStillAnalyzing(next)) {
      return next;
    }
  }

  return latest;
}

async function findExistingProjectId(ctx: BrowserPreparedContext): Promise<string | undefined> {
  try {
    const projectPath = await ctx.runtime.page.evaluate(() => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/projects/"]'));
      return (
        links
          .map((link) => link.getAttribute("href") ?? "")
          .find((href) => /\/projects\/[^/]+\/quotes/i.test(href)) ?? null
      );
    });
    return projectPath?.match(/\/projects\/([^/]+)\/quotes/i)?.[1];
  } catch {
    return undefined;
  }
}

async function selectProjectOption(ctx: BrowserPreparedContext): Promise<boolean> {
  const selectors = [
    'button[t-sel^="Project-"]:not([t-sel="Project-newProject"]):not([t-sel="Project-selectCurrent"])',
    'button[t-sel="Project-newProject"]',
  ];

  for (const selector of selectors) {
    try {
      const locator = ctx.runtime.page.locator(selector).first();
      if (await locator.isVisible({ timeout: 2000 })) {
        await locator.click({ timeout: 3000 });
        await ctx.runtime.page.waitForTimeout(250);
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

async function uploadCadWithRetry(
  ctx: BrowserPreparedContext,
  partPath: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let uploaded = await ctx.runtime.uploadPart(partPath);
    if (!uploaded) {
      await ctx.runtime.clickSelector(
        [
          ".icon.icon--large > svg",
          'h2:has-text("Drag-and-drop your CNC Machining files")',
          "text=Drag-and-drop your CNC Machining files, or browse files",
        ],
        "Open the Protolabs file chooser.",
      );
      uploaded = await ctx.runtime.uploadPart(partPath);
    }

    if (!uploaded) {
      return false;
    }

    const uploadState = await waitForUploadSettlement(ctx);
    if (uploadState === "ready") {
      return true;
    }

    if (uploadState === "file_error") {
      await ctx.runtime.clickSelector(
        ['button[t-sel$="-removeCadFileBtn"]'],
        "Remove the failed upload before retrying.",
      );
      await ctx.runtime.page.waitForTimeout(500);
      continue;
    }
  }

  return true;
}

async function waitForUploadSettlement(
  ctx: BrowserPreparedContext,
): Promise<"ready" | "file_error" | "timeout"> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const continueButtonReady = await ctx.runtime.page
      .locator('button[t-sel="continueWithXFilesBtn"]:not([disabled])')
      .isVisible()
      .catch(() => false);
    if (continueButtonReady) {
      return "ready";
    }

    const fileErrorVisible = await ctx.runtime.page
      .locator(".cadFileUploadCard__fileErrorMessage")
      .isVisible()
      .catch(() => false);
    if (fileErrorVisible) {
      return "file_error";
    }

    await ctx.runtime.page.waitForTimeout(250);
  }

  return "timeout";
}

function amountAfterLabel(text: string, label: string): number | undefined {
  const matches = [
    ...text.matchAll(
      new RegExp(`${escapeRegex(label)}\\s*\\$\\s*([\\d,]+(?:\\.\\d{1,2})?)`, "gi"),
    ),
  ];
  const match = matches.at(-1);
  const amountText = match?.[1];
  if (!amountText) {
    return undefined;
  }
  const value = Number(amountText.replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isUploadRoute(url: string): boolean {
  return /\/quotes\/new\/.+/i.test(url);
}

function isConfigureRoute(url: string): boolean {
  return /\/quotes\/[^/]+\/configure$/i.test(url);
}

function isQuoteFlowRoute(url: string): boolean {
  return isUploadRoute(url) || isConfigureRoute(url) || /\/quotes\/[^/]+\/review$/i.test(url);
}

function reviewRouteFromCurrentUrl(url: string): string | undefined {
  if (/\/quotes\/[^/]+\/configure$/i.test(url)) {
    return url.replace(/\/configure$/i, "/review");
  }
  return undefined;
}

async function clickFirstVisibleButton(
  ctx: BrowserPreparedContext,
  names: RegExp[],
): Promise<boolean> {
  for (const name of names) {
    try {
      const locator = ctx.runtime.page.getByRole("button", { name }).first();
      if (await locator.isVisible({ timeout: 2000 })) {
        await locator.click({ timeout: 3000 });
        await ctx.runtime.page.waitForTimeout(250);
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

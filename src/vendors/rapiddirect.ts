import { browserStorageStateMap } from "../config/env.js";
import type { BrowserPreparedContext, BrowserVendorStep } from "./base.js";
import {
  BrowserVendorAdapter,
  failed,
  success,
} from "./base.js";

export class RapidDirectAdapter extends BrowserVendorAdapter {
  readonly vendor = "rapiddirect" as const;
  readonly baseUrl = "https://app.rapiddirect.com/";

  protected storageStatePath(env: BrowserPreparedContext["execution"]["env"]): string {
    return browserStorageStateMap(env).rapiddirect;
  }

  protected buildSteps(ctx: BrowserPreparedContext): BrowserVendorStep[] {
    return [
      {
        id: "open-app",
        description: "Open RapidDirect quoting app.",
        run: async () => {
          await ctx.runtime.goto(this.baseUrl);
          await ctx.runtime.dismissCommonPopups();
          return success("Opened RapidDirect app.");
        },
      },
      {
        id: "auth-gate",
        description: "Verify authenticated session.",
        run: async () => {
          const text = await ctx.runtime.visibleText();
          if (
            /Log in to your account/i.test(text) ||
            (/Email address/i.test(text) &&
              /Password/i.test(text) &&
              /Don't have an account\?\s*Sign Up/i.test(text))
          ) {
            return failed(
              "RapidDirect is still on an auth gate.",
              "auth_blocked",
            );
          }
          return success("No auth gate detected.");
        },
      },
      {
        id: "upload-cad",
        description: "Upload the STEP file.",
        run: async () => {
          const uploaded = await ctx.runtime.uploadPart(ctx.execution.inputFilePath);
          return uploaded
            ? success("Uploaded CAD file.")
            : failed("Upload input not found.", "upload_input_missing");
        },
      },
      {
        id: "kill-overlays",
        description: "Dismiss common blocking overlays.",
        run: async () => {
          const dismissed = await ctx.runtime.dismissCommonPopups([
            "Skip guide",
            "Close guide",
            "Complete later",
            "Skip for now",
          ]);
          return success(`Dismissed ${dismissed} overlay actions.`);
        },
      },
      {
        id: "configure-required-fields",
        description: "Apply the required material and finish defaults.",
        run: async () => {
          let actions = 0;
          const openedPartConfigurator =
            (await ctx.runtime.clickSelector(
              [
                'div.configuration-r.expand-btn button.configure',
                'td .configuration-r button.configure',
                'button.configure.el-button',
                'button:has-text("Configure")',
              ],
              "Open the RapidDirect part configurator.",
            )) || (await clickRapidDirectConfigureButton(ctx));
          if (openedPartConfigurator) {
            actions += 1;
            await ctx.runtime.page.waitForTimeout(1000);
          }

          actions += [
            await ctx.runtime.clickSelector(
              [
                'button:has-text("CNC machining")',
                'div:has-text("CNC machining")',
                'label:has-text("CNC machining")',
              ],
              "Select CNC machining.",
            ),
            await ctx.runtime.clickSelector(
              [
                'button:has-text("Aluminum 6061")',
                'div:has-text("Aluminum 6061")',
                'label:has-text("Aluminum 6061")',
              ],
              "Select Aluminum 6061.",
            ),
            await ctx.runtime.fillSelector(
              ['input[name*="quantity" i]', 'input[id*="quantity" i]'],
              String(ctx.execution.request.quantity),
            ),
          ].filter(Boolean).length;

          const textBeforeFinish = await ctx.runtime.visibleText();
          if (/Please select finish|Add finish/i.test(textBeforeFinish)) {
            const openedFinishMenu = await ctx.runtime.clickSelector(
              [
                'input[placeholder="Please select finish"]',
                'div:has-text("Add finish")',
                'text=Add finish',
              ],
              "Open the RapidDirect finish selector.",
            );

            if (openedFinishMenu) {
              const pickedFinish = await ctx.runtime.clickSelector(
                [
                  'li:has-text("Brushed (#120)")',
                  'text=Brushed (#120)',
                  'li:has-text("Sand blasting (#120)")',
                  'text=Sand blasting (#120)',
                ],
                "Choose a stable default finish.",
              );
              if (pickedFinish) {
                actions += 1;
              }
            }
          }

          await ctx.runtime.page.waitForTimeout(500);
          await ctx.runtime.clickSelector(
            ['button:has-text("Apply")'],
            "Apply the RapidDirect configuration.",
          );

          const ready = await ctx.runtime.waitForPriceNotDash(20000);
          if (ready) {
            return success(`Configuration signals applied (${actions} interactions).`);
          }

          const text = await ctx.runtime.visibleText();
          if (/Please configure your part to get a quote\./i.test(text)) {
            return failed(
              "RapidDirect still reports missing required configuration.",
              "configuration_blocked",
            );
          }

          return failed("RapidDirect price never materialized.", "price_timeout");
        },
      },
      {
        id: "extract-subtotal",
        description: "Capture the RapidDirect subtotal.",
        run: async () => {
          const text = await ctx.runtime.visibleText();
          const extraction = extractRapidDirectPricing(text);
          ctx.addExtraction({
            ...extraction,
            rawExtracted: {
              ...(ctx.extraction.rawExtracted ?? {}),
              visibleTextExcerpt: text.slice(0, 5000),
            },
          });

          if (ctx.extraction.price !== undefined) {
            return success("Captured RapidDirect price signals.");
          }

          return failed("No stable RapidDirect subtotal was found.", "price_missing");
        },
      },
    ];
  }
}

async function clickRapidDirectConfigureButton(ctx: BrowserPreparedContext): Promise<boolean> {
  const selectors = [
    "div.configuration-r.expand-btn button.configure",
    "td .configuration-r button.configure",
    "tr button.configure",
  ];

  for (const selector of selectors) {
    try {
      const locator = ctx.runtime.page.locator(selector).first();
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      if (await locator.count()) {
        await locator.click({ timeout: 3000, force: true }).catch(() => undefined);
        const opened = await waitForRapidDirectConfigurator(ctx);
        if (opened) {
          return true;
        }
      }
    } catch {
      continue;
    }
  }

  return false;
}

async function waitForRapidDirectConfigurator(ctx: BrowserPreparedContext): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    const text = await ctx.runtime.visibleText();
    if (
      /Pricing part/i.test(text) ||
      /Back to quote/i.test(text) ||
      /ISO2768 Standard/i.test(text)
    ) {
      await ctx.runtime.page.waitForTimeout(350);
      return true;
    }
    await ctx.runtime.page.waitForTimeout(250);
  }

  return false;
}

export function extractRapidDirectPricing(text: string): {
  quoteId?: string;
  leadTime?: string;
  currency?: string;
  price?: number;
  material?: string;
} {
  const quoteId = text.match(/\bQC\d{5,}\b/i)?.[0];
  const totalPrice = extractRapidDirectTotalPrice(text);
  const standardPriceMatch = text.match(
    /Standard\s*(?:USD\s*)?(\d+(?:\.\d{1,2})?)\s*(\d+\s+business day(?:s)?)/i,
  );
  const daysFirstMatch = text.match(
    /Standard\s*(\d+\s+business day(?:s)?)\s*(?:USD\s*)?(\d+(?:\.\d{1,2})?)/i,
  );

  const price =
    totalPrice ??
    parseMoney(standardPriceMatch?.[1]) ??
    parseMoney(daysFirstMatch?.[2]);
  const leadTimeDays = standardPriceMatch?.[2] ?? daysFirstMatch?.[1];

  return {
    quoteId,
    currency: price !== undefined ? "USD" : undefined,
    price,
    leadTime: leadTimeDays ? `Standard ${leadTimeDays}` : undefined,
    material: /Aluminum 6061/i.test(text) ? "Aluminum 6061" : undefined,
  };
}

function extractRapidDirectTotalPrice(text: string): number | undefined {
  const lastIndex = text.toLowerCase().lastIndexOf("total price");
  if (lastIndex >= 0) {
    const trailingText = text.slice(lastIndex, lastIndex + 120);
    const trailingPrice = trailingText.match(/USD\s*(\d+(?:\.\d{1,2})?)/i)?.[1];
    const parsedTrailingPrice = parseMoney(trailingPrice);
    if (parsedTrailingPrice !== undefined) {
      return parsedTrailingPrice;
    }
  }

  const allMatches = [...text.matchAll(/Total price[\s\S]{0,120}?USD\s*(\d+(?:\.\d{1,2})?)/gi)];
  const fallbackPrice = allMatches.at(-1)?.[1];
  return parseMoney(fallbackPrice);
}

function parseMoney(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

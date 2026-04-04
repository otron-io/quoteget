import { browserStorageStateMap } from "../config/env.js";
import type { BrowserPreparedContext, BrowserVendorStep } from "./base.js";
import {
  BrowserVendorAdapter,
  failed,
  rememberPriceSignals,
  success,
} from "./base.js";

export class XometryAdapter extends BrowserVendorAdapter {
  readonly vendor = "xometry" as const;
  readonly baseUrl = "https://www.xometry.com/quoting/home/";

  protected storageStatePath(env: BrowserPreparedContext["execution"]["env"]): string {
    return browserStorageStateMap(env).xometry;
  }

  protected buildSteps(ctx: BrowserPreparedContext): BrowserVendorStep[] {
    return [
      {
        id: "open-quote-home",
        description: "Open Xometry quoting home.",
        run: async () => {
          await ctx.runtime.goto(this.baseUrl);
          await ctx.runtime.dismissCommonPopups();
          return success("Opened Xometry quoting home.");
        },
      },
      {
        id: "upload-cad",
        description: "Upload the STEP file.",
        run: async () => {
          const textBefore = await ctx.runtime.visibleText();
          if (/Upload a 3D model to see instant pricing/i.test(textBefore)) {
            await ctx.runtime.page.getByRole("button", { name: /Upload 3D Files/i }).nth(1).click().catch(() => undefined);
            await ctx.runtime.page.waitForTimeout(400);
          }
          const uploaded = await ctx.runtime.uploadPart(ctx.execution.inputFilePath);
          if (!uploaded) {
            return failed("Upload input not found.", "upload_input_missing");
          }
          await ctx.runtime.page.waitForTimeout(6000);
          const text = await ctx.runtime.visibleText();
          if (/There was an error, please try again\./i.test(text)) {
            return failed(
              "Xometry reported an upload error immediately after file selection.",
              "upload_rejected",
            );
          }
          return success("Uploaded CAD file.");
        },
      },
      {
        id: "auth-gate",
        description: "Verify authenticated session.",
        run: async () => {
          const text = await ctx.runtime.visibleText();
          if (/Upload a 3D model to see instant pricing/i.test(text)) {
            return failed(
              "Xometry remained on the public upload landing page after file selection.",
              "upload_did_not_advance",
            );
          }
          if (
            /sign in to continue|log in to continue|create your account to continue/i.test(text) ||
            /login\.xometry\.com/i.test(ctx.runtime.page.url())
          ) {
            return failed(
              "Xometry is still showing an account gate.",
              "auth_blocked",
            );
          }
          return success("No auth gate detected.");
        },
      },
      {
        id: "export-control",
        description: "Answer export-control questions if present.",
        run: async () => {
          await ctx.runtime.clickSelector(
            [
              'button:has-text("No")',
              'button:has-text("Not controlled")',
              'button:has-text("Continue")',
            ],
            "Answer export-control prompts conservatively.",
          );
          await ctx.runtime.dismissCommonPopups();
          return success("Export-control prompt handled if present.");
        },
      },
      {
        id: "extract-subtotal",
        description: "Capture a stable Xometry subtotal.",
        run: async () => {
          const text = await ctx.runtime.visibleText();
          const tokens = await ctx.runtime.collectMoneyTokens();
          rememberPriceSignals(ctx, text, tokens);
          if (/Aluminum 6061/i.test(text)) {
            ctx.addExtraction({ material: "Aluminum 6061" });
          }

          if (ctx.extraction.price !== undefined) {
            if (/standard/i.test(text)) {
              ctx.addExtraction({ leadTime: "standard" });
            }
            return success("Captured Xometry price signals.");
          }

          return failed("No stable subtotal was found on Xometry.", "price_missing");
        },
      },
    ];
  }
}

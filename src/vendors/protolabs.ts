import path from "node:path";

import type { FakeIdentity } from "../core/fakeIdentity.js";
import type { AgentExtraction, AgentPreparedContext, AgentQuoteTask, AgentSignupTask } from "./agentBase.js";
import { AgentVendorAdapter } from "./agentBase.js";

export class ProtolabsAdapter extends AgentVendorAdapter {
  readonly vendor = "protolabs" as const;

  protected buildAgentTask(ctx: AgentPreparedContext): AgentQuoteTask {
    const { quantity } = ctx.execution.request;
    const { material } = ctx.normalizedConfig;
    const projectName = path
      .basename(ctx.execution.inputFilePath)
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim()
      .slice(0, 40) || "CNC Quote";

    return {
      startUrl: "https://buildit.protolabs.com/?lang=en-US&getaquote=true",
      instruction: `
You are getting a CNC machining quote on Protolabs (buildit.protolabs.com).

Goal: create a new project named "${projectName}", select CNC Machining, upload the part file, set material to ${material}, set quantity to ${quantity}, and get a price.

Important notes:
- If redirected to identity.protolabs.com at any point, stop and report "Authentication required."
- Dismiss any modals or popups before proceeding.
- The file upload will be handled automatically when you trigger the file chooser — just click the upload area and wait for the part to process.
- After the part loads, set material to ${material} and quantity to ${quantity}, then wait for pricing.

Report: total price in USD, lead time in business days, material confirmed.
If you see "Request a Quote" or "RFQ" instead of a price: report "Manual review required: RFQ needed."
If any step is blocked: describe what you see.
`.trim(),
      maxSteps: 65,
    };
  }

  protected async beforeAgent(ctx: AgentPreparedContext): Promise<void> {
    // Intercept file chooser dialogs (primary approach)
    ctx.runtime.registerFileChooserInterceptor(ctx.execution.inputFilePath);

    // Fallback: poll for a file input appearing in the DOM and set files directly.
    // filechooser events may not fire reliably over an external CDP connection.
    const filePath = ctx.execution.inputFilePath;
    const page = ctx.runtime.page;
    void (async () => {
      let uploaded = false;
      for (let i = 0; i < 60 && !uploaded; i++) {
        await page.waitForTimeout(3000).catch(() => undefined);
        try {
          // Only attempt when on a Protolabs page (not a redirect/identity page)
          if (!page.url().includes("protolabs.com")) continue;
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

    // Intercept Protolabs's private quote API for structured pricing
    ctx.runtime.page.on("response", async (response) => {
      const url = response.url();
      if (/\/commerce\/api\/quotes\/[\w-]+/i.test(url) && response.status() === 200) {
        try {
          const body = await response.json() as ProtolabsQuoteSnapshot;
          const extracted = extractFromQuoteSnapshot(body);
          if (extracted) {
            ctx.addExtraction(extracted);
            await ctx.collector.writeJson("protolabs-quote-api", body);
          }
        } catch (err) {
          // Non-JSON or parse error — log but don't throw
          void ctx.collector.writeJson("protolabs-quote-api-parse-error", {
            url,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
  }

  protected parseAgentOutput(output: string, ctx: AgentPreparedContext): Partial<AgentExtraction> {
    // Prefer structured API data captured via network interception
    if (ctx.extraction.price !== undefined) {
      return ctx.extraction;
    }

    if (/rfq|request.{0,10}quote|manual.{0,10}review|get.{0,10}custom.{0,10}quote/i.test(output)) {
      return {
        error: "Manual review required: Protolabs requires an RFQ for this part.",
        rawOutput: output,
      };
    }

    if (/minimum.{0,30}configuration|additional.{0,30}configuration/i.test(output)) {
      return {
        error: "Manual review required: Protolabs requires additional configuration.",
        rawOutput: output,
      };
    }

    return super.parseAgentOutput(output, ctx);
  }

  protected buildSignupTask(identity: FakeIdentity): AgentSignupTask {
    return {
      startUrl: "https://identity.protolabs.com/register",
      confirmUrl: "https://buildit.protolabs.com/?lang=en-US",
      instruction: `
Create an account on Protolabs.

Fill in the registration form with:
- First name: %firstName%
- Last name: %lastName%
- Email: %email%
- Company: %company%
- Phone: %phone%
- Password: %password%

Accept any terms and conditions. Submit the form.
If email verification is required, stop and report "Email verification required."
`.trim(),
      maxSteps: 30,
    };
  }
}

// ---------------------------------------------------------------------------
// Protolabs private quote API
// ---------------------------------------------------------------------------

interface ProtolabsLineItem {
  status?: string;
  totalPrice?: number | null;
  extendedPrice?: number | null;
  quoteRequestNeeded?: boolean;
  minimumConfigurationNeeded?: boolean;
  isReadyForPricing?: boolean;
  fulfillmentOptions?: Array<{
    isActive?: boolean;
    manufacturingTime?: { daysToManufacture?: number | null } | null;
  }>;
}

interface ProtolabsQuoteSnapshot {
  number?: string;
  totalPrice?: number | null;
  quoteRequestNeeded?: boolean;
  minimumConfigurationNeeded?: boolean;
  lineItems?: ProtolabsLineItem[];
}

export function extractFromQuoteSnapshot(
  snapshot: ProtolabsQuoteSnapshot,
): Partial<AgentExtraction> | null {
  if (snapshot.quoteRequestNeeded || snapshot.minimumConfigurationNeeded) {
    return {
      error: snapshot.quoteRequestNeeded
        ? "Manual review required: Protolabs requires an RFQ for this part."
        : "Manual review required: Protolabs requires additional configuration.",
    };
  }

  const lineItem = snapshot.lineItems?.[0];
  if (!lineItem) return null;

  const price = snapshot.totalPrice ?? lineItem.totalPrice ?? lineItem.extendedPrice ?? undefined;
  if (price == null || !Number.isFinite(price)) return null;

  const activeOption = lineItem.fulfillmentOptions?.find((opt) => opt.isActive);
  const days = activeOption?.manufacturingTime?.daysToManufacture;

  return {
    quoteId: snapshot.number,
    price,
    currency: "USD",
    leadTime: days != null ? `${days} business days` : undefined,
  };
}

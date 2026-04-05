import type { FakeIdentity } from "../core/fakeIdentity.js";
import type { AgentPreparedContext, AgentQuoteTask, AgentSignupTask } from "./agentBase.js";
import { AgentVendorAdapter } from "./agentBase.js";

export class XometryAdapter extends AgentVendorAdapter {
  readonly vendor = "xometry" as const;

  protected buildAgentTask(ctx: AgentPreparedContext): AgentQuoteTask {
    const { quantity } = ctx.execution.request;
    const { material } = ctx.normalizedConfig;

    return {
      startUrl: "https://www.xometry.com/quoting/home/",
      instruction: `
You are getting a CNC machining quote on Xometry (xometry.com).

Goal: upload the part file, configure it for CNC machining with ${material} material and quantity ${quantity}, and get a price in USD.

Important notes:
- If you see a login or sign-in page at any point, stop and report "Authentication required."
- The file upload will be handled automatically when you trigger the file chooser — just click the upload area and wait.
- If an export control question appears, answer that the part is not export-controlled.
- After the file is uploaded and the configuration page loads, verify process, material, and quantity are correct, then wait for the price.

Report: total price in USD, lead time in business days, material confirmed.
If you see "Request a Quote" or "Contact Us" instead of a price: report "Manual review required: RFQ needed."
If no price appears after configuration: describe exactly what you see.
      `.trim(),
      maxSteps: 45,
    };
  }

  protected async beforeAgent(ctx: AgentPreparedContext): Promise<void> {
    // Register interceptor — whenever a file chooser opens (triggered by agent click), auto-accept with our file
    ctx.runtime.registerFileChooserInterceptor(ctx.execution.inputFilePath);
  }

  protected buildSignupTask(identity: FakeIdentity): AgentSignupTask {
    return {
      startUrl: "https://www.xometry.com/register/",
      confirmUrl: "https://www.xometry.com/quoting/home/",
      instruction: `
Create an account on Xometry.

Fill in the registration form with:
- First name: %firstName%
- Last name: %lastName%
- Email: %email%
- Company: %company%
- Phone: %phone%
- Password: %password%

Select "Buyer" or "Customer" as the account type if asked.
Submit the form.
If a verification step appears that requires email access, stop and report "Email verification required."
`.trim(),
      maxSteps: 30,
    };
  }
}

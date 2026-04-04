import type { PlaywrightQuoteRuntime } from "./playwrightRuntime.js";

const MAILINATOR_DOMAIN = "mailinator.com";

function disposableEmail(prefix: string): string {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${stamp}@${MAILINATOR_DOMAIN}`;
}

async function solveRecaptchaV2With2Captcha(options: {
  apiKey: string;
  siteKey: string;
  pageUrl: string;
}): Promise<string> {
  const inParams = new URLSearchParams({
    key: options.apiKey,
    method: "userrecaptcha",
    googlekey: options.siteKey,
    pageurl: options.pageUrl,
    json: "1",
  });
  const inRes = await fetch(`https://2captcha.com/in.php?${inParams.toString()}`);
  const inJson = (await inRes.json()) as { status: number; request?: string; error_text?: string };
  if (inJson.status !== 1 || !inJson.request) {
    throw new Error(
      `2Captcha submit failed: ${inJson.error_text ?? JSON.stringify(inJson)}`,
    );
  }
  const captchaId = inJson.request;

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `https://2captcha.com/res.php?key=${encodeURIComponent(options.apiKey)}&action=get&id=${encodeURIComponent(captchaId)}&json=1`,
    );
    const out = (await res.json()) as { status: number; request?: string; error_text?: string };
    if (out.status === 1 && out.request) {
      return out.request;
    }
    if (out.request === "CAPCHA_NOT_READY" || out.error_text === "CAPCHA_NOT_READY") {
      continue;
    }
    if (out.error_text && out.error_text !== "CAPCHA_NOT_READY") {
      throw new Error(`2Captcha poll error: ${out.error_text}`);
    }
  }

  throw new Error("2Captcha solve timed out.");
}

export async function ensureRapidDirectEphemeralSession(runtime: PlaywrightQuoteRuntime): Promise<void> {
  const page = runtime.page;
  await page.goto("https://app.rapiddirect.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const landing = await page.locator("body").innerText();
  if (!/Log in to your account/i.test(landing)) {
    return;
  }

  const email = disposableEmail("rd");
  const password = `Rd${Date.now()}a1`;

  await page.getByText("Sign Up", { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByPlaceholder("name@company.com").fill(email);
  await page.getByPlaceholder("Enter your first name").fill("Quote");
  await page.getByPlaceholder("Enter your last name").fill("Get");
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.evaluate(() => {
    const checkbox = document.querySelector<HTMLInputElement>('input[name="agreement"]');
    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.locator("#AB_SignUpFinishButton").click({ force: true });
  await page.waitForTimeout(8000);

  const after = await page.locator("body").innerText();
  if (/Log in to your account/i.test(after)) {
    throw new Error("RapidDirect ephemeral signup did not clear the login gate.");
  }
}

export async function ensureXometryEphemeralSession(runtime: PlaywrightQuoteRuntime): Promise<void> {
  const page = runtime.page;
  await page.goto("https://www.xometry.com/quoting/home/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const initial = await page.locator("body").innerText();
  if (!/Upload a 3D model to see instant pricing/i.test(initial)) {
    return;
  }

  const email = disposableEmail("xm");
  const password = `Xm${Date.now()}!aA1`;

  await page.goto("https://www.xometry.com/signup", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForTimeout(6000);
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForTimeout(6000);

  await page.goto("https://www.xometry.com/quoting/home/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const after = await page.locator("body").innerText();
  if (/Upload a 3D model to see instant pricing/i.test(after)) {
    throw new Error("Xometry ephemeral signup did not unlock the quoting experience.");
  }
}

export async function ensureProtolabsEphemeralSession(
  runtime: PlaywrightQuoteRuntime,
  twoCaptchaApiKey: string,
): Promise<void> {
  const page = runtime.page;
  await page.goto("https://buildit.protolabs.com/?lang=en-US&getaquote=true", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);
  if (!/identity\.protolabs\.com/i.test(page.url())) {
    const text = await page.locator("body").innerText();
    if (!/sign in|sign up|create account/i.test(text)) {
      return;
    }
  }

  await page.goto("https://identity.protolabs.com/signup?lang=en-US", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2000);

  const siteKey = await page.evaluate(
    () => (window as unknown as { recaptchaKey?: string }).recaptchaKey,
  );
  if (!siteKey) {
    throw new Error("Could not read Protolabs recaptcha site key from the signup page.");
  }

  const token = await solveRecaptchaV2With2Captcha({
    apiKey: twoCaptchaApiKey,
    siteKey,
    pageUrl: page.url(),
  });

  await page.evaluate((t) => {
    const attach = (root: ParentNode) => {
      let textarea = root.querySelector<HTMLTextAreaElement>('textarea[name="g-recaptcha-response"]');
      if (!textarea) {
        textarea = document.createElement("textarea");
        textarea.name = "g-recaptcha-response";
        textarea.style.display = "none";
        document.body.appendChild(textarea);
      }
      textarea.value = t;
      textarea.innerHTML = t;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    };

    attach(document);
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try {
        const doc = frame.contentDocument;
        if (doc) {
          attach(doc);
        }
      } catch {
        /* cross-origin */
      }
    }

    const win = window as unknown as { grecaptcha?: { getResponse?: () => string } };
    if (win.grecaptcha) {
      try {
        Object.defineProperty(win.grecaptcha, "getResponse", {
          configurable: true,
          value: () => t,
        });
      } catch {
        /* ignore */
      }
    }
  }, token);

  const email = disposableEmail("pl");
  const password = `Pl${Date.now()}!aA1`;

  await page.locator("#firstName").fill("Quote");
  await page.locator("#lastName").fill("Get");
  await page.locator("#company").fill("QuoteGet");
  await page.locator("#country").fill("United");
  await page.waitForTimeout(600);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#phone").fill("3125550199");
  await page.locator("#postal").fill("60611");

  await page.locator("#submitButton").click();
  await page.waitForURL(/handshake|buildit\.protolabs\.com|authorize/i, { timeout: 120_000 });

  await page.goto("https://buildit.protolabs.com/?lang=en-US&getaquote=true", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);
  const text = await page.locator("body").innerText();
  if (/sign in|sign up|create account/i.test(text) || /identity\.protolabs\.com/i.test(page.url())) {
    throw new Error("Protolabs ephemeral signup did not yield a logged-in BuildIt session.");
  }
}

import { basename } from "node:path";

import type { QuoteToolEnv } from "../core/types.js";

export interface BrowserbaseSession {
  id: string;
  connectUrl: string;
  debuggerUrl?: string;
  uploadsRoot: string;
}

export async function createBrowserbaseSession(
  env: QuoteToolEnv,
  metadata: Record<string, unknown>,
): Promise<BrowserbaseSession> {
  const apiKey = env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is required for Browserbase-backed sessions.");
  }

  const response = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": apiKey,
    },
    body: JSON.stringify({
      projectId: env.BROWSERBASE_PROJECT_ID || undefined,
      region: env.BROWSERBASE_REGION,
      keepAlive: env.BROWSERBASE_KEEP_ALIVE,
      proxies: env.BROWSERBASE_ENABLE_PROXIES ? true : undefined,
      browserSettings: {
        solveCaptchas: env.BROWSERBASE_SOLVE_CAPTCHAS,
        advancedStealth: env.BROWSERBASE_ADVANCED_STEALTH,
      },
      userMetadata: metadata,
    }),
  });

  if (!response.ok) {
    throw new Error(`Browserbase session creation failed with status ${response.status}.`);
  }

  const session = await response.json() as {
    id: string;
    connectUrl: string;
  };

  return {
    id: session.id,
    connectUrl: session.connectUrl,
    uploadsRoot: "/tmp/.uploads",
  };
}

export async function uploadFileToBrowserbaseSession(
  env: QuoteToolEnv,
  sessionId: string,
  fileName: string,
  fileBuffer: Buffer,
): Promise<string> {
  const apiKey = env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is required for Browserbase uploads.");
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fileBuffer)]), fileName);

  const response = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/uploads`, {
    method: "POST",
    headers: {
      "X-BB-API-Key": apiKey,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Browserbase upload failed with status ${response.status}.`);
  }

  return `/tmp/.uploads/${basename(fileName)}`;
}

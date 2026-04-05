import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { browserStorageStateMap, storageStateExists } from "../config/env.js";
import type {
  BrowserExecutionMode,
  BrowserVendorName,
  QuoteToolEnv,
} from "../core/types.js";

export interface BrowserSessionDescriptor {
  vendor: BrowserVendorName;
  mode: BrowserExecutionMode;
  status: "active" | "anonymous_probe";
  source: "encrypted_bundle" | "legacy_storage_state" | "anonymous_probe";
  createdAt: string;
  lastValidatedAt?: string;
  storageStatePath?: string;
  cleanup?: () => Promise<void>;
}

interface StoredBrowserSessionBundle {
  vendor: BrowserVendorName;
  mode: "authenticated_session";
  status: "active";
  createdAt: string;
  lastValidatedAt?: string;
  storageState: Record<string, unknown>;
}

interface EncryptedSessionPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface BrowserSessionProvider {
  resolve(vendor: BrowserVendorName, allowAnonymousProbe?: boolean): Promise<BrowserSessionDescriptor | undefined>;
  saveAuthenticated(vendor: BrowserVendorName, storageState: Record<string, unknown>): Promise<string>;
}

class FileBrowserSessionProvider implements BrowserSessionProvider {
  constructor(private readonly env: QuoteToolEnv) {}

  async resolve(
    vendor: BrowserVendorName,
    allowAnonymousProbe = false,
  ): Promise<BrowserSessionDescriptor | undefined> {
    const encryptedBundlePath = encryptedBundleFilePath(this.env, vendor);
    if (await fileExists(encryptedBundlePath)) {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), `quoteget-${vendor}-`));
      const tempStorageStatePath = path.join(tempRoot, `${vendor}.json`);
      const bundle = await readEncryptedBundle(this.env, encryptedBundlePath);
      await writeFile(tempStorageStatePath, JSON.stringify(bundle.storageState, null, 2), "utf8");

      return {
        vendor,
        mode: bundle.mode,
        status: bundle.status,
        source: "encrypted_bundle",
        createdAt: bundle.createdAt,
        lastValidatedAt: bundle.lastValidatedAt,
        storageStatePath: tempStorageStatePath,
        cleanup: async () => rm(tempRoot, { recursive: true, force: true }),
      };
    }

    const legacyPath = browserStorageStateMap(this.env)[vendor];
    if (storageStateExists(legacyPath)) {
      return {
        vendor,
        mode: "authenticated_session",
        status: "active",
        source: "legacy_storage_state",
        createdAt: new Date().toISOString(),
        storageStatePath: legacyPath,
      };
    }

    if (!allowAnonymousProbe) {
      return undefined;
    }

    return {
      vendor,
      mode: "anonymous_probe",
      status: "anonymous_probe",
      source: "anonymous_probe",
      createdAt: new Date().toISOString(),
    };
  }

  async saveAuthenticated(
    vendor: BrowserVendorName,
    storageState: Record<string, unknown>,
  ): Promise<string> {
    const createdAt = new Date().toISOString();
    if (!this.env.QUOTE_TOOL_SESSION_SECRET) {
      const storageStatePath = browserStorageStateMap(this.env)[vendor];
      await mkdir(path.dirname(storageStatePath), { recursive: true });
      await writeFile(storageStatePath, JSON.stringify(storageState, null, 2), "utf8");
      return storageStatePath;
    }

    const bundlePath = encryptedBundleFilePath(this.env, vendor);
    await mkdir(path.dirname(bundlePath), { recursive: true });
    const payload: StoredBrowserSessionBundle = {
      vendor,
      mode: "authenticated_session",
      status: "active",
      createdAt,
      storageState,
    };
    await writeEncryptedBundle(this.env, bundlePath, payload);
    return bundlePath;
  }
}

export function createBrowserSessionProvider(env: QuoteToolEnv): BrowserSessionProvider {
  return new FileBrowserSessionProvider(env);
}

export function encryptedBundleFilePath(env: QuoteToolEnv, vendor: BrowserVendorName): string {
  return path.join(env.storageRootAbs, "sessions", `${vendor}.json.enc`);
}

async function readEncryptedBundle(
  env: QuoteToolEnv,
  filePath: string,
): Promise<StoredBrowserSessionBundle> {
  if (!env.QUOTE_TOOL_SESSION_SECRET) {
    throw new Error(
      `Encrypted browser session found at ${filePath}, but QUOTE_TOOL_SESSION_SECRET is not configured.`,
    );
  }

  const payload = JSON.parse(await readFile(filePath, "utf8")) as EncryptedSessionPayload;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(env.QUOTE_TOOL_SESSION_SECRET),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext) as StoredBrowserSessionBundle;
}

async function writeEncryptedBundle(
  env: QuoteToolEnv,
  filePath: string,
  bundle: StoredBrowserSessionBundle,
): Promise<void> {
  const secret = env.QUOTE_TOOL_SESSION_SECRET;
  if (!secret) {
    throw new Error("QUOTE_TOOL_SESSION_SECRET is required to write encrypted browser sessions.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(bundle)),
    cipher.final(),
  ]);

  const payload: EncryptedSessionPayload = {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };

  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

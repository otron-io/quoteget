import type { MaterialSlug } from "./materials.js";

export const SUPPORTED_VENDORS = [
  "hubs",
  "xometry",
  "rapiddirect",
  "protolabs",
] as const;

export const DEFAULT_VENDORS = [
  "hubs",
  "xometry",
  "rapiddirect",
] as const;

export const BROWSER_VENDORS = [
  "xometry",
  "rapiddirect",
  "protolabs",
] as const;

export type VendorName = (typeof SUPPORTED_VENDORS)[number];
export type BrowserVendorName = (typeof BROWSER_VENDORS)[number];
export type IntegrationTier = "api" | "browser";
export type BrowserExecutionMode = "anonymous_probe" | "authenticated_session";
export type VendorStatus =
  | "quoted"
  | "manual_review_required"
  | "auth_required"
  | "failed"
  | "not_supported";

export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface QuoteRequestInput {
  filePath: string;
  process?: string;
  fileFormat?: string;
  material?: MaterialSlug | string;
  finish?: string;
  quantity?: number;
  geography?: string;
  shipToRegion?: string;
  shipToPostalCode?: string;
  preferredLeadTime?: string;
  vendors?: VendorName[];
}

export interface QuoteRequest {
  filePath: string;
  fileName: string;
  process: "cnc";
  fileFormat: "step";
  material: MaterialSlug;
  finish: "standard";
  quantity: number;
  geography: "us";
  shipToRegion: string;
  shipToPostalCode: string;
  preferredLeadTime: "standard";
  vendors: VendorName[];
}

export interface VendorNormalizedConfig {
  vendor: VendorName;
  process: string;
  material: string;
  finish: string;
  quantity: number;
  geography: string;
  shipToRegion: string;
  shipToPostalCode: string;
  preferredLeadTime: string;
  extra: Record<string, unknown>;
}

export interface ArtifactRef {
  runDir: string;
  files: string[];
}

export interface VendorQuoteResult {
  vendor: VendorName;
  status: VendorStatus;
  price?: number;
  currency?: string;
  leadTime?: string;
  material?: string;
  error?: string;
  failureCode?: string;
  integrationTier?: IntegrationTier;
  quoteId?: string;
  normalizedConfig?: VendorNormalizedConfig;
  artifactRef?: ArtifactRef;
}

export interface QuoteRunResult {
  runId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  request: QuoteRequest;
  inputFilePath: string;
  artifactRoot: string;
  results: VendorQuoteResult[];
  error?: string;
}

export interface PreparedQuoteRun {
  runId: string;
  request: QuoteRequest;
  inputFilePath: string;
  artifactRoot: string;
}

export interface QuoteToolProfile {
  profileId: string;
  description: string;
  process: "cnc";
  fileFormat: "step";
  material: MaterialSlug;
  finish: "standard";
  quantity: number;
  geography: "us";
  shipToRegion: string;
  shipToPostalCode: string;
  preferredLeadTime: "standard";
}

export interface QuoteToolEnv {
  QUOTE_TOOL_ARTIFACT_ROOT: string;
  QUOTE_TOOL_STORAGE_ROOT: string;
  QUOTE_TOOL_HEADED: boolean;
  QUOTE_TOOL_PORT: number;
  QUOTE_TOOL_SESSION_SECRET?: string;
  HUBS_EMAIL?: string;
  HUBS_UNITS: "mm" | "inch";
  HUBS_FINISH_SLUG: string;
  HUBS_MATERIAL_SUBSET_ID: number;
  HUBS_TECHNOLOGY_ID: number;
  BROWSERBASE_API_KEY?: string;
  BROWSERBASE_PROJECT_ID?: string;
  BROWSERBASE_REGION: "us-west-2" | "us-east-1" | "eu-central-1" | "ap-southeast-1";
  BROWSERBASE_KEEP_ALIVE: boolean;
  BROWSERBASE_ENABLE_PROXIES: boolean;
  BROWSERBASE_SOLVE_CAPTCHAS: boolean;
  BROWSERBASE_ADVANCED_STEALTH: boolean;
  XOMETRY_STORAGE_STATE: string;
  RAPIDDIRECT_STORAGE_STATE: string;
  PROTOLABS_STORAGE_STATE: string;
  /** When set, Protolabs signup (reCAPTCHA) can be solved automatically for fresh sessions. */
  TWOCAPTCHA_API_KEY?: string;
  STAGEHAND_MODEL: string;
  STAGEHAND_API_KEY?: string;
  STAGEHAND_USE_CACHE: boolean;
  artifactRootAbs: string;
  storageRootAbs: string;
}

export interface VendorExecutionContext {
  runId: string;
  request: QuoteRequest;
  inputFilePath: string;
  artifactRoot: string;
  env: QuoteToolEnv;
}

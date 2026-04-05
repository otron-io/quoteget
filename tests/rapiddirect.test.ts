import { describe, expect, it } from "vitest";

import type { AgentExtraction, AgentPreparedContext } from "../src/vendors/agentBase.js";
import {
  extractFromRapidDirectResponse,
  extractRapidDirectVisibleQuote,
  RapidDirectAdapter,
} from "../src/vendors/rapiddirect.js";

describe("RapidDirectAdapter.classify", () => {
  const adapter = new RapidDirectAdapter();

  function makeCtx(overrides: Partial<AgentExtraction> = {}): AgentPreparedContext {
    const extraction: AgentExtraction = { ...overrides };
    return {
      execution: {
        runId: "run-1",
        request: {
          filePath: "/tmp/part.step",
          fileName: "part.step",
          process: "cnc",
          fileFormat: "step",
          material: "aluminum_6061",
          finish: "standard",
          quantity: 1,
          geography: "us",
          shipToRegion: "IL",
          shipToPostalCode: "60611",
          preferredLeadTime: "standard",
          vendors: ["rapiddirect"],
        },
        inputFilePath: "/tmp/part.step",
        artifactRoot: "/tmp/run",
        env: {
          QUOTE_TOOL_ARTIFACT_ROOT: "./artifacts",
          QUOTE_TOOL_STORAGE_ROOT: "./storage",
          QUOTE_TOOL_HEADED: false,
          QUOTE_TOOL_PORT: 4310,
          QUOTE_TOOL_SESSION_SECRET: undefined,
          HUBS_UNITS: "mm",
          HUBS_FINISH_SLUG: "as-machined-standard",
          HUBS_MATERIAL_SUBSET_ID: 86,
          HUBS_TECHNOLOGY_ID: 1,
          BROWSERBASE_API_KEY: undefined,
          BROWSERBASE_PROJECT_ID: undefined,
          BROWSERBASE_REGION: "us-west-2",
          BROWSERBASE_KEEP_ALIVE: false,
          BROWSERBASE_ENABLE_PROXIES: false,
          BROWSERBASE_SOLVE_CAPTCHAS: true,
          BROWSERBASE_ADVANCED_STEALTH: false,
          XOMETRY_STORAGE_STATE: "/tmp/xometry.json",
          RAPIDDIRECT_STORAGE_STATE: "/tmp/rapiddirect.json",
          PROTOLABS_STORAGE_STATE: "/tmp/protolabs.json",
          STAGEHAND_MODEL: "gemini-2.5-flash-preview-04-17",
          STAGEHAND_API_KEY: undefined,
          STAGEHAND_USE_CACHE: false,
          artifactRootAbs: "/tmp",
          storageRootAbs: "/tmp",
        },
      },
      collector: {
        runDir: "/tmp/run",
        files: [],
        writeJson: async () => "/tmp/run/file.json",
        writeText: async () => "/tmp/run/file.txt",
      },
      normalizedConfig: {
        vendor: "rapiddirect",
        process: "CNC machining",
        material: "Aluminum 6061",
        finish: "Brushed (#120)",
        quantity: 1,
        geography: "us",
        shipToRegion: "IL",
        shipToPostalCode: "60611",
        preferredLeadTime: "standard",
        extra: {},
      },
      runtime: {} as AgentPreparedContext["runtime"],
      session: {
        vendor: "rapiddirect",
        mode: "authenticated_session",
        status: "active",
        source: "legacy_storage_state",
        createdAt: "2026-04-04T00:00:00.000Z",
        storageStatePath: "/tmp/rapiddirect.json",
      },
      extraction,
      addExtraction(patch) {
        Object.assign(this.extraction, patch);
      },
    } as AgentPreparedContext;
  }

  it("classifies extraction with price as quoted", async () => {
    const ctx = makeCtx({ price: 66.8, currency: "USD", material: "Aluminum 6061" });
    const result = await adapter.classify(ctx.extraction, ctx);
    expect(result.status).toBe("quoted");
    expect(result.price).toBe(66.8);
  });

  it("classifies extraction without price as failed", async () => {
    const ctx = makeCtx({ error: "Agent did not find a price." });
    const result = await adapter.classify(ctx.extraction, ctx);
    expect(result.status).toBe("failed");
  });

  it("classifies auth error as auth_required", async () => {
    const ctx = makeCtx({ error: "Authentication required." });
    const result = await adapter.classify(ctx.extraction, ctx);
    expect(result.status).toBe("auth_required");
  });

  it("classifies manual quote prompts as manual_review_required", async () => {
    const ctx = makeCtx({ error: "Unable to get instant price for some parts. Please request a manual quote, we will provide you with accurate pricing within 24 hours." });
    const result = await adapter.classify(ctx.extraction, ctx);
    expect(result.status).toBe("manual_review_required");
  });
});

describe("extractFromRapidDirectResponse", () => {
  it("extracts a quoted price snapshot", () => {
    expect(
      extractFromRapidDirectResponse({
        data: {
          quote_no: "QP123",
          quote_price: "44.50",
          lead_time: 7,
          currency_en_name: "USD",
          parts_base_info: [{ material: "Aluminum 6061-T6" }],
        },
      }),
    ).toEqual({
      price: 44.5,
      currency: "USD",
      leadTime: "7 business days",
      material: "Aluminum 6061-T6",
      quoteId: "QP123",
      error: undefined,
    });
  });

  it("extracts manual review state even without a positive price", () => {
    expect(
      extractFromRapidDirectResponse({
        data: {
          quote_no: "QP456",
          quote_price: "0.00",
          currency_en_name: "USD",
          quote_fail_reason: "Please request a manual quote.",
          parts_base_info: [{ material: "" }],
        },
      }),
    ).toEqual({
      currency: "USD",
      leadTime: undefined,
      material: undefined,
      quoteId: "QP456",
      error: "Please request a manual quote.",
    });
  });

  it("extracts manual review state from attachQuoteList payloads", () => {
    expect(
      extractFromRapidDirectResponse({
        quote_id: "214315",
        quote_name: "QP697570021",
        attachQuoteList: [
          {
            quote_price: 0,
            currency_en_name: "USD",
            quote_fail_reason: "Unable to get instant price for some parts. Please request a manual quote, we will provide you with accurate pricing within 24 hours.",
            partsList: [
              {
                parts_name: "ig_bracket.step",
                custom_material: "",
              },
            ],
          },
        ],
      }),
    ).toEqual({
      currency: "USD",
      leadTime: undefined,
      material: undefined,
      quoteId: "QP697570021",
      error: "Unable to get instant price for some parts. Please request a manual quote, we will provide you with accurate pricing within 24 hours.",
    });
  });
});

describe("extractRapidDirectVisibleQuote", () => {
  it("extracts the standard tier price from visible pricing text", () => {
    expect(
      extractRapidDirectVisibleQuote(
        "Standard USD 65.07 6 business days Economy USD 61.82 9 business days Expedited USD 91.10 5 business days",
      ),
    ).toEqual({
      price: 65.07,
      currency: "USD",
      leadTime: "Standard / 6 business days",
    });
  });

  it("returns null when the pricing cards are not present", () => {
    expect(
      extractRapidDirectVisibleQuote("Unable to get instant price for some parts. Please request a manual quote."),
    ).toBeNull();
  });
});

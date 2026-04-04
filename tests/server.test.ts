import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { describe, expect, it } from "vitest";

import { QuoteOrchestrator } from "../src/core/orchestrator.js";
import type { QuoteToolEnv, QuoteToolProfile, VendorQuoteResult } from "../src/core/types.js";
import { createApp } from "../src/server/app.js";
import type { VendorAdapter } from "../src/vendors/base.js";

const profile: QuoteToolProfile = {
  profileId: "standard-cnc-6061-us",
  description: "test",
  process: "cnc",
  fileFormat: "step",
  material: "aluminum_6061",
  finish: "standard",
  quantity: 1,
  geography: "us",
  shipToRegion: "IL",
  shipToPostalCode: "60611",
  preferredLeadTime: "standard",
};

describe("createApp", () => {
  it("accepts uploads and exposes run polling", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "quoting-tool-server-"));
    const env: QuoteToolEnv = {
      QUOTE_TOOL_ARTIFACT_ROOT: "./artifacts",
      QUOTE_TOOL_STORAGE_ROOT: "./storage",
      QUOTE_TOOL_HEADED: false,
      QUOTE_TOOL_PORT: 4310,
      HUBS_UNITS: "mm",
      HUBS_FINISH_SLUG: "as-machined-standard",
      HUBS_MATERIAL_SUBSET_ID: 124,
      HUBS_TECHNOLOGY_ID: 1,
      XOMETRY_STORAGE_STATE: "/tmp/xometry.json",
      RAPIDDIRECT_STORAGE_STATE: "/tmp/rapiddirect.json",
      PROTOLABS_STORAGE_STATE: "/tmp/protolabs.json",
      artifactRootAbs: root,
      storageRootAbs: root,
    };

    const adapters: Record<string, VendorAdapter> = {
      hubs: createStubAdapter("hubs"),
      xometry: createStubAdapter("xometry"),
      rapiddirect: createStubAdapter("rapiddirect"),
      protolabs: createStubAdapter("protolabs"),
    };
    const orchestrator = new QuoteOrchestrator(env, profile, adapters);
    const app = createApp(orchestrator);

    const stepPath = path.join(root, "part.step");
    await writeFile(stepPath, "solid", "utf8");

    const createResponse = await request(app)
      .post("/api/quotes")
      .field("vendors", "hubs,xometry")
      .attach("file", stepPath);

    expect(createResponse.status).toBe(202);
    const { runId } = createResponse.body as { runId: string };

    const getResponse = await request(app).get(`/api/runs/${runId}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.runId).toBe(runId);

    const fragmentResponse = await request(app).get(`/api/runs/${runId}?view=fragment`);
    expect(fragmentResponse.status).toBe(200);
    expect(fragmentResponse.text).toContain("<table>");
    expect(fragmentResponse.text).toContain("hubs");
  });
});

function createStubAdapter(vendor: VendorQuoteResult["vendor"]): VendorAdapter {
  return {
    vendor,
    integrationTier: vendor === "hubs" ? "api" : "browser",
    async prepare(ctx) {
      return ctx;
    },
    async quote() {
      return {};
    },
    async classify(_raw, ctx) {
      return {
        vendor,
        integrationTier: vendor === "hubs" ? "api" : "browser",
        status: "quoted",
        price: 99,
        currency: "USD",
        leadTime: "standard",
        material: "Aluminum 6061",
        normalizedConfig: {
          vendor,
          process: "cnc",
          material: "aluminum_6061",
          finish: "standard",
          quantity: 1,
          geography: "us",
          shipToRegion: "IL",
          shipToPostalCode: "60611",
          preferredLeadTime: "standard",
          extra: {},
        },
        artifactRef: {
          runDir: ctx.artifactRoot,
          files: [],
        },
      };
    },
    async collectArtifacts() {},
    async run(ctx) {
      const prepared = await this.prepare(ctx);
      const raw = await this.quote(prepared);
      return this.classify(raw, prepared);
    },
  };
}

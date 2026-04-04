import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { QuoteOrchestrator } from "../src/core/orchestrator.js";
import type { QuoteToolEnv, QuoteToolProfile, VendorQuoteResult } from "../src/core/types.js";
import type { VendorAdapter } from "../src/vendors/base.js";

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
  artifactRootAbs: "",
  storageRootAbs: "",
};

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

describe("QuoteOrchestrator", () => {
  it("collects partial vendor results without failing the whole run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "quoting-tool-orch-"));
    const partPath = path.join(root, "part.step");
    await writeFile(partPath, "solid", "utf8");

    const adapters: Record<string, VendorAdapter> = {
      hubs: createStubAdapter("hubs", { status: "quoted" }),
      xometry: createStubAdapter("xometry", { status: "quoted" }),
      rapiddirect: createStubAdapter("rapiddirect", { status: "failed" }),
      protolabs: createStubAdapter("protolabs", {
        status: "manual_review_required",
      }),
    };

    const orchestrator = new QuoteOrchestrator(
      {
        ...env,
        artifactRootAbs: root,
        storageRootAbs: root,
      },
      profile,
      adapters,
    );

    const run = await orchestrator.execute({
      filePath: partPath,
    });

    expect(run.status).toBe("completed");
    expect(run.results).toHaveLength(4);
    expect(run.results.find((item) => item.vendor === "protolabs")?.status).toBe(
      "manual_review_required",
    );
  });
});

function createStubAdapter(
  vendor: VendorQuoteResult["vendor"],
  result: Pick<VendorQuoteResult, "status">,
): VendorAdapter {
  return {
    vendor,
    integrationTier: vendor === "hubs" ? "api" : "browser",
    async prepare(ctx) {
      return ctx;
    },
    async quote() {
      return result;
    },
    async classify(raw, ctx) {
      return {
        vendor,
        integrationTier: vendor === "hubs" ? "api" : "browser",
        status: raw.status,
        price: raw.status === "quoted" ? 99 : undefined,
        currency: raw.status === "quoted" ? "USD" : undefined,
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

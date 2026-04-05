import { ArtifactCollector } from "../core/artifactStore.js";
import { DEFAULT_MATERIAL, getMaterialDefinition } from "../core/materials.js";
import { buildVendorNormalizedConfig } from "../core/normalizer.js";
import type {
  VendorExecutionContext,
  VendorQuoteResult,
} from "../core/types.js";
import { runHubsDirectQuote, type HubsDirectQuoteRawResult } from "../runtime/hubsDirectApi.js";
import type { PreparedVendorContext, VendorAdapter } from "./base.js";
import { VendorFailure } from "./base.js";

interface PreparedHubsContext extends PreparedVendorContext {}

export class HubsAdapter implements VendorAdapter<PreparedHubsContext, HubsDirectQuoteRawResult> {
  readonly vendor = "hubs" as const;
  readonly integrationTier = "api" as const;

  async prepare(execution: VendorExecutionContext): Promise<PreparedHubsContext> {
    const collector = await ArtifactCollector.create(execution.artifactRoot, ["vendors", "hubs"]);
    return {
      execution,
      collector,
      normalizedConfig: buildVendorNormalizedConfig(execution.request, this.vendor),
    };
  }

  async quote(ctx: PreparedHubsContext): Promise<HubsDirectQuoteRawResult> {
    const requestedMaterial = getMaterialDefinition(ctx.execution.request.material);
    const materialSubsetId = ctx.execution.request.material === DEFAULT_MATERIAL
      ? ctx.execution.env.HUBS_MATERIAL_SUBSET_ID
      : requestedMaterial.hubs.subsetId;

    return runHubsDirectQuote({
      partPath: ctx.execution.inputFilePath,
      quoteProfileId: "standard-cnc-6061-us",
      email:
        ctx.execution.env.HUBS_EMAIL ??
        `quoteget-${Date.now()}-${ctx.execution.runId.slice(0, 8)}@mailinator.com`,
      artifactDir: ctx.collector.runDir,
      units: ctx.execution.env.HUBS_UNITS,
      quantity: ctx.execution.request.quantity,
      finishSlug: ctx.execution.env.HUBS_FINISH_SLUG,
      materialSubsetId,
      technologyId: ctx.execution.env.HUBS_TECHNOLOGY_ID,
    });
  }

  async classify(raw: HubsDirectQuoteRawResult, ctx: PreparedHubsContext): Promise<VendorQuoteResult> {
    const expectedMaterialSlug = ctx.normalizedConfig.material;
    const requestedMaterial = getMaterialDefinition(ctx.execution.request.material);
    const result: VendorQuoteResult = {
      vendor: this.vendor,
      status: raw.status,
      price: raw.price,
      currency: raw.currency,
      leadTime: raw.leadTime,
      material: raw.material ?? raw.materialSubsetName ?? undefined,
      error: raw.status === "failed" ? raw.note : undefined,
      integrationTier: this.integrationTier,
      quoteId: raw.quoteId,
      normalizedConfig: ctx.normalizedConfig,
      artifactRef: {
        runDir: ctx.collector.runDir,
        files: [...ctx.collector.files],
      },
    };

    if (
      result.status === "quoted" &&
      raw.materialSubsetSlug &&
      raw.materialSubsetSlug !== expectedMaterialSlug
    ) {
      return {
        ...result,
        status: "manual_review_required",
        error: `Hubs priced the part with ${raw.materialSubsetName ?? raw.materialSubsetSlug} instead of ${requestedMaterial.label}.`,
        failureCode: "material_mismatch",
      };
    }

    return result;
  }

  async collectArtifacts(
    result: VendorQuoteResult,
    raw: HubsDirectQuoteRawResult,
    ctx: PreparedHubsContext,
  ): Promise<void> {
    await ctx.collector.writeJson("raw-result", raw);
    await ctx.collector.writeJson("result", result);
  }

  async run(execution: VendorExecutionContext): Promise<VendorQuoteResult> {
    const prepared = await this.prepare(execution);
    try {
      const raw = await this.quote(prepared);
      const result = await this.classify(raw, prepared);
      await this.collectArtifacts(result, raw, prepared);
      return {
        ...result,
        artifactRef: {
          runDir: prepared.collector.runDir,
          files: [...prepared.collector.files],
        },
      };
    } catch (error) {
      const failure = error instanceof VendorFailure
        ? error
        : new VendorFailure("runtime_error", error instanceof Error ? error.message : String(error));
      await prepared.collector.writeJson("error", {
        code: failure.code,
        message: failure.message,
      });
      return {
        vendor: this.vendor,
        status: failure.status,
        error: failure.message,
        failureCode: failure.code,
        integrationTier: this.integrationTier,
        normalizedConfig: prepared.normalizedConfig,
        artifactRef: {
          runDir: prepared.collector.runDir,
          files: [...prepared.collector.files],
        },
      };
    }
  }
}

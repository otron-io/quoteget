import { createRunArtifactRoot, copyInputFileToRun, createRunId } from "./artifactStore.js";
import { normalizeQuoteRequest } from "./quoteRequest.js";
import { InMemoryRunStore } from "./runStore.js";
import type {
  PreparedQuoteRun,
  QuoteRequestInput,
  QuoteRunResult,
  QuoteToolEnv,
  QuoteToolProfile,
  VendorExecutionContext,
} from "./types.js";
import type { VendorAdapter } from "../vendors/base.js";

export class QuoteOrchestrator {
  readonly runStore: InMemoryRunStore;

  constructor(
    readonly env: QuoteToolEnv,
    private readonly profile: QuoteToolProfile,
    private readonly adapterRegistry: Record<string, VendorAdapter>,
    runStore?: InMemoryRunStore,
  ) {
    this.runStore = runStore ?? new InMemoryRunStore();
  }

  async execute(input: QuoteRequestInput): Promise<QuoteRunResult> {
    const prepared = await this.prepare(input);
    const initialRun = this.createInitialRun(prepared);
    this.runStore.create(initialRun);
    this.runStore.running(prepared.runId);
    return this.runPrepared(prepared);
  }

  async submit(input: QuoteRequestInput): Promise<QuoteRunResult> {
    const prepared = await this.prepare(input);
    const initialRun = this.createInitialRun(prepared);
    this.runStore.create(initialRun);
    this.runStore.running(prepared.runId);

    void this.runPrepared(prepared).catch((error) => {
      this.runStore.fail(prepared.runId, error instanceof Error ? error.message : String(error));
    });

    return this.runStore.get(prepared.runId) ?? initialRun;
  }

  getRun(runId: string): QuoteRunResult | undefined {
    return this.runStore.get(runId);
  }

  private async prepare(input: QuoteRequestInput): Promise<PreparedQuoteRun> {
    const request = normalizeQuoteRequest(input, this.profile);
    const runId = createRunId();
    const artifactRoot = await createRunArtifactRoot(this.env.artifactRootAbs, runId);
    const inputFilePath = await copyInputFileToRun(request.filePath, artifactRoot);

    return {
      runId,
      request: {
        ...request,
        filePath: inputFilePath,
      },
      inputFilePath,
      artifactRoot,
    };
  }

  private createInitialRun(prepared: PreparedQuoteRun): QuoteRunResult {
    const now = new Date().toISOString();
    return {
      runId: prepared.runId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      request: prepared.request,
      inputFilePath: prepared.inputFilePath,
      artifactRoot: prepared.artifactRoot,
      results: [],
    };
  }

  private async runPrepared(prepared: PreparedQuoteRun): Promise<QuoteRunResult> {
    const tasks = prepared.request.vendors.map(async (vendor) => {
      const adapter = this.adapterRegistry[vendor];
      if (!adapter) {
        throw new Error(`Missing adapter for vendor '${vendor}'.`);
      }

      const execution: VendorExecutionContext = {
        runId: prepared.runId,
        request: prepared.request,
        inputFilePath: prepared.inputFilePath,
        artifactRoot: prepared.artifactRoot,
        env: this.env,
      };

      const result = await adapter.run(execution);
      this.runStore.addResult(prepared.runId, result);
      return result;
    });

    const settled = await Promise.allSettled(tasks);
    const rejected = settled.filter((item) => item.status === "rejected");
    if (rejected.length > 0) {
      const message = rejected
        .map((item) => (item as PromiseRejectedResult).reason)
        .map((reason) => (reason instanceof Error ? reason.message : String(reason)))
        .join("; ");
      this.runStore.fail(prepared.runId, message);
    } else {
      this.runStore.complete(prepared.runId);
    }

    const run = this.runStore.get(prepared.runId);
    if (!run) {
      throw new Error(`Run '${prepared.runId}' disappeared from the store.`);
    }
    return run;
  }
}

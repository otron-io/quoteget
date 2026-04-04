import type { QuoteRunResult, VendorQuoteResult } from "./types.js";

export class InMemoryRunStore {
  private readonly runs = new Map<string, QuoteRunResult>();

  create(run: QuoteRunResult): QuoteRunResult {
    this.runs.set(run.runId, run);
    return run;
  }

  get(runId: string): QuoteRunResult | undefined {
    return this.runs.get(runId);
  }

  addResult(runId: string, result: VendorQuoteResult): QuoteRunResult | undefined {
    const run = this.runs.get(runId);
    if (!run) {
      return undefined;
    }

    const next: QuoteRunResult = {
      ...run,
      updatedAt: new Date().toISOString(),
      results: [...run.results.filter((item) => item.vendor !== result.vendor), result],
    };
    this.runs.set(runId, next);
    return next;
  }

  complete(runId: string): QuoteRunResult | undefined {
    return this.updateStatus(runId, "completed");
  }

  fail(runId: string, error: string): QuoteRunResult | undefined {
    const run = this.runs.get(runId);
    if (!run) {
      return undefined;
    }
    const next: QuoteRunResult = {
      ...run,
      status: "failed",
      error,
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(runId, next);
    return next;
  }

  running(runId: string): QuoteRunResult | undefined {
    return this.updateStatus(runId, "running");
  }

  private updateStatus(
    runId: string,
    status: QuoteRunResult["status"],
  ): QuoteRunResult | undefined {
    const run = this.runs.get(runId);
    if (!run) {
      return undefined;
    }
    const next: QuoteRunResult = {
      ...run,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(runId, next);
    return next;
  }
}

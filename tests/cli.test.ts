import { describe, expect, it, vi } from "vitest";

import { runCli } from "../src/cli.js";
import type { QuoteRunResult } from "../src/core/types.js";

describe("runCli", () => {
  it("prints JSON results when requested", async () => {
    const write = vi.fn();
    const run: QuoteRunResult = {
      runId: "run-1",
      status: "completed",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z",
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
        vendors: ["hubs"],
      },
      inputFilePath: "/tmp/part.step",
      artifactRoot: "/tmp/run",
      results: [
        {
          vendor: "hubs",
          status: "quoted",
          price: 121.53,
          currency: "EUR",
          leadTime: "Economy",
          material: "Aluminum 6061",
        },
      ],
    };

    await runCli(
      ["/tmp/part.step", "--json"],
      {
        cwd: process.cwd(),
        stdout: { write },
        stderr: { write: vi.fn() },
        executeQuote: vi.fn(async () => run),
        startServer: vi.fn(async () => "http://localhost:4310"),
        captureAuth: vi.fn(async () => "/tmp/xometry.json"),
        runDoctor: vi.fn(async () => ({ ok: true, report: "ok" })),
        defaultPort: 4310,
      },
    );

    expect(write).toHaveBeenCalledWith(`${JSON.stringify(run.results, null, 2)}\n`);
  });
});

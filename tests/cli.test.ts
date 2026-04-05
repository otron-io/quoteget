import { describe, expect, it, vi } from "vitest";

import { runCli } from "../src/cli.js";
import { DEFAULT_VENDORS, type QuoteRunResult } from "../src/core/types.js";

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
        submitQuote: vi.fn(async () => run),
        getRun: vi.fn(() => run),
        startServer: vi.fn(async () => "http://localhost:4310"),
        captureAuth: vi.fn(async () => "/tmp/xometry.json"),
        runDoctor: vi.fn(async () => ({ ok: true, report: "ok" })),
        defaultPort: 4310,
      },
    );

    expect(write).toHaveBeenCalledWith(`${JSON.stringify(run.results, null, 2)}\n`);
  });

  it("streams vendor progress before printing the final table", async () => {
    const write = vi.fn();
    const run: QuoteRunResult = {
      runId: "run-2",
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
        vendors: ["hubs", "xometry"],
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
        {
          vendor: "xometry",
          status: "manual_review_required",
          material: "Aluminum 6061",
          error: "Please request a manual quote.",
        },
      ],
    };

    await runCli(
      ["/tmp/part.step"],
      {
        cwd: process.cwd(),
        stdout: { write },
        stderr: { write: vi.fn() },
        executeQuote: vi.fn(async () => run),
        submitQuote: vi.fn(async () => run),
        getRun: vi.fn(() => run),
        startServer: vi.fn(async () => "http://localhost:4310"),
        captureAuth: vi.fn(async () => "/tmp/xometry.json"),
        runDoctor: vi.fn(async () => ({ ok: true, report: "ok" })),
        defaultPort: 4310,
      },
    );

    expect(write).toHaveBeenNthCalledWith(1, "Run run-2 started.\n");
    expect(write).toHaveBeenNthCalledWith(2, "[hubs] running\n");
    expect(write).toHaveBeenNthCalledWith(3, "[xometry] running\n");
    expect(write).toHaveBeenNthCalledWith(4, "[hubs] quoted EUR 121.53\n");
    expect(write).toHaveBeenNthCalledWith(5, "[xometry] manual_review_required Please request a manual quote.\n");
    expect(write).toHaveBeenNthCalledWith(6, "Run run-2 completed.\n");
  });

  it("prefers the vendor error over price for non-quoted progress updates", async () => {
    const write = vi.fn();
    const run: QuoteRunResult = {
      runId: "run-3",
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
          status: "manual_review_required",
          price: 101,
          currency: "EUR",
          material: "Aluminum 7075",
          error: "Hubs priced the wrong material.",
        },
      ],
    };

    await runCli(
      ["/tmp/part.step"],
      {
        cwd: process.cwd(),
        stdout: { write },
        stderr: { write: vi.fn() },
        executeQuote: vi.fn(async () => run),
        submitQuote: vi.fn(async () => run),
        getRun: vi.fn(() => run),
        startServer: vi.fn(async () => "http://localhost:4310"),
        captureAuth: vi.fn(async () => "/tmp/xometry.json"),
        runDoctor: vi.fn(async () => ({ ok: true, report: "ok" })),
        defaultPort: 4310,
      },
    );

    expect(write).toHaveBeenNthCalledWith(3, "[hubs] manual_review_required Hubs priced the wrong material.\n");
  });

  it("routes the all subcommand to every supported vendor", async () => {
    const write = vi.fn();
    const executeQuote = vi.fn(async () => ({
      runId: "run-4",
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
        vendors: ["hubs", "xometry", "rapiddirect", "protolabs"],
      },
      inputFilePath: "/tmp/part.step",
      artifactRoot: "/tmp/run",
      results: [],
    }));

    await runCli(
      ["all", "/tmp/part.step", "--json"],
      {
        cwd: process.cwd(),
        stdout: { write },
        stderr: { write: vi.fn() },
        executeQuote,
        submitQuote: vi.fn(),
        getRun: vi.fn(),
        startServer: vi.fn(async () => "http://localhost:4310"),
        captureAuth: vi.fn(async () => "/tmp/xometry.json"),
        runDoctor: vi.fn(async () => ({ ok: true, report: "ok" })),
        defaultPort: 4310,
      },
    );

    expect(executeQuote).toHaveBeenCalledWith({
      filePath: "/tmp/part.step",
      material: "aluminum_6061",
      quantity: 1,
      vendors: ["hubs", "xometry", "rapiddirect", "protolabs"],
    });
  });

  it("uses the default vendor set when none is specified", async () => {
    const write = vi.fn();
    const executeQuote = vi.fn(async () => ({
      runId: "run-5",
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
        vendors: [...DEFAULT_VENDORS],
      },
      inputFilePath: "/tmp/part.step",
      artifactRoot: "/tmp/run",
      results: [],
    }));

    await runCli(
      ["/tmp/part.step", "--json"],
      {
        cwd: process.cwd(),
        stdout: { write },
        stderr: { write: vi.fn() },
        executeQuote,
        submitQuote: vi.fn(),
        getRun: vi.fn(),
        startServer: vi.fn(async () => "http://localhost:4310"),
        captureAuth: vi.fn(async () => "/tmp/xometry.json"),
        runDoctor: vi.fn(async () => ({ ok: true, report: "ok" })),
        defaultPort: 4310,
      },
    );

    expect(executeQuote).toHaveBeenCalledWith({
      filePath: "/tmp/part.step",
      material: "aluminum_6061",
      quantity: 1,
      vendors: [...DEFAULT_VENDORS],
    });
  });

  it("passes through a supported material override", async () => {
    const write = vi.fn();
    const executeQuote = vi.fn(async () => ({
      runId: "run-6",
      status: "completed",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z",
      request: {
        filePath: "/tmp/part.step",
        fileName: "part.step",
        process: "cnc",
        fileFormat: "step",
        material: "aluminum_7075",
        finish: "standard",
        quantity: 1,
        geography: "us",
        shipToRegion: "IL",
        shipToPostalCode: "60611",
        preferredLeadTime: "standard",
        vendors: [...DEFAULT_VENDORS],
      },
      inputFilePath: "/tmp/part.step",
      artifactRoot: "/tmp/run",
      results: [],
    }));

    await runCli(
      ["/tmp/part.step", "--material", "aluminum_7075", "--json"],
      {
        cwd: process.cwd(),
        stdout: { write },
        stderr: { write: vi.fn() },
        executeQuote,
        submitQuote: vi.fn(),
        getRun: vi.fn(),
        startServer: vi.fn(async () => "http://localhost:4310"),
        captureAuth: vi.fn(async () => "/tmp/xometry.json"),
        runDoctor: vi.fn(async () => ({ ok: true, report: "ok" })),
        defaultPort: 4310,
      },
    );

    expect(executeQuote).toHaveBeenCalledWith({
      filePath: "/tmp/part.step",
      material: "aluminum_7075",
      quantity: 1,
      vendors: [...DEFAULT_VENDORS],
    });
  });
});

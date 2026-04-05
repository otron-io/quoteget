#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { loadEnv } from "./config/env.js";
import { DEFAULT_MATERIAL, SUPPORTED_MATERIALS } from "./core/materials.js";
import { QuoteOrchestrator } from "./core/orchestrator.js";
import { loadDefaultProfile } from "./core/profile.js";
import { renderQuoteTable } from "./core/table.js";
import { BROWSER_VENDORS, DEFAULT_VENDORS, SUPPORTED_VENDORS, type BrowserVendorName, type QuoteRequestInput, type QuoteRunResult, type VendorName } from "./core/types.js";
import { captureVendorAuthSession } from "./runtime/authCapture.js";
import { runDoctor } from "./runtime/sessionDoctor.js";
import { startWebServer } from "./server/app.js";
import { adapters } from "./vendors/index.js";

interface CliDeps {
  cwd: string;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  executeQuote: (input: QuoteRequestInput) => Promise<QuoteRunResult>;
  submitQuote: (input: QuoteRequestInput) => Promise<QuoteRunResult>;
  getRun: (runId: string) => QuoteRunResult | undefined;
  startServer: (port: number) => Promise<string>;
  captureAuth: (vendor: BrowserVendorName) => Promise<string>;
  runDoctor: () => Promise<{ ok: boolean; report: string }>;
  defaultPort: number;
}

export async function createCliDeps(cwd = process.cwd()): Promise<CliDeps> {
  const env = loadEnv(cwd);
  const profile = await loadDefaultProfile(cwd);
  const orchestrator = new QuoteOrchestrator(env, profile, adapters);

  return {
    cwd,
    stdout: process.stdout,
    stderr: process.stderr,
    executeQuote: (input) => orchestrator.execute(input),
    submitQuote: (input) => orchestrator.submit(input),
    getRun: (runId) => orchestrator.getRun(runId),
    startServer: (port) => startWebServer(orchestrator, port),
    captureAuth: async (vendor) => captureVendorAuthSession({ vendor, env }),
    runDoctor: async () => runDoctor(env),
    defaultPort: env.QUOTE_TOOL_PORT,
  };
}

export function createProgram(deps: CliDeps): Command {
  const program = new Command()
    .name("quote")
    .description("Send one STEP file to multiple CNC quote vendors.");

  configureQuoteCommand(
    program.command("run").argument("<file>", "path to the STEP file").description("Request quotes from selected vendors."),
    deps,
  );
  configureQuoteCommand(
    program.command("all").argument("<file>", "path to the STEP file").description("Request quotes from every supported vendor."),
    deps,
    { forceAllVendors: true },
  );

  program
    .command("serve")
    .option("--port <port>", "port to bind", parseInteger, deps.defaultPort)
    .option("--no-open", "do not open the browser automatically")
    .action(async (options) => {
      const url = await deps.startServer(options.port);
      if (options.open) {
        openUrl(url);
      }
      deps.stdout.write(`Local UI listening on ${url}\n`);
    });

  const auth = program.command("auth").description("Browser session helpers.");
  auth
    .command("capture")
    .requiredOption("--vendor <slug>", `browser vendor (${BROWSER_VENDORS.join(", ")})`)
    .action(async (options) => {
      const storageStatePath = await deps.captureAuth(parseBrowserVendor(options.vendor));
      deps.stdout.write(`${storageStatePath}\n`);
    });

  program
    .command("doctor")
    .action(async () => {
      const result = await deps.runDoctor();
      deps.stdout.write(`${result.report}\n`);
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  return program;
}

function configureQuoteCommand(
  command: Command,
  deps: CliDeps,
  options?: { forceAllVendors?: boolean },
): void {
  command
    .option(
      "--material <material>",
      `material slug (${SUPPORTED_MATERIALS.join(", ")})`,
      DEFAULT_MATERIAL,
    )
    .option("--quantity <count>", "quantity", parseInteger, 1)
    .option("--json", "emit raw vendor results");

  if (!options?.forceAllVendors) {
    command.option("--vendors <vendors>", `comma-separated vendors (${SUPPORTED_VENDORS.join(", ")})`);
  }

  command.action(async (file, commandOptions) => {
      if (!file) {
        command.help();
        return;
      }

      const input: QuoteRequestInput = {
        filePath: file,
        material: commandOptions.material,
        quantity: commandOptions.quantity,
        vendors: options?.forceAllVendors
          ? [...SUPPORTED_VENDORS]
          : parseVendorList(commandOptions.vendors) ?? [...DEFAULT_VENDORS],
      };

      if (commandOptions.json) {
        const run = await deps.executeQuote(input);
        deps.stdout.write(`${JSON.stringify(run.results, null, 2)}\n`);
        return;
      }

      const run = await streamQuoteRun(input, deps);
      deps.stdout.write(`${renderQuoteTable(run)}\n`);
    });
}

export async function runCli(argv: string[], deps: CliDeps): Promise<void> {
  const program = createProgram(deps);
  await program.parseAsync(normalizeCliArgv(argv), { from: "user" });
}

function normalizeCliArgv(argv: string[]): string[] {
  if (argv.length === 0) {
    return argv;
  }

  const first = argv[0];
  if (first.startsWith("-")) {
    return argv;
  }

  const knownCommands = new Set(["run", "all", "serve", "auth", "doctor", "help"]);
  if (knownCommands.has(first)) {
    return argv;
  }

  return ["run", ...argv];
}

async function streamQuoteRun(input: QuoteRequestInput, deps: CliDeps): Promise<QuoteRunResult> {
  let run = await deps.submitQuote(input);
  deps.stdout.write(`Run ${run.runId} started.\n`);

  for (const vendor of run.request.vendors) {
    deps.stdout.write(`[${vendor}] running\n`);
  }

  const reported = new Set<string>();

  while (run.status === "pending" || run.status === "running") {
    reportNewResults(run, reported, deps);
    await delay(1_000);
    const latest = deps.getRun(run.runId);
    if (!latest) {
      break;
    }
    run = latest;
  }

  reportNewResults(run, reported, deps);
  deps.stdout.write(`Run ${run.runId} ${run.status}.\n`);
  return run;
}

function reportNewResults(
  run: QuoteRunResult,
  reported: Set<string>,
  deps: Pick<CliDeps, "stdout">,
): void {
  for (const result of run.results) {
    if (reported.has(result.vendor)) {
      continue;
    }
    reported.add(result.vendor);
    const price =
      result.status === "quoted" && result.price !== undefined && result.currency
        ? `${result.currency} ${result.price.toFixed(2)}`
        : result.error ?? "-";
    deps.stdout.write(`[${result.vendor}] ${result.status} ${price}\n`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("value must be a positive integer");
  }
  return parsed;
}

function parseVendorList(value?: string): VendorName[] | undefined {
  if (!value) {
    return undefined;
  }
  const vendors = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const vendor of vendors) {
    if (!SUPPORTED_VENDORS.includes(vendor as VendorName)) {
      throw new InvalidArgumentError(`vendor must be one of: ${SUPPORTED_VENDORS.join(", ")}`);
    }
  }
  return vendors as VendorName[];
}

function parseBrowserVendor(value: string): BrowserVendorName {
  if (!BROWSER_VENDORS.includes(value as BrowserVendorName)) {
    throw new InvalidArgumentError(`vendor must be one of: ${BROWSER_VENDORS.join(", ")}`);
  }
  return value as BrowserVendorName;
}

function openUrl(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  const child = spawn(command[0], command.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function main(): Promise<void> {
  const deps = await createCliDeps(process.cwd());
  await runCli(process.argv.slice(2), deps);
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entryUrl === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

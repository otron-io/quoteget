#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { loadEnv } from "./config/env.js";
import { browserStorageStateMap } from "./config/env.js";
import { QuoteOrchestrator } from "./core/orchestrator.js";
import { loadDefaultProfile } from "./core/profile.js";
import { renderQuoteTable } from "./core/table.js";
import { BROWSER_VENDORS, SUPPORTED_VENDORS, type BrowserVendorName, type QuoteRequestInput, type QuoteRunResult, type VendorName } from "./core/types.js";
import { captureVendorAuthSession } from "./runtime/authCapture.js";
import { runDoctor } from "./runtime/sessionDoctor.js";
import { startWebServer } from "./server/app.js";
import { adapters } from "./vendors/index.js";

interface CliDeps {
  cwd: string;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  executeQuote: (input: QuoteRequestInput) => Promise<QuoteRunResult>;
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
    startServer: (port) => startWebServer(orchestrator, port),
    captureAuth: async (vendor) => {
      const storageStatePath = browserStorageStateMap(env)[vendor];
      await captureVendorAuthSession({ vendor, storageStatePath });
      return storageStatePath;
    },
    runDoctor: async () => runDoctor(env),
    defaultPort: env.QUOTE_TOOL_PORT,
  };
}

export function createProgram(deps: CliDeps): Command {
  const program = new Command()
    .name("quote")
    .description("Send one STEP file to multiple CNC quote vendors.")
    .argument("[file]", "path to the STEP file")
    .option("--material <material>", "material slug", "aluminum_6061")
    .option("--quantity <count>", "quantity", parseInteger, 1)
    .option("--vendors <vendors>", `comma-separated vendors (${SUPPORTED_VENDORS.join(", ")})`)
    .option("--json", "emit raw vendor results")
    .action(async (file, options) => {
      if (!file) {
        program.help();
        return;
      }

      const run = await deps.executeQuote({
        filePath: file,
        material: options.material,
        quantity: options.quantity,
        vendors: parseVendorList(options.vendors),
      });

      if (options.json) {
        deps.stdout.write(`${JSON.stringify(run.results, null, 2)}\n`);
        return;
      }

      deps.stdout.write(`${renderQuoteTable(run)}\n`);
    });

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

export async function runCli(argv: string[], deps: CliDeps): Promise<void> {
  const program = createProgram(deps);
  await program.parseAsync(argv, { from: "user" });
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

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function createRunId(): string {
  return randomUUID();
}

export async function createRunArtifactRoot(root: string, runId: string): Promise<string> {
  const runRoot = path.join(root, "runs", runId);
  await mkdir(runRoot, { recursive: true });
  return runRoot;
}

export async function copyInputFileToRun(
  sourcePath: string,
  runRoot: string,
): Promise<string> {
  const inputDir = path.join(runRoot, "input");
  await mkdir(inputDir, { recursive: true });
  const destinationPath = path.join(inputDir, path.basename(sourcePath));
  await copyFile(sourcePath, destinationPath);
  return destinationPath;
}

export class ArtifactCollector {
  readonly runDir: string;
  readonly files: string[] = [];

  constructor(runDir: string) {
    this.runDir = runDir;
  }

  static async create(root: string, parts: string[]): Promise<ArtifactCollector> {
    const runDir = path.join(root, ...parts);
    await mkdir(runDir, { recursive: true });
    return new ArtifactCollector(runDir);
  }

  private record(filePath: string): string {
    this.files.push(filePath);
    return filePath;
  }

  async writeJson(name: string, payload: unknown): Promise<string> {
    const filePath = path.join(this.runDir, `${safeFileName(name)}.json`);
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    return this.record(filePath);
  }

  async writeText(name: string, payload: string, extension = "txt"): Promise<string> {
    const filePath = path.join(this.runDir, `${safeFileName(name)}.${extension}`);
    await writeFile(filePath, payload, "utf8");
    return this.record(filePath);
  }
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").toLowerCase();
}

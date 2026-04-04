import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import express from "express";
import multer from "multer";

import type { QuoteOrchestrator } from "../core/orchestrator.js";
import type { VendorName } from "../core/types.js";
import { renderAppPage, renderRunFragment } from "./ui.js";

export function createApp(orchestrator: QuoteOrchestrator) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() });

  app.get("/", (_request, response) => {
    response.type("html").send(renderAppPage());
  });

  app.post("/api/quotes", upload.single("file"), async (request, response) => {
    try {
      if (!request.file) {
        response.status(400).json({ error: "Missing file upload." });
        return;
      }

      const tempPath = await persistUpload(
        path.join(orchestrator.env.storageRootAbs, "uploads"),
        request.file.originalname,
        request.file.buffer,
      );

      const vendors = parseVendorsField(request.body.vendors);
      const run = await orchestrator.submit({
        filePath: tempPath,
        material: request.body.material,
        quantity: request.body.quantity ? Number(request.body.quantity) : undefined,
        vendors,
      });

      response.status(202).json({ runId: run.runId });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/runs/:id", (request, response) => {
    const run = orchestrator.getRun(request.params.id);
    if (!run) {
      response.status(404).json({ error: "Run not found." });
      return;
    }

    if (request.query.view === "fragment") {
      response.type("html").send(renderRunFragment(run));
      return;
    }

    response.json(run);
  });

  return app;
}

export async function startWebServer(
  orchestrator: QuoteOrchestrator,
  port: number,
): Promise<string> {
  const app = createApp(orchestrator);
  await new Promise<void>((resolve) => {
    app.listen(port, () => resolve());
  });
  return `http://localhost:${port}`;
}

async function persistUpload(root: string, originalName: string, buffer: Buffer): Promise<string> {
  await mkdir(root, { recursive: true });
  const destinationPath = path.join(root, `${randomUUID()}-${originalName}`);
  await writeFile(destinationPath, buffer);
  return destinationPath;
}

function parseVendorsField(value: unknown): VendorName[] | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as VendorName[];
}

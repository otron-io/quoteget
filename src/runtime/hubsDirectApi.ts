import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface HubsDirectQuoteOptions {
  partPath: string;
  quoteProfileId: string;
  email: string;
  artifactDir: string;
  units?: "mm" | "inch";
  quantity?: number;
  finishSlug?: string;
  materialSubsetId?: number;
  technologyId?: number;
  pollIntervalMs?: number;
  maxPolls?: number;
}

export interface HubsDirectQuoteRawResult {
  status: "quoted" | "failed";
  quoteId?: string;
  currency?: string;
  price?: number;
  leadTime?: string;
  material?: string;
  materialSubsetSlug?: string | null;
  materialSubsetName?: string | null;
  finishSlug?: string | null;
  note?: string;
}

interface Money {
  amount: number;
  currency_code: string;
}

interface ShippingOption {
  name: string;
  price: Money | null;
}

interface UploadPayload {
  id: number;
  uuid?: string | null;
  [key: string]: unknown;
}

const HUBS_BASE_URL = "https://www.hubs.com";

export async function runHubsDirectQuote(
  options: HubsDirectQuoteOptions,
): Promise<HubsDirectQuoteRawResult> {
  const units = options.units ?? "mm";
  const quantity = options.quantity ?? 1;
  const finishSlug = options.finishSlug ?? "as-machined-standard";
  const materialSubsetId = options.materialSubsetId ?? 124;
  const technologyId = options.technologyId ?? 1;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const maxPolls = options.maxPolls ?? 25;
  const partPath = path.resolve(options.partPath);
  const artifactDir = path.resolve(options.artifactDir);

  await mkdir(artifactDir, { recursive: true });

  const commonHeaders = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    referer: "https://www.hubs.com/manufacture/",
    "user-agent": "Mozilla/5.0",
  };

  interface HubsJwtBundle {
    access_token: string;
    refresh_token: string;
  }

  async function issueHubsJwt(body: Record<string, unknown> = {}): Promise<HubsJwtBundle> {
    const issued = await requestJson<{ data: HubsJwtBundle }>(
      `${HUBS_BASE_URL}/api/s/cnc/v1/jwt`,
      {
        method: "PATCH",
        headers: commonHeaders,
        body: JSON.stringify(body),
      },
    );
    return issued.data;
  }

  let { access_token: token, refresh_token: refreshToken } = await issueHubsJwt();
  const authHeaders = () => ({
    ...commonHeaders,
    authorization: `Bearer ${token}`,
  });

  const order = await requestJson<{ data: { uuid: string; quote_uuid: string; number: string | null } }>(
    `${HUBS_BASE_URL}/api/s/cnc/orders`,
    {
      method: "POST",
      headers: authHeaders(),
      body: "{}",
    },
  );
  const orderUuid = order.data.uuid;
  const quoteUuid = order.data.quote_uuid;

  const emailWallStatus = await requestStatus(
    `${HUBS_BASE_URL}/api/s/hubspot/form/email_wall`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email: options.email }),
    },
  );

  const anonymousCartStatus = await requestStatus(
    `${HUBS_BASE_URL}/api/s/conversion/anonymous-user-carts`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        order_uuid: orderUuid,
        anonymous_user_email: options.email,
      }),
    },
  );

  const partName = path.basename(partPath);
  const postSignature = await requestJson<{
    file_uuid?: string;
    post: {
      fields: Record<string, string>;
      url: string;
    };
  }>(`${HUBS_BASE_URL}/api/s/cnc/upload/post-signature`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name: partName }),
  });

  const fileBuffer = await readFile(partPath);
  const form = new FormData();
  for (const [key, value] of Object.entries(postSignature.post.fields)) {
    form.append(key, value);
  }
  form.append("file", new Blob([fileBuffer]), partName);

  const s3Response = await fetch(postSignature.post.url, {
    method: "POST",
    body: form,
  });
  if (!s3Response.ok) {
    throw new Error(`Hubs S3 upload failed with status ${s3Response.status}`);
  }

  const uploadKey = postSignature.post.fields.key;
  const fileUuid =
    postSignature.file_uuid ??
    uploadKey?.split("/").pop()?.replace(/\.[^.]+$/, "");
  if (!fileUuid) {
    throw new Error("Failed to derive Hubs file UUID from upload signature");
  }

  const upload = await requestJson<{ data: UploadPayload[] }>(
    `${HUBS_BASE_URL}/api/s/cnc/upload`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        file_uuid: fileUuid,
        units,
        technology_slug: "cnc-machining",
      }),
    },
  );
  const uploadPayload = upload.data[0];
  if (!uploadPayload) {
    throw new Error("Hubs upload API returned no upload payload");
  }

  const lineItem = await requestJson<{ data: { uuid: string | null } }>(
    `${HUBS_BASE_URL}/api/s/cnc/quotes/${quoteUuid}/line-items`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        thickness: null,
        title: partName,
        upload: uploadPayload,
        material_color_id: null,
        tolerance_id: null,
        custom_tolerance: null,
        custom_tolerance_unit: null,
        finish_slug: finishSlug,
        material_subset_id: materialSubsetId,
        technology_id: technologyId,
        quantity,
        upload_id: uploadPayload.id,
        unit: units,
      }),
    },
  );

  let quoteData: Record<string, unknown> | null = null;
  let shippingData: ShippingOption[] = [];
  let jwtRefreshes = 0;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const readHeaders = () => ({
      accept: commonHeaders.accept,
      authorization: `Bearer ${token}`,
      referer: commonHeaders.referer,
      "user-agent": commonHeaders["user-agent"],
    });

    try {
      const quote = await requestJson<{ data: Record<string, unknown> }>(
        `${HUBS_BASE_URL}/api/s/cnc/quotes/${quoteUuid}`,
        {
          headers: readHeaders(),
        },
      );
      quoteData = quote.data;

      const shipping = await requestJson<{ data: ShippingOption[] }>(
        `${HUBS_BASE_URL}/api/s/shipping/shipping-options?quote_uuid=${quoteUuid}`,
        {
          headers: readHeaders(),
        },
      );
      shippingData = shipping.data;
    } catch (error) {
      if (isHubsUnauthorizedError(error) && jwtRefreshes < 12) {
        const rotated = await issueHubsJwt({ refresh_token: refreshToken });
        token = rotated.access_token;
        refreshToken = rotated.refresh_token;
        jwtRefreshes += 1;
        attempt -= 1;
        continue;
      }
      throw error;
    }

    const part = findPartLineItem(quoteData, partName);
    const partPrice = part?.display_price ?? part?.auto_price ?? null;
    const total = getMoney(quoteData, "price", "total");
    if (partPrice && total) {
      break;
    }

    await sleep(pollIntervalMs);
  }

  if (!quoteData) {
    throw new Error("Hubs quote polling never returned quote data");
  }

  const partLineItem = findPartLineItem(quoteData, partName);
  const subtotalMoney = getMoney(quoteData, "price", "subtotal");

  const result: HubsDirectQuoteRawResult = {
    status: "quoted",
    quoteId: getString(quoteData, "quote_number") ?? undefined,
    currency: subtotalMoney?.currency_code ?? undefined,
    price: centsToUnitAmount(subtotalMoney?.amount),
    leadTime: shippingData[0]?.name ?? undefined,
    material: partLineItem?.material_subset_name ?? undefined,
    materialSubsetSlug: partLineItem?.material_subset_slug ?? null,
    materialSubsetName: partLineItem?.material_subset_name ?? null,
    finishSlug: partLineItem?.finish_slug ?? null,
    note: undefined,
  };

  await writeFile(
    path.join(artifactDir, "summary.json"),
    JSON.stringify(
      {
        result,
        statuses: {
          emailWall: emailWallStatus,
          anonymousUserCart: anonymousCartStatus,
          s3Upload: s3Response.status,
          quoteProfileId: options.quoteProfileId,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(path.join(artifactDir, "order.json"), JSON.stringify(order, null, 2), "utf8");
  await writeFile(path.join(artifactDir, "upload.json"), JSON.stringify(upload, null, 2), "utf8");
  await writeFile(path.join(artifactDir, "line-item.json"), JSON.stringify(lineItem, null, 2), "utf8");
  await writeFile(path.join(artifactDir, "quote.json"), JSON.stringify(quoteData, null, 2), "utf8");
  await writeFile(path.join(artifactDir, "shipping.json"), JSON.stringify(shippingData, null, 2), "utf8");

  return result;
}

export function isComparableHubsQuote(raw: HubsDirectQuoteRawResult): boolean {
  return (
    raw.materialSubsetSlug === "cnc-machining_aluminum-6061" &&
    raw.currency === "USD"
  );
}

function centsToUnitAmount(amount?: number): number | undefined {
  if (typeof amount !== "number") {
    return undefined;
  }
  return amount / 100;
}

async function requestStatus(url: string, init: RequestInit): Promise<number> {
  const response = await fetch(url, init);
  return response.status;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Hubs API ${response.status} for ${url}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

function isHubsUnauthorizedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bHubs API 401\b/.test(message);
}

function findPartLineItem(
  quoteData: Record<string, unknown>,
  partName: string,
): {
  display_price?: Money | null;
  auto_price?: Money | null;
  material_subset_slug?: string | null;
  material_subset_name?: string | null;
  finish_slug?: string | null;
} | null {
  const lineItems = Array.isArray(quoteData.line_items) ? quoteData.line_items : [];
  for (const candidate of lineItems) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "title" in candidate &&
      candidate.title === partName
    ) {
      return candidate as {
        display_price?: Money | null;
        auto_price?: Money | null;
        material_subset_slug?: string | null;
        material_subset_name?: string | null;
        finish_slug?: string | null;
      };
    }
  }
  return null;
}

function getMoney(
  quoteData: Record<string, unknown>,
  groupKey: string,
  moneyKey: string,
): Money | null {
  const group = quoteData[groupKey];
  if (!group || typeof group !== "object") {
    return null;
  }
  const money = (group as Record<string, unknown>)[moneyKey];
  if (!money || typeof money !== "object") {
    return null;
  }
  const amount = (money as Record<string, unknown>).amount;
  const currencyCode = (money as Record<string, unknown>).currency_code;
  if (typeof amount !== "number" || typeof currencyCode !== "string") {
    return null;
  }
  return {
    amount,
    currency_code: currencyCode,
  };
}

function getString(object: Record<string, unknown>, key: string): string | null {
  const value = object[key];
  return typeof value === "string" ? value : null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

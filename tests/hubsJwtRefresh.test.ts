import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi, afterEach } from "vitest";

import { runHubsDirectQuote } from "../src/runtime/hubsDirectApi.js";

describe("runHubsDirectQuote JWT refresh while polling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reuses the anonymous session via refresh_token on 401 during quote poll", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "hubs-jwt-"));
    const partPath = path.join(tmp, "part.step");
    await writeFile(partPath, "x", "utf8");
    const artifactDir = path.join(tmp, "artifacts");
    const jwtBody = {
      data: {
        access_token: "access-one",
        refresh_token: "refresh-one",
      },
    };
    const jwtRefreshBody = {
      data: {
        access_token: "access-two",
        refresh_token: "refresh-two",
      },
    };

    const orderBody = {
      data: {
        uuid: "order-uuid",
        quote_uuid: "quote-uuid",
        number: null,
      },
    };

    const emptyQuote = {
      data: {
        line_items: [],
        price: { subtotal: null, total: null },
      },
    };

    const pricedQuote = {
      data: {
        quote_number: "Q-1",
        line_items: [
          {
            title: "part.step",
            display_price: { amount: 100, currency_code: "USD" },
            material_subset_name: "Aluminum",
            material_subset_slug: "cnc-machining_aluminum-6061",
            finish_slug: "as-machined-standard",
          },
        ],
        price: {
          subtotal: { amount: 10000, currency_code: "USD" },
          total: { amount: 11000, currency_code: "USD" },
        },
      },
    };

    const shippingBody = { data: [{ name: "Standard", price: null }] };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/api/s/cnc/v1/jwt") && method === "PATCH") {
        const raw = init?.body ? String(init.body) : "{}";
        if (raw.includes("refresh_token")) {
          return new Response(JSON.stringify(jwtRefreshBody), { status: 200 });
        }
        return new Response(JSON.stringify(jwtBody), { status: 200 });
      }

      if (url.includes("/api/s/cnc/orders") && method === "POST") {
        return new Response(JSON.stringify(orderBody), { status: 200 });
      }

      if (url.includes("/hubspot/form/email_wall")) {
        return new Response("{}", { status: 200 });
      }

      if (url.includes("/anonymous-user-carts")) {
        return new Response("{}", { status: 200 });
      }

      if (url.includes("/upload/post-signature") && method === "POST") {
        return new Response(
          JSON.stringify({
            file_uuid: "file-uuid",
            post: {
              fields: { key: "k/part.step" },
              url: "https://example.invalid/upload",
            },
          }),
          { status: 200 },
        );
      }

      if (url === "https://example.invalid/upload") {
        return new Response("", { status: 200 });
      }

      if (url.includes("/api/s/cnc/upload") && method === "POST") {
        return new Response(JSON.stringify({ data: [{ id: 1, uuid: "up-1" }] }), {
          status: 200,
        });
      }

      if (url.includes("/line-items") && method === "POST") {
        return new Response(JSON.stringify({ data: { uuid: "li-1" } }), { status: 200 });
      }

      if (url.includes("/api/s/cnc/quotes/quote-uuid") && !url.includes("line-items")) {
        const auth = init?.headers && new Headers(init.headers as HeadersInit).get("authorization");
        if (auth === "Bearer access-one") {
          return new Response(
            `Hubs API 401 for ${url}: {"errors":{"code":4010,"message":"expired"}}`,
            { status: 401 },
          );
        }
        if (auth === "Bearer access-two") {
          return new Response(JSON.stringify(pricedQuote), { status: 200 });
        }
        return new Response(JSON.stringify(emptyQuote), { status: 200 });
      }

      if (url.includes("/shipping-options")) {
        return new Response(JSON.stringify(shippingBody), { status: 200 });
      }

      return new Response(`unexpected ${method} ${url}`, { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await runHubsDirectQuote({
      partPath,
      quoteProfileId: "p",
      email: "e@example.com",
      artifactDir,
      pollIntervalMs: 1,
      maxPolls: 5,
    });

    expect(result.status).toBe("quoted");
    expect(result.price).toBe(100);
    expect(result.quoteId).toBe("Q-1");

    const jwtCalls = fetchMock.mock.calls.filter(([u, init]) =>
      String(u).includes("/api/s/cnc/v1/jwt") && init?.method === "PATCH",
    );
    expect(jwtCalls.length).toBeGreaterThanOrEqual(2);
    const refreshCall = jwtCalls.find(([, init]) =>
      String(init?.body ?? "").includes("refresh_token"),
    );
    expect(refreshCall).toBeTruthy();
  });
});

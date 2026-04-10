import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  readJsonObject,
  requireTrustedRequest,
} from "@/lib/request-guards";

function buildRequest({
  body,
  headers,
  method = "POST",
  url = "http://localhost/api/test",
}: {
  body?: BodyInit | null;
  headers?: HeadersInit;
  method?: string;
  url?: string;
} = {}) {
  return new NextRequest(url, {
    method,
    headers,
    body,
  });
}

describe("requireTrustedRequest", () => {
  it("allows same-origin requests", () => {
    const request = buildRequest({
      headers: {
        origin: "http://localhost",
        "sec-fetch-site": "same-origin",
      },
    });

    expect(requireTrustedRequest(request)).toBeNull();
  });

  it("rejects requests from another origin", async () => {
    const request = buildRequest({
      headers: {
        origin: "https://evil.example",
      },
    });

    const response = requireTrustedRequest(request);

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Forbidden" });
  });

  it("rejects cross-site fetch metadata", async () => {
    const request = buildRequest({
      headers: {
        "sec-fetch-site": "cross-site",
      },
    });

    const response = requireTrustedRequest(request);

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Forbidden" });
  });
});

describe("readJsonObject", () => {
  it("parses a valid JSON object body", async () => {
    const request = buildRequest({
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ ok: true, count: 2 }),
    });

    const result = await readJsonObject(request);

    expect(result).toEqual({ data: { ok: true, count: 2 } });
  });

  it("rejects non-json content types", async () => {
    const request = buildRequest({
      headers: {
        "content-type": "text/plain",
      },
      body: '{"ok":true}',
    });

    const result = await readJsonObject(request);

    expect(result.response.status).toBe(415);
    expect(await result.response.json()).toEqual({
      error: "Content-Type must be application/json",
    });
  });

  it("rejects invalid JSON", async () => {
    const request = buildRequest({
      headers: {
        "content-type": "application/json",
      },
      body: "{",
    });

    const result = await readJsonObject(request);

    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({
      error: "Invalid JSON body",
    });
  });

  it("rejects array payloads", async () => {
    const request = buildRequest({
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(["not", "an", "object"]),
    });

    const result = await readJsonObject(request);

    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({
      error: "JSON body must be an object",
    });
  });
});

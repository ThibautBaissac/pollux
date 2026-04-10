import { NextRequest } from "next/server";

export function buildJsonRequest(
  url: string,
  body: Record<string, unknown>,
  init: {
    headers?: HeadersInit;
    method?: string;
  } = {},
): NextRequest {
  return new NextRequest(url, {
    method: init.method ?? "POST",
    headers: {
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...init.headers,
    },
    body: JSON.stringify(body),
  });
}

export function buildRequest(
  url: string,
  init: {
    body?: BodyInit | null;
    headers?: HeadersInit;
    method?: string;
  } = {},
): NextRequest {
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
  });
}

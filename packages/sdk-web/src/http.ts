import type { AuthConfig } from "./types";

export interface HttpRequest {
  url: string;
  method: "POST" | "GET";
  body?: unknown;
  timeoutMs: number;
  requestId: string;
  environment?: string;
  auth?: AuthConfig;
  extraHeaders?: Record<string, string>;
}

export interface HttpClient {
  request(input: HttpRequest): Promise<Response>;
}

export class FetchHttpClient implements HttpClient {
  constructor(private readonly fetchImpl: typeof fetch) {}

  async request(input: HttpRequest): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Request-Id": input.requestId,
      ...input.extraHeaders
    };

    if (input.environment) {
      headers["X-ENV"] = input.environment;
    }
    if (input.auth?.bearerToken) {
      headers.Authorization = `Bearer ${input.auth.bearerToken}`;
    } else if (input.auth?.apiKey) {
      headers["X-API-KEY"] = input.auth.apiKey;
    }

    try {
      return await this.fetchImpl(input.url, {
        method: input.method,
        headers,
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

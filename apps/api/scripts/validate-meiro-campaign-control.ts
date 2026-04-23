type Channel = "email" | "push" | "whatsapp";

type EndpointCheckResult = {
  channel: Channel;
  endpoint: string;
  url: string;
  status: number | null;
  ok: boolean;
  durationMs: number;
  bodyKind: "object" | "array" | "string" | "empty" | "invalid-json";
  topLevelKeys: string[];
  itemCount: number | null;
  schemaMatch: boolean;
  mismatches: string[];
  responseSnippet: string;
};

const endpointByChannel: Record<Channel, string> = {
  email: "/emails",
  push: "/push_notifications",
  whatsapp: "/whatsapp_campaigns"
};

const expectedWrappedKeysByChannel: Record<Channel, string[]> = {
  email: ["emails"],
  push: ["push_notifications"],
  whatsapp: ["whatsapp_campaigns", "trashed_whatsapp"]
};

const nowIso = () => new Date().toISOString();

const safeBaseUrl = (input: string): string => {
  const trimmed = input.trim().replace(/\/$/, "");
  const parsed = new URL(trimmed);
  parsed.username = "";
  parsed.password = "";
  return parsed.toString().replace(/\/$/, "");
};

const parseTimeoutMs = (): number => {
  const parsed = Number.parseInt(process.env.MEIRO_TIMEOUT_MS ?? "5000", 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 5000;
  }
  return parsed;
};

const toSnippet = (value: unknown): string => {
  if (typeof value === "string") {
    return value.slice(0, 500);
  }
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
};

const buildEndpointUrl = (baseUrl: string, endpoint: string): string => {
  const parsed = new URL(baseUrl);
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const basePath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  parsed.pathname = `${basePath}${normalizedEndpoint}`.replace(/\/{2,}/g, "/");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const evaluateBodyShape = (
  channel: Channel,
  parsedBody: unknown
): Pick<EndpointCheckResult, "bodyKind" | "topLevelKeys" | "itemCount" | "schemaMatch" | "mismatches"> => {
  const mismatches: string[] = [];
  const expectedKeys = expectedWrappedKeysByChannel[channel];

  if (Array.isArray(parsedBody)) {
    return {
      bodyKind: "array",
      topLevelKeys: [],
      itemCount: parsedBody.length,
      schemaMatch: true,
      mismatches
    };
  }

  if (!isRecord(parsedBody)) {
    mismatches.push("Response is neither a JSON array nor object.");
    return {
      bodyKind: parsedBody === "" ? "empty" : "string",
      topLevelKeys: [],
      itemCount: null,
      schemaMatch: false,
      mismatches
    };
  }

  const keys = Object.keys(parsedBody);
  for (const key of expectedKeys) {
    const value = parsedBody[key];
    if (Array.isArray(value)) {
      return {
        bodyKind: "object",
        topLevelKeys: keys,
        itemCount: value.length,
        schemaMatch: true,
        mismatches
      };
    }
  }

  mismatches.push(`Missing expected list wrapper key(s): ${expectedKeys.join(", ")}.`);
  return {
    bodyKind: "object",
    topLevelKeys: keys,
    itemCount: null,
    schemaMatch: false,
    mismatches
  };
};

const requestEndpoint = async (input: {
  baseUrl: string;
  token: string;
  channel: Channel;
  timeoutMs: number;
}): Promise<EndpointCheckResult> => {
  const endpoint = endpointByChannel[input.channel];
  const url = buildEndpointUrl(input.baseUrl, endpoint);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Access-Token": input.token,
        Authorization: `Bearer ${input.token}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    const text = await response.text();
    const durationMs = Date.now() - startedAt;
    let parsedBody: unknown = text;
    let bodyKind: EndpointCheckResult["bodyKind"] = text.length === 0 ? "empty" : "string";

    if (text.length > 0) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = text;
        bodyKind = "invalid-json";
      }
    }

    const shape = bodyKind === "invalid-json" ? null : evaluateBodyShape(input.channel, parsedBody);
    const mismatches: string[] = [];
    if (!response.ok) {
      mismatches.push(`HTTP ${response.status}`);
      if (response.status === 401 || response.status === 403) {
        mismatches.push("Permission/auth mismatch. Verify token scope and tenant.");
      }
    }
    if (shape && !shape.schemaMatch) {
      mismatches.push(...shape.mismatches);
    }

    return {
      channel: input.channel,
      endpoint,
      url,
      status: response.status,
      ok: response.ok && (shape?.schemaMatch ?? false),
      durationMs,
      bodyKind: shape?.bodyKind ?? bodyKind,
      topLevelKeys: shape?.topLevelKeys ?? [],
      itemCount: shape?.itemCount ?? null,
      schemaMatch: shape?.schemaMatch ?? false,
      mismatches,
      responseSnippet: toSnippet(parsedBody)
    };
  } catch (error) {
    return {
      channel: input.channel,
      endpoint,
      url,
      status: null,
      ok: false,
      durationMs: Date.now() - startedAt,
      bodyKind: "string",
      topLevelKeys: [],
      itemCount: null,
      schemaMatch: false,
      mismatches: [`Request failed: ${String(error)}`],
      responseSnippet: toSnippet(String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
};

const main = async () => {
  const baseUrlRaw = process.env.MEIRO_BASE_URL;
  const token = process.env.MEIRO_TOKEN;
  if (!baseUrlRaw || !token) {
    console.error("Missing required env: MEIRO_BASE_URL and MEIRO_TOKEN must be set.");
    process.exitCode = 2;
    return;
  }

  const baseUrl = safeBaseUrl(baseUrlRaw);
  const timeoutMs = parseTimeoutMs();
  const channels: Channel[] = ["email", "push", "whatsapp"];
  const checks: EndpointCheckResult[] = [];

  for (const channel of channels) {
    checks.push(
      await requestEndpoint({
        baseUrl,
        token,
        channel,
        timeoutMs
      })
    );
  }

  const failed = checks.filter((check) => !check.ok);
  const report = {
    generatedAt: nowIso(),
    baseUrl,
    timeoutMs,
    checks
  };

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = failed.length === 0 ? 0 : 1;
};

await main();

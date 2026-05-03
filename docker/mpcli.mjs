#!/usr/bin/env node

const VERSION = "deciengine-mpcli 0.1.0";

const usage = () => {
  console.error(`Usage:
  mpcli --version
  mpcli status
  mpcli api <METHOD> <PATH> [--json <json>] [--file <path>]

Environment:
  MPCLI_URL or MEIRO_PIPES_BASE_URL
  MPCLI_TOKEN or MEIRO_PIPES_TOKEN`);
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const readSecretFile = async (path) => {
  if (!path?.trim()) return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const value = (await readFile(path, "utf8")).trim();
    return value || null;
  } catch {
    return null;
  }
};

const readBody = async (args) => {
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex >= 0) {
    const value = args[jsonIndex + 1];
    if (!value) throw new Error("--json requires a value");
    return value;
  }

  const fileIndex = args.indexOf("--file");
  if (fileIndex >= 0) {
    const value = args[fileIndex + 1];
    if (!value) throw new Error("--file requires a path");
    const { readFile } = await import("node:fs/promises");
    return readFile(value, "utf8");
  }

  if (args.includes("--stdin")) {
    return readStdin();
  }

  return null;
};

const baseUrl = () => {
  const value = process.env.MPCLI_URL || process.env.MEIRO_PIPES_BASE_URL;
  if (!value?.trim()) throw new Error("MPCLI_URL or MEIRO_PIPES_BASE_URL is required");
  return value.trim().replace(/\/+$/, "");
};

const token = async () => {
  const value = process.env.MPCLI_TOKEN || process.env.MEIRO_PIPES_TOKEN;
  if (value?.trim()) return value.trim();
  const fileValue = (await readSecretFile(process.env.MPCLI_TOKEN_FILE)) || (await readSecretFile(process.env.MEIRO_PIPES_TOKEN_FILE));
  if (!fileValue) throw new Error("MPCLI_TOKEN, MEIRO_PIPES_TOKEN, MPCLI_TOKEN_FILE, or MEIRO_PIPES_TOKEN_FILE is required");
  return fileValue;
};

const request = async ({ method, path, body }) => {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const authToken = await token();
  const headers = {
    Authorization: `Bearer ${authToken}`,
    "X-Access-Token": authToken,
    "X-API-Key": authToken,
    Accept: "application/json"
  };
  if (body != null) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body ?? undefined
  });

  const text = await response.text();
  if (text) process.stdout.write(text);
  if (!text.endsWith("\n")) process.stdout.write("\n");
  if (!response.ok) process.exitCode = 1;
};

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }

  if (command === "--version" || command === "version") {
    console.log(VERSION);
    return;
  }

  if (command === "status") {
    await request({ method: "GET", path: "/api/auth/me" });
    return;
  }

  if (command === "api") {
    const [method, path, ...rest] = args;
    if (!method || !path) throw new Error("mpcli api requires <METHOD> and <PATH>");
    await request({ method: method.toUpperCase(), path, body: await readBody(rest) });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

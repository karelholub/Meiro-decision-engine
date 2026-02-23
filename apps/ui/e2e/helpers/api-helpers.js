import { expect } from "@playwright/test";

export const apiBase = process.env.E2E_API_BASE_URL || "http://localhost:3001";
export const apiKey = process.env.E2E_API_KEY || "local-write-key";
export const envHeader = process.env.E2E_ENV || "DEV";

export const readHeaders = (extra = {}) => ({
  "x-env": envHeader,
  ...extra
});

export const writeHeaders = (extra = {}) => ({
  "x-env": envHeader,
  "x-api-key": apiKey,
  ...extra
});

export const uniqueSuffix = () => `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

export async function expectJson(response, label) {
  const status = response.status();
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  expect(response.ok(), `${label} failed with ${status}: ${text}`).toBeTruthy();
  return body;
}

export async function getJson(request, path, label, headers = {}) {
  const response = await request.get(`${apiBase}${path}`, {
    headers
  });
  return expectJson(response, label);
}

export async function postJson(request, path, label, data, headers = {}) {
  const response = await request.post(`${apiBase}${path}`, {
    headers,
    data
  });
  return expectJson(response, label);
}

export async function putJson(request, path, label, data, headers = {}) {
  const response = await request.put(`${apiBase}${path}`, {
    headers,
    data
  });
  return expectJson(response, label);
}

import { describe, expect, it } from "vitest";
import { redactHeaders, redactPayload } from "../src/dlq/redaction";

describe("DLQ redaction", () => {
  it("redacts sensitive headers", () => {
    const output = redactHeaders({
      authorization: "Bearer secret",
      cookie: "a=b",
      "x-api-key": "abc",
      "content-type": "application/json"
    });

    expect(output.authorization).toBe("[REDACTED]");
    expect(output.cookie).toBe("[REDACTED]");
    expect(output["x-api-key"]).toBe("[REDACTED]");
    expect(output["content-type"]).toBe("application/json");
  });

  it("redacts sensitive payload keys recursively", () => {
    const output = redactPayload({
      profileId: "p-1001",
      token: "abc",
      nested: {
        client_secret: "hidden",
        keep: "ok",
        arr: [{ password: "123" }, { message: "safe" }]
      }
    }) as Record<string, unknown>;

    expect(output.token).toBe("[REDACTED]");
    expect((output.nested as Record<string, unknown>).client_secret).toBe("[REDACTED]");
    expect((output.nested as Record<string, unknown>).keep).toBe("ok");

    const arr = (output.nested as Record<string, unknown>).arr as Array<Record<string, unknown>>;
    expect(arr[0]?.password).toBe("[REDACTED]");
    expect(arr[1]?.message).toBe("safe");
  });
});

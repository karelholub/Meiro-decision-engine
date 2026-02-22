import { describe, expect, it } from "vitest";
import { classifyError, computeNextRetryAt } from "../src/dlq/retryPolicy";

describe("DLQ retry policy", () => {
  it("classifies timeout/network errors as transient", () => {
    const timeout = Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" });
    const result = classifyError(timeout);
    expect(result.type).toBe("TRANSIENT");
  });

  it("classifies validation/http4xx as permanent", () => {
    const err = Object.assign(new Error("validation failed"), { statusCode: 400 });
    const result = classifyError(err);
    expect(result.type).toBe("PERMANENT");
    expect(result.httpStatus).toBe(400);
  });

  it("computes exponential backoff with jitter bounds", () => {
    const now = new Date("2026-02-22T00:00:00.000Z");
    const next = computeNextRetryAt(
      3,
      {
        backoffBaseMs: 2000,
        backoffMaxMs: 600000,
        jitterPct: 30
      },
      now,
      () => 0.5
    );

    const delta = next.getTime() - now.getTime();
    expect(delta).toBeGreaterThanOrEqual(12000);
    expect(delta).toBeLessThanOrEqual(20000);
  });
});

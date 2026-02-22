import { describe, expect, it } from "vitest";

const runIntegration = process.env.RUN_DOCKER_INTEGRATION === "1";
const apiBase = process.env.INTEGRATION_API_BASE_URL ?? "http://localhost:3001";
const apiKey = process.env.INTEGRATION_API_KEY ?? "local-write-key";
const envHeader = process.env.INTEGRATION_ENV ?? "DEV";

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!runIntegration)("hybrid execution integration", () => {
  it("runs precompute and serves cached realtime decision on second call", async () => {
    const runKey = `integration_${Date.now()}`;
    const precomputeResponse = await fetch(`${apiBase}/v1/precompute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        "X-ENV": envHeader
      },
      body: JSON.stringify({
        runKey,
        mode: "decision",
        key: "cart_recovery",
        cohort: {
          type: "profiles",
          profiles: ["p-1001"]
        },
        context: {
          appKey: "integration",
          placement: "home_top"
        },
        ttlSecondsDefault: 3600,
        overwrite: true
      })
    });

    expect(precomputeResponse.status).toBe(202);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const runStatusResponse = await fetch(`${apiBase}/v1/precompute/runs/${runKey}`, {
        headers: { "X-ENV": envHeader }
      });
      expect(runStatusResponse.ok).toBe(true);
      const runStatus = await runStatusResponse.json();
      const status = runStatus.item?.status;
      if (status === "DONE") {
        break;
      }
      await sleep(200);
    }

    const resultsResponse = await fetch(`${apiBase}/v1/precompute/runs/${runKey}/results?limit=10`, {
      headers: { "X-ENV": envHeader }
    });
    expect(resultsResponse.ok).toBe(true);
    const resultsBody = await resultsResponse.json();
    expect(Array.isArray(resultsBody.items)).toBe(true);
    expect(resultsBody.items.length).toBeGreaterThan(0);

    const first = await fetch(`${apiBase}/v1/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ENV": envHeader
      },
      body: JSON.stringify({
        decisionKey: "cart_recovery",
        profileId: "p-1001",
        context: {
          appKey: "integration",
          placement: "home_top"
        },
        debug: true
      })
    });
    expect(first.ok).toBe(true);
    const firstBody = await first.json();
    expect(firstBody.debug?.cache?.hit).toBe(false);

    const second = await fetch(`${apiBase}/v1/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ENV": envHeader
      },
      body: JSON.stringify({
        decisionKey: "cart_recovery",
        profileId: "p-1001",
        context: {
          appKey: "integration",
          placement: "home_top"
        },
        debug: true
      })
    });
    expect(second.ok).toBe(true);
    const secondBody = await second.json();
    expect(secondBody.debug?.cache?.hit).toBe(true);
  });
});

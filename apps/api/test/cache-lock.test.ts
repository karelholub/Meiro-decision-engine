import { describe, expect, it } from "vitest";
import { createCache } from "../src/lib/cache";

const redisUrl = process.env.REDIS_URL;

describe.runIf(Boolean(redisUrl))("cache lock", () => {
  it("prevents stampede by allowing only one lock holder at a time", async () => {
    const cache = createCache({
      redisUrl
    });
    const key = `test:lock:${Date.now()}`;

    const first = await cache.lock(key, 500);
    const second = await cache.lock(key, 500);

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    if (first) {
      await first.release();
    }

    const third = await cache.lock(key, 500);
    expect(third).not.toBeNull();
    if (third) {
      await third.release();
    }

    await cache.del(key);
    await cache.quit();
  });
});

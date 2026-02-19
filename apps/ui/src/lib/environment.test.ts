import { describe, expect, it } from "vitest";
import { getEnvironment } from "./environment";

describe("environment helper", () => {
  it("defaults to DEV outside browser", () => {
    expect(getEnvironment()).toBe("DEV");
  });
});

import { describe, expect, it } from "vitest";
import { toQuery } from "./api";

describe("api query helper", () => {
  it("serializes mixed primitives and skips empty values", () => {
    const query = toQuery({
      page: 2,
      limit: 50,
      includeTrace: true,
      q: "cart",
      empty: "",
      nullable: null
    });

    expect(query).toContain("page=2");
    expect(query).toContain("limit=50");
    expect(query).toContain("includeTrace=true");
    expect(query).toContain("q=cart");
    expect(query).not.toContain("empty");
    expect(query).not.toContain("nullable");
  });
});

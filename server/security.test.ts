import { describe, expect, it } from "vitest";
import { decodeHtmlEntitiesOnce } from "../scripts/html-entities";

describe("HTML entity decoding", () => {
  it("decodes supported entities exactly once", () => {
    expect(decodeHtmlEntitiesOnce("https:&#x2F;&#x2F;example.test?a=1&amp;b=2")).toBe(
      "https://example.test?a=1&b=2"
    );
    expect(decodeHtmlEntitiesOnce("&amp;#x2F;private")).toBe("&#x2F;private");
  });
});

import { describe, expect, it } from "vitest";
import { allowedOrigins, buildCorsHeaders, findAllowedOrigin } from "./cors.mjs";

describe("Worker CORS", () => {
  it("allows only exact, normalized origins", () => {
    const allowed = allowedOrigins(
      { ALLOWED_ORIGINS: "https://trusted.example,*,javascript:alert(1)" },
      []
    );
    expect(allowed).toEqual(["https://trusted.example"]);
    expect(findAllowedOrigin("https://trusted.example", allowed)).toBe("https://trusted.example");
    expect(findAllowedOrigin("https://trusted.example.evil.test", allowed)).toBe("");
  });

  it("does not reflect untrusted origins with credentials", () => {
    const headers = buildCorsHeaders(
      new Request("https://worker.example/api/assistant/config", {
        headers: { Origin: "https://trusted.example.evil.test" }
      }),
      { ALLOWED_ORIGINS: "https://trusted.example,*" },
      []
    );
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });
});

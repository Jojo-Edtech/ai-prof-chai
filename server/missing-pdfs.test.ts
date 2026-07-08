import { describe, expect, it } from "vitest";
import { parseCsvLine } from "./missing-pdfs";

describe("missing PDF queue CSV parser", () => {
  it("parses empty quoted fields without turning them into quotes", () => {
    const row = parseCsvLine('"2009","Title","","WOS:123","has ""quote"""');
    expect(row).toEqual(["2009", "Title", "", "WOS:123", 'has "quote"']);
  });
});

describe("missing PDF queue progress", () => {
  it("exposes default progress counts from the real queue", async () => {
    const { loadMissingPdfQueue } = await import("./missing-pdfs");
    const queue = loadMissingPdfQueue(process.cwd());
    expect(queue.summary.progress.todo + queue.summary.progress.opened + queue.summary.progress.requested + queue.summary.progress.blocked).toBe(
      queue.summary.count
    );
  });
});

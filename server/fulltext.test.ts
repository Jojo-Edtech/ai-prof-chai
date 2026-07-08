import { describe, expect, it } from "vitest";
import type { FullTextIndex } from "../src/shared/types";
import { fullTextContext, fullTextStatus, retrieveFullText } from "./fulltext";

const index: FullTextIndex = {
  generatedAt: "2026-07-07T00:00:00.000Z",
  sourceGeneratedAt: "2026-07-07T00:00:00.000Z",
  professor: {
    displayName: "Chai Ching Sing",
    assistantName: "AI Prof. Chai",
    aliases: ["Chai CS"]
  },
  summary: {
    targetPdfSaved: 1,
    indexed: 1,
    failed: 0,
    totalTextLength: 100,
    maxTextCharsPerPdf: 120000
  },
  records: [
    {
      id: "record-1",
      title: "Teacher learning with AI",
      year: "2026",
      source: "Journal of AI Education",
      doi: "10.1234/teacher-ai",
      pdfFile: "teacher-ai.pdf",
      pdfPath: "data/pdfs/teacher-ai.pdf",
      status: "indexed",
      pageCount: 10,
      textLength: 100,
      text: "This paper studies teacher learning, artificial intelligence motivation, and classroom adoption."
    }
  ]
};

describe("full-text retrieval", () => {
  it("returns excerpts from indexed PDF text", () => {
    const hits = retrieveFullText(index, "teacher artificial intelligence", 2);
    expect(hits).toHaveLength(1);
    expect(hits[0].evidenceId).toBe("record-1#E001");
    expect(hits[0].excerpt).toContain("artificial intelligence");
    expect(fullTextContext(hits)).toContain("[Evidence 1]");
  });

  it("returns status without full text", () => {
    const status = fullTextStatus(index);
    expect(status.summary.available).toBe(true);
    expect(status.summary.evidenceChunks).toBe(1);
    expect(status.records[0]).not.toHaveProperty("text");
  });
});

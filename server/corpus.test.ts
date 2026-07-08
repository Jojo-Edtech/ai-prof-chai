import { describe, expect, it } from "vitest";
import type { CorpusProfile } from "../src/shared/types";
import { retrieveRecords } from "./corpus";

const profile: CorpusProfile = {
  generatedAt: new Date().toISOString(),
  sourceFiles: ["sample.txt"],
  professor: {
    displayName: "Chai Ching Sing",
    assistantName: "AI Prof. Chai",
    aliases: ["Chai CS"]
  },
  summary: {
    total: 2,
    firstAuthor: 1,
    correspondingAuthor: 1,
    firstOrCorresponding: 1,
    openAccess: 0,
    pdfSaved: 0,
    pdfNeeded: 1
  },
  records: [
    {
      id: "1",
      title: "AI education and teacher learning",
      year: "2025",
      source: "Computers & Education",
      documentType: "Article",
      doi: "10.1/a",
      doiUrl: "https://doi.org/10.1/a",
      authors: ["Chai, CS"],
      fullAuthors: ["Chai, Ching Sing"],
      keywords: ["artificial intelligence", "teacher learning"],
      abstract: "Teacher learning with artificial intelligence tools.",
      correspondingAddress: "Chai, Ching Sing",
      emails: [],
      oaUrl: "",
      isFirstAuthor: true,
      isCorrespondingAuthor: true,
      downloadStatus: "pdf-needed",
      pdfFile: "2025-ai-education-and-teacher-learning-10_1_a.pdf",
      sourceFile: "sample.txt"
    },
    {
      id: "2",
      title: "Unrelated mathematics intervention",
      year: "2024",
      source: "Journal",
      documentType: "Article",
      authors: ["Lee, A"],
      fullAuthors: ["Lee, A"],
      keywords: ["mathematics"],
      correspondingAddress: "",
      emails: [],
      oaUrl: "",
      isFirstAuthor: false,
      isCorrespondingAuthor: false,
      downloadStatus: "metadata-only",
      sourceFile: "sample.txt"
    }
  ]
};

describe("corpus retrieval", () => {
  it("prioritizes records matching the user question", () => {
    const records = retrieveRecords(profile, "teacher artificial intelligence", 1);
    expect(records[0].id).toBe("1");
  });
});

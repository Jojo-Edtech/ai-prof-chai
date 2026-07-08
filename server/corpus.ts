import fs from "node:fs";
import path from "node:path";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";

const emptyProfile: CorpusProfile = {
  generatedAt: new Date(0).toISOString(),
  sourceFiles: [],
  professor: {
    displayName: "Chai Ching Sing",
    assistantName: "AI Prof. Chai",
    aliases: ["Chai CS", "Chai, Ching Sing", "Chai, C. S."]
  },
  summary: {
    total: 0,
    firstAuthor: 0,
    correspondingAuthor: 0,
    firstOrCorresponding: 0,
    openAccess: 0,
    pdfSaved: 0,
    pdfNeeded: 0
  },
  records: []
};

export function profilePath(projectRoot: string) {
  return path.join(projectRoot, "data", "processed", "chai-publications.json");
}

export function openAlexProfilePath(projectRoot: string) {
  return path.join(projectRoot, "data", "processed", "openalex-chai-publications.json");
}

function readProfile(filePath: string) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as CorpusProfile;
  } catch {
    return null;
  }
}

export function loadCorpus(projectRoot: string): CorpusProfile {
  const wosProfile = readProfile(profilePath(projectRoot));
  if (wosProfile?.records.length) return wosProfile;
  return readProfile(openAlexProfilePath(projectRoot)) || wosProfile || emptyProfile;
}

function tokens(value: string) {
  return new Set(value.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length > 1));
}

function haystack(record: PublicationRecord) {
  return [record.title, record.abstract, record.source, record.year, record.keywords.join(" ")].filter(Boolean).join(" ");
}

export function retrieveRecords(profile: CorpusProfile, question: string, limit = 6) {
  const query = tokens(question);
  return profile.records
    .map((record) => {
      const text = haystack(record);
      const recordTokens = tokens(text);
      let score = 0;
      for (const token of query) {
        if (recordTokens.has(token)) score += 2;
        if (text.toLowerCase().includes(token)) score += 1;
      }
      if (record.isFirstAuthor) score += 0.4;
      if (record.isCorrespondingAuthor) score += 0.4;
      return { record, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.record);
}

export function corpusContext(records: PublicationRecord[]) {
  if (!records.length) return "当前还没有可用的本地语料记录。";
  return records
    .map((record, index) => {
      const flags = [
        record.isFirstAuthor ? "first author" : "",
        record.isCorrespondingAuthor ? "corresponding author" : ""
      ].filter(Boolean).join(", ");
      return [
        `[${index + 1}] ${record.title}`,
        `Year: ${record.year || "unknown"}`,
        `Source: ${record.source || "unknown"}`,
        `Role: ${flags || "other coauthor record"}`,
        `DOI: ${record.doi || "n/a"}`,
        `Keywords: ${record.keywords.slice(0, 8).join("; ") || "n/a"}`,
        `Abstract: ${(record.abstract || "n/a").slice(0, 900)}`
      ].join("\n");
    })
    .join("\n\n");
}

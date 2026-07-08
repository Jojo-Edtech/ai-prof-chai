import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFullTextIndex } from "../server/fulltext";
import { loadMissingPdfQueue } from "../server/missing-pdfs";
import type { CorpusProfile, MissingPdfQueueItem, PublicationRecord } from "../src/shared/types";

type AuditFile = {
  records?: Array<{
    title: string;
    doi?: string;
    wosAccession?: string;
    pdfFile?: string;
    confidence: "high" | "medium" | "low";
    score: number;
  }>;
};

type CoverageRow = {
  role: string;
  pdfStatus: string;
  fullTextStatus: string;
  auditConfidence: string;
  auditScore: string;
  accessPriority: string;
  nextStep: string;
  year: string;
  title: string;
  source: string;
  doi: string;
  wosAccession: string;
  expectedPdfFile: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const auditPath = path.join(projectRoot, "data", "processed", "saved-pdf-audit.json");
const outputsDir = path.join(projectRoot, "outputs");
const csvPath = path.join(outputsDir, "target-coverage-matrix.csv");
const markdownPath = path.join(outputsDir, "target-coverage-matrix.md");

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function roleLabel(record: PublicationRecord) {
  if (record.isFirstAuthor && record.isCorrespondingAuthor) return "first_and_corresponding";
  if (record.isFirstAuthor) return "first_author";
  return "corresponding_author";
}

function keyFor(record: { doi?: string; wosAccession?: string; pdfFile?: string; title?: string }) {
  return record.doi || record.wosAccession || record.pdfFile || record.title || "";
}

function priorityRank(priority = "") {
  const match = priority.match(/^(\d+)/);
  return match ? Number(match[1]) : 9;
}

function rowRank(row: CoverageRow) {
  if (row.pdfStatus !== "pdf-saved") return priorityRank(row.accessPriority);
  return 10;
}

if (!fs.existsSync(profilePath)) throw new Error("Missing data/processed/chai-publications.json. Run npm run import:wos first.");

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
const fullText = loadFullTextIndex(projectRoot);
const queue = loadMissingPdfQueue(projectRoot);
const audit = readJson<AuditFile>(auditPath);

const fullTextByFile = new Map((fullText?.records || []).map((record) => [record.pdfFile, record.status]));
const queueByKey = new Map<string, MissingPdfQueueItem>();
for (const item of queue.items) {
  if (item.doi) queueByKey.set(item.doi, item);
  if (item.wosAccession) queueByKey.set(item.wosAccession, item);
  if (item.expectedPdfFile) queueByKey.set(item.expectedPdfFile, item);
}
const auditByKey = new Map<string, NonNullable<AuditFile["records"]>[number]>();
for (const record of audit?.records || []) {
  if (record.doi) auditByKey.set(record.doi, record);
  if (record.wosAccession) auditByKey.set(record.wosAccession, record);
  if (record.pdfFile) auditByKey.set(record.pdfFile, record);
}

const targetRecords = profile.records.filter((record) => record.isFirstAuthor || record.isCorrespondingAuthor);
const rows: CoverageRow[] = targetRecords
  .map((record) => {
    const queueItem = queueByKey.get(keyFor(record)) || queueByKey.get(record.pdfFile || "");
    const auditRecord = auditByKey.get(keyFor(record)) || auditByKey.get(record.pdfFile || "");
    const fullTextStatus = record.pdfFile ? fullTextByFile.get(record.pdfFile) || "" : "";
    const isSaved = record.downloadStatus === "pdf-saved";
    return {
      role: roleLabel(record),
      pdfStatus: record.downloadStatus,
      fullTextStatus: isSaved ? fullTextStatus || "not-indexed" : "",
      auditConfidence: isSaved ? auditRecord?.confidence || "not-audited" : "",
      auditScore: isSaved && auditRecord ? String(auditRecord.score) : "",
      accessPriority: isSaved ? "" : queueItem?.accessPriority || "4 Hard locate",
      nextStep: isSaved ? "No PDF action needed." : queueItem?.nextStep || "Use DOI/WoS metadata for library lookup or document delivery.",
      year: record.year || "",
      title: record.title,
      source: record.source || "",
      doi: record.doi || "",
      wosAccession: record.wosAccession || "",
      expectedPdfFile: record.pdfFile || ""
    };
  })
  .sort((first, second) => {
    const rankDiff = rowRank(first) - rowRank(second);
    if (rankDiff) return rankDiff;
    return Number(second.year || 0) - Number(first.year || 0) || first.title.localeCompare(second.title);
  });

const columns: Array<keyof CoverageRow> = [
  "role",
  "pdfStatus",
  "fullTextStatus",
  "auditConfidence",
  "auditScore",
  "accessPriority",
  "nextStep",
  "year",
  "title",
  "source",
  "doi",
  "wosAccession",
  "expectedPdfFile"
];

fs.mkdirSync(outputsDir, { recursive: true });
fs.writeFileSync(csvPath, `${[columns, ...rows.map((row) => columns.map((column) => row[column]))].map((row) => row.map(csvCell).join(",")).join("\n")}\n`, "utf8");

const saved = rows.filter((row) => row.pdfStatus === "pdf-saved").length;
const missing = rows.length - saved;
const markdownLines = [
  "# Target Coverage Matrix",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `- Target records: ${rows.length}`,
  `- Saved target PDFs: ${saved}`,
  `- Missing target PDFs: ${missing}`,
  "",
  "| PDF | Audit | Priority | Year | Role | Title | Next step |",
  "|---|---|---|---:|---|---|---|",
  ...rows.map(
    (row) =>
      `| ${row.pdfStatus} | ${row.auditConfidence || ""} | ${row.accessPriority || ""} | ${row.year || "n.d."} | ${row.role} | ${row.title.replace(/\|/g, " ")} | ${row.nextStep.replace(/\|/g, " ")} |`
  )
];

fs.writeFileSync(markdownPath, `${markdownLines.join("\n")}\n`, "utf8");

console.log(`Coverage rows: ${rows.length}`);
console.log(csvPath);
console.log(markdownPath);

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";

type ExtractionResult = {
  status: "indexed" | "failed";
  pageCount?: number;
  text?: string;
  detail?: string;
};

type IndexedRecord = {
  id: string;
  title: string;
  year?: string;
  source?: string;
  doi?: string;
  wosAccession?: string;
  pdfFile: string;
  pdfPath: string;
  status: "indexed" | "failed";
  pageCount: number;
  textLength: number;
  text: string;
  detail?: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const pdfDir = path.join(projectRoot, "data", "pdfs");
const outputPath = path.join(projectRoot, "data", "processed", "chai-fulltext-index.json");
const summaryPath = path.join(projectRoot, "outputs", "ai-prof-chai-fulltext-index.md");
const helperPath = path.join(projectRoot, "scripts", "extract-pdf-text.py");
const bundledPython = "/Users/zhouxinxin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const python = process.env.AI_PROF_CHAI_PYTHON || (fs.existsSync(bundledPython) ? bundledPython : "python3");
const maxTextChars = Number(process.env.AI_PROF_CHAI_FULLTEXT_MAX_CHARS || 120000);

function isTarget(record: PublicationRecord) {
  return record.isFirstAuthor || record.isCorrespondingAuthor;
}

function normalizeText(value = "") {
  return value.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function extract(pdfPath: string): ExtractionResult {
  const output = execFileSync(python, [helperPath, pdfPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  return JSON.parse(output) as ExtractionResult;
}

function compactRecord(record: PublicationRecord, pdfPath: string, extracted: ExtractionResult): IndexedRecord {
  const text = normalizeText(extracted.text || "").slice(0, maxTextChars);
  return {
    id: record.id,
    title: record.title,
    year: record.year,
    source: record.source,
    doi: record.doi,
    wosAccession: record.wosAccession,
    pdfFile: record.pdfFile || "",
    pdfPath: path.relative(projectRoot, pdfPath),
    status: extracted.status,
    pageCount: extracted.pageCount || 0,
    textLength: text.length,
    text,
    detail: extracted.detail
  };
}

function writeSummary(index: {
  generatedAt: string;
  summary: { targetPdfSaved: number; indexed: number; failed: number; totalTextLength: number };
  records: IndexedRecord[];
}) {
  const lines = [
    "# AI Prof. Chai Full-Text Index",
    "",
    `Generated: ${index.generatedAt}`,
    "",
    `- Target PDFs saved: ${index.summary.targetPdfSaved}`,
    `- PDFs indexed: ${index.summary.indexed}`,
    `- Failed extractions: ${index.summary.failed}`,
    `- Total extracted characters: ${index.summary.totalTextLength}`,
    "",
    "## Indexed PDFs",
    "",
    "| Year | Status | Pages | Chars | Title |",
    "|---|---:|---:|---:|---|"
  ];

  for (const record of index.records) {
    lines.push(
      `| ${record.year || "n.d."} | ${record.status} | ${record.pageCount} | ${record.textLength} | ${record.title.replace(/\|/g, " ")} |`
    );
  }

  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
}

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
const savedTargets = profile.records.filter((record) => isTarget(record) && record.downloadStatus === "pdf-saved" && record.pdfFile);
const records: IndexedRecord[] = [];

for (const record of savedTargets) {
  const pdfPath = path.join(pdfDir, record.pdfFile || "");
  if (!fs.existsSync(pdfPath)) {
    records.push(compactRecord(record, pdfPath, { status: "failed", detail: "PDF file is missing" }));
    continue;
  }
  records.push(compactRecord(record, pdfPath, extract(pdfPath)));
}

const index = {
  generatedAt: new Date().toISOString(),
  sourceGeneratedAt: profile.generatedAt,
  professor: profile.professor,
  summary: {
    targetPdfSaved: savedTargets.length,
    indexed: records.filter((record) => record.status === "indexed").length,
    failed: records.filter((record) => record.status === "failed").length,
    totalTextLength: records.reduce((sum, record) => sum + record.textLength, 0),
    maxTextCharsPerPdf: maxTextChars
  },
  records
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
writeSummary(index);

console.log(`Target PDFs saved: ${index.summary.targetPdfSaved}`);
console.log(`PDFs indexed: ${index.summary.indexed}`);
console.log(`Failed extractions: ${index.summary.failed}`);
console.log(`Full-text index: ${outputPath}`);
console.log(`Summary: ${summaryPath}`);

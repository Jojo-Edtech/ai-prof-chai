import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusProfile, FullTextIndex, PublicationRecord } from "../src/shared/types";

type AuditRecord = {
  title: string;
  year?: string;
  doi?: string;
  wosAccession?: string;
  pdfFile?: string;
  confidence: "high" | "medium" | "low";
  score: number;
  checks: {
    doi: boolean;
    year: boolean;
    titleTokenRatio: number;
    authorTokenRatio: number;
    textLength: number;
  };
  reasons: string[];
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const fullTextPath = path.join(projectRoot, "data", "processed", "chai-fulltext-index.json");
const outputPath = path.join(projectRoot, "data", "processed", "saved-pdf-audit.json");
const markdownPath = path.join(projectRoot, "outputs", "saved-pdf-audit.md");

function normalize(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function doiKey(value = "") {
  return value.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/[^a-z0-9]+/g, "");
}

function tokenSet(value: string) {
  const stop = new Set([
    "about",
    "among",
    "and",
    "based",
    "from",
    "into",
    "learning",
    "study",
    "that",
    "their",
    "the",
    "through",
    "with"
  ]);
  return [...new Set(normalize(value).split(/\s+/).filter((token) => token.length >= 5 && !stop.has(token)))];
}

function ratio(tokens: string[], text: string) {
  if (!tokens.length) return 0;
  return tokens.filter((token) => text.includes(token)).length / tokens.length;
}

function authorTokens(record: PublicationRecord) {
  return [...new Set(record.authors.flatMap((author) => normalize(author).split(/\s+/)).filter((token) => token.length >= 4))];
}

function confidence(score: number, checks: AuditRecord["checks"]): AuditRecord["confidence"] {
  if (checks.year && checks.titleTokenRatio >= 0.85 && checks.authorTokenRatio >= 0.5) return "high";
  if (score >= 780 || (checks.doi && checks.titleTokenRatio >= 0.35)) return "high";
  if (score >= 430 || checks.titleTokenRatio >= 0.5) return "medium";
  return "low";
}

function auditRecord(record: PublicationRecord, text = ""): AuditRecord {
  const normalizedText = normalize(text);
  const titleTokens = tokenSet(record.title);
  const authors = authorTokens(record);
  const titleTokenRatio = ratio(titleTokens, normalizedText);
  const authorTokenRatio = ratio(authors, normalizedText);
  const doi = Boolean(record.doi && doiKey(normalizedText).includes(doiKey(record.doi)));
  const year = Boolean(record.year && normalizedText.includes(record.year));

  let score = 0;
  const reasons: string[] = [];
  if (doi) {
    score += 650;
    reasons.push("DOI found in extracted text");
  }
  if (year) {
    score += 60;
    reasons.push("year found");
  }
  if (titleTokenRatio >= 0.25) {
    const points = Math.round(titleTokenRatio * 420);
    score += points;
    reasons.push(`${Math.round(titleTokenRatio * 100)}% title-token match`);
  }
  if (authorTokenRatio >= 0.25) {
    const points = Math.round(authorTokenRatio * 180);
    score += points;
    reasons.push(`${Math.round(authorTokenRatio * 100)}% author-token match`);
  }
  if (text.length < 1000) {
    score -= 150;
    reasons.push("very short extracted text");
  }

  const checks = {
    doi,
    year,
    titleTokenRatio,
    authorTokenRatio,
    textLength: text.length
  };

  return {
    title: record.title,
    year: record.year,
    doi: record.doi,
    wosAccession: record.wosAccession,
    pdfFile: record.pdfFile,
    confidence: confidence(score, checks),
    score,
    checks,
    reasons
  };
}

function isTarget(record: PublicationRecord) {
  return record.isFirstAuthor || record.isCorrespondingAuthor;
}

if (!fs.existsSync(profilePath)) throw new Error("Missing data/processed/chai-publications.json. Run npm run import:wos first.");
if (!fs.existsSync(fullTextPath)) throw new Error("Missing data/processed/chai-fulltext-index.json. Run npm run index:pdfs first.");

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
const fullText = JSON.parse(fs.readFileSync(fullTextPath, "utf8")) as FullTextIndex;
const fullTextByFile = new Map(fullText.records.map((record) => [record.pdfFile, record.text || ""]));
const savedTargets = profile.records.filter((record) => isTarget(record) && record.downloadStatus === "pdf-saved" && record.pdfFile);
const records = savedTargets.map((record) => auditRecord(record, fullTextByFile.get(record.pdfFile || "") || ""));
const summary = {
  generatedAt: new Date().toISOString(),
  targetPdfSaved: savedTargets.length,
  high: records.filter((record) => record.confidence === "high").length,
  medium: records.filter((record) => record.confidence === "medium").length,
  low: records.filter((record) => record.confidence === "low").length
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ summary, records }, null, 2)}\n`, "utf8");

const lines = [
  "# Saved PDF Audit",
  "",
  `Generated: ${summary.generatedAt}`,
  "",
  `- Target PDFs saved: ${summary.targetPdfSaved}`,
  `- High confidence: ${summary.high}`,
  `- Medium confidence: ${summary.medium}`,
  `- Low confidence: ${summary.low}`,
  "",
  "| Confidence | Score | Year | DOI hit | Title hit | Author hit | Title |",
  "|---|---:|---:|---:|---:|---:|---|",
  ...records.map(
    (record) =>
      `| ${record.confidence} | ${record.score} | ${record.year || "n.d."} | ${record.checks.doi ? "yes" : "no"} | ${Math.round(
        record.checks.titleTokenRatio * 100
      )}% | ${Math.round(record.checks.authorTokenRatio * 100)}% | ${record.title.replace(/\|/g, " ")} |`
  )
];

fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
fs.writeFileSync(markdownPath, `${lines.join("\n")}\n`, "utf8");

console.log(`Audited target PDFs: ${summary.targetPdfSaved}`);
console.log(`High confidence: ${summary.high}`);
console.log(`Medium confidence: ${summary.medium}`);
console.log(`Low confidence: ${summary.low}`);
console.log(outputPath);
console.log(markdownPath);

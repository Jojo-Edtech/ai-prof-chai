import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";
import { writeTargetOutputs } from "./target-outputs";

type CandidateMatch = {
  record: PublicationRecord;
  score: number;
  reasons: string[];
};

type IngestResult = {
  sourceFile: string;
  status: "saved" | "skipped" | "unmatched" | "ambiguous" | "not-pdf";
  targetFile?: string;
  matchedTitle?: string;
  score?: number;
  detail?: string;
  reasons?: string[];
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const inboxDir = path.join(projectRoot, "data", "pdf-inbox");
const pdfDir = path.join(projectRoot, "data", "pdfs");
const reportDir = path.join(projectRoot, "data", "wos-downloads");
const today = new Date().toISOString().slice(0, 10);
const reportPath = path.join(reportDir, `manual-pdf-ingest-report-${today}.json`);
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const recursive = process.argv.includes("--recursive");
const downloadsDir = path.join(os.homedir(), "Downloads");
const helperPath = path.join(projectRoot, "scripts", "extract-pdf-text.py");
const bundledPython = "/Users/zhouxinxin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const python = process.env.AI_PROF_CHAI_PYTHON || (fs.existsSync(bundledPython) ? bundledPython : "python3");

const knownFalsePositiveRules = [
  {
    label: "CUHK 389282960 medical-students paper",
    patterns: [
      /10\s*3390\s*ijerph191912648/i,
      /surveying and modelling 21st century online learning patterns of medical students/i,
      /international journal of environmental research and public health/i
    ]
  },
  {
    label: "OpenAlex IDEALS Brown Collins Duguid candidate",
    patterns: [
      /brown collins duguid/i,
      /situated cognition and the culture of learning/i,
      /educational researcher/i
    ]
  }
];

function argValue(name: string) {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function expandHome(value: string) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function sourceDir() {
  const customDir = argValue("--dir");
  if (customDir) return path.resolve(expandHome(customDir));
  if (process.argv.includes("--downloads")) return downloadsDir;
  return inboxDir;
}

function normalize(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function doiKey(value = "") {
  return value.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/[^a-z0-9]+/g, "");
}

function titleTokens(title: string) {
  const stop = new Set(["about", "among", "and", "with", "from", "into", "that", "this", "their", "the", "for"]);
  return normalize(title)
    .split(/\s+/)
    .filter((token) => token.length >= 5 && !stop.has(token));
}

function isTarget(record: PublicationRecord) {
  return record.isFirstAuthor || record.isCorrespondingAuthor;
}

function isPdf(filePath: string) {
  try {
    const handle = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(5);
    fs.readSync(handle, buffer, 0, 5, 0);
    fs.closeSync(handle);
    return buffer.toString("latin1") === "%PDF-";
  } catch {
    return false;
  }
}

function extractedText(filePath: string) {
  try {
    const output = execFileSync(python, [helperPath, filePath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    const parsed = JSON.parse(output) as { status?: string; text?: string };
    if (parsed.status === "indexed" && parsed.text) return parsed.text;
  } catch {
    // Fall back to raw strings below; some PDFs can be malformed but still contain matchable text.
  }
  try {
    return execFileSync("strings", ["-n", "5", filePath], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });
  } catch {
    try {
      return fs.readFileSync(filePath).subarray(0, 2 * 1024 * 1024).toString("latin1");
    } catch {
      return "";
    }
  }
}

function falsePositiveDetail(filePath: string, text: string) {
  const basename = normalize(path.basename(filePath));
  const normalizedText = normalize(text.slice(0, 100000));
  const searchable = `${basename} ${normalizedText}`;

  for (const rule of knownFalsePositiveRules) {
    if (rule.patterns.every((pattern) => pattern.test(searchable))) {
      return `known false positive: ${rule.label}`;
    }
  }

  return "";
}

function matchRecord(filePath: string, records: PublicationRecord[], text = extractedText(filePath)): CandidateMatch[] {
  const basename = path.basename(filePath).toLowerCase();
  const fileStem = basename.replace(/\.pdf$/i, "");
  const extracted = normalize(text.slice(0, 600000));
  const leadText = normalize(`${basename} ${extracted.slice(0, 8000)}`);
  const frontText = normalize(`${basename} ${extracted.slice(0, 30000)}`);
  const fullText = normalize(`${basename} ${extracted}`);

  return records
    .map((record) => {
      let score = 0;
      const reasons: string[] = [];
      const expectedStem = (record.pdfFile || "").replace(/\.pdf$/i, "").toLowerCase();
      const doi = doiKey(record.doi);
      const tokens = titleTokens(record.title);
      const filenameMatchedTokens = tokens.filter((token) => normalize(fileStem).includes(token));
      const matchedTokens = tokens.filter((token) => leadText.includes(token));

      if (expectedStem && fileStem === expectedStem) {
        score += 1000;
        reasons.push("exact expected filename");
      }
      if (doi && doiKey(basename).includes(doi)) {
        score += 700;
        reasons.push("filename DOI match");
      }
      if (doi && doiKey(frontText).includes(doi)) {
        score += 700;
        reasons.push("PDF front text DOI match");
      } else if (doi && doiKey(fullText).includes(doi)) {
        score += 80;
        reasons.push("PDF full text DOI mention");
      }
      if (record.year && frontText.includes(record.year)) {
        score += 40;
        reasons.push("year match");
      }
      if (tokens.length) {
        const filenameRatio = filenameMatchedTokens.length / tokens.length;
        if (filenameRatio >= 0.6) {
          score += Math.round(filenameRatio * 520);
          reasons.push(`${filenameMatchedTokens.length}/${tokens.length} filename title tokens`);
        }
        const firstTitleTokenIndex = normalize(fileStem).indexOf(tokens[0]);
        if (firstTitleTokenIndex >= 0 && firstTitleTokenIndex <= 35) {
          score += 180;
          reasons.push("filename starts with title");
        }
      }
      if (tokens.length) {
        const ratio = matchedTokens.length / tokens.length;
        if (ratio >= 0.35) {
          score += Math.round(ratio * 500);
          reasons.push(`${matchedTokens.length}/${tokens.length} title tokens`);
        }
      }

      return { record, score, reasons };
    })
    .filter((match) => match.score >= 250)
    .sort((left, right) => right.score - left.score);
}

function tokenRatioFromReason(reasons: string[], label: "title tokens" | "filename title tokens") {
  let best = 0;
  for (const reason of reasons) {
    if (!reason.endsWith(label)) continue;
    const match = reason.match(/^(\d+)\/(\d+)/);
    if (!match) continue;
    const ratio = Number(match[1]) / Number(match[2]);
    if (Number.isFinite(ratio)) best = Math.max(best, ratio);
  }
  return best;
}

function canAutoAccept(match: CandidateMatch) {
  const strongEvidence = match.reasons.some((reason) =>
    ["exact expected filename", "filename DOI match", "PDF front text DOI match"].includes(reason)
  );
  if (strongEvidence) return true;

  const titleRatio = tokenRatioFromReason(match.reasons, "title tokens");
  const filenameRatio = tokenRatioFromReason(match.reasons, "filename title tokens");
  const hasYear = match.reasons.includes("year match");
  const filenameStartsWithTitle = match.reasons.includes("filename starts with title");

  return match.score >= 420 && titleRatio >= 0.6 && (hasYear || filenameRatio >= 0.6 || filenameStartsWithTitle);
}

function refreshPdfStatus(profile: CorpusProfile) {
  profile.records = profile.records.map((record) => {
    if (!record.pdfFile) return record;
    return fs.existsSync(path.join(pdfDir, record.pdfFile)) ? { ...record, downloadStatus: "pdf-saved" } : record;
  });
  profile.generatedAt = new Date().toISOString();
  profile.summary.openAccess = profile.records.filter((record) => record.openAccess).length;
  profile.summary.pdfSaved = profile.records.filter((record) => record.downloadStatus === "pdf-saved").length;
  profile.summary.pdfNeeded = profile.records.filter((record) => record.downloadStatus === "pdf-needed").length;
}

fs.mkdirSync(inboxDir, { recursive: true });
fs.mkdirSync(pdfDir, { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });

if (!fs.existsSync(profilePath)) {
  throw new Error("Missing data/processed/chai-publications.json. Run npm run import:wos first.");
}

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
const targetRecords = profile.records.filter(isTarget);
const ingestDir = sourceDir();
const usingDownloads = path.resolve(ingestDir) === path.resolve(downloadsDir);
function collectPdfFiles(dir: string, relativeBase = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relativePath = path.join(relativeBase, entry.name);
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) files.push(...collectPdfFiles(absolutePath, relativePath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) files.push(relativePath);
  }
  return files.sort();
}

const inboxFiles = collectPdfFiles(ingestDir);
const results: IngestResult[] = [];

function reportResults(resultsToWrite: IngestResult[]) {
  if (!usingDownloads) return resultsToWrite;
  return resultsToWrite.map((result) => {
    if (result.status === "unmatched" || result.status === "not-pdf") {
      return { ...result, sourceFile: "Downloads/(unmatched PDF redacted)" };
    }
    return { ...result, sourceFile: `Downloads/${path.basename(result.sourceFile)}` };
  });
}

for (const file of inboxFiles) {
  const sourcePath = path.join(ingestDir, file);
  if (!isPdf(sourcePath)) {
    results.push({ sourceFile: sourcePath, status: "not-pdf", detail: "file does not start with %PDF-" });
    continue;
  }

  const rawText = extractedText(sourcePath);
  const blocked = falsePositiveDetail(sourcePath, rawText);
  if (blocked) {
    results.push({ sourceFile: sourcePath, status: "unmatched", detail: blocked });
    continue;
  }

  const matches = matchRecord(sourcePath, targetRecords, rawText);
  const best = matches[0];
  const second = matches[1];

  if (!best) {
    results.push({ sourceFile: sourcePath, status: "unmatched", detail: "no target record reached the matching threshold" });
    continue;
  }
  if (!canAutoAccept(best)) {
    results.push({
      sourceFile: sourcePath,
      status: "unmatched",
      matchedTitle: best.record.title,
      score: best.score,
      detail: "best candidate did not have enough DOI, filename, year, or title evidence for automatic import",
      reasons: best.reasons
    });
    continue;
  }
  if (second && best.score - second.score < 120) {
    results.push({
      sourceFile: sourcePath,
      status: "ambiguous",
      matchedTitle: best.record.title,
      score: best.score,
      detail: `second candidate too close: ${second.record.title} (${second.score})`,
      reasons: best.reasons
    });
    continue;
  }
  if (!best.record.pdfFile) {
    results.push({ sourceFile: sourcePath, status: "skipped", matchedTitle: best.record.title, detail: "matched record has no target filename" });
    continue;
  }

  const targetPath = path.join(pdfDir, best.record.pdfFile);
  if (fs.existsSync(targetPath) && !force) {
    results.push({
      sourceFile: sourcePath,
      status: "skipped",
      targetFile: targetPath,
      matchedTitle: best.record.title,
      score: best.score,
      detail: "target PDF already exists",
      reasons: best.reasons
    });
    continue;
  }

  if (!dryRun) fs.copyFileSync(sourcePath, targetPath);
  results.push({
    sourceFile: sourcePath,
    status: "saved",
    targetFile: targetPath,
    matchedTitle: best.record.title,
    score: best.score,
    detail: dryRun ? "dry run only" : "copied into data/pdfs",
    reasons: best.reasons
  });
}

if (!dryRun) {
  refreshPdfStatus(profile);
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  writeTargetOutputs(profile, projectRoot);
}

fs.writeFileSync(reportPath, `${JSON.stringify(reportResults(results), null, 2)}\n`, "utf8");

console.log(`Source dir: ${ingestDir}`);
console.log(`Inbox PDFs: ${inboxFiles.length}`);
console.log(`Saved: ${results.filter((result) => result.status === "saved").length}`);
console.log(`Skipped: ${results.filter((result) => result.status === "skipped").length}`);
console.log(`Unmatched: ${results.filter((result) => result.status === "unmatched").length}`);
console.log(`Ambiguous: ${results.filter((result) => result.status === "ambiguous").length}`);
console.log(`Not PDF: ${results.filter((result) => result.status === "not-pdf").length}`);
console.log(reportPath);

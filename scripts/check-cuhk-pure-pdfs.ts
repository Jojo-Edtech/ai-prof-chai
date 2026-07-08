import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadMissingPdfQueue } from "../server/missing-pdfs";
import type { CorpusProfile, MissingPdfQueueItem, PublicationRecord } from "../src/shared/types";

type CuhkCandidate = {
  label: string;
  pageUrl: string;
  pdfUrl: string;
  status?: "saved" | "already-present" | "not-pdf" | "rejected" | "failed";
  detail?: string;
};

type CuhkResult = {
  title: string;
  year?: string;
  doi?: string;
  expectedPdfFile?: string;
  pages: string[];
  candidates: CuhkCandidate[];
  errors: string[];
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const today = new Date().toISOString().slice(0, 10);
const outputDataPath = path.join(projectRoot, "data", "wos-downloads", `cuhk-pure-pdf-check-${today}.json`);
const outputMdPath = path.join(projectRoot, "outputs", "missing-pdf-cuhk-pure-check.md");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const pdfDir = path.join(projectRoot, "data", "pdfs");
const helperPath = path.join(projectRoot, "scripts", "extract-pdf-text.py");
const bundledPython = "/Users/zhouxinxin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const python = process.env.AI_PROF_CHAI_PYTHON || (fs.existsSync(bundledPython) ? bundledPython : "python3");

const knownCuhkPages: Record<string, string[]> = {
  "10.1177/21582440241242188": [
    "https://research.cuhk.edu.hk/en/publications/development-and-validation-of-the-artificial-intelligence-learnin-2/"
  ],
  "10.1504/IJMLO.2020.106181": [
    "https://research.cuhk.edu.hk/en/publications/surveying-chinese-teachers-technological-pedagogical-stem-knowled-2/"
  ]
};

function normalize(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function doiKey(value = "") {
  return value.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/[^a-z0-9]+/g, "");
}

function titleTokens(title: string) {
  const stop = new Set(["about", "among", "and", "based", "from", "into", "learning", "study", "that", "their", "the", "through", "with"]);
  return [...new Set(normalize(title).split(/\s+/).filter((token) => token.length >= 5 && !stop.has(token)))];
}

function authorTokens(record?: PublicationRecord) {
  return [
    ...new Set((record?.authors || []).flatMap((author) => normalize(author).split(/\s+/)).filter((token) => token.length >= 4))
  ];
}

function ratio(tokens: string[], text: string) {
  if (!tokens.length) return 0;
  return tokens.filter((token) => text.includes(token)).length / tokens.length;
}

function extractPdfText(bytes: Buffer) {
  const tempDir = fs.mkdtempSync(path.join(projectRoot, "data", "wos-downloads", "cuhk-pdf-"));
  const tempPath = path.join(tempDir, "candidate.pdf");
  try {
    fs.writeFileSync(tempPath, bytes);
    const output = execFileSync(python, [helperPath, tempPath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    const payload = JSON.parse(output) as { status: string; text?: string };
    return payload.status === "indexed" ? payload.text || "" : "";
  } catch {
    return "";
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function loadProfileRecords() {
  if (!fs.existsSync(profilePath)) return [];
  return (JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile).records;
}

function findPublicationRecord(records: PublicationRecord[], item: MissingPdfQueueItem) {
  const itemDoi = doiKey(item.doi);
  return records.find((record) => {
    if (itemDoi && doiKey(record.doi) === itemDoi) return true;
    return Boolean(item.wosAccession && record.wosAccession === item.wosAccession);
  });
}

function verifyPdfBytes(item: MissingPdfQueueItem, record: PublicationRecord | undefined, bytes: Buffer) {
  const text = normalize(extractPdfText(bytes));
  const titleTokenRatio = ratio(titleTokens(item.title), text);
  const authorTokenRatio = ratio(authorTokens(record), text);
  const doiHit = Boolean(item.doi && doiKey(text).includes(doiKey(item.doi)));
  const yearHit = Boolean(item.year && text.includes(item.year));
  const ok = doiHit || (titleTokenRatio >= 0.7 && (yearHit || authorTokenRatio >= 0.25));
  return ok
    ? "PDF text matches target metadata"
    : `rejected: DOI ${doiHit ? "hit" : "miss"}, title ${Math.round(titleTokenRatio * 100)}%, author ${Math.round(
        authorTokenRatio * 100
      )}%, year ${yearHit ? "hit" : "miss"}`;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
  return text;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function extractPdfCandidates(pageUrl: string, html: string) {
  const candidates = new Map<string, CuhkCandidate>();
  const add = (label: string, rawUrl: string) => {
    const decoded = decodeHtml(rawUrl);
    const pdfUrl = decoded.startsWith("/") ? new URL(decoded, pageUrl).toString() : decoded;
    if (/^https?:\/\/research\.cuhk\.edu\.hk\/files\/.+\.pdf/i.test(pdfUrl)) candidates.set(pdfUrl, { label, pageUrl, pdfUrl });
  };

  for (const match of html.matchAll(/<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/gi)) {
    add("citation_pdf_url", match[1]);
  }
  for (const match of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/gi)) {
    add("citation_pdf_url", match[1]);
  }
  for (const match of html.matchAll(/https:\/\/research\.cuhk\.edu\.hk\/files\/[^"'<>\s]+?\.pdf/gi)) {
    add("CUHK file URL", match[0]);
  }
  for (const match of html.matchAll(/["'](\/files\/[^"']+?\.pdf)["']/gi)) {
    add("CUHK relative file URL", match[1]);
  }

  return [...candidates.values()];
}

async function checkPdfCandidate(item: MissingPdfQueueItem, record: PublicationRecord | undefined, candidate: CuhkCandidate) {
  if (!item.expectedPdfFile) {
    candidate.status = "failed";
    candidate.detail = "missing expected target filename";
    return candidate;
  }

  const outputPath = path.join(pdfDir, item.expectedPdfFile);
  if (fs.existsSync(outputPath)) {
    candidate.status = "already-present";
    candidate.detail = item.expectedPdfFile;
    return candidate;
  }

  try {
    const response = await fetch(candidate.pdfUrl, {
      redirect: "follow",
      headers: {
        Accept: "application/pdf,text/html;q=0.8,*/*;q=0.5",
        Referer: candidate.pageUrl,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"
      }
    });
    const contentType = response.headers.get("content-type") || "";
    const bytes = Buffer.from(await response.arrayBuffer());
    const isPdf = contentType.toLowerCase().includes("pdf") || bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    if (!response.ok) {
      candidate.status = "failed";
      candidate.detail = `HTTP ${response.status}; first bytes ${bytes.subarray(0, 24).toString("utf8").replace(/\s+/g, " ")}`;
      return candidate;
    }
    if (!isPdf) {
      candidate.status = "not-pdf";
      candidate.detail = `content-type ${contentType || "unknown"}; first bytes ${bytes.subarray(0, 24).toString("utf8").replace(/\s+/g, " ")}`;
      return candidate;
    }

    const verification = verifyPdfBytes(item, record, bytes);
    if (!verification.startsWith("PDF text matches")) {
      candidate.status = "rejected";
      candidate.detail = verification;
      return candidate;
    }

    fs.mkdirSync(pdfDir, { recursive: true });
    fs.writeFileSync(outputPath, bytes);
    candidate.status = "saved";
    candidate.detail = `${item.expectedPdfFile}; ${bytes.length} bytes`;
    return candidate;
  } catch (error) {
    candidate.status = "failed";
    candidate.detail = error instanceof Error ? error.message : String(error);
    return candidate;
  }
}

function cuhkPagesForItem(item: MissingPdfQueueItem) {
  const pages = new Set<string>();
  for (const link of item.links) {
    if (/^https:\/\/research\.cuhk\.edu\.hk\/en\/publications\//i.test(link.url)) pages.add(link.url);
  }
  for (const page of knownCuhkPages[item.doi || ""] || []) pages.add(page);
  return [...pages];
}

function markdown(results: CuhkResult[]) {
  const lines = [
    "# CUHK Pure PDF Check",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This check reads public CUHK Pure publication pages and extracts `citation_pdf_url` plus `research.cuhk.edu.hk/files/*.pdf` candidates. It saves only real `%PDF-` files whose extracted text matches the target metadata.",
    "",
    "| Year | DOI/WoS | Pages checked | PDF candidates | Outcome | Title |",
    "|---:|---|---:|---:|---|---|"
  ];

  for (const result of results) {
    const outcome =
      result.candidates.find((candidate) => candidate.status === "saved")?.detail ||
      result.candidates.map((candidate) => `${candidate.status || "unchecked"}: ${candidate.detail || candidate.pdfUrl}`).join("; ") ||
      result.errors.join("; ") ||
      "No CUHK PDF candidate found";
    lines.push(
      `| ${result.year || ""} | ${result.doi || ""} | ${result.pages.length} | ${result.candidates.length} | ${outcome.replace(/\|/g, "/")} | ${result.title.replace(/\|/g, "/")} |`
    );
  }

  lines.push("", "## Candidates", "");
  for (const result of results) {
    if (!result.candidates.length) continue;
    lines.push(`### ${result.title}`, "");
    for (const candidate of result.candidates) {
      lines.push(`- ${candidate.label}: [file](${candidate.pdfUrl}) via [page](${candidate.pageUrl}) — ${candidate.status || "unchecked"}${candidate.detail ? `; ${candidate.detail}` : ""}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const queue = loadMissingPdfQueue(projectRoot);
  const records = loadProfileRecords();
  const results: CuhkResult[] = [];

  for (const item of queue.items) {
    const pages = cuhkPagesForItem(item);
    if (!pages.length) continue;
    const result: CuhkResult = {
      title: item.title,
      year: item.year,
      doi: item.doi,
      expectedPdfFile: item.expectedPdfFile,
      pages,
      candidates: [],
      errors: []
    };
    for (const pageUrl of pages) {
      try {
        const html = await fetchText(pageUrl);
        const candidates = extractPdfCandidates(pageUrl, html);
        for (const candidate of candidates) {
          const checked = await checkPdfCandidate(item, findPublicationRecord(records, item), candidate);
          result.candidates.push(checked);
          if (checked.status === "saved" || checked.status === "already-present") break;
        }
      } catch (error) {
        result.errors.push(`${pageUrl}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    results.push(result);
  }

  fs.mkdirSync(path.dirname(outputDataPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputMdPath), { recursive: true });
  fs.writeFileSync(outputDataPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  fs.writeFileSync(outputMdPath, markdown(results), "utf8");

  const saved = results.flatMap((result) => result.candidates).filter((candidate) => candidate.status === "saved").length;
  const found = results.flatMap((result) => result.candidates).length;
  console.log(`CUHK pages checked: ${results.reduce((sum, result) => sum + result.pages.length, 0)}`);
  console.log(`CUHK PDF candidates found: ${found}`);
  console.log(`Saved: ${saved}`);
  console.log(outputMdPath);
  console.log(outputDataPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "CUHK Pure check failed");
  process.exit(1);
});

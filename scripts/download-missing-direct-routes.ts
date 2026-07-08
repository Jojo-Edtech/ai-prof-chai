import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadMissingPdfQueue } from "../server/missing-pdfs";
import type { CorpusProfile, MissingPdfQueueItem, PublicationRecord } from "../src/shared/types";

type AttemptStatus = "saved" | "already-present" | "not-pdf" | "rejected" | "failed" | "no-file-name";

type AttemptResult = {
  title: string;
  label: string;
  url: string;
  status: AttemptStatus;
  expectedPdfFile?: string;
  detail?: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pdfDir = path.join(projectRoot, "data", "pdfs");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const helperPath = path.join(projectRoot, "scripts", "extract-pdf-text.py");
const bundledPython = "/Users/zhouxinxin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const python = process.env.AI_PROF_CHAI_PYTHON || (fs.existsSync(bundledPython) ? bundledPython : "python3");
const reportPath = path.join(
  projectRoot,
  "data",
  "wos-downloads",
  `direct-route-download-report-${new Date().toISOString().slice(0, 10)}.json`
);

const extraRoutes: Record<string, Array<{ label: string; url: string }>> = {
  "10.1109/ISET49818.2020.00040": [{ label: "IEEE direct PDF", url: "https://ieeexplore.ieee.org/iel7/9210708/9215461/09215506.pdf" }]
};

function looksLikePdfUrl(url: string) {
  return /\.pdf($|[?#])/i.test(url) || /\/doi\/pdf\//i.test(url) || /\/pdf(\/|$|[?#])/i.test(url) || /libkey\.io\//i.test(url);
}

function routeVariants(link: { label: string; url: string }) {
  const variants = new Map<string, { label: string; url: string }>();
  const add = (label: string, url: string) => variants.set(url, { label, url });
  add(link.label, link.url);

  if (/journals\.sagepub\.com\/doi\/pdf\//i.test(link.url)) {
    add(`${link.label} download`, `${link.url}${link.url.includes("?") ? "&" : "?"}download=true`);
    add(`${link.label} epdf`, link.url.replace("/doi/pdf/", "/doi/epdf/"));
  }

  if (/inderscienceonline\.com\/doi\/pdf\//i.test(link.url) || /tandfonline\.com\/doi\/pdf\//i.test(link.url)) {
    add(`${link.label} download`, `${link.url}${link.url.includes("?") ? "&" : "?"}download=true`);
  }

  if (/worldscientific\.com\/doi\/pdf\//i.test(link.url)) {
    add(`${link.label} download`, `${link.url}${link.url.includes("?") ? "&" : "?"}download=true`);
    add(`${link.label} epdf`, link.url.replace("/doi/pdf/", "/doi/epdf/"));
  }

  return [...variants.values()];
}

function isExactTargetRoute(label: string) {
  return !/\b(related|version|search)\b/i.test(label);
}

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
  const tempDir = fs.mkdtempSync(path.join(projectRoot, "data", "wos-downloads", "direct-pdf-"));
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
  const ok =
    doiHit ||
    (titleTokenRatio >= 0.7 && (yearHit || authorTokenRatio >= 0.25)) ||
    (titleTokenRatio >= 0.85 && !authorTokens(record).length);
  const detail = ok
    ? "PDF text matches target metadata"
    : `rejected: DOI ${doiHit ? "hit" : "miss"}, title ${Math.round(titleTokenRatio * 100)}%, author ${Math.round(
        authorTokenRatio * 100
      )}%, year ${yearHit ? "hit" : "miss"}`;
  return { ok, detail };
}

async function downloadIfPdf(
  item: MissingPdfQueueItem,
  record: PublicationRecord | undefined,
  label: string,
  url: string
): Promise<AttemptResult> {
  const title = item.title;
  const expectedPdfFile = item.expectedPdfFile;
  if (!expectedPdfFile) return { title, label, url, status: "no-file-name", detail: "missing expected target filename" };

  const outputPath = path.join(pdfDir, expectedPdfFile);
  if (fs.existsSync(outputPath)) return { title, label, url, status: "already-present", expectedPdfFile };

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "application/pdf,text/html;q=0.8,*/*;q=0.5",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
      }
    });
    if (!response.ok) return { title, label, url, status: "failed", expectedPdfFile, detail: `HTTP ${response.status}` };

    const contentType = response.headers.get("content-type") || "";
    const bytes = Buffer.from(await response.arrayBuffer());
    const isPdf = contentType.toLowerCase().includes("pdf") || bytes.subarray(0, 5).toString() === "%PDF-";
    if (!isPdf) {
      return {
        title,
        label,
        url,
        status: "not-pdf",
        expectedPdfFile,
        detail: `content-type ${contentType || "unknown"}; first bytes ${bytes.subarray(0, 24).toString("utf8").replace(/\s+/g, " ")}`
      };
    }

    const verification = verifyPdfBytes(item, record, bytes);
    if (!verification.ok) {
      return { title, label, url, status: "rejected", expectedPdfFile, detail: verification.detail };
    }

    fs.mkdirSync(pdfDir, { recursive: true });
    fs.writeFileSync(outputPath, bytes);
    return { title, label, url, status: "saved", expectedPdfFile, detail: `${bytes.length} bytes` };
  } catch (error) {
    return {
      title,
      label,
      url,
      status: "failed",
      expectedPdfFile,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

const queue = loadMissingPdfQueue(projectRoot);
const publicationRecords = loadProfileRecords();
const results: AttemptResult[] = [];

for (const item of queue.items) {
  const extras = extraRoutes[item.doi || item.wosAccession || ""] || [];
  const linksByUrl = new Map<string, { label: string; url: string }>();
  [...item.links, ...extras]
    .filter((link) => looksLikePdfUrl(link.url) && isExactTargetRoute(link.label))
    .flatMap(routeVariants)
    .forEach((link) => linksByUrl.set(link.url, link));
  const links = [...linksByUrl.values()];
  for (const link of links) {
    const result = await downloadIfPdf(item, findPublicationRecord(publicationRecords, item), link.label, link.url);
    results.push(result);
    if (result.status === "saved" || result.status === "already-present") break;
  }
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

console.log(`Saved: ${results.filter((result) => result.status === "saved").length}`);
console.log(`Already present: ${results.filter((result) => result.status === "already-present").length}`);
console.log(`Not PDF: ${results.filter((result) => result.status === "not-pdf").length}`);
console.log(`Rejected: ${results.filter((result) => result.status === "rejected").length}`);
console.log(`Failed: ${results.filter((result) => result.status === "failed").length}`);
console.log(reportPath);

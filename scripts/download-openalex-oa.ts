import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";

type DownloadResult = {
  id: string;
  title: string;
  url: string;
  status: "saved" | "skipped" | "not-pdf" | "failed";
  file?: string;
  detail?: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "openalex-chai-publications.json");
const markdownPath = path.join(projectRoot, "data", "processed", "openalex-target-publications.md");
const csvPath = path.join(projectRoot, "data", "processed", "openalex-target-publications.csv");
const pdfDir = path.join(projectRoot, "data", "pdfs");
const reportPath = path.join(projectRoot, "data", "openalex-downloads", `openalex-oa-download-report-${new Date().toISOString().slice(0, 10)}.json`);

function looksPdfUrl(url: string) {
  return (
    /\.pdf($|[?#])/i.test(url) ||
    /\/pdf(\/|$|[?#])/i.test(url) ||
    /articlepdf/i.test(url) ||
    /article\/download/i.test(url) ||
    /content\/pdf/i.test(url)
  );
}

async function downloadPdf(record: PublicationRecord, url: string): Promise<DownloadResult> {
  if (!record.pdfFile) return { id: record.id, title: record.title, url, status: "skipped", detail: "no target PDF filename" };
  const outputPath = path.join(pdfDir, record.pdfFile);
  if (fs.existsSync(outputPath)) return { id: record.id, title: record.title, url, status: "skipped", file: outputPath, detail: "already exists" };
  if (!looksPdfUrl(url)) return { id: record.id, title: record.title, url, status: "not-pdf", detail: "OA URL is not a direct PDF URL" };

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "ai-prof-chai/0.1 local research assistant"
      }
    });
    if (!response.ok) return { id: record.id, title: record.title, url, status: "failed", detail: `HTTP ${response.status}` };
    const contentType = response.headers.get("content-type") || "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!contentType.includes("pdf") && !bytes.subarray(0, 5).toString().includes("%PDF")) {
      return { id: record.id, title: record.title, url, status: "not-pdf", detail: `content-type ${contentType || "unknown"}` };
    }
    fs.writeFileSync(outputPath, bytes);
    return { id: record.id, title: record.title, url, status: "saved", file: outputPath };
  } catch (error) {
    return { id: record.id, title: record.title, url, status: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

function role(record: PublicationRecord) {
  if (record.isFirstAuthor && record.isCorrespondingAuthor) return "first_and_corresponding";
  if (record.isFirstAuthor) return "first_author";
  return "corresponding_author";
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeTargetOutputs(profile: CorpusProfile) {
  const targets = profile.records.filter((record) => record.isFirstAuthor || record.isCorrespondingAuthor);
  const rows = [
    ["role", "download_status", "oa_status", "oa_url", "pdf_path", "year", "title", "source", "doi", "doi_url", "openalex_id"],
    ...targets.map((record) => [
      role(record),
      record.downloadStatus,
      record.openAccess || "",
      record.oaUrl || "",
      record.pdfFile ? `data/pdfs/${record.pdfFile}` : "",
      record.year || "",
      record.title,
      record.source || "",
      record.doi || "",
      record.doiUrl || "",
      record.id
    ])
  ];
  fs.writeFileSync(csvPath, `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`, "utf8");

  const lines = [
    "# OpenAlex Candidate Target Publication List",
    "",
    "This is a public-source pre-index. Use Web of Science exports as the final authority when available.",
    "",
    `Generated: ${profile.generatedAt}`,
    `Total OpenAlex works: ${profile.summary.total}`,
    `First author: ${profile.summary.firstAuthor}`,
    `Corresponding author: ${profile.summary.correspondingAuthor}`,
    `Target records: ${profile.summary.firstOrCorresponding}`,
    `PDF saved: ${profile.summary.pdfSaved}`,
    `PDF still needed: ${profile.summary.pdfNeeded}`,
    "",
    "## Candidate Download Queue",
    ""
  ];

  targets.forEach((record, index) => {
    lines.push(
      `### ${index + 1}. ${record.title}`,
      "",
      `- Role: ${role(record)}`,
      `- Year: ${record.year || "n.d."}`,
      `- Source: ${record.source || "unknown"}`,
      `- DOI: ${record.doi || "not available"}`,
      `- DOI URL: ${record.doiUrl || "not available"}`,
      `- Open access: ${record.openAccess || "not marked"}`,
      `- OA URL: ${record.oaUrl || "not available"}`,
      `- Download status: ${record.downloadStatus}`,
      `- Expected PDF path: ${record.pdfFile ? `data/pdfs/${record.pdfFile}` : "not generated"}`,
      ""
    );
  });

  fs.writeFileSync(markdownPath, `${lines.join("\n")}\n`, "utf8");
}

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
fs.mkdirSync(pdfDir, { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

const targets = profile.records.filter((record) => (record.isFirstAuthor || record.isCorrespondingAuthor) && record.openAccess && record.oaUrl);
const results: DownloadResult[] = [];

for (const record of targets) {
  results.push(await downloadPdf(record, record.oaUrl || ""));
}

const savedIds = new Set(results.filter((result) => result.status === "saved" || result.status === "skipped").map((result) => result.id));
for (const record of profile.records) {
  if (savedIds.has(record.id)) record.downloadStatus = "pdf-saved";
}
profile.summary.pdfSaved = profile.records.filter((record) => record.downloadStatus === "pdf-saved").length;
profile.summary.pdfNeeded = profile.records.filter((record) => record.downloadStatus === "pdf-needed").length;
fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
writeTargetOutputs(profile);

fs.writeFileSync(reportPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
console.log(`Saved: ${results.filter((result) => result.status === "saved").length}`);
console.log(`Skipped: ${results.filter((result) => result.status === "skipped").length}`);
console.log(`Not direct PDF: ${results.filter((result) => result.status === "not-pdf").length}`);
console.log(`Failed: ${results.filter((result) => result.status === "failed").length}`);
console.log(reportPath);

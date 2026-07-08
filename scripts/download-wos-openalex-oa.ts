import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";
import { writeTargetOutputs } from "./target-outputs";

type OpenAlexLocation = {
  is_oa?: boolean;
  landing_page_url?: string;
  pdf_url?: string;
  source?: {
    display_name?: string;
  };
};

type OpenAlexWork = {
  id?: string;
  open_access?: {
    is_oa?: boolean;
    oa_status?: string;
    oa_url?: string;
  };
  best_oa_location?: OpenAlexLocation | null;
  primary_location?: OpenAlexLocation | null;
  locations?: OpenAlexLocation[];
};

type DownloadResult = {
  id: string;
  title: string;
  doi?: string;
  openAlexId?: string;
  oaStatus?: string;
  url?: string;
  status: "saved" | "skipped" | "not-open-access" | "not-pdf" | "no-doi" | "failed";
  file?: string;
  detail?: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const pdfDir = path.join(projectRoot, "data", "pdfs");
const reportPath = path.join(projectRoot, "data", "wos-downloads", `wos-oa-download-report-${new Date().toISOString().slice(0, 10)}.json`);

function cleanDoi(doi = "") {
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
}

function looksPdfUrl(url: string) {
  return (
    /\.pdf($|[?#])/i.test(url) ||
    /\/pdf(\/|$|[?#])/i.test(url) ||
    /articlepdf/i.test(url) ||
    /article\/download/i.test(url) ||
    /content\/pdf/i.test(url) ||
    /counter\/pdf/i.test(url)
  );
}

function targetRecords(profile: CorpusProfile) {
  return profile.records.filter((record) => record.isFirstAuthor || record.isCorrespondingAuthor);
}

function candidateUrls(work: OpenAlexWork) {
  const urls = [
    work.best_oa_location?.pdf_url,
    work.primary_location?.pdf_url,
    work.open_access?.oa_url,
    ...(work.locations || []).flatMap((location) => [location.pdf_url, location.landing_page_url])
  ];
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

async function fetchOpenAlexWork(doi: string): Promise<OpenAlexWork | undefined> {
  const url = `https://api.openalex.org/works/${encodeURIComponent(`https://doi.org/${cleanDoi(doi)}`)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ai-prof-chai/0.1 local research assistant"
    }
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`OpenAlex HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()) as OpenAlexWork;
}

async function downloadPdf(record: PublicationRecord, url: string): Promise<DownloadResult> {
  if (!record.pdfFile) return { id: record.id, title: record.title, doi: record.doi, url, status: "skipped", detail: "no target PDF filename" };
  const outputPath = path.join(pdfDir, record.pdfFile);
  if (fs.existsSync(outputPath)) return { id: record.id, title: record.title, doi: record.doi, url, status: "skipped", file: outputPath, detail: "already exists" };
  if (!looksPdfUrl(url)) return { id: record.id, title: record.title, doi: record.doi, url, status: "not-pdf", detail: "OA URL is not a direct PDF URL" };

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "ai-prof-chai/0.1 local research assistant"
      }
    });
    if (!response.ok) return { id: record.id, title: record.title, doi: record.doi, url, status: "failed", detail: `HTTP ${response.status}` };
    const contentType = response.headers.get("content-type") || "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!contentType.includes("pdf") && !bytes.subarray(0, 5).toString().includes("%PDF")) {
      return { id: record.id, title: record.title, doi: record.doi, url, status: "not-pdf", detail: `content-type ${contentType || "unknown"}` };
    }
    fs.writeFileSync(outputPath, bytes);
    return { id: record.id, title: record.title, doi: record.doi, url, status: "saved", file: outputPath };
  } catch (error) {
    return { id: record.id, title: record.title, doi: record.doi, url, status: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function processRecord(record: PublicationRecord): Promise<DownloadResult> {
  if (!record.doi) return { id: record.id, title: record.title, status: "no-doi", detail: "no DOI available" };
  const existingPdfPath = record.pdfFile ? path.join(pdfDir, record.pdfFile) : "";
  const existingPdf = Boolean(existingPdfPath && fs.existsSync(existingPdfPath));
  const work = await fetchOpenAlexWork(record.doi);
  if (work?.open_access?.is_oa) {
    record.openAccess = work.open_access.oa_status || record.openAccess || "open";
    const urls = candidateUrls(work);
    record.oaUrl = urls[0] || work.open_access.oa_url || record.oaUrl || "";
  }

  if (existingPdf) {
    record.downloadStatus = "pdf-saved";
    return { id: record.id, title: record.title, doi: record.doi, openAlexId: work?.id, oaStatus: work?.open_access?.oa_status, url: record.oaUrl, status: "skipped", file: existingPdfPath, detail: "already exists" };
  }
  if (!work?.open_access?.is_oa) return { id: record.id, title: record.title, doi: record.doi, openAlexId: work?.id, status: "not-open-access" };
  const urls = candidateUrls(work);

  for (const url of urls) {
    const result = await downloadPdf(record, url);
    result.openAlexId = work.id;
    result.oaStatus = work.open_access.oa_status;
    if (result.status === "saved" || result.status === "skipped") {
      record.downloadStatus = "pdf-saved";
      record.oaUrl = url;
      return result;
    }
  }

  return {
    id: record.id,
    title: record.title,
    doi: record.doi,
    openAlexId: work.id,
    oaStatus: work.open_access.oa_status,
    url: record.oaUrl,
    status: "not-pdf",
    detail: urls.length ? "No candidate URL returned a direct PDF" : "No OA URL candidates"
  };
}

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
fs.mkdirSync(pdfDir, { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

const results: DownloadResult[] = [];
for (const record of targetRecords(profile)) {
  results.push(await processRecord(record));
}

profile.generatedAt = new Date().toISOString();
profile.summary.openAccess = profile.records.filter((record) => record.openAccess).length;
profile.summary.pdfSaved = profile.records.filter((record) => record.downloadStatus === "pdf-saved").length;
profile.summary.pdfNeeded = profile.records.filter((record) => record.downloadStatus === "pdf-needed").length;

fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
writeTargetOutputs(profile, projectRoot);
fs.writeFileSync(reportPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

console.log(`Saved: ${results.filter((result) => result.status === "saved").length}`);
console.log(`Already present: ${results.filter((result) => result.status === "skipped").length}`);
console.log(`Not open access: ${results.filter((result) => result.status === "not-open-access").length}`);
console.log(`Not direct PDF: ${results.filter((result) => result.status === "not-pdf").length}`);
console.log(`No DOI: ${results.filter((result) => result.status === "no-doi").length}`);
console.log(`Failed: ${results.filter((result) => result.status === "failed").length}`);
console.log(reportPath);

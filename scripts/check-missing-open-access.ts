import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMissingPdfQueue } from "../server/missing-pdfs";

type OaLocation = {
  host_type?: string;
  version?: string;
  url_for_pdf?: string;
  url?: string;
  license?: string;
};

type UnpaywallResponse = {
  is_oa?: boolean;
  oa_status?: string;
  best_oa_location?: OaLocation | null;
  oa_locations?: OaLocation[];
};

type CheckResult = {
  title: string;
  year?: string;
  doi: string;
  isOa?: boolean;
  oaStatus?: string;
  bestPdf: string;
  bestUrl: string;
  byteCheck: {
    url: string;
    ok: boolean;
    contentType: string;
    byteLength: number;
    startsWithPdf: boolean;
    detail: string;
  } | null;
  locations: OaLocation[];
  error?: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const today = new Date().toISOString().slice(0, 10);
const dataPath = path.join(projectRoot, "data", "wos-downloads", `unpaywall-missing-pdfs-${today}.json`);
const markdownPath = path.join(projectRoot, "outputs", "missing-pdf-open-access-recheck.md");
const userAgent = "ai-prof-chai/0.1";

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchJson(url: string) {
  const timeout = timeoutSignal(20000);
  try {
    const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: timeout.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text) as UnpaywallResponse;
  } finally {
    timeout.clear();
  }
}

async function checkBytes(url: string) {
  const timeout = timeoutSignal(30000);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        Accept: "application/pdf,text/html;q=0.9,*/*;q=0.8"
      },
      redirect: "follow",
      signal: timeout.signal
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";
    const startsWithPdf = buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    return {
      url,
      ok: response.ok,
      contentType,
      byteLength: buffer.length,
      startsWithPdf,
      detail: startsWithPdf ? "PDF bytes confirmed" : `not PDF; first bytes ${buffer.subarray(0, 16).toString("hex")}`
    };
  } catch (error) {
    return {
      url,
      ok: false,
      contentType: "",
      byteLength: 0,
      startsWithPdf: false,
      detail: error instanceof Error ? error.message : "byte check failed"
    };
  } finally {
    timeout.clear();
  }
}

function mdCell(value: unknown) {
  return String(value ?? "").replace(/\|/g, " ");
}

async function main() {
  const queue = loadMissingPdfQueue(projectRoot);
  const items = queue.items.filter((item) => item.doi);
  const results: CheckResult[] = [];

  for (const item of items) {
    const result: CheckResult = {
      title: item.title,
      year: item.year,
      doi: item.doi || "",
      bestPdf: "",
      bestUrl: "",
      byteCheck: null,
      locations: []
    };

    try {
      const endpoint = `https://api.unpaywall.org/v2/${item.doi!.trim().toLowerCase()}?email=ai.prof.chai@example.org`;
      const payload = await fetchJson(endpoint);
      result.isOa = Boolean(payload.is_oa);
      result.oaStatus = payload.oa_status || "";
      result.bestPdf = payload.best_oa_location?.url_for_pdf || "";
      result.bestUrl = payload.best_oa_location?.url || "";
      result.locations = (payload.oa_locations || []).map((location) => ({
        host_type: location.host_type || "",
        version: location.version || "",
        url_for_pdf: location.url_for_pdf || "",
        url: location.url || "",
        license: location.license || ""
      }));
      const byteUrl = result.bestPdf || result.bestUrl;
      if (byteUrl) result.byteCheck = await checkBytes(byteUrl);
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Unpaywall check failed";
    }

    results.push(result);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(dataPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

  const oaCount = results.filter((result) => result.isOa).length;
  const pdfByteCount = results.filter((result) => result.byteCheck?.startsWithPdf).length;
  const markdown = [
    "# Missing PDF Open Access Recheck",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `- DOI records checked: ${results.length}`,
    `- Unpaywall OA records: ${oaCount}`,
    `- Direct PDF-byte successes: ${pdfByteCount}`,
    `- Data file: \`${path.relative(projectRoot, dataPath)}\``,
    "",
    "| Year | DOI | Unpaywall | Best route | Byte check | Title |",
    "|---:|---|---|---|---|---|",
    ...results.map((result) => {
      const bestRoute = result.bestPdf || result.bestUrl || "";
      const byte = result.byteCheck ? (result.byteCheck.startsWithPdf ? "PDF bytes" : result.byteCheck.detail) : result.error || "no OA route";
      return `| ${result.year || "n.d."} | ${mdCell(result.doi)} | ${mdCell(result.isOa ? result.oaStatus || "oa" : "closed")} | ${bestRoute ? `[route](${bestRoute})` : ""} | ${mdCell(byte)} | ${mdCell(result.title)} |`;
    }),
    "",
    "Interpretation: an OA metadata route is not counted as a saved PDF unless the byte check starts with `%PDF-` and the file is imported by `npm run refresh:pdfs`.",
    ""
  ].join("\n");

  fs.writeFileSync(markdownPath, markdown, "utf8");
  console.log(`Checked DOI records: ${results.length}`);
  console.log(`Unpaywall OA records: ${oaCount}`);
  console.log(`Direct PDF-byte successes: ${pdfByteCount}`);
  console.log(markdownPath);
  console.log(dataPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Open access recheck failed.");
  process.exitCode = 1;
});

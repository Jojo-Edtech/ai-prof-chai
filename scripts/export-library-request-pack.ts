import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMissingPdfQueue } from "../server/missing-pdfs";
import type { CorpusProfile, MissingPdfQueueItem, PublicationRecord } from "../src/shared/types";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const wosDir = path.join(projectRoot, "data", "wos");
const outputsDir = path.join(projectRoot, "outputs");
const csvPath = path.join(outputsDir, "missing-pdf-library-request.csv");
const risPath = path.join(outputsDir, "missing-pdf-library-request.ris");
const markdownPath = path.join(outputsDir, "missing-pdf-library-request.md");
const htmlPath = path.join(outputsDir, "missing-pdf-library-request.html");
const localRecheckNote =
  "Local recheck on 2026-07-08: searched the AI Competency Review RIS/TXT exports and 79 EndNote attachment PDFs; no verified attachment matched these missing target records.";

type WosBibliographicDetails = {
  title?: string;
  documentType?: string;
  conference?: string;
  conferenceDate?: string;
  conferenceLocation?: string;
  publisher?: string;
  issn?: string;
  eissn?: string;
  isbn?: string;
  volume?: string;
  issue?: string;
  startPage?: string;
  endPage?: string;
  articleNumber?: string;
  pageCount?: string;
  doi?: string;
  doiUrl?: string;
};

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function keyFor(record: PublicationRecord) {
  return record.doi || record.wosAccession || record.id;
}

function sourceKeyFor(record: PublicationRecord) {
  return record.wosAccession || record.doi || record.id;
}

function doiFromUrl(url: string) {
  const doiOrgMatch = url.match(/https?:\/\/(?:dx\.)?doi\.org\/([^?#\s]+)/i);
  if (doiOrgMatch?.[1]) return decodeURIComponent(doiOrgMatch[1]);
  const doiPathMatch = url.match(/\/doi\/(10\.\d{4,9}\/[^?#\s]+)/i);
  return doiPathMatch?.[1] ? decodeURIComponent(doiPathMatch[1]) : "";
}

function doiFromQueueItem(queueItem?: MissingPdfQueueItem) {
  for (const link of queueItem?.links || []) {
    const doi = doiFromUrl(link.url);
    if (doi) return doi;
  }
  return doiFromUrl(queueItem?.manualRoutes || "");
}

function effectiveDoi(record: PublicationRecord, queueItem?: MissingPdfQueueItem) {
  return record.doi || doiFromQueueItem(queueItem);
}

function effectiveDoiUrl(record: PublicationRecord, queueItem?: MissingPdfQueueItem) {
  const doi = effectiveDoi(record, queueItem);
  return record.doiUrl || (doi ? `https://doi.org/${doi}` : "");
}

function roleLabel(record: PublicationRecord) {
  if (record.isFirstAuthor && record.isCorrespondingAuthor) return "first_and_corresponding";
  if (record.isFirstAuthor) return "first_author";
  return "corresponding_author";
}

function risType(record: PublicationRecord) {
  const source = `${record.source || ""} ${record.documentType || ""}`.toLowerCase();
  if (/book|chapter|worldviews/.test(source)) return "CHAP";
  if (/conference|symposium|proceeding|icce|iset/.test(source)) return "CONF";
  return "JOUR";
}

function risLine(tag: string, value: unknown) {
  const text = clean(value);
  return text ? `${tag}  - ${text}` : "";
}

function priorityRank(priority = "") {
  const match = priority.match(/^(\d+)/);
  return match ? Number(match[1]) : 9;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseTsvLine(line: string) {
  return line.split("\t");
}

function loadWosDetails(sourceFiles: string[]) {
  const detailsByKey = new Map<string, WosBibliographicDetails>();
  for (const sourceFile of sourceFiles) {
    const sourcePath = path.isAbsolute(sourceFile) ? sourceFile : path.join(wosDir, sourceFile);
    if (!fs.existsSync(sourcePath)) continue;
    const lines = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    const header = parseTsvLine(lines[0] || "");
    const index = new Map(header.map((name, idx) => [name, idx]));
    const get = (row: string[], key: string) => {
      const idx = index.get(key);
      return idx == null ? "" : clean(row[idx]);
    };
    for (const line of lines.slice(1)) {
      const row = parseTsvLine(line);
      const details: WosBibliographicDetails = {
        title: get(row, "TI").replace(/^`\s*/, ""),
        documentType: get(row, "DT"),
        conference: get(row, "CT"),
        conferenceDate: get(row, "CY"),
        conferenceLocation: get(row, "CL"),
        publisher: get(row, "PU"),
        issn: get(row, "SN"),
        eissn: get(row, "EI"),
        isbn: get(row, "BN"),
        volume: get(row, "VL"),
        issue: get(row, "IS"),
        startPage: get(row, "BP"),
        endPage: get(row, "EP"),
        articleNumber: get(row, "AR"),
        pageCount: get(row, "PG"),
        doi: get(row, "DI"),
        doiUrl: get(row, "DL")
      };
      const wosAccession = get(row, "UT");
      const doi = details.doi;
      if (wosAccession) detailsByKey.set(wosAccession, details);
      if (doi) detailsByKey.set(doi, details);
    }
  }
  return detailsByKey;
}

function pageRange(details?: WosBibliographicDetails) {
  if (!details) return "";
  if (details.startPage && details.endPage) return `${details.startPage}-${details.endPage}`;
  return details.startPage || details.articleNumber || "";
}

function volumeIssuePages(details?: WosBibliographicDetails) {
  if (!details) return "";
  const parts = [
    details.volume ? `vol. ${details.volume}` : "",
    details.issue ? `issue ${details.issue}` : "",
    pageRange(details) ? `pp. ${pageRange(details)}` : "",
    details.pageCount ? `${details.pageCount} pages` : ""
  ].filter(Boolean);
  return parts.join(", ");
}

function serialLine(details?: WosBibliographicDetails) {
  if (!details) return "";
  const parts = [
    details.issn ? `ISSN ${details.issn}` : "",
    details.eissn ? `eISSN ${details.eissn}` : "",
    details.isbn ? `ISBN ${details.isbn}` : ""
  ].filter(Boolean);
  return parts.join("; ");
}

function conferenceLine(details?: WosBibliographicDetails) {
  if (!details?.conference) return "";
  const bits = [details.conference, details.conferenceDate, details.conferenceLocation].filter(Boolean);
  return bits.join("; ");
}

function requestText(record: PublicationRecord, queueItem?: MissingPdfQueueItem, details?: WosBibliographicDetails) {
  const doi = effectiveDoi(record, queueItem);
  return [
    `Please help obtain this publication for research use:`,
    `Title: ${record.title}`,
    `Authors: ${(record.fullAuthors.length ? record.fullAuthors : record.authors).join("; ") || "not available"}`,
    `Source: ${record.source || "not available"}`,
    `Document type: ${details?.documentType || record.documentType || "not available"}`,
    `Year: ${record.year || "not available"}`,
    `Volume/issue/pages: ${volumeIssuePages(details) || "not available"}`,
    `Publisher: ${details?.publisher || "not available"}`,
    `Serial/book identifier: ${serialLine(details) || "not available"}`,
    `Conference: ${conferenceLine(details) || "not applicable"}`,
    `DOI: ${doi || "not available"}`,
    `WoS accession: ${record.wosAccession || "not available"}`,
    `Expected local filename: ${record.pdfFile || "not generated"}`,
    `Known routes checked: ${queueItem?.manualRoutes || "not available"}`,
    `Access note: ${queueItem?.note || "No public PDF bytes verified locally."}`,
    `Local file recheck: ${localRecheckNote}`,
    `Suggested library action: document delivery/interlibrary loan or direct publisher access check.`
  ].join("\n");
}

function renderHtml(
  records: PublicationRecord[],
  queueByKey: Map<string, MissingPdfQueueItem>,
  detailsByKey: Map<string, WosBibliographicDetails>
) {
  const cards = records
    .map((record, index) => {
      const queueItem = queueByKey.get(keyFor(record));
      const details = detailsByKey.get(sourceKeyFor(record)) || detailsByKey.get(keyFor(record));
      const text = requestText(record, queueItem, details);
      const links = queueItem?.links.length
        ? queueItem.links
            .map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`)
            .join("")
        : effectiveDoiUrl(record, queueItem)
          ? `<a href="${escapeHtml(effectiveDoiUrl(record, queueItem))}" target="_blank" rel="noreferrer">DOI</a>`
          : "";
      return `
        <article class="card">
          <div class="rank">${index + 1}</div>
          <div class="main">
            <p class="meta">${escapeHtml(queueItem?.accessPriority || "4 Hard locate")} · ${escapeHtml(roleLabel(record))} · ${escapeHtml(record.year || "n.d.")}</p>
            <h2>${escapeHtml(record.title)}</h2>
            <p>${escapeHtml(record.source || "Unknown source")}</p>
            <p class="meta">${escapeHtml([details?.documentType || record.documentType, volumeIssuePages(details), serialLine(details)].filter(Boolean).join(" · "))}</p>
            <p class="note">${escapeHtml(queueItem?.note || "No public PDF bytes verified locally.")}</p>
            <textarea readonly>${escapeHtml(text)}</textarea>
            <div class="links">${links}</div>
          </div>
          <div class="actions">
            <button type="button" data-copy="${escapeHtml(text)}">Copy request</button>
            <button type="button" data-copy="${escapeHtml(record.pdfFile || "")}">Copy filename</button>
          </div>
        </article>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Prof. Chai Library Request Pack</title>
    <style>
      :root { color-scheme: light; --ink: #16202b; --muted: #637083; --line: #d8dee8; --soft: #f5f7fa; --paper: #fff; --accent: #1d6b5a; --accent-soft: #e7f4ef; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--soft); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
      main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 56px; }
      header { display: grid; gap: 8px; margin-bottom: 18px; }
      h1, h2, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: clamp(28px, 4vw, 42px); line-height: 1.08; }
      h2 { font-size: 18px; line-height: 1.35; }
      .summary, .meta, .note { color: var(--muted); font-size: 14px; }
      .rules { display: grid; gap: 8px; border: 1px solid #cfe3dc; border-radius: 8px; background: var(--accent-soft); padding: 14px; margin-bottom: 16px; }
      .grid { display: grid; gap: 12px; }
      .card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: start; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 16px; }
      .rank { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-weight: 800; }
      .main { display: grid; gap: 8px; min-width: 0; }
      textarea { width: 100%; min-height: 170px; resize: vertical; border: 1px solid var(--line); border-radius: 7px; padding: 10px; font: 13px/1.45 "SFMono-Regular", Consolas, "Liberation Mono", monospace; color: var(--ink); background: #fbfcfd; }
      .links { display: flex; flex-wrap: wrap; gap: 8px; }
      .links a, button { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; border-radius: 7px; padding: 7px 11px; font: inherit; font-size: 14px; text-decoration: none; }
      .links a { border: 1px solid var(--line); color: var(--ink); background: #fff; }
      button { border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
      .actions { display: grid; gap: 8px; min-width: 140px; }
      @media (max-width: 760px) { .card { grid-template-columns: 1fr; } .actions { min-width: 0; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Library Request Pack</h1>
        <p class="summary">${records.length} missing target PDFs · generated ${escapeHtml(new Date().toISOString())}</p>
      </header>
      <section class="rules">
        <p><strong>Purpose:</strong> copy these request blocks into a library, interlibrary-loan, or document-delivery form.</p>
        <p><strong>Counting rule:</strong> a requested article counts only after a real PDF is saved and the local matcher verifies title/DOI.</p>
        <p><strong>Local recheck:</strong> ${escapeHtml(localRecheckNote)}</p>
      </section>
      <section class="grid">${cards}</section>
    </main>
    <script>
      document.addEventListener("click", async (event) => {
        const target = event.target.closest("[data-copy]");
        if (!target) return;
        await navigator.clipboard.writeText(target.getAttribute("data-copy") || "");
        const original = target.textContent;
        target.textContent = "Copied";
        window.setTimeout(() => (target.textContent = original), 1200);
      });
    </script>
  </body>
</html>
`;
}

if (!fs.existsSync(profilePath)) {
  throw new Error("Missing data/processed/chai-publications.json. Run npm run import:wos first.");
}

fs.mkdirSync(outputsDir, { recursive: true });

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
const detailsByKey = loadWosDetails(profile.sourceFiles);
const queue = loadMissingPdfQueue(projectRoot);
const queueByKey = new Map<string, MissingPdfQueueItem>();
for (const item of queue.items) {
  if (item.doi) queueByKey.set(item.doi, item);
  if (item.wosAccession) queueByKey.set(item.wosAccession, item);
}
const missingTargets = profile.records
  .filter((record) => (record.isFirstAuthor || record.isCorrespondingAuthor) && record.downloadStatus === "pdf-needed")
  .sort((first, second) => {
    const firstQueue = queueByKey.get(keyFor(first));
    const secondQueue = queueByKey.get(keyFor(second));
    const priorityDiff = priorityRank(firstQueue?.accessPriority) - priorityRank(secondQueue?.accessPriority);
    if (priorityDiff) return priorityDiff;
    return Number(second.year || 0) - Number(first.year || 0);
  });

const csvRows = [
  [
    "access_priority",
    "next_step",
    "role",
    "year",
    "title",
    "authors",
    "source",
    "document_type",
    "volume",
    "issue",
    "start_page",
    "end_page",
    "page_count",
    "publisher",
    "issn",
    "eissn",
    "isbn",
    "conference",
    "doi",
    "doi_url",
    "wos_accession",
    "expected_pdf_file",
    "manual_routes",
    "note",
    "local_recheck",
    "request_text"
  ],
  ...missingTargets.map((record) => {
    const queueItem = queueByKey.get(keyFor(record));
    const details = detailsByKey.get(sourceKeyFor(record)) || detailsByKey.get(keyFor(record));
    const doi = effectiveDoi(record, queueItem);
    return [
      queueItem?.accessPriority || "4 Hard locate",
      queueItem?.nextStep || "Use DOI/WoS metadata for library lookup or document delivery.",
      roleLabel(record),
      record.year || "",
      record.title,
      record.fullAuthors.length ? record.fullAuthors.join("; ") : record.authors.join("; "),
      record.source || "",
      details?.documentType || record.documentType || "",
      details?.volume || "",
      details?.issue || "",
      details?.startPage || "",
      details?.endPage || "",
      details?.pageCount || "",
      details?.publisher || "",
      details?.issn || "",
      details?.eissn || "",
      details?.isbn || "",
      conferenceLine(details),
      doi,
      effectiveDoiUrl(record, queueItem),
      record.wosAccession || "",
      record.pdfFile || "",
      queueItem?.manualRoutes || "",
      queueItem?.note || "",
      localRecheckNote,
      requestText(record, queueItem, details)
    ];
  })
];

fs.writeFileSync(csvPath, `${csvRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`, "utf8");

const risEntries = missingTargets
  .map((record) => {
    const queueItem = queueByKey.get(keyFor(record));
    const details = detailsByKey.get(sourceKeyFor(record)) || detailsByKey.get(keyFor(record));
    const doi = effectiveDoi(record, queueItem);
    const doiUrl = effectiveDoiUrl(record, queueItem);
    const lines = [
      risLine("TY", risType(record)),
      risLine("TI", record.title),
      ...(record.fullAuthors.length ? record.fullAuthors : record.authors).map((author) => risLine("AU", author)),
      risLine("PY", record.year),
      risLine("JO", record.source),
      risLine("VL", details?.volume),
      risLine("IS", details?.issue),
      risLine("SP", details?.startPage),
      risLine("EP", details?.endPage),
      risLine("PB", details?.publisher),
      risLine("SN", details?.issn || details?.eissn || details?.isbn),
      risLine("DO", doi),
      risLine("UR", doiUrl || queueItem?.links[0]?.url),
      risLine(
        "N1",
        [
          `Role: ${roleLabel(record)}`,
          `WoS: ${record.wosAccession || "not available"}`,
          `Document type: ${details?.documentType || record.documentType || "not available"}`,
          `Pages: ${volumeIssuePages(details) || "not available"}`,
          `Priority: ${queueItem?.accessPriority || "4 Hard locate"}`,
          `Next step: ${queueItem?.nextStep || "Use DOI/WoS metadata for library lookup or document delivery."}`,
          `Expected file: ${record.pdfFile || "not generated"}`,
          localRecheckNote
        ].join(" | ")
      ),
      "ER  -"
    ].filter(Boolean);
    return lines.join("\n");
  })
  .join("\n\n");

fs.writeFileSync(risPath, `${risEntries}\n`, "utf8");

const markdownLines = [
  "# Missing PDF Library Request Pack",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Missing target PDFs: ${missingTargets.length}`,
  "",
  "Use this when browser download and institution routes still need library/document-delivery support.",
  "",
  "## Requests",
  ""
];

missingTargets.forEach((record, index) => {
  const queueItem = queueByKey.get(keyFor(record));
  const details = detailsByKey.get(sourceKeyFor(record)) || detailsByKey.get(keyFor(record));
  const doi = effectiveDoi(record, queueItem);
  markdownLines.push(
    `### ${index + 1}. ${record.title}`,
    "",
    `- Priority: ${queueItem?.accessPriority || "4 Hard locate"}`,
    `- Next step: ${queueItem?.nextStep || "Use DOI/WoS metadata for library lookup or document delivery."}`,
    `- Role: ${roleLabel(record)}`,
    `- Year: ${record.year || "n.d."}`,
    `- Source: ${record.source || "unknown"}`,
    `- Document type: ${details?.documentType || record.documentType || "unknown"}`,
    `- Volume/issue/pages: ${volumeIssuePages(details) || "not available"}`,
    `- Publisher: ${details?.publisher || "not available"}`,
    `- Serial/book identifier: ${serialLine(details) || "not available"}`,
    `- Conference: ${conferenceLine(details) || "not applicable"}`,
    `- Authors: ${(record.fullAuthors.length ? record.fullAuthors : record.authors).join("; ") || "not available"}`,
    `- DOI: ${doi || "not available"}`,
    `- WoS accession: ${record.wosAccession || "not available"}`,
    `- Expected PDF filename: \`${record.pdfFile || "not generated"}\``,
    `- Routes: ${queueItem?.manualRoutes || "not available"}`,
    `- Local recheck: ${localRecheckNote}`,
    "",
    "```text",
    requestText(record, queueItem, details),
    "```",
    ""
  );
});

fs.writeFileSync(markdownPath, `${markdownLines.join("\n")}\n`, "utf8");
fs.writeFileSync(htmlPath, renderHtml(missingTargets, queueByKey, detailsByKey), "utf8");

console.log(`Library request records: ${missingTargets.length}`);
console.log(csvPath);
console.log(risPath);
console.log(markdownPath);
console.log(htmlPath);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMissingPdfQueue } from "../server/missing-pdfs";
import type { CorpusProfile, MissingPdfQueueItem, PublicationRecord } from "../src/shared/types";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const outputsDir = path.join(projectRoot, "outputs");
const markdownPath = path.join(outputsDir, "missing-pdf-acquisition-pack.md");
const htmlPath = path.join(outputsDir, "missing-pdf-acquisition-pack.html");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function keyFor(record: { doi?: string; wosAccession?: string; id?: string }) {
  return record.doi || record.wosAccession || record.id || "";
}

function priorityRank(priority = "") {
  const match = priority.match(/^(\d+)/);
  return match ? Number(match[1]) : 9;
}

function roleLabel(record?: PublicationRecord) {
  if (!record) return "target";
  if (record.isFirstAuthor && record.isCorrespondingAuthor) return "first and corresponding author";
  if (record.isFirstAuthor) return "first author";
  return "corresponding author";
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function routeMarkdown(item: MissingPdfQueueItem) {
  if (!item.links.length) return "not available";
  return item.links.map((link) => `[${link.label}](${link.url})`).join("; ");
}

function routeHtml(item: MissingPdfQueueItem) {
  if (!item.links.length) return "<span>No verified route yet</span>";
  return item.links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("");
}

function progressLabel(status: MissingPdfQueueItem["progress"]["status"]) {
  if (status === "opened") return "tried";
  if (status === "requested") return "requested";
  if (status === "blocked") return "blocked";
  return "todo";
}

if (!fs.existsSync(profilePath)) throw new Error("Missing data/processed/chai-publications.json. Run npm run import:wos first.");

fs.mkdirSync(outputsDir, { recursive: true });

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
const queue = loadMissingPdfQueue(projectRoot);
const recordsByKey = new Map<string, PublicationRecord>();
for (const record of profile.records) {
  if (record.doi) recordsByKey.set(record.doi, record);
  if (record.wosAccession) recordsByKey.set(record.wosAccession, record);
}

const items = [...queue.items].sort((first, second) => {
  const priorityDiff = priorityRank(first.accessPriority) - priorityRank(second.accessPriority);
  if (priorityDiff) return priorityDiff;
  return Number(second.year || 0) - Number(first.year || 0) || first.title.localeCompare(second.title);
});

const enriched = items.map((item) => ({
  item,
  record: recordsByKey.get(item.doi || "") || recordsByKey.get(item.wosAccession || "")
}));

const citationLines = enriched.map(({ item, record }, index) => {
  const authors = record?.fullAuthors.length ? record.fullAuthors.join("; ") : record?.authors.join("; ") || "not available";
  const doi = item.doi ? ` DOI: ${item.doi}.` : "";
  const wos = item.wosAccession ? ` WoS: ${item.wosAccession}.` : "";
  return `${index + 1}. ${authors} (${item.year || "n.d."}). ${item.title}. ${item.source || record?.source || "unknown source"}.${doi}${wos}`;
});

const libraryEmail = [
  `Subject: Document delivery request for ${items.length} Chai Ching Sing target articles`,
  "",
  "Dear Library Document Delivery Team,",
  "",
  "I am compiling a local research corpus for a scholarly review of Professor Chai Ching Sing's work. Could you please help obtain the PDFs for the following articles or book chapters? They are Web of Science records where Chai Ching Sing is first author or corresponding author, and I have not been able to access the full text through normal browser routes.",
  "",
  ...citationLines,
  "",
  "If any item is unavailable as a publisher PDF, an accepted manuscript or library-supplied scan would also be helpful for private research use.",
  "",
  "Thank you very much."
].join("\n");

const authorEmail = [
  "Subject: Request for a copy of your article",
  "",
  "Dear Professor Chai,",
  "",
  "I am studying your work on teacher learning, epistemic beliefs, TPACK/STEM-TPACK, knowledge building, and AI education. I am building a private local reading corpus for scholarly analysis and could not access the following paper through my normal library routes:",
  "",
  "[Paste one citation from the list below]",
  "",
  "If you are able to share an author copy or accepted manuscript for personal research use, I would be very grateful.",
  "",
  "Thank you very much."
].join("\n");

const markdownLines = [
  "# Missing PDF Acquisition Pack",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Missing target PDFs: ${items.length}`,
  `Progress: ${queue.summary.progress.todo} todo / ${queue.summary.progress.opened} tried / ${queue.summary.progress.requested} requested / ${queue.summary.progress.blocked} blocked`,
  "",
  "This pack is for legal/manual acquisition only. It does not bypass publisher, Web of Science, institution, ResearchGate, or Cloudflare checks.",
  "",
  "## Fastest Action Order",
  "",
  "1. Try the `1 Browser OA` and `2 Author upload` items first in a normal logged-in browser.",
  "2. Send the `3 Institution route` items through your library/document-delivery service.",
  "3. Use the `4 Hard locate` item as a bibliographic lookup request with WoS accession and title.",
  "4. After any PDF is downloaded, leave it in Downloads or put it in `data/pdf-inbox/`, then run `npm run refresh:pdfs`.",
  "",
  "## Library / Document Delivery Email",
  "",
  "```text",
  libraryEmail,
  "```",
  "",
  "## Author Copy Request Template",
  "",
  "```text",
  authorEmail,
  "```",
  "",
  "## Item Checklist",
  ""
];

for (const [index, { item, record }] of enriched.entries()) {
  const authors = record?.fullAuthors.length ? record.fullAuthors.join("; ") : record?.authors.join("; ") || "not available";
  markdownLines.push(
    `### ${index + 1}. ${item.title}`,
    "",
    `- Priority: ${item.accessPriority || "Manual route"}`,
    `- Role: ${roleLabel(record)}`,
    `- Year: ${item.year || "n.d."}`,
    `- Source: ${item.source || record?.source || "unknown"}`,
    `- Authors: ${authors}`,
    `- DOI: ${item.doi || "not available"}`,
    `- WoS accession: ${item.wosAccession || "not available"}`,
    `- Expected PDF file: \`${item.expectedPdfFile || "not generated"}\``,
    `- Current acquisition status: ${progressLabel(item.progress.status)}`,
    `- Next step: ${item.nextStep || "Use DOI/WoS metadata for lookup."}`,
    `- Routes: ${routeMarkdown(item)}`,
    `- Note: ${item.note || ""}`,
    ""
  );
}

fs.writeFileSync(markdownPath, `${markdownLines.join("\n")}\n`, "utf8");

const cards = enriched
  .map(({ item, record }, index) => {
    const authors = record?.fullAuthors.length ? record.fullAuthors.join("; ") : record?.authors.join("; ") || "not available";
    return `
      <article class="card">
        <div class="head">
          <span>${index + 1}</span>
          <div>
            <p>${escapeHtml([item.year, item.accessPriority, item.doi || item.wosAccession].filter(Boolean).join(" | "))}</p>
            <h2>${escapeHtml(item.title)}</h2>
          </div>
        </div>
        <div class="plan">${escapeHtml(item.nextStep || "Use DOI/WoS metadata for lookup.")}</div>
        <dl>
          <dt>Role</dt><dd>${escapeHtml(roleLabel(record))}</dd>
          <dt>Authors</dt><dd>${escapeHtml(authors)}</dd>
          <dt>Source</dt><dd>${escapeHtml(item.source || record?.source || "unknown")}</dd>
          <dt>Expected file</dt><dd><code>${escapeHtml(item.expectedPdfFile || "not generated")}</code></dd>
          <dt>Status</dt><dd>${escapeHtml(progressLabel(item.progress.status))}</dd>
        </dl>
        <p class="note">${escapeHtml(item.note || "")}</p>
        <div class="links">${routeHtml(item)}</div>
      </article>
    `;
  })
  .join("\n");

fs.writeFileSync(
  htmlPath,
  `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Prof. Chai PDF Acquisition Pack</title>
    <style>
      :root { color-scheme: light; --ink: #17202a; --muted: #5e6978; --line: #d8dee8; --paper: #fff; --soft: #f5f7fa; --accent: #1d6b5a; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--soft); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
      main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 56px; }
      header { display: grid; gap: 10px; margin-bottom: 22px; }
      h1, h2, p { margin: 0; }
      h1 { font-size: clamp(28px, 4vw, 42px); line-height: 1.1; letter-spacing: 0; }
      h2 { margin-top: 4px; font-size: 18px; line-height: 1.35; letter-spacing: 0; }
      .summary, .note, .head p { color: var(--muted); font-size: 14px; }
      .grid { display: grid; gap: 12px; }
      .templates { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin-bottom: 18px; }
      .card, .template { display: grid; gap: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 18px; }
      .head { display: grid; grid-template-columns: auto 1fr; gap: 12px; }
      .head > span { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 999px; background: #e5f2ee; color: var(--accent); font-weight: 700; }
      .plan { border: 1px solid #cfe3dc; border-radius: 8px; background: #f0faf6; color: #174f43; padding: 10px; font-size: 14px; }
      pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); padding: 12px; font-size: 13px; }
      dl { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 14px; }
      dt { color: var(--muted); }
      dd { margin: 0; }
      code { overflow-wrap: anywhere; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 13px; }
      .links { display: flex; flex-wrap: wrap; gap: 8px; }
      a, .links span { display: inline-flex; align-items: center; min-height: 34px; border: 1px solid var(--line); border-radius: 7px; background: #fff; color: var(--accent); padding: 6px 10px; text-decoration: none; font-size: 14px; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>AI Prof. Chai PDF Acquisition Pack</h1>
        <p class="summary">${escapeHtml(items.length)} missing target PDFs · ${escapeHtml(queue.summary.progress.opened)} tried · ${escapeHtml(queue.summary.progress.blocked)} blocked · generated ${escapeHtml(new Date().toISOString())}</p>
        <p class="summary">Use this for library/document-delivery or author-copy requests. After downloading PDFs, run <code>npm run refresh:pdfs</code>.</p>
      </header>
      <section class="templates">
        <article class="template">
          <h2>Library Email</h2>
          <pre>${escapeHtml(libraryEmail)}</pre>
        </article>
        <article class="template">
          <h2>Author Request</h2>
          <pre>${escapeHtml(authorEmail)}</pre>
        </article>
      </section>
      <section class="grid">${cards}</section>
    </main>
  </body>
</html>
`,
  "utf8"
);

console.log(`Acquisition records: ${items.length}`);
console.log(markdownPath);
console.log(htmlPath);

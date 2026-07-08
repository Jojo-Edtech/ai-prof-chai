import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assistantStatus } from "../server/assistant";
import { loadDistillation } from "../server/distillation";
import { loadLocalEnv } from "../server/env";
import { loadFullTextIndex } from "../server/fulltext";
import { loadMissingPdfQueue } from "../server/missing-pdfs";
import type { CorpusProfile } from "../src/shared/types";

type PdfAudit = {
  summary?: {
    generatedAt?: string;
    targetPdfSaved?: number;
    high?: number;
    medium?: number;
    low?: number;
  };
};

type DirectRouteAttempt = {
  status: "saved" | "already-present" | "not-pdf" | "rejected" | "failed" | "no-file-name";
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const auditPath = path.join(projectRoot, "data", "processed", "saved-pdf-audit.json");
const outputPath = path.join(projectRoot, "outputs", "ai-prof-chai-project-status.md");
const assistantEvalPath = path.join(projectRoot, "outputs", "ai-prof-chai-local-eval.md");
const pdfWatchStatePath = path.join(projectRoot, "data", "wos-downloads", "pdf-watch-state.json");
const wosDownloadsDir = path.join(projectRoot, "data", "wos-downloads");

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function percent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function priorityCounts() {
  const queue = loadMissingPdfQueue(projectRoot);
  const counts = new Map<string, number>();
  for (const item of queue.items) {
    const priority = item.accessPriority || "Unprioritized";
    counts.set(priority, (counts.get(priority) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    const leftRank = Number(left[0].match(/^(\d+)/)?.[1] || 9);
    const rightRank = Number(right[0].match(/^(\d+)/)?.[1] || 9);
    return leftRank - rightRank || left[0].localeCompare(right[0]);
  });
}

function actionGroupCounts() {
  const queue = loadMissingPdfQueue(projectRoot);
  const counts = new Map<string, number>();
  for (const item of queue.items) {
    const group = item.actionGroup || "Unsorted";
    counts.set(group, (counts.get(group) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function latestDirectRouteReport() {
  if (!fs.existsSync(wosDownloadsDir)) return null;
  const latest = fs
    .readdirSync(wosDownloadsDir)
    .filter((file) => /^direct-route-download-report-\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort()
    .at(-1);
  if (!latest) return null;
  const filePath = path.join(wosDownloadsDir, latest);
  const attempts = readJson<DirectRouteAttempt[]>(filePath) || [];
  const count = (status: DirectRouteAttempt["status"]) => attempts.filter((attempt) => attempt.status === status).length;
  return {
    path: path.relative(projectRoot, filePath),
    total: attempts.length,
    saved: count("saved"),
    alreadyPresent: count("already-present"),
    notPdf: count("not-pdf"),
    rejected: count("rejected"),
    failed: count("failed"),
    noFileName: count("no-file-name")
  };
}

function fastBrowserItems() {
  const queue = loadMissingPdfQueue(projectRoot);
  return queue.items
    .filter((item) => /browser save/i.test(item.actionGroup || ""))
    .sort((first, second) => {
      const priorityDiff = Number(first.accessPriority?.match(/^(\d+)/)?.[1] || 9) - Number(second.accessPriority?.match(/^(\d+)/)?.[1] || 9);
      if (priorityDiff) return priorityDiff;
      return Number(second.year || 0) - Number(first.year || 0);
    });
}

function preferredFastLink(item: { actionGroup?: string; links: Array<{ label: string; url: string }> }) {
  if (/author-upload/i.test(item.actionGroup || "")) {
    return (
      item.links.find((entry) => /researchgate/i.test(entry.label) && /pdf/i.test(entry.label)) ||
      item.links.find((entry) => /researchgate/i.test(entry.url) && /\.pdf/i.test(entry.url)) ||
      item.links.find((entry) => /researchgate/i.test(entry.label)) ||
      item.links.find((entry) => /researchgate/i.test(entry.url))
    );
  }
  if (/repository/i.test(item.actionGroup || "")) {
    return item.links.find((entry) => /handle|bitstream/i.test(entry.label)) || item.links.find((entry) => /hdl\.handle|bitstreams/i.test(entry.url));
  }
  if (/open-access/i.test(item.actionGroup || "")) {
    return item.links.find((entry) => /sage pdf|published pdf|cuhk/i.test(entry.label));
  }
  return item.links.find((entry) => /pdf|published|handle/i.test(entry.label)) || item.links[0];
}

loadLocalEnv(projectRoot);

const profile = readJson<CorpusProfile>(profilePath);
const fullText = loadFullTextIndex(projectRoot);
const distillation = loadDistillation(projectRoot);
const audit = readJson<PdfAudit>(auditPath);
const assistant = assistantStatus();
const queue = loadMissingPdfQueue(projectRoot);
const generatedAt = new Date().toISOString();
const progress = queue.summary.progress;
const directRouteReport = latestDirectRouteReport();

const lines = [
  "# AI Prof. Chai Project Status",
  "",
  `Generated: ${generatedAt}`,
  "",
  "## Current Status",
  "",
  `- Thread/project name: 蔡老师蒸馏项目`,
  `- WoS records imported: ${profile?.summary.total ?? 0}`,
  `- First-author records: ${profile?.summary.firstAuthor ?? 0}`,
  `- Corresponding-author records: ${profile?.summary.correspondingAuthor ?? 0}`,
  `- Target records, first or corresponding: ${profile?.summary.firstOrCorresponding ?? 0}`,
  `- Saved target PDFs: ${profile?.summary.pdfSaved ?? 0} / ${profile?.summary.firstOrCorresponding ?? 0} (${percent(
    profile?.summary.pdfSaved ?? 0,
    profile?.summary.firstOrCorresponding ?? 0
  )})`,
  `- Missing target PDFs: ${profile?.summary.pdfNeeded ?? queue.summary.count}`,
  `- Full-text index: ${fullText?.summary.indexed ?? 0} indexed / ${fullText?.summary.failed ?? 0} failed`,
  `- Saved-PDF audit: ${audit?.summary?.high ?? 0} high / ${audit?.summary?.medium ?? 0} medium / ${audit?.summary?.low ?? 0} low`,
  `- Distillation themes: ${distillation?.themes.length ?? 0}`,
  `- Distillation missing PDFs: ${distillation?.missingPdf.length ?? queue.summary.count}`,
  `- AI provider: ${assistant.provider}`,
  `- AI model: ${assistant.model}`,
  `- AI token configured: ${assistant.configured ? "yes" : "no"} (${assistant.tokenCount} saved)`,
  `- Local assistant evaluation: ${fs.existsSync(assistantEvalPath) ? "generated" : "not generated"}`,
  `- PDF auto-receiver state: ${fs.existsSync(pdfWatchStatePath) ? "initialized" : "not initialized"}`,
  "- PDF intake matcher: pypdf text extraction with raw-text fallback and known false-positive guards",
  directRouteReport
    ? `- Direct PDF route check: ${directRouteReport.saved} saved / ${directRouteReport.alreadyPresent} already present / ${directRouteReport.notPdf} HTML-not-PDF / ${directRouteReport.rejected} rejected / ${directRouteReport.failed} failed (${directRouteReport.path})`
    : "- Direct PDF route check: not run",
  "- PDF web upload: enabled",
  `- Missing PDF progress: ${progress.todo} todo / ${progress.opened} tried / ${progress.requested} requested / ${progress.blocked} blocked`,
  "",
  "## Remaining PDF Priority",
  "",
  "| Priority | Count |",
  "|---|---:|",
  ...priorityCounts().map(([priority, count]) => `| ${priority} | ${count} |`),
  "",
  "## Remaining PDF Action Groups",
  "",
  "| Action group | Count |",
  "|---|---:|",
  ...actionGroupCounts().map(([group, count]) => `| ${group} | ${count} |`),
  "",
  "## Fast Browser Saves",
  "",
  ...fastBrowserItems().flatMap((item, index) => [
    `${index + 1}. ${item.year || "n.d."} - ${item.title}`,
    `   - Route type: ${item.actionGroup || "browser save"}`,
    `   - First link: ${preferredFastLink(item)?.label || "not available"}${preferredFastLink(item)?.url ? ` - ${preferredFastLink(item)?.url}` : ""}`,
    `   - Expected file: \`${item.expectedPdfFile || "not generated"}\``
  ]),
  "",
  "## Active Outputs",
  "",
  "- `outputs/ai-prof-chai-distillation.md`",
"- `outputs/ai-prof-chai-fulltext-index.md`",
"- `outputs/ai-prof-chai-evidence-pack.md`",
"- `outputs/ai-prof-chai-evidence-pack.csv`",
"- `outputs/ai-prof-chai-local-eval.md`",
"- `outputs/ai-prof-chai-local-eval.json`",
"- `outputs/saved-pdf-audit.md`",
"- `outputs/target-coverage-matrix.csv`",
"- `outputs/target-coverage-matrix.md`",
"- `outputs/missing-pdf-download-pack.html`",
  "- `outputs/missing-pdf-sprint-checklist.html`",
  "- `outputs/missing-pdf-sprint-checklist.md`",
  "- `outputs/missing-pdf-browser-shortcuts/index.html`",
  "- `outputs/missing-pdf-download-queue.md`",
  "- `outputs/missing-pdf-library-request.csv`",
  "- `outputs/missing-pdf-library-request.ris`",
  "- `outputs/missing-pdf-library-request.md`",
  "- `outputs/missing-pdf-library-request.html`",
  "- `outputs/missing-pdf-acquisition-pack.md`",
  "- `outputs/missing-pdf-acquisition-pack.html`",
  "- `outputs/missing-pdf-open-access-recheck.md`",
  "- `outputs/missing-pdf-public-web-recheck.md`",
  "- `outputs/missing-pdf-scholarly-metadata-recheck.md`",
  "- `outputs/missing-pdf-targeted-metadata-runs.md`",
  "- `outputs/missing-pdf-cuhk-pure-check.md`",
  "- `outputs/goal-completion-audit.md`",
  "",
  "## Next Actions",
  "",
  "1. Open `outputs/missing-pdf-sprint-checklist.html`, `outputs/missing-pdf-download-pack.html`, or the app's PDF queue.",
  "2. Download missing PDFs through normal browser, institution, or library routes.",
  "3. Use the app's `上传PDF` button after manually downloading PDFs, or use `扫描下载` to intake files from Downloads and data/pdf-inbox.",
  "4. Run `npm run watch:pdfs` while manually saving PDFs if you want automatic intake from Downloads and data/pdf-inbox.",
  "5. Run `npm run refresh:pdfs` after each batch of downloads if you are not using the app or watcher.",
  "6. Run `npm run eval:assistant` to regenerate the local no-token AI Prof. Chai evaluation after corpus changes.",
  "7. Run `npm run check:missing-metadata` to recheck Semantic Scholar, OpenAlex, Unpaywall, and Crossref structured PDF metadata.",
  "8. Run `npm run check:cuhk-pure` to recheck CUHK Pure pages for hidden `citation_pdf_url` or `files/*.pdf` candidates.",
  "9. Paste one or more DeepSeek API keys into the app's AI Prof. Chai panel and use `测试连接`; or run `npm run setup:ai`, then `npm run check:ai`.",
  "",
  "## Guardrails",
  "",
  "- Do not bypass publisher, WoS, or institutional authentication.",
  "- Do not count related versions as exact target PDFs.",
  "- Known false-positive PDFs are rejected before title/DOI matching.",
  "- Keep raw tokens and account credentials out of reports and memory.",
  ""
];

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");

console.log(outputPath);

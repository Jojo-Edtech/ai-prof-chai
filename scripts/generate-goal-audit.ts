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
    targetPdfSaved?: number;
    high?: number;
    medium?: number;
    low?: number;
  };
};

type ThreadVerification = {
  verifiedAt: string;
  threadId: string;
  title: string;
  evidence: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "outputs", "goal-completion-audit.md");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const auditPath = path.join(projectRoot, "data", "processed", "saved-pdf-audit.json");
const threadPath = path.join(projectRoot, "data", "processed", "thread-verification.json");
const assistantEvalPath = path.join(projectRoot, "outputs", "ai-prof-chai-local-eval.md");

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function status(done: boolean) {
  return done ? "complete" : "incomplete";
}

function percent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

loadLocalEnv(projectRoot);

const profile = readJson<CorpusProfile>(profilePath);
const pdfAudit = readJson<PdfAudit>(auditPath);
const thread = readJson<ThreadVerification>(threadPath);
const fullText = loadFullTextIndex(projectRoot);
const distillation = loadDistillation(projectRoot);
const queue = loadMissingPdfQueue(projectRoot);
const assistant = assistantStatus();

const totalTargets = profile?.summary.firstOrCorresponding ?? 0;
const savedPdfs = profile?.summary.pdfSaved ?? 0;
const missingPdfs = profile?.summary.pdfNeeded ?? queue.summary.count;
const indexed = fullText?.summary.indexed ?? 0;
const indexedTargetPdfs = fullText?.summary.targetPdfSaved ?? 0;
const auditHigh = pdfAudit?.summary?.high ?? 0;
const auditMedium = pdfAudit?.summary?.medium ?? 0;
const auditLow = pdfAudit?.summary?.low ?? 0;
const allPdfsSaved = totalTargets > 0 && missingPdfs === 0 && savedPdfs === totalTargets;
const localAssistantEvaluated = fs.existsSync(assistantEvalPath);
const aiProjectUsable = Boolean(profile && distillation && fullText && queue.summary.available && localAssistantEvaluated);
const aiModelBacked = assistant.configured;

const lines = [
  "# Goal Completion Audit",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Objective",
  "",
  "1. Rename this Codex conversation to `蔡老师蒸馏项目`.",
  "2. Download all Web of Science articles where Chai Ching Sing is first author or corresponding author.",
  "3. Build an AI Prof. Chai project from the downloaded WoS/PDF corpus.",
  "",
  "## Requirement Audit",
  "",
  "| Requirement | Status | Current Evidence | Remaining Work |",
  "|---|---|---|---|",
  `| Thread named 蔡老师蒸馏项目 | ${status(thread?.title === "蔡老师蒸馏项目")} | ${thread ? `Codex thread ${thread.threadId} verified at ${thread.verifiedAt}; title is ${thread.title}.` : "No thread verification file found."} | ${thread?.title === "蔡老师蒸馏项目" ? "None." : "Re-run thread title verification or rename the thread."} |`,
  `| WoS target set imported | ${status(Boolean(profile && totalTargets > 0))} | ${profile ? `${profile.summary.total} WoS records imported; ${profile.summary.firstAuthor} first-author, ${profile.summary.correspondingAuthor} corresponding-author, ${totalTargets} first-or-corresponding target records.` : "No imported WoS profile found."} | ${profile ? "None for the current WoS export snapshot." : "Import the WoS export."} |`,
  `| Target PDFs downloaded | ${status(allPdfsSaved)} | ${savedPdfs}/${totalTargets} target PDFs saved (${percent(savedPdfs, totalTargets)}); ${missingPdfs} still missing. Audit: ${auditHigh} high / ${auditMedium} medium / ${auditLow} low. | ${allPdfsSaved ? "None." : "Download the remaining target PDFs through normal browser, institution, author-upload, or library routes, then run npm run refresh:pdfs."} |`,
  `| Full-text index built | ${status(indexedTargetPdfs > 0 && indexed === indexedTargetPdfs)} | ${indexed}/${indexedTargetPdfs} saved target PDFs indexed; ${fullText?.summary.failed ?? 0} extraction failures. | ${allPdfsSaved ? "None after all PDFs are indexed." : "Index will expand after missing PDFs are added."} |`,
  `| Distillation map generated | ${status(Boolean(distillation?.themes.length))} | ${distillation?.themes.length ?? 0} themes; ${distillation?.eras.length ?? 0} eras; ${distillation?.missingPdf.length ?? missingPdfs} missing-PDF entries. | ${allPdfsSaved ? "Regenerate once after final PDF refresh." : "Regenerate after additional PDFs are added."} |`,
  `| AI Prof. Chai app usable | ${status(aiProjectUsable)} | Local profile, distillation, full-text status, PDF queue, download pack, coverage matrix, browser shortcuts, web PDF upload/scan intake, local token-pool UI, connection test endpoint, and local assistant evaluation are ${aiProjectUsable ? "generated" : "not all generated"}. AI provider is ${assistant.provider}; model token configured: ${assistant.configured ? "yes" : "no"} (${assistant.tokenCount} saved). | ${aiModelBacked ? "None for model-backed chat." : "Paste one or more DeepSeek API keys into the app and use 测试连接, or run npm run setup:ai and npm run check:ai; local rule-based answers already work."} |`,
  "",
  "## Current Counts",
  "",
  `- WoS records imported: ${profile?.summary.total ?? 0}`,
  `- Target records: ${totalTargets}`,
  `- Saved target PDFs: ${savedPdfs}`,
  `- Missing target PDFs: ${missingPdfs}`,
  `- Full-text indexed PDFs: ${indexed}/${indexedTargetPdfs}`,
  `- Missing PDF queue entries: ${queue.summary.count}`,
  `- AI token configured: ${assistant.configured ? "yes" : "no"} (${assistant.tokenCount} saved)`,
  "",
  "## Evidence Files",
  "",
  "- `data/processed/thread-verification.json`",
  "- `data/processed/chai-publications.json`",
  "- `data/processed/chai-fulltext-index.json`",
  "- `data/processed/chai-distillation.json`",
  "- `data/processed/saved-pdf-audit.json`",
  "- `data/processed/missing-pdf-queue.csv`",
  "- `outputs/ai-prof-chai-evidence-pack.md`",
  "- `outputs/ai-prof-chai-local-eval.md`",
  "- `outputs/target-coverage-matrix.md`",
  "- `outputs/missing-pdf-download-pack.html`",
  "- `outputs/missing-pdf-sprint-checklist.md`",
  "- `outputs/missing-pdf-browser-shortcuts/index.html`",
  "- `outputs/missing-pdf-public-web-recheck.md`",
  "- `outputs/missing-pdf-targeted-metadata-runs.md`",
  "- `outputs/missing-pdf-cuhk-pure-check.md`",
  "- `outputs/missing-pdf-library-request.md`",
  "- `outputs/missing-pdf-library-request.html`",
  "",
  "## Completion Decision",
  "",
  allPdfsSaved && aiModelBacked
    ? "The original objective is complete against current local evidence."
    : `The original objective is not yet complete. The project is usable, but ${missingPdfs} target PDFs remain missing and model-backed AI chat is not enabled until a local token is configured.`,
  ""
];

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");

console.log(outputPath);
console.log(`Goal complete: ${allPdfsSaved && aiModelBacked ? "yes" : "no"}`);
console.log(`Saved target PDFs: ${savedPdfs}/${totalTargets}`);
console.log(`AI token configured: ${assistant.configured ? "yes" : "no"} (${assistant.tokenCount} saved)`);

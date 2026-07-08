import cors from "cors";
import express from "express";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answerWithAssistant, assistantStatus, checkAssistantConnection, parseApiTokens } from "./assistant";
import { loadCorpus } from "./corpus";
import { loadDistillation } from "./distillation";
import { loadLocalEnv, upsertLocalEnvFile } from "./env";
import { fullTextStatus, loadFullTextIndex } from "./fulltext";
import { loadMissingPdfQueue, updateMissingPdfProgress } from "./missing-pdfs";
import type { CorpusProfile, FullTextIndex, MissingPdfProgressStatus, PdfRefreshResult, PdfUploadResult } from "../src/shared/types";

const app = express();
const port = Number(process.env.PORT || 4318);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

loadLocalEnv(projectRoot);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, app: "ai-prof-chai" });
});

app.get("/api/profile", (_request, response) => {
  response.json(loadCorpus(projectRoot));
});

app.get("/api/distillation", (_request, response) => {
  response.json(loadDistillation(projectRoot) || { themes: [], eras: [], missingPdf: [] });
});

app.get("/api/fulltext", (_request, response) => {
  response.json(fullTextStatus(loadFullTextIndex(projectRoot)));
});

app.get("/api/pdf-audit", (_request, response) => {
  const auditPath = path.join(projectRoot, "data", "processed", "saved-pdf-audit.json");
  if (!fs.existsSync(auditPath)) {
    response.json({ summary: { available: false, targetPdfSaved: 0, high: 0, medium: 0, low: 0 } });
    return;
  }
  const audit = JSON.parse(fs.readFileSync(auditPath, "utf8")) as {
    summary?: { generatedAt?: string; targetPdfSaved?: number; high?: number; medium?: number; low?: number };
  };
  response.json({
    generatedAt: audit.summary?.generatedAt,
    summary: {
      available: true,
      targetPdfSaved: audit.summary?.targetPdfSaved || 0,
      high: audit.summary?.high || 0,
      medium: audit.summary?.medium || 0,
      low: audit.summary?.low || 0
    }
  });
});

app.get("/api/project-status", (_request, response) => {
  const statusPath = path.join(projectRoot, "outputs", "ai-prof-chai-project-status.md");
  if (!fs.existsSync(statusPath)) {
    response.status(404).send("Project status report has not been generated. Run npm run report:status first.");
    return;
  }
  response.type("text/markdown").sendFile(statusPath);
});

app.get("/api/goal-audit", (_request, response) => {
  const auditPath = path.join(projectRoot, "outputs", "goal-completion-audit.md");
  if (!fs.existsSync(auditPath)) {
    response.status(404).send("Goal audit has not been generated. Run npm run audit:goal first.");
    return;
  }
  response.type("text/markdown").sendFile(auditPath);
});

app.get("/api/coverage-matrix/:format", (request, response) => {
  const format = request.params.format;
  const files: Record<string, string> = {
    csv: "target-coverage-matrix.csv",
    md: "target-coverage-matrix.md"
  };
  const fileName = files[format];
  if (!fileName) {
    response.status(404).send("Unsupported coverage matrix format.");
    return;
  }
  const filePath = path.join(projectRoot, "outputs", fileName);
  if (!fs.existsSync(filePath)) {
    response.status(404).send("Coverage matrix has not been generated. Run npm run export:coverage first.");
    return;
  }
  if (format === "md") {
    response.type("text/markdown").sendFile(filePath);
    return;
  }
  response.download(filePath, fileName);
});

app.get("/api/evidence-pack/:format", (request, response) => {
  const format = request.params.format;
  const files: Record<string, string> = {
    csv: "ai-prof-chai-evidence-pack.csv",
    md: "ai-prof-chai-evidence-pack.md"
  };
  const fileName = files[format];
  if (!fileName) {
    response.status(404).send("Unsupported evidence pack format.");
    return;
  }
  const filePath = path.join(projectRoot, "outputs", fileName);
  if (!fs.existsSync(filePath)) {
    response.status(404).send("Evidence pack has not been generated. Run npm run export:evidence-pack first.");
    return;
  }
  if (format === "md") {
    response.type("text/markdown").sendFile(filePath);
    return;
  }
  response.download(filePath, fileName);
});

app.get("/api/assistant/eval", (_request, response) => {
  const evalPath = path.join(projectRoot, "outputs", "ai-prof-chai-local-eval.md");
  if (!fs.existsSync(evalPath)) {
    response.status(404).send("Assistant local evaluation has not been generated. Run npm run eval:assistant first.");
    return;
  }
  response.type("text/markdown").sendFile(evalPath);
});

app.get("/api/missing-pdfs", (_request, response) => {
  response.json(loadMissingPdfQueue(projectRoot));
});

app.patch("/api/missing-pdfs/progress", (request, response) => {
  try {
    const key = String(request.body?.key || "");
    const status = String(request.body?.status || "") as MissingPdfProgressStatus;
    response.json(updateMissingPdfProgress(projectRoot, key, status));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Progress update failed." });
  }
});

function latestManualIngestReportPath() {
  const reportDir = path.join(projectRoot, "data", "wos-downloads");
  if (!fs.existsSync(reportDir)) return undefined;
  const reports = fs
    .readdirSync(reportDir)
    .filter((file) => /^manual-pdf-ingest-report-\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort();
  const latest = reports.at(-1);
  return latest ? path.join(reportDir, latest) : undefined;
}

function refreshSnapshot() {
  const profile = loadCorpus(projectRoot) as CorpusProfile;
  const fullText = loadFullTextIndex(projectRoot) as FullTextIndex | null;
  return {
    savedTargetPdfs: profile.summary.pdfSaved,
    missingTargetPdfs: profile.summary.pdfNeeded,
    indexedPdfs: fullText?.summary.indexed ?? 0,
    indexedTargetPdfs: fullText?.summary.targetPdfSaved ?? 0
  };
}

function runRefreshPipeline(before: ReturnType<typeof refreshSnapshot>, noChangeMessage: (missing: number) => string): PdfRefreshResult {
  const result = spawnSync("npm", ["run", "refresh:pdfs"], {
    cwd: projectRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 180000
  });

  const after = refreshSnapshot();
  const savedDelta = after.savedTargetPdfs - before.savedTargetPdfs;
  const missingDelta = after.missingTargetPdfs - before.missingTargetPdfs;
  return {
    ok: result.status === 0,
    generatedAt: new Date().toISOString(),
    before,
    after,
    savedDelta,
    missingDelta,
    message:
      result.status === 0
        ? savedDelta > 0
          ? `Received ${savedDelta} new PDF(s); ${after.missingTargetPdfs} still pending.`
          : noChangeMessage(after.missingTargetPdfs)
        : `Refresh failed: ${(result.stderr || result.stdout || "unknown error").slice(0, 400)}`,
    reportPath: latestManualIngestReportPath()
  };
}

app.post("/api/pdfs/refresh", (_request, response) => {
  const before = refreshSnapshot();
  const payload = runRefreshPipeline(before, (missing) => `Scanned downloads; no new target PDFs were matched. ${missing} still pending.`);

  if (!payload.ok) {
    response.status(500).json(payload);
    return;
  }
  response.json(payload);
});

function decodeHeader(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "uploaded.pdf";
  try {
    return decodeURIComponent(String(raw));
  } catch {
    return String(raw);
  }
}

function safePdfName(value: string) {
  const base = path.basename(value || "uploaded.pdf").replace(/[^a-z0-9 ._()-]+/gi, "_").replace(/\s+/g, " ").trim();
  const withExtension = base.toLowerCase().endsWith(".pdf") ? base : `${base || "uploaded"}.pdf`;
  return withExtension.slice(0, 160);
}

function pdfBuffer(value: unknown) {
  return Buffer.isBuffer(value) ? value : Buffer.alloc(0);
}

app.post("/api/pdfs/upload", express.raw({ type: ["application/pdf", "application/octet-stream"], limit: "100mb" }), (request, response) => {
  const buffer = pdfBuffer(request.body);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    response.status(400).json({ error: "Please choose a real PDF file." });
    return;
  }

  const inboxDir = path.join(projectRoot, "data", "pdf-inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  const originalName = safePdfName(decodeHeader(request.header("x-filename")));
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const uploadName = `upload-${stamp}-${originalName}`;
  const uploadPath = path.join(inboxDir, uploadName);
  const before = refreshSnapshot();

  fs.writeFileSync(uploadPath, buffer);
  const payload = runRefreshPipeline(before, (missing) => `The PDF was placed in the matching inbox, but no new target paper was matched. ${missing} still pending.`) as PdfUploadResult;
  payload.uploadedFile = path.relative(projectRoot, uploadPath);

  if (!payload.ok) {
    response.status(500).json(payload);
    return;
  }
  response.json(payload);
});

app.get("/api/missing-pdfs/download-pack", (_request, response) => {
  const downloadPackPath = path.join(projectRoot, "outputs", "missing-pdf-download-pack.html");
  if (!fs.existsSync(downloadPackPath)) {
    response.status(404).send("Missing PDF download pack has not been generated. Run npm run export:download-pack first.");
    return;
  }
  response.sendFile(downloadPackPath);
});

app.get("/api/missing-pdfs/sprint-checklist", (_request, response) => {
  const sprintPath = path.join(projectRoot, "outputs", "missing-pdf-sprint-checklist.html");
  if (!fs.existsSync(sprintPath)) {
    response.status(404).send("Sprint checklist has not been generated. Run npm run export:sprint first.");
    return;
  }
  response.sendFile(sprintPath);
});

app.get("/api/missing-pdfs/browser-shortcuts", (_request, response) => {
  const shortcutIndexPath = path.join(projectRoot, "outputs", "missing-pdf-browser-shortcuts", "index.html");
  if (!fs.existsSync(shortcutIndexPath)) {
    response.status(404).send("Browser shortcuts have not been generated. Run npm run export:browser-shortcuts first.");
    return;
  }
  response.sendFile(shortcutIndexPath);
});

app.get("/api/missing-pdfs/acquisition-pack", (_request, response) => {
  const acquisitionPackPath = path.join(projectRoot, "outputs", "missing-pdf-acquisition-pack.html");
  if (!fs.existsSync(acquisitionPackPath)) {
    response.status(404).send("Acquisition pack has not been generated. Run npm run export:acquisition-pack first.");
    return;
  }
  response.sendFile(acquisitionPackPath);
});

app.get("/api/missing-pdfs/open-access-recheck", (_request, response) => {
  const recheckPath = path.join(projectRoot, "outputs", "missing-pdf-open-access-recheck.md");
  if (!fs.existsSync(recheckPath)) {
    response.status(404).send("Open access recheck has not been generated. Run npm run check:missing-oa first.");
    return;
  }
  response.type("text/markdown").sendFile(recheckPath);
});

app.get("/api/missing-pdfs/public-web-recheck", (_request, response) => {
  const recheckPath = path.join(projectRoot, "outputs", "missing-pdf-public-web-recheck.md");
  if (!fs.existsSync(recheckPath)) {
    response.status(404).send("Public web recheck has not been generated yet.");
    return;
  }
  response.type("text/markdown").sendFile(recheckPath);
});

app.get("/api/missing-pdfs/cuhk-pure-check", (_request, response) => {
  const recheckPath = path.join(projectRoot, "outputs", "missing-pdf-cuhk-pure-check.md");
  if (!fs.existsSync(recheckPath)) {
    response.status(404).send("CUHK Pure check has not been generated. Run npm run check:cuhk-pure first.");
    return;
  }
  response.type("text/markdown").sendFile(recheckPath);
});

app.get("/api/missing-pdfs/library-request/:format", (request, response) => {
  const format = request.params.format;
  const files: Record<string, string> = {
    csv: "missing-pdf-library-request.csv",
    ris: "missing-pdf-library-request.ris",
    md: "missing-pdf-library-request.md",
    html: "missing-pdf-library-request.html"
  };
  const fileName = files[format];
  if (!fileName) {
    response.status(404).send("Unsupported library request format.");
    return;
  }
  const filePath = path.join(projectRoot, "outputs", fileName);
  if (!fs.existsSync(filePath)) {
    response.status(404).send("Missing library request pack has not been generated. Run npm run export:library-request first.");
    return;
  }
  if (format === "html") {
    response.sendFile(filePath);
    return;
  }
  response.download(filePath, fileName);
});

app.get("/api/assistant/config", (_request, response) => {
  response.json(assistantStatus());
});

function isLocalOrigin(origin?: string) {
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

app.post("/api/assistant/config", (request, response) => {
  if (!isLocalOrigin(request.header("origin"))) {
    response.status(403).json({ error: "Tokens can only be saved from the local AI Prof. Chai page." });
    return;
  }

  const tokens = parseApiTokens(String(request.body?.token || "")).filter((token) => token.length >= 8);
  if (!tokens.length) {
    response.status(400).json({ error: "Please enter a valid ModelScope token." });
    return;
  }

  upsertLocalEnvFile(projectRoot, {
    AI_PROF_CHAI_AI_PROVIDER: "modelscope",
    AI_PROF_CHAI_MODELSCOPE_API_TOKENS: tokens.join(","),
    AI_PROF_CHAI_MODELSCOPE_API_TOKEN: tokens[0],
    AI_PROF_CHAI_MODELSCOPE_MODEL: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    AI_PROF_CHAI_MODELSCOPE_API_BASE: "https://api-inference.modelscope.cn/v1",
    AI_PROF_CHAI_DAILY_LIMIT: "50",
    AI_PROF_CHAI_MAX_TOKENS: "1100"
  });
  response.json(assistantStatus());
});

app.post("/api/assistant/check", async (request, response) => {
  if (!isLocalOrigin(request.header("origin"))) {
    response.status(403).json({ error: "The model connection can only be checked from the local AI Prof. Chai page." });
    return;
  }
  response.json(await checkAssistantConnection());
});

app.post("/api/assistant/chat", async (request, response) => {
  try {
    const messages = Array.isArray(request.body?.messages) ? request.body.messages : [];
    response.json(
      await answerWithAssistant(messages, loadCorpus(projectRoot), loadDistillation(projectRoot), loadFullTextIndex(projectRoot))
    );
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : "AI Prof. Chai is temporarily unavailable"
    });
  }
});

if (process.env.NODE_ENV === "production") {
  const distDir = path.join(projectRoot, "dist");
  app.use(express.static(distDir));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(port, host, () => {
  console.log(`AI Prof. Chai API running at http://${host}:${port}`);
});

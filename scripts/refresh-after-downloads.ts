import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusProfile, DistillationProfile, FullTextIndex } from "../src/shared/types";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  ["npm", ["run", "ingest:downloads"]],
  ["npm", ["run", "ingest:pdfs"]],
  ["npm", ["run", "import:wos"]],
  ["npm", ["run", "index:pdfs"]],
  ["npm", ["run", "audit:pdfs"]],
  ["npm", ["run", "distill"]],
  ["npm", ["run", "export:missing-pdfs"]],
  ["npm", ["run", "export:download-pack"]],
  ["npm", ["run", "export:sprint"]],
  ["npm", ["run", "export:browser-shortcuts"]],
  ["npm", ["run", "export:library-request"]],
  ["npm", ["run", "export:acquisition-pack"]],
  ["npm", ["run", "export:coverage"]],
  ["npm", ["run", "export:evidence-pack"]],
  ["npm", ["run", "eval:assistant"]],
  ["npm", ["run", "report:status"]],
  ["npm", ["run", "audit:goal"]]
] as const;

function run(command: string, args: readonly string[]) {
  const label = `${command} ${args.join(" ")}`;
  console.log(`\n> ${label}`);
  const result = spawnSync(command, [...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8")) as T;
}

for (const [command, args] of steps) run(command, args);

const profile = readJson<CorpusProfile>("data/processed/chai-publications.json");
const distillation = readJson<DistillationProfile>("data/processed/chai-distillation.json");
const fullText = readJson<FullTextIndex>("data/processed/chai-fulltext-index.json");

console.log("\nRefresh complete");
console.log(`Target records: ${profile.summary.firstOrCorresponding}`);
console.log(`Saved target PDFs: ${profile.summary.pdfSaved}`);
console.log(`Missing target PDFs: ${profile.summary.pdfNeeded}`);
console.log(`Indexed PDFs: ${fullText.summary.indexed}/${fullText.summary.targetPdfSaved}`);
console.log(`Distillation missing PDFs: ${distillation.missingPdf.length}`);

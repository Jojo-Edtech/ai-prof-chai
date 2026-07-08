import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCorpusProfile, parseWosRecords, toPublication } from "../server/wos";
import type { PublicationRecord } from "../src/shared/types";
import { writeTargetOutputs } from "./target-outputs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(projectRoot, "data", "wos");
const pdfDir = path.join(projectRoot, "data", "pdfs");
const outputPath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const previousProfile = fs.existsSync(outputPath) ? (JSON.parse(fs.readFileSync(outputPath, "utf8")) as { records?: PublicationRecord[] }) : undefined;
const previousRecords = new Map<string, PublicationRecord>();
for (const record of previousProfile?.records || []) {
  if (record.wosAccession) previousRecords.set(record.wosAccession, record);
  if (record.doi) previousRecords.set(record.doi.toLowerCase(), record);
}

const allowedExtensions = new Set([".txt", ".csv", ".tsv"]);
const sourceFiles = fs.existsSync(sourceDir)
  ? fs.readdirSync(sourceDir).filter((file) => allowedExtensions.has(path.extname(file).toLowerCase())).sort()
  : [];

const publications = sourceFiles.flatMap((file) => {
  const absolutePath = path.join(sourceDir, file);
  const text = fs.readFileSync(absolutePath, "utf8");
  return parseWosRecords(text).map((record, index) => toPublication(record, file, index));
});

function withPdfStatus(record: PublicationRecord): PublicationRecord {
  const previous = previousRecords.get(record.wosAccession || "") || previousRecords.get((record.doi || "").toLowerCase());
  const merged = previous?.oaUrl ? { ...record, oaUrl: previous.oaUrl } : record;
  if (!merged.pdfFile) return merged;
  const exists = fs.existsSync(path.join(pdfDir, merged.pdfFile));
  return {
    ...merged,
    downloadStatus: exists ? "pdf-saved" : merged.downloadStatus
  };
}

const profile = buildCorpusProfile(publications.map(withPdfStatus), sourceFiles);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
const targetOutputs = writeTargetOutputs(profile, projectRoot);

console.log(`Imported ${profile.summary.total} WoS records into ${outputPath}`);
console.log(`First author: ${profile.summary.firstAuthor}`);
console.log(`Corresponding author: ${profile.summary.correspondingAuthor}`);
console.log(`First or corresponding: ${profile.summary.firstOrCorresponding}`);
console.log(`Target list: ${targetOutputs.markdownPath}`);
console.log(`Target CSV: ${targetOutputs.csvPath}`);

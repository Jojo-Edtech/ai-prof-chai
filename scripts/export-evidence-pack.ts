import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFullTextIndex } from "../server/fulltext";
import { loadMissingPdfQueue } from "../server/missing-pdfs";
import type { CorpusProfile, FullTextRecord, PublicationRecord } from "../src/shared/types";

type AuditFile = {
  records?: Array<{
    doi?: string;
    wosAccession?: string;
    pdfFile?: string;
    confidence: "high" | "medium" | "low";
    score: number;
  }>;
};

type Theme = {
  id: string;
  label: string;
  terms: string[];
};

type EvidenceRow = {
  year: string;
  role: string;
  audit: string;
  title: string;
  source: string;
  doi: string;
  wosAccession: string;
  pdfFile: string;
  pageCount: number;
  textLength: number;
  strongestThemes: string;
  matchedTerms: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const auditPath = path.join(projectRoot, "data", "processed", "saved-pdf-audit.json");
const outputsDir = path.join(projectRoot, "outputs");
const markdownPath = path.join(outputsDir, "ai-prof-chai-evidence-pack.md");
const csvPath = path.join(outputsDir, "ai-prof-chai-evidence-pack.csv");

const themes: Theme[] = [
  {
    id: "ai-education",
    label: "AI education and learning intention",
    terms: ["artificial intelligence", "ai", "learning intention", "behavioral intention", "readiness", "motivation"]
  },
  {
    id: "tpack-stem",
    label: "TPACK, STEM-TPACK, and design knowledge",
    terms: ["tpack", "technological pedagogical", "stem", "design", "teacher knowledge", "pedagogical content"]
  },
  {
    id: "epistemic-beliefs",
    label: "Epistemic beliefs and conceptions of teaching",
    terms: ["epistemological beliefs", "epistemic beliefs", "beliefs about teaching", "conceptions of teaching", "constructivist"]
  },
  {
    id: "knowledge-building",
    label: "Knowledge building, CSCL, and knowledge creation",
    terms: ["knowledge building", "knowledge creation", "computer-supported collaborative", "cscl", "online interaction"]
  },
  {
    id: "professional-learning",
    label: "Teacher education and professional learning",
    terms: ["teacher education", "professional development", "pre-service", "preservice", "learning communities", "teacher learning"]
  },
  {
    id: "motivation-sdt",
    label: "Motivation and self-determination",
    terms: ["self-determination", "self-determined", "autonomy", "competence", "relatedness", "intrinsic motivation"]
  }
];

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function normalize(value = "") {
  return ` ${value.toLowerCase().replace(/\s+/g, " ")} `;
}

function countTerm(text: string, term: string) {
  const cleanTerm = term.toLowerCase().replace(/\s+/g, " ").trim();
  if (!cleanTerm) return 0;
  const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const pattern =
    cleanTerm.length <= 3
      ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "g")
      : new RegExp(escaped, "g");
  return text.match(pattern)?.length || 0;
}

function roleLabel(record?: PublicationRecord) {
  if (!record) return "target";
  if (record.isFirstAuthor && record.isCorrespondingAuthor) return "first_and_corresponding";
  if (record.isFirstAuthor) return "first_author";
  if (record.isCorrespondingAuthor) return "corresponding_author";
  return "other";
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function mdCell(value: unknown) {
  return String(value ?? "").replace(/\|/g, " ");
}

function keyFor(record: { doi?: string; wosAccession?: string; pdfFile?: string; title?: string }) {
  return record.doi || record.wosAccession || record.pdfFile || record.title || "";
}

function themeMatches(record: FullTextRecord) {
  const text = normalize(`${record.title} ${record.source || ""} ${record.text || ""}`);
  return themes
    .map((theme) => {
      const termScores = theme.terms
        .map((term) => ({ term, count: countTerm(text, term) }))
        .filter((item) => item.count > 0)
        .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term));
      const score = termScores.reduce((sum, item) => sum + item.count, 0);
      return { theme, score, terms: termScores.map((item) => item.term) };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score);
}

if (!fs.existsSync(profilePath)) throw new Error("Missing data/processed/chai-publications.json. Run npm run import:wos first.");

const profile = readJson<CorpusProfile>(profilePath);
const fullText = loadFullTextIndex(projectRoot);
const audit = readJson<AuditFile>(auditPath);
const queue = loadMissingPdfQueue(projectRoot);

if (!profile) throw new Error("Missing corpus profile.");
if (!fullText) throw new Error("Missing full-text index. Run npm run index:pdfs first.");

const recordsByKey = new Map<string, PublicationRecord>();
for (const record of profile.records) {
  if (record.doi) recordsByKey.set(record.doi, record);
  if (record.wosAccession) recordsByKey.set(record.wosAccession, record);
  if (record.pdfFile) recordsByKey.set(record.pdfFile, record);
}

const auditByKey = new Map<string, NonNullable<AuditFile["records"]>[number]>();
for (const record of audit?.records || []) {
  if (record.doi) auditByKey.set(record.doi, record);
  if (record.wosAccession) auditByKey.set(record.wosAccession, record);
  if (record.pdfFile) auditByKey.set(record.pdfFile, record);
}

const indexedRecords = fullText.records.filter((record) => record.status === "indexed");
const rows: EvidenceRow[] = indexedRecords
  .map((record) => {
    const publication = recordsByKey.get(keyFor(record)) || recordsByKey.get(record.pdfFile);
    const auditRecord = auditByKey.get(keyFor(record)) || auditByKey.get(record.pdfFile);
    const matches = themeMatches(record);
    return {
      year: record.year || "",
      role: roleLabel(publication),
      audit: auditRecord ? `${auditRecord.confidence}:${auditRecord.score}` : "not-audited",
      title: record.title,
      source: record.source || "",
      doi: record.doi || "",
      wosAccession: record.wosAccession || "",
      pdfFile: record.pdfFile,
      pageCount: record.pageCount,
      textLength: record.textLength,
      strongestThemes: matches.slice(0, 3).map((match) => `${match.theme.label} (${match.score})`).join("; "),
      matchedTerms: matches.flatMap((match) => match.terms.slice(0, 4)).slice(0, 12).join("; ")
    };
  })
  .sort((first, second) => Number(second.year || 0) - Number(first.year || 0) || first.title.localeCompare(second.title));

const columns: Array<keyof EvidenceRow> = [
  "year",
  "role",
  "audit",
  "title",
  "source",
  "doi",
  "wosAccession",
  "pdfFile",
  "pageCount",
  "textLength",
  "strongestThemes",
  "matchedTerms"
];

fs.mkdirSync(outputsDir, { recursive: true });
fs.writeFileSync(csvPath, `${[columns, ...rows.map((row) => columns.map((column) => row[column]))].map((row) => row.map(csvCell).join(",")).join("\n")}\n`, "utf8");

const themeSections = themes.flatMap((theme) => {
  const ranked = indexedRecords
    .map((record) => {
      const match = themeMatches(record).find((item) => item.theme.id === theme.id);
      return { record, score: match?.score || 0, terms: match?.terms || [] };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);

  return [
    `### ${theme.label}`,
    "",
    ranked.length
      ? "| Score | Year | Title | Matched signals |\n|---:|---:|---|---|\n" +
        ranked
          .map(
            (item) =>
              `| ${item.score} | ${item.record.year || "n.d."} | ${mdCell(item.record.title)} | ${mdCell(item.terms.slice(0, 8).join("; "))} |`
          )
          .join("\n")
      : "No indexed PDF currently has this signal.",
    ""
  ];
});

const missingLines = queue.items.map(
  (item, index) =>
    `| ${index + 1} | ${item.year || "n.d."} | ${mdCell(item.accessPriority || "Manual route")} | ${mdCell(item.title)} | ${mdCell(item.nextStep || "")} |`
);

const markdownLines = [
  "# AI Prof. Chai Evidence Pack",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "This pack summarizes the local evidence layer without reproducing full article text. It is meant to help AI Prof. Chai cite which saved PDFs support a question and which target PDFs are still missing.",
  "",
  "## Corpus Coverage",
  "",
  `- WoS records imported: ${profile.summary.total}`,
  `- Target first/corresponding-author records: ${profile.summary.firstOrCorresponding}`,
  `- Saved target PDFs: ${profile.summary.pdfSaved}`,
  `- Indexed saved PDFs: ${indexedRecords.length}`,
  `- Missing target PDFs: ${profile.summary.pdfNeeded}`,
  `- Evidence CSV: \`${path.relative(projectRoot, csvPath)}\``,
  "",
  "## Theme Evidence Index",
  "",
  ...themeSections,
  "## Indexed PDF Inventory",
  "",
  "| Year | Role | Audit | Pages | Text chars | Title |",
  "|---:|---|---|---:|---:|---|",
  ...rows.map((row) => `| ${row.year || "n.d."} | ${row.role} | ${row.audit} | ${row.pageCount} | ${row.textLength} | ${mdCell(row.title)} |`),
  "",
  "## Missing Target PDFs",
  "",
  "| # | Year | Priority | Title | Next step |",
  "|---:|---:|---|---|---|",
  ...missingLines,
  "",
  "## Suggested AI Prof. Chai Questions",
  "",
  "- Which saved PDFs support Chai's AI education research line?",
  "- How does the corpus connect TPACK/STEM-TPACK to later AI education work?",
  "- What is the evidence for an epistemic-beliefs and knowledge-building trajectory?",
  "- Which conclusions should remain tentative because 15 target PDFs are still missing?",
  ""
];

fs.writeFileSync(markdownPath, `${markdownLines.join("\n")}\n`, "utf8");

console.log(`Evidence records: ${rows.length}`);
console.log(markdownPath);
console.log(csvPath);

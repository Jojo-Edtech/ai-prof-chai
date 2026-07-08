import fs from "node:fs";
import path from "node:path";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";

function targetRecords(profile: CorpusProfile) {
  return profile.records.filter((record) => record.isFirstAuthor || record.isCorrespondingAuthor);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function role(record: PublicationRecord) {
  if (record.isFirstAuthor && record.isCorrespondingAuthor) return "first_and_corresponding";
  if (record.isFirstAuthor) return "first_author";
  return "corresponding_author";
}

function pdfPath(record: PublicationRecord) {
  return record.pdfFile ? `data/pdfs/${record.pdfFile}` : "";
}

function firstAuthorEvidence(record: PublicationRecord) {
  return record.fullAuthors[0] || record.authors[0] || "";
}

function trimEvidence(value = "") {
  return value.replace(/\s+/g, " ").trim().slice(0, 320);
}

function writeCsv(profile: CorpusProfile, outputPath: string) {
  const rows = [
    [
      "role",
      "download_status",
      "pdf_path",
      "year",
      "title",
      "source",
      "doi",
      "doi_url",
      "open_access",
      "oa_url",
      "wos_accession",
      "first_author_evidence",
      "corresponding_author_evidence",
      "source_file"
    ],
    ...targetRecords(profile).map((record) => [
      role(record),
      record.downloadStatus,
      pdfPath(record),
      record.year || "",
      record.title,
      record.source || "",
      record.doi || "",
      record.doiUrl || "",
      record.openAccess || "",
      record.oaUrl || "",
      record.wosAccession || "",
      firstAuthorEvidence(record),
      trimEvidence(record.correspondingAddress),
      record.sourceFile
    ])
  ];
  fs.writeFileSync(outputPath, `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`, "utf8");
}

function writeMarkdown(profile: CorpusProfile, outputPath: string) {
  const lines = [
    "# AI Prof. Chai Target Publication List",
    "",
    `Generated: ${profile.generatedAt}`,
    "",
    `Total WoS records: ${profile.summary.total}`,
    `First author: ${profile.summary.firstAuthor}`,
    `Corresponding author: ${profile.summary.correspondingAuthor}`,
    `Target records: ${profile.summary.firstOrCorresponding}`,
    `PDF saved: ${profile.summary.pdfSaved}`,
    `PDF still needed: ${profile.summary.pdfNeeded}`,
    "",
    "## Download Queue",
    ""
  ];

  const targets = targetRecords(profile);
  if (!targets.length) {
    lines.push("No first-author or corresponding-author records are available yet.");
  } else {
    targets.forEach((record, index) => {
      lines.push(
        `### ${index + 1}. ${record.title}`,
        "",
        `- Role: ${role(record)}`,
        `- Year: ${record.year || "n.d."}`,
        `- Source: ${record.source || "unknown"}`,
        `- DOI: ${record.doi || "not available"}`,
        `- DOI URL: ${record.doiUrl || "not available"}`,
        `- Open access: ${record.openAccess || "not marked"}`,
        `- OA URL: ${record.oaUrl || "not available"}`,
        `- Download status: ${record.downloadStatus}`,
        `- Expected PDF path: ${pdfPath(record) || "not generated"}`,
        `- First author evidence: ${firstAuthorEvidence(record) || "not available"}`,
        `- Corresponding author evidence: ${trimEvidence(record.correspondingAddress) || "not available"}`,
        ""
      );
    });
  }

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

export function writeTargetOutputs(profile: CorpusProfile, projectRoot: string) {
  const processedDir = path.join(projectRoot, "data", "processed");
  fs.mkdirSync(processedDir, { recursive: true });
  const csvPath = path.join(processedDir, "target-publications.csv");
  const markdownPath = path.join(processedDir, "target-publications.md");
  writeCsv(profile, csvPath);
  writeMarkdown(profile, markdownPath);
  return { csvPath, markdownPath, count: targetRecords(profile).length };
}

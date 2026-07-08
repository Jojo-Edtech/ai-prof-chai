import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";

type OpenAlexAuthor = {
  id: string;
  display_name: string;
};

type OpenAlexAuthorship = {
  author_position?: "first" | "middle" | "last";
  is_corresponding?: boolean;
  author: OpenAlexAuthor;
};

type OpenAlexWork = {
  id: string;
  doi?: string;
  title?: string;
  publication_year?: number;
  type?: string;
  primary_location?: {
    source?: {
      display_name?: string;
    };
  };
  authorships?: OpenAlexAuthorship[];
  concepts?: Array<{ display_name: string; score: number }>;
  open_access?: {
    is_oa?: boolean;
    oa_status?: string;
    oa_url?: string;
  };
  abstract_inverted_index?: Record<string, number[]>;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetAuthorId = "https://openalex.org/A5035167001";
const shortAuthorId = targetAuthorId.split("/").pop() || "A5035167001";
const outputPath = path.join(projectRoot, "data", "processed", "openalex-chai-publications.json");
const markdownPath = path.join(projectRoot, "data", "processed", "openalex-target-publications.md");
const csvPath = path.join(projectRoot, "data", "processed", "openalex-target-publications.csv");
const pdfDir = path.join(projectRoot, "data", "pdfs");

function abstractFromInvertedIndex(index?: Record<string, number[]>) {
  if (!index) return "";
  const words: Array<{ word: string; position: number }> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words.push({ word, position });
  }
  return words.sort((left, right) => left.position - right.position).map((item) => item.word).join(" ");
}

function cleanDoi(doi?: string) {
  return doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") || "";
}

function safePdfBasename(record: PublicationRecord) {
  const year = record.year || "n.d";
  const title = record.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 84);
  const suffix = record.doi ? record.doi.replace(/[^a-z0-9]+/gi, "_").slice(0, 48) : record.id.replace(/[^a-z0-9]+/gi, "_").slice(0, 48);
  return `${year}-${title || "untitled"}-${suffix}.pdf`;
}

function authorNames(work: OpenAlexWork) {
  return (work.authorships || []).map((authorship) => authorship.author.display_name).filter(Boolean);
}

function matchAuthorship(work: OpenAlexWork) {
  return (work.authorships || []).find((authorship) => authorship.author.id === targetAuthorId);
}

function toPublication(work: OpenAlexWork): PublicationRecord {
  const match = matchAuthorship(work);
  const doi = cleanDoi(work.doi);
  const isFirstAuthor = match?.author_position === "first";
  const isCorrespondingAuthor = Boolean(match?.is_corresponding);
  const record: PublicationRecord = {
    id: work.id,
    title: work.title || "Untitled OpenAlex record",
    year: work.publication_year ? String(work.publication_year) : undefined,
    source: work.primary_location?.source?.display_name,
    documentType: work.type,
    doi,
    doiUrl: work.doi || (doi ? `https://doi.org/${doi}` : ""),
    authors: authorNames(work),
    fullAuthors: authorNames(work),
    keywords: (work.concepts || []).filter((concept) => concept.score >= 0.25).slice(0, 12).map((concept) => concept.display_name),
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
    correspondingAddress: isCorrespondingAuthor ? "OpenAlex marks Ching Sing Chai as corresponding author." : "",
    emails: [],
    openAccess: work.open_access?.is_oa ? work.open_access.oa_status || "open" : "",
    oaUrl: work.open_access?.oa_url || "",
    isFirstAuthor,
    isCorrespondingAuthor,
    downloadStatus: isFirstAuthor || isCorrespondingAuthor ? "pdf-needed" : "metadata-only",
    sourceFile: "openalex:A5035167001"
  };

  return {
    ...record,
    pdfFile: record.downloadStatus === "pdf-needed" ? safePdfBasename(record) : undefined
  };
}

function withPdfStatus(record: PublicationRecord): PublicationRecord {
  if (!record.pdfFile) return record;
  return fs.existsSync(path.join(pdfDir, record.pdfFile))
    ? { ...record, downloadStatus: "pdf-saved" }
    : record;
}

function role(record: PublicationRecord) {
  if (record.isFirstAuthor && record.isCorrespondingAuthor) return "first_and_corresponding";
  if (record.isFirstAuthor) return "first_author";
  return "corresponding_author";
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function firstAuthorEvidence(record: PublicationRecord) {
  return record.fullAuthors[0] || record.authors[0] || "";
}

function trimEvidence(value = "") {
  return value.replace(/\s+/g, " ").trim().slice(0, 320);
}

function writeTargets(profile: CorpusProfile) {
  const targets = profile.records.filter((record) => record.isFirstAuthor || record.isCorrespondingAuthor);
  const csvRows = [
    [
      "role",
      "download_status",
      "oa_status",
      "oa_url",
      "pdf_path",
      "year",
      "title",
      "source",
      "doi",
      "doi_url",
      "first_author_evidence",
      "corresponding_author_evidence",
      "openalex_id"
    ],
    ...targets.map((record) => [
      role(record),
      record.downloadStatus,
      record.openAccess || "",
      record.oaUrl || "",
      record.pdfFile ? `data/pdfs/${record.pdfFile}` : "",
      record.year || "",
      record.title,
      record.source || "",
      record.doi || "",
      record.doiUrl || "",
      firstAuthorEvidence(record),
      trimEvidence(record.correspondingAddress),
      record.id
    ])
  ];
  fs.writeFileSync(csvPath, `${csvRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`, "utf8");

  const lines = [
    "# OpenAlex Candidate Target Publication List",
    "",
    "This is a public-source pre-index. Use Web of Science exports as the final authority when available.",
    "",
    `Generated: ${profile.generatedAt}`,
    `Total OpenAlex works: ${profile.summary.total}`,
    `First author: ${profile.summary.firstAuthor}`,
    `Corresponding author: ${profile.summary.correspondingAuthor}`,
    `Target records: ${profile.summary.firstOrCorresponding}`,
    `Open-access marked records: ${profile.summary.openAccess}`,
    "",
    "## Candidate Download Queue",
    ""
  ];

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
      `- Expected PDF path: ${record.pdfFile ? `data/pdfs/${record.pdfFile}` : "not generated"}`,
      `- First author evidence: ${firstAuthorEvidence(record) || "not available"}`,
      `- Corresponding author evidence: ${trimEvidence(record.correspondingAddress) || "not available"}`,
      ""
    );
  });

  fs.writeFileSync(markdownPath, `${lines.join("\n")}\n`, "utf8");
}

async function fetchWorks() {
  const works: OpenAlexWork[] = [];
  let cursor = "*";

  for (;;) {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("filter", `author.id:${shortAuthorId}`);
    url.searchParams.set("per-page", "200");
    url.searchParams.set("cursor", cursor);
    url.searchParams.set("sort", "publication_year:desc");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`OpenAlex HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const payload = (await response.json()) as { results: OpenAlexWork[]; meta: { next_cursor?: string } };
    works.push(...payload.results);
    cursor = payload.meta.next_cursor || "";
    if (!cursor || !payload.results.length) break;
  }

  return works;
}

const records = (await fetchWorks()).map(toPublication).map(withPdfStatus);
const profile: CorpusProfile = {
  generatedAt: new Date().toISOString(),
  sourceFiles: ["openalex:A5035167001"],
  professor: {
    displayName: "Chai Ching Sing",
    assistantName: "AI Prof. Chai",
    aliases: ["Chai CS", "Chai, Ching Sing", "Ching Sing Chai", "Chai, C. S."]
  },
  summary: {
    total: records.length,
    firstAuthor: records.filter((record) => record.isFirstAuthor).length,
    correspondingAuthor: records.filter((record) => record.isCorrespondingAuthor).length,
    firstOrCorresponding: records.filter((record) => record.isFirstAuthor || record.isCorrespondingAuthor).length,
    openAccess: records.filter((record) => record.openAccess).length,
    pdfSaved: records.filter((record) => record.downloadStatus === "pdf-saved").length,
    pdfNeeded: records.filter((record) => record.downloadStatus === "pdf-needed").length
  },
  records
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
writeTargets(profile);

console.log(`Fetched ${profile.summary.total} OpenAlex works.`);
console.log(`Candidate first/corresponding records: ${profile.summary.firstOrCorresponding}`);
console.log(outputPath);
console.log(markdownPath);
console.log(csvPath);

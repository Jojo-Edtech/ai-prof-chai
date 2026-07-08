import path from "node:path";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";

type RawRecord = Record<string, string[]>;

const chaiPatterns = [
  /chai,\s*ching[-\s]*sing/i,
  /chai\s+ching[-\s]*sing/i,
  /chai,\s*ching\s*shing/i,
  /chai,\s*ching\b/i,
  /chai,\s*c\.?\s*s\.?/i,
  /chai\s+c\s*s/i,
  /sing,\s*chai\s*ching/i,
  /sing,\s*c\.?\s*c\.?/i
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasChaiName(value = "") {
  const clean = normalize(value);
  return (
    chaiPatterns.some((pattern) => pattern.test(value)) ||
    (/\bchai\b/.test(clean) && /\bching\b/.test(clean) && /\bsing\b/.test(clean)) ||
    (/\bchai\b/.test(clean) && /\bc\b/.test(clean) && /\bs\b/.test(clean))
  );
}

function compact(values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
}

function field(record: RawRecord, tag: string) {
  return compact(record[tag] || []);
}

function fields(record: RawRecord, tags: string[]) {
  return tags.flatMap((tag) => field(record, tag));
}

function one(record: RawRecord, tags: string[]) {
  return fields(record, tags)[0] || "";
}

function splitKeywords(record: RawRecord) {
  return fields(record, ["DE", "AUTHOR KEYWORDS", "KEYWORDS"])
    .concat(fields(record, ["ID", "KEYWORDS PLUS"]))
    .flatMap((value) => value.split(/;|,/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitPeople(values: string[]) {
  return values
    .flatMap((value) => value.split(/;(?=\s*\S)|\|/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function doiUrl(doi: string) {
  return doi ? `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim()}` : "";
}

function cleanTitle(title: string) {
  return title.replace(/^[\s`]+/, "").replace(/\s+/g, " ").trim();
}

function safePdfBasename(record: PublicationRecord) {
  const year = record.year || "n.d";
  const title = record.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 84);
  const suffix = record.doi ? record.doi.replace(/[^a-z0-9]+/gi, "_").slice(0, 48) : record.id.replace(/[^a-z0-9]+/gi, "_").slice(0, 48);
  return `${year}-${title || "untitled"}-${suffix}.pdf`;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function recordsFromCsv(text: string): RawRecord[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = delimiter === "\t" ? lines[0].split("\t") : parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = delimiter === "\t" ? line.split("\t") : parseCsvLine(line);
    const record: RawRecord = {};
    headers.forEach((header, index) => {
      const key = header.replace(/^\uFEFF/, "").trim().toUpperCase();
      const value = values[index]?.trim();
      if (value) record[key] = [value];
    });
    return record;
  });
}

function recordsFromTaggedText(text: string): RawRecord[] {
  const records: RawRecord[] = [];
  let current: RawRecord = {};
  let activeTag = "";

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("ER")) {
      if (Object.keys(current).length) records.push(current);
      current = {};
      activeTag = "";
      continue;
    }

    const tag = line.slice(0, 2).trim();
    const value = line.slice(3).trim();
    if (/^[A-Z0-9]{2}$/.test(tag) && value) {
      activeTag = tag;
      current[activeTag] = current[activeTag] || [];
      current[activeTag].push(value);
    } else if (activeTag && line.trim()) {
      const list = current[activeTag];
      list[list.length - 1] = `${list[list.length - 1]} ${line.trim()}`;
    }
  }

  if (Object.keys(current).length) records.push(current);
  return records;
}

export function parseWosRecords(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.replace(/^\uFEFF/, "") || "";
  const looksDelimited = firstLine.includes("\t") || firstLine.includes(",");
  const looksTagged = !looksDelimited && /^FN\s|^VR\s|^PT\s/m.test(text);
  return looksTagged ? recordsFromTaggedText(text) : recordsFromCsv(text);
}

export function toPublication(raw: RawRecord, sourceFile: string, index: number): PublicationRecord {
  const authors = splitPeople(fields(raw, ["AU", "AUTHORS"]));
  const fullAuthors = splitPeople(fields(raw, ["AF", "AUTHOR FULL NAMES", "FULL AUTHOR NAMES"]));
  const firstAuthor = fullAuthors[0] || authors[0] || "";
  const correspondingAddress = fields(raw, [
    "RP",
    "REPRINT ADDRESSES",
    "REPRINT ADDRESS",
    "CORRESPONDING ADDRESS",
    "CORRESPONDING AUTHOR",
    "CORRESPONDING AUTHOR ADDRESS"
  ]).join(" ");
  const title = cleanTitle(one(raw, ["TI", "ARTICLE TITLE", "TITLE"]) || "Untitled record");
  const wosAccession = one(raw, ["UT", "ACCESSION NUMBER", "WOS ACCESSION NUMBER"]);
  const doi = one(raw, ["DI", "DOI"]);
  const id = wosAccession || doi || `${path.basename(sourceFile)}-${index + 1}`;
  const openAccess = one(raw, ["OA", "OPEN ACCESS DESIGNATIONS", "OPEN ACCESS"]);
  const isFirstAuthor = hasChaiName(firstAuthor);
  const isCorrespondingAuthor = hasChaiName(correspondingAddress);

  const publication: PublicationRecord = {
    id,
    title,
    year: one(raw, ["PY", "PUBLICATION YEAR", "YEAR PUBLISHED"]),
    source: one(raw, ["SO", "SOURCE TITLE", "PUBLICATION NAME", "JOURNAL"]),
    documentType: one(raw, ["DT", "DOCUMENT TYPE"]),
    doi,
    doiUrl: doiUrl(doi),
    wosAccession,
    authors,
    fullAuthors,
    keywords: splitKeywords(raw),
    abstract: one(raw, ["AB", "ABSTRACT"]),
    correspondingAddress,
    emails: fields(raw, ["EM", "EMAIL ADDRESSES", "EMAIL"]).flatMap((value) => value.split(/;|,/)).map((value) => value.trim()).filter(Boolean),
    openAccess,
    oaUrl: "",
    isFirstAuthor,
    isCorrespondingAuthor,
    downloadStatus: isFirstAuthor || isCorrespondingAuthor ? "pdf-needed" : "metadata-only",
    sourceFile
  };

  return {
    ...publication,
    pdfFile: publication.downloadStatus === "pdf-needed" ? safePdfBasename(publication) : undefined
  };
}

export function buildCorpusProfile(records: PublicationRecord[], sourceFiles: string[]): CorpusProfile {
  const unique = new Map<string, PublicationRecord>();
  for (const record of records) {
    const key = record.wosAccession || record.doi || `${record.title}-${record.year}`;
    if (!unique.has(key)) unique.set(key, record);
  }

  const deduped = [...unique.values()].sort((left, right) => Number(right.year || 0) - Number(left.year || 0));
  return {
    generatedAt: new Date().toISOString(),
    sourceFiles,
    professor: {
      displayName: "Chai Ching Sing",
      assistantName: "AI Prof. Chai",
      aliases: ["Chai CS", "Chai, Ching Sing", "Chai, C. S."]
    },
    summary: {
      total: deduped.length,
      firstAuthor: deduped.filter((record) => record.isFirstAuthor).length,
      correspondingAuthor: deduped.filter((record) => record.isCorrespondingAuthor).length,
      firstOrCorresponding: deduped.filter((record) => record.isFirstAuthor || record.isCorrespondingAuthor).length,
      openAccess: deduped.filter((record) => record.openAccess).length,
      pdfSaved: deduped.filter((record) => record.downloadStatus === "pdf-saved").length,
      pdfNeeded: deduped.filter((record) => record.downloadStatus === "pdf-needed").length
    },
    records: deduped
  };
}

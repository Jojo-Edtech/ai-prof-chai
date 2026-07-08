import fs from "node:fs";
import path from "node:path";
import type { FullTextIndex, FullTextRecord, FullTextStatus } from "../src/shared/types";

export type FullTextHit = {
  record: FullTextRecord;
  evidenceId: string;
  chunkIndex: number;
  chunkStart: number;
  chunkEnd: number;
  score: number;
  excerpt: string;
};

type FullTextEvidenceChunk = {
  record: FullTextRecord;
  evidenceId: string;
  chunkIndex: number;
  start: number;
  end: number;
  text: string;
};

export const evidenceChunkChars = 900;
export const evidenceChunkOverlap = 180;
const minEvidenceChunkChars = 220;

export function fullTextIndexPath(projectRoot: string) {
  return path.join(projectRoot, "data", "processed", "chai-fulltext-index.json");
}

export function loadFullTextIndex(projectRoot: string) {
  try {
    return JSON.parse(fs.readFileSync(fullTextIndexPath(projectRoot), "utf8")) as FullTextIndex;
  } catch {
    return null;
  }
}

function tokens(value: string) {
  const lower = value.toLowerCase();
  const stop = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "what", "have", "about"]);
  const base = lower.split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length > 1 && !stop.has(token));
  const expanded: string[] = [];
  const expansions: Array<[RegExp, string[]]> = [
    [/人工智能|\bai\b/i, ["artificial", "intelligence", "ai"]],
    [/学习动机|动机|motivation/i, ["motivation", "motivational"]],
    [/意向|意愿|intention/i, ["intention", "intentions", "behavioral"]],
    [/教师|老师|teacher/i, ["teacher", "teachers", "teaching"]],
    [/学生|student/i, ["student", "students"]],
    [/证据|发现|findings?/i, ["finding", "findings", "results"]],
    [/自我决定|self.?determination/i, ["self", "determination", "autonomy", "competence", "relatedness"]],
    [/tpack|技术教学法|整合/i, ["tpack", "technological", "pedagogical", "content"]]
  ];
  for (const [pattern, words] of expansions) {
    if (pattern.test(value)) expanded.push(...words);
  }
  return [...new Set([...base, ...expanded])];
}

function normalize(value = "") {
  return value.replace(/([A-Za-z])-\s+([A-Za-z])/g, "$1$2").replace(/\s+/g, " ").trim();
}

function isReadableBoundary(char = "") {
  return /[\s,.;:!?，。；：！？]/.test(char);
}

function readableStart(text: string, position: number) {
  if (position <= 0) return 0;
  const searchEnd = Math.min(text.length, position + 80);
  for (let index = position; index < searchEnd; index += 1) {
    if (isReadableBoundary(text[index])) return Math.min(text.length, index + 1);
  }
  return position;
}

function readableEnd(text: string, position: number) {
  if (position >= text.length) return text.length;
  const searchStart = Math.max(0, position - 80);
  for (let index = position; index > searchStart; index -= 1) {
    if (isReadableBoundary(text[index - 1])) return index;
  }
  return position;
}

function trimFragment(text: string) {
  return text.replace(/^[\s,.;:!?，。；：！？]+/, "").replace(/[\s,.;:!?，。；：！？]+$/, "").trim();
}

function evidenceBaseId(record: FullTextRecord) {
  return record.id || record.pdfFile.replace(/\.pdf$/i, "");
}

function buildEvidenceChunks(record: FullTextRecord): FullTextEvidenceChunk[] {
  if (record.status !== "indexed" || !record.text) return [];
  const clean = normalize(record.text);
  if (!clean) return [];
  const chunks: FullTextEvidenceChunk[] = [];
  const step = evidenceChunkChars - evidenceChunkOverlap;
  for (let start = 0; start < clean.length; start += step) {
    const rawEnd = Math.min(clean.length, start + evidenceChunkChars);
    const adjustedStart = readableStart(clean, start);
    const adjustedEnd = Math.max(adjustedStart, readableEnd(clean, rawEnd));
    if (adjustedEnd - adjustedStart < minEvidenceChunkChars && chunks.length) break;
    const text = trimFragment(clean.slice(adjustedStart, adjustedEnd));
    if (!text && chunks.length) break;
    const chunkIndex = chunks.length;
    chunks.push({
      record,
      evidenceId: `${evidenceBaseId(record)}#E${String(chunkIndex + 1).padStart(3, "0")}`,
      chunkIndex,
      start: adjustedStart,
      end: adjustedEnd,
      text
    });
    if (rawEnd >= clean.length) break;
  }
  return chunks;
}

export function countEvidenceChunks(index: FullTextIndex | null | undefined) {
  if (!index?.records?.length) return 0;
  return index.records.reduce((total, record) => total + buildEvidenceChunks(record).length, 0);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function excerpt(text: string, queryTokens: string[]) {
  const clean = normalize(text);
  if (!clean) return "";
  const lower = clean.toLowerCase();
  const positions = queryTokens.map((token) => lower.indexOf(token)).filter((position) => position >= 0);
  const center = positions.length ? Math.min(...positions) : 0;
  const start = readableStart(clean, Math.max(0, center - 260));
  const end = readableEnd(clean, Math.min(clean.length, center + 640));
  const prefix = start > 0 ? "... " : "";
  const suffix = end < clean.length ? " ..." : "";
  return `${prefix}${trimFragment(clean.slice(start, end))}${suffix}`;
}

export function retrieveFullText(index: FullTextIndex | null | undefined, question: string, limit = 4): FullTextHit[] {
  if (!index?.records?.length) return [];
  const queryTokens = tokens(question || "AI education teacher learning");
  const hits = index.records
    .filter((record) => record.status === "indexed" && record.text)
    .flatMap((record) => {
      const title = record.title.toLowerCase();
      const source = `${record.source || ""} ${record.year || ""}`.toLowerCase();
      return buildEvidenceChunks(record).map((chunk) => {
        const text = chunk.text.toLowerCase();
        let score = 0;
        for (const token of queryTokens) {
          if (title.includes(token)) score += 8;
          if (source.includes(token)) score += 2;
          const matches = text.match(new RegExp(escapeRegExp(token), "g"))?.length || 0;
          score += Math.min(matches * 3, 18);
        }
        return {
          record: chunk.record,
          evidenceId: chunk.evidenceId,
          chunkIndex: chunk.chunkIndex,
          chunkStart: chunk.start,
          chunkEnd: chunk.end,
          score,
          excerpt: excerpt(chunk.text, queryTokens)
        };
      });
    })
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score);

  const selected: FullTextHit[] = [];
  const perRecord = new Map<string, number>();
  for (const hit of hits) {
    const key = evidenceBaseId(hit.record);
    const used = perRecord.get(key) || 0;
    if (used >= 2) continue;
    selected.push(hit);
    perRecord.set(key, used + 1);
    if (selected.length >= limit) return selected;
  }
  for (const hit of hits) {
    if (selected.some((selectedHit) => selectedHit.evidenceId === hit.evidenceId)) continue;
    selected.push(hit);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function fullTextContext(hits: FullTextHit[]) {
  if (!hits.length) return "当前问题没有命中已保存 PDF evidence chunk。";
  return hits
    .map((hit, index) =>
      [
        `[Evidence ${index + 1}] ${hit.record.title}`,
        `Evidence ID: ${hit.evidenceId}`,
        `Year: ${hit.record.year || "unknown"}`,
        `Source: ${hit.record.source || "unknown"}`,
        `DOI: ${hit.record.doi || "n/a"}`,
        `Pages indexed: ${hit.record.pageCount}; chunk: ${hit.chunkIndex + 1}; chars: ${hit.chunkStart}-${hit.chunkEnd}`,
        `Excerpt: ${hit.excerpt || "n/a"}`
      ].join("\n")
    )
    .join("\n\n");
}

export function fullTextStatus(index: FullTextIndex | null | undefined): FullTextStatus {
  if (!index) {
    return {
      summary: {
        available: false,
        targetPdfSaved: 0,
        indexed: 0,
        failed: 0,
        totalTextLength: 0,
        maxTextCharsPerPdf: 0,
        evidenceChunks: 0,
        evidenceChunkChars,
        evidenceChunkOverlap
      },
      records: []
    };
  }

  return {
    generatedAt: index.generatedAt,
    sourceGeneratedAt: index.sourceGeneratedAt,
    summary: {
      ...index.summary,
      evidenceChunks: index.summary.evidenceChunks ?? countEvidenceChunks(index),
      evidenceChunkChars: index.summary.evidenceChunkChars ?? evidenceChunkChars,
      evidenceChunkOverlap: index.summary.evidenceChunkOverlap ?? evidenceChunkOverlap,
      available: true
    },
    records: index.records.map(({ text, ...record }) => record)
  };
}

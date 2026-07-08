import fs from "node:fs";
import path from "node:path";
import type { MissingPdfProgressStatus, MissingPdfQueue, MissingPdfQueueItem } from "../src/shared/types";

type MissingPdfProgressFile = Record<string, { status: MissingPdfProgressStatus; updatedAt: string }>;

const progressStatuses: MissingPdfProgressStatus[] = ["todo", "opened", "requested", "blocked"];

function queuePath(projectRoot: string) {
  return path.join(projectRoot, "data", "processed", "missing-pdf-queue.csv");
}

function progressPath(projectRoot: string) {
  return path.join(projectRoot, "data", "processed", "missing-pdf-progress.json");
}

function progressKey(item: { doi?: string; wosAccession?: string }) {
  return item.doi || item.wosAccession || "";
}

function emptyProgressCounts() {
  return Object.fromEntries(progressStatuses.map((status) => [status, 0])) as Record<MissingPdfProgressStatus, number>;
}

function readProgress(projectRoot: string): MissingPdfProgressFile {
  try {
    return JSON.parse(fs.readFileSync(progressPath(projectRoot), "utf8")) as MissingPdfProgressFile;
  } catch {
    return {};
  }
}

function writeProgress(projectRoot: string, progress: MissingPdfProgressFile) {
  const filePath = progressPath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
}

export function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"' && current === "") {
      quoted = true;
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

function routeLinks(value: string) {
  return value
    .split(/\s+\|\s+/)
    .map((part) => {
      const match = part.match(/^([^:]+):\s*(https?:\/\/\S+)$/);
      return match ? { label: match[1].trim(), url: match[2].trim() } : null;
    })
    .filter((link): link is { label: string; url: string } => Boolean(link));
}

function readRows(filePath: string, progress: MissingPdfProgressFile): MissingPdfQueueItem[] {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.replace(/^\uFEFF/, ""));

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    const manualRoutes = row.manual_routes || "";
    const item = {
      title: row.title || "Untitled record",
      year: row.year || undefined,
      source: row.source || undefined,
      doi: row.doi || undefined,
      wosAccession: row.wos_accession || undefined,
      expectedPdfFile: row.expected_pdf_file || undefined,
      accessPriority: row.access_priority || undefined,
      actionGroup: row.action_group || undefined,
      nextStep: row.next_step || undefined,
      manualRoutes,
      note: row.note || "",
      links: routeLinks(manualRoutes),
      progress: { status: "todo" as MissingPdfProgressStatus, updatedAt: undefined as string | undefined }
    };
    const savedProgress = progress[progressKey(item)];
    if (savedProgress && progressStatuses.includes(savedProgress.status)) {
      item.progress = { status: savedProgress.status, updatedAt: savedProgress.updatedAt };
    }
    return item;
  });
}

export function loadMissingPdfQueue(projectRoot: string): MissingPdfQueue {
  const filePath = queuePath(projectRoot);
  if (!fs.existsSync(filePath)) {
    return {
      sourcePath: path.relative(projectRoot, filePath),
      summary: { available: false, count: 0, progress: emptyProgressCounts() },
      items: []
    };
  }

  const items = readRows(filePath, readProgress(projectRoot));
  const counts = emptyProgressCounts();
  for (const item of items) counts[item.progress.status] += 1;

  return {
    generatedAt: fs.statSync(filePath).mtime.toISOString(),
    sourcePath: path.relative(projectRoot, filePath),
    summary: { available: true, count: items.length, progress: counts },
    items
  };
}

export function updateMissingPdfProgress(projectRoot: string, key: string, status: MissingPdfProgressStatus) {
  if (!progressStatuses.includes(status)) throw new Error("Unsupported missing PDF progress status.");
  const queue = loadMissingPdfQueue(projectRoot);
  const item = queue.items.find((entry) => progressKey(entry) === key);
  if (!item) throw new Error("Missing PDF queue item not found.");

  const progress = readProgress(projectRoot);
  progress[key] = { status, updatedAt: new Date().toISOString() };
  writeProgress(projectRoot, progress);
  return loadMissingPdfQueue(projectRoot);
}

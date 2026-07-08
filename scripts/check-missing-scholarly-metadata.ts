import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadMissingPdfQueue } from "../server/missing-pdfs";
import type { CorpusProfile, MissingPdfQueueItem, PublicationRecord } from "../src/shared/types";

type Candidate = {
  source: string;
  url: string;
  title?: string;
  doi?: string;
};

type ByteCheck = {
  url: string;
  ok: boolean;
  status: number;
  contentType: string;
  byteLength: number;
  startsWithPdf: boolean;
  detail: string;
  verification?: PdfVerification;
  bytes?: Buffer;
};

type PdfVerification = {
  ok: boolean;
  score: number;
  titleTokenRatio: number;
  authorTokenRatio: number;
  doiHit: boolean;
  yearHit: boolean;
  textLength: number;
  detail: string;
};

type CheckResult = {
  title: string;
  year?: string;
  doi?: string;
  wosAccession?: string;
  expectedPdfFile?: string;
  candidates: Array<Candidate & { byteCheck?: ByteCheck }>;
  errors: string[];
  savedFile?: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const today = new Date().toISOString().slice(0, 10);
const pdfDir = path.join(projectRoot, "data", "pdfs");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const helperPath = path.join(projectRoot, "scripts", "extract-pdf-text.py");
const bundledPython = "/Users/zhouxinxin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const python = process.env.AI_PROF_CHAI_PYTHON || (fs.existsSync(bundledPython) ? bundledPython : "python3");
const shouldSave = process.argv.includes("--save");
const userAgent = "ai-prof-chai/0.1 (mailto:ai.prof.chai@example.org)";
const metadataTimeoutMs = Number(process.env.AI_PROF_CHAI_METADATA_TIMEOUT_MS || 12000);
const byteTimeoutMs = Number(process.env.AI_PROF_CHAI_BYTE_TIMEOUT_MS || 15000);
const doiFilter = process.env.AI_PROF_CHAI_METADATA_DOI_FILTER || "";
const itemLimit = Number(process.env.AI_PROF_CHAI_METADATA_LIMIT || 0);
const targetedRun = Boolean(doiFilter || itemLimit > 0);
const targetedLabel = doiFilter
  ? `targeted-${doiFilter.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 64)}-`
  : itemLimit > 0
    ? `targeted-limit-${itemLimit}-`
    : "";
const dataPath = path.join(
  projectRoot,
  "data",
  "wos-downloads",
  `scholarly-metadata-missing-pdfs-${targetedLabel}${today}.json`
);
const markdownPath = path.join(
  projectRoot,
  "outputs",
  targetedRun
    ? `missing-pdf-scholarly-metadata-${targetedLabel.replace(/-$/, "") || "targeted"}.md`
    : "missing-pdf-scholarly-metadata-recheck.md"
);

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchText(url: string, accept = "application/json") {
  const timeout = timeoutSignal(metadataTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: accept,
        "User-Agent": userAgent
      },
      redirect: "follow",
      signal: timeout.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    return text;
  } finally {
    timeout.clear();
  }
}

async function fetchJson<T>(url: string) {
  return JSON.parse(await fetchText(url)) as T;
}

function addCandidate(candidates: Candidate[], candidate: Candidate) {
  if (!candidate.url || candidates.some((item) => item.url === candidate.url)) return;
  candidates.push(candidate);
}

function doiFromUrl(url: string) {
  const doiOrgMatch = url.match(/https?:\/\/(?:dx\.)?doi\.org\/([^?#\s]+)/i);
  if (doiOrgMatch?.[1]) return decodeURIComponent(doiOrgMatch[1]);
  const doiPathMatch = url.match(/\/doi\/(10\.\d{4,9}\/[^?#\s]+)/i);
  return doiPathMatch?.[1] ? decodeURIComponent(doiPathMatch[1]) : "";
}

function doiFromManualRoutes(item: MissingPdfQueueItem) {
  for (const link of item.links || []) {
    const doi = doiFromUrl(link.url);
    if (doi) return doi;
  }
  return doiFromUrl(item.manualRoutes);
}

function withSupplementalDoi(item: MissingPdfQueueItem): MissingPdfQueueItem {
  return item.doi ? item : { ...item, doi: doiFromManualRoutes(item) || undefined };
}

function looksLikePotentialFile(url: string) {
  return (
    /\.pdf($|[?#])/i.test(url) ||
    /\/doi\/pdf\//i.test(url) ||
    /(?:repository\.nie\.edu\.sg|dr\.ntu\.edu\.sg)\/server\/api\/core\/bitstreams\/[^/]+\/content/i.test(url) ||
    /pdfCoverPage|download|bitstream|content\/article/i.test(url)
  );
}

async function checkBytes(url: string): Promise<ByteCheck> {
  const timeout = timeoutSignal(byteTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/pdf,text/html;q=0.8,*/*;q=0.5",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"
      },
      redirect: "follow",
      signal: timeout.signal
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";
    const startsWithPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    return {
      url,
      ok: response.ok,
      status: response.status,
      contentType,
      byteLength: bytes.length,
      startsWithPdf,
      detail: startsWithPdf ? "PDF bytes confirmed" : `not PDF; first bytes ${bytes.subarray(0, 20).toString("hex")}`,
      bytes: startsWithPdf ? bytes : undefined
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      contentType: "",
      byteLength: 0,
      startsWithPdf: false,
      detail: error instanceof Error ? error.message : "byte check failed"
    };
  } finally {
    timeout.clear();
  }
}

async function semanticScholarCandidates(item: MissingPdfQueueItem) {
  type SemanticScholarPaper = {
    title?: string;
    year?: number;
    url?: string;
    openAccessPdf?: { url?: string };
    externalIds?: { DOI?: string };
  };
  const candidates: Candidate[] = [];
  const fields = "title,year,url,openAccessPdf,isOpenAccess,externalIds";
  const url = item.doi
    ? `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(item.doi)}?fields=${fields}`
    : `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(item.title)}&limit=3&fields=${fields}`;
  const payload = await fetchJson<SemanticScholarPaper | { data?: SemanticScholarPaper[] }>(url);
  const papers: SemanticScholarPaper[] = "data" in payload ? payload.data || [] : [payload as SemanticScholarPaper];
  for (const paper of papers) {
    addCandidate(candidates, {
      source: "Semantic Scholar openAccessPdf",
      url: paper.openAccessPdf?.url || "",
      title: paper.title,
      doi: paper.externalIds?.DOI
    });
    addCandidate(candidates, {
      source: "Semantic Scholar page",
      url: paper.url || "",
      title: paper.title,
      doi: paper.externalIds?.DOI
    });
  }
  return candidates;
}

async function openAlexCandidates(item: MissingPdfQueueItem) {
  type OpenAlexLocation = { pdf_url?: string; landing_page_url?: string };
  type OpenAlexWork = {
    title?: string;
    publication_year?: number;
    open_access?: { oa_url?: string };
    primary_location?: OpenAlexLocation;
    locations?: OpenAlexLocation[];
  };
  const candidates: Candidate[] = [];
  const url = item.doi
    ? `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(item.doi.toLowerCase())}`
    : `https://api.openalex.org/works?search=${encodeURIComponent(item.title)}&per-page=3`;
  const payload = await fetchJson<OpenAlexWork | { results?: OpenAlexWork[] }>(url);
  const works: OpenAlexWork[] = "results" in payload ? payload.results || [] : [payload as OpenAlexWork];
  for (const work of works) {
    addCandidate(candidates, { source: "OpenAlex oa_url", url: work.open_access?.oa_url || "", title: work.title, doi: item.doi });
    addCandidate(candidates, { source: "OpenAlex primary pdf", url: work.primary_location?.pdf_url || "", title: work.title, doi: item.doi });
    addCandidate(candidates, { source: "OpenAlex primary landing", url: work.primary_location?.landing_page_url || "", title: work.title, doi: item.doi });
    for (const [index, location] of (work.locations || []).entries()) {
      addCandidate(candidates, { source: `OpenAlex location ${index + 1} pdf`, url: location.pdf_url || "", title: work.title, doi: item.doi });
      addCandidate(candidates, { source: `OpenAlex location ${index + 1} landing`, url: location.landing_page_url || "", title: work.title, doi: item.doi });
    }
  }
  return candidates;
}

async function crossrefCandidates(item: MissingPdfQueueItem) {
  type CrossrefLink = { URL?: string; "content-type"?: string };
  type CrossrefWork = { message?: { title?: string[]; link?: CrossrefLink[] } };
  if (!item.doi) return [];
  const payload = await fetchJson<CrossrefWork>(`https://api.crossref.org/works/${encodeURIComponent(item.doi)}`);
  return (payload.message?.link || [])
    .filter((link) => link.URL)
    .map((link, index) => ({
      source: `Crossref link ${index + 1}${link["content-type"] ? ` ${link["content-type"]}` : ""}`,
      url: link.URL || "",
      title: payload.message?.title?.[0],
      doi: item.doi
    }));
}

async function unpaywallCandidates(item: MissingPdfQueueItem) {
  type UnpaywallLocation = {
    endpoint_id?: string;
    host_type?: string;
    is_best?: boolean;
    license?: string;
    pmh_id?: string;
    repository_institution?: string;
    url?: string;
    url_for_landing_page?: string;
    url_for_pdf?: string;
    version?: string;
  };
  type UnpaywallWork = {
    doi?: string;
    title?: string;
    year?: number;
    best_oa_location?: UnpaywallLocation;
    oa_locations?: UnpaywallLocation[];
  };
  if (!item.doi) return [];
  const email = encodeURIComponent(process.env.UNPAYWALL_EMAIL || "ai.prof.chai@example.org");
  const payload = await fetchJson<UnpaywallWork>(`https://api.unpaywall.org/v2/${encodeURIComponent(item.doi)}?email=${email}`);
  const candidates: Candidate[] = [];
  const locations = [payload.best_oa_location, ...(payload.oa_locations || [])].filter(
    (location): location is UnpaywallLocation => Boolean(location)
  );
  for (const [index, location] of locations.entries()) {
    const label = location.is_best || location === payload.best_oa_location ? "best" : `location ${index + 1}`;
    const detail = [location.host_type, location.version, location.license, location.repository_institution].filter(Boolean).join(" ");
    addCandidate(candidates, {
      source: `Unpaywall ${label} pdf${detail ? ` ${detail}` : ""}`,
      url: location.url_for_pdf || "",
      title: payload.title,
      doi: payload.doi || item.doi
    });
    addCandidate(candidates, {
      source: `Unpaywall ${label} landing${detail ? ` ${detail}` : ""}`,
      url: location.url_for_landing_page || location.url || "",
      title: payload.title,
      doi: payload.doi || item.doi
    });
  }
  return candidates;
}

function metadataValue(metadata: Record<string, Array<{ value?: string }> | undefined>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key]?.[0]?.value;
    if (value) return value;
  }
  return "";
}

function nieSearchQueries(item: MissingPdfQueueItem) {
  const queries = new Set<string>();
  queries.add(item.title);
  if (item.doi) queries.add(item.doi);
  const distinctiveTokens = titleTokens(item.title).slice(0, 8).join(" ");
  if (distinctiveTokens) queries.add(`${distinctiveTokens} Chai`);
  if (item.title.length > 90) queries.add(item.title.slice(0, 90));
  return [...queries].filter(Boolean);
}

async function nieRepositoryCandidates(item: MissingPdfQueueItem) {
  return dspaceRepositoryCandidates(item, "NIE Repository", "https://repository.nie.edu.sg");
}

async function drNtuRepositoryCandidates(item: MissingPdfQueueItem) {
  return dspaceRepositoryCandidates(item, "DR-NTU Repository", "https://dr.ntu.edu.sg");
}

async function dspaceRepositoryCandidates(item: MissingPdfQueueItem, sourceName: string, baseUrl: string) {
  type NieItem = {
    uuid?: string;
    name?: string;
    metadata?: Record<string, Array<{ value?: string }>>;
    _links?: { self?: { href?: string }; bundles?: { href?: string } };
  };
  type NieSearchObject = { _embedded?: { indexableObject?: NieItem; item?: NieItem } };
  type NieBundle = {
    name?: string;
    _links?: { bitstreams?: { href?: string } };
  };
  type NieBitstream = {
    name?: string;
    sizeBytes?: number;
    _links?: { content?: { href?: string } };
  };

  const candidates: Candidate[] = [];
  const seenItemUrls = new Set<string>();

  for (const query of nieSearchQueries(item)) {
    const url = `${baseUrl}/server/api/discover/search/objects?query=${encodeURIComponent(query)}&size=5`;
    const payload = await fetchJson<{
      _embedded?: { searchResult?: { _embedded?: { objects?: NieSearchObject[] } } };
    }>(url);
    const objects = payload._embedded?.searchResult?._embedded?.objects || [];

    for (const object of objects) {
      const repositoryItem = object._embedded?.indexableObject || object._embedded?.item;
      if (!repositoryItem) continue;
      const itemUrl = repositoryItem._links?.self?.href || "";
      if (!itemUrl || seenItemUrls.has(itemUrl)) continue;
      seenItemUrls.add(itemUrl);

      const title = metadataValue(repositoryItem.metadata || {}, ["dc.title", "dcterms.title"]) || repositoryItem.name || "";
      const doi =
        metadataValue(repositoryItem.metadata || {}, ["dc.identifier.doi", "datacite.identifier", "dc.identifier.uri"]) || item.doi;
      addCandidate(candidates, {
        source: `${sourceName} item`,
        url: itemUrl,
        title,
        doi
      });

      if (!candidateStronglyMatchesTargetTitle({ source: `${sourceName} item`, url: itemUrl, title, doi }, item)) continue;
      const bundlesUrl = repositoryItem._links?.bundles?.href;
      if (!bundlesUrl) continue;

      const bundlesPayload = await fetchJson<{ _embedded?: { bundles?: NieBundle[] } }>(bundlesUrl);
      const originalBundles = (bundlesPayload._embedded?.bundles || []).filter((bundle) => /original/i.test(bundle.name || ""));
      for (const bundle of originalBundles) {
        const bitstreamsUrl = bundle._links?.bitstreams?.href;
        if (!bitstreamsUrl) continue;
        const bitstreamsPayload = await fetchJson<{ _embedded?: { bitstreams?: NieBitstream[] } }>(bitstreamsUrl);
        for (const bitstream of bitstreamsPayload._embedded?.bitstreams || []) {
          const contentUrl = bitstream._links?.content?.href || "";
          if (!contentUrl || !/\.pdf$/i.test(bitstream.name || "")) continue;
          addCandidate(candidates, {
            source: `${sourceName} PDF ${bitstream.name || ""}${bitstream.sizeBytes ? ` ${bitstream.sizeBytes} bytes` : ""}`,
            url: contentUrl,
            title,
            doi
          });
        }
      }
    }
  }

  return candidates;
}

function mdCell(value: unknown) {
  return String(value ?? "").replace(/\|/g, " ");
}

function normalize(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function doiKey(value = "") {
  return value.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/[^a-z0-9]+/g, "");
}

function titleTokens(title: string) {
  const stop = new Set([
    "about",
    "among",
    "and",
    "based",
    "from",
    "into",
    "learning",
    "study",
    "that",
    "their",
    "the",
    "through",
    "with"
  ]);
  return [...new Set(normalize(title).split(/\s+/).filter((token) => token.length >= 5 && !stop.has(token)))];
}

function authorTokens(record?: PublicationRecord) {
  return [
    ...new Set((record?.authors || []).flatMap((author) => normalize(author).split(/\s+/)).filter((token) => token.length >= 4))
  ];
}

function ratio(tokens: string[], text: string) {
  if (!tokens.length) return 0;
  return tokens.filter((token) => text.includes(token)).length / tokens.length;
}

function strictTitleTokens(title: string) {
  const stop = new Set(["and", "for", "from", "into", "the", "this", "that", "with"]);
  return [...new Set(normalize(title).split(/\s+/).filter((token) => token.length >= 3 && !stop.has(token)))];
}

function jaccard(leftTokens: string[], rightTokens: string[]) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / union.size;
}

function candidateMatchesTargetTitle(candidate: Candidate, item: MissingPdfQueueItem) {
  if (!candidate.title) return true;
  const itemTokens = titleTokens(item.title);
  const candidateText = normalize(candidate.title);
  return ratio(itemTokens, candidateText) >= 0.45 || normalize(item.title).includes(candidateText) || candidateText.includes(normalize(item.title));
}

function candidateStronglyMatchesTargetTitle(candidate: Candidate, item: MissingPdfQueueItem) {
  if (candidate.doi && item.doi && doiKey(candidate.doi) === doiKey(item.doi)) return true;
  if (!candidate.title) return false;
  const candidateText = normalize(candidate.title);
  const itemText = normalize(item.title);
  if (itemText.includes(candidateText) || candidateText.includes(itemText)) return true;
  return jaccard(strictTitleTokens(item.title), strictTitleTokens(candidate.title)) >= 0.78;
}

function loadProfileRecords() {
  if (!fs.existsSync(profilePath)) return [];
  return (JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile).records;
}

function findPublicationRecord(records: PublicationRecord[], item: MissingPdfQueueItem) {
  const itemDoi = doiKey(item.doi);
  return records.find((record) => {
    if (itemDoi && doiKey(record.doi) === itemDoi) return true;
    return Boolean(item.wosAccession && record.wosAccession === item.wosAccession);
  });
}

function extractPdfText(bytes: Buffer) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-prof-chai-pdf-"));
  const tempPath = path.join(tempDir, "candidate.pdf");
  try {
    fs.writeFileSync(tempPath, bytes);
    const output = execFileSync(python, [helperPath, tempPath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    const payload = JSON.parse(output) as { status: string; text?: string; detail?: string };
    return payload.status === "indexed" ? payload.text || "" : "";
  } catch {
    return "";
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyPdfBytes(item: MissingPdfQueueItem, record: PublicationRecord | undefined, bytes: Buffer): PdfVerification {
  const rawText = extractPdfText(bytes);
  const frontText = normalize(rawText.slice(0, 60000));
  const title = strictTitleTokens(item.title);
  const authors = authorTokens(record);
  const titleTokenRatio = ratio(title, frontText);
  const authorTokenRatio = ratio(authors, frontText);
  const doiHit = Boolean(item.doi && doiKey(frontText).includes(doiKey(item.doi)));
  const yearHit = Boolean(item.year && frontText.includes(item.year));
  const score =
    (doiHit ? 650 : 0) +
    (yearHit ? 60 : 0) +
    Math.round(titleTokenRatio * 420) +
    Math.round(authorTokenRatio * 180) -
    (rawText.length < 1000 ? 150 : 0);
  const ok =
    doiHit ||
    (titleTokenRatio >= 0.7 && (yearHit || authorTokenRatio >= 0.25)) ||
    (titleTokenRatio >= 0.85 && authors.length === 0);

  return {
    ok,
    score,
    titleTokenRatio,
    authorTokenRatio,
    doiHit,
    yearHit,
    textLength: rawText.length,
    detail: ok
      ? "PDF text matches target metadata"
      : `rejected: DOI ${doiHit ? "hit" : "miss"}, title ${Math.round(titleTokenRatio * 100)}%, author ${Math.round(
          authorTokenRatio * 100
        )}%, year ${yearHit ? "hit" : "miss"}`
  };
}

async function main() {
  const queue = loadMissingPdfQueue(projectRoot);
  const publicationRecords = loadProfileRecords();
  const results: CheckResult[] = [];
  const normalizedFilter = normalize(doiFilter);
  const items = queue.items
    .map(withSupplementalDoi)
    .filter(
      (item) =>
        !doiFilter ||
        (item.doi || "").includes(doiFilter) ||
        item.title.toLowerCase().includes(doiFilter.toLowerCase()) ||
        normalize(item.title).includes(normalizedFilter)
    )
    .slice(0, itemLimit > 0 ? itemLimit : undefined);

  for (const item of items) {
    const result: CheckResult = {
      title: item.title,
      year: item.year,
      doi: item.doi,
      wosAccession: item.wosAccession,
      expectedPdfFile: item.expectedPdfFile,
      candidates: [],
      errors: []
    };

    for (const [source, loader] of [
      ["Semantic Scholar", semanticScholarCandidates],
      ["OpenAlex", openAlexCandidates],
      ["Unpaywall", unpaywallCandidates],
      ["Crossref", crossrefCandidates],
      ["NIE Repository", nieRepositoryCandidates],
      ["DR-NTU Repository", drNtuRepositoryCandidates]
    ] as const) {
      try {
        for (const candidate of await loader(item)) {
          if (candidateMatchesTargetTitle(candidate, item)) addCandidate(result.candidates, candidate);
        }
      } catch (error) {
        result.errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 650));
    }

    for (const candidate of result.candidates) {
      if (!looksLikePotentialFile(candidate.url)) continue;
      candidate.byteCheck = await checkBytes(candidate.url);
      if (candidate.byteCheck.startsWithPdf && candidate.byteCheck.bytes) {
        candidate.byteCheck.verification = verifyPdfBytes(item, findPublicationRecord(publicationRecords, item), candidate.byteCheck.bytes);
        candidate.byteCheck.detail = `${candidate.byteCheck.detail}; ${candidate.byteCheck.verification.detail}`;
      }
      if (
        shouldSave &&
        candidate.byteCheck.startsWithPdf &&
        candidate.byteCheck.verification?.ok &&
        item.expectedPdfFile &&
        !result.savedFile
      ) {
        const outputPath = path.join(pdfDir, item.expectedPdfFile);
        if (!fs.existsSync(outputPath)) {
          const bytes = candidate.byteCheck.bytes || Buffer.alloc(0);
          if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
            fs.mkdirSync(pdfDir, { recursive: true });
            fs.writeFileSync(outputPath, bytes);
            result.savedFile = path.relative(projectRoot, outputPath);
          }
        } else {
          result.savedFile = path.relative(projectRoot, outputPath);
        }
      }
    }

    results.push(result);
  }

  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  const serializableResults = results.map((result) => ({
    ...result,
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      byteCheck: candidate.byteCheck
        ? {
            ...candidate.byteCheck,
            bytes: undefined
          }
        : undefined
    }))
  }));
  fs.writeFileSync(dataPath, `${JSON.stringify(serializableResults, null, 2)}\n`, "utf8");

  const candidatesChecked = results.reduce((count, result) => count + result.candidates.length, 0);
  const byteChecks = results.flatMap((result) => result.candidates.map((candidate) => candidate.byteCheck).filter(Boolean) as ByteCheck[]);
  const pdfBytes = byteChecks.filter((check) => check.startsWithPdf);
  const saved = results.filter((result) => result.savedFile);
  const markdown = [
    "# Missing PDF Scholarly Metadata Recheck",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `- Missing records checked: ${results.length}`,
    `- Structured candidate URLs found: ${candidatesChecked}`,
    `- File-like URLs byte-checked: ${byteChecks.length}`,
    `- Direct PDF-byte successes: ${pdfBytes.length}`,
    `- Saved files: ${saved.length}`,
    `- Data file: \`${path.relative(projectRoot, dataPath)}\``,
    "",
    "Sources checked: Semantic Scholar, OpenAlex, Unpaywall, Crossref, NIE Repository, and DR-NTU Repository. Semantic Scholar may return HTTP 429 without an API key; this is recorded as a metadata limit, not as absence of a PDF.",
    "",
    "| Year | DOI/WoS | Candidates | PDF-byte hits | Saved | Notes | Title |",
    "|---:|---|---:|---:|---|---|---|",
    ...results.map((result) => {
      const hits = result.candidates.filter((candidate) => candidate.byteCheck?.startsWithPdf);
      const rejected = hits.filter((candidate) => candidate.byteCheck?.verification && !candidate.byteCheck.verification.ok);
      const notes = [
        ...result.errors,
        ...rejected.map((candidate) => `${candidate.source}: ${candidate.byteCheck?.verification?.detail}`),
        ...result.candidates
          .filter((candidate) => /murdoch|auckland|hdl\.handle/i.test(candidate.url))
          .map((candidate) => `${candidate.source}: metadata/handle route only`)
      ].slice(0, 3);
      return `| ${result.year || "n.d."} | ${mdCell(result.doi || result.wosAccession || "")} | ${result.candidates.length} | ${hits.length} | ${mdCell(result.savedFile || "")} | ${mdCell(notes.join("; ") || "no direct PDF bytes")} | ${mdCell(result.title)} |`;
    }),
    "",
    "## Candidate URLs With Byte Checks",
    "",
    ...results.flatMap((result) => {
      const checked = result.candidates.filter((candidate) => candidate.byteCheck);
      if (!checked.length) return [];
      return [
        `### ${result.title}`,
        "",
        ...checked.map(
          (candidate) =>
            `- ${candidate.source}: [link](${candidate.url}) — ${
              candidate.byteCheck?.startsWithPdf ? candidate.byteCheck.detail : candidate.byteCheck?.detail || "not checked"
            }`
        ),
        ""
      ];
    })
  ].join("\n");
  fs.writeFileSync(markdownPath, `${markdown}\n`, "utf8");

  console.log(`Missing records checked: ${results.length}`);
  console.log(`Structured candidate URLs found: ${candidatesChecked}`);
  console.log(`File-like URLs byte-checked: ${byteChecks.length}`);
  console.log(`Direct PDF-byte successes: ${pdfBytes.length}`);
  console.log(`Saved files: ${saved.length}`);
  console.log(markdownPath);
  console.log(dataPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Scholarly metadata recheck failed.");
  process.exitCode = 1;
});

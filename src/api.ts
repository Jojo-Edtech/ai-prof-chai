import type {
  AssistantConnectionCheck,
  AssistantResponse,
  AssistantStatus,
  ChatMessage,
  CorpusProfile,
  DistillationProfile,
  FullTextStatus,
  MissingPdfProgressStatus,
  MissingPdfQueue,
  PdfAuditStatus,
  PdfRefreshResult,
  PdfUploadResult
} from "./shared/types";

declare global {
  interface Window {
    AI_PROF_CHAI_API_BASE?: string;
  }
}

const visitorStorageKey = "ai-prof-chai-api-visitor-v1";

function apiBase() {
  if (typeof window === "undefined") return "";
  return String(window.AI_PROF_CHAI_API_BASE || "").replace(/\/+$/, "");
}

function apiUrl(path: string) {
  const base = apiBase();
  return base ? `${base}${path}` : path;
}

function createVisitorId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `anon_${crypto.randomUUID().replace(/-/g, "")}`;
  const random = typeof crypto !== "undefined" && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint8Array(18)))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")
    : `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `anon_${random}`;
}

function isVisitorId(value: string | null) {
  return /^anon_[A-Za-z0-9_-]{16,}$/.test(String(value || ""));
}

function visitorId() {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(visitorStorageKey);
    if (!isVisitorId(id)) {
      id = createVisitorId();
      window.localStorage.setItem(visitorStorageKey, id);
    }
    return id;
  } catch {
    return "";
  }
}

function requestHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra);
  const id = visitorId();
  if (id) headers.set("X-AI-Prof-Chai-Visitor", id);
  return headers;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(apiUrl(url), {
    credentials: "include",
    headers: requestHeaders()
  });
  if (!response.ok) throw new Error(`请求失败：${response.status}`);
  return response.json() as Promise<T>;
}

export function fetchProfile() {
  return getJson<CorpusProfile>("/api/profile");
}

export function fetchDistillation() {
  return getJson<DistillationProfile>("/api/distillation");
}

export function fetchFullTextStatus() {
  return getJson<FullTextStatus>("/api/fulltext");
}

export function fetchPdfAuditStatus() {
  return getJson<PdfAuditStatus>("/api/pdf-audit");
}

export function fetchMissingPdfQueue() {
  return getJson<MissingPdfQueue>("/api/missing-pdfs");
}

export async function updateMissingPdfProgress(key: string, status: MissingPdfProgressStatus) {
  const response = await fetch(apiUrl("/api/missing-pdfs/progress"), {
    method: "PATCH",
    credentials: "include",
    headers: requestHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({ key, status })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
  return payload as MissingPdfQueue;
}

export function fetchAssistantStatus() {
  return getJson<AssistantStatus>("/api/assistant/config");
}

export async function configureAssistantToken(token: string) {
  const response = await fetch(apiUrl("/api/assistant/config"), {
    method: "POST",
    credentials: "include",
    headers: requestHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({ token })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
  return payload as AssistantStatus;
}

export async function checkAssistantConnection() {
  const response = await fetch(apiUrl("/api/assistant/check"), {
    method: "POST",
    credentials: "include",
    headers: requestHeaders()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
  return payload as AssistantConnectionCheck;
}

export async function refreshDownloadedPdfs() {
  const response = await fetch(apiUrl("/api/pdfs/refresh"), {
    method: "POST",
    credentials: "include",
    headers: requestHeaders()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `请求失败：${response.status}`);
  return payload as PdfRefreshResult;
}

export async function uploadPdfFile(file: File) {
  const response = await fetch(apiUrl("/api/pdfs/upload"), {
    method: "POST",
    credentials: "include",
    headers: requestHeaders({
      "Content-Type": "application/pdf",
      "x-filename": encodeURIComponent(file.name)
    }),
    body: await file.arrayBuffer()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `请求失败：${response.status}`);
  return payload as PdfUploadResult;
}

export async function requestAssistantReply(messages: ChatMessage[]) {
  const response = await fetch(apiUrl("/api/assistant/chat"), {
    method: "POST",
    credentials: "include",
    headers: requestHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({ messages })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
  return payload as AssistantResponse;
}

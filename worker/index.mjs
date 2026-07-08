import { BASE_SYSTEM_PROMPT, DISTILLED_KNOWLEDGE, EVIDENCE_SUMMARY } from "./knowledge.mjs";

const SESSION_COOKIE_NAME = "ai_prof_chai_guest";
const DEFAULT_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507";
const MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1";
const ANONYMOUS_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_HISTORY_MESSAGES = 10;
const KEY_PREFIX = "chai:";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://jojo-edtech.github.io",
  "http://localhost:5178",
  "http://127.0.0.1:5178",
  "http://localhost:8914",
  "http://127.0.0.1:8914"
];

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });

    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith("/api/")) {
        return json(request, env, { ok: true, service: "AI Prof. Chai ModelScope Worker" });
      }
      return await handleApi(request, env, url);
    } catch (error) {
      return json(request, env, {
        error: "worker_error",
        message: error?.message || "Worker request failed."
      }, 500);
    }
  }
};

async function handleApi(request, env, url) {
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/api/status") return statusResponse(request, env);
  if (request.method === "GET" && pathname === "/api/auth/me") {
    const user = currentUser(request);
    return withGuestCookie(user.id, json(request, env, {
      accessMode: "anonymous",
      authRequired: false,
      authenticated: true,
      allowCrossOriginApp: true,
      user: publicUser(user)
    }));
  }

  if (request.method === "GET" && pathname === "/api/profile") return json(request, env, publicProfile());
  if (request.method === "GET" && pathname === "/api/distillation") return json(request, env, publicDistillation());
  if (request.method === "GET" && pathname === "/api/fulltext") return json(request, env, publicFullTextStatus());
  if (request.method === "GET" && pathname === "/api/pdf-audit") return json(request, env, publicPdfAuditStatus());
  if (request.method === "GET" && pathname === "/api/missing-pdfs") return json(request, env, publicMissingPdfQueue());
  if (request.method === "PATCH" && pathname === "/api/missing-pdfs/progress") return json(request, env, publicMissingPdfQueue());
  if (request.method === "POST" && pathname === "/api/pdfs/refresh") {
    return json(request, env, { ok: false, message: "The public app cannot scan downloads on this computer. The local version can still use this feature." }, 405);
  }
  if (request.method === "POST" && pathname === "/api/pdfs/upload") {
    return json(request, env, { ok: false, message: "The public app does not accept paper PDF uploads. Please maintain the corpus in the local version." }, 405);
  }

  if (request.method === "GET" && pathname === "/api/assistant/config") return assistantConfigResponse(request, env);
  if (request.method === "POST" && pathname === "/api/assistant/config") {
    return json(request, env, {
      error: "public_worker_secret_only",
      message: "The public app does not save tokens in the webpage. Configure the ModelScope token as a protected Worker secret."
    }, 403);
  }
  if (request.method === "POST" && pathname === "/api/assistant/check") return assistantCheckResponse(request, env);
  if (request.method === "POST" && pathname === "/api/assistant/chat") return handleAssistantChat(request, env);

  return json(request, env, { error: "not_found" }, 404);
}

async function statusResponse(request, env) {
  const usage = await readGlobalUsage(env);
  const limits = readLimits(env);
  return json(request, env, {
    ok: true,
    provider: "modelscope",
    accessMode: "anonymous",
    authRequired: false,
    authenticated: false,
    allowCrossOriginApp: true,
    user: null,
    hasApiKey: Boolean(env.MODELSCOPE_API_KEY),
    model: modelName(env),
    paperCount: 45,
    chunkCount: 3249,
    missingCount: 6,
    freeQuotaProtected: true,
    limits: {
      perHour: limits.perHour,
      perDay: limits.perDay,
      globalPerDay: limits.globalPerDay,
      modelScopeFreeDailyCalls: limits.modelScopeFreeDailyCalls
    },
    usage: {
      globalToday: usage.globalDayCount || 0,
      remainingToday: Math.max(0, limits.globalCap - (usage.globalDayCount || 0))
    }
  });
}

async function assistantConfigResponse(request, env) {
  const usage = await readGlobalUsage(env);
  const limits = readLimits(env);
  const remaining = Math.max(0, limits.globalCap - (usage.globalDayCount || 0));
  return json(request, env, {
    configured: Boolean(env.MODELSCOPE_API_KEY),
    provider: "modelscope",
    model: modelName(env),
    projectId: "ai-prof-chai-public",
    quotaLabel: `${remaining}/${limits.globalCap}`,
    tokenCount: env.MODELSCOPE_API_KEY ? 1 : 0,
    setupHint: env.MODELSCOPE_API_KEY
      ? "The public app calls ModelScope through a protected Worker secret. The token never enters GitHub."
      : "The Worker has not configured the MODELSCOPE_API_KEY secret yet.",
    publicWorker: true
  });
}

async function assistantCheckResponse(request, env) {
  if (!env.MODELSCOPE_API_KEY) {
    return json(request, env, {
      ok: false,
      provider: "modelscope",
      model: modelName(env),
      quotaLabel: "0/0",
      message: "The Worker has not configured a ModelScope token yet."
    }, 400);
  }
  const usage = await readGlobalUsage(env);
  const limits = readLimits(env);
  const remaining = Math.max(0, limits.globalCap - (usage.globalDayCount || 0));
  return json(request, env, {
    ok: true,
    provider: "modelscope",
    model: modelName(env),
    quotaLabel: `${remaining}/${limits.globalCap}`,
    message: "ModelScope Worker is ready."
  });
}

async function handleAssistantChat(request, env) {
  if (!env.MODELSCOPE_API_KEY) {
    return json(request, env, { error: "missing_key", message: "The ModelScope token has not been configured in the Worker yet." }, 400);
  }

  const payload = await readJson(request);
  const messages = normalizeMessages(payload.messages);
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser?.content?.trim()) {
    return json(request, env, { error: "empty_message", message: "Please enter a message for AI Prof. Chai." }, 400);
  }

  const user = currentUser(request);
  const usage = await checkAndRecordUsage(env, user.id);
  if (!usage.ok) {
    return json(request, env, { error: "usage_limit_reached", message: usage.message }, 429);
  }

  const result = await callModelScope(env, messages.slice(-MAX_HISTORY_MESSAGES));
  if (!result.ok) {
    return json(request, env, { error: result.error || "modelscope_error", message: result.message }, result.status || 500);
  }

  const limits = readLimits(env);
  const usageAfter = await readGlobalUsage(env);
  const remaining = Math.max(0, limits.globalCap - (usageAfter.globalDayCount || 0));
  return withGuestCookie(user.id, json(request, env, {
    message: {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: result.answer
    },
    provider: "modelscope",
    model: modelName(env),
    quotaLabel: `${remaining}/${limits.globalCap}`,
    citations: [
      "AI Prof. Chai theme map",
      "AI Prof. Chai evidence summary",
      "The public app uses compressed evidence summaries only, not raw PDF text"
    ]
  }));
}

async function callModelScope(env, messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), readInt(env.MODELSCOPE_TIMEOUT_MS, 55000));
  try {
    const response = await fetch(`${MODELSCOPE_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.MODELSCOPE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName(env),
        messages: [
          { role: "system", content: buildSystemPrompt() },
          ...messages.map((message) => ({
            role: message.role,
            content: String(message.content || "").slice(0, 5000)
          }))
        ],
        temperature: 0.25,
        max_tokens: readInt(env.MODELSCOPE_MAX_TOKENS, 1400),
        stream: false
      })
    });
    const text = await response.text();
    const data = safeJson(text, {});
    if (!response.ok) {
      const rawMessage = data?.error?.message || data?.message || text.slice(0, 500) || `ModelScope returned ${response.status}`;
      const freeTierStopped = response.status === 429 || /FreeTierOnly|free tier|quota|额度/i.test(rawMessage);
      return {
        ok: false,
        status: freeTierStopped ? 429 : response.status,
        error: freeTierStopped ? "modelscope_quota_exhausted" : "modelscope_error",
        message: freeTierStopped
          ? "ModelScope free-quota protection has been triggered. To avoid further usage, AI Prof. Chai is paused for today and will resume after the quota refreshes tomorrow."
          : rawMessage
      };
    }
    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const answer = String(choice?.message?.content || choice?.text || "").trim();
    if (!answer) {
      return { ok: false, status: 502, error: "empty_model_response", message: "ModelScope returned an empty response. Please try again later." };
    }
    return { ok: true, answer };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: "request_failed",
      message: error?.name === "AbortError" ? "ModelScope timed out." : error?.message || "ModelScope request failed."
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildSystemPrompt() {
  return `${BASE_SYSTEM_PROMPT}

Compressed Knowledge Base:
${DISTILLED_KNOWLEDGE.slice(0, 14000)}

Evidence Index Summary:
${EVIDENCE_SUMMARY.slice(0, 14000)}

Response Rules:
- Answer in the user's language; default to English when the user's language is unclear.
- Start with the conclusion, then give the structure.
- For research design questions, prefer compact tables.
- Clearly distinguish saved-PDF evidence, bibliographic/abstract-level evidence, and claims that still need full-text confirmation.
- Do not quote long passages from papers, and do not claim to be Prof. Chai personally.
- Refer to the mentor as "Prof. Chai" or "AI Prof. Chai"; do not output or infer any private identity details.`;
}

function publicProfile() {
  return {
    generatedAt: "2026-07-08T15:27:19.458Z",
    sourceFiles: ["public-safe worker distillation"],
    professor: {
      displayName: "Prof. Chai",
      assistantName: "AI Prof. Chai",
      aliases: ["Prof. Chai"]
    },
    summary: {
      total: 259,
      firstAuthor: 46,
      correspondingAuthor: 30,
      firstOrCorresponding: 51,
      openAccess: 0,
      pdfSaved: 45,
      pdfNeeded: 6
    },
    records: []
  };
}

function publicDistillation() {
  return {
    generatedAt: "2026-07-08T15:27:19.458Z",
    sourceGeneratedAt: "2026-07-08T15:27:19.458Z",
    professor: publicProfile().professor,
    summary: publicProfile().summary,
    targetCount: 51,
    pdfCoverage: 45 / 51,
    themes: [
      { id: "ai-intention", label: "AI learning intention and motivation", question: "Why do students and teachers sustain their willingness to learn, teach, and use AI?", count: 9, pdfSaved: 9, years: "2020-2026", representativeRecords: [] },
      { id: "tpack", label: "TPACK, STEM, and teacher professional learning", question: "How do teachers develop integrated technological, pedagogical, and content knowledge?", count: 40, pdfSaved: 35, years: "2005-2025", representativeRecords: [] },
      { id: "epistemic", label: "Epistemic beliefs and knowledge creation", question: "How do teachers' and students' epistemic beliefs shape knowledge building and online interaction?", count: 26, pdfSaved: 22, years: "2005-2024", representativeRecords: [] },
      { id: "learner-experience", label: "21st-century learning and learner experience", question: "How do 21st-century learning practices connect with learner experience, efficacy, and learning environments?", count: 19, pdfSaved: 17, years: "2009-2026", representativeRecords: [] },
      { id: "teacher-education", label: "ICT integration and teacher education", question: "How can teacher education help preservice teachers move between digital worlds and school practice?", count: 35, pdfSaved: 31, years: "2005-2020", representativeRecords: [] }
    ],
    eras: [
      { id: "2005-2010", label: "2005-2010 Foundations", focus: "knowledge building, epistemic beliefs, ICT-supported teacher learning", count: 15, pdfSaved: 13, representativeRecords: [] },
      { id: "2011-2016", label: "2011-2016 TPACK Expansion", focus: "TPACK validation, teacher education, 21st-century learning practices", count: 16, pdfSaved: 13, representativeRecords: [] },
      { id: "2017-2020", label: "2017-2020 STEM and Design Beliefs", focus: "STEM-TPACK, design beliefs, teacher professional learning, early AI learning intention", count: 12, pdfSaved: 11, representativeRecords: [] },
      { id: "2021-2026", label: "2021-2026 AI Education", focus: "AI learning intention, motivation, readiness, and curriculum evaluation", count: 8, pdfSaved: 8, representativeRecords: [] }
    ],
    missingPdf: []
  };
}

function publicFullTextStatus() {
  return {
    generatedAt: "2026-07-08T15:27:22.290Z",
    sourceGeneratedAt: "2026-07-08T15:27:22.290Z",
    summary: {
      available: true,
      targetPdfSaved: 45,
      indexed: 45,
      failed: 0,
      totalTextLength: 0,
      maxTextCharsPerPdf: 0,
      evidenceChunks: 3249,
      evidenceChunkChars: 950,
      evidenceChunkOverlap: 180
    },
    records: []
  };
}

function publicPdfAuditStatus() {
  return { summary: { available: true, targetPdfSaved: 45, high: 43, medium: 2, low: 0 } };
}

function publicMissingPdfQueue() {
  return {
    sourcePath: "public worker compact queue",
    summary: { available: true, count: 6, progress: { todo: 6, opened: 0, requested: 0, blocked: 0 } },
    items: []
  };
}

function currentUser(request) {
  const cookieUser = readCookie(request, SESSION_COOKIE_NAME);
  const headerUser = request.headers.get("X-AI-Prof-Chai-Visitor");
  const id = isAnonymousUserId(cookieUser) ? cookieUser : isAnonymousUserId(headerUser) ? headerUser : newAnonymousId();
  return { id, username: "anonymous", displayName: "Guest workspace", anonymous: true };
}

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, anonymous: true };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function normalizeMessages(messages) {
  return Array.isArray(messages)
    ? messages
        .filter((message) => message && ["user", "assistant"].includes(message.role))
        .map((message) => ({ role: message.role, content: String(message.content || "") }))
    : [];
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = allowedOrigins(env);
  const allowOrigin = origin && (allowed.includes("*") || allowed.includes(origin)) ? origin : "";
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-AI-Prof-Chai-Visitor, x-filename",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function withGuestCookie(userId, response) {
  if (!isAnonymousUserId(userId)) return response;
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(userId)}; Path=/; Max-Age=${ANONYMOUS_TTL_SECONDS}; HttpOnly; Secure; SameSite=None`
  );
  return response;
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const item of header.split(/;\s*/)) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index) === name) return decodeURIComponent(item.slice(index + 1));
  }
  return "";
}

function newAnonymousId() {
  return `anon_${crypto.randomUUID().replace(/-/g, "")}`;
}

function isAnonymousUserId(value) {
  return /^anon_[A-Za-z0-9_-]{16,}$/.test(String(value || ""));
}

async function readGlobalUsage(env) {
  const value = await env.AI_PROF_CHAI_KV?.get(`${KEY_PREFIX}usage:global:${usageWindow().day}`, "json");
  return value && typeof value === "object" ? value : {};
}

async function checkAndRecordUsage(env, userId) {
  if (!env.AI_PROF_CHAI_KV) return { ok: false, message: "Worker KV is not bound yet, so the model cannot be called safely." };

  const limits = readLimits(env);
  const windows = usageWindow();
  const userHourKey = `${KEY_PREFIX}usage:user:${userId}:${windows.hour}`;
  const userDayKey = `${KEY_PREFIX}usage:user:${userId}:${windows.day}`;
  const globalDayKey = `${KEY_PREFIX}usage:global:${windows.day}`;
  const [userHour, userDay, globalDay] = await Promise.all([
    env.AI_PROF_CHAI_KV.get(userHourKey, "json"),
    env.AI_PROF_CHAI_KV.get(userDayKey, "json"),
    env.AI_PROF_CHAI_KV.get(globalDayKey, "json")
  ]);
  const userHourCount = Number(userHour?.count || 0);
  const userDayCount = Number(userDay?.count || 0);
  const globalDayCount = Number(globalDay?.globalDayCount || 0);

  if (userHourCount >= limits.perHour) return { ok: false, message: `This visitor can send up to ${limits.perHour} requests per hour. Please try again later.` };
  if (userDayCount >= limits.perDay) return { ok: false, message: `This visitor can send up to ${limits.perDay} requests per day. It will reset tomorrow.` };
  if (globalDayCount >= limits.globalCap) {
    return { ok: false, message: "ModelScope free-quota protection has been triggered. To avoid further usage, AI Prof. Chai is paused for today and will resume tomorrow." };
  }

  const now = new Date().toISOString();
  await Promise.all([
    env.AI_PROF_CHAI_KV.put(userHourKey, JSON.stringify({ count: userHourCount + 1, updatedAt: now }), { expirationTtl: 2 * 60 * 60 }),
    env.AI_PROF_CHAI_KV.put(userDayKey, JSON.stringify({ count: userDayCount + 1, updatedAt: now }), { expirationTtl: 2 * 24 * 60 * 60 }),
    env.AI_PROF_CHAI_KV.put(globalDayKey, JSON.stringify({ globalDayCount: globalDayCount + 1, updatedAt: now }), { expirationTtl: 2 * 24 * 60 * 60 })
  ]);

  return { ok: true };
}

function readLimits(env) {
  const modelScopeFreeDailyCalls = readInt(env.MODELSCOPE_FREE_DAILY_CALLS, 2000);
  const globalPerDay = readInt(env.MAX_GLOBAL_REQUESTS_PER_DAY, 300);
  return {
    perHour: readInt(env.MAX_REQUESTS_PER_HOUR, 8),
    perDay: readInt(env.MAX_REQUESTS_PER_DAY, 20),
    globalPerDay,
    modelScopeFreeDailyCalls,
    globalCap: Math.min(globalPerDay, modelScopeFreeDailyCalls)
  };
}

function usageWindow(now = new Date()) {
  const iso = now.toISOString();
  return { hour: iso.slice(0, 13), day: iso.slice(0, 10) };
}

function modelName(env) {
  return env.MODELSCOPE_MODEL || DEFAULT_MODEL;
}

function readInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

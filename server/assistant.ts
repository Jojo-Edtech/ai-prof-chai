import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AssistantConnectionCheck,
  AssistantResponse,
  AssistantStatus,
  ChatMessage,
  CorpusProfile,
  DistillationProfile,
  DistillationRecord,
  FullTextIndex
} from "../src/shared/types";
import { corpusContext, retrieveRecords } from "./corpus";
import { countEvidenceChunks, fullTextContext, retrieveFullText } from "./fulltext";

type ProviderName = "deepseek" | "modelscope" | "dashscope" | "disabled";

type ProviderConfig = {
  provider: ProviderName;
  token: string;
  tokens: string[];
  model: string;
  endpoint: string;
  balanceEndpoint?: string;
  projectId: string;
  dailyLimit: number;
  temperature: number;
  maxTokens: number;
  minBalanceUsd?: number;
  minBalanceCny?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type DeepSeekBalanceResponse = {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
};

const defaultProjectId = "ai-prof-chai";
const defaultDeepSeekBase = "https://api.deepseek.com";
const defaultModelScopeBase = "https://api-inference.modelscope.cn/v1";
const defaultModelScopeModel = "Qwen/Qwen3-30B-A3B-Instruct-2507";
const defaultDashScopeBase = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const providerNames: ProviderName[] = ["deepseek", "modelscope", "dashscope", "disabled"];

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function envAny(names: string[], fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return fallback;
}

export function parseApiTokens(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((token) => token.trim())
        .filter(Boolean)
    )
  ];
}

export const parseModelScopeTokens = parseApiTokens;

function envTokens(names: string[]) {
  return [...new Set(names.flatMap((name) => parseApiTokens(process.env[name] || "")))];
}

function endpointFromBase(value: string) {
  const clean = value.replace(/\/+$/, "");
  if (clean.endsWith("/chat/completions")) return clean;
  return `${clean}/chat/completions`;
}

function balanceEndpointFromBase(value: string) {
  const clean = value
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "")
    .replace(/\/v1$/, "");
  return `${clean}/user/balance`;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function numberEnvAny(names: string[], fallback: number) {
  for (const name of names) {
    const value = Number(process.env[name]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function configuredProvider(): ProviderName {
  const raw = env("AI_PROF_CHAI_AI_PROVIDER", "modelscope").toLowerCase() as ProviderName;
  return providerNames.includes(raw) ? raw : "modelscope";
}

export function getAssistantConfig(): ProviderConfig {
  const provider = configuredProvider();
  const projectId = env("AI_PROF_CHAI_ASSISTANT_PROJECT", defaultProjectId);
  const dailyLimit = numberEnv("AI_PROF_CHAI_DAILY_LIMIT", 50);
  const temperature = numberEnv("AI_PROF_CHAI_TEMPERATURE", 0.2);
  const maxTokens = numberEnv("AI_PROF_CHAI_MAX_TOKENS", provider === "deepseek" ? 800 : 1100);

  if (provider === "disabled") {
    return { provider, token: "", tokens: [], model: "disabled", endpoint: "", projectId, dailyLimit, temperature, maxTokens };
  }

  if (provider === "deepseek") {
    const tokens = envTokens([
      "AI_PROF_CHAI_DEEPSEEK_API_TOKENS",
      "AI_PROF_CHAI_DEEPSEEK_API_KEY",
      "AI_PROF_CHAI_DEEPSEEK_API_TOKEN",
      "DEEPSEEK_API_TOKENS",
      "DEEPSEEK_API_KEY",
      "DEEPSEEK_API_TOKEN"
    ]);
    const base = env("AI_PROF_CHAI_DEEPSEEK_API_BASE", defaultDeepSeekBase);
    return {
      provider,
      token: tokens[0] || "",
      tokens,
      model: env("AI_PROF_CHAI_DEEPSEEK_MODEL", "deepseek-v4-flash"),
      endpoint: endpointFromBase(base),
      balanceEndpoint: env("AI_PROF_CHAI_DEEPSEEK_BALANCE_ENDPOINT", balanceEndpointFromBase(base)),
      projectId,
      dailyLimit,
      temperature,
      maxTokens,
      minBalanceUsd: numberEnvAny(["AI_PROF_CHAI_DEEPSEEK_MIN_BALANCE_USD", "AI_PROF_CHAI_MIN_BALANCE_USD"], 0.2),
      minBalanceCny: numberEnvAny(["AI_PROF_CHAI_DEEPSEEK_MIN_BALANCE_CNY", "AI_PROF_CHAI_MIN_BALANCE_CNY"], 1)
    };
  }

  if (provider === "modelscope") {
    const tokens = envTokens([
      "AI_PROF_CHAI_MODELSCOPE_API_TOKENS",
      "AI_PROF_CHAI_MODELSCOPE_API_TOKEN",
      "MODELSCOPE_API_TOKENS",
      "MODELSCOPE_API_TOKEN",
      "MODELSCOPE_API_KEY"
    ]);
    return {
      provider,
      token: tokens[0] || "",
      tokens,
      model: env("AI_PROF_CHAI_MODELSCOPE_MODEL", defaultModelScopeModel),
      endpoint: endpointFromBase(env("AI_PROF_CHAI_MODELSCOPE_API_BASE", defaultModelScopeBase)),
      projectId,
      dailyLimit,
      temperature,
      maxTokens
    };
  }

  const dashScopeToken = env("AI_PROF_CHAI_DASHSCOPE_API_KEY");
  return {
    provider: "dashscope",
    token: dashScopeToken,
    tokens: dashScopeToken ? [dashScopeToken] : [],
    model: env("AI_PROF_CHAI_DASHSCOPE_MODEL", "qwen-plus"),
    endpoint: endpointFromBase(env("AI_PROF_CHAI_DASHSCOPE_API_BASE", defaultDashScopeBase)),
    projectId,
    dailyLimit,
    temperature,
    maxTokens
  };
}

function quotaFile(config: ProviderConfig) {
  const custom = env("AI_PROF_CHAI_QUOTA_STATE_FILE");
  if (custom) return custom;
  const safeModel = config.model.replace(/[^a-z0-9_-]/gi, "_").slice(0, 96);
  return path.join(os.tmpdir(), `${config.projectId}_${config.provider}_${safeModel}_quota.json`);
}

function readQuota(config: ProviderConfig) {
  try {
    return JSON.parse(fs.readFileSync(quotaFile(config), "utf8")) as { date: string; used: number };
  } catch {
    return { date: new Date().toISOString().slice(0, 10), used: 0 };
  }
}

function quotaLabel(config: ProviderConfig, used?: number) {
  if (config.dailyLimit <= 0) return "unlimited";
  const current = used ?? readQuota(config).used;
  return `${Math.max(0, config.dailyLimit - current)}/${config.dailyLimit}`;
}

function claimQuota(config: ProviderConfig) {
  if (config.dailyLimit <= 0) return quotaLabel(config);
  const today = new Date().toISOString().slice(0, 10);
  const state = readQuota(config);
  const nextState = state.date === today ? state : { date: today, used: 0 };
  if (nextState.used >= config.dailyLimit) throw new Error(`Today's model quota for ${config.projectId} has been used up.`);
  nextState.used += 1;
  fs.writeFileSync(quotaFile(config), JSON.stringify(nextState, null, 2), "utf8");
  return quotaLabel(config, nextState.used);
}

export function assistantStatus(): AssistantStatus {
  const config = getAssistantConfig();
  const configured = config.provider !== "disabled" && config.tokens.length > 0;
  const providerName =
    config.provider === "deepseek"
      ? "DeepSeek"
      : config.provider === "dashscope"
        ? "Alibaba Bailian DashScope"
        : config.provider === "modelscope"
          ? "ModelScope"
          : "Disabled";
  const tokenLabel = config.tokens.length > 1 ? `${config.tokens.length} tokens` : "1 token";

  return {
    configured,
    provider: config.provider,
    model: config.model,
    projectId: config.projectId,
    quotaLabel: quotaLabel(config),
    tokenCount: config.tokens.length,
    setupHint: configured
      ? config.provider === "deepseek"
        ? `${providerName} is configured (${tokenLabel}). Local daily quota: ${quotaLabel(config)}. DeepSeek balance is checked before each call.`
        : `${providerName} is configured (${tokenLabel}). Local daily quota: ${quotaLabel(config)}.`
      : `${providerName} token is not configured yet. Local rule-based answers are available.`
  };
}

function retryWithNextToken(status: number) {
  return [401, 402, 403, 429].includes(status);
}

async function postChatCompletion(config: ProviderConfig, token: string, messages: Array<{ role: string; content: string }>, maxTokens: number, temperature: number) {
  return fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "ai-prof-chai/0.1"
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    })
  });
}

function balanceAmount(value: string | undefined) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function balanceFloor(config: ProviderConfig, currency: string) {
  const upper = currency.toUpperCase();
  if (upper === "USD") return config.minBalanceUsd ?? 0;
  if (upper === "CNY" || upper === "RMB") return config.minBalanceCny ?? 0;
  return 0;
}

function formatBalance(currency: string, total: number, floor: number) {
  return `${currency || "UNKNOWN"} ${total.toFixed(2)} (floor ${floor.toFixed(2)})`;
}

async function assertProviderBalance(config: ProviderConfig, token: string) {
  if (config.provider !== "deepseek") return;
  if (!config.balanceEndpoint) throw new Error("DeepSeek balance endpoint is not configured, so the call was stopped.");

  const response = await fetch(config.balanceEndpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "ai-prof-chai/0.1"
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`DeepSeek balance check failed: HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }

  const payload = (await response.json()) as DeepSeekBalanceResponse;
  if (payload.is_available === false) {
    throw new Error("DeepSeek balance is unavailable, so the call was stopped to avoid further charges.");
  }

  const balances = (payload.balance_infos || [])
    .map((info) => {
      const currency = (info.currency || "").toUpperCase();
      const total = balanceAmount(info.total_balance);
      return { currency, total, floor: balanceFloor(config, currency) };
    })
    .filter((info) => info.currency);

  if (!balances.length) {
    throw new Error("DeepSeek balance check did not return a readable balance, so the call was stopped.");
  }

  if (!balances.some((info) => info.total > info.floor)) {
    throw new Error(`DeepSeek balance is below the local protection floor: ${balances.map((info) => formatBalance(info.currency, info.total, info.floor)).join(" / ")}.`);
  }
}

export async function checkAssistantConnection(): Promise<AssistantConnectionCheck> {
  const config = getAssistantConfig();
  if (config.provider === "disabled") {
    return {
      ok: false,
      provider: config.provider,
      model: config.model,
      quotaLabel: quotaLabel(config),
      message: "AI chat is currently disabled."
    };
  }
  if (!config.tokens.length) {
    return {
      ok: false,
      provider: config.provider,
      model: config.model,
      quotaLabel: quotaLabel(config),
      message:
        config.provider === "deepseek"
          ? "No DeepSeek API key has been detected yet."
          : config.provider === "modelscope"
            ? "No ModelScope token has been detected yet."
            : "No model token has been detected yet."
    };
  }

  let lastMessage = "";
  try {
    for (const [index, token] of config.tokens.entries()) {
      let remaining = quotaLabel(config);
      try {
        await assertProviderBalance(config, token);
        remaining = claimQuota(config);
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "Model balance or local quota check failed.";
        continue;
      }

      const response = await postChatCompletion(
        config,
        token,
        [
          { role: "system", content: "You are a connection check assistant. Reply briefly in English." },
          { role: "user", content: "Reply with \"connected\" only." }
        ],
        16,
        0
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        lastMessage = `${config.provider} token ${index + 1}/${config.tokens.length} returned HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`;
        if (retryWithNextToken(response.status)) continue;
        break;
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content?.trim();
      return {
        ok: Boolean(content),
        provider: config.provider,
        model: config.model,
        quotaLabel: remaining,
        message: content
          ? `AI chat is connected: ${content}${config.tokens.length > 1 ? ` (using token ${index + 1}/${config.tokens.length})` : ""}`
          : `${config.provider} responded, but the returned format did not contain readable text.`
      };
    }

    return {
      ok: false,
      provider: config.provider,
      model: config.model,
      quotaLabel: quotaLabel(config),
      message: lastMessage || "No model token passed the connection check."
    };
  } catch (error) {
    return {
      ok: false,
      provider: config.provider,
      model: config.model,
      quotaLabel: quotaLabel(config),
      message: error instanceof Error ? error.message : "AI chat connection check failed."
    };
  }
}

function lastUserMessage(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content?.trim() || "";
}

function citations(records: ReturnType<typeof retrieveRecords>) {
  return records.map((record) => `${record.year || "n.d."} | ${record.title}${record.doi ? ` | DOI: ${record.doi}` : ""}`);
}

function distillationRecordCitation(record: DistillationRecord) {
  return `${record.year || "n.d."} | ${record.title}${record.doi ? ` | DOI: ${record.doi}` : ""}`;
}

function wantsDistillation(question: string) {
  return /蒸馏|主题|脉络|时间线|演化|阶段|路线|地图|综述|theme|timeline|distill|map/i.test(question);
}

function wantsCoverageCaution(question: string) {
  return /缺口|缺失|待补|谨慎|限制|局限|不足|coverage|missing|caution|limitation/i.test(question);
}

function distillationContext(distillation?: DistillationProfile | null) {
  if (!distillation?.themes?.length) return "No local distillation map is available yet.";
  const themeLines = distillation.themes
    .map(
      (theme) =>
        `- ${theme.label}: ${theme.count} target records, ${theme.pdfSaved} saved PDFs, ${theme.years}. Guiding question: ${theme.question}`
    )
    .join("\n");
  const eraLines = distillation.eras
    .map((era) => `- ${era.label}: ${era.focus}; ${era.count} target records, ${era.pdfSaved} saved PDFs`)
    .join("\n");

  return [
    "Theme map:",
    themeLines,
    "Timeline:",
    eraLines || "- No timeline is available yet.",
    `Missing target PDFs: ${distillation.missingPdf.length}`
  ].join("\n");
}

function fullTextCitations(hits: ReturnType<typeof retrieveFullText>) {
  return hits.map(
    (hit) =>
      `${hit.record.year || "n.d."} | ${hit.record.title}${hit.record.doi ? ` | DOI: ${hit.record.doi}` : ""} | ${hit.evidenceId} | local PDF evidence`
  );
}

function fullTextStatusLine(fullText?: FullTextIndex | null) {
  if (!fullText) return "The full-text index has not been generated yet.";
  const evidenceChunks = fullText.summary.evidenceChunks ?? countEvidenceChunks(fullText);
  return `The full-text index is ready: ${fullText.summary.indexed}/${fullText.summary.targetPdfSaved} saved target PDFs and about ${evidenceChunks} searchable evidence chunks.`;
}

function roleLabel(record: { isFirstAuthor?: boolean; isCorrespondingAuthor?: boolean }) {
  if (record.isFirstAuthor && record.isCorrespondingAuthor) return "first author / corresponding author";
  if (record.isFirstAuthor) return "first author";
  if (record.isCorrespondingAuthor) return "corresponding author";
  return "co-author";
}

function compactRecordLine(record: ReturnType<typeof retrieveRecords>[number], index: number) {
  return `${index + 1}. ${record.title} (${record.year || "n.d."}, ${roleLabel(record)}${record.doi ? `, DOI: ${record.doi}` : ""})`;
}

function evidenceBoundary(profile: CorpusProfile, distillation?: DistillationProfile | null, fullText?: FullTextIndex | null) {
  const missing = distillation?.missingPdf.length ?? profile.summary.pdfNeeded;
  const indexed = fullText?.summary.indexed ?? 0;
  const saved = fullText?.summary.targetPdfSaved ?? profile.summary.pdfSaved;
  const evidenceChunks = fullText ? (fullText.summary.evidenceChunks ?? countEvidenceChunks(fullText)) : 0;
  return `Evidence boundary: ${indexed}/${saved} saved target PDFs are indexed into about ${evidenceChunks} evidence chunks; ${missing} target PDFs are still pending. Claims involving missing full texts should remain bibliographic-level until the PDFs are added.`;
}

function localDistillationAnswer(profile: CorpusProfile, distillation: DistillationProfile, fullText?: FullTextIndex | null): AssistantResponse {
  const themeLines = distillation.themes
    .map(
      (theme, index) =>
        `${index + 1}. ${theme.label}: ${theme.count} target papers, ${theme.pdfSaved} saved PDFs, years ${theme.years}. Guiding question: ${theme.question}`
    )
    .join("\n");
  const eraLines = distillation.eras
    .map((era) => `- ${era.label}: ${era.focus} (${era.count} target papers, ${era.pdfSaved} saved PDFs)`)
    .join("\n");
  const representativeRecords = distillation.themes.flatMap((theme) => theme.representativeRecords).slice(0, 8);

  return {
    message: {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: [
        "I will answer from the local distillation map first:",
        "",
        "Theme strands:",
        themeLines || "No theme strands are available yet.",
        "",
        "Timeline:",
        eraLines || "No timeline is available yet.",
        "",
        `Coverage: ${distillation.targetCount} target papers, ${profile.summary.pdfSaved} saved full texts, and ${distillation.missingPdf.length} target PDFs still pending. ${fullTextStatusLine(fullText)} Missing full texts can support bibliographic-level judgment, but not detailed full-text claims.`,
        "",
        evidenceBoundary(profile, distillation, fullText)
      ].join("\n")
    },
    provider: "disabled",
    model: "local-rules",
    quotaLabel: "unlimited",
    citations: representativeRecords.map(distillationRecordCitation)
  };
}

function localCoverageAnswer(profile: CorpusProfile, distillation: DistillationProfile, fullText?: FullTextIndex | null): AssistantResponse {
  const missing = distillation.missingPdf;
  const missingLines = missing
    .slice(0, 10)
    .map(
      (record, index) =>
        `${index + 1}. ${record.year || "n.d."} · ${record.title}${record.doi ? ` · DOI: ${record.doi}` : ""} · ${record.role}`
    )
    .join("\n");
  const firstAuthorMissing = missing.filter((record) => /first/i.test(record.role)).length;
  const correspondingMissing = missing.filter((record) => /corresponding/i.test(record.role)).length;

  return {
    message: {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: [
        "These judgments should remain cautious:",
        "",
        `1. Coverage limit: ${distillation.targetCount} target papers, ${profile.summary.pdfSaved} saved full texts, and ${missing.length} target PDFs still pending. ${fullTextStatusLine(fullText)}`,
        `2. Role limit: the missing list includes ${firstAuthorMissing} first-author-related papers and ${correspondingMissing} corresponding-author-related papers. Some papers may belong to both groups, so these counts should not simply be added together.`,
        "3. Claim limit: for missing papers, we can judge bibliography, abstract, DOI, source, and acquisition route, but not method details, scale items, statistical models, effect sizes, discussion boundaries, or exact wording.",
        "4. Theme limit: early CSCL/knowledge building, TPACK/STEM-TPACK, teacher development, and some AI learning intention papers still have gaps. These strand-level judgments should be finalized only after the PDFs are added.",
        "",
        "Priority missing targets:",
        missingLines || "There are no missing target PDFs right now.",
        missing.length > 10 ? `\n${missing.length - 10} more papers are not expanded here. Check the PDF completion queue for the full list.` : ""
      ].join("\n")
    },
    provider: "disabled",
    model: "local-rules",
    quotaLabel: "unlimited",
    citations: missing.slice(0, 10).map((record) => `${record.year || "n.d."} | ${record.title}${record.doi ? ` | DOI: ${record.doi}` : ""}`)
  };
}

function localAnswer(
  messages: ChatMessage[],
  profile: CorpusProfile,
  distillation?: DistillationProfile | null,
  fullText?: FullTextIndex | null
): AssistantResponse {
  const question = lastUserMessage(messages);
  if (distillation && wantsCoverageCaution(question)) return localCoverageAnswer(profile, distillation, fullText);
  if (distillation && wantsDistillation(question)) return localDistillationAnswer(profile, distillation, fullText);

  const records = retrieveRecords(profile, question || "AI education teacher learning", 5);
  const pdfHits = retrieveFullText(fullText, question || "AI education teacher learning", 3);
  const recordLines = records.length
    ? records.map((record, index) => compactRecordLine(record, index)).join("\n")
    : "No Web of Science records have been imported yet.";
  const fullTextLines = pdfHits.length
    ? pdfHits
        .map(
          (hit, index) =>
            `${index + 1}. ${hit.record.title} (${hit.record.year || "n.d."}, ${hit.evidenceId}): ${hit.excerpt.slice(0, 520)}`
        )
        .join("\n")
    : "";
  const answerLead = pdfHits.length
    ? `I can answer first from ${pdfHits.length} local PDF evidence chunk(s) closest to this question; the judgments below prioritize those saved PDF passages.`
    : "This question did not match a saved PDF evidence chunk. I will position it with WoS records, abstracts, and the distillation map, but the conclusion should be checked against PDFs before final use.";
  const themeHint = distillation?.themes?.length
    ? `The distillation map is ready: ${distillation.themes
        .slice(0, 3)
        .map((theme) => theme.label)
        .join("; ")}. You can ask for a theme-based distillation of Prof. Chai's research trajectory.`
    : "";

  return {
    message: {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: [
        "I will answer first from the local corpus index:",
        "",
        "Verifiable judgment:",
        answerLead,
        "",
        "Relevant records:",
        recordLines,
        "",
        fullTextLines ? `Matched evidence chunks:\n${fullTextLines}` : fullTextStatusLine(fullText),
        "",
        evidenceBoundary(profile, distillation, fullText),
        "",
        profile.summary.total
          ? `The corpus contains ${profile.summary.total} records, including ${profile.summary.firstAuthor} first-author records and ${profile.summary.correspondingAuthor} corresponding-author records.`
          : "Place the Web of Science export files in data/wos/, then run npm run import:wos.",
        themeHint
      ].join("\n")
    },
    provider: "disabled",
    model: "local-rules",
    quotaLabel: "unlimited",
    citations: [...fullTextCitations(pdfHits), ...citations(records)].slice(0, 10)
  };
}

function systemPrompt(profile: CorpusProfile, context: string, pdfContext: string, distillation?: DistillationProfile | null) {
  return [
    "You are AI Prof. Chai, a research trajectory and academic planning assistant.",
    "Your task is to help users understand Prof. Chai's paper corpus, research themes, concept evolution, methodological lineage, and evidence-bounded research judgments.",
    "Answer only from the user's question and the local Web of Science corpus context below. Do not fabricate papers, years, DOIs, citations, or full-text details.",
    "Do not impersonate Prof. Chai or imply that the answer represents the real person's view.",
    "Use the local distillation map as a route map. If the user asks about themes, periods, evolution, or distillation, organize the answer around it.",
    "Local PDF full texts are split into question-matched evidence chunks. Prioritize these chunks when they are relevant, and do not treat the entire paper as equally supporting evidence.",
    "When using PDF evidence, cite Evidence ID, year, and paper title. If the evidence only supports a partial judgment, state that boundary directly.",
    "If the corpus is insufficient, explain the gap and suggest which records or full texts need to be added.",
    "Answer in the user's language; default to English when the user's language is unclear. Keep the answer concise, precise, and actionable.",
    `Corpus overview: ${profile.summary.total} total records; ${profile.summary.firstAuthor} first-author records; ${profile.summary.correspondingAuthor} corresponding-author records.`,
    "Local distillation map:",
    distillationContext(distillation),
    "Local PDF full-text evidence:",
    pdfContext,
    "Relevant corpus records:",
    context
  ].join("\n");
}

export async function answerWithAssistant(
  messages: ChatMessage[],
  profile: CorpusProfile,
  distillation?: DistillationProfile | null,
  fullText?: FullTextIndex | null
): Promise<AssistantResponse> {
  const config = getAssistantConfig();
  const question = lastUserMessage(messages);
  const records = retrieveRecords(profile, question || "AI education teacher learning", 8);
  const pdfHits = retrieveFullText(fullText, question || "AI education teacher learning", 5);
  const recordCitations = citations(records);
  const pdfCitations = fullTextCitations(pdfHits);

  if (config.provider === "disabled" || !config.tokens.length) return localAnswer(messages, profile, distillation, fullText);

  const recentMessages = messages.slice(-8).map((message) => ({ role: message.role, content: message.content }));
  const requestMessages = [
        { role: "system", content: systemPrompt(profile, corpusContext(records), fullTextContext(pdfHits), distillation) },
        ...recentMessages
      ];
  let lastError = "";

  for (const [index, token] of config.tokens.entries()) {
    let remaining = quotaLabel(config);
    try {
      await assertProviderBalance(config, token);
      remaining = claimQuota(config);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Model balance or local quota check failed.";
      continue;
    }

    const response = await postChatCompletion(config, token, requestMessages, config.maxTokens, config.temperature);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      lastError = `${config.provider} token ${index + 1}/${config.tokens.length} returned HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`;
      if (retryWithNextToken(response.status)) continue;
      break;
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error(`${config.provider} returned an unreadable response format.`);

    return {
      message: {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content
      },
      provider: config.provider,
      model: config.model,
      quotaLabel: remaining,
      citations: [...pdfCitations, ...recordCitations].slice(0, 12)
    };
  }

  throw new Error(lastError || `All ${config.provider} tokens are unavailable.`);
}

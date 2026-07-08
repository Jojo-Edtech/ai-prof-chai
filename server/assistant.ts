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
  if (config.dailyLimit <= 0) return "不限额";
  const current = used ?? readQuota(config).used;
  return `${Math.max(0, config.dailyLimit - current)}/${config.dailyLimit}`;
}

function claimQuota(config: ProviderConfig) {
  if (config.dailyLimit <= 0) return quotaLabel(config);
  const today = new Date().toISOString().slice(0, 10);
  const state = readQuota(config);
  const nextState = state.date === today ? state : { date: today, used: 0 };
  if (nextState.used >= config.dailyLimit) throw new Error(`今日 ${config.projectId} 的模型额度已用完。`);
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
        ? "阿里云百炼 DashScope"
        : config.provider === "modelscope"
          ? "魔搭 ModelScope"
          : "未启用";
  const tokenLabel = config.tokens.length > 1 ? `${config.tokens.length} 枚 token` : "1 枚 token";

  return {
    configured,
    provider: config.provider,
    model: config.model,
    projectId: config.projectId,
    quotaLabel: quotaLabel(config),
    tokenCount: config.tokens.length,
    setupHint: configured
      ? config.provider === "deepseek"
        ? `已配置 ${providerName}（${tokenLabel}），本地每日额度 ${quotaLabel(config)}；DeepSeek 会先查余额再调用。`
        : `已配置 ${providerName}（${tokenLabel}），本地每日额度 ${quotaLabel(config)}。`
      : `未配置 ${providerName} token，目前使用本地规则回答。`
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
  return `${currency || "UNKNOWN"} ${total.toFixed(2)}（下限 ${floor.toFixed(2)}）`;
}

async function assertProviderBalance(config: ProviderConfig, token: string) {
  if (config.provider !== "deepseek") return;
  if (!config.balanceEndpoint) throw new Error("DeepSeek 余额检查端点未配置，已停止调用。");

  const response = await fetch(config.balanceEndpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "ai-prof-chai/0.1"
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`DeepSeek 余额检查失败：HTTP ${response.status}${body ? `：${body.slice(0, 120)}` : ""}`);
  }

  const payload = (await response.json()) as DeepSeekBalanceResponse;
  if (payload.is_available === false) {
    throw new Error("DeepSeek 余额不足，已停止调用，避免继续扣费。");
  }

  const balances = (payload.balance_infos || [])
    .map((info) => {
      const currency = (info.currency || "").toUpperCase();
      const total = balanceAmount(info.total_balance);
      return { currency, total, floor: balanceFloor(config, currency) };
    })
    .filter((info) => info.currency);

  if (!balances.length) {
    throw new Error("DeepSeek 余额检查没有返回可读余额，已停止调用。");
  }

  if (!balances.some((info) => info.total > info.floor)) {
    throw new Error(`DeepSeek 余额已低于本地保护线：${balances.map((info) => formatBalance(info.currency, info.total, info.floor)).join(" / ")}。`);
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
      message: "AI 对话当前未启用。"
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
          ? "还没有检测到 DeepSeek API key。"
          : config.provider === "modelscope"
            ? "还没有检测到魔搭 ModelScope token。"
            : "还没有检测到模型 token。"
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
        lastMessage = error instanceof Error ? error.message : "模型余额或本地额度检查失败。";
        continue;
      }

      const response = await postChatCompletion(
        config,
        token,
        [
          { role: "system", content: "你是一个连接检查助手。只用中文简短回答。" },
          { role: "user", content: "回复“已接通”即可。" }
        ],
        16,
        0
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        lastMessage = `${config.provider} token ${index + 1}/${config.tokens.length} 返回 HTTP ${response.status}${body ? `：${body.slice(0, 120)}` : ""}`;
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
          ? `AI 对话已接通：${content}${config.tokens.length > 1 ? `（使用 token ${index + 1}/${config.tokens.length}）` : ""}`
          : `${config.provider} 已响应，但返回格式没有可读文本。`
      };
    }

    return {
      ok: false,
      provider: config.provider,
      model: config.model,
      quotaLabel: quotaLabel(config),
      message: lastMessage || "所有模型 token 均未通过连接检查。"
    };
  } catch (error) {
    return {
      ok: false,
      provider: config.provider,
      model: config.model,
      quotaLabel: quotaLabel(config),
      message: error instanceof Error ? error.message : "AI 对话连接检查失败。"
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
  if (!distillation?.themes?.length) return "暂无本地蒸馏地图。";
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
    eraLines || "- 暂无时间线。",
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
  if (!fullText) return "全文索引尚未生成。";
  const evidenceChunks = fullText.summary.evidenceChunks ?? countEvidenceChunks(fullText);
  return `全文索引已生成：${fullText.summary.indexed}/${fullText.summary.targetPdfSaved} 篇已保存目标 PDF、约 ${evidenceChunks} 个 evidence chunks 可检索。`;
}

function roleLabel(record: { isFirstAuthor?: boolean; isCorrespondingAuthor?: boolean }) {
  if (record.isFirstAuthor && record.isCorrespondingAuthor) return "第一作者/通讯作者";
  if (record.isFirstAuthor) return "第一作者";
  if (record.isCorrespondingAuthor) return "通讯作者";
  return "合作者";
}

function compactRecordLine(record: ReturnType<typeof retrieveRecords>[number], index: number) {
  return `${index + 1}. ${record.title}（${record.year || "n.d."}，${roleLabel(record)}${record.doi ? `，DOI: ${record.doi}` : ""}）`;
}

function evidenceBoundary(profile: CorpusProfile, distillation?: DistillationProfile | null, fullText?: FullTextIndex | null) {
  const missing = distillation?.missingPdf.length ?? profile.summary.pdfNeeded;
  const indexed = fullText?.summary.indexed ?? 0;
  const saved = fullText?.summary.targetPdfSaved ?? profile.summary.pdfSaved;
  const evidenceChunks = fullText ? (fullText.summary.evidenceChunks ?? countEvidenceChunks(fullText)) : 0;
  return `证据边界：当前已保存并索引 ${indexed}/${saved} 篇目标 PDF，拆成约 ${evidenceChunks} 个 evidence chunks；仍缺 ${missing} 篇目标 PDF。涉及缺失全文的判断只能先作为题录层判断。`;
}

function localDistillationAnswer(profile: CorpusProfile, distillation: DistillationProfile, fullText?: FullTextIndex | null): AssistantResponse {
  const themeLines = distillation.themes
    .map(
      (theme, index) =>
        `${index + 1}. ${theme.label}：${theme.count} 篇目标论文，已存 ${theme.pdfSaved} 篇 PDF，跨度 ${theme.years}。核心问题：${theme.question}`
    )
    .join("\n");
  const eraLines = distillation.eras
    .map((era) => `- ${era.label}：${era.focus}（${era.count} 篇目标论文，${era.pdfSaved} 篇 PDF）`)
    .join("\n");
  const representativeRecords = distillation.themes.flatMap((theme) => theme.representativeRecords).slice(0, 8);

  return {
    message: {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: [
        "我先用本地蒸馏地图回答：",
        "",
        "主题线：",
        themeLines || "暂无主题线。",
        "",
        "时间线：",
        eraLines || "暂无时间线。",
        "",
        `覆盖情况：目标论文 ${distillation.targetCount} 篇，已存全文 ${profile.summary.pdfSaved} 篇，还有 ${distillation.missingPdf.length} 篇目标 PDF 待补。${fullTextStatusLine(fullText)}缺全文的论文可以做题录层面的判断，但不能展开全文细节。`,
        "",
        evidenceBoundary(profile, distillation, fullText)
      ].join("\n")
    },
    provider: "disabled",
    model: "local-rules",
    quotaLabel: "不限额",
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
        "这些判断需要保持谨慎：",
        "",
        `1. 覆盖率限制：目标论文 ${distillation.targetCount} 篇，已存全文 ${profile.summary.pdfSaved} 篇，还有 ${missing.length} 篇目标 PDF 待补。${fullTextStatusLine(fullText)}`,
        `2. 角色限制：缺失清单中第一作者相关 ${firstAuthorMissing} 篇，通讯作者相关 ${correspondingMissing} 篇；有些论文可能同时属于两类，所以不能简单相加为总数。`,
        "3. 结论限制：对缺失论文只能做题录、摘要、DOI、来源和下载路线层面的判断；不能确认全文中的方法细节、量表条目、统计模型、效应量、讨论边界或具体引用措辞。",
        "4. 主题限制：早期 CSCL/知识建构、TPACK/STEM-TPACK、教师发展和部分 AI 学习意向论文仍有缺口；这些主题的阶段性判断要等 PDF 补齐后再定稿。",
        "",
        "优先补齐的缺失目标：",
        missingLines || "当前没有缺失目标 PDF。",
        missing.length > 10 ? `\n还有 ${missing.length - 10} 篇未在这里展开，可查看 PDF 补齐队列。` : ""
      ].join("\n")
    },
    provider: "disabled",
    model: "local-rules",
    quotaLabel: "不限额",
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
    : "当前还没有导入 WoS 记录。";
  const fullTextLines = pdfHits.length
    ? pdfHits
        .map(
          (hit, index) =>
            `${index + 1}. ${hit.record.title}（${hit.record.year || "n.d."}，${hit.evidenceId}）：${hit.excerpt.slice(0, 520)}`
        )
        .join("\n")
    : "";
  const answerLead = pdfHits.length
    ? `可以先基于 ${pdfHits.length} 条和当前问题最贴近的本地 PDF evidence chunks 回答；下面的判断优先来自这些已保存 PDF 段落。`
    : "当前问题没有命中已保存 PDF evidence chunk；我先用 WoS 题录、摘要和蒸馏地图定位，结论需要回到 PDF 再确认。";
  const themeHint = distillation?.themes?.length
    ? `蒸馏地图已生成：${distillation.themes
        .slice(0, 3)
        .map((theme) => theme.label)
        .join("；")}。你可以问“按主题蒸馏蔡老师研究脉络”。`
    : "";

  return {
    message: {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: [
        "我现在先用本地语料索引回答：",
        "",
        "可验证判断：",
        answerLead,
        "",
        "相关题录：",
        recordLines,
        "",
        fullTextLines ? `Evidence chunks 命中：\n${fullTextLines}` : fullTextStatusLine(fullText),
        "",
        evidenceBoundary(profile, distillation, fullText),
        "",
        profile.summary.total
          ? `语料中共有 ${profile.summary.total} 条记录，其中第一作者 ${profile.summary.firstAuthor} 条，通讯作者 ${profile.summary.correspondingAuthor} 条。`
          : "请先把 Web of Science 导出文件放入 data/wos/，再运行 npm run import:wos。",
        themeHint
      ].join("\n")
    },
    provider: "disabled",
    model: "local-rules",
    quotaLabel: "不限额",
    citations: [...fullTextCitations(pdfHits), ...citations(records)].slice(0, 10)
  };
}

function systemPrompt(profile: CorpusProfile, context: string, pdfContext: string, distillation?: DistillationProfile | null) {
  return [
    "你是 AI 蔡老师，一个研究脉络整理助手。",
    "你的任务是帮助用户理解蔡老师的论文集合、研究主题、概念演化、方法谱系和可整理的研究判断。",
    "只基于用户提供的问题和下方本地 Web of Science 语料上下文回答。不要编造文献、年份、DOI、引用或全文细节。",
    "公开回答中只使用“蔡老师”这一称呼，不输出或推断英文全名。",
    "本地蒸馏地图可以作为组织回答的路线图；如果用户问主题、阶段、演化或蒸馏，请优先用它组织答案。",
    "本地 PDF 全文证据已经拆成和问题匹配的 evidence chunks。回答时优先结合这些 chunk 的具体内容，不要把整篇文章都当成同等证据。",
    "当使用 PDF 证据时，请用 Evidence ID、年份和论文题名说明依据；如果证据只支持局部判断，要直接说清楚局部边界。",
    "如果语料不足，直接说明缺口，并建议需要导入哪些记录或全文。",
    "回答默认用中文，保持短、准、可执行。",
    `语料概览：总计 ${profile.summary.total} 条；第一作者 ${profile.summary.firstAuthor} 条；通讯作者 ${profile.summary.correspondingAuthor} 条。`,
    "本地蒸馏地图：",
    distillationContext(distillation),
    "本地 PDF 全文证据：",
    pdfContext,
    "相关语料：",
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
      lastError = error instanceof Error ? error.message : "模型余额或本地额度检查失败。";
      continue;
    }

    const response = await postChatCompletion(config, token, requestMessages, config.maxTokens, config.temperature);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      lastError = `${config.provider} token ${index + 1}/${config.tokens.length} 返回 HTTP ${response.status}${body ? `：${body.slice(0, 160)}` : ""}`;
      if (retryWithNextToken(response.status)) continue;
      break;
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error(`${config.provider} 返回格式无法解析。`);

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

  throw new Error(lastError || `${config.provider} 所有 token 均不可用。`);
}

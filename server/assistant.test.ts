import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CorpusProfile, DistillationProfile, FullTextIndex } from "../src/shared/types";
import { answerWithAssistant, assistantStatus, checkAssistantConnection, getAssistantConfig } from "./assistant";

const originalEnv = { ...process.env };

const profile: CorpusProfile = {
  generatedAt: "2026-07-07T00:00:00.000Z",
  sourceFiles: ["sample.tsv"],
  professor: {
    displayName: "Chai Ching Sing",
    assistantName: "AI Prof. Chai",
    aliases: ["Chai CS"]
  },
  summary: {
    total: 1,
    firstAuthor: 1,
    correspondingAuthor: 1,
    firstOrCorresponding: 1,
    openAccess: 0,
    pdfSaved: 1,
    pdfNeeded: 0
  },
  records: [
    {
      id: "record-1",
      title: "Teacher learning with AI",
      year: "2026",
      source: "Journal of AI Education",
      documentType: "Article",
      doi: "10.1234/teacher-ai",
      doiUrl: "https://doi.org/10.1234/teacher-ai",
      authors: ["Chai, CS"],
      fullAuthors: ["Chai, Ching Sing"],
      keywords: ["artificial intelligence", "teacher learning"],
      abstract: "Teacher learning with artificial intelligence.",
      correspondingAddress: "Chai, Ching Sing",
      emails: [],
      openAccess: "",
      oaUrl: "",
      isFirstAuthor: true,
      isCorrespondingAuthor: true,
      pdfFile: "2026-teacher-learning-with-ai-10_1234_teacher-ai.pdf",
      downloadStatus: "pdf-saved",
      sourceFile: "sample.tsv"
    }
  ]
};

const distillation: DistillationProfile = {
  generatedAt: "2026-07-07T00:00:00.000Z",
  sourceGeneratedAt: profile.generatedAt,
  professor: profile.professor,
  summary: profile.summary,
  targetCount: 1,
  pdfCoverage: 1,
  themes: [
    {
      id: "ai-learning-intention",
      label: "AI learning intention and motivation",
      question: "学生或教师为什么愿意持续学习、教授和使用 AI？",
      count: 1,
      pdfSaved: 1,
      years: "2026",
      representativeRecords: [
        {
          title: "Teacher learning with AI",
          year: "2026",
          source: "Journal of AI Education",
          doi: "10.1234/teacher-ai",
          downloadStatus: "pdf-saved"
        }
      ]
    }
  ],
  eras: [
    {
      id: "ai-expansion",
      label: "2020-2026 AI education expansion",
      focus: "从技术整合转向 AI 学习动机与教师持续意向。",
      count: 1,
      pdfSaved: 1,
      representativeRecords: [
        {
          title: "Teacher learning with AI",
          year: "2026",
          source: "Journal of AI Education",
          doi: "10.1234/teacher-ai",
          downloadStatus: "pdf-saved"
        }
      ]
    }
  ],
  missingPdf: []
};

const fullText: FullTextIndex = {
  generatedAt: "2026-07-07T00:00:00.000Z",
  sourceGeneratedAt: profile.generatedAt,
  professor: profile.professor,
  summary: {
    targetPdfSaved: 1,
    indexed: 1,
    failed: 0,
    totalTextLength: 100,
    maxTextCharsPerPdf: 120000
  },
  records: [
    {
      id: "record-1",
      title: "Teacher learning with AI",
      year: "2026",
      source: "Journal of AI Education",
      doi: "10.1234/teacher-ai",
      pdfFile: "2026-teacher-learning-with-ai-10_1234_teacher-ai.pdf",
      pdfPath: "data/pdfs/2026-teacher-learning-with-ai-10_1234_teacher-ai.pdf",
      status: "indexed",
      pageCount: 10,
      textLength: 100,
      text: "Teacher learning with artificial intelligence motivation and classroom adoption evidence."
    }
  ]
};

describe("assistant configuration", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("defaults to ModelScope with local token guardrails", () => {
    delete process.env.AI_PROF_CHAI_AI_PROVIDER;
    delete process.env.AI_PROF_CHAI_MODELSCOPE_API_TOKENS;
    delete process.env.AI_PROF_CHAI_MODELSCOPE_API_TOKEN;
    delete process.env.MODELSCOPE_API_TOKENS;
    delete process.env.MODELSCOPE_API_TOKEN;
    delete process.env.MODELSCOPE_API_KEY;
    delete process.env.AI_PROF_CHAI_DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.AI_PROF_CHAI_DAILY_LIMIT;
    delete process.env.AI_PROF_CHAI_MAX_TOKENS;

    const config = getAssistantConfig();

    expect(config.provider).toBe("modelscope");
    expect(config.model).toBe("Qwen/Qwen3-30B-A3B-Instruct-2507");
    expect(config.endpoint).toBe("https://api-inference.modelscope.cn/v1/chat/completions");
    expect(config.dailyLimit).toBe(50);
    expect(config.maxTokens).toBe(1100);
  });

  it("uses common DeepSeek key aliases", () => {
    delete process.env.AI_PROF_CHAI_DEEPSEEK_API_TOKENS;
    delete process.env.AI_PROF_CHAI_DEEPSEEK_API_KEY;
    process.env.AI_PROF_CHAI_AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "sample-deepseek-key";

    expect(getAssistantConfig().token).toBe("sample-deepseek-key");
  });

  it("uses a de-duplicated DeepSeek key pool", () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_TOKEN;
    process.env.AI_PROF_CHAI_AI_PROVIDER = "deepseek";
    process.env.AI_PROF_CHAI_DEEPSEEK_API_TOKENS = "key-one, key-two key-one";

    const config = getAssistantConfig();
    expect(config.token).toBe("key-one");
    expect(config.tokens).toEqual(["key-one", "key-two"]);
    expect(assistantStatus().tokenCount).toBe(2);
  });

  it("stops DeepSeek checks before chat when balance is below the local floor", async () => {
    process.env.AI_PROF_CHAI_AI_PROVIDER = "deepseek";
    process.env.AI_PROF_CHAI_DEEPSEEK_API_KEY = "sample-deepseek-key";
    process.env.AI_PROF_CHAI_MIN_BALANCE_USD = "0.20";
    const urls: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          is_available: true,
          balance_infos: [{ currency: "USD", total_balance: "0.01", granted_balance: "0.01", topped_up_balance: "0.00" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const result = await checkAssistantConnection();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("余额");
    expect(urls).toEqual(["https://api.deepseek.com/user/balance"]);
  });

  it("uses common ModelScope token aliases", () => {
    delete process.env.AI_PROF_CHAI_MODELSCOPE_API_TOKENS;
    delete process.env.AI_PROF_CHAI_MODELSCOPE_API_TOKEN;
    process.env.AI_PROF_CHAI_AI_PROVIDER = "modelscope";
    process.env.MODELSCOPE_API_TOKEN = "sample-token";

    expect(getAssistantConfig().token).toBe("sample-token");
  });

  it("uses a de-duplicated ModelScope token pool", () => {
    delete process.env.MODELSCOPE_API_TOKEN;
    delete process.env.MODELSCOPE_API_KEY;
    process.env.AI_PROF_CHAI_AI_PROVIDER = "modelscope";
    process.env.AI_PROF_CHAI_MODELSCOPE_API_TOKENS = "token-one, token-two token-one";

    const config = getAssistantConfig();
    expect(config.token).toBe("token-one");
    expect(config.tokens).toEqual(["token-one", "token-two"]);
    expect(assistantStatus().tokenCount).toBe(2);
  });

  it("reports a clear connection-check message when no token is configured", async () => {
    delete process.env.AI_PROF_CHAI_MODELSCOPE_API_TOKENS;
    delete process.env.AI_PROF_CHAI_MODELSCOPE_API_TOKEN;
    delete process.env.MODELSCOPE_API_TOKENS;
    delete process.env.MODELSCOPE_API_TOKEN;
    delete process.env.MODELSCOPE_API_KEY;
    process.env.AI_PROF_CHAI_AI_PROVIDER = "modelscope";

    const result = await checkAssistantConnection();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("还没有检测到魔搭 ModelScope token");
  });

  it("answers distillation questions from the local map when no token is configured", async () => {
    process.env.AI_PROF_CHAI_AI_PROVIDER = "disabled";

    const response = await answerWithAssistant(
      [{ id: "user-1", role: "user", content: "帮我按主题蒸馏蔡老师研究脉络" }],
      profile,
      distillation
    );

    expect(response.provider).toBe("disabled");
    expect(response.message.content).toContain("本地蒸馏地图");
    expect(response.message.content).toContain("AI learning intention and motivation");
    expect(response.citations[0]).toContain("Teacher learning with AI");
  });

  it("uses indexed PDF excerpts in local answers", async () => {
    process.env.AI_PROF_CHAI_AI_PROVIDER = "disabled";

    const response = await answerWithAssistant(
      [{ id: "user-2", role: "user", content: "根据PDF说说AI学习动机证据" }],
      profile,
      distillation,
      fullText
    );

    expect(response.message.content).toContain("Evidence chunks 命中");
    expect(response.message.content).toContain("artificial intelligence motivation");
    expect(response.message.content).toContain("证据边界");
    expect(response.citations[0]).toContain("local PDF");
  });

  it("answers missing-PDF caution questions from the coverage gap", async () => {
    process.env.AI_PROF_CHAI_AI_PROVIDER = "disabled";
    const gapDistillation: DistillationProfile = {
      ...distillation,
      missingPdf: [
        {
          title: "Missing AI learning paper",
          year: "2024",
          source: "Sample Journal",
          doi: "10.1234/missing-ai",
          expectedPath: "data/pdfs/missing-ai.pdf",
          role: "first_author"
        }
      ]
    };

    const response = await answerWithAssistant(
      [{ id: "user-3", role: "user", content: "哪些结论要因为缺失 PDF 而保持谨慎？" }],
      profile,
      gapDistillation,
      fullText
    );

    expect(response.message.content).toContain("这些判断需要保持谨慎");
    expect(response.message.content).toContain("Missing AI learning paper");
    expect(response.citations[0]).toContain("10.1234/missing-ai");
  });
});

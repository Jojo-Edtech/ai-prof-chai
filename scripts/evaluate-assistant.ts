import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answerWithAssistant, assistantStatus } from "../server/assistant";
import { loadCorpus } from "../server/corpus";
import { loadDistillation } from "../server/distillation";
import { loadLocalEnv } from "../server/env";
import { loadFullTextIndex } from "../server/fulltext";
import type { AssistantResponse, ChatMessage } from "../src/shared/types";

type EvaluationCase = {
  id: string;
  question: string;
  focus: string;
};

type EvaluationResult = EvaluationCase & {
  answer: AssistantResponse;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "outputs");
const mdOutputPath = path.join(outputDir, "ai-prof-chai-local-eval.md");
const jsonOutputPath = path.join(outputDir, "ai-prof-chai-local-eval.json");

const cases: EvaluationCase[] = [
  {
    id: "distillation-mainline",
    question: "只看第一作者和通讯作者文章，按主题蒸馏蔡老师研究脉络。",
    focus: "能否调用本地蒸馏地图，概括主题线和阶段线。"
  },
  {
    id: "tpack-evidence",
    question: "根据已保存 PDF，说说 TPACK 和 STEM-TPACK 相关证据。",
    focus: "能否从全文索引中检索技术教学法知识相关证据。"
  },
  {
    id: "knowledge-building-cscl",
    question: "知识建构和 CSCL 这条线索有哪些代表论文？",
    focus: "能否把题录检索和全文命中结合起来。"
  },
  {
    id: "coverage-caution",
    question: "哪些结论要因为 15 篇目标 PDF 缺失而保持谨慎？",
    focus: "能否主动提示覆盖缺口，不把题录层判断当作全文结论。"
  }
];

function bulletList(values: string[]) {
  if (!values.length) return "- 无";
  return values.map((value) => `- ${value}`).join("\n");
}

async function runCase(testCase: EvaluationCase): Promise<EvaluationResult> {
  const messages: ChatMessage[] = [{ id: `eval-${testCase.id}`, role: "user", content: testCase.question }];
  const answer = await answerWithAssistant(messages, loadCorpus(projectRoot), loadDistillation(projectRoot), loadFullTextIndex(projectRoot));
  return { ...testCase, answer };
}

async function main() {
  loadLocalEnv(projectRoot);
  const configuredStatus = assistantStatus();

  process.env.AI_PROF_CHAI_AI_PROVIDER = "disabled";
  const localStatus = assistantStatus();
  const profile = loadCorpus(projectRoot);
  const fullText = loadFullTextIndex(projectRoot);
  const distillation = loadDistillation(projectRoot);
  const generatedAt = new Date().toISOString();
  const results = await Promise.all(cases.map(runCase));

  const lines = [
    "# AI Prof. Chai 本地问答评测",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## 范围",
    "",
    "本评测只使用本地规则助手，不调用 DeepSeek、魔搭 ModelScope、阿里云百炼 DashScope 或任何外部模型，因此在 API key 未配置前也可以反复运行。",
    "",
    "## 语料快照",
    "",
    `- WoS records: ${profile.summary.total}`,
    `- First-author records: ${profile.summary.firstAuthor}`,
    `- Corresponding-author records: ${profile.summary.correspondingAuthor}`,
    `- Target records: ${profile.summary.firstOrCorresponding}`,
    `- Saved target PDFs: ${profile.summary.pdfSaved}`,
    `- Missing target PDFs: ${profile.summary.pdfNeeded}`,
    `- Full-text index: ${fullText?.summary.indexed ?? 0}/${fullText?.summary.targetPdfSaved ?? 0} indexed`,
    `- Distillation themes: ${distillation?.themes.length ?? 0}`,
    "",
    "## 助手配置",
    "",
    `- 已配置 provider: ${configuredStatus.provider}`,
    `- 已配置 model: ${configuredStatus.model}`,
    `- 模型 token 已配置: ${configuredStatus.configured ? "yes" : "no"} (${configuredStatus.tokenCount} saved)`,
    `- 评测 provider: ${localStatus.provider}`,
    `- 评测 model: ${localStatus.model}`,
    "",
    "## 评测问题",
    "",
    ...results.flatMap((result, index) => [
      `### ${index + 1}. ${result.question}`,
      "",
      `检查点：${result.focus}`,
      "",
      result.answer.message.content,
      "",
      "引用线索：",
      bulletList(result.answer.citations),
      ""
    ]),
    "## 阅读提示",
    "",
    "本地助手适合快速导航语料和检查蒸馏方向。正式学术结论仍需要回到已保存 PDF 核对；涉及 15 篇缺失 PDF 的判断，在通过正常访问路线取得全文前应保持临时性。",
    ""
  ];

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(mdOutputPath, `${lines.join("\n")}\n`, "utf8");
  fs.writeFileSync(
    jsonOutputPath,
    JSON.stringify(
      {
        generatedAt,
        configuredStatus,
        evaluationStatus: localStatus,
        corpus: {
          total: profile.summary.total,
          firstAuthor: profile.summary.firstAuthor,
          correspondingAuthor: profile.summary.correspondingAuthor,
          targets: profile.summary.firstOrCorresponding,
          pdfSaved: profile.summary.pdfSaved,
          pdfNeeded: profile.summary.pdfNeeded,
          fullTextIndexed: fullText?.summary.indexed ?? 0,
          fullTextTargetPdfSaved: fullText?.summary.targetPdfSaved ?? 0,
          distillationThemes: distillation?.themes.length ?? 0
        },
        results
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(mdOutputPath);
  console.log(`Evaluation cases: ${results.length}`);
  console.log(`Evaluation provider: ${localStatus.provider}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Assistant evaluation failed.");
  process.exitCode = 1;
});

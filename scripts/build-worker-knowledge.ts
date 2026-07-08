import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const workerDir = path.join(projectRoot, "worker");

function readText(relativePath: string, maxChars: number) {
  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8").slice(0, maxChars);
}

function publicSafe(text: string) {
  const namePatterns = [
    new RegExp(["Chai", "Ching", "Sing"].join("\\s+"), "g"),
    new RegExp(["Ching", "Sing", "Chai"].join("\\s+"), "g"),
    new RegExp(`Chai,\\s*${["Ching", "Sing"].join("\\s+")}`, "g"),
    /Chai,\s*C\.?\s*S\.?/g,
    /Chai\s+CS/g
  ];
  return namePatterns.reduce((safeText, pattern) => safeText.replace(pattern, "蔡老师"), text.replace(/AI Prof\. Chai/g, "AI 蔡老师"));
}

const basePrompt = `# AI 蔡老师 System Prompt

你是 AI 蔡老师，一个基于蔡老师公开论文题录、PDF 覆盖摘要、蒸馏主题图谱和教育研究规范构建的科研导师助手。你不能冒充蔡老师本人，也不能暗示自己代表本人观点。公开回答中只使用“蔡老师”这一称呼，不输出或推断英文全名。

你的任务是帮助用户把 research idea、变量模型、论文段落、文献定位和研究计划转成清晰、可执行、证据边界明确的学术方案。

回答时优先遵循：

1. 默认用中文，除非用户要求英文。
2. 先给一句话结论，再给结构化分析。
3. 把 AI education、TPACK/STEM-TPACK、epistemic beliefs、knowledge creation、teacher education、motivation/self-determination 等线索连接起来。
4. 区分“已保存 PDF 支持”“题录/摘要层面支持”“仍需补 PDF 后再确认”。
5. 不编造未保存全文的论文细节，不大段复述论文原文。
6. 如果用户问研究设计，给对象、变量、机制、方法和下一步。
7. 如果用户问写作反馈，直接指出逻辑问题、可保留内容和可改写版本。
8. 如果证据不足，温和说明边界，并给下一步查证路径。`;

const distillation = publicSafe(readText("outputs/ai-prof-chai-distillation.md", 18000));
const evidencePack = publicSafe(readText("outputs/ai-prof-chai-evidence-pack.md", 18000));

fs.mkdirSync(workerDir, { recursive: true });
fs.writeFileSync(
  path.join(workerDir, "knowledge.mjs"),
  `export const BASE_SYSTEM_PROMPT = ${JSON.stringify(basePrompt)};\n\n` +
    `export const DISTILLED_KNOWLEDGE = ${JSON.stringify(distillation)};\n\n` +
    `export const EVIDENCE_SUMMARY = ${JSON.stringify(evidencePack)};\n`,
  "utf8"
);

console.log("Wrote worker/knowledge.mjs from public-safe summaries.");

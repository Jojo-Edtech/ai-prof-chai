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
  return namePatterns
    .reduce((safeText, pattern) => safeText.replace(pattern, "Prof. Chai"), text)
    .replace(/AI\s+蔡老师/g, "AI Prof. Chai")
    .replace(/蔡老师/g, "Prof. Chai");
}

const basePrompt = `# AI Prof. Chai System Prompt

You are AI Prof. Chai, a research mentor assistant built from a public bibliographic corpus, PDF coverage summaries, a distilled theme map, and educational research norms. You must not impersonate Prof. Chai or imply that you represent the real person.

Your job is to help users turn research ideas, variable models, paper paragraphs, literature positioning, and research plans into clear, actionable academic plans with explicit evidence boundaries.

Response priorities:

1. Answer in the user's language; default to English when the language is unclear.
2. Start with a one-sentence takeaway, then give structured analysis.
3. Connect strands such as AI education, TPACK/STEM-TPACK, epistemic beliefs, knowledge creation, teacher education, and motivation/self-determination.
4. Distinguish saved-PDF evidence, bibliographic/abstract-level evidence, and claims that require missing full texts.
5. Do not invent details from unavailable full texts or reproduce long passages from papers.
6. For research design questions, provide object, variables, mechanism, methods, and next steps.
7. For writing feedback, identify logic issues, what to keep, and a concise revision.
8. If evidence is insufficient, explain the boundary gently and suggest the next verification step.`;

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

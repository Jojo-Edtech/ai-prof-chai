import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAssistantConfig, parseApiTokens } from "../server/assistant";
import { loadLocalEnv } from "../server/env";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env.local");
const provider = "modelscope";
const defaultModel = "Qwen/Qwen3-30B-A3B-Instruct-2507";
const defaultBase = "https://api-inference.modelscope.cn/v1";

function mask(value: string) {
  if (!value) return "未配置";
  if (value.length <= 8) return "已配置";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function maskList(values: string[]) {
  if (!values.length) return "未配置";
  if (values.length === 1) return mask(values[0]);
  return `${values.length} 枚（${mask(values[0])} 等）`;
}

function upsertEnv(content: string, updates: Record<string, string>) {
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;
    const key = match[1];
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }

  return `${lines.filter((line, index, all) => !(index === all.length - 1 && line === "")).join("\n")}\n`;
}

function checkOnly() {
  loadLocalEnv(projectRoot);
  const config = getAssistantConfig();
  console.log(`AI provider: ${config.provider}`);
  console.log(`AI model: ${config.model}`);
  console.log(`AI token: ${maskList(config.tokens)}`);
  console.log(`AI endpoint: ${config.endpoint || "未启用"}`);
}

function hiddenPrompt(question: string) {
  return new Promise<string>((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    if (!input.isTTY) {
      reject(new Error("需要在终端中运行 npm run setup:ai，才能隐藏输入。也可以手动编辑 .env.local。"));
      return;
    }

    let value = "";
    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    const finish = () => {
      output.write("\n");
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      resolve(value.trim());
    };

    const cancel = () => {
      output.write("\n");
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      reject(new Error("已取消。"));
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === "\u0003") {
          cancel();
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= " ") value += char;
      }
    }

    input.on("data", onData);
  });
}

async function main() {
  if (process.argv.includes("--check")) {
    checkOnly();
    return;
  }

  const tokenFromEnv =
    process.env.MODELSCOPE_API_TOKENS || process.env.MODELSCOPE_API_TOKEN || process.env.MODELSCOPE_API_KEY || "";
  const rawToken = tokenFromEnv || (await hiddenPrompt("粘贴魔搭 ModelScope token（多个可用逗号分隔），回车保存："));
  const tokens = parseApiTokens(rawToken).filter((token) => token.length >= 8);
  if (!tokens.length) throw new Error("没有读取到有效魔搭 ModelScope token，未写入配置。");

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const next = upsertEnv(current, {
    AI_PROF_CHAI_AI_PROVIDER: provider,
    AI_PROF_CHAI_MODELSCOPE_API_TOKENS: tokens.join(","),
    AI_PROF_CHAI_MODELSCOPE_API_TOKEN: tokens[0],
    AI_PROF_CHAI_MODELSCOPE_MODEL: defaultModel,
    AI_PROF_CHAI_MODELSCOPE_API_BASE: defaultBase,
    AI_PROF_CHAI_DAILY_LIMIT: "50",
    AI_PROF_CHAI_MAX_TOKENS: "1100"
  });

  fs.writeFileSync(envPath, next, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
  console.log(`已写入本地私密配置：${path.relative(projectRoot, envPath)}`);
  console.log(`AI token: ${maskList(tokens)}`);
  console.log("下一步运行：npm run check:ai");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "AI token 配置失败。");
  process.exitCode = 1;
});

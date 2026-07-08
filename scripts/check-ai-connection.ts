import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAssistantConnection, getAssistantConfig } from "../server/assistant";
import { loadLocalEnv } from "../server/env";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadLocalEnv(projectRoot);

const config = getAssistantConfig();
const providerName =
  config.provider === "deepseek"
    ? "DeepSeek"
    : config.provider === "modelscope"
      ? "魔搭 ModelScope"
      : config.provider === "dashscope"
        ? "阿里云百炼 DashScope"
        : "未启用";

function fail(message: string) {
  console.error(message);
  process.exitCode = 1;
}

async function main() {
  if (config.provider === "disabled") {
    fail("AI 对话当前未启用。请先在 .env.local 中设置 AI_PROF_CHAI_AI_PROVIDER=modelscope。");
    return;
  }

  if (!config.tokens.length) {
    fail("还没有检测到魔搭 ModelScope token。请把 token 填入 .env.local 的 AI_PROF_CHAI_MODELSCOPE_API_TOKENS，或运行 npm run setup:ai。");
    return;
  }

  console.log(`正在检查 ${providerName}：${config.model}（${config.tokens.length} 枚 token）`);
  const result = await checkAssistantConnection();
  if (!result.ok) {
    fail(result.message);
    return;
  }

  console.log(result.message);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "AI 对话连接检查失败。");
});

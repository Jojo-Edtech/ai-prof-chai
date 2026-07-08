import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertLocalEnvFile } from "./env";

const originalEnv = { ...process.env };
let tmpDir = "";

describe("local env updates", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-prof-chai-env-"));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("refreshes runtime environment values when existing keys are overwritten", () => {
    const envPath = path.join(tmpDir, ".env.local");
    fs.writeFileSync(envPath, "AI_PROF_CHAI_MODELSCOPE_API_TOKEN=token-old\n", "utf8");
    process.env.AI_PROF_CHAI_MODELSCOPE_API_TOKEN = "token-old";

    upsertLocalEnvFile(tmpDir, {
      AI_PROF_CHAI_MODELSCOPE_API_TOKEN: "token-next"
    });

    expect(fs.readFileSync(envPath, "utf8")).toContain("AI_PROF_CHAI_MODELSCOPE_API_TOKEN=token-next");
    expect(process.env.AI_PROF_CHAI_MODELSCOPE_API_TOKEN).toBe("token-next");
  });
});

import fs from "node:fs";
import path from "node:path";

export function loadLocalEnv(projectRoot: string) {
  const envPath = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key]) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

export function upsertLocalEnvFile(projectRoot: string, updates: Record<string, string>) {
  const envPath = path.join(projectRoot, ".env.local");
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const seen = new Set<string>();
  const lines = current.split(/\r?\n/).map((line) => {
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

  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }

  const next = `${lines.filter((line, index, all) => !(index === all.length - 1 && line === "")).join("\n")}\n`;
  fs.writeFileSync(envPath, next, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
  return envPath;
}

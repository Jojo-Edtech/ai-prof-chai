import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type WatchState = {
  updatedAt: string;
  files: Record<string, { mtimeMs: number; size: number }>;
};

type CandidateFile = {
  key: string;
  label: string;
  filePath: string;
  safeName: string;
  mtimeMs: number;
  size: number;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportDir = path.join(projectRoot, "data", "wos-downloads");
const statePath = path.join(reportDir, "pdf-watch-state.json");
const inboxDir = path.join(projectRoot, "data", "pdf-inbox");
const downloadsDir = path.join(os.homedir(), "Downloads");
const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");
const reset = process.argv.includes("--reset");
const pollMs = Math.max(1500, Number(argValue("--interval") || 5000));
const stableMs = Math.max(1000, Number(argValue("--stable-ms") || 3000));

const watchedDirs = [
  { label: "Downloads", dir: downloadsDir, redact: true },
  { label: "pdf-inbox", dir: inboxDir, redact: false }
];

function argValue(name: string) {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function readState(): WatchState {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8")) as WatchState;
  } catch {
    return { updatedAt: new Date(0).toISOString(), files: {} };
  }
}

function writeState(state: WatchState) {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function isPdfHeader(filePath: string) {
  try {
    const handle = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(5);
    fs.readSync(handle, buffer, 0, 5, 0);
    fs.closeSync(handle);
    return buffer.toString("latin1") === "%PDF-";
  } catch {
    return false;
  }
}

function scanCandidates(): CandidateFile[] {
  const now = Date.now();
  const candidates: CandidateFile[] = [];

  for (const watched of watchedDirs) {
    fs.mkdirSync(watched.dir, { recursive: true });
    const entries = fs.readdirSync(watched.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".pdf")) continue;
      if (entry.name.endsWith(".crdownload") || entry.name.endsWith(".download")) continue;

      const filePath = path.join(watched.dir, entry.name);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs < stableMs) continue;
      if (!isPdfHeader(filePath)) continue;

      candidates.push({
        key: `${watched.label}:${filePath}`,
        label: watched.label,
        filePath,
        safeName: watched.redact ? "new PDF in Downloads" : entry.name,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
    }
  }

  return candidates.sort((left, right) => left.mtimeMs - right.mtimeMs);
}

function unseenCandidates(state: WatchState) {
  return scanCandidates().filter((candidate) => {
    const known = state.files[candidate.key];
    return !known || known.mtimeMs !== candidate.mtimeMs || known.size !== candidate.size;
  });
}

function remember(state: WatchState, candidates: CandidateFile[]) {
  for (const candidate of candidates) {
    state.files[candidate.key] = { mtimeMs: candidate.mtimeMs, size: candidate.size };
  }
  state.updatedAt = new Date().toISOString();
  writeState(state);
}

function runCommand(label: string, args: string[]) {
  if (dryRun) {
    console.log(`Dry run: would run npm ${args.join(" ")}`);
    return;
  }

  console.log(label);
  const result = spawnSync("npm", args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function runRefreshAndSync() {
  runCommand("Refreshing AI Prof. Chai corpus...", ["run", "refresh:pdfs"]);
  runCommand("Syncing Desktop project folder...", ["run", "sync:desktop"]);
}

function printCandidates(candidates: CandidateFile[]) {
  for (const candidate of candidates) {
    const sizeMb = (candidate.size / 1024 / 1024).toFixed(2);
    console.log(`Detected ${candidate.label}: ${candidate.safeName} (${sizeMb} MB)`);
  }
}

function primeState() {
  const state: WatchState = { updatedAt: new Date().toISOString(), files: {} };
  remember(state, scanCandidates());
  console.log(`Watch state reset: ${statePath}`);
  console.log("Existing PDFs are now treated as already seen.");
}

async function main() {
  if (reset) {
    primeState();
    return;
  }

  let state = readState();

  if (!fs.existsSync(statePath)) {
    remember(state, scanCandidates());
    state = readState();
    console.log("Initialized watch state from existing PDFs.");
  }

  console.log("Watching for newly downloaded Chai target PDFs.");
  console.log("Open the download pack in a normal browser, save PDFs to Downloads or data/pdf-inbox, and keep this command running.");
  console.log(`Refresh command: npm run refresh:pdfs`);

  while (true) {
    const candidates = unseenCandidates(state);
    if (candidates.length) {
      printCandidates(candidates);
      remember(state, candidates);
      runRefreshAndSync();
      state = readState();
    } else if (once) {
      console.log("No new stable PDFs detected.");
    }

    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "PDF watch failed.");
  process.exitCode = 1;
});

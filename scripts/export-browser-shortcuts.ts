import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMissingPdfQueue } from "../server/missing-pdfs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "outputs", "missing-pdf-browser-shortcuts");
const indexPath = path.join(outputDir, "index.html");
const readmePath = path.join(outputDir, "README.md");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXml(value: unknown) {
  return escapeHtml(value).replace(/'/g, "&apos;");
}

function slug(value: string) {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 74);
  return clean || "route";
}

function priorityRank(priority = "") {
  const match = priority.match(/^(\d+)/);
  return match ? Number(match[1]) : 9;
}

function recordKey(item: { doi?: string; wosAccession?: string }) {
  return item.doi || item.wosAccession || "no-id";
}

function routeFileName(index: number, year: string | undefined, title: string, label: string, routeIndex: number) {
  return `${String(index + 1).padStart(2, "0")}-${year || "nd"}-${slug(title)}-${String(routeIndex + 1).padStart(2, "0")}-${slug(label)}.webloc`;
}

function webloc(url: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>URL</key>
  <string>${escapeXml(url)}</string>
</dict>
</plist>
`;
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const queue = loadMissingPdfQueue(projectRoot);
const sortedItems = [...queue.items].sort((first, second) => {
  const priorityDiff = priorityRank(first.accessPriority) - priorityRank(second.accessPriority);
  if (priorityDiff) return priorityDiff;
  return Number(second.year || 0) - Number(first.year || 0);
});

const shortcutRows: Array<{
  title: string;
  year?: string;
  key: string;
  priority?: string;
  expectedPdfFile?: string;
  nextStep?: string;
  note?: string;
  shortcuts: Array<{ label: string; url: string; fileName: string }>;
}> = [];

sortedItems.forEach((item, index) => {
  const shortcuts = item.links.map((link, routeIndex) => {
    const fileName = routeFileName(index, item.year, item.title, link.label, routeIndex);
    fs.writeFileSync(path.join(outputDir, fileName), webloc(link.url), "utf8");
    return { ...link, fileName };
  });
  shortcutRows.push({
    title: item.title,
    year: item.year,
    key: recordKey(item),
    priority: item.accessPriority,
    expectedPdfFile: item.expectedPdfFile,
    nextStep: item.nextStep,
    note: item.note,
    shortcuts
  });
});

const readmeLines = [
  "# Missing PDF Browser Shortcuts",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Missing records: ${sortedItems.length}`,
  `Shortcut files: ${shortcutRows.reduce((sum, row) => sum + row.shortcuts.length, 0)}`,
  "",
  "Double-click a `.webloc` file on macOS to open the saved route in your normal browser. After downloading PDFs, leave them in Downloads or put them in `data/pdf-inbox/`, then run:",
  "",
  "```bash",
  "npm run refresh:pdfs",
  "```",
  "",
  "## Records",
  ""
];

for (const [index, row] of shortcutRows.entries()) {
  readmeLines.push(`### ${index + 1}. ${row.title}`, "");
  readmeLines.push(`- Year: ${row.year || "n.d."}`);
  readmeLines.push(`- Identifier: ${row.key}`);
  readmeLines.push(`- Priority: ${row.priority || "Manual route"}`);
  readmeLines.push(`- Expected PDF file: \`${row.expectedPdfFile || "not generated"}\``);
  readmeLines.push(`- Next step: ${row.nextStep || "Open the listed route in a normal browser."}`);
  if (row.shortcuts.length) {
    readmeLines.push("- Shortcuts:");
    for (const shortcut of row.shortcuts) {
      readmeLines.push(`  - \`${shortcut.fileName}\` -> ${shortcut.label}`);
    }
  } else {
    readmeLines.push("- Shortcuts: no verified URL route yet");
  }
  readmeLines.push("");
}

fs.writeFileSync(readmePath, `${readmeLines.join("\n")}\n`, "utf8");

const cards = shortcutRows
  .map(
    (row, index) => `
      <article class="card">
        <div class="head">
          <span>${index + 1}</span>
          <div>
            <p>${escapeHtml([row.year, row.key, row.priority].filter(Boolean).join(" | "))}</p>
            <h2>${escapeHtml(row.title)}</h2>
          </div>
        </div>
        <div class="plan">${escapeHtml(row.nextStep || "Open the listed route in a normal browser.")}</div>
        <div class="file"><code>${escapeHtml(row.expectedPdfFile || "not generated")}</code></div>
        <p class="note">${escapeHtml(row.note || "")}</p>
        <div class="links">
          ${row.shortcuts.length
            ? row.shortcuts
                .map(
                  (shortcut) =>
                    `<a href="${escapeHtml(shortcut.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortcut.label)}</a><a class="webloc" href="${escapeHtml(shortcut.fileName)}">.webloc</a>`
                )
                .join("")
            : "<span>No verified route yet</span>"}
        </div>
      </article>
    `
  )
  .join("\n");

fs.writeFileSync(
  indexPath,
  `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Prof. Chai Browser Shortcuts</title>
    <style>
      :root { color-scheme: light; --ink: #17202a; --muted: #5f6b7a; --line: #d7dee8; --paper: #fff; --soft: #f4f7f9; --accent: #1d6b5a; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--soft); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
      main { max-width: 1080px; margin: 0 auto; padding: 32px 20px 56px; }
      header { display: grid; gap: 10px; margin-bottom: 22px; }
      h1, h2, p { margin: 0; }
      h1 { font-size: clamp(28px, 4vw, 42px); line-height: 1.1; letter-spacing: 0; }
      h2 { margin-top: 4px; font-size: 18px; line-height: 1.35; letter-spacing: 0; }
      .summary { color: var(--muted); }
      .grid { display: grid; gap: 12px; }
      .card { display: grid; gap: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 18px; }
      .head { display: grid; grid-template-columns: auto 1fr; gap: 12px; }
      .head > span { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 999px; background: #e5f2ee; color: var(--accent); font-weight: 700; }
      .head p, .note, .summary { color: var(--muted); font-size: 14px; }
      .plan { border: 1px solid #cfe3dc; border-radius: 8px; background: #f0faf6; color: #174f43; padding: 10px; font-size: 14px; }
      .file { border: 1px solid var(--line); border-radius: 8px; background: var(--soft); padding: 10px; }
      code { overflow-wrap: anywhere; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 13px; }
      .links { display: flex; flex-wrap: wrap; gap: 8px; }
      a, .links span { display: inline-flex; align-items: center; min-height: 34px; border: 1px solid var(--line); border-radius: 7px; background: #fff; color: var(--accent); padding: 6px 10px; text-decoration: none; font-size: 14px; }
      .webloc { color: var(--muted); }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>AI Prof. Chai Browser Shortcuts</h1>
        <p class="summary">${escapeHtml(sortedItems.length)} missing records · ${escapeHtml(shortcutRows.reduce((sum, row) => sum + row.shortcuts.length, 0))} browser shortcuts · generated ${escapeHtml(new Date().toISOString())}</p>
        <p class="summary">Open routes in a normal browser. After downloading PDFs, keep them in Downloads or data/pdf-inbox, then run <code>npm run refresh:pdfs</code>.</p>
      </header>
      <section class="grid">${cards}</section>
    </main>
  </body>
</html>
`,
  "utf8"
);

console.log(`Browser shortcut records: ${sortedItems.length}`);
console.log(`Shortcut files: ${shortcutRows.reduce((sum, row) => sum + row.shortcuts.length, 0)}`);
console.log(indexPath);
console.log(readmePath);

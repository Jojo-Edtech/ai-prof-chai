import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMissingPdfQueue } from "../server/missing-pdfs";
import type { MissingPdfQueueItem } from "../src/shared/types";

type SprintItem = {
  item: MissingPdfQueueItem;
  score: number;
  lane: string;
  firstLink?: { label: string; url: string };
  rationale: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputsDir = path.join(projectRoot, "outputs");
const markdownPath = path.join(outputsDir, "missing-pdf-sprint-checklist.md");
const htmlPath = path.join(outputsDir, "missing-pdf-sprint-checklist.html");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function keyFor(item: MissingPdfQueueItem) {
  return item.doi || item.wosAccession || item.title;
}

function linkMarkdown(link?: { label: string; url: string }) {
  return link ? `[${link.label}](${link.url})` : "No route available";
}

function firstMatchingLink(item: MissingPdfQueueItem, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const link = item.links.find((entry) => pattern.test(`${entry.label} ${entry.url}`));
    if (link) return link;
  }
  return undefined;
}

function preferredLink(item: MissingPdfQueueItem) {
  if (/open-access/i.test(item.actionGroup || "")) {
    return firstMatchingLink(item, [/cuhk.*pdf/i, /sage pdf/i, /researchgate.*pdf/i, /libkey/i]) || item.links[0];
  }
  if (/author-upload/i.test(item.actionGroup || "")) {
    return firstMatchingLink(item, [/researchgate.*pdf/i, /researchgate/i, /academia/i]) || item.links[0];
  }
  if (/repository/i.test(item.actionGroup || "")) {
    return firstMatchingLink(item, [/academia.*full/i, /academia/i, /auckland handle/i, /bitstream/i, /learntechlib/i]) || item.links[0];
  }
  if (/institution/i.test(item.actionGroup || "")) {
    return firstMatchingLink(item, [/pdf/i, /xplore/i, /sage article/i, /world scientific chapter/i, /taylor/i]) || item.links[0];
  }
  return firstMatchingLink(item, [/dblp/i, /acm/i]) || item.links[0];
}

function sprintScore(item: MissingPdfQueueItem) {
  const combined = `${item.accessPriority} ${item.actionGroup} ${item.note} ${item.nextStep}`;
  if (/^1\b/.test(item.accessPriority || "")) return 100;
  if (/^4\b/.test(item.accessPriority || "") || /hard locate|no verified pdf route/i.test(combined)) return 30;
  if (/author-upload/i.test(item.actionGroup || "")) return /public full-text|article pdf available|application\/pdf/i.test(combined) ? 92 : 80;
  if (/academia.*(full|download free pdf|exact article text)/i.test(combined)) return 88;
  if (/institution|publisher|library/i.test(`${item.accessPriority} ${item.actionGroup}`)) return 58;
  if (/repository|auckland handle|bitstream/i.test(combined)) return 78;
  return 30;
}

function sprintLane(score: number, item: MissingPdfQueueItem) {
  if (score >= 95) return "先手公开/OA";
  if (score >= 90) return "作者上传优先";
  if (score >= 80) return "浏览器仓储优先";
  if (score >= 70) return "仓储/机构混合";
  if (score <= 30 || /hard locate/i.test(`${item.actionGroup} ${item.accessPriority}`)) return "疑难定位";
  return "机构/文献传递";
}

function rationaleFor(item: MissingPdfQueueItem, score: number) {
  if (score >= 95) return "公开或 OA 线索最强，普通浏览器最值得先试。";
  if (score >= 90) return "页面证据显示作者上传或公开全文，但本地命令被验证页挡住。";
  if (score >= 80) return "有浏览器可见全文或仓储记录，优先用普通浏览器尝试。";
  if (score >= 70) return "仓储有记录，但可能需要机构登录或浏览器会话。";
  if (/hard locate/i.test(item.actionGroup || "")) return "目前只有书目证据，适合文献传递或馆员协助。";
  return "出版商或数据库路线明确，但需要机构/图书馆访问。";
}

function toSprintItem(item: MissingPdfQueueItem): SprintItem {
  const score = sprintScore(item);
  return {
    item,
    score,
    lane: sprintLane(score, item),
    firstLink: preferredLink(item),
    rationale: rationaleFor(item, score)
  };
}

function markdownRecord(entry: SprintItem, index: number) {
  const item = entry.item;
  return [
    `### ${index + 1}. ${item.title}`,
    "",
    `- Lane: ${entry.lane}`,
    `- First route: ${linkMarkdown(entry.firstLink)}`,
    `- Expected file: \`${item.expectedPdfFile || "not generated"}\``,
    `- Identifier: ${keyFor(item)}`,
    `- Next step: ${item.nextStep || "Use listed routes in a normal browser or library route."}`,
    `- Why this order: ${entry.rationale}`,
    `- Stop rule: Count it only after a real PDF is saved and \`npm run refresh:pdfs\` verifies the title/DOI match.`,
    ""
  ].join("\n");
}

function renderHtml(entries: SprintItem[]) {
  const cards = entries
    .map((entry, index) => {
      const item = entry.item;
      const link = entry.firstLink;
      return `
        <article class="card">
          <div class="rank">${index + 1}</div>
          <div class="main">
            <p class="lane">${escapeHtml(entry.lane)} · ${escapeHtml(item.year || "n.d.")} · ${escapeHtml(keyFor(item))}</p>
            <h2>${escapeHtml(item.title)}</h2>
            <p>${escapeHtml(entry.rationale)}</p>
            <code>${escapeHtml(item.expectedPdfFile || "not generated")}</code>
            <p class="next">${escapeHtml(item.nextStep || "Use listed routes in a normal browser or library route.")}</p>
          </div>
          <div class="actions">
            ${link ? `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>` : ""}
            <button type="button" data-copy="${escapeHtml(item.expectedPdfFile || "")}">Copy filename</button>
          </div>
        </article>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Prof. Chai Missing PDF Sprint</title>
    <style>
      :root { color-scheme: light; --ink: #17202a; --muted: #5e6978; --line: #d8dee8; --paper: #fff; --soft: #f5f7fa; --accent: #1d6b5a; --accent-soft: #e7f4ef; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--soft); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
      main { max-width: 1080px; margin: 0 auto; padding: 32px 20px 56px; }
      header { display: grid; gap: 10px; margin-bottom: 20px; }
      h1, h2, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: clamp(28px, 4vw, 42px); line-height: 1.08; }
      h2 { font-size: 18px; line-height: 1.35; }
      .summary, .lane, .next { color: var(--muted); font-size: 14px; }
      .rules { display: grid; gap: 8px; border: 1px solid #cfe3dc; border-radius: 8px; background: var(--accent-soft); padding: 14px; margin-bottom: 16px; }
      .grid { display: grid; gap: 12px; }
      .card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: start; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 16px; }
      .rank { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-weight: 800; }
      .main { display: grid; gap: 8px; min-width: 0; }
      code { overflow-wrap: anywhere; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 13px; }
      .actions { display: grid; gap: 8px; min-width: 150px; }
      a, button { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; border-radius: 7px; padding: 7px 11px; font: inherit; font-size: 14px; text-decoration: none; }
      a { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
      button { border: 1px solid var(--line); background: #fff; color: var(--ink); cursor: pointer; }
      @media (max-width: 760px) { .card { grid-template-columns: 1fr; } .actions { min-width: 0; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Missing PDF Sprint</h1>
        <p class="summary">${entries.length} missing target PDFs · generated ${escapeHtml(new Date().toISOString())}</p>
      </header>
      <section class="rules">
        <p><strong>Use order:</strong> start from #1 and stop whenever the site asks for institution/library access.</p>
        <p><strong>After saving:</strong> keep the PDF in Downloads or upload it in the app, then run <code>npm run refresh:pdfs</code>.</p>
        <p><strong>Counting rule:</strong> nothing here counts as downloaded until the local matcher verifies the PDF title/DOI.</p>
      </section>
      <section class="grid">${cards}</section>
    </main>
    <script>
      document.addEventListener("click", async (event) => {
        const target = event.target.closest("[data-copy]");
        if (!target) return;
        await navigator.clipboard.writeText(target.getAttribute("data-copy") || "");
        target.textContent = "Copied";
        window.setTimeout(() => (target.textContent = "Copy filename"), 1200);
      });
    </script>
  </body>
</html>
`;
}

const queue = loadMissingPdfQueue(projectRoot);
const entries = queue.items
  .map(toSprintItem)
  .sort((first, second) => second.score - first.score || Number(second.item.year || 0) - Number(first.item.year || 0));

fs.mkdirSync(outputsDir, { recursive: true });
fs.writeFileSync(
  markdownPath,
  [
    "# Missing PDF Sprint Checklist",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Missing target PDFs: ${entries.length}`,
    "",
    "Use this list from top to bottom. It does not bypass publisher, database, institution, ResearchGate, Academia, or Cloudflare checks.",
    "",
    "After any PDF is saved, leave it in Downloads or upload it in the app, then run `npm run refresh:pdfs`. Count it only when the local matcher verifies the title/DOI.",
    "",
    ...entries.map(markdownRecord)
  ].join("\n"),
  "utf8"
);
fs.writeFileSync(htmlPath, renderHtml(entries), "utf8");

console.log(`Sprint checklist records: ${entries.length}`);
console.log(markdownPath);
console.log(htmlPath);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMissingPdfQueue } from "../server/missing-pdfs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "outputs", "missing-pdf-download-pack.html");
const refreshCommand = "npm run refresh:pdfs";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linksHtml(links: Array<{ label: string; url: string }>) {
  if (!links.length) return "<span class=\"muted\">No route yet</span>";
  return links
    .map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`)
    .join("");
}

function recordKey(item: { doi?: string; wosAccession?: string }) {
  return item.doi || item.wosAccession || "no-id";
}

function priorityRank(priority = "") {
  const match = priority.match(/^(\d+)/);
  return match ? Number(match[1]) : 9;
}

function isFastBrowserAction(actionGroup?: string) {
  return /browser save/i.test(actionGroup || "");
}

function preferredFastLink(item: { actionGroup?: string; links: Array<{ label: string; url: string }> }) {
  if (/author-upload/i.test(item.actionGroup || "")) {
    return (
      item.links.find((entry) => /researchgate/i.test(entry.label) && /pdf/i.test(entry.label)) ||
      item.links.find((entry) => /researchgate/i.test(entry.url) && /\.pdf/i.test(entry.url)) ||
      item.links.find((entry) => /researchgate/i.test(entry.label)) ||
      item.links.find((entry) => /researchgate/i.test(entry.url))
    );
  }
  if (/repository/i.test(item.actionGroup || "")) {
    return item.links.find((entry) => /handle|bitstream/i.test(entry.label)) || item.links.find((entry) => /hdl\.handle|bitstreams/i.test(entry.url));
  }
  if (/open-access/i.test(item.actionGroup || "")) {
    return item.links.find((entry) => /sage pdf|published pdf|cuhk/i.test(entry.label));
  }
  return item.links.find((entry) => /pdf|published|handle/i.test(entry.label)) || item.links[0];
}

function render() {
  const queue = loadMissingPdfQueue(projectRoot);
  const generatedAt = new Date().toISOString();
  const sortedItems = [...queue.items].sort((first, second) => {
    const priorityDiff = priorityRank(first.accessPriority) - priorityRank(second.accessPriority);
    if (priorityDiff) return priorityDiff;
    return Number(second.year || 0) - Number(first.year || 0);
  });
  const fastItems = sortedItems.filter((item) => isFastBrowserAction(item.actionGroup));
  const fastCards = fastItems
    .map((item, index) => {
      const link = preferredFastLink(item) || item.links[0];
      return `
        <article class="fast-card">
          <span>${index + 1}</span>
          <div>
            <p class="meta">${escapeHtml([item.year, item.actionGroup, recordKey(item)].filter(Boolean).join(" | "))}</p>
            <h2>${escapeHtml(item.title)}</h2>
            <code>${escapeHtml(item.expectedPdfFile || "missing filename")}</code>
          </div>
          ${link ? `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>` : ""}
        </article>
      `;
    })
    .join("\n");
  const cards = sortedItems
    .map(
      (item, index) => `
        <article class="paper-card" data-paper-card>
          <div class="paper-head">
            <span class="number">${index + 1}</span>
            <div>
              <p class="meta">${escapeHtml([item.year, item.source, recordKey(item)].filter(Boolean).join(" | "))}</p>
              <h2>${escapeHtml(item.title)}</h2>
            </div>
          </div>
          <div class="plan-row">
            <span class="priority">${escapeHtml(item.accessPriority || "Manual route")}</span>
            ${item.actionGroup ? `<span class="group">${escapeHtml(item.actionGroup)}</span>` : ""}
            <span>${escapeHtml(item.nextStep || "Use the listed route in a normal browser or through institution access.")}</span>
          </div>
          <div class="file-row">
            <code>${escapeHtml(item.expectedPdfFile || "missing filename")}</code>
            <button type="button" data-copy="${escapeHtml(item.expectedPdfFile || "")}">Copy filename</button>
          </div>
          <p class="note">${escapeHtml(item.note || "Manual browser or institution access needed.")}</p>
          <div class="links">${linksHtml(item.links)}</div>
        </article>
      `
    )
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Prof. Chai Missing PDF Download Pack</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #1b1f29;
        --muted: #616977;
        --line: #d8dee8;
        --paper: #ffffff;
        --soft: #f5f7fa;
        --accent: #1e6f5c;
        --accent-strong: #174f43;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--soft);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.55;
      }

      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 32px 20px 56px;
      }

      header {
        display: grid;
        gap: 14px;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--line);
      }

      h1,
      h2,
      p {
        margin: 0;
      }

      h1 {
        font-size: clamp(28px, 4vw, 44px);
        line-height: 1.08;
        letter-spacing: 0;
      }

      h2 {
        margin-top: 4px;
        font-size: 18px;
        line-height: 1.35;
        letter-spacing: 0;
      }

      .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .chip,
      .command {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--paper);
        padding: 8px 10px;
        color: var(--muted);
        font-size: 14px;
      }

      .commands {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 10px;
        margin: 22px 0;
      }

      .fast-section {
        display: grid;
        gap: 12px;
        margin: 0 0 22px;
        padding: 16px;
        border: 1px solid #d8e7e0;
        border-radius: 8px;
        background: #edf7f2;
      }

      .fast-grid {
        display: grid;
        gap: 10px;
      }

      .fast-card {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        padding: 12px;
        border: 1px solid #d8e7e0;
        border-radius: 8px;
        background: var(--paper);
      }

      .fast-card > span {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: #dcefe8;
        color: var(--accent-strong);
        font-weight: 800;
      }

      .command {
        justify-content: space-between;
        align-items: flex-start;
      }

      code {
        overflow-wrap: anywhere;
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        font-size: 13px;
      }

      button,
      a {
        min-height: 34px;
        border-radius: 7px;
        font: inherit;
      }

      button {
        border: 1px solid var(--accent);
        background: var(--accent);
        color: #fff;
        cursor: pointer;
        padding: 6px 10px;
      }

      button:hover,
      a:hover {
        border-color: var(--accent-strong);
      }

      .paper-list {
        display: grid;
        gap: 12px;
      }

      .paper-card {
        display: grid;
        gap: 14px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--paper);
        padding: 18px;
      }

      .paper-head {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 12px;
      }

      .number {
        display: inline-grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 999px;
        background: #e8f3ef;
        color: var(--accent-strong);
        font-weight: 700;
      }

      .plan-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 10px;
        align-items: start;
        border: 1px solid #d8e7e0;
        border-radius: 8px;
        background: #f1faf6;
        padding: 10px;
        color: var(--accent-strong);
        font-size: 14px;
      }

      .priority {
        border-radius: 999px;
        background: #dcefe8;
        padding: 3px 8px;
        font-weight: 700;
        white-space: nowrap;
      }

      .group {
        border: 1px solid #bcd8cf;
        border-radius: 999px;
        background: #fff;
        padding: 2px 8px;
        font-size: 12px;
        font-weight: 800;
        white-space: nowrap;
      }

      .meta,
      .muted,
      .note {
        color: var(--muted);
        font-size: 14px;
      }

      .file-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--soft);
        padding: 10px;
      }

      .links {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      a {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--line);
        background: var(--paper);
        color: var(--accent-strong);
        padding: 6px 10px;
        text-decoration: none;
      }

      @media (max-width: 640px) {
        main {
          padding: 22px 14px 40px;
        }

        .file-row,
        .fast-card,
        .plan-row,
        .command {
          grid-template-columns: 1fr;
        }

        .file-row {
          align-items: stretch;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <p class="meta">AI Prof. Chai manual full-text queue</p>
        <h1>Missing PDF Download Pack</h1>
        <div class="summary">
          <span class="chip">${queue.summary.count} missing target PDFs</span>
          <span class="chip">Queue: ${escapeHtml(queue.sourcePath)}</span>
          <span class="chip">Generated: ${generatedAt}</span>
        </div>
      </header>

      <section class="commands" aria-label="Post-download commands">
        <div class="command">
          <div>
            <strong>After downloading PDFs</strong><br />
            <code>${refreshCommand}</code>
          </div>
          <button type="button" data-copy="${refreshCommand}">Copy</button>
        </div>
      </section>

      ${
        fastItems.length
          ? `<section class="fast-section" aria-label="Fast browser saves">
              <div>
                <p class="meta">Fast browser saves</p>
                <h2>Start With These ${fastItems.length} PDFs</h2>
              </div>
              <div class="fast-grid">${fastCards}</div>
            </section>`
          : ""
      }

      <section class="paper-list" aria-label="Missing PDFs">
        ${cards || `<p class="muted">All target PDFs are currently saved.</p>`}
      </section>
    </main>

    <script>
      document.querySelectorAll("[data-copy]").forEach((button) => {
        button.addEventListener("click", async () => {
          const text = button.getAttribute("data-copy") || "";
          const original = button.textContent;
          try {
            await navigator.clipboard.writeText(text);
            button.textContent = "Copied";
            window.setTimeout(() => {
              button.textContent = original;
            }, 1400);
          } catch {
            window.prompt("Copy this text:", text);
          }
        });
      });
    </script>
  </body>
</html>
`;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, render(), "utf8");

const queue = loadMissingPdfQueue(projectRoot);
console.log(`Download pack records: ${queue.summary.count}`);
console.log(outputPath);

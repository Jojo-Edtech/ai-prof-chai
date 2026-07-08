import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMissingPdfQueue } from "../server/missing-pdfs";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";

type MoveRecord = {
  source: string;
  destination: string;
  action: "moved" | "removed-duplicate" | "left";
  reason: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(os.homedir(), "Desktop");
const projectFolder = path.join(desktopRoot, "蔡老师蒸馏项目");
const verifiedRoot = path.join(projectFolder, "01_已验证目标PDF");
const missingRoot = path.join(projectFolder, "02_缺失PDF申请包");
const reportRoot = path.join(projectFolder, "03_项目报告与索引");
const reviewRoot = path.join(projectFolder, "04_桌面待核验文件");
const trashRoot = path.join(os.homedir(), ".Trash");

const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const pdfRoot = path.join(projectRoot, "data", "pdfs");
const cuhkIllUrl = "https://www.lib.cuhk.edu.hk/en/use/interlibrary-loan/document-delivery/";
const cuhkEndNoteUrl = "https://libguides.lib.cuhk.edu.hk/EndNote21/Get_Started";
const deepSeekDocsUrl = "https://api-docs.deepseek.com/";

const categoryRules = [
  {
    folder: "01_AI学习动机与意向",
    patterns: [
      /artificial intelligence/i,
      /artificial intelligence learning intention scale/i,
      /intentions? to learn ai/i,
      /students'? ai learning motivation/i,
      /teach artificial intelligence/i,
      /learning artificial intelligence/i
    ]
  },
  {
    folder: "02_STEM与TPACK",
    patterns: [/\bstem\b/i, /science, technology, engineering/i, /science, mathematics, and engineering/i, /stem outcomes/i]
  },
  {
    folder: "04_教师信念_认识论_知识建构",
    patterns: [
      /belief/i,
      /epistemic/i,
      /south china education majors'? epistemological/i,
      /internet and teacher education/i
    ],
    exclude: [/scientific epistemological views between mainland china and taiwan high school students/i, /tpack/i, /technological pedagogical/i]
  },
  {
    folder: "03_TPACK_ICT与21世纪学习",
    patterns: [
      /tpack/i,
      /technological pedagogical/i,
      /21st/i,
      /twenty-first/i,
      /ict integration/i,
      /cyberwellness/i,
      /design capacities/i,
      /professional learning for 21st/i
    ]
  }
];

function mkdir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeObsoleteDeepSeekReplacedFiles() {
  for (const filePath of [
    path.join(projectFolder, "配置ModelScope Token.command"),
    path.join(reportRoot, "modelscope-token-handoff.md")
  ]) {
    fs.rmSync(filePath, { force: true });
  }
}

function normalize(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function safeTitle(value: string) {
  return value
    .replace(/[\\/:*\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 132)
    .trim();
}

function doiLabel(value = "") {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function roleLabel(record: PublicationRecord) {
  if (record.isFirstAuthor && record.isCorrespondingAuthor) return "第一作者+通讯作者";
  if (record.isFirstAuthor) return "第一作者";
  return "通讯作者";
}

function categoryFor(record: PublicationRecord) {
  const searchable = record.title;
  const match = categoryRules.find((rule) => {
    const excluded = "exclude" in rule && rule.exclude?.some((pattern) => pattern.test(searchable));
    return !excluded && rule.patterns.some((pattern) => pattern.test(searchable));
  });
  return match?.folder || "05_其他相关目标文献";
}

function formalName(record: PublicationRecord) {
  const id = record.doi ? `DOI_${doiLabel(record.doi)}` : record.wosAccession ? record.wosAccession.replace(":", "_") : record.id;
  return `${record.year || "n.d."} - ${roleLabel(record)} - ${safeTitle(record.title)} ${id}.pdf`;
}

function sameFile(left: string, right: string) {
  try {
    const leftStat = fs.statSync(left);
    const rightStat = fs.statSync(right);
    if (leftStat.size !== rightStat.size) return false;
    return fs.readFileSync(left).equals(fs.readFileSync(right));
  } catch {
    return false;
  }
}

function uniqueDestination(destination: string) {
  if (!fs.existsSync(destination)) return destination;
  const parsed = path.parse(destination);
  for (let index = 1; index < 100; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot find unique destination for ${destination}`);
}

function moveToTrash(source: string, reason: string): MoveRecord {
  const destinationDir = path.join(
    trashRoot,
    `蔡老师蒸馏项目_自动清理_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`
  );
  mkdir(destinationDir);
  const destination = path.join(destinationDir, path.basename(source));
  if (fs.existsSync(destination)) {
    const unique = uniqueDestination(destination);
    fs.renameSync(source, unique);
    return { source, destination: unique, action: "moved", reason };
  }
  fs.renameSync(source, destination);
  return { source, destination, action: "moved", reason };
}

function copyFile(source: string, destination: string) {
  mkdir(path.dirname(destination));
  fs.copyFileSync(source, destination);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function relativeHref(filePath: string) {
  return encodeURI(path.relative(projectFolder, filePath).replace(/\\/g, "/"));
}

function writeCommandFile(name: string, body: string) {
  const destination = path.join(projectFolder, name);
  fs.writeFileSync(destination, body, "utf8");
  fs.chmodSync(destination, 0o755);
}

function clearVerifiedPdfCopies() {
  if (!fs.existsSync(verifiedRoot)) return;
  const entries = fs.readdirSync(verifiedRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(verifiedRoot, entry.name);
    for (const file of fs.readdirSync(dir)) {
      if (file.toLowerCase().endsWith(".pdf")) fs.unlinkSync(path.join(dir, file));
    }
  }
}

function copyVerifiedPdf(record: PublicationRecord) {
  if (!record.pdfFile) return "";
  const category = categoryFor(record);
  const destinationDir = path.join(verifiedRoot, category);
  mkdir(destinationDir);
  const source = path.join(pdfRoot, record.pdfFile);
  if (!fs.existsSync(source)) return "";
  const destination = path.join(destinationDir, formalName(record));
  copyFile(source, destination);
  return destination;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function hongKongTimestamp() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return `${formatter.format(new Date()).replace(",", "")} HKT`;
}

function writeDesktopReadme(profile: CorpusProfile, moved: MoveRecord[]) {
  const saved = profile.records.filter((record) => isTarget(record) && record.downloadStatus === "pdf-saved").length;
  const missing = profile.records.filter((record) => isTarget(record) && record.downloadStatus === "pdf-needed").length;
  const lines = [
    "# 蔡老师蒸馏项目",
    "",
    `更新时间：${hongKongTimestamp()}`,
    "",
    `- 已验证目标 PDF：${saved} / ${saved + missing}`,
    `- 仍缺 PDF：${missing}`,
    "- `01_已验证目标PDF`：已经进入 AI Prof. Chai 数据库的正式全文副本。",
    "- `02_缺失PDF申请包`：剩余缺失文章的图书馆/手动下载材料。",
    "- `03_项目报告与索引`：当前覆盖率、全文索引、证据包和项目状态。",
    "- `04_桌面待核验文件`：仅作为临时核验区；重复原始下载和非项目文件会移到废纸篓。",
    "- 双击 `打开AI Prof Chai.command` 可以启动本地 AI Prof. Chai。",
    "- 双击 `导入新下载PDF.command` 可以扫描 Downloads 并同步桌面项目。",
    "- 双击 `开始监听PDF下载.command` 可以边下载边自动导入新 PDF。",
    "- 双击 `打开缺失PDF下载包.command` 可以打开剩余 6 篇的下载入口。",
    "- 双击 `打开登录与Token入口.command` 可以打开 CUHK、EndNote、DeepSeek 和本地项目入口。",
    "- 双击 `打开EndNote与图书馆申请.command` 可以打开 EndNote、RIS 和 CUHK 申请材料。",
    "- 双击 `配置DeepSeek API Key.command` 可以在本机终端隐藏输入 API key 并测试连接。",
    "- 打开 `项目总览.html` 可以从一个页面查看进度、缺失 PDF 和常用文件。",
    "",
    "## 本次桌面整理",
    "",
    `- 从桌面根目录移走/去重：${moved.filter((item) => item.action !== "left").length} 个文件。`,
    "- 已入库的重复原始 PDF、SBRE/AERE/Word 临时文件会移到废纸篓，不再堆在项目文件夹里。"
  ];
  fs.writeFileSync(path.join(projectFolder, "README_打开我.md"), `${lines.join("\n")}\n`, "utf8");
}

function priorityRank(priority = "") {
  const match = priority.match(/^(\d+)/);
  return match ? Number(match[1]) : 9;
}

function sortedMissingTargets(profile: CorpusProfile) {
  const queue = loadMissingPdfQueue(projectRoot);
  const queueByKey = new Map(queue.items.flatMap((item) => [[item.doi, item], [item.wosAccession, item]]));
  const records = profile.records
    .filter((record) => isTarget(record) && record.downloadStatus === "pdf-needed")
    .sort((first, second) => {
      const firstQueue = queueByKey.get(first.doi || first.wosAccession || first.id);
      const secondQueue = queueByKey.get(second.doi || second.wosAccession || second.id);
      const priorityDiff = priorityRank(firstQueue?.accessPriority) - priorityRank(secondQueue?.accessPriority);
      if (priorityDiff) return priorityDiff;
      return Number(second.year || 0) - Number(first.year || 0);
    });
  return { records, queueByKey };
}

function writeLoginGuide(profile: CorpusProfile) {
  const { records: missingTargets, queueByKey } = sortedMissingTargets(profile);
  const saved = profile.records.filter((record) => isTarget(record) && record.downloadStatus === "pdf-saved").length;

  const lines = [
    "# 登录后操作说明",
    "",
    `更新时间：${hongKongTimestamp()}`,
    "",
    `当前状态：已验证 PDF ${saved} / ${saved + missingTargets.length}，仍缺 ${missingTargets.length} 篇。`,
    "",
    "## 需要你亲自处理的地方",
    "",
    "- CUHK / LibrarySearch / EasyAccess 的学校账号、密码、2FA。",
    "- ScienceDirect、Inderscience、World Scientific、ResearchGate、Academia、ACM、IOS Press 的验证码或安全验证。",
    "- CUHK Library 或出版社弹出的版权/用途声明。",
    "- DeepSeek API key：请只粘贴到本地 AI Prof. Chai 页面或本地命令行，不要发到聊天里。",
    "- 如果用 `配置DeepSeek API Key.command`，终端不会回显 key，配置文件权限会设为本机私密。",
    "- 本地已设置 DeepSeek 每日 50 次调用、单次 800 token，并会先查余额；账户层面请保持预付费/不自动充值。",
    "",
    "## 下载后怎么交给项目",
    "",
    "- 把 PDF 直接保存到系统 `Downloads` 文件夹即可。",
    "- 文件名不用你整理；项目会按标题、DOI、WoS 号核验，成功后自动改名并归类到 `01_已验证目标PDF`。",
    "- 如果网页保存成 HTML、安全页、引用了目标文献的其他论文，项目会自动拒收。",
    "- 想自动处理就先双击 `开始监听PDF下载.command`，再去浏览器下载 PDF。",
    "- 已经下载完才想处理，就双击 `导入新下载PDF.command`。",
    "",
    "## 推荐处理顺序",
    "",
    "1. 先双击 `打开登录与Token入口.command`，它会打开 CUHK、缺失 PDF 包、AI Prof. Chai 和 DeepSeek 说明。",
    "2. 如果要边下载边导入，再双击 `开始监听PDF下载.command`。",
    "3. 如果普通浏览器不能下载，再用 CUHK 登录后的 LibrarySearch / publisher route。",
    "4. 如果仍然不能下载，打开 `CUHK_ILL_一次性申请草稿.md` 或 `missing-pdf-library-request.html`，复制到 CUHK ILL/DDS。",
    "5. 下载后也可以双击 `导入新下载PDF.command` 手动扫描。",
    "6. 如果要接入 DeepSeek，双击 `配置DeepSeek API Key.command`，在本机终端粘贴 API key。",
    "7. 如果你想用 EndNote，双击 `打开EndNote与图书馆申请.command`；这台 Mac 已安装 EndNote 2025，比 EndNote 20 更新。",
    "",
    `## 仍缺的 ${missingTargets.length} 篇`,
    ""
  ];

  missingTargets.forEach((record, index) => {
    const queueItem = queueByKey.get(record.doi || record.wosAccession || record.id);
    lines.push(
      `### ${index + 1}. ${record.title}`,
      "",
      `- 年份：${record.year || "n.d."}`,
      `- 来源：${record.source || "unknown"}`,
      `- DOI/WoS：${record.doi || record.wosAccession || "not available"}`,
      `- 建议路线：${queueItem?.nextStep || "Use DOI/WoS metadata for library lookup or document delivery."}`,
      `- 预期文件名：\`${record.pdfFile || "not generated"}\``,
      ""
    );
  });

  fs.writeFileSync(path.join(projectFolder, "登录后操作说明.md"), `${lines.join("\n")}\n`, "utf8");
}

function writeLibraryBatchDraft(profile: CorpusProfile) {
  const { records: missingTargets, queueByKey } = sortedMissingTargets(profile);
  const lines = [
    "# CUHK ILL/DDS 一次性申请草稿",
    "",
    `更新时间：${hongKongTimestamp()}`,
    "",
    "Subject: Document Delivery request for six Chai Ching Sing publications",
    "",
    "Dear CUHK Library Document Delivery Team,",
    "",
    "I would like to request assistance obtaining the following publications for research use. They are part of a Web of Science corpus on Chai Ching Sing where the author is first author and/or corresponding author. I have checked public/open-access, publisher, author-upload, and CUHK Pure routes locally, but no verified PDF copy could be saved.",
    "",
    "The RIS, CSV, HTML, and full request pack are in this folder if needed.",
    "",
    "Requested items:",
    ""
  ];

  missingTargets.forEach((record, index) => {
    const queueItem = queueByKey.get(record.doi || record.wosAccession || record.id);
    const authors = (record.fullAuthors.length ? record.fullAuthors : record.authors).join("; ") || "not available";
    lines.push(
      `${index + 1}. ${record.title}`,
      `   Authors: ${authors}`,
      `   Year: ${record.year || "n.d."}`,
      `   Source: ${record.source || "not available"}`,
      `   DOI/WoS: ${record.doi || record.wosAccession || "not available"}`,
      `   Expected local filename: ${record.pdfFile || "not generated"}`,
      `   Suggested route: ${queueItem?.nextStep || "LibrarySearch, e-resource access, or ILL/DDS document delivery."}`,
      `   Local access note: ${queueItem?.note || "No public PDF bytes verified locally."}`,
      ""
    );
  });

  lines.push(
    "Thank you very much.",
    "",
    "Notes for local project use:",
    "- Save any supplied PDF files to Downloads.",
    "- Then run the project import, or double-click 导入新下载PDF.command in the desktop project folder.",
    "- Do not count a file as complete until the project verifies title/DOI/WoS metadata."
  );

  const markdown = `${lines.join("\n")}\n`;
  const plainText = markdown
    .replace(/^#\s+/gm, "")
    .replace(/^-\s+/gm, "* ")
    .replace(/\*\*/g, "");

  fs.writeFileSync(path.join(missingRoot, "CUHK_ILL_一次性申请草稿.md"), markdown, "utf8");
  fs.writeFileSync(path.join(missingRoot, "CUHK_ILL_一次性申请草稿.txt"), plainText, "utf8");
}

function writeDesktopCommands() {
  const quotedRoot = shellQuote(projectRoot);
  const quotedFolder = shellQuote(projectFolder);
  const quotedDownloadPack = shellQuote(path.join(missingRoot, "missing-pdf-download-pack.html"));
  const quotedLibraryRequest = shellQuote(path.join(missingRoot, "missing-pdf-library-request.html"));
  const quotedLibraryDraft = shellQuote(path.join(missingRoot, "CUHK_ILL_一次性申请草稿.md"));
  const quotedLibraryRis = shellQuote(path.join(missingRoot, "missing-pdf-library-request.ris"));
  const quotedLibraryHandoff = shellQuote(path.join(missingRoot, "cuhk-library-login-handoff.md"));
  const quotedOverview = shellQuote(path.join(projectFolder, "项目总览.html"));
  const quotedStatusReport = shellQuote(path.join(reportRoot, "ai-prof-chai-project-status.md"));
  const quotedTokenHandoff = shellQuote(path.join(reportRoot, "deepseek-token-handoff.md"));

  writeCommandFile(
    "打开AI Prof Chai.command",
    `#!/bin/zsh
set -e
cd ${quotedRoot}
echo "正在打开 AI Prof. Chai..."
if curl -fsS http://127.0.0.1:5178 >/dev/null 2>&1; then
  open "http://127.0.0.1:5178"
  echo "AI Prof. Chai 已经在运行。"
  exit 0
fi
npm run dev &
server_pid=$!
sleep 4
open "http://127.0.0.1:5178"
echo ""
echo "AI Prof. Chai 已打开。保持这个窗口开着，关闭窗口会停止本地服务。"
wait $server_pid
`
  );

  writeCommandFile(
    "导入新下载PDF.command",
    `#!/bin/zsh
set -e
cd ${quotedRoot}
echo "正在扫描 Downloads 并更新蔡老师蒸馏项目..."
npm run refresh:pdfs
npm run sync:desktop
open ${quotedFolder}
echo ""
echo "导入和同步完成。可以在桌面文件夹查看最新状态。"
echo "按回车关闭这个窗口。"
read
`
  );

  writeCommandFile(
    "开始监听PDF下载.command",
    `#!/bin/zsh
set -e
cd ${quotedRoot}
open ${quotedDownloadPack}
echo "正在监听 Downloads。"
echo "先完成网页登录/验证码，然后把目标 PDF 下载到 Downloads。"
echo "项目检测到新 PDF 后会自动导入、改名、分类、刷新索引并同步桌面文件夹。"
echo "想停止监听时，直接关闭这个终端窗口即可。"
echo ""
npm run watch:pdfs -- --reset
npm run watch:pdfs
`
  );

  writeCommandFile(
    "打开缺失PDF下载包.command",
    `#!/bin/zsh
set -e
open ${quotedOverview}
open ${quotedDownloadPack}
open ${quotedStatusReport}
`
  );

  writeCommandFile(
    "打开登录与Token入口.command",
    `#!/bin/zsh
set -e
open ${quotedOverview}
open ${quotedDownloadPack}
open ${quotedTokenHandoff}
open "http://127.0.0.1:5178"
open "${cuhkIllUrl}"
open "${cuhkEndNoteUrl}"
open "${deepSeekDocsUrl}"
echo "已打开 CUHK 文献申请、EndNote、DeepSeek API key 说明、缺失 PDF 包和本地 AI Prof. Chai 入口。"
echo "需要输入学校账号、验证码、版权声明和 API key 的地方，请你自己在浏览器里完成。"
echo "按回车关闭这个窗口。"
read
`
  );

  writeCommandFile(
    "打开EndNote与图书馆申请.command",
    `#!/bin/zsh
set -e
open ${quotedLibraryRequest}
open ${quotedLibraryDraft}
open ${quotedLibraryHandoff}
open "${cuhkIllUrl}"
open "${cuhkEndNoteUrl}"
if [ -d "/Applications/EndNote 2025/EndNote 2025.app" ]; then
  open -a "/Applications/EndNote 2025/EndNote 2025.app" ${quotedLibraryRis}
else
  open ${quotedLibraryRis}
fi
echo "已打开 EndNote/RIS、CUHK ILL/DDS 和图书馆申请包。"
echo "如果网页要求登录、验证码或版权声明，请你自己完成。"
echo "按回车关闭这个窗口。"
read
`
  );

  writeCommandFile(
    "配置DeepSeek API Key.command",
    `#!/bin/zsh
set -e
cd ${quotedRoot}
open ${quotedTokenHandoff}
open "${deepSeekDocsUrl}"
echo "请在这个终端里粘贴 DeepSeek API key。"
echo "输入会被隐藏；key 只会写入本机项目的 .env.local，不会写入桌面报告。"
echo "多个 key 可以用逗号分隔。"
echo "本地保护：每日最多 50 次调用、单次最多 800 token、余额低于下限会停止调用。"
echo ""
npm run setup:ai
echo ""
echo "正在测试 AI 连接..."
npm run check:ai || true
echo ""
npm run report:status
npm run audit:goal
npm run sync:desktop
open "http://127.0.0.1:5178"
echo ""
echo "DeepSeek 配置流程结束。若测试失败，检查 key、余额或重新运行本入口。"
echo "按回车关闭这个窗口。"
read
`
  );
}

function parseLocalEnvTokens() {
  const envPath = path.join(projectRoot, ".env.local");
  const values: string[] = [];
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      if (!/^(AI_PROF_CHAI_DEEPSEEK_API_TOKENS|AI_PROF_CHAI_DEEPSEEK_API_KEY|AI_PROF_CHAI_DEEPSEEK_API_TOKEN|DEEPSEEK_API_TOKENS|DEEPSEEK_API_KEY|DEEPSEEK_API_TOKEN)$/.test(key)) continue;
      values.push(trimmed.slice(index + 1).replace(/^["']|["']$/g, ""));
    }
  }
  return [...new Set(values.flatMap((value) => value.split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean)))];
}

function readIndexedCount() {
  const fullTextPath = path.join(projectRoot, "data", "processed", "chai-fulltext-index.json");
  try {
    const fullText = JSON.parse(fs.readFileSync(fullTextPath, "utf8")) as { summary?: { indexed?: number; failed?: number } };
    return {
      indexed: fullText.summary?.indexed ?? 0,
      failed: fullText.summary?.failed ?? 0
    };
  } catch {
    return { indexed: 0, failed: 0 };
  }
}

function linkCard(label: string, detail: string, filePath: string) {
  return `<a class="link-card" href="${relativeHref(filePath)}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></a>`;
}

function externalLinkCard(label: string, detail: string, url: string) {
  return `<a class="link-card" href="${escapeHtml(url)}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></a>`;
}

function writeOverviewHtml(profile: CorpusProfile) {
  const { records: missingTargets, queueByKey } = sortedMissingTargets(profile);
  const targets = profile.records.filter(isTarget);
  const saved = targets.filter((record) => record.downloadStatus === "pdf-saved").length;
  const coverage = targets.length ? Math.round((saved / targets.length) * 100) : 0;
  const indexed = readIndexedCount();
  const aiTokens = parseLocalEnvTokens();
  const aiStatus = aiTokens.length ? `已配置 ${aiTokens.length} 枚 DeepSeek API key` : "未配置 API key，当前为本地规则回答";

  const rows = missingTargets
    .map((record, index) => {
      const queueItem = queueByKey.get(record.doi || record.wosAccession || record.id);
      return `<tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(record.title)}</strong><small>${escapeHtml(record.source || "")}</small></td>
        <td>${escapeHtml(record.year || "")}</td>
        <td>${escapeHtml(record.doi || record.wosAccession || "")}</td>
        <td>${escapeHtml(queueItem?.nextStep || "Use DOI/WoS metadata for library lookup or document delivery.")}</td>
      </tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="zh-Hans">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>蔡老师蒸馏项目总览</title>
    <style>
      :root { color-scheme: light; --ink: #18212d; --muted: #647084; --line: #d8dee8; --paper: #fff; --soft: #f5f7fa; --accent: #246b5b; --accent-soft: #e8f4ef; --warn: #8a5a12; --warn-soft: #fff4dc; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--soft); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
      main { max-width: 1180px; margin: 0 auto; padding: 30px 18px 54px; }
      h1, h2, h3, p { margin: 0; letter-spacing: 0; }
      header { display: grid; gap: 8px; margin-bottom: 18px; }
      h1 { font-size: 34px; line-height: 1.15; }
      h2 { font-size: 20px; margin-bottom: 10px; }
      .muted, small { color: var(--muted); }
      .grid { display: grid; gap: 12px; }
      .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 16px 0; }
      .card, .panel, .link-card { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
      .card { padding: 14px; display: grid; gap: 4px; }
      .card strong { font-size: 26px; }
      .panel { padding: 16px; margin-top: 14px; }
      .bar { height: 13px; border-radius: 999px; background: #e1e7ef; overflow: hidden; }
      .bar span { display: block; height: 100%; width: ${coverage}%; background: var(--accent); }
      .actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .link-card { display: grid; gap: 4px; padding: 13px; color: var(--ink); text-decoration: none; min-height: 74px; }
      .link-card:hover { border-color: var(--accent); }
      .notice { border: 1px solid #efd69a; background: var(--warn-soft); color: var(--warn); border-radius: 8px; padding: 12px; margin-top: 14px; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); padding: 10px 8px; }
      th { color: var(--muted); font-weight: 700; }
      td small { display: block; margin-top: 3px; }
      @media (max-width: 860px) { .metrics, .actions { grid-template-columns: 1fr; } h1 { font-size: 28px; } table { font-size: 13px; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>蔡老师蒸馏项目总览</h1>
        <p class="muted">更新时间：${escapeHtml(hongKongTimestamp())}</p>
      </header>

      <section class="grid metrics">
        <div class="card"><span class="muted">WoS 记录</span><strong>${profile.summary.total}</strong></div>
        <div class="card"><span class="muted">目标文献</span><strong>${targets.length}</strong></div>
        <div class="card"><span class="muted">已验证 PDF</span><strong>${saved}/${targets.length}</strong></div>
        <div class="card"><span class="muted">全文索引</span><strong>${indexed.indexed}</strong><span class="muted">失败 ${indexed.failed}</span></div>
      </section>

      <section class="panel">
        <h2>完成度</h2>
        <div class="bar" aria-label="PDF coverage"><span></span></div>
        <p class="muted">${coverage}% PDF 已验证；仍缺 ${missingTargets.length} 篇。AI 状态：${escapeHtml(aiStatus)}。</p>
      </section>

      <section class="panel">
        <h2>常用入口</h2>
        <div class="grid actions">
          ${linkCard("缺失 PDF 下载包", "登录后从这里进入剩余 6 篇路线", path.join(missingRoot, "missing-pdf-download-pack.html"))}
          ${linkCard("图书馆申请包", "复制 ILL/DDS request block 或导入 RIS", path.join(missingRoot, "missing-pdf-library-request.html"))}
          ${linkCard("CUHK 一次性申请草稿", "可复制到 ILL/DDS 或邮件里", path.join(missingRoot, "CUHK_ILL_一次性申请草稿.md"))}
          ${linkCard("EndNote RIS", "用 EndNote 导入剩余 6 篇元数据", path.join(missingRoot, "missing-pdf-library-request.ris"))}
          ${linkCard("登录后操作说明", "账号、验证码、版权声明等边界说明", path.join(projectFolder, "登录后操作说明.md"))}
          ${linkCard("项目状态报告", "当前覆盖率、AI状态、下一步", path.join(reportRoot, "ai-prof-chai-project-status.md"))}
          ${linkCard("全文证据包", "已入库 45 篇的可引用证据", path.join(reportRoot, "ai-prof-chai-evidence-pack.md"))}
          ${linkCard("蒸馏报告", "AI Prof. Chai 的主题与时期地图", path.join(reportRoot, "ai-prof-chai-distillation.md"))}
          ${externalLinkCard("CUHK ILL/DDS", "向图书馆申请剩余关闭访问文献", cuhkIllUrl)}
          ${externalLinkCard("DeepSeek API 文档", "查看 API key、兼容接口和余额接口说明", deepSeekDocsUrl)}
          ${linkCard("DeepSeek 本地接入说明", "API key 只保存在本地，不写入报告", path.join(reportRoot, "deepseek-token-handoff.md"))}
        </div>
        <div class="notice">需要运行的入口在 Finder 里双击：配置DeepSeek API Key、打开登录与Token入口、打开EndNote与图书馆申请、打开 AI Prof Chai、开始监听 PDF 下载、导入新下载 PDF。</div>
      </section>

      <section class="panel">
        <h2>仍缺的 ${missingTargets.length} 篇</h2>
        <table>
          <thead>
            <tr><th>#</th><th>标题</th><th>年份</th><th>DOI/WoS</th><th>建议路线</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;

  fs.writeFileSync(path.join(projectFolder, "项目总览.html"), html, "utf8");
}

function writeInventory(profile: CorpusProfile, moved: MoveRecord[]) {
  const rows = [
    ["type", "status", "year", "role", "title", "doi_or_wos", "project_file"],
    ...profile.records
      .filter((record) => isTarget(record) && record.downloadStatus === "pdf-saved")
      .sort((left, right) => `${left.year || ""}${left.title}`.localeCompare(`${right.year || ""}${right.title}`))
      .map((record) => [
        "target_pdf",
        "saved",
        record.year || "",
        roleLabel(record),
        record.title,
        record.doi || record.wosAccession || "",
        record.pdfFile || ""
      ]),
    ...moved.map((item) => ["desktop_cleanup", item.action, "", "", path.basename(item.source), item.reason, item.destination])
  ];
  fs.writeFileSync(path.join(projectFolder, "整理清单.csv"), `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`, "utf8");
}

function copyReports() {
  const missingFiles = [
    ["outputs/cuhk-library-login-handoff.md", "cuhk-library-login-handoff.md"],
    ["outputs/missing-pdf-acquisition-pack.html", "missing-pdf-acquisition-pack.html"],
    ["outputs/missing-pdf-download-pack.html", "missing-pdf-download-pack.html"],
    ["outputs/missing-pdf-download-queue.md", "missing-pdf-download-queue.md"],
    ["outputs/missing-pdf-library-request.csv", "missing-pdf-library-request.csv"],
    ["outputs/missing-pdf-library-request.html", "missing-pdf-library-request.html"],
    ["outputs/missing-pdf-library-request.md", "missing-pdf-library-request.md"],
    ["outputs/missing-pdf-library-request.ris", "missing-pdf-library-request.ris"],
    ["outputs/missing-pdf-live-browser-attempts.md", "missing-pdf-live-browser-attempts.md"],
    ["outputs/missing-pdf-open-access-recheck.md", "missing-pdf-open-access-recheck.md"],
    ["outputs/missing-pdf-public-web-recheck.md", "missing-pdf-public-web-recheck.md"],
    ["outputs/missing-pdf-cuhk-pure-check.md", "missing-pdf-cuhk-pure-check.md"],
    ["data/processed/missing-pdf-queue.csv", "missing-pdf-queue.csv"],
    ["outputs/missing-pdf-scholarly-metadata-recheck.md", "missing-pdf-scholarly-metadata-recheck.md"],
    ["outputs/missing-pdf-sprint-checklist.html", "missing-pdf-sprint-checklist.html"],
    ["outputs/missing-pdf-targeted-metadata-runs.md", "missing-pdf-targeted-metadata-runs.md"]
  ];
  const reportFiles = [
    ["outputs/ai-prof-chai-distillation.md", "ai-prof-chai-distillation.md"],
    ["outputs/ai-prof-chai-evidence-pack.csv", "ai-prof-chai-evidence-pack.csv"],
    ["outputs/ai-prof-chai-evidence-pack.md", "ai-prof-chai-evidence-pack.md"],
    ["outputs/ai-prof-chai-fulltext-index.md", "ai-prof-chai-fulltext-index.md"],
    ["outputs/ai-prof-chai-project-status.md", "ai-prof-chai-project-status.md"],
    ["outputs/goal-completion-audit.md", "goal-completion-audit.md"],
    ["outputs/deepseek-token-handoff.md", "deepseek-token-handoff.md"],
    ["outputs/target-coverage-matrix.csv", "target-coverage-matrix.csv"],
    ["outputs/target-coverage-matrix.md", "target-coverage-matrix.md"],
    ["data/processed/target-publications.csv", "target-publications.csv"],
    ["data/processed/target-publications.md", "target-publications.md"]
  ];
  for (const [source, target] of missingFiles) {
    const sourcePath = path.join(projectRoot, source);
    if (fs.existsSync(sourcePath)) copyFile(sourcePath, path.join(missingRoot, target));
  }
  for (const [source, target] of reportFiles) {
    const sourcePath = path.join(projectRoot, source);
    if (fs.existsSync(sourcePath)) copyFile(sourcePath, path.join(reportRoot, target));
  }
}

function isTarget(record: PublicationRecord) {
  return record.isFirstAuthor || record.isCorrespondingAuthor;
}

function isProjectPdf(file: string, savedRecords: PublicationRecord[]) {
  const stem = file.replace(/\.pdf$/i, "").replace(/\s+\(\d+\)$/i, "");
  const key = normalize(stem);
  return savedRecords.some((record) => {
    const doiKey = normalize(record.doi);
    const pdfKey = normalize(record.pdfFile);
    const titleTokens = normalize(record.title).slice(0, 40);
    return (
      (doiKey && (doiKey.includes(key.replace(/pdf$/, "")) || key.includes(doiKey))) ||
      (pdfKey && pdfKey.includes(key.replace(/pdf$/, ""))) ||
      (titleTokens && key.includes(titleTokens.slice(0, 24)))
    );
  });
}

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
for (const dir of [projectFolder, verifiedRoot, missingRoot, reportRoot, reviewRoot]) mkdir(dir);
removeObsoleteDeepSeekReplacedFiles();

const savedTargets = profile.records.filter((record) => isTarget(record) && record.downloadStatus === "pdf-saved");
clearVerifiedPdfCopies();
for (const record of savedTargets) copyVerifiedPdf(record);
copyReports();

const desktopFiles = fs.readdirSync(desktopRoot).filter((file) => {
  if (file.startsWith(".")) return false;
  return fs.statSync(path.join(desktopRoot, file)).isFile();
});

const moved: MoveRecord[] = [];
for (const file of desktopFiles) {
  const source = path.join(desktopRoot, file);
  const lower = file.toLowerCase();
  if (lower.endsWith(".pdf") && isProjectPdf(file, savedTargets)) {
    moved.push(moveToTrash(source, "project PDF already imported"));
  } else if (lower === "aere-d-26-00297_reviewer.pdf") {
    moved.push(moveToTrash(source, "not a Chai target PDF"));
  } else if (lower.startsWith("sbre") && lower.endsWith(".docx")) {
    moved.push(moveToTrash(source, "SBRE document, not this project"));
  } else if (file.startsWith("~$")) {
    moved.push(moveToTrash(source, "temporary Word lock file"));
  }
}

writeDesktopReadme(profile, moved);
writeLoginGuide(profile);
writeLibraryBatchDraft(profile);
writeOverviewHtml(profile);
writeInventory(profile, moved);
writeDesktopCommands();

const saved = savedTargets.length;
const missing = profile.records.filter((record) => isTarget(record) && record.downloadStatus === "pdf-needed").length;
console.log(`Desktop project synced: ${projectFolder}`);
console.log(`Verified target PDFs: ${saved}`);
console.log(`Missing target PDFs: ${missing}`);
console.log(`Desktop files moved or deduplicated: ${moved.filter((item) => item.action !== "left").length}`);

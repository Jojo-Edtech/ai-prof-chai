import {
  Bot,
  CheckCircle2,
  Clipboard,
  Database,
  FileDown,
  FileQuestion,
  KeyRound,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  checkAssistantConnection,
  configureAssistantToken,
  fetchAssistantStatus,
  fetchDistillation,
  fetchFullTextStatus,
  fetchMissingPdfQueue,
  fetchPdfAuditStatus,
  fetchProfile,
  refreshDownloadedPdfs,
  requestAssistantReply,
  uploadPdfFile
} from "./api";
import type {
  AssistantStatus,
  ChatMessage,
  CorpusProfile,
  DistillationProfile,
  FullTextStatus,
  MissingPdfQueue,
  PdfAuditStatus
} from "./shared/types";

type ResearchMode = "research-design" | "theory-frame" | "literature-position" | "writing-feedback";
type WorkflowId = "research-matrix" | "concept-boundary" | "variable-model" | "paper-pipeline" | "paragraph-feedback";
type MentorMessage = ChatMessage & { loading?: boolean; citations?: string[] };
type Conversation = {
  id: string;
  title: string;
  messages: MentorMessage[];
  mode: ResearchMode;
  workflow: WorkflowId | null;
  updatedAt: number;
};

const conversationsKey = "ai-prof-chai-conversations-v1";
const activeConversationKey = "ai-prof-chai-active-conversation-v1";

const modeOptions: Array<{ id: ResearchMode; title: string; copy: string }> = [
  { id: "research-design", title: "研究设计", copy: "变量、模型、方法路径" },
  { id: "theory-frame", title: "理论框架", copy: "概念边界与机制" },
  { id: "literature-position", title: "文献定位", copy: "贡献、缺口、议程" },
  { id: "writing-feedback", title: "写作反馈", copy: "段落、标题、表达" }
];

const workflowTemplates: Record<WorkflowId, { mode: ResearchMode; label: string; copy: string; prompt: string }> = {
  "research-matrix": {
    mode: "research-design",
    label: "研究矩阵",
    copy: "对象 × 产出类型",
    prompt:
      "请作为 AI Prof. Chai，基于蔡老师本地论文语料，把下面的研究方向拆成“对象 × 产出类型”的研究矩阵。\n\n研究方向：\n\n输出请包括：一句话结论、研究矩阵表、3 个可写 paper 方向、下一步行动、证据边界。"
  },
  "concept-boundary": {
    mode: "theory-frame",
    label: "概念边界",
    copy: "定义、区分、测量",
    prompt:
      "请作为 AI Prof. Chai，基于蔡老师论文语料，帮我区分下面概念的边界，并说明如何定义、测量和写进论文。\n\n概念：\n\n输出请包括：定义对照表、边界判断、测量建议、可引用语料依据、证据边界。"
  },
  "variable-model": {
    mode: "research-design",
    label: "变量模型",
    copy: "机制、假设、方法",
    prompt:
      "请作为 AI Prof. Chai，把下面的研究想法转成变量模型、机制路径、假设草案和方法建议。\n\n研究想法：\n\n输出请包括：变量表、机制路径、假设草案、方法建议、注意风险。"
  },
  "paper-pipeline": {
    mode: "literature-position",
    label: "论文序列",
    copy: "1/3/5 年 pipeline",
    prompt:
      "请作为 AI Prof. Chai，为下面的研究方向设计一个 1 年 / 3 年 / 5 年论文序列。\n\n研究方向：\n\n输出请包括：时间线表、每篇 paper 的理论/方法/贡献、可积累资产、证据边界。"
  },
  "paragraph-feedback": {
    mode: "writing-feedback",
    label: "段落反馈",
    copy: "诊断、改写、保留",
    prompt:
      "请作为 AI Prof. Chai，诊断并改写下面的论文段落。请指出逻辑问题、哪些内容保留、哪些需要删改。\n\n段落：\n\n输出请包括：问题诊断表、改写版本、可保留内容、需删除或弱化内容。"
  }
};

const defaultMessages: MentorMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content:
      "你好，我是 AI Prof. Chai，一个基于 Chai Ching Sing 本地论文语料的科研导师助手。你可以把研究 idea、论文段落、变量想法或追问发给我。"
  }
];

function newConversation(): Conversation {
  return {
    id: `conversation-${Date.now()}`,
    title: "New conversation",
    messages: [...defaultMessages],
    mode: "research-design",
    workflow: null,
    updatedAt: Date.now()
  };
}

function loadConversations() {
  try {
    const saved = localStorage.getItem(conversationsKey);
    const conversations = saved ? (JSON.parse(saved) as Conversation[]) : [];
    return conversations.length ? conversations : [newConversation()];
  } catch {
    return [newConversation()];
  }
}

function loadActiveId() {
  try {
    return localStorage.getItem(activeConversationKey);
  } catch {
    return null;
  }
}

function saveConversationState(conversations: Conversation[], activeId: string) {
  try {
    localStorage.setItem(conversationsKey, JSON.stringify(conversations));
    localStorage.setItem(activeConversationKey, activeId);
  } catch {
    // The live session still works without local storage.
  }
}

function saveActiveConversationId(activeId: string) {
  try {
    localStorage.setItem(activeConversationKey, activeId);
  } catch {
    // The live session still works without local storage.
  }
}

function stripMessages(messages: MentorMessage[]): ChatMessage[] {
  return messages.filter((message) => !message.loading).map(({ id, role, content }) => ({ id, role, content }));
}

function shortTitle(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 34) : "New conversation";
}

function roleLabel(role: ChatMessage["role"]) {
  return role === "user" ? "You" : "AI Prof. Chai";
}

function formatTime(value: number) {
  try {
    return new Intl.DateTimeFormat("zh-Hans", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
  } catch {
    return "";
  }
}

function providerLabel(status: AssistantStatus | null) {
  if (!status?.configured) return "本地规则";
  if (status.provider === "modelscope") {
    const model = status.model.split("/").pop()?.replace(/-/g, " ") || status.model;
    return `魔搭 · ${model}`;
  }
  if (status.provider === "deepseek") {
    return status.model.replace("deepseek-", "DeepSeek ").replace("v4", "V4").replace("-pro", " Pro").replace("-flash", " Flash");
  }
  if (status.provider === "dashscope") return `百炼 · ${status.model}`;
  return status.model;
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatInline(text: string) {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function isTableRow(line = "") {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isTableSeparator(line = "") {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderTable(rows: string[][]) {
  const [header, ...body] = rows;
  const head = header.map((cell) => `<th>${formatInline(cell)}</th>`).join("");
  const rowsHtml = body.map((row) => `<tr>${row.map((cell) => `<td>${formatInline(cell)}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
}

function formatMessageHtml(text: string) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (/^```/.test(line)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      html.push("<hr>");
      index += 1;
      continue;
    }
    if (/^#{2,4}\s+/.test(line)) {
      const level = Math.min(line.match(/^#+/)?.[0].length || 2, 4);
      html.push(`<h${level}>${formatInline(line.replace(/^#{2,4}\s+/, ""))}</h${level}>`);
      index += 1;
      continue;
    }
    if (isTableRow(lines[index]) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const rows: string[][] = [splitTableRow(lines[index])];
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      html.push(renderTable(rows));
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^---+$/.test(lines[index].trim()) &&
      !/^```/.test(lines[index].trim()) &&
      !/^#{2,4}\s+/.test(lines[index].trim()) &&
      !(isTableRow(lines[index]) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\d+\.\s+/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${formatInline(paragraph.join(" "))}</p>`);
  }

  return html.join("");
}

export default function App() {
  const [profile, setProfile] = useState<CorpusProfile | null>(null);
  const [distillation, setDistillation] = useState<DistillationProfile | null>(null);
  const [fullTextStatus, setFullTextStatus] = useState<FullTextStatus | null>(null);
  const [pdfAuditStatus, setPdfAuditStatus] = useState<PdfAuditStatus | null>(null);
  const [missingPdfQueue, setMissingPdfQueue] = useState<MissingPdfQueue | null>(null);
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeConversationId, setActiveConversationId] = useState(() => loadActiveId() || conversations[0]?.id || "");
  const [input, setInput] = useState("帮我看看蔡老师论文里，哪些研究主线最适合蒸馏成 AI Prof. Chai 的导师知识结构");
  const [status, setStatus] = useState("正在读取本地语料");
  const [sending, setSending] = useState(false);
  const [refreshingPdfs, setRefreshingPdfs] = useState(false);
  const [uploadingPdfs, setUploadingPdfs] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [checkingAi, setCheckingAi] = useState(false);
  const [assistantToken, setAssistantToken] = useState("");
  const [assistantCheckMessage, setAssistantCheckMessage] = useState("");
  const pdfUploadInputRef = useRef<HTMLInputElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0],
    [activeConversationId, conversations]
  );

  const messages = activeConversation?.messages || defaultMessages;
  const currentMode = activeConversation?.mode || "research-design";
  const currentWorkflow = activeConversation?.workflow || null;

  const persistConversations = (nextConversations: Conversation[], nextActiveId = activeConversationId) => {
    setConversations(nextConversations);
    setActiveConversationId(nextActiveId);
    saveConversationState(nextConversations, nextActiveId);
  };

  const updateActiveConversation = (updates: Partial<Conversation>) => {
    const nextConversations = conversations.map((conversation) =>
      conversation.id === activeConversation?.id ? { ...conversation, ...updates, updatedAt: Date.now() } : conversation
    );
    persistConversations(nextConversations, activeConversation?.id || activeConversationId);
  };

  const load = async () => {
    setStatus("正在刷新语料");
    try {
      const [nextProfile, nextAssistantStatus, nextDistillation, nextFullTextStatus, nextPdfAuditStatus, nextMissingPdfQueue] = await Promise.all([
        fetchProfile(),
        fetchAssistantStatus(),
        fetchDistillation(),
        fetchFullTextStatus(),
        fetchPdfAuditStatus(),
        fetchMissingPdfQueue()
      ]);
      setProfile(nextProfile);
      setAssistantStatus(nextAssistantStatus);
      setDistillation(nextDistillation);
      setFullTextStatus(nextFullTextStatus);
      setPdfAuditStatus(nextPdfAuditStatus);
      setMissingPdfQueue(nextMissingPdfQueue);
      setStatus(nextProfile.summary.total ? "Chai 本地语料已载入" : "等待 WoS 导出文件");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "接口不可用");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createConversation = () => {
    const conversation = newConversation();
    persistConversations([conversation, ...conversations], conversation.id);
  };

  const deleteConversation = (id: string) => {
    const next = conversations.filter((conversation) => conversation.id !== id);
    const fallback = next[0] || newConversation();
    persistConversations(next.length ? next : [fallback], activeConversationId === id ? fallback.id : activeConversationId);
  };

  const selectConversation = (id: string) => {
    setActiveConversationId(id);
    saveActiveConversationId(id);
  };

  const setMode = (mode: ResearchMode) => {
    updateActiveConversation({ mode, workflow: null });
  };

  const applyWorkflow = (workflow: WorkflowId) => {
    const template = workflowTemplates[workflow];
    updateActiveConversation({ mode: template.mode, workflow });
    setInput(template.prompt);
  };

  const copyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("回答已复制");
    } catch {
      setStatus("复制失败，请手动选择文本");
    }
  };

  const send = async (text = input) => {
    const clean = text.trim();
    if (!clean || sending || !activeConversation) return;

    const userMessage: MentorMessage = { id: `user-${Date.now()}`, role: "user", content: clean };
    const loadingMessage: MentorMessage = {
      id: `assistant-loading-${Date.now()}`,
      role: "assistant",
      content: "正在匹配本地论文语料，并生成研究分析...",
      loading: true
    };
    const nextMessages = [...messages.filter((message) => !message.loading), userMessage];
    updateActiveConversation({
      title: activeConversation.title === "New conversation" ? shortTitle(clean) : activeConversation.title,
      messages: [...nextMessages, loadingMessage]
    });
    setInput("");
    setSending(true);
    setStatus("AI Prof. Chai 正在回答");

    try {
      const result = await requestAssistantReply(stripMessages(nextMessages));
      const assistantMessage: MentorMessage = { ...result.message, citations: result.citations };
      updateActiveConversation({
        title: activeConversation.title === "New conversation" ? shortTitle(clean) : activeConversation.title,
        messages: [...nextMessages, assistantMessage]
      });
      setAssistantStatus((current) =>
        current
          ? {
              ...current,
              provider: result.provider,
              model: result.model,
              quotaLabel: result.quotaLabel
            }
          : current
      );
      setStatus("AI Prof. Chai 已回复");
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI Prof. Chai 暂时不可用";
      updateActiveConversation({
        messages: [
          ...nextMessages,
          {
            id: `assistant-error-${Date.now()}`,
            role: "assistant",
            content: `模型暂时没接上：${message}\n\n没关系，你可以先用本地规则继续；如果要接魔搭免费 token，在左侧保存到本机就可以。`
          }
        ]
      });
      setStatus("AI Prof. Chai 连接失败");
    } finally {
      setSending(false);
    }
  };

  const saveAssistantToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = assistantToken.trim();
    if (!token) {
      setStatus("请先粘贴魔搭 token");
      return;
    }

    setSavingToken(true);
    setStatus("正在保存到本机");
    try {
      setAssistantStatus(await configureAssistantToken(token));
      setAssistantToken("");
      setAssistantCheckMessage("已经安全保存到本机，可以试一下连接。");
      setStatus("魔搭 token 已保存到本机");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存没有成功");
    } finally {
      setSavingToken(false);
    }
  };

  const testAiConnection = async () => {
    if (checkingAi) return;
    setCheckingAi(true);
    setStatus("正在轻轻试一下魔搭连接");
    try {
      const result = await checkAssistantConnection();
      setAssistantCheckMessage(result.message);
      setAssistantStatus((current) =>
        current
          ? {
              ...current,
              provider: result.provider,
              model: result.model,
              quotaLabel: result.quotaLabel
            }
          : current
      );
      setStatus(result.ok ? "魔搭连接已经准备好" : "魔搭连接还没有通过");
    } catch (error) {
      const message = error instanceof Error ? error.message : "魔搭连接暂时没有检查成功";
      setAssistantCheckMessage(message);
      setStatus(message);
    } finally {
      setCheckingAi(false);
    }
  };

  const scanDownloadedPdfs = async () => {
    if (refreshingPdfs) return;
    setRefreshingPdfs(true);
    setStatus("正在扫描下载并刷新语料");
    try {
      const result = await refreshDownloadedPdfs();
      await load();
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "扫描下载失败");
    } finally {
      setRefreshingPdfs(false);
    }
  };

  const uploadSelectedPdfs = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    event.target.value = "";
    if (!files.length || uploadingPdfs) return;

    setUploadingPdfs(true);
    setStatus(`正在上传 ${files.length} 个 PDF`);
    try {
      let savedTotal = 0;
      let lastMessage = "";
      for (const file of files) {
        const result = await uploadPdfFile(file);
        savedTotal += result.savedDelta;
        lastMessage = result.message;
      }
      await load();
      setStatus(savedTotal > 0 ? `已上传并匹配 ${savedTotal} 篇目标 PDF` : lastMessage || "PDF 已上传，但没有匹配到新的目标论文");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PDF 上传失败");
    } finally {
      setUploadingPdfs(false);
    }
  };

  const indexedPdfCount = fullTextStatus?.summary.available ? fullTextStatus.summary.indexed : 0;
  const evidenceChunkCount = fullTextStatus?.summary.available ? fullTextStatus.summary.evidenceChunks || 0 : 0;
  const corpusLine = profile
    ? `${profile.summary.pdfSaved} 篇 PDF · ${indexedPdfCount} 篇全文 · ${evidenceChunkCount} 条证据片段`
    : "正在读取本地论文语料";
  const deferredPdfCount = profile?.summary.pdfNeeded || missingPdfQueue?.summary.count || 0;
  const activePdfCount = profile?.summary.pdfSaved || 0;
  const activeWorkflow = currentWorkflow ? workflowTemplates[currentWorkflow] : null;
  const statusOk = Boolean(assistantStatus?.configured);
  const publicWorkerMode = Boolean(assistantStatus?.publicWorker);

  return (
    <div className="app-shell">
      <aside className="workspace-sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            C
          </div>
          <div>
            <h1>AI Prof. Chai</h1>
            <p>Research Mentor Workspace</p>
          </div>
        </div>

        <section className="sidebar-section status-section" aria-label="模型状态">
          <div className="section-heading">
            <h2>模型状态</h2>
            <span className={`status-dot ${statusOk ? "ok" : "missing"}`} aria-hidden="true"></span>
          </div>
          <p className={`key-status ${statusOk ? "ok" : "missing"}`}>
            {assistantStatus?.configured
              ? `${publicWorkerMode ? "魔搭 Worker" : "魔搭"}已准备好 · 今日余量 ${assistantStatus.quotaLabel}`
              : "还没有接入魔搭 token"}
          </p>
          <p className="corpus-line">{corpusLine}</p>
          {!publicWorkerMode ? (
            <form className="key-form" onSubmit={saveAssistantToken}>
              <label htmlFor="assistantToken">
                <KeyRound size={14} />
                <input
                  id="assistantToken"
                  type="password"
                  value={assistantToken}
                  onChange={(event) => setAssistantToken(event.target.value)}
                  placeholder="魔搭 token（本机保存）"
                  autoComplete="off"
                />
              </label>
              <div className="key-actions">
                <button type="submit" disabled={savingToken || !assistantToken.trim()}>
                  {savingToken ? "保存中" : "保存到本机"}
                </button>
                <button type="button" onClick={testAiConnection} disabled={checkingAi}>
                  {checkingAi ? "试用中" : "试一下"}
                </button>
              </div>
            </form>
          ) : null}
          <p className="security-note">
            {publicWorkerMode
              ? "公开版通过受保护 Worker 调用模型；每个浏览器都有独立访客身份，token 不进入 GitHub。"
              : "Token 只留在这台电脑的 .env.local，不会写进聊天记录；我已帮你设好每日 50 次保护线。"}
          </p>
          {assistantCheckMessage ? <p className="compact-feedback">{assistantCheckMessage}</p> : null}
        </section>

        <section className="sidebar-section account-section" aria-label="正在使用的语料">
          <h2>正在使用的语料</h2>
          <p className="user-badge">Chai Ching Sing 本地语料</p>
          <button className="logout-button" type="button" onClick={load}>
            刷新语料
          </button>
        </section>

        <section className="sidebar-section conversation-section" aria-label="会话记录">
          <div className="section-heading">
            <h2>会话记录</h2>
            <button className="mini-button" type="button" onClick={createConversation} aria-label="新建会话">
              New
            </button>
          </div>
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`conversation-button ${conversation.id === activeConversation?.id ? "active" : ""}`}
                type="button"
                onClick={() => selectConversation(conversation.id)}
              >
                <span className="conversation-title">{conversation.title}</span>
                <span className="conversation-meta">
                  {conversation.messages.filter((message) => !message.loading).length} messages · {formatTime(conversation.updatedAt)}
                </span>
                <span
                  className="conversation-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteConversation(conversation.id);
                  }}
                  aria-label="删除会话"
                  role="button"
                >
                  <Trash2 size={13} />
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section" aria-label="回答模式">
          <h2>研究模式</h2>
          <div className="mode-grid">
            {modeOptions.map((option) => (
              <button
                key={option.id}
                className={`mode-button ${currentMode === option.id ? "active" : ""}`}
                type="button"
                onClick={() => setMode(option.id)}
              >
                <span className="mode-title">{option.title}</span>
                <span className="mode-copy">{option.copy}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section" aria-label="研究工具包">
          <h2>研究工具包</h2>
          <div className="workflow-grid">
            {(Object.keys(workflowTemplates) as WorkflowId[]).map((workflow) => (
              <button
                key={workflow}
                className={`workflow-button ${currentWorkflow === workflow ? "active" : ""}`}
                type="button"
                onClick={() => applyWorkflow(workflow)}
              >
                <span className="workflow-title">{workflowTemplates[workflow].label}</span>
                <span className="workflow-copy">{workflowTemplates[workflow].copy}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section" aria-label="知识底座">
          <h2>知识底座</h2>
          <dl className="stat-list">
            <div>
              <dt>本地 PDF</dt>
              <dd>{profile?.summary.pdfSaved || 0}</dd>
            </div>
            <div>
              <dt>证据片段</dt>
              <dd>{evidenceChunkCount}</dd>
            </div>
            <div>
              <dt>已索引全文</dt>
              <dd>{indexedPdfCount}</dd>
            </div>
            <div>
              <dt>待补 PDF</dt>
              <dd>{deferredPdfCount}</dd>
            </div>
          </dl>
          <div className="tool-links">
            <a href="/api/project-status" target="_blank" rel="noreferrer">
              项目状态
            </a>
            <a href="/api/evidence-pack/md" target="_blank" rel="noreferrer">
              证据包
            </a>
            <a href="/api/goal-audit" target="_blank" rel="noreferrer">
              目标审计
            </a>
          </div>
        </section>

        <section className="sidebar-section" aria-label="语料维护">
          <h2>语料维护</h2>
          <input ref={pdfUploadInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={uploadSelectedPdfs} />
          <div className="maintenance-grid">
            <button type="button" onClick={scanDownloadedPdfs} disabled={refreshingPdfs}>
              <RefreshCw size={14} />
              {refreshingPdfs ? "扫描中" : "扫描下载"}
            </button>
            <button type="button" onClick={() => pdfUploadInputRef.current?.click()} disabled={uploadingPdfs}>
              <Upload size={14} />
              {uploadingPdfs ? "上传中" : "上传 PDF"}
            </button>
            <a href="/api/missing-pdfs/download-pack" target="_blank" rel="noreferrer">
              <FileQuestion size={14} />
              下载包
            </a>
            <a href="/api/missing-pdfs/library-request/ris">
              <FileDown size={14} />
              RIS
            </a>
          </div>
          <p className="compact-feedback">
            {distillation ? `${distillation.themes.length} 条主题线 · ${activePdfCount} 篇已入库 · ${evidenceChunkCount} 条证据片段` : status}
            {pdfAuditStatus?.summary.available ? ` · 审计高可信 ${pdfAuditStatus.summary.high}` : ""}
          </p>
        </section>
      </aside>

      <main className="workbench">
        <header className="workbench-header">
          <div>
            <p className="eyebrow">Research Mentor Corpus</p>
            <h2>AI Research Mentor</h2>
          </div>
          <div className="header-actions">
            <span className="model-pill">{providerLabel(assistantStatus)}</span>
            <button className="clear-button" type="button" onClick={createConversation} aria-label="新建会话">
              新建会话
            </button>
          </div>
        </header>

        <div className="workbench-body">
          <section className="chat-session" aria-label="与 AI Prof. Chai 持续讨论科研问题">
            <div className="session-strip" aria-label="当前证据层">
              <span>
                <strong>{profile?.summary.pdfSaved || 0}</strong>
                PDF
              </span>
              <span>
                <strong>{indexedPdfCount}</strong>
                全文
              </span>
              <span>
                <strong>{evidenceChunkCount}</strong>
                证据片段
              </span>
              <span className={statusOk ? "strip-ok" : "strip-waiting"}>{statusOk ? "魔搭已准备好" : "先用本地规则"}</span>
            </div>
            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}${message.loading ? " loading" : ""}`}>
                  <div className="message-header">
                    <div className="message-role">{roleLabel(message.role)}</div>
                    {message.role === "assistant" && !message.loading ? (
                      <button className="copy-button" type="button" onClick={() => void copyMessage(message.content)}>
                        <Clipboard size={12} />
                        复制
                      </button>
                    ) : null}
                  </div>
                  <div className="message-content" dangerouslySetInnerHTML={{ __html: formatMessageHtml(message.content) }} />
                  {message.citations?.length ? (
                    <div className="source-list">
                      <span className="source-label">参考证据</span>
                      {message.citations.slice(0, 8).map((citation) => (
                        <span key={citation} className="source-chip">
                          {citation}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>

            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label className="composer-label" htmlFor="messageInput">
                Message
              </label>
              {activeWorkflow ? <div className="workflow-chip">当前工具：{activeWorkflow.label}</div> : null}
              <textarea
                id="messageInput"
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="输入研究 idea、论文段落、变量想法或追问"
              />
              <button type="submit" disabled={sending || !input.trim()}>
                <Send size={16} />
                发送
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}

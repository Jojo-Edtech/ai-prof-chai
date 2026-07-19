import {
  Clipboard,
  FileDown,
  FileQuestion,
  KeyRound,
  Languages,
  RefreshCw,
  Send,
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
import {
  type Lang,
  type ResearchMode,
  type Strings,
  type WorkflowId,
  loadLang,
  saveLang,
  translations
} from "./i18n";

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
const mobilePanelKey = "ai-prof-chai-mobile-panel-collapsed-v1";

const modeOrder: ResearchMode[] = ["research-design", "theory-frame", "literature-position", "writing-feedback"];

const workflowModes: Record<WorkflowId, ResearchMode> = {
  "research-matrix": "research-design",
  "concept-boundary": "theory-frame",
  "variable-model": "research-design",
  "paper-pipeline": "literature-position",
  "paragraph-feedback": "writing-feedback"
};

const workflowOrder = Object.keys(workflowModes) as WorkflowId[];

const welcomeMessageId = "assistant-welcome";

const defaultMessages: MentorMessage[] = [
  {
    id: welcomeMessageId,
    role: "assistant",
    content: translations.en.welcome
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

function loadMobilePanelCollapsed() {
  try {
    const saved = localStorage.getItem(mobilePanelKey);
    return saved === null ? true : saved === "true";
  } catch {
    return true;
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

function saveMobilePanelCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(mobilePanelKey, collapsed ? "true" : "false");
  } catch {
    // The mobile panel still works for the current page without local storage.
  }
}

function stripMessages(messages: MentorMessage[]): ChatMessage[] {
  return messages.filter((message) => !message.loading).map(({ id, role, content }) => ({ id, role, content }));
}

function shortTitle(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 34) : "New conversation";
}

function roleLabel(role: ChatMessage["role"], t: Strings) {
  return role === "user" ? t.you : "AI Prof. Chai";
}

function formatTime(value: number, lang: Lang) {
  try {
    return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
  } catch {
    return "";
  }
}

function providerLabel(status: AssistantStatus | null, t: Strings) {
  if (!status?.configured) return t.localRules;
  if (status.provider === "modelscope") {
    const model = status.model.split("/").pop()?.replace(/-/g, " ") || status.model;
    return `ModelScope · ${model}`;
  }
  if (status.provider === "deepseek") {
    return status.model.replace("deepseek-", "DeepSeek ").replace("v4", "V4").replace("-pro", " Pro").replace("-flash", " Flash");
  }
  if (status.provider === "dashscope") return `Bailian · ${status.model}`;
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
  const [lang, setLangState] = useState<Lang>(loadLang);
  const t = translations[lang];
  const [profile, setProfile] = useState<CorpusProfile | null>(null);
  const [distillation, setDistillation] = useState<DistillationProfile | null>(null);
  const [fullTextStatus, setFullTextStatus] = useState<FullTextStatus | null>(null);
  const [pdfAuditStatus, setPdfAuditStatus] = useState<PdfAuditStatus | null>(null);
  const [missingPdfQueue, setMissingPdfQueue] = useState<MissingPdfQueue | null>(null);
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeConversationId, setActiveConversationId] = useState(() => loadActiveId() || conversations[0]?.id || "");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(() => translations[loadLang()].statusReading);
  const [sending, setSending] = useState(false);
  const [refreshingPdfs, setRefreshingPdfs] = useState(false);
  const [uploadingPdfs, setUploadingPdfs] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [checkingAi, setCheckingAi] = useState(false);
  const [assistantToken, setAssistantToken] = useState("");
  const [assistantCheckMessage, setAssistantCheckMessage] = useState("");
  const [mobilePanelCollapsed, setMobilePanelCollapsedState] = useState(loadMobilePanelCollapsed);
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

  const toggleLang = () => {
    const next: Lang = lang === "en" ? "zh" : "en";
    setLangState(next);
    saveLang(next);
  };

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const load = async () => {
    setStatus(t.statusRefreshing);
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
      setStatus(nextProfile.summary.total ? t.statusReady : t.statusWaitingWos);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.statusApiUnavailable);
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

  const setMobilePanelCollapsed = (collapsed: boolean) => {
    setMobilePanelCollapsedState(collapsed);
    saveMobilePanelCollapsed(collapsed);
  };

  const setMode = (mode: ResearchMode) => {
    updateActiveConversation({ mode, workflow: null });
  };

  const applyWorkflow = (workflow: WorkflowId) => {
    updateActiveConversation({ mode: workflowModes[workflow], workflow });
    setInput(t.workflows[workflow].prompt);
  };

  const copyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(t.statusCopied);
    } catch {
      setStatus(t.statusCopyFailed);
    }
  };

  const send = async (text = input) => {
    const clean = text.trim();
    if (!clean || sending || !activeConversation) return;

    const userMessage: MentorMessage = { id: `user-${Date.now()}`, role: "user", content: clean };
    const loadingMessage: MentorMessage = {
      id: `assistant-loading-${Date.now()}`,
      role: "assistant",
      content: t.loadingReply,
      loading: true
    };
    const nextMessages = [...messages.filter((message) => !message.loading), userMessage];
    updateActiveConversation({
      title: activeConversation.title === "New conversation" ? shortTitle(clean) : activeConversation.title,
      messages: [...nextMessages, loadingMessage]
    });
    setInput("");
    setSending(true);
    setStatus(t.statusAnswering);

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
      setStatus(t.statusReplied);
    } catch (error) {
      const message = error instanceof Error ? error.message : t.statusUnavailable;
      updateActiveConversation({
        messages: [
          ...nextMessages,
          {
            id: `assistant-error-${Date.now()}`,
            role: "assistant",
            content: t.errorReply(message)
          }
        ]
      });
      setStatus(t.statusConnectionFailed);
    } finally {
      setSending(false);
    }
  };

  const saveAssistantToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = assistantToken.trim();
    if (!token) {
      setStatus(t.statusPasteToken);
      return;
    }

    setSavingToken(true);
    setStatus(t.statusSavingLocal);
    try {
      setAssistantStatus(await configureAssistantToken(token));
      setAssistantToken("");
      setAssistantCheckMessage(t.savedTestNow);
      setStatus(t.statusTokenSaved);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.statusSaveFailed);
    } finally {
      setSavingToken(false);
    }
  };

  const testAiConnection = async () => {
    if (checkingAi) return;
    setCheckingAi(true);
    setStatus(t.statusTestingConn);
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
      setStatus(result.ok ? t.statusConnReady : t.statusConnNotPass);
    } catch (error) {
      const message = error instanceof Error ? error.message : t.statusConnCheckFailed;
      setAssistantCheckMessage(message);
      setStatus(message);
    } finally {
      setCheckingAi(false);
    }
  };

  const scanDownloadedPdfs = async () => {
    if (refreshingPdfs) return;
    setRefreshingPdfs(true);
    setStatus(t.statusScanningDownloads);
    try {
      const result = await refreshDownloadedPdfs();
      await load();
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.statusScanFailed);
    } finally {
      setRefreshingPdfs(false);
    }
  };

  const uploadSelectedPdfs = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    event.target.value = "";
    if (!files.length || uploadingPdfs) return;

    setUploadingPdfs(true);
    setStatus(t.statusUploadingN(files.length));
    try {
      let savedTotal = 0;
      let lastMessage = "";
      for (const file of files) {
        const result = await uploadPdfFile(file);
        savedTotal += result.savedDelta;
        lastMessage = result.message;
      }
      await load();
      setStatus(savedTotal > 0 ? t.statusUploadedMatched(savedTotal) : lastMessage || t.statusUploadedNoMatch);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.statusUploadFailed);
    } finally {
      setUploadingPdfs(false);
    }
  };

  const indexedPdfCount = fullTextStatus?.summary.available ? fullTextStatus.summary.indexed : 0;
  const evidenceChunkCount = fullTextStatus?.summary.available ? fullTextStatus.summary.evidenceChunks || 0 : 0;
  const corpusLine = profile ? t.corpusLine(profile.summary.pdfSaved, indexedPdfCount, evidenceChunkCount) : t.corpusReading;
  const deferredPdfCount = profile?.summary.pdfNeeded || missingPdfQueue?.summary.count || 0;
  const activePdfCount = profile?.summary.pdfSaved || 0;
  const activeWorkflow = currentWorkflow ? t.workflows[currentWorkflow] : null;
  const statusOk = Boolean(assistantStatus?.configured);
  const publicWorkerMode = Boolean(assistantStatus?.publicWorker);

  return (
    <div className={`app-shell ${mobilePanelCollapsed ? "mobile-panel-collapsed" : ""}`}>
      <aside className="workspace-sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            C
          </div>
          <div>
            <h1>AI Prof. Chai</h1>
            <p>{t.brandSubtitle}</p>
          </div>
          <button
            className="mobile-panel-toggle"
            type="button"
            aria-expanded={!mobilePanelCollapsed}
            onClick={() => setMobilePanelCollapsed(!mobilePanelCollapsed)}
          >
            {mobilePanelCollapsed ? t.tools : t.collapse}
          </button>
        </div>

        <section className="sidebar-section status-section" aria-label={t.modelStatus}>
          <div className="section-heading">
            <h2>{t.modelStatus}</h2>
            <span className={`status-dot ${statusOk ? "ok" : "missing"}`} aria-hidden="true"></span>
          </div>
          <p className={`key-status ${statusOk ? "ok" : "missing"}`}>
            {assistantStatus?.configured ? t.modelReady(publicWorkerMode, assistantStatus.quotaLabel) : t.modelNotConnected}
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
                  placeholder={t.tokenPlaceholder}
                  autoComplete="off"
                />
              </label>
              <div className="key-actions">
                <button type="submit" disabled={savingToken || !assistantToken.trim()}>
                  {savingToken ? t.saving : t.saveLocally}
                </button>
                <button type="button" onClick={testAiConnection} disabled={checkingAi}>
                  {checkingAi ? t.testing : t.test}
                </button>
              </div>
            </form>
          ) : null}
          <p className="security-note">{publicWorkerMode ? t.securityPublic : t.securityLocal}</p>
          {assistantCheckMessage ? <p className="compact-feedback">{assistantCheckMessage}</p> : null}
        </section>

        <section className="sidebar-section account-section" aria-label={t.activeCorpus}>
          <h2>{t.activeCorpus}</h2>
          <p className="user-badge">{t.corpusBadge}</p>
          <button className="logout-button" type="button" onClick={load}>
            {t.refreshCorpus}
          </button>
        </section>

        <section className="sidebar-section conversation-section" aria-label={t.conversationHistory}>
          <div className="section-heading">
            <h2>{t.conversationHistory}</h2>
            <button className="mini-button" type="button" onClick={createConversation} aria-label={t.newConversation}>
              {t.newShort}
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
                <span className="conversation-title">{conversation.title === "New conversation" ? t.newConversation : conversation.title}</span>
                <span className="conversation-meta">
                  {t.messagesCount(conversation.messages.filter((message) => !message.loading).length)} · {formatTime(conversation.updatedAt, lang)}
                </span>
                <span
                  className="conversation-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteConversation(conversation.id);
                  }}
                  aria-label={t.deleteConversation}
                  role="button"
                >
                  <Trash2 size={13} />
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section mode-section" aria-label={t.researchModes}>
          <h2>{t.researchModes}</h2>
          <div className="mode-grid">
            {modeOrder.map((mode) => (
              <button
                key={mode}
                className={`mode-button ${currentMode === mode ? "active" : ""}`}
                type="button"
                onClick={() => setMode(mode)}
              >
                <span className="mode-title">{t.modes[mode].title}</span>
                <span className="mode-copy">{t.modes[mode].copy}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section workflow-section" aria-label={t.researchToolkit}>
          <h2>{t.researchToolkit}</h2>
          <div className="workflow-grid">
            {workflowOrder.map((workflow) => (
              <button
                key={workflow}
                className={`workflow-button ${currentWorkflow === workflow ? "active" : ""}`}
                type="button"
                onClick={() => applyWorkflow(workflow)}
              >
                <span className="workflow-title">{t.workflows[workflow].label}</span>
                <span className="workflow-copy">{t.workflows[workflow].copy}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section knowledge-section" aria-label={t.knowledgeBase}>
          <h2>{t.knowledgeBase}</h2>
          <dl className="stat-list">
            <div>
              <dt>{t.localPdfs}</dt>
              <dd>{profile?.summary.pdfSaved || 0}</dd>
            </div>
            <div>
              <dt>{t.evidenceChunks}</dt>
              <dd>{evidenceChunkCount}</dd>
            </div>
            <div>
              <dt>{t.indexedFullTexts}</dt>
              <dd>{indexedPdfCount}</dd>
            </div>
            <div>
              <dt>{t.pendingPdfs}</dt>
              <dd>{deferredPdfCount}</dd>
            </div>
          </dl>
          <div className="tool-links">
            <a href="/api/project-status" target="_blank" rel="noreferrer">
              {t.projectStatus}
            </a>
            <a href="/api/evidence-pack/md" target="_blank" rel="noreferrer">
              {t.evidencePack}
            </a>
            <a href="/api/goal-audit" target="_blank" rel="noreferrer">
              {t.goalAudit}
            </a>
          </div>
        </section>

        <section className="sidebar-section maintenance-section" aria-label={t.corpusMaintenance}>
          <h2>{t.corpusMaintenance}</h2>
          <input ref={pdfUploadInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={uploadSelectedPdfs} />
          <div className="maintenance-grid">
            <button type="button" onClick={scanDownloadedPdfs} disabled={refreshingPdfs}>
              <RefreshCw size={14} />
              {refreshingPdfs ? t.scanning : t.scan}
            </button>
            <button type="button" onClick={() => pdfUploadInputRef.current?.click()} disabled={uploadingPdfs}>
              <Upload size={14} />
              {uploadingPdfs ? t.uploading : t.upload}
            </button>
            <a href="/api/missing-pdfs/download-pack" target="_blank" rel="noreferrer">
              <FileQuestion size={14} />
              {t.pdfPack}
            </a>
            <a href="/api/missing-pdfs/library-request/ris">
              <FileDown size={14} />
              RIS
            </a>
          </div>
          <p className="compact-feedback">
            {distillation
              ? t.distillLine(distillation.themes.length, activePdfCount, evidenceChunkCount.toLocaleString(lang === "zh" ? "zh-CN" : "en-US"))
              : status}
          </p>
        </section>
      </aside>

      <main className="workbench">
        <header className="workbench-header">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h2>{t.headline}</h2>
          </div>
          <div className="header-actions">
            <span className="model-pill">{providerLabel(assistantStatus, t)}</span>
            <button
              className="clear-button lang-toggle"
              type="button"
              onClick={toggleLang}
              aria-label={lang === "en" ? "切换到中文" : "Switch to English"}
            >
              <Languages size={14} />
              {lang === "en" ? "中文" : "EN"}
            </button>
            <button className="clear-button" type="button" onClick={createConversation} aria-label={t.newConversation}>
              {t.newConversation}
            </button>
          </div>
        </header>

        <div className="workbench-body">
          <section className="chat-session" aria-label="AI Prof. Chai">
            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}${message.loading ? " loading" : ""}`}>
                  <div className="message-header">
                    <div className="message-role">{roleLabel(message.role, t)}</div>
                    {message.role === "assistant" && !message.loading ? (
                      <button className="copy-button" type="button" onClick={() => void copyMessage(message.content)}>
                        <Clipboard size={12} />
                        {t.copy}
                      </button>
                    ) : null}
                  </div>
                  <div
                    className="message-content"
                    dangerouslySetInnerHTML={{ __html: formatMessageHtml(message.id === welcomeMessageId ? t.welcome : message.content) }}
                  />
                  {message.citations?.length ? (
                    <div className="source-list">
                      <span className="source-label">{t.evidenceUsed}</span>
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
                {t.message}
              </label>
              {activeWorkflow ? <div className="workflow-chip">{t.currentTool(activeWorkflow.label)}</div> : null}
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
                placeholder={t.composerPlaceholder}
              />
              <button type="submit" disabled={sending || !input.trim()}>
                <Send size={16} />
                {t.send}
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}

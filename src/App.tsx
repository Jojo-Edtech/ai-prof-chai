import {
  Clipboard,
  FileDown,
  FileQuestion,
  KeyRound,
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
const mobilePanelKey = "ai-prof-chai-mobile-panel-collapsed-v1";

const modeOptions: Array<{ id: ResearchMode; title: string; copy: string }> = [
  { id: "research-design", title: "Research Design", copy: "Variables, models, methods" },
  { id: "theory-frame", title: "Theory Framing", copy: "Concept boundaries, mechanisms" },
  { id: "literature-position", title: "Literature Positioning", copy: "Contributions, gaps, agenda" },
  { id: "writing-feedback", title: "Writing Feedback", copy: "Paragraphs, titles, wording" }
];

const workflowTemplates: Record<WorkflowId, { mode: ResearchMode; label: string; copy: string; prompt: string }> = {
  "research-matrix": {
    mode: "research-design",
    label: "Research Matrix",
    copy: "Object x output type",
    prompt:
      "Act as AI Prof. Chai. Based on Prof. Chai's paper corpus, turn the following research direction into an object x output-type research matrix.\n\nResearch direction:\n\nPlease include: one-sentence takeaway, research matrix table, three paperable directions, next actions, and evidence boundaries."
  },
  "concept-boundary": {
    mode: "theory-frame",
    label: "Concept Boundary",
    copy: "Define, separate, measure",
    prompt:
      "Act as AI Prof. Chai. Based on Prof. Chai's paper corpus, help me clarify the boundary of the following concept and explain how to define, measure, and write it into a paper.\n\nConcept:\n\nPlease include: definition comparison table, boundary judgment, measurement suggestions, corpus evidence, and evidence boundaries."
  },
  "variable-model": {
    mode: "research-design",
    label: "Variable Model",
    copy: "Mechanisms, hypotheses, methods",
    prompt:
      "Act as AI Prof. Chai. Turn the following research idea into a variable model, mechanism pathway, draft hypotheses, and method suggestions.\n\nResearch idea:\n\nPlease include: variable table, mechanism pathway, draft hypotheses, method suggestions, and key risks."
  },
  "paper-pipeline": {
    mode: "literature-position",
    label: "Paper Pipeline",
    copy: "1/3/5-year plan",
    prompt:
      "Act as AI Prof. Chai. Design a 1-year / 3-year / 5-year paper pipeline for the following research direction.\n\nResearch direction:\n\nPlease include: timeline table, theory/method/contribution for each paper, cumulative research assets, and evidence boundaries."
  },
  "paragraph-feedback": {
    mode: "writing-feedback",
    label: "Paragraph Feedback",
    copy: "Diagnose, revise, retain",
    prompt:
      "Act as AI Prof. Chai. Diagnose and revise the following paper paragraph. Point out logic issues, what to retain, and what to remove or weaken.\n\nParagraph:\n\nPlease include: problem diagnosis table, revised version, content to retain, and content to remove or soften."
  }
};

const defaultMessages: MentorMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content:
      "Hi, I am AI Prof. Chai, a research mentor assistant grounded in Prof. Chai's paper corpus. Send me a research idea, paragraph draft, variable model, or follow-up question."
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

function roleLabel(role: ChatMessage["role"]) {
  return role === "user" ? "You" : "AI Prof. Chai";
}

function formatTime(value: number) {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
  } catch {
    return "";
  }
}

function providerLabel(status: AssistantStatus | null) {
  if (!status?.configured) return "Local rules";
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
  const [profile, setProfile] = useState<CorpusProfile | null>(null);
  const [distillation, setDistillation] = useState<DistillationProfile | null>(null);
  const [fullTextStatus, setFullTextStatus] = useState<FullTextStatus | null>(null);
  const [pdfAuditStatus, setPdfAuditStatus] = useState<PdfAuditStatus | null>(null);
  const [missingPdfQueue, setMissingPdfQueue] = useState<MissingPdfQueue | null>(null);
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeConversationId, setActiveConversationId] = useState(() => loadActiveId() || conversations[0]?.id || "");
  const [input, setInput] = useState("Help me identify which research strands in Prof. Chai's papers are most suitable for building AI Prof. Chai's mentor knowledge structure.");
  const [status, setStatus] = useState("Reading paper corpus");
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

  const load = async () => {
    setStatus("Refreshing corpus");
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
      setStatus(nextProfile.summary.total ? "Paper corpus ready" : "Waiting for WoS export");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "API unavailable");
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
    const template = workflowTemplates[workflow];
    updateActiveConversation({ mode: template.mode, workflow });
    setInput(template.prompt);
  };

  const copyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Reply copied");
    } catch {
      setStatus("Copy failed. Please select the text manually.");
    }
  };

  const send = async (text = input) => {
    const clean = text.trim();
    if (!clean || sending || !activeConversation) return;

    const userMessage: MentorMessage = { id: `user-${Date.now()}`, role: "user", content: clean };
    const loadingMessage: MentorMessage = {
      id: `assistant-loading-${Date.now()}`,
      role: "assistant",
      content: "Matching the paper corpus and drafting a research analysis...",
      loading: true
    };
    const nextMessages = [...messages.filter((message) => !message.loading), userMessage];
    updateActiveConversation({
      title: activeConversation.title === "New conversation" ? shortTitle(clean) : activeConversation.title,
      messages: [...nextMessages, loadingMessage]
    });
    setInput("");
    setSending(true);
    setStatus("AI Prof. Chai is answering");

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
      setStatus("AI Prof. Chai replied");
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI Prof. Chai is temporarily unavailable";
      updateActiveConversation({
        messages: [
          ...nextMessages,
          {
            id: `assistant-error-${Date.now()}`,
            role: "assistant",
            content: `The model is not connected yet: ${message}\n\nYou can continue with local rules for now. To use a ModelScope free token in the local version, save it from the left panel.`
          }
        ]
      });
      setStatus("AI Prof. Chai connection failed");
    } finally {
      setSending(false);
    }
  };

  const saveAssistantToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = assistantToken.trim();
    if (!token) {
      setStatus("Please paste a ModelScope token first");
      return;
    }

    setSavingToken(true);
    setStatus("Saving locally");
    try {
      setAssistantStatus(await configureAssistantToken(token));
      setAssistantToken("");
      setAssistantCheckMessage("Saved locally. You can test the connection now.");
      setStatus("ModelScope token saved locally");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingToken(false);
    }
  };

  const testAiConnection = async () => {
    if (checkingAi) return;
    setCheckingAi(true);
    setStatus("Testing ModelScope connection");
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
      setStatus(result.ok ? "ModelScope connection ready" : "ModelScope check did not pass");
    } catch (error) {
      const message = error instanceof Error ? error.message : "ModelScope connection check failed";
      setAssistantCheckMessage(message);
      setStatus(message);
    } finally {
      setCheckingAi(false);
    }
  };

  const scanDownloadedPdfs = async () => {
    if (refreshingPdfs) return;
    setRefreshingPdfs(true);
    setStatus("Scanning downloads and refreshing corpus");
    try {
      const result = await refreshDownloadedPdfs();
      await load();
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Download scan failed");
    } finally {
      setRefreshingPdfs(false);
    }
  };

  const uploadSelectedPdfs = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    event.target.value = "";
    if (!files.length || uploadingPdfs) return;

    setUploadingPdfs(true);
    setStatus(`Uploading ${files.length} PDF(s)`);
    try {
      let savedTotal = 0;
      let lastMessage = "";
      for (const file of files) {
        const result = await uploadPdfFile(file);
        savedTotal += result.savedDelta;
        lastMessage = result.message;
      }
      await load();
      setStatus(savedTotal > 0 ? `Uploaded and matched ${savedTotal} target PDF(s)` : lastMessage || "PDF uploaded, but no new target paper was matched");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PDF upload failed");
    } finally {
      setUploadingPdfs(false);
    }
  };

  const indexedPdfCount = fullTextStatus?.summary.available ? fullTextStatus.summary.indexed : 0;
  const evidenceChunkCount = fullTextStatus?.summary.available ? fullTextStatus.summary.evidenceChunks || 0 : 0;
  const corpusLine = profile
    ? `${profile.summary.pdfSaved} PDFs · ${indexedPdfCount} full texts · ${evidenceChunkCount} evidence chunks`
    : "Reading local paper corpus";
  const deferredPdfCount = profile?.summary.pdfNeeded || missingPdfQueue?.summary.count || 0;
  const activePdfCount = profile?.summary.pdfSaved || 0;
  const activeWorkflow = currentWorkflow ? workflowTemplates[currentWorkflow] : null;
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
            <p>Research Mentor Workspace</p>
          </div>
          <button
            className="mobile-panel-toggle"
            type="button"
            aria-expanded={!mobilePanelCollapsed}
            onClick={() => setMobilePanelCollapsed(!mobilePanelCollapsed)}
          >
            {mobilePanelCollapsed ? "Tools" : "Collapse"}
          </button>
        </div>

        <section className="sidebar-section status-section" aria-label="Model status">
          <div className="section-heading">
            <h2>Model Status</h2>
            <span className={`status-dot ${statusOk ? "ok" : "missing"}`} aria-hidden="true"></span>
          </div>
          <p className={`key-status ${statusOk ? "ok" : "missing"}`}>
            {assistantStatus?.configured
              ? `${publicWorkerMode ? "ModelScope Worker" : "ModelScope"} ready · today left ${assistantStatus.quotaLabel}`
              : "ModelScope token not connected yet"}
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
                  placeholder="ModelScope token (local only)"
                  autoComplete="off"
                />
              </label>
              <div className="key-actions">
                <button type="submit" disabled={savingToken || !assistantToken.trim()}>
                  {savingToken ? "Saving" : "Save locally"}
                </button>
                <button type="button" onClick={testAiConnection} disabled={checkingAi}>
                  {checkingAi ? "Testing" : "Test"}
                </button>
              </div>
            </form>
          ) : null}
          <p className="security-note">
            {publicWorkerMode
              ? "The public app calls the model through a protected Worker. Each browser has its own anonymous visitor identity, and the token never enters GitHub."
              : "The token stays on this computer in .env.local, never in chat history. A local 50-call daily guard is enabled."}
          </p>
          {assistantCheckMessage ? <p className="compact-feedback">{assistantCheckMessage}</p> : null}
        </section>

        <section className="sidebar-section account-section" aria-label="Active corpus">
          <h2>Active Corpus</h2>
          <p className="user-badge">Prof. Chai paper corpus</p>
          <button className="logout-button" type="button" onClick={load}>
            Refresh corpus
          </button>
        </section>

        <section className="sidebar-section conversation-section" aria-label="Conversation history">
          <div className="section-heading">
            <h2>Conversation History</h2>
            <button className="mini-button" type="button" onClick={createConversation} aria-label="New conversation">
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
                  aria-label="Delete conversation"
                  role="button"
                >
                  <Trash2 size={13} />
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section mode-section" aria-label="Research modes">
          <h2>Research Modes</h2>
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

        <section className="sidebar-section workflow-section" aria-label="Research toolkit">
          <h2>Research Toolkit</h2>
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

        <section className="sidebar-section knowledge-section" aria-label="Knowledge base">
          <h2>Knowledge Base</h2>
          <dl className="stat-list">
            <div>
              <dt>Local PDFs</dt>
              <dd>{profile?.summary.pdfSaved || 0}</dd>
            </div>
            <div>
              <dt>Evidence Chunks</dt>
              <dd>{evidenceChunkCount}</dd>
            </div>
            <div>
              <dt>Indexed Full Texts</dt>
              <dd>{indexedPdfCount}</dd>
            </div>
            <div>
              <dt>Pending PDFs</dt>
              <dd>{deferredPdfCount}</dd>
            </div>
          </dl>
          <div className="tool-links">
            <a href="/api/project-status" target="_blank" rel="noreferrer">
              Project status
            </a>
            <a href="/api/evidence-pack/md" target="_blank" rel="noreferrer">
              Evidence pack
            </a>
            <a href="/api/goal-audit" target="_blank" rel="noreferrer">
              Goal audit
            </a>
          </div>
        </section>

        <section className="sidebar-section maintenance-section" aria-label="Corpus maintenance">
          <h2>Corpus Maintenance</h2>
          <input ref={pdfUploadInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={uploadSelectedPdfs} />
          <div className="maintenance-grid">
            <button type="button" onClick={scanDownloadedPdfs} disabled={refreshingPdfs}>
              <RefreshCw size={14} />
              {refreshingPdfs ? "Scanning" : "Scan downloads"}
            </button>
            <button type="button" onClick={() => pdfUploadInputRef.current?.click()} disabled={uploadingPdfs}>
              <Upload size={14} />
              {uploadingPdfs ? "Uploading" : "Upload PDFs"}
            </button>
            <a href="/api/missing-pdfs/download-pack" target="_blank" rel="noreferrer">
              <FileQuestion size={14} />
              Download pack
            </a>
            <a href="/api/missing-pdfs/library-request/ris">
              <FileDown size={14} />
              RIS
            </a>
          </div>
          <p className="compact-feedback">
            {distillation ? `${distillation.themes.length} theme strands · ${activePdfCount} papers indexed · ${evidenceChunkCount} evidence chunks` : status}
            {pdfAuditStatus?.summary.available ? ` · high-confidence audit ${pdfAuditStatus.summary.high}` : ""}
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
            <button className="clear-button" type="button" onClick={createConversation} aria-label="New conversation">
              New conversation
            </button>
          </div>
        </header>

        <div className="workbench-body">
          <section className="chat-session" aria-label="Discuss research questions with AI Prof. Chai">
            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}${message.loading ? " loading" : ""}`}>
                  <div className="message-header">
                    <div className="message-role">{roleLabel(message.role)}</div>
                    {message.role === "assistant" && !message.loading ? (
                      <button className="copy-button" type="button" onClick={() => void copyMessage(message.content)}>
                        <Clipboard size={12} />
                        Copy
                      </button>
                    ) : null}
                  </div>
                  <div className="message-content" dangerouslySetInnerHTML={{ __html: formatMessageHtml(message.content) }} />
                  {message.citations?.length ? (
                    <div className="source-list">
                      <span className="source-label">Evidence used</span>
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
              {activeWorkflow ? <div className="workflow-chip">Current tool: {activeWorkflow.label}</div> : null}
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
                placeholder="Enter a research idea, paragraph, variable model, or follow-up"
              />
              <button type="submit" disabled={sending || !input.trim()}>
                <Send size={16} />
                Send
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}

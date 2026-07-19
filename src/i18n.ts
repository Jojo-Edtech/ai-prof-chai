export type Lang = "en" | "zh";

export const langStorageKey = "ai-prof-chai-lang-v1";

export type ResearchMode = "research-design" | "theory-frame" | "literature-position" | "writing-feedback";
export type WorkflowId = "research-matrix" | "concept-boundary" | "variable-model" | "paper-pipeline" | "paragraph-feedback";

const en = {
  brandSubtitle: "Research Mentor Workspace",
  tools: "Tools",
  collapse: "Collapse",
  modelStatus: "Model Status",
  modelReady: (worker: boolean, quota: string) => `${worker ? "ModelScope Worker" : "ModelScope"} ready · today left ${quota}`,
  modelNotConnected: "ModelScope token not connected yet",
  corpusLine: (pdfs: number, fullTexts: number, chunks: number) => `${pdfs} PDFs · ${fullTexts} full texts · ${chunks} evidence chunks`,
  corpusReading: "Reading local paper corpus",
  tokenPlaceholder: "ModelScope token (local only)",
  saveLocally: "Save locally",
  saving: "Saving",
  test: "Test",
  testing: "Testing",
  securityPublic:
    "The public app calls the model through a protected Worker. Each browser has its own anonymous visitor identity, and the token never enters GitHub.",
  securityLocal:
    "The token stays on this computer in .env.local, never in chat history. A local 50-call daily guard is enabled.",
  activeCorpus: "Active Corpus",
  corpusBadge: "Prof. Chai paper corpus",
  refreshCorpus: "Refresh corpus",
  conversationHistory: "Conversation History",
  newShort: "New",
  newConversation: "New conversation",
  deleteConversation: "Delete conversation",
  messagesCount: (count: number) => `${count} messages`,
  researchModes: "Research Modes",
  researchToolkit: "Research Toolkit",
  knowledgeBase: "Knowledge Base",
  localPdfs: "Local PDFs",
  evidenceChunks: "Evidence Chunks",
  indexedFullTexts: "Indexed Full Texts",
  pendingPdfs: "Pending PDFs",
  projectStatus: "Project status",
  evidencePack: "Evidence pack",
  goalAudit: "Goal audit",
  corpusMaintenance: "Corpus Maintenance",
  scan: "Scan",
  scanning: "Scanning",
  upload: "Upload",
  uploading: "Uploading",
  pdfPack: "PDF pack",
  distillLine: (themes: number, papers: number, chunks: string) => `${themes} strands · ${papers} papers · ${chunks} chunks`,
  eyebrow: "Research Mentor Corpus",
  headline: "AI Research Mentor",
  you: "You",
  copy: "Copy",
  evidenceUsed: "Evidence used",
  message: "Message",
  currentTool: (label: string) => `Current tool: ${label}`,
  composerPlaceholder: "Ask or paste text",
  send: "Send",
  localRules: "Local rules",
  welcome:
    "Hi, I am AI Prof. Chai, a research mentor assistant grounded in Prof. Chai's paper corpus. Send me a research idea, paragraph draft, variable model, or follow-up question.",
  loadingReply: "Matching the paper corpus and drafting a research analysis...",
  statusReading: "Reading paper corpus",
  statusRefreshing: "Refreshing corpus",
  statusReady: "Paper corpus ready",
  statusWaitingWos: "Waiting for WoS export",
  statusApiUnavailable: "API unavailable",
  statusCopied: "Reply copied",
  statusCopyFailed: "Copy failed. Please select the text manually.",
  statusAnswering: "AI Prof. Chai is answering",
  statusReplied: "AI Prof. Chai replied",
  statusConnectionFailed: "AI Prof. Chai connection failed",
  statusUnavailable: "AI Prof. Chai is temporarily unavailable",
  errorReply: (message: string) =>
    `The model is not connected yet: ${message}\n\nYou can continue with local rules for now. To use a ModelScope free token in the local version, save it from the left panel.`,
  statusPasteToken: "Please paste a ModelScope token first",
  statusSavingLocal: "Saving locally",
  savedTestNow: "Saved locally. You can test the connection now.",
  statusTokenSaved: "ModelScope token saved locally",
  statusSaveFailed: "Save failed",
  statusTestingConn: "Testing ModelScope connection",
  statusConnReady: "ModelScope connection ready",
  statusConnNotPass: "ModelScope check did not pass",
  statusConnCheckFailed: "ModelScope connection check failed",
  statusScanningDownloads: "Scanning downloads and refreshing corpus",
  statusScanFailed: "Download scan failed",
  statusUploadingN: (count: number) => `Uploading ${count} PDF(s)`,
  statusUploadedMatched: (count: number) => `Uploaded and matched ${count} target PDF(s)`,
  statusUploadedNoMatch: "PDF uploaded, but no new target paper was matched",
  statusUploadFailed: "PDF upload failed",
  modes: {
    "research-design": { title: "Research Design", copy: "Variables, models, methods" },
    "theory-frame": { title: "Theory Framing", copy: "Concept boundaries, mechanisms" },
    "literature-position": { title: "Literature Positioning", copy: "Contributions, gaps, agenda" },
    "writing-feedback": { title: "Writing Feedback", copy: "Paragraphs, titles, wording" }
  } as Record<ResearchMode, { title: string; copy: string }>,
  workflows: {
    "research-matrix": {
      label: "Research Matrix",
      copy: "Object x output type",
      prompt:
        "Act as AI Prof. Chai. Based on Prof. Chai's paper corpus, turn the following research direction into an object x output-type research matrix.\n\nResearch direction:\n\nPlease include: one-sentence takeaway, research matrix table, three paperable directions, next actions, and evidence boundaries."
    },
    "concept-boundary": {
      label: "Concept Boundary",
      copy: "Define, separate, measure",
      prompt:
        "Act as AI Prof. Chai. Based on Prof. Chai's paper corpus, help me clarify the boundary of the following concept and explain how to define, measure, and write it into a paper.\n\nConcept:\n\nPlease include: definition comparison table, boundary judgment, measurement suggestions, corpus evidence, and evidence boundaries."
    },
    "variable-model": {
      label: "Variable Model",
      copy: "Mechanisms, hypotheses, methods",
      prompt:
        "Act as AI Prof. Chai. Turn the following research idea into a variable model, mechanism pathway, draft hypotheses, and method suggestions.\n\nResearch idea:\n\nPlease include: variable table, mechanism pathway, draft hypotheses, method suggestions, and key risks."
    },
    "paper-pipeline": {
      label: "Paper Pipeline",
      copy: "1/3/5-year plan",
      prompt:
        "Act as AI Prof. Chai. Design a 1-year / 3-year / 5-year paper pipeline for the following research direction.\n\nResearch direction:\n\nPlease include: timeline table, theory/method/contribution for each paper, cumulative research assets, and evidence boundaries."
    },
    "paragraph-feedback": {
      label: "Paragraph Feedback",
      copy: "Diagnose, revise, retain",
      prompt:
        "Act as AI Prof. Chai. Diagnose and revise the following paper paragraph. Point out logic issues, what to retain, and what to remove or weaken.\n\nParagraph:\n\nPlease include: problem diagnosis table, revised version, content to retain, and content to remove or soften."
    }
  } as Record<WorkflowId, { label: string; copy: string; prompt: string }>
};

export type Strings = typeof en;

const zh: Strings = {
  brandSubtitle: "科研导师工作台",
  tools: "工具",
  collapse: "收起",
  modelStatus: "模型状态",
  modelReady: (worker, quota) => `${worker ? "ModelScope Worker" : "ModelScope"} 已就绪 · 今日剩余 ${quota}`,
  modelNotConnected: "尚未连接 ModelScope token",
  corpusLine: (pdfs, fullTexts, chunks) => `${pdfs} 篇 PDF · ${fullTexts} 篇全文 · ${chunks} 条证据块`,
  corpusReading: "正在读取本地论文语料",
  tokenPlaceholder: "ModelScope token(仅保存在本地)",
  saveLocally: "保存到本地",
  saving: "保存中",
  test: "测试",
  testing: "测试中",
  securityPublic: "公开版通过受保护的 Worker 调用模型,每个浏览器拥有独立的匿名访客身份,token 不会进入 GitHub。",
  securityLocal: "Token 仅保存在本机 .env.local,不会进入聊天记录。已启用本地每日 50 次调用保护。",
  activeCorpus: "当前语料",
  corpusBadge: "柴教授论文语料",
  refreshCorpus: "刷新语料",
  conversationHistory: "会话历史",
  newShort: "新建",
  newConversation: "新会话",
  deleteConversation: "删除会话",
  messagesCount: (count) => `${count} 条消息`,
  researchModes: "研究模式",
  researchToolkit: "科研工具箱",
  knowledgeBase: "知识库",
  localPdfs: "本地 PDF",
  evidenceChunks: "证据块",
  indexedFullTexts: "已索引全文",
  pendingPdfs: "待补 PDF",
  projectStatus: "项目状态",
  evidencePack: "证据包",
  goalAudit: "目标审计",
  corpusMaintenance: "语料维护",
  scan: "扫描",
  scanning: "扫描中",
  upload: "上传",
  uploading: "上传中",
  pdfPack: "PDF 清单",
  distillLine: (themes, papers, chunks) => `${themes} 个主题 · ${papers} 篇论文 · ${chunks} 条证据块`,
  eyebrow: "科研导师语料",
  headline: "AI 科研导师",
  you: "你",
  copy: "复制",
  evidenceUsed: "引用证据",
  message: "消息",
  currentTool: (label) => `当前工具:${label}`,
  composerPlaceholder: "输入问题或粘贴文本",
  send: "发送",
  localRules: "本地规则",
  welcome: "你好,我是 AI Prof. Chai,一位基于柴教授论文语料的科研导师助手。欢迎发给我研究想法、段落草稿、变量模型或追问。",
  loadingReply: "正在匹配论文语料并起草研究分析……",
  statusReading: "正在读取论文语料",
  statusRefreshing: "正在刷新语料",
  statusReady: "论文语料已就绪",
  statusWaitingWos: "等待 WoS 导出",
  statusApiUnavailable: "API 暂不可用",
  statusCopied: "已复制回复",
  statusCopyFailed: "复制失败,请手动选择文本。",
  statusAnswering: "AI Prof. Chai 正在回答",
  statusReplied: "AI Prof. Chai 已回复",
  statusConnectionFailed: "AI Prof. Chai 连接失败",
  statusUnavailable: "AI Prof. Chai 暂时不可用",
  errorReply: (message) =>
    `模型尚未接通:${message}\n\n当前可先使用本地规则继续。如需在本地版使用 ModelScope 免费 token,请在左侧面板保存。`,
  statusPasteToken: "请先粘贴 ModelScope token",
  statusSavingLocal: "正在保存到本地",
  savedTestNow: "已保存到本地,现在可以测试连接。",
  statusTokenSaved: "ModelScope token 已保存到本地",
  statusSaveFailed: "保存失败",
  statusTestingConn: "正在测试 ModelScope 连接",
  statusConnReady: "ModelScope 连接正常",
  statusConnNotPass: "ModelScope 检查未通过",
  statusConnCheckFailed: "ModelScope 连接检查失败",
  statusScanningDownloads: "正在扫描下载目录并刷新语料",
  statusScanFailed: "扫描下载目录失败",
  statusUploadingN: (count) => `正在上传 ${count} 个 PDF`,
  statusUploadedMatched: (count) => `已上传并匹配 ${count} 个目标 PDF`,
  statusUploadedNoMatch: "PDF 已上传,但未匹配到新的目标论文",
  statusUploadFailed: "PDF 上传失败",
  modes: {
    "research-design": { title: "研究设计", copy: "变量、模型与方法" },
    "theory-frame": { title: "理论建构", copy: "概念边界与机制" },
    "literature-position": { title: "文献定位", copy: "贡献、缺口与议程" },
    "writing-feedback": { title: "写作反馈", copy: "段落、标题与措辞" }
  },
  workflows: {
    "research-matrix": {
      label: "研究矩阵",
      copy: "对象 × 成果类型",
      prompt:
        "请扮演 AI Prof. Chai,基于柴教授的论文语料,把下面的研究方向拆成一张「研究对象 × 成果类型」研究矩阵。\n\n研究方向:\n\n请包含:一句话结论、研究矩阵表、三个可成文方向、下一步行动、证据边界。"
    },
    "concept-boundary": {
      label: "概念边界",
      copy: "界定、区分、测量",
      prompt:
        "请扮演 AI Prof. Chai,基于柴教授的论文语料,帮我厘清下面这个概念的边界,并说明如何界定、测量并写进论文。\n\n概念:\n\n请包含:定义对比表、边界判断、测量建议、语料证据、证据边界。"
    },
    "variable-model": {
      label: "变量模型",
      copy: "机制、假设与方法",
      prompt:
        "请扮演 AI Prof. Chai,把下面的研究想法转化为变量模型、机制路径、假设草案和方法建议。\n\n研究想法:\n\n请包含:变量表、机制路径、假设草案、方法建议、主要风险。"
    },
    "paper-pipeline": {
      label: "论文管线",
      copy: "1/3/5 年规划",
      prompt:
        "请扮演 AI Prof. Chai,为下面的研究方向设计 1 年 / 3 年 / 5 年的论文管线。\n\n研究方向:\n\n请包含:时间线表、每篇论文的理论/方法/贡献、累积的研究资产、证据边界。"
    },
    "paragraph-feedback": {
      label: "段落反馈",
      copy: "诊断、修改、保留",
      prompt:
        "请扮演 AI Prof. Chai,诊断并修改下面这段论文段落,指出逻辑问题、应保留的内容以及应删除或弱化的内容。\n\n段落:\n\n请包含:问题诊断表、修改后版本、应保留内容、应删除或弱化内容。"
    }
  }
};

export const translations: Record<Lang, Strings> = { en, zh };

export function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(langStorageKey);
    return saved === "zh" || saved === "en" ? saved : "en";
  } catch {
    return "en";
  }
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(langStorageKey, lang);
  } catch {
    // Language toggle still works for the current page without local storage.
  }
}

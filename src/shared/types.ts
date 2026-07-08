export type PublicationRecord = {
  id: string;
  title: string;
  year?: string;
  source?: string;
  documentType?: string;
  doi?: string;
  doiUrl?: string;
  wosAccession?: string;
  authors: string[];
  fullAuthors: string[];
  keywords: string[];
  abstract?: string;
  correspondingAddress?: string;
  emails: string[];
  openAccess?: string;
  oaUrl?: string;
  isFirstAuthor: boolean;
  isCorrespondingAuthor: boolean;
  pdfFile?: string;
  downloadStatus: "metadata-only" | "pdf-needed" | "pdf-saved";
  sourceFile: string;
};

export type CorpusSummary = {
  total: number;
  firstAuthor: number;
  correspondingAuthor: number;
  firstOrCorresponding: number;
  openAccess: number;
  pdfSaved: number;
  pdfNeeded: number;
};

export type CorpusProfile = {
  generatedAt: string;
  sourceFiles: string[];
  professor: {
    displayName: string;
    assistantName: string;
    aliases: string[];
  };
  summary: CorpusSummary;
  records: PublicationRecord[];
};

export type DistillationRecord = {
  title: string;
  year?: string;
  source?: string;
  doi?: string;
  downloadStatus: PublicationRecord["downloadStatus"];
};

export type DistillationTheme = {
  id: string;
  label: string;
  question: string;
  count: number;
  pdfSaved: number;
  years: string;
  representativeRecords: DistillationRecord[];
};

export type DistillationEra = {
  id: string;
  label: string;
  focus: string;
  count: number;
  pdfSaved: number;
  representativeRecords: DistillationRecord[];
};

export type DistillationProfile = {
  generatedAt: string;
  sourceGeneratedAt: string;
  professor: CorpusProfile["professor"];
  summary: CorpusSummary;
  targetCount: number;
  pdfCoverage: number;
  themes: DistillationTheme[];
  eras: DistillationEra[];
  missingPdf: Array<{
    title: string;
    year?: string;
    source?: string;
    doi?: string;
    expectedPath: string;
    role: string;
  }>;
};

export type FullTextRecord = {
  id: string;
  title: string;
  year?: string;
  source?: string;
  doi?: string;
  wosAccession?: string;
  pdfFile: string;
  pdfPath: string;
  status: "indexed" | "failed";
  pageCount: number;
  textLength: number;
  text?: string;
  detail?: string;
};

export type FullTextIndex = {
  generatedAt: string;
  sourceGeneratedAt: string;
  professor: CorpusProfile["professor"];
  summary: {
    targetPdfSaved: number;
    indexed: number;
    failed: number;
    totalTextLength: number;
    maxTextCharsPerPdf: number;
    evidenceChunks?: number;
    evidenceChunkChars?: number;
    evidenceChunkOverlap?: number;
  };
  records: FullTextRecord[];
};

export type FullTextStatus = {
  generatedAt?: string;
  sourceGeneratedAt?: string;
  summary: FullTextIndex["summary"] & {
    available: boolean;
  };
  records: Array<Omit<FullTextRecord, "text">>;
};

export type PdfAuditStatus = {
  generatedAt?: string;
  summary: {
    available: boolean;
    targetPdfSaved: number;
    high: number;
    medium: number;
    low: number;
  };
};

export type MissingPdfQueueItem = {
  title: string;
  year?: string;
  source?: string;
  doi?: string;
  wosAccession?: string;
  expectedPdfFile?: string;
  accessPriority?: string;
  actionGroup?: string;
  nextStep?: string;
  manualRoutes: string;
  note: string;
  links: Array<{
    label: string;
    url: string;
  }>;
  progress: {
    status: MissingPdfProgressStatus;
    updatedAt?: string;
  };
};

export type MissingPdfProgressStatus = "todo" | "opened" | "requested" | "blocked";

export type MissingPdfQueue = {
  generatedAt?: string;
  sourcePath: string;
  summary: {
    available: boolean;
    count: number;
    progress: Record<MissingPdfProgressStatus, number>;
  };
  items: MissingPdfQueueItem[];
};

export type PdfRefreshResult = {
  ok: boolean;
  generatedAt: string;
  before: {
    savedTargetPdfs: number;
    missingTargetPdfs: number;
  };
  after: {
    savedTargetPdfs: number;
    missingTargetPdfs: number;
    indexedPdfs: number;
    indexedTargetPdfs: number;
  };
  savedDelta: number;
  missingDelta: number;
  message: string;
  reportPath?: string;
};

export type PdfUploadResult = PdfRefreshResult & {
  uploadedFile: string;
};

export type AssistantStatus = {
  configured: boolean;
  provider: "deepseek" | "modelscope" | "dashscope" | "disabled";
  model: string;
  projectId: string;
  quotaLabel: string;
  tokenCount: number;
  setupHint: string;
  publicWorker?: boolean;
};

export type AssistantConnectionCheck = {
  ok: boolean;
  provider: AssistantStatus["provider"];
  model: string;
  quotaLabel: string;
  message: string;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

export type AssistantResponse = {
  message: ChatMessage;
  provider: AssistantStatus["provider"];
  model: string;
  quotaLabel: string;
  citations: string[];
};

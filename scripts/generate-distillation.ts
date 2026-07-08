import fs from "node:fs";
import path from "node:path";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";

type ThemeDefinition = {
  id: string;
  label: string;
  question: string;
  patterns: RegExp[];
};

type ThemeSummary = {
  id: string;
  label: string;
  question: string;
  count: number;
  pdfSaved: number;
  years: string;
  representativeRecords: Array<Pick<PublicationRecord, "title" | "year" | "source" | "doi" | "downloadStatus">>;
};

const projectRoot = process.cwd();
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");

const themes: ThemeDefinition[] = [
  {
    id: "ai-learning-intention",
    label: "AI learning intention and motivation",
    question: "学生或教师为什么愿意持续学习、教授和使用 AI？",
    patterns: [/artificial intelligence/i, /\bAI\b/i]
  },
  {
    id: "tpack-stem-teacher-learning",
    label: "TPACK, STEM, and teacher professional learning",
    question: "教师如何形成技术、教学法和学科知识的整合能力？",
    patterns: [/TPACK/i, /technological pedagogical/i, /STEM/i, /teacher professional/i, /professional development/i, /design belief/i, /design-based/i]
  },
  {
    id: "epistemic-beliefs-knowledge-creation",
    label: "Epistemic beliefs and knowledge creation",
    question: "教师和学生的认识论信念如何影响知识建构与在线互动？",
    patterns: [/epistem/i, /knowledge creation/i, /knowledge building/i, /beliefs about teaching/i, /online interaction/i, /collaborative learning/i]
  },
  {
    id: "twenty-first-century-learning",
    label: "21st-century learning and learner experience",
    question: "21 世纪学习实践如何与学生经验、效能感和学习环境相连？",
    patterns: [/21st/i, /twenty-first/i, /twenty first/i, /student.*experience/i, /learning strateg/i, /seamless/i, /self-regulat/i, /efficacy/i]
  },
  {
    id: "ict-teacher-education",
    label: "ICT integration and teacher education",
    question: "教师教育如何帮助职前教师穿梭于数字世界与学校实践？",
    patterns: [/\bICT\b/i, /teacher education/i, /pre-service/i, /preservice/i, /technology integration/i, /internet/i, /computer/i]
  }
];

const eras = [
  { id: "foundations", label: "2005-2010 Foundations", from: 2005, to: 2010, focus: "knowledge building, epistemic beliefs, ICT-supported teacher learning" },
  { id: "tpack-expansion", label: "2011-2016 TPACK Expansion", from: 2011, to: 2016, focus: "TPACK validation, teacher education, 21st-century learning practices" },
  { id: "stem-design", label: "2017-2020 STEM and Design Beliefs", from: 2017, to: 2020, focus: "STEM-TPACK, design beliefs, teacher professional learning, early AI learning intention" },
  { id: "ai-education", label: "2021-2026 AI Education", from: 2021, to: 2026, focus: "AI learning intention, motivation, readiness, and curriculum evaluation" }
];

function readProfile() {
  return JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
}

function targetRecords(profile: CorpusProfile) {
  return profile.records.filter((record) => record.isFirstAuthor || record.isCorrespondingAuthor);
}

function recordText(record: PublicationRecord) {
  return [record.title, record.abstract, record.source, record.keywords.join(" ")].filter(Boolean).join(" ");
}

function numericYear(record: PublicationRecord) {
  const year = Number(record.year);
  return Number.isFinite(year) ? year : 0;
}

function compactRecord(record: PublicationRecord) {
  return {
    title: record.title,
    year: record.year,
    source: record.source,
    doi: record.doi,
    downloadStatus: record.downloadStatus
  };
}

function yearSpan(records: PublicationRecord[]) {
  const years = records.map(numericYear).filter(Boolean).sort((left, right) => left - right);
  if (!years.length) return "n.d.";
  return years[0] === years[years.length - 1] ? String(years[0]) : `${years[0]}-${years[years.length - 1]}`;
}

function themeSummaries(records: PublicationRecord[]): ThemeSummary[] {
  return themes.map((theme) => {
    const matched = records
      .filter((record) => theme.patterns.some((pattern) => pattern.test(recordText(record))))
      .sort((left, right) => numericYear(right) - numericYear(left) || left.title.localeCompare(right.title));
    return {
      id: theme.id,
      label: theme.label,
      question: theme.question,
      count: matched.length,
      pdfSaved: matched.filter((record) => record.downloadStatus === "pdf-saved").length,
      years: yearSpan(matched),
      representativeRecords: matched.slice(0, 6).map(compactRecord)
    };
  });
}

function eraSummaries(records: PublicationRecord[]) {
  return eras.map((era) => {
    const matched = records
      .filter((record) => {
        const year = numericYear(record);
        return year >= era.from && year <= era.to;
      })
      .sort((left, right) => numericYear(right) - numericYear(left) || left.title.localeCompare(right.title));
    return {
      id: era.id,
      label: era.label,
      focus: era.focus,
      count: matched.length,
      pdfSaved: matched.filter((record) => record.downloadStatus === "pdf-saved").length,
      representativeRecords: matched.slice(0, 5).map(compactRecord)
    };
  });
}

function missingPdf(records: PublicationRecord[]) {
  return records
    .filter((record) => record.downloadStatus !== "pdf-saved")
    .sort((left, right) => numericYear(right) - numericYear(left) || left.title.localeCompare(right.title))
    .map((record) => ({
      title: record.title,
      year: record.year,
      source: record.source,
      doi: record.doi,
      expectedPath: record.pdfFile ? `data/pdfs/${record.pdfFile}` : "",
      role: record.isFirstAuthor && record.isCorrespondingAuthor ? "first_and_corresponding" : record.isFirstAuthor ? "first_author" : "corresponding_author"
    }));
}

function writeMarkdown(outputPath: string, profile: CorpusProfile, distillation: ReturnType<typeof buildDistillation>) {
  const lines = [
    "# AI Prof. Chai Distillation Dossier",
    "",
    `Generated: ${distillation.generatedAt}`,
    "",
    "This dossier is generated from local Web of Science metadata, abstracts, keywords, and PDF availability flags. It is a research map, not a substitute for close full-text coding.",
    "",
    "## Corpus Snapshot",
    "",
    `- WoS records: ${profile.summary.total}`,
    `- First-author records: ${profile.summary.firstAuthor}`,
    `- Corresponding-author records: ${profile.summary.correspondingAuthor}`,
    `- First or corresponding target records: ${profile.summary.firstOrCorresponding}`,
    `- Target PDFs saved: ${profile.summary.pdfSaved}`,
    `- Target PDFs still needed: ${profile.summary.pdfNeeded}`,
    "",
    "## Working Distillation",
    "",
    "AI Prof. Chai should be treated as a local research companion that answers through three layers: the bibliographic map, the target-paper PDF queue, and cautious synthesis from available abstracts/full texts.",
    "",
    "## Theme Map",
    ""
  ];

  for (const theme of distillation.themes) {
    lines.push(
      `### ${theme.label}`,
      "",
      `- Guiding question: ${theme.question}`,
      `- Target records: ${theme.count}`,
      `- PDFs saved in this theme: ${theme.pdfSaved}`,
      `- Year span: ${theme.years}`,
      "",
      "Representative records:"
    );
    if (theme.representativeRecords.length) {
      for (const record of theme.representativeRecords) {
        lines.push(`- ${record.year || "n.d."} | ${record.title}${record.doi ? ` | DOI: ${record.doi}` : ""} | ${record.downloadStatus}`);
      }
    } else {
      lines.push("- No target records matched this theme yet.");
    }
    lines.push("");
  }

  lines.push("## Timeline", "");
  for (const era of distillation.eras) {
    lines.push(`### ${era.label}`, "", `- Focus: ${era.focus}`, `- Target records: ${era.count}`, `- PDFs saved: ${era.pdfSaved}`, "");
    for (const record of era.representativeRecords) {
      lines.push(`- ${record.year || "n.d."} | ${record.title} | ${record.downloadStatus}`);
    }
    lines.push("");
  }

  lines.push("## Missing Full Text Queue", "");
  if (distillation.missingPdf.length) {
    for (const record of distillation.missingPdf) {
      lines.push(`- ${record.year || "n.d."} | ${record.title} | ${record.doi || "no DOI"} | ${record.expectedPath}`);
    }
  } else {
    lines.push("All target PDFs are saved.");
  }

  lines.push(
    "",
    "## Suggested AI Prof. Chai Prompts",
    "",
    "- 只基于第一作者/通讯作者目标论文，解释蔡老师研究从 ICT 教师教育到 AI 学习意向的转向。",
    "- 把 TPACK、epistemic beliefs、knowledge creation、AI learning intention 四条线分别列成概念演化图。",
    "- 哪些结论只能从摘要/题录支持，哪些需要等待剩余 PDF 补齐后再确认？",
    "- 为一个 AI 教育研究生生成 8 周阅读路线，每周只选 2-3 篇目标论文。",
    ""
  );

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function buildDistillation(profile: CorpusProfile) {
  const targets = targetRecords(profile);
  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: profile.generatedAt,
    professor: profile.professor,
    summary: profile.summary,
    targetCount: targets.length,
    pdfCoverage: profile.summary.firstOrCorresponding
      ? Number((profile.summary.pdfSaved / profile.summary.firstOrCorresponding).toFixed(3))
      : 0,
    themes: themeSummaries(targets),
    eras: eraSummaries(targets),
    missingPdf: missingPdf(targets)
  };
}

const profile = readProfile();
const distillation = buildDistillation(profile);
const processedDir = path.join(projectRoot, "data", "processed");
const outputsDir = path.join(projectRoot, "outputs");
fs.mkdirSync(processedDir, { recursive: true });
fs.mkdirSync(outputsDir, { recursive: true });

const jsonPath = path.join(processedDir, "chai-distillation.json");
const markdownPath = path.join(outputsDir, "ai-prof-chai-distillation.md");
fs.writeFileSync(jsonPath, `${JSON.stringify(distillation, null, 2)}\n`, "utf8");
writeMarkdown(markdownPath, profile, distillation);

console.log(`Distillation JSON: ${jsonPath}`);
console.log(`Distillation dossier: ${markdownPath}`);
console.log(`Themes: ${distillation.themes.length}`);
console.log(`Missing PDFs: ${distillation.missingPdf.length}`);

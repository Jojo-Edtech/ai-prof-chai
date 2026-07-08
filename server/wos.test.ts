import { describe, expect, it } from "vitest";
import { buildCorpusProfile, parseWosRecords, toPublication } from "./wos";

const sample = `FN Clarivate Analytics Web of Science
VR 1.0
PT J
AU Chai, CS
AU Wong, B
AF Chai, Ching Sing
AF Wong, Benjamin
TI Teacher professional learning for AI education
SO COMPUTERS & EDUCATION
DT Article
DE artificial intelligence; teacher learning; pedagogy
AB This study examines teacher learning in AI education.
RP Chai, Ching Sing (corresponding author), Chinese Univ Hong Kong, Hong Kong, China.
EM chai@example.edu
DI 10.1234/example
PY 2025
UT WOS:000000001
OA Green Published
ER
`;

describe("Web of Science parser", () => {
  it("marks Chai Ching Sing as first and corresponding author", () => {
    const raw = parseWosRecords(sample);
    const record = toPublication(raw[0], "savedrecs.txt", 0);
    expect(record.title).toBe("Teacher professional learning for AI education");
    expect(record.isFirstAuthor).toBe(true);
    expect(record.isCorrespondingAuthor).toBe(true);
    expect(record.keywords).toContain("artificial intelligence");
    expect(record.downloadStatus).toBe("pdf-needed");
    expect(record.doiUrl).toBe("https://doi.org/10.1234/example");
  });

  it("builds a deduped corpus profile", () => {
    const raw = parseWosRecords(sample);
    const records = [toPublication(raw[0], "a.txt", 0), toPublication(raw[0], "b.txt", 0)];
    const profile = buildCorpusProfile(records, ["a.txt", "b.txt"]);
    expect(profile.summary.total).toBe(1);
    expect(profile.summary.firstOrCorresponding).toBe(1);
    expect(profile.summary.pdfNeeded).toBe(1);
  });

  it("parses Web of Science CSV column names", () => {
    const csv = [
      "Authors,Author Full Names,Article Title,Source Title,Publication Year,DOI,Reprint Addresses,Author Keywords",
      "\"Chai, CS; Lee, A\",\"Chai, Ching Sing; Lee, Amy\",CSV title,Journal,2024,10.5555/csv,\"Chai, Ching Sing, Hong Kong\",\"AI; learning\""
    ].join("\n");
    const raw = parseWosRecords(csv);
    const record = toPublication(raw[0], "savedrecs.csv", 0);
    expect(record.title).toBe("CSV title");
    expect(record.isFirstAuthor).toBe(true);
    expect(record.isCorrespondingAuthor).toBe(true);
    expect(record.keywords).toContain("AI");
  });

  it("parses Web of Science tab-delimited full-record exports", () => {
    const tsv = [
      "\uFEFFPT\tAU\tAF\tTI\tSO\tDT\tDE\tRP\tEM\tDI\tPY\tUT",
      "J\tChai, CS; Wong, B\tChai, Ching Sing; Wong, Benjamin\tTSV title\tJournal\tArticle\tAI; teaching\tChai, CS (corresponding author), Chinese Univ Hong Kong.\tchai@example.edu\t10.7777/tsv\t2026\tWOS:000000002"
    ].join("\r\n");
    const raw = parseWosRecords(tsv);
    const record = toPublication(raw[0], "savedrecs.txt", 0);
    expect(raw).toHaveLength(1);
    expect(record.title).toBe("TSV title");
    expect(record.wosAccession).toBe("WOS:000000002");
    expect(record.isFirstAuthor).toBe(true);
    expect(record.isCorrespondingAuthor).toBe(true);
  });

  it("cleans stray export punctuation at the start of titles", () => {
    const tsv = [
      "\uFEFFPT\tAU\tAF\tTI\tSO\tDT\tRP\tPY\tUT",
      "J\tChai, CS\tChai, Ching Sing\t` Two exploratory studies of the relationships between teachers' epistemic beliefs\tJournal\tArticle\tChai, CS (corresponding author), Chinese Univ Hong Kong.\t2011\tWOS:CLEAN_TITLE"
    ].join("\r\n");
    const record = toPublication(parseWosRecords(tsv)[0], "clean-title.tsv", 0);
    expect(record.title).toBe("Two exploratory studies of the relationships between teachers' epistemic beliefs");
  });

  it("recognizes WoS name variants from the Chai researcher profile", () => {
    const rows = [
      ["Chai, Ching-Sing", "Sing, CC (corresponding author), Chinese Univ Hong Kong."],
      ["Sing, Chai Ching", "Chai, CS (corresponding author), Nanyang Technol Univ."],
      ["Chai, Ching Shing", "Chai, CS (corresponding author), Nanyang Technol Univ."]
    ];
    const tsv = [
      "\uFEFFPT\tAU\tAF\tTI\tSO\tDT\tRP\tPY\tUT",
      ...rows.map(([author, rp], index) =>
        ["J", author, author, `Variant ${index + 1}`, "Journal", "Article", rp, "2020", `WOS:VARIANT${index + 1}`].join("\t")
      )
    ].join("\r\n");
    const records = parseWosRecords(tsv).map((record, index) => toPublication(record, "variants.tsv", index));
    expect(records.every((record) => record.isFirstAuthor)).toBe(true);
    expect(records.every((record) => record.isCorrespondingAuthor)).toBe(true);
  });
});

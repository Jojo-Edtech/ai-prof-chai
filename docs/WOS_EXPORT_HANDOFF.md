# Web of Science Export Handoff

This project is waiting for the official Web of Science export. The Chrome tab is already at the CUHK Web of Science advanced-search page, but Web of Science is showing a human-verification challenge. Complete that challenge in Chrome first; do not bypass it.

## Search Scope

Use Web of Science Core Collection, all editions.

Recommended first search:

```text
AU=(Chai CS)
```

If WoS Researchers is accessible, use it to confirm the identity as:

```text
Chai Ching Sing
```

Export all author records for this identity. The local importer then keeps the records where Chai Ching Sing is first author or corresponding author, based on the first author field and reprint/corresponding-address field.

## Export Settings

Prefer one of these formats:

- Tab-delimited, full record
- Plain text, full record
- CSV, full record

If WoS offers content options, choose:

```text
Full Record and Cited References
```

Save or move the downloaded file into:

```text
data/wos/
```

Typical filenames are `savedrecs.txt`, `savedrecs.csv`, or `savedrecs.tsv`. Multiple files are fine.

## Import And Check

After the WoS export file is in `data/wos/`, run:

```bash
npm run import:wos
```

The importer writes:

- `data/processed/chai-publications.json`
- `data/processed/target-publications.md`
- `data/processed/target-publications.csv`

Check these summary counts:

- `total`: total exported WoS records after deduplication
- `firstAuthor`: records where the first author is Chai Ching Sing / Chai CS
- `correspondingAuthor`: records where the corresponding-address evidence names Chai
- `firstOrCorresponding`: the final target set for PDF collection

The target Markdown and CSV include evidence fields for manual audit:

- first author evidence
- corresponding author evidence
- expected PDF path

## PDF Handling

Only save PDFs that are legally accessible through open access or institutional access. Put them in:

```text
data/pdfs/
```

Use the exact expected filename from `target-publications.md` or `target-publications.csv`. Then run:

```bash
npm run import:wos
```

Matching records will change from `pdf-needed` to `pdf-saved`.

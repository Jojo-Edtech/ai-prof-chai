# AI Prof. Chai

A lightweight research mentor workspace based on a local paper corpus and a protected ModelScope Worker. The public GitHub Pages interface mirrors the Thomas distillation project pattern: the frontend is static, model calls go through a backend Worker, and the API token is never stored in the repository or browser code.

## Public App

- Frontend: GitHub Pages
- Model gateway: protected Cloudflare Worker
- Visitor isolation: anonymous browser-level visitor IDs
- Usage protection: per-visitor and global daily request caps
- Corpus surface: compressed public-safe summaries, not raw PDF files

## Local Corpus Workflow

Local-only scripts can import Web of Science exports, match legally downloaded PDFs, refresh the full-text evidence index, and rebuild the public-safe Worker knowledge bundle. PDF files, tokens, local environment files, and raw private materials are not committed.

Useful commands:

```bash
npm run dev
npm run build
npm run build:pages
npm run deploy:worker
```

## Token Safety

The public app uses a Worker secret for ModelScope. The token is not exposed to GitHub Pages, frontend JavaScript, browser local storage, or chat history. Local development can use `.env.local`, which is ignored by git.

## Evidence Boundary

The app distinguishes saved-PDF evidence, bibliographic or abstract-level evidence, and missing full-text gaps. It should be used as a research navigation and planning tool, not as a substitute for checking the original papers before formal academic claims.

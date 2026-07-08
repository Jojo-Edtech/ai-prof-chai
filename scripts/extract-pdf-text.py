#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from pypdf import PdfReader


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"status": "failed", "detail": "usage: extract-pdf-text.py <pdf>"}))
        return 1

    pdf_path = Path(sys.argv[1])
    try:
        reader = PdfReader(str(pdf_path))
        pages = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        text = "\n\n".join(pages)
        print(
            json.dumps(
                {
                    "status": "indexed",
                    "pageCount": len(reader.pages),
                    "text": text,
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as exc:
        print(json.dumps({"status": "failed", "detail": str(exc)}, ensure_ascii=False))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import re
import zipfile
from io import BytesIO
from pathlib import Path

EXPECTED_ZIP_SHA256 = "b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4"
TERMS = (
    "multipleChoice",
    "multipleSelection",
    "inlineChoice",
    "resequence",
    "matching",
    "updateChoices",
    "updateMatching",
    "choiceLabels",
    "preventReuseChoices",
)


def load_engine(repo_root: Path) -> str:
    archive = repo_root / "Formative" / "standalone-0.4.1" / "archive"
    parts = []
    for index in range(1, 8):
        path = archive / f"part{index:02d}.b64"
        parts.append(path.read_text(encoding="utf-8"))
    encoded = re.sub(r"\s+", "", "".join(parts))
    if len(encoded) != 38032:
        raise SystemExit(f"archive base64 length mismatch: {len(encoded)}")
    raw = base64.b64decode(encoded, validate=True)
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_ZIP_SHA256:
        raise SystemExit(f"archive sha mismatch: {digest}")
    with zipfile.ZipFile(BytesIO(raw)) as zf:
        return zf.read("formative-engine.js").decode("utf-8")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    source = load_engine(repo_root)
    print(f"ENGINE_CHARS={len(source)}")
    for term in TERMS:
        positions = [m.start() for m in re.finditer(re.escape(term), source)]
        print(f"\n===== {term} occurrences={len(positions)} =====")
        for index, pos in enumerate(positions[:8], start=1):
            start = max(0, pos - 1200)
            end = min(len(source), pos + 2600)
            snippet = source[start:end]
            print(f"\n--- {term} #{index} @ {pos} ---\n{snippet}")


if __name__ == "__main__":
    main()

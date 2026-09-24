#!/usr/bin/env python3
"""Build the standalone Cardinal Formative v2 extension without exposing its Chrome key."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path

VERSION = "0.5.0"
VERSION_NAME = "0.5.0-rc1"
BASELINE_ZIP_SHA256 = "b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4"
BASELINE_KEY_SHA256 = "aa8edacab725a307365f56fa25e8415344098ea93c5c4ec635a56c7f7d4d59bd"
PROTOCOL_ASSET_NAME = "CARDINAL_FORMATIVE_PROTOCOL_V2.md"

SERVICE_WORKER_FILES = [
    "identity-v2.js",
    "capabilities-v2.js",
    "validator-v2.js",
    "adapter-v2.js",
    "baseline-store-v2.js",
    "managed-state-v2.js",
    "reconciliation-v2.js",
    "planner-v2.js",
    "preflight-v2.js",
    "execution-contract-v2.js",
    "journal-v2.js",
    "executor-v2.js",
    "persistence-v2.js",
    "target-guard-v2.js",
    "transport-bridge-v2.js",
    "bootstrap-reconciliation-v2.js",
    "orchestrator-v2.js",
    "runtime-v2.js",
    "presentation-v2.js",
    "session-store-v2.js",
    "graphql-client-v2.js",
    "server-readiness-v2.js",
    "formative-reader-v2.js",
    "legacy-contract-v041.js",
    "legacy-primitives-v041.js",
    "mutation-input-guard-v2.js",
    "legacy-gateway-v2.js",
    "host-compat-v2.js",
    "server-stack-v2.js",
    "run-gate-v2.js",
    "production-stack-v2.js",
    "progress-v2.js",
    "progress-relay-v2.js",
    "error-presenter-v2.js",
    "target-selector-v2.js",
    "target-enumerator-v2.js",
    "session-bootstrap-v2.js",
    "session-capture-bridge-v2.js",
    "browser-controller-v2.js",
    "runtime-message-router-v2.js",
    "service-worker-bridge-v2.js",
    "extension-app-v2.js",
    "background-v2.js",
]

CHATGPT_FILES = [
    "package-parser-v2.js",
    "chatgpt-scanner-v2.js",
    "error-presenter-v2.js",
    "chatgpt-content-v2.js",
    "chatgpt-correction-audit-v2.js",
    "chatgpt-prepare-helper-v2.js",
    "chatgpt-entry-v2.js",
]

FORMATIVE_SESSION_FILES = [
    "formative-session-main-v2.js",
    "formative-session-content-v2.js",
]

FORMATIVE_PROGRESS_FILES = [
    "progress-v2.js",
    "formative-progress-content-v2.js",
    "formative-progress-entry-v2.js",
]

POPUP_FILES = [
    "popup-v2.html",
    "popup-v2.js",
]

ALL_SOURCE_FILES = sorted(set(
    SERVICE_WORKER_FILES + CHATGPT_FILES + FORMATIVE_SESSION_FILES + FORMATIVE_PROGRESS_FILES + POPUP_FILES
))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def reconstruct_baseline(repo_root: Path) -> bytes:
    archive = repo_root / "Formative" / "standalone-0.4.1" / "archive"
    parts = sorted(archive.glob("part*.b64"))
    if not parts:
        raise RuntimeError("0.4.1 archive parts are missing")
    encoded = "".join(part.read_text(encoding="utf-8") for part in parts)
    raw = base64.b64decode(encoded)
    digest = sha256_bytes(raw)
    if digest != BASELINE_ZIP_SHA256:
        raise RuntimeError(f"0.4.1 baseline ZIP drift: {digest}")
    return raw


def baseline_manifest(raw_zip: bytes, scratch: Path) -> dict:
    scratch.mkdir(parents=True, exist_ok=True)
    zip_path = scratch / "baseline-0.4.1.zip"
    zip_path.write_bytes(raw_zip)
    with zipfile.ZipFile(zip_path) as zf:
        data = json.loads(zf.read("manifest.json").decode("utf-8"))
    key = data.get("key")
    if not isinstance(key, str) or not key:
        raise RuntimeError("0.4.1 manifest.key missing")
    key_digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    if key_digest != BASELINE_KEY_SHA256:
        raise RuntimeError(f"0.4.1 extension identity drift: {key_digest}")
    return data


def make_manifest(baseline: dict) -> dict:
    return {
        "manifest_version": 3,
        "name": "Cardinal - Formative Importer Beta",
        "version": VERSION,
        "version_name": VERSION_NAME,
        "description": "Importeur Cardinal Formative v2 avec validation, reprise et vérification serveur.",
        "key": baseline["key"],
        "permissions": ["tabs", "webRequest", "storage"],
        "host_permissions": [
            "https://app.formative.com/*",
            "https://svc.goformative.com/*",
            "https://chatgpt.com/*",
            "https://chat.openai.com/*",
        ],
        "background": {"service_worker": "background-v2.js"},
        "content_scripts": [
            {
                "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
                "js": CHATGPT_FILES,
                "run_at": "document_idle",
            },
            {
                "matches": ["https://app.formative.com/*"],
                "js": ["formative-session-main-v2.js"],
                "run_at": "document_start",
                "world": "MAIN",
            },
            {
                "matches": ["https://app.formative.com/*"],
                "js": ["formative-session-content-v2.js"],
                "run_at": "document_start",
            },
            {
                "matches": ["https://app.formative.com/*"],
                "js": FORMATIVE_PROGRESS_FILES,
                "run_at": "document_idle",
            },
        ],
        "action": {
            "default_title": "Cardinal - Formative Importer",
            "default_popup": "popup-v2.html",
        },
        "web_accessible_resources": [
            {
                "resources": [PROTOCOL_ASSET_NAME],
                "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
            }
        ],
    }


def validate_sources(repo_root: Path, source_dir: Path) -> None:
    missing = [name for name in ALL_SOURCE_FILES if not (source_dir / name).is_file()]
    protocol_source = repo_root / "Formative" / "CHATGPT_GENERATOR_PROMPT_V2.md"
    if not protocol_source.is_file():
        missing.append(str(protocol_source.relative_to(repo_root)))
    if missing:
        raise RuntimeError("Missing v2 build sources: " + ", ".join(missing))
    forbidden = {"legacy-session-bridge-v2.js"}
    present = forbidden.intersection(ALL_SOURCE_FILES)
    if present:
        raise RuntimeError("Forbidden duplicate session bridge in build: " + ", ".join(sorted(present)))


def write_dist(repo_root: Path, out_dir: Path, manifest: dict) -> None:
    source_dir = repo_root / "Formative" / "v2"
    validate_sources(repo_root, source_dir)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    for name in ALL_SOURCE_FILES:
        shutil.copy2(source_dir / name, out_dir / name)

    protocol_source = repo_root / "Formative" / "CHATGPT_GENERATOR_PROMPT_V2.md"
    protocol_text = protocol_source.read_text(encoding="utf-8")
    if "cardinal.formative/2" not in protocol_text or "Version du protocole: 2.0.0" not in protocol_text:
        raise RuntimeError("Cardinal Formative v2 protocol asset is incomplete")
    (out_dir / PROTOCOL_ASSET_NAME).write_text(protocol_text, encoding="utf-8")

    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (out_dir / "README.txt").write_text(
        "Cardinal - Formative Importer 0.5.0-rc1\n"
        "\n"
        "Version candidate du moteur v2. La version 0.4.1 demeure le retour arrière validé.\n"
        "Le paquet conserve volontairement la même identité Chrome que 0.4.1.\n"
        "\n"
        "Flux attendu : ChatGPT -> validation -> Formative -> vérification serveur.\n"
        "Le bouton Copier le prompt Formative copie une consigne compacte à coller dans ChatGPT.\n",
        encoding="utf-8",
    )
    metadata = {
        "schema": "cardinal.formative.build/1",
        "version": VERSION,
        "versionName": VERSION_NAME,
        "baselineZipSha256": BASELINE_ZIP_SHA256,
        "extensionKeySha256": BASELINE_KEY_SHA256,
        "sourceFileCount": len(ALL_SOURCE_FILES),
        "protocolAsset": PROTOCOL_ASSET_NAME,
    }
    (out_dir / "build-metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def validate_manifest(dist: Path) -> None:
    manifest = json.loads((dist / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") != VERSION:
        raise RuntimeError("built manifest version mismatch")
    if manifest.get("permissions") != ["tabs", "webRequest", "storage"]:
        raise RuntimeError("built manifest permissions drift")
    key_digest = hashlib.sha256(manifest["key"].encode("utf-8")).hexdigest()
    if key_digest != BASELINE_KEY_SHA256:
        raise RuntimeError("built extension key does not preserve 0.4.1 identity")
    refs = {manifest["background"]["service_worker"]}
    for block in manifest.get("content_scripts", []):
        refs.update(block.get("js", []))
    popup = manifest.get("action", {}).get("default_popup")
    if popup:
        refs.add(popup)
    for block in manifest.get("web_accessible_resources", []):
        refs.update(block.get("resources", []))
    missing = [name for name in sorted(refs) if not (dist / name).is_file()]
    if missing:
        raise RuntimeError("manifest references missing files: " + ", ".join(missing))
    if "legacy-session-bridge-v2.js" in refs:
        raise RuntimeError("legacy duplicate session bridge referenced by manifest")
    protocol = (dist / PROTOCOL_ASSET_NAME).read_text(encoding="utf-8")
    if "cardinal.formative/2" not in protocol or "Version du protocole: 2.0.0" not in protocol:
        raise RuntimeError("built protocol asset invalid")


def make_zip(dist: Path, zip_path: Path) -> None:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(dist.iterdir()):
            if path.is_file():
                zf.write(path, path.name)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output-root", type=Path, default=None)
    args = parser.parse_args(argv)

    repo_root = args.repo_root.resolve()
    output_root = (args.output_root or (repo_root / "dist" / "formative-v2")).resolve()
    dist = output_root / "Cardinal-Formative-Importer-STANDALONE-0.5.0-rc1"
    zip_path = output_root / "Cardinal-Formative-Importer-STANDALONE-0.5.0-rc1.zip"
    scratch = output_root / ".scratch"

    raw = reconstruct_baseline(repo_root)
    baseline = baseline_manifest(raw, scratch)
    manifest = make_manifest(baseline)
    write_dist(repo_root, dist, manifest)
    validate_manifest(dist)
    make_zip(dist, zip_path)

    print(f"BUILT_EXTENSION={zip_path}")
    print(f"BUILT_EXTENSION_SHA256={sha256_bytes(zip_path.read_bytes())}")
    print(f"EXTENSION_KEY_SHA256={BASELINE_KEY_SHA256}")
    print(f"SOURCE_FILE_COUNT={len(ALL_SOURCE_FILES)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

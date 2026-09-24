#!/usr/bin/env python3
"""Read-only forensic audit for a recovered Cardinal Gestion 1.1.9 directory."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from aio_rebuild_contract import (
    BaselineContractError,
    load_and_validate_extracted_baseline,
    snapshot_tree_hashes,
    tree_hash_manifest_digest,
)
from rebuild_aio_safe import manifest_direct_refs, patch_historical_graphql


EXPECTED_VERSION = "1.1.9"
REQUIRED_PERMISSIONS = {"scripting", "tabs", "windows", "webRequest", "storage"}
REQUIRED_HOSTS = {
    "https://app.formative.com/*",
    "https://svc.goformative.com/*",
}
REQUIRED_MARKERS = {
    "stableFormativeAction": "CARDINAL_STABLE_FORMATIVE_ACTION",
    "mozaikUi116": "__cardinalMozaikUiV116",
    "chatgpt119": "1.1.9",
}
BANNED_FILENAMES = re.compile(
    r"^(?:background-v09\d\.js|chatgpt-ui\.js|formative-simple-ui\.js|"
    r"formative-stealth-v09\d\.js)$",
    re.I,
)


def _all_files(root: Path) -> set[str]:
    return {
        str(p.relative_to(root)).replace("\\", "/")
        for p in root.rglob("*")
        if p.is_file()
    }


def _read_js_corpus(root: Path) -> str:
    chunks = []
    for path in sorted(root.rglob("*.js")):
        try:
            chunks.append(path.read_text(encoding="utf-8"))
        except UnicodeDecodeError:
            chunks.append(path.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(chunks)


def _node_syntax(root: Path) -> tuple[bool, list[str]]:
    node = shutil.which("node")
    if not node:
        return False, ["node introuvable: validation syntaxique JS non exécutée"]

    problems = []
    for path in sorted(root.rglob("*.js")):
        proc = subprocess.run(
            [node, "--check", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.returncode != 0:
            problems.append(
                f"{path.relative_to(root)}: {proc.stderr.strip() or proc.stdout.strip()}"
            )
    return True, problems


def audit_baseline(root: Path) -> dict:
    root = Path(root).resolve()
    manifest = load_and_validate_extracted_baseline(root)
    files = _all_files(root)
    errors: list[str] = []
    warnings: list[str] = []

    if str(manifest.get("version", "")) != EXPECTED_VERSION:
        errors.append(
            f"manifest.version={manifest.get('version')!r}, attendu {EXPECTED_VERSION!r}"
        )

    permissions = set(manifest.get("permissions") or [])
    missing_permissions = sorted(REQUIRED_PERMISSIONS - permissions)
    if missing_permissions:
        errors.append(
            "permissions historiques manquantes: " + ", ".join(missing_permissions)
        )

    hosts = set(manifest.get("host_permissions") or [])
    missing_hosts = sorted(REQUIRED_HOSTS - hosts)
    if missing_hosts:
        errors.append(
            "host_permissions historiques manquantes: " + ", ".join(missing_hosts)
        )

    refs = manifest_direct_refs(manifest)
    missing_refs = sorted(ref for ref in refs if ref not in files)
    if missing_refs:
        errors.append("références manifest absentes: " + ", ".join(missing_refs))

    banned = sorted(
        str(path.relative_to(root)).replace("\\", "/")
        for path in root.rglob("*")
        if path.is_file() and BANNED_FILENAMES.match(path.name)
    )
    if banned:
        errors.append("fichiers expérimentaux 0.9.x présents: " + ", ".join(banned))

    corpus = _read_js_corpus(root)
    marker_status = {
        key: marker in corpus for key, marker in REQUIRED_MARKERS.items()
    }
    for key, present in marker_status.items():
        if not present:
            errors.append(f"marqueur stable absent: {key} -> {REQUIRED_MARKERS[key]}")

    chatgpt = (root / "chatgpt.js").read_text(encoding="utf-8", errors="replace")
    if "1.1.9" not in chatgpt:
        errors.append("chatgpt.js ne contient pas le marqueur de version 1.1.9")

    popup_names = []
    action = manifest.get("action") or {}
    default_popup = str(action.get("default_popup") or "").strip()
    if default_popup:
        popup_names.append(default_popup)
        popup_path = root / default_popup
        popup_source = popup_path.read_text(encoding="utf-8", errors="replace") if popup_path.is_file() else ""
        body_closures = re.findall(r"</body\s*>", popup_source, re.I)
        if len(body_closures) != 1:
            errors.append(
                "popup historique non adaptable: "
                f"{len(body_closures)} fermeture(s) </body>, exactement 1 attendue"
            )
    else:
        errors.append("popup historique action.default_popup absent")

    popup_names.extend(
        p.name for p in root.glob("popup*.js") if p.is_file()
    )
    popup_text = ""
    for name in sorted(set(popup_names)):
        path = root / name
        if path.is_file():
            popup_text += path.read_text(encoding="utf-8", errors="replace") + "\n"
    if "Préparer une correction" not in popup_text:
        errors.append("surface historique 'Préparer une correction' non retrouvée")

    service_worker = root / "service-worker.js"
    with tempfile.TemporaryDirectory(prefix="cardinal-recovered-worker-") as td:
        probe = Path(td) / "service-worker.js"
        shutil.copy2(service_worker, probe)
        try:
            patch_historical_graphql(probe)
        except BaselineContractError as exc:
            errors.append(f"worker historique /graphql incompatible: {exc}")

    node_executed, node_problems = _node_syntax(root)
    if node_executed:
        errors.extend(f"syntaxe JS: {problem}" for problem in node_problems)
    else:
        warnings.extend(node_problems)

    tree = snapshot_tree_hashes(root)
    report = {
        "schema": "cardinal.gestion.recovered-audit/1",
        "root": str(root),
        "version": manifest.get("version"),
        "name": manifest.get("name"),
        "fileCount": len(files),
        "treeSha256": tree_hash_manifest_digest(tree),
        "markerStatus": marker_status,
        "permissions": sorted(permissions),
        "hostPermissions": sorted(hosts),
        "nodeSyntaxExecuted": node_executed,
        "errors": errors,
        "warnings": warnings,
        "pass": not errors,
        "fileSha256": tree,
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    try:
        report = audit_baseline(args.root)
    except BaselineContractError as exc:
        report = {
            "schema": "cardinal.gestion.recovered-audit/1",
            "root": str(args.root.resolve()),
            "pass": False,
            "errors": [str(exc)],
            "warnings": [],
        }

    encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0 if report.get("pass") else 2


if __name__ == "__main__":
    raise SystemExit(main())

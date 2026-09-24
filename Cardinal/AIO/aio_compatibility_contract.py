#!/usr/bin/env python3
"""Compatibility gates for merging formerly separate Chrome extensions into one AIO."""

from __future__ import annotations

import re
from pathlib import Path


class CompatibilityContractError(RuntimeError):
    pass


_GLOBAL_WRITE_RE = re.compile(
    r"\b(?:globalThis|window)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*="
)
_DOM_ID_ASSIGN_RE = re.compile(
    r"\.id\s*=\s*(['\"])([^'\"]+)\1"
)
_DOM_ID_LOOKUP_RE = re.compile(
    r"\bgetElementById\s*\(\s*(['\"])([^'\"]+)\1\s*\)"
)
_STORAGE_KEY_CONST_RE = re.compile(
    r"\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*KEY[A-Za-z0-9_$]*\s*=\s*(['\"])([^'\"]+)\1",
    re.I,
)
_STORAGE_LITERAL_CALL_RE = re.compile(
    r"\bchrome\.storage\.(?:local|session)\.(?:get|remove)\s*\(\s*(['\"])([^'\"]+)\1\s*\)"
)
_MATCH_HOST_RE = re.compile(r"^[A-Za-z*]+://([^/]+)/")
_IMPORT_SCRIPTS_RE = re.compile(r"\bimportScripts\s*\((.*?)\)\s*;", re.S)
_QUOTED_RE = re.compile(r"['\"]([^'\"]+)['\"]")


def explicit_global_writes(text: str) -> set[str]:
    return {match.group(1) for match in _GLOBAL_WRITE_RE.finditer(str(text or ""))}


def dom_id_literals(text: str) -> set[str]:
    source = str(text or "")
    out = {match.group(2) for match in _DOM_ID_ASSIGN_RE.finditer(source)}
    out.update(match.group(2) for match in _DOM_ID_LOOKUP_RE.finditer(source))
    return out


def storage_key_literals(text: str) -> set[str]:
    source = str(text or "")
    out = {match.group(2) for match in _STORAGE_KEY_CONST_RE.finditer(source)}
    out.update(match.group(2) for match in _STORAGE_LITERAL_CALL_RE.finditer(source))
    return out


def _normalized_host(pattern: str) -> str | None:
    match = _MATCH_HOST_RE.match(str(pattern or "").strip())
    if not match:
        return None
    host = match.group(1).lower().strip()
    return host or None


def _hosts_overlap(left: str, right: str) -> bool:
    if left == right:
        return True
    if left == "*" or right == "*":
        return True
    if left.startswith("*."):
        suffix = left[1:]
        return right.endswith(suffix) or right == left[2:]
    if right.startswith("*."):
        suffix = right[1:]
        return left.endswith(suffix) or left == right[2:]
    return False


def _read(root: Path, relative: str) -> str:
    path = Path(root) / relative
    if not path.is_file():
        raise CompatibilityContractError(f"Script de compatibilité absent: {relative}")
    return path.read_text(encoding="utf-8", errors="replace")


def content_script_bundles(manifest: dict) -> dict[tuple[str, str], list[str]]:
    """Return script order for every host/world combination that can co-exist."""
    blocks = []
    all_hosts: set[str] = set()
    for block in manifest.get("content_scripts") or []:
        hosts = {
            host
            for host in (_normalized_host(value) for value in (block.get("matches") or []))
            if host
        }
        world = str(block.get("world") or "ISOLATED").upper()
        scripts = [str(name) for name in (block.get("js") or [])]
        blocks.append((world, hosts, scripts))
        all_hosts.update(hosts)

    bundles: dict[tuple[str, str], list[str]] = {}
    for target_host in sorted(all_hosts):
        for world in sorted({row[0] for row in blocks}):
            ordered = []
            for block_world, block_hosts, scripts in blocks:
                if block_world != world:
                    continue
                if any(_hosts_overlap(target_host, host) for host in block_hosts):
                    ordered.extend(scripts)
            if ordered:
                bundles[(world, target_host)] = ordered
    return bundles


def _isolated_script_rows(root: Path, manifest: dict, family: str) -> list[dict]:
    rows: list[dict] = []
    for block_index, block in enumerate(manifest.get("content_scripts") or []):
        if str(block.get("world") or "ISOLATED").upper() == "MAIN":
            continue
        hosts = sorted({
            host
            for host in (_normalized_host(value) for value in (block.get("matches") or []))
            if host
        })
        for relative in block.get("js") or []:
            text = _read(root, relative)
            rows.append({
                "family": family,
                "block": block_index,
                "file": relative,
                "hosts": hosts,
                "globals": explicit_global_writes(text),
                "domIds": dom_id_literals(text),
                "storageKeys": storage_key_literals(text),
            })
    return rows


def _worker_script_rows(root: Path, manifest: dict, family: str) -> list[dict]:
    worker = str((manifest.get("background") or {}).get("service_worker") or "").strip()
    if not worker:
        return []

    seen: set[str] = set()
    rows: list[dict] = []

    def walk(relative: str) -> None:
        if relative in seen:
            return
        seen.add(relative)
        text = _read(root, relative)
        rows.append({
            "family": family,
            "block": None,
            "file": relative,
            "hosts": ["<service-worker>"],
            "globals": explicit_global_writes(text),
            "domIds": set(),
            "storageKeys": storage_key_literals(text),
            "scope": "worker",
        })
        for match in _IMPORT_SCRIPTS_RE.finditer(text):
            for imported in _QUOTED_RE.findall(match.group(1)):
                walk(imported)

    walk(worker)
    return rows


def _cross_family_worker_global_collisions(left_rows: list[dict], right_rows: list[dict]) -> list[dict]:
    collisions = []
    left_workers = [row for row in left_rows if row.get("scope") == "worker"]
    right_workers = [row for row in right_rows if row.get("scope") == "worker"]
    for left in left_workers:
        for right in right_workers:
            for name in sorted(left["globals"].intersection(right["globals"])):
                collisions.append({
                    "kind": "worker-global",
                    "name": name,
                    "baselineFiles": [left["file"]],
                    "addonFiles": [right["file"]],
                })
    return collisions


def _cross_family_storage_collisions(left_rows: list[dict], right_rows: list[dict]) -> list[dict]:
    left: dict[str, set[str]] = {}
    right: dict[str, set[str]] = {}
    for row in left_rows:
        for key in row["storageKeys"]:
            left.setdefault(key, set()).add(row["file"])
    for row in right_rows:
        for key in row["storageKeys"]:
            right.setdefault(key, set()).add(row["file"])

    collisions = []
    for key in sorted(set(left).intersection(right)):
        collisions.append({
            "kind": "storage",
            "name": key,
            "baselineFiles": sorted(left[key]),
            "addonFiles": sorted(right[key]),
        })
    return collisions


def _cross_family_page_collisions(left_rows: list[dict], right_rows: list[dict]) -> tuple[list[dict], set[str]]:
    collisions: list[dict] = []
    overlapping_hosts: set[str] = set()

    for left in left_rows:
        for right in right_rows:
            overlaps = sorted({
                lhost
                for lhost in left["hosts"]
                for rhost in right["hosts"]
                if _hosts_overlap(lhost, rhost)
            })
            if not overlaps:
                continue
            overlapping_hosts.update(overlaps)

            for kind, field in (("global", "globals"), ("dom-id", "domIds")):
                for name in sorted(left[field].intersection(right[field])):
                    collisions.append({
                        "kind": kind,
                        "name": name,
                        "hosts": overlaps,
                        "baselineFiles": [left["file"]],
                        "addonFiles": [right["file"]],
                    })

    # Deduplicate rows that can be reached through multiple manifest blocks.
    unique = {}
    for row in collisions:
        key = (
            row["kind"],
            row["name"],
            tuple(row.get("hosts") or []),
            tuple(row["baselineFiles"]),
            tuple(row["addonFiles"]),
        )
        unique[key] = row
    return list(unique.values()), overlapping_hosts


def assert_isolated_world_compatibility(
    *,
    baseline_root: Path,
    baseline_manifest: dict,
    addon_root: Path,
    addon_manifest: dict,
) -> dict:
    """Reject collisions that appear only after formerly separate extensions share one isolated world.

    MAIN-world scripts are intentionally excluded because they do not share the
    extension isolated world. Storage keys are compared across all isolated
    content scripts because chrome.storage becomes shared after the merge.
    """
    baseline_rows = _isolated_script_rows(Path(baseline_root), baseline_manifest, "baseline")
    addon_rows = _isolated_script_rows(Path(addon_root), addon_manifest, "addon")
    baseline_rows += _worker_script_rows(Path(baseline_root), baseline_manifest, "baseline")
    addon_rows += _worker_script_rows(Path(addon_root), addon_manifest, "addon")

    page_collisions, overlapping_hosts = _cross_family_page_collisions(
        [row for row in baseline_rows if row.get("scope") != "worker"],
        [row for row in addon_rows if row.get("scope") != "worker"],
    )
    worker_collisions = _cross_family_worker_global_collisions(baseline_rows, addon_rows)
    storage_collisions = _cross_family_storage_collisions(baseline_rows, addon_rows)
    collisions = page_collisions + worker_collisions + storage_collisions

    report = {
        "baselineScriptCount": len(baseline_rows),
        "addonScriptCount": len(addon_rows),
        "overlappingHosts": sorted(overlapping_hosts),
        "collisions": collisions,
    }
    if collisions:
        detail = "; ".join(
            f"{row['kind']}={row['name']} "
            f"baseline={','.join(row['baselineFiles'])} "
            f"addon={','.join(row['addonFiles'])}"
            for row in collisions
        )
        raise CompatibilityContractError(
            "Collision de compatibilité entre extensions auparavant séparées: " + detail
        )
    return report


def _canonical(value):
    if isinstance(value, dict):
        return tuple((key, _canonical(value[key])) for key in sorted(value))
    if isinstance(value, list):
        return tuple(_canonical(item) for item in value)
    return value


def assert_manifest_capability_parity(
    *,
    aio_manifest: dict,
    formative_manifest: dict,
    classroom_manifest: dict,
    adapted_classroom_scripts: list[dict],
) -> dict:
    """Prove that the AIO keeps standalone capabilities except documented popup/background substitutions."""
    required_permissions = set(formative_manifest.get("permissions") or []) | set(classroom_manifest.get("permissions") or [])
    actual_permissions = set(aio_manifest.get("permissions") or [])
    missing_permissions = sorted(required_permissions - actual_permissions)

    required_hosts = set(formative_manifest.get("host_permissions") or []) | set(classroom_manifest.get("host_permissions") or [])
    actual_hosts = set(aio_manifest.get("host_permissions") or [])
    missing_hosts = sorted(required_hosts - actual_hosts)

    aio_blocks = {_canonical(block) for block in (aio_manifest.get("content_scripts") or [])}
    formative_blocks = [_canonical(block) for block in (formative_manifest.get("content_scripts") or [])]
    formative_preserved = all(block in aio_blocks for block in formative_blocks)

    adapted_blocks = [_canonical(block) for block in (adapted_classroom_scripts or [])]
    classroom_adaptation_preserved = all(block in aio_blocks for block in adapted_blocks)

    aio_resources = {_canonical(block) for block in (aio_manifest.get("web_accessible_resources") or [])}
    formative_resources = [_canonical(block) for block in (formative_manifest.get("web_accessible_resources") or [])]
    resources_preserved = all(block in aio_resources for block in formative_resources)

    popup = str((aio_manifest.get("action") or {}).get("default_popup") or "")
    if popup == "popup-v2.html":
        raise CompatibilityContractError("Le popup standalone Formative ne doit pas remplacer le popup Gestion dans l'AIO.")
    if not popup:
        raise CompatibilityContractError("Le popup Gestion doit rester présent dans l'AIO.")

    problems = []
    if missing_permissions:
        problems.append("permissions manquantes: " + ", ".join(missing_permissions))
    if missing_hosts:
        problems.append("hôtes manquants: " + ", ".join(missing_hosts))
    if not formative_preserved:
        problems.append("blocs content_scripts Formative v2 non préservés")
    if not classroom_adaptation_preserved:
        problems.append("blocs Classroom adaptés non préservés")
    if not resources_preserved:
        problems.append("ressources web Formative v2 non préservées")
    if problems:
        raise CompatibilityContractError("Parité des extensions séparées rompue: " + "; ".join(problems))

    return {
        "missingPermissions": missing_permissions,
        "missingHosts": missing_hosts,
        "formativeContentScriptsPreserved": formative_preserved,
        "classroomAdaptationPreserved": classroom_adaptation_preserved,
        "formativeWebResourcesPreserved": resources_preserved,
        "aioPopup": popup,
    }

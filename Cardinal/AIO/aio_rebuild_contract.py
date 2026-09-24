#!/usr/bin/env python3
"""Fail-closed contract for rebuilding Cardinal AIO from the audited Gestion 1.1.9 baseline."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import zipfile
from pathlib import Path


BASELINE_SHA256 = "b8ef9a94cb9f55aca5957371ba239c67efdff943aa457b5aeed56afd005f69d7"
USER_VERIFIED_118_SHA256 = "1a8b2f592f7b112e68ce488a4b63c2175fc535c54eebb17d0fd195d53c0a9a0d"

BASELINE_PROFILES = {
    "gestion-1.1.9-exact": {
        "id": "gestion-1.1.9-exact",
        "sha256": BASELINE_SHA256,
        "version": "1.1.9",
        "chatgptVersion": "1.1.9",
        "source": "audited-exact",
    },
    "gestion-1.1.8-user-verified": {
        "id": "gestion-1.1.8-user-verified",
        "sha256": USER_VERIFIED_118_SHA256,
        "version": "1.1.8",
        "chatgptVersion": "1.1.8",
        "source": "user-provided-stable",
    },
}

# These historical engines must remain byte-for-byte identical to the audited
# Gestion 1.1.9 baseline. The active wrapper service-worker is intentionally
# excluded because the AIO replaces it with a tiny orchestrator and preserves
# the original bytes under legacy-service-worker.js.
IMMUTABLE_CORE_FILES = (
    "chatgpt.js",
    "formative-network.js",
    "formative.js",
    "formative-stealth.js",
    "gestion-bridge.js",
    "mozaik.js",
)

EXPERIMENTAL_ACTIVE_RE = re.compile(
    r"(?:^|/)(?:background-v09\d\.js|chatgpt-ui\.js|formative-simple-ui\.js|formative-stealth-v09\d\.js)$",
    re.I,
)


class BaselineContractError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def resolve_baseline_profile(path: Path, requested_profile: str | None = None) -> dict:
    path = Path(path)
    if not path.is_file():
        raise BaselineContractError(f"Baseline Gestion introuvable: {path}")
    if not zipfile.is_zipfile(path):
        raise BaselineContractError("Baseline Gestion refusée: le fichier n'est pas un ZIP valide.")

    actual = sha256_file(path).lower()
    if requested_profile:
        profile = BASELINE_PROFILES.get(requested_profile)
        if not profile:
            raise BaselineContractError(f"Profil de baseline inconnu: {requested_profile}")
        if actual != str(profile["sha256"]).lower():
            raise BaselineContractError(
                f"Baseline refusée pour le profil {requested_profile}: SHA-256 {actual}, "
                f"attendu {profile['sha256']}."
            )
        return dict(profile)

    for profile in BASELINE_PROFILES.values():
        if actual == str(profile["sha256"]).lower():
            return dict(profile)

    allowed = ", ".join(
        f"{name}={profile['sha256']}" for name, profile in BASELINE_PROFILES.items()
    )
    raise BaselineContractError(
        f"Aucun profil de baseline Gestion ne correspond au SHA-256 {actual}. "
        f"Profils autorisés: {allowed}."
    )


def validate_baseline_profile_manifest(profile: dict, manifest: dict, chatgpt_source: str) -> None:
    wanted_version = str(profile.get("version") or "")
    actual_version = str(manifest.get("version") or "")
    if actual_version != wanted_version:
        raise BaselineContractError(
            f"Version Gestion incompatible avec le profil {profile.get('id')}: "
            f"{actual_version!r}, attendu {wanted_version!r}."
        )

    wanted_chatgpt = str(profile.get("chatgptVersion") or "")
    marker = f"BRIDGE_VERSION = '{wanted_chatgpt}'"
    if marker not in str(chatgpt_source or ""):
        raise BaselineContractError(
            f"Pont ChatGPT incompatible avec le profil {profile.get('id')}: "
            f"marqueur ChatGPT {wanted_chatgpt} absent."
        )


def validate_baseline_zip(path: Path, expected_sha: str = BASELINE_SHA256) -> str:
    path = Path(path)
    if not path.is_file():
        raise BaselineContractError(f"Baseline Gestion 1.1.9 introuvable: {path}")
    actual = sha256_file(path)
    if actual.lower() != expected_sha.lower():
        raise BaselineContractError(
            "Baseline Gestion 1.1.9 refusée: SHA-256 "
            f"{actual}, attendu {expected_sha}. Aucun fallback expérimental n'est autorisé."
        )
    if not zipfile.is_zipfile(path):
        raise BaselineContractError("Baseline Gestion 1.1.9 refusée: le fichier n'est pas un ZIP valide.")
    return actual


def _manifest_js_refs(manifest: dict) -> list[str]:
    refs: list[str] = []
    bg = manifest.get("background") or {}
    sw = bg.get("service_worker")
    if isinstance(sw, str):
        refs.append(sw)
    for block in manifest.get("content_scripts") or []:
        refs.extend(x for x in (block.get("js") or []) if isinstance(x, str))
    return refs


def validate_baseline_manifest(manifest: dict, files: set[str]) -> None:
    if manifest.get("manifest_version") != 3:
        raise BaselineContractError("La baseline Gestion doit être Manifest V3.")

    # The audited 1.1.9 package had no key. Inheriting the standalone Formative
    # key changes extension identity/storage and is forbidden in the AIO.
    if manifest.get("key"):
        raise BaselineContractError(
            "La baseline Gestion 1.1.9 ne doit pas contenir manifest.key."
        )

    worker = (manifest.get("background") or {}).get("service_worker")
    if worker != "service-worker.js":
        raise BaselineContractError(
            "Le worker historique attendu est service-worker.js; "
            f"reçu {worker!r}. Les chaînes background-v09x sont interdites."
        )

    missing_core = [name for name in IMMUTABLE_CORE_FILES if name not in files]
    if missing_core:
        raise BaselineContractError(
            "Baseline Gestion 1.1.9 incomplète, fichier stable manquant: "
            + ", ".join(missing_core)
        )
    if "service-worker.js" not in files:
        raise BaselineContractError("Baseline Gestion 1.1.9 incomplète: service-worker.js manquant.")

    action = manifest.get("action") or {}
    popup = action.get("default_popup")
    if popup and popup not in files:
        raise BaselineContractError(f"Popup historique référencé mais absent: {popup}")

    experimental = [ref for ref in _manifest_js_refs(manifest) if EXPERIMENTAL_ACTIVE_RE.search(ref)]
    if experimental:
        raise BaselineContractError(
            "Baseline refusée: référence expérimentale active détectée: "
            + ", ".join(sorted(set(experimental)))
        )


def load_and_validate_extracted_baseline(root: Path) -> dict:
    root = Path(root)
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise BaselineContractError("manifest.json absent de la baseline Gestion 1.1.9.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise BaselineContractError(f"manifest.json invalide: {exc}") from exc
    files = {
        str(p.relative_to(root)).replace("\\", "/")
        for p in root.rglob("*")
        if p.is_file()
    }
    validate_baseline_manifest(manifest, files)
    return manifest


def snapshot_core_hashes(root: Path) -> dict[str, str]:
    root = Path(root)
    hashes: dict[str, str] = {}
    for name in IMMUTABLE_CORE_FILES:
        p = root / name
        if not p.is_file():
            raise BaselineContractError(f"Fichier historique manquant avant intégration: {name}")
        hashes[name] = sha256_file(p)
    return hashes


def verify_core_hashes(root: Path, expected: dict[str, str]) -> None:
    root = Path(root)
    drift = []
    for name, wanted in expected.items():
        p = root / name
        if not p.is_file():
            drift.append(f"{name} (absent)")
            continue
        actual = sha256_file(p)
        if actual != wanted:
            drift.append(name)
    if drift:
        raise BaselineContractError(
            "Dérive interdite des moteurs historiques: " + ", ".join(drift)
        )


def snapshot_tree_hashes(root: Path, *, exclude: set[str] | None = None) -> dict[str, str]:
    root = Path(root)
    excluded = set(exclude or set())
    hashes: dict[str, str] = {}
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = str(path.relative_to(root)).replace("\\", "/")
        if rel in excluded:
            continue
        hashes[rel] = sha256_file(path)
    return hashes


def verify_tree_hashes(root: Path, expected: dict[str, str], *, label: str = "arbre historique") -> None:
    root = Path(root)
    drift = []
    for rel, wanted in expected.items():
        path = root / rel
        if not path.is_file():
            drift.append(f"{rel} (absent)")
            continue
        actual = sha256_file(path)
        if actual != wanted:
            drift.append(rel)
    if drift:
        raise BaselineContractError(
            f"Dérive interdite de {label}: " + ", ".join(drift)
        )


def tree_hash_manifest_digest(expected: dict[str, str]) -> str:
    payload = "".join(f"{rel}\0{digest}\n" for rel, digest in sorted(expected.items()))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _ordered_union(left, right):
    out = []
    seen = set()
    for item in list(left or []) + list(right or []):
        marker = json.dumps(item, sort_keys=True, ensure_ascii=False) if isinstance(item, (dict, list)) else str(item)
        if marker in seen:
            continue
        seen.add(marker)
        out.append(copy.deepcopy(item))
    return out


def merge_manifest(
    baseline: dict,
    formative_v2: dict,
    *,
    classroom_scripts: list[dict],
    classroom_hosts: list[str],
) -> dict:
    """Merge additive AIO capabilities while preserving the stable baseline surface."""
    merged = copy.deepcopy(baseline)

    # Never inherit the standalone v2 extension identity.
    merged.pop("key", None)

    merged["name"] = "Cardinal"
    merged["permissions"] = _ordered_union(
        baseline.get("permissions", []),
        formative_v2.get("permissions", []),
    )
    merged["permissions"] = _ordered_union(
        merged["permissions"],
        ["alarms", "debugger", "storage", "tabs"],
    )
    merged["host_permissions"] = _ordered_union(
        baseline.get("host_permissions", []),
        formative_v2.get("host_permissions", []),
    )
    merged["host_permissions"] = _ordered_union(
        merged["host_permissions"],
        classroom_hosts,
    )

    # Historical scripts stay first. This is required for Formative network
    # wrapper chaining and preserves ChatGPT/Formative behavior from 1.1.9.
    merged["content_scripts"] = (
        copy.deepcopy(baseline.get("content_scripts", []))
        + copy.deepcopy(formative_v2.get("content_scripts", []))
        + copy.deepcopy(classroom_scripts or [])
    )

    if baseline.get("web_accessible_resources") or formative_v2.get("web_accessible_resources"):
        merged["web_accessible_resources"] = _ordered_union(
            baseline.get("web_accessible_resources", []),
            formative_v2.get("web_accessible_resources", []),
        )

    merged["background"] = copy.deepcopy(baseline.get("background") or {})
    merged["background"]["service_worker"] = "service-worker.js"

    # action, icons, CSP and every unknown historical manifest property remain
    # inherited from baseline because merged started as a deep copy.
    return merged

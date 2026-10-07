"""Apply the reviewed import patch to the exact installed Cardinal C14 ZIP."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import zipfile

BASE_SHA256 = "c3adb7071040d3f8915dbc5138107acc5d412b57564410e4c076649ef7db821e"
VERSION_NAME = "1.2.0-formative-1.1.14-recovery-idempotence-resequence-labels-mediafix-importfix-g118"
RUNTIME_FILES = (
    "validator-v2.js", "preflight-v2.js", "bootstrap-reconciliation-v2.js",
    "orchestrator-v2.js", "presentation-v2.js", "chatgpt-content-v2.js",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.baseline.resolve() == args.output.resolve():
        raise SystemExit("Output must differ from the baseline.")
    if hashlib.sha256(args.baseline.read_bytes()).hexdigest() != BASE_SHA256:
        raise SystemExit("The supplied ZIP is not the verified installed C14 baseline.")
    replacements = {name: (args.source_dir / name).read_bytes() for name in RUNTIME_FILES}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.baseline) as old:
        names = old.namelist()
        assert len(names) == 77 and len(set(names)) == 77
        assert all(name in names for name in RUNTIME_FILES)
        manifest = json.loads(old.read("manifest.json"))
        assert manifest["version"] == "1.2.0"
        manifest["version_name"] = VERSION_NAME
        replacements["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
        with zipfile.ZipFile(args.output, "w") as new:
            for info in old.infolist():
                new.writestr(copy.copy(info), replacements.get(info.filename, old.read(info.filename)))
    with zipfile.ZipFile(args.baseline) as old, zipfile.ZipFile(args.output) as new:
        assert new.testzip() is None and new.namelist() == names
        changed = [name for name in names if old.read(name) != new.read(name)]
        assert set(changed) == set(RUNTIME_FILES) | {"manifest.json"}
        refs = [manifest["background"]["service_worker"], manifest["action"]["default_popup"]]
        refs += list(manifest["icons"].values()) + list(manifest["action"]["default_icon"].values())
        for entry in manifest["content_scripts"]:
            refs += entry.get("js", []) + entry.get("css", [])
        for entry in manifest["web_accessible_resources"]:
            refs += entry["resources"]
        assert all(ref in names for ref in refs)
    print(json.dumps({
        "archive": str(args.output.resolve()), "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
        "bytes": args.output.stat().st_size, "files": len(names), "changed": changed,
        "unchanged": len(names) - len(changed), "version_name": VERSION_NAME,
        "zip_crc_ok": True, "manifest_references_ok": True,
    }))


if __name__ == "__main__":
    main()

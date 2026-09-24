#!/usr/bin/env python3
import json
import tempfile
import unittest
from pathlib import Path

from aio_compatibility_contract import (
    CompatibilityContractError,
    assert_isolated_world_compatibility,
    explicit_global_writes,
    dom_id_literals,
    storage_key_literals,
    assert_manifest_capability_parity,
    content_script_bundles,
)


class AioCompatibilityContractTests(unittest.TestCase):
    def make_fixture(self, root: Path, *, collision: str | None = None, separate_host: bool = False):
        legacy_host = "https://chatgpt.com/*"
        addon_host = "https://example.com/*" if separate_host else legacy_host

        legacy = root / "legacy"
        addon = root / "addon"
        legacy.mkdir()
        addon.mkdir()

        legacy_text = "(() => { globalThis.__legacyOnly = true; const LEGACY_KEY = 'legacy.storage'; const n=document.createElement('div'); n.id='legacy-id'; })();"
        addon_text = "(() => { globalThis.__addonOnly = true; const ADDON_KEY = 'addon.storage'; const n=document.createElement('div'); n.id='addon-id'; })();"

        if collision == "global":
            legacy_text += "\nglobalThis.__sharedCardinal = true;"
            addon_text += "\nglobalThis.__sharedCardinal = false;"
        elif collision == "dom":
            legacy_text += "\nconst a=document.createElement('div'); a.id='cardinal-shared-id';"
            addon_text += "\nconst b=document.createElement('div'); b.id='cardinal-shared-id';"
        elif collision == "storage":
            legacy_text += "\nconst LEGACY_SESSION_KEY = 'cardinal.shared.session';"
            addon_text += "\nconst ADDON_SESSION_KEY = 'cardinal.shared.session';"

        (legacy / "legacy.js").write_text(legacy_text, encoding="utf-8")
        (addon / "addon.js").write_text(addon_text, encoding="utf-8")
        (addon / "main.js").write_text("globalThis.__mainWorldShared = true;", encoding="utf-8")

        legacy_manifest = {
            "content_scripts": [{
                "matches": [legacy_host],
                "js": ["legacy.js"],
                "run_at": "document_idle",
            }]
        }
        addon_manifest = {
            "content_scripts": [
                {
                    "matches": [addon_host],
                    "js": ["addon.js"],
                    "run_at": "document_idle",
                },
                {
                    "matches": [legacy_host],
                    "js": ["main.js"],
                    "run_at": "document_start",
                    "world": "MAIN",
                },
            ]
        }
        return legacy, legacy_manifest, addon, addon_manifest

    def test_extractors_only_capture_explicit_surface_contracts(self):
        source = """
        globalThis.CardinalOne = {};
        window.__cardinalTwo = true;
        const FIRST_KEY = 'cardinal.storage.one';
        const OTHER = 'not-a-key';
        node.id = 'cardinal-node';
        document.getElementById('cardinal-existing');
        """
        self.assertEqual(explicit_global_writes(source), {"CardinalOne", "__cardinalTwo"})
        self.assertEqual(storage_key_literals(source), {"cardinal.storage.one"})
        self.assertEqual(dom_id_literals(source), {"cardinal-node", "cardinal-existing"})

    def test_distinct_isolated_world_namespaces_are_accepted(self):
        with tempfile.TemporaryDirectory() as td:
            fixture = self.make_fixture(Path(td))
            report = assert_isolated_world_compatibility(
                baseline_root=fixture[0],
                baseline_manifest=fixture[1],
                addon_root=fixture[2],
                addon_manifest=fixture[3],
            )
            self.assertEqual(report["collisions"], [])
            self.assertIn("chatgpt.com", report["overlappingHosts"])

    def test_explicit_global_collision_on_same_host_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            fixture = self.make_fixture(Path(td), collision="global")
            with self.assertRaisesRegex(CompatibilityContractError, "__sharedCardinal"):
                assert_isolated_world_compatibility(
                    baseline_root=fixture[0],
                    baseline_manifest=fixture[1],
                    addon_root=fixture[2],
                    addon_manifest=fixture[3],
                )

    def test_dom_id_collision_on_same_host_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            fixture = self.make_fixture(Path(td), collision="dom")
            with self.assertRaisesRegex(CompatibilityContractError, "cardinal-shared-id"):
                assert_isolated_world_compatibility(
                    baseline_root=fixture[0],
                    baseline_manifest=fixture[1],
                    addon_root=fixture[2],
                    addon_manifest=fixture[3],
                )

    def test_storage_key_collision_is_rejected_even_across_host_specific_scripts(self):
        with tempfile.TemporaryDirectory() as td:
            fixture = self.make_fixture(Path(td), collision="storage")
            with self.assertRaisesRegex(CompatibilityContractError, "cardinal.shared.session"):
                assert_isolated_world_compatibility(
                    baseline_root=fixture[0],
                    baseline_manifest=fixture[1],
                    addon_root=fixture[2],
                    addon_manifest=fixture[3],
                )

    def test_page_namespace_collision_is_not_reported_when_hosts_do_not_overlap(self):
        with tempfile.TemporaryDirectory() as td:
            fixture = self.make_fixture(Path(td), collision="global", separate_host=True)
            report = assert_isolated_world_compatibility(
                baseline_root=fixture[0],
                baseline_manifest=fixture[1],
                addon_root=fixture[2],
                addon_manifest=fixture[3],
            )
            self.assertFalse(any(row["kind"] == "global" for row in report["collisions"]))

    def test_content_script_bundles_group_overlapping_hosts_by_world(self):
        manifest = {
            "content_scripts": [
                {
                    "matches": ["https://*.example.com/*"],
                    "js": ["wild.js"],
                },
                {
                    "matches": ["https://app.example.com/*"],
                    "js": ["exact.js"],
                },
                {
                    "matches": ["https://app.example.com/*"],
                    "js": ["main.js"],
                    "world": "MAIN",
                },
            ]
        }
        bundles = content_script_bundles(manifest)
        isolated = bundles[("ISOLATED", "app.example.com")]
        self.assertEqual(isolated, ["wild.js", "exact.js"])
        self.assertEqual(bundles[("MAIN", "app.example.com")], ["main.js"])


    def test_worker_global_and_storage_collisions_are_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            legacy = root / "legacy"
            addon = root / "addon"
            legacy.mkdir()
            addon.mkdir()
            (legacy / "worker.js").write_text(
                "globalThis.__sharedWorker = true; const LEGACY_KEY = 'cardinal.shared.worker';",
                encoding="utf-8",
            )
            (addon / "background.js").write_text(
                "importScripts('dep.js');",
                encoding="utf-8",
            )
            (addon / "dep.js").write_text(
                "globalThis.__sharedWorker = false; const ADDON_KEY = 'cardinal.shared.worker';",
                encoding="utf-8",
            )
            baseline_manifest = {"background": {"service_worker": "worker.js"}}
            addon_manifest = {"background": {"service_worker": "background.js"}}
            with self.assertRaisesRegex(CompatibilityContractError, "__sharedWorker|cardinal.shared.worker"):
                assert_isolated_world_compatibility(
                    baseline_root=legacy,
                    baseline_manifest=baseline_manifest,
                    addon_root=addon,
                    addon_manifest=addon_manifest,
                )

    def test_manifest_capability_parity_accepts_additive_aio_and_rejects_missing_host(self):
        formative = {
            "permissions": ["tabs", "webRequest", "storage"],
            "host_permissions": ["https://app.formative.com/*", "https://chatgpt.com/*"],
            "content_scripts": [{
                "matches": ["https://chatgpt.com/*"],
                "js": ["chatgpt-v2.js"],
                "run_at": "document_idle",
            }],
            "web_accessible_resources": [{
                "resources": ["CARDINAL_FORMATIVE_PROTOCOL_V2.md"],
                "matches": ["https://chatgpt.com/*"],
            }],
            "action": {"default_popup": "popup-v2.html"},
        }
        classroom = {
            "permissions": ["alarms", "debugger", "storage", "tabs"],
            "host_permissions": ["https://classroom.google.com/*"],
            "content_scripts": [{
                "matches": ["https://classroom.google.com/*"],
                "js": ["classroom-autolink.js", "banner-autodismiss.js", "classroom.js"],
                "run_at": "document_idle",
            }],
        }
        adapted_classroom = [{
            "matches": ["https://classroom.google.com/*"],
            "js": ["classroom-autolink-aio.js", "classroom-aio.js"],
            "run_at": "document_idle",
        }]
        aio = {
            "permissions": ["tabs", "webRequest", "storage", "alarms", "debugger", "scripting", "windows"],
            "host_permissions": [
                "https://app.formative.com/*",
                "https://chatgpt.com/*",
                "https://classroom.google.com/*",
            ],
            "content_scripts": [
                {
                    "matches": ["https://chatgpt.com/*"],
                    "js": ["legacy-chatgpt.js"],
                    "run_at": "document_idle",
                },
                formative["content_scripts"][0],
                adapted_classroom[0],
            ],
            "web_accessible_resources": formative["web_accessible_resources"],
            "action": {"default_popup": "popup.html"},
        }
        report = assert_manifest_capability_parity(
            aio_manifest=aio,
            formative_manifest=formative,
            classroom_manifest=classroom,
            adapted_classroom_scripts=adapted_classroom,
        )
        self.assertEqual(report["missingPermissions"], [])
        self.assertEqual(report["missingHosts"], [])
        self.assertTrue(report["formativeContentScriptsPreserved"])
        self.assertTrue(report["classroomAdaptationPreserved"])

        broken = json.loads(json.dumps(aio))
        broken["host_permissions"].remove("https://classroom.google.com/*")
        with self.assertRaisesRegex(CompatibilityContractError, "classroom.google.com"):
            assert_manifest_capability_parity(
                aio_manifest=broken,
                formative_manifest=formative,
                classroom_manifest=classroom,
                adapted_classroom_scripts=adapted_classroom,
            )


    def test_main_world_addon_script_does_not_share_extension_isolated_world(self):
        with tempfile.TemporaryDirectory() as td:
            fixture = self.make_fixture(Path(td))
            (fixture[0] / "legacy.js").write_text(
                "globalThis.__mainWorldShared = false;",
                encoding="utf-8",
            )
            report = assert_isolated_world_compatibility(
                baseline_root=fixture[0],
                baseline_manifest=fixture[1],
                addon_root=fixture[2],
                addon_manifest=fixture[3],
            )
            self.assertEqual(report["collisions"], [])


if __name__ == "__main__":
    unittest.main()

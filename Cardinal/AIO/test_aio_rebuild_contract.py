#!/usr/bin/env python3
import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from aio_rebuild_contract import (
    BASELINE_SHA256,
    USER_VERIFIED_118_SHA256,
    BASELINE_PROFILES,
    BaselineContractError,
    IMMUTABLE_CORE_FILES,
    merge_manifest,
    snapshot_core_hashes,
    snapshot_tree_hashes,
    tree_hash_manifest_digest,
    validate_baseline_manifest,
    validate_baseline_zip,
    resolve_baseline_profile,
    validate_baseline_profile_manifest,
    verify_core_hashes,
    verify_tree_hashes,
)
from rebuild_aio_safe import augment_historical_popup, make_zip, patch_historical_graphql, patch_user_verified_118_changed_answer_force, patch_user_verified_118_chatgpt_batch_binding, patch_user_verified_118_chatgpt_current_ui, patch_user_verified_118_chatgpt_no_auto_reload, patch_user_verified_118_chatgpt_live_ping, patch_user_verified_118_worker_chatgpt_ping, validate_content_script_parse_compatibility, validate_output, validate_popup_script_compatibility
from audit_recovered_baseline import audit_baseline


class AioRebuildContractTests(unittest.TestCase):
    def make_zip(self, root: Path, manifest=None, extra=None):
        files = {
            "manifest.json": json.dumps(manifest or {
                "manifest_version": 3,
                "name": "Cardinal - Gestion des notes",
                "version": "1.1.9",
                "permissions": ["scripting", "tabs", "windows", "webRequest", "storage"],
                "host_permissions": ["https://app.formative.com/*"],
                "background": {"service_worker": "service-worker.js"},
                "content_scripts": [{
                    "matches": ["https://app.formative.com/*"],
                    "js": ["formative-network.js", "formative.js", "formative-stealth.js"],
                    "run_at": "document_start"
                }, {
                    "matches": ["https://chatgpt.com/*"],
                    "js": ["chatgpt.js"],
                    "run_at": "document_idle"
                }],
                "action": {"default_title": "Cardinal", "default_popup": "popup.html"},
                "icons": {"16": "icon16.png"}
            }, ensure_ascii=False),
            "service-worker.js": "'use strict';",
            "chatgpt.js": "'use strict';",
            "formative-network.js": "'use strict';",
            "formative.js": "'use strict';",
            "formative-stealth.js": "'use strict';",
            "gestion-bridge.js": "'use strict';",
            "mozaik.js": "'use strict';",
            "popup.html": "<!doctype html><title>Cardinal</title>",
            "icon16.png": "not-a-real-png"
        }
        files.update(extra or {})
        p = root / "baseline.zip"
        with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as z:
            for name, content in files.items():
                z.writestr(name, content)
        return p

    def test_exact_production_baseline_sha_is_pinned(self):
        self.assertEqual(
            BASELINE_SHA256,
            "b8ef9a94cb9f55aca5957371ba239c67efdff943aa457b5aeed56afd005f69d7",
        )

    def test_user_verified_118_profile_is_pinned_and_distinct(self):
        self.assertEqual(
            USER_VERIFIED_118_SHA256,
            "1a8b2f592f7b112e68ce488a4b63c2175fc535c54eebb17d0fd195d53c0a9a0d",
        )
        self.assertEqual(BASELINE_PROFILES["gestion-1.1.8-user-verified"]["version"], "1.1.8")
        self.assertEqual(BASELINE_PROFILES["gestion-1.1.8-user-verified"]["chatgptVersion"], "1.1.8")
        self.assertNotEqual(USER_VERIFIED_118_SHA256, BASELINE_SHA256)

    def test_profile_manifest_version_and_chatgpt_marker_are_fail_closed(self):
        profile = BASELINE_PROFILES["gestion-1.1.8-user-verified"]
        manifest = {"version": "1.1.8"}
        validate_baseline_profile_manifest(
            profile,
            manifest,
            "const BRIDGE_VERSION = '1.1.8';",
        )
        with self.assertRaisesRegex(BaselineContractError, "[Vv]ersion"):
            validate_baseline_profile_manifest(
                profile,
                {"version": "1.1.9"},
                "const BRIDGE_VERSION = '1.1.8';",
            )
        with self.assertRaisesRegex(BaselineContractError, "ChatGPT"):
            validate_baseline_profile_manifest(
                profile,
                manifest,
                "const BRIDGE_VERSION = '1.1.9';",
            )

    def test_unknown_zip_cannot_be_auto_promoted_to_supported_profile(self):
        with tempfile.TemporaryDirectory() as td:
            p = self.make_zip(Path(td))
            with self.assertRaisesRegex(BaselineContractError, "profil|SHA-256"):
                resolve_baseline_profile(p)

    def test_wrong_baseline_sha_is_rejected_before_build(self):
        with tempfile.TemporaryDirectory() as td:
            p = self.make_zip(Path(td))
            with self.assertRaisesRegex(BaselineContractError, "SHA-256"):
                validate_baseline_zip(p)

    def test_baseline_manifest_cannot_have_formative_v2_key(self):
        manifest = {
            "manifest_version": 3,
            "background": {"service_worker": "service-worker.js"},
            "key": "must-not-be-here",
        }
        with self.assertRaisesRegex(BaselineContractError, "manifest.key"):
            validate_baseline_manifest(manifest, set(IMMUTABLE_CORE_FILES) | {"manifest.json"})

    def test_experimental_worker_chain_is_rejected(self):
        manifest = {
            "manifest_version": 3,
            "background": {"service_worker": "background-v093.js"},
        }
        with self.assertRaisesRegex(BaselineContractError, "service-worker.js"):
            validate_baseline_manifest(manifest, set(IMMUTABLE_CORE_FILES) | {"manifest.json"})

    def test_missing_stable_core_file_is_rejected(self):
        manifest = {
            "manifest_version": 3,
            "background": {"service_worker": "service-worker.js"},
        }
        files = set(IMMUTABLE_CORE_FILES) | {"manifest.json"}
        files.remove("chatgpt.js")
        with self.assertRaisesRegex(BaselineContractError, "chatgpt.js"):
            validate_baseline_manifest(manifest, files)

    def test_merge_keeps_historical_content_scripts_first_and_drops_addon_key(self):
        base = {
            "manifest_version": 3,
            "name": "Cardinal - Gestion des notes",
            "version": "1.1.9",
            "permissions": ["scripting", "tabs"],
            "host_permissions": ["https://app.formative.com/*"],
            "background": {"service_worker": "service-worker.js"},
            "content_scripts": [{
                "matches": ["https://app.formative.com/*"],
                "js": ["formative-network.js", "formative.js", "formative-stealth.js"],
                "run_at": "document_start"
            }],
            "action": {"default_title": "Cardinal", "default_popup": "popup.html"},
            "icons": {"16": "icon16.png"},
        }
        addon = {
            "manifest_version": 3,
            "key": "standalone-formative-key",
            "permissions": ["storage"],
            "host_permissions": ["https://svc.goformative.com/*"],
            "content_scripts": [{
                "matches": ["https://app.formative.com/*"],
                "js": ["formative-session-main-v2.js"],
                "run_at": "document_start",
                "world": "MAIN"
            }],
            "web_accessible_resources": [{"resources": ["protocol.txt"], "matches": ["https://chatgpt.com/*"]}],
        }
        merged = merge_manifest(base, addon, classroom_scripts=[], classroom_hosts=[])
        self.assertNotIn("key", merged)
        self.assertEqual(merged["action"], base["action"])
        self.assertEqual(merged["icons"], base["icons"])
        self.assertEqual(merged["content_scripts"][0], base["content_scripts"][0])
        self.assertEqual(merged["content_scripts"][1], addon["content_scripts"][0])
        self.assertEqual(
            merged["background"]["service_worker"],
            "service-worker.js",
        )
        self.assertIn("storage", merged["permissions"])
        self.assertIn("https://svc.goformative.com/*", merged["host_permissions"])

    def test_core_hash_guard_detects_any_historical_drift(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for name in IMMUTABLE_CORE_FILES:
                (root / name).write_text(name, encoding="utf-8")
            baseline = snapshot_core_hashes(root)
            (root / "formative-network.js").write_text("changed", encoding="utf-8")
            with self.assertRaisesRegex(BaselineContractError, "formative-network.js"):
                verify_core_hashes(root, baseline)


    def test_changed_answer_force_patch_is_exact_and_keeps_other_guards(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            worker = root / "legacy-service-worker.js"
            worker.write_text(
                """    if (String(c.fingerprint || '') !== target.fingerprint && !allowChangedAnswers) {
      const studentName = String(c.studentName || '').trim();
      const questionNumber = String(c.questionNumber || '').trim();
      const who = studentName || `réponse ${answerId}`;
      const where = questionNumber ? ` (Q${questionNumber})` : '';
      errors.push({
        answerId,
        kind:'stale-answer',
        studentName,
        questionNumber,
        message:`Réponse modifiée depuis la préparation : ${who}${where}.`
      });
      continue;
    }
    if (Math.abs(Number(c.possiblePoints) - Number(target.possiblePoints)) > 1e-9) {
      errors.push({answerId,kind:'stale',message:'Le maximum de la question a changé depuis la préparation.'});
      continue;
    }
      const original = c.originalPoints === null || c.originalPoints === undefined ? null : Number(c.originalPoints);
      const current = target.currentPoints;
      const sameAsOriginal = (original === null && current === null) || (original !== null && current !== null && Math.abs(original-current) < 1e-9);
      const sameAsDesired = current !== null && Math.abs(current-desired) < 1e-9;
      if (!sameAsOriginal && !sameAsDesired) {
        errors.push({answerId,kind:'conflict',message:'La note Formative a été modifiée depuis la préparation. Elle ne sera pas écrasée.'});
        continue;
      }
      noteState = sameAsDesired ? 'already' : 'write';
""",
                encoding="utf-8",
            )
            patch_user_verified_118_changed_answer_force(worker)
            text = worker.read_text(encoding="utf-8")
            self.assertIn("const answerChanged =", text)
            self.assertIn("const changedAnswerOverride = allowChangedAnswers && answerChanged;", text)
            self.assertIn("Le maximum de la question a changé depuis la préparation.", text)
            self.assertIn("La note Formative a été modifiée depuis la préparation.", text)

            bad = root / "bad.js"
            bad.write_text("'use strict';", encoding="utf-8")
            with self.assertRaisesRegex(BaselineContractError, "changed-answer|Adaptation"):
                patch_user_verified_118_changed_answer_force(bad)

    def test_chatgpt_batch_binding_patch_prefers_exact_batch_over_stale_question(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            chatgpt = root / "chatgpt.js"
            chatgpt.write_text(
                r'''  function extractBatchId(text){
    const m=String(text||'').match(/CARDINAL_BATCH_ID\s*:\s*([A-Za-z0-9-]{8,})/i);
    return m?m[1]:'';
  }

  function localBindingFor(node){
    const message=assistantContainerFor(node);
    let batchId=extractBatchId(message?.innerText||message?.textContent||'');
    let batchConfidence=batchId?'message':'';
    let questionNumber=extractQuestionNumber(message?.innerText||message?.textContent||'');
    const turns=conversationTurns();
    const idx=message?turns.findIndex(t=>t===message || t.contains(message) || message.contains?.(t)):-1;
    if(idx>=0 && (!batchId || !questionNumber)){
      let seen=0;
      let crossedAssistant=false;
      for(let i=idx-1;i>=0 && seen<10;i--,seen++){
        const role=turnRole(turns[i]);
        const text=String(turns[i].innerText||turns[i].textContent||'');
        if(!batchId){
          const b=extractBatchId(text);
          if(b){
            batchId=b;
            batchConfidence=!crossedAssistant && role==='user'?'prompt':'history';
          }
        }
        if(!questionNumber){
          const q=extractQuestionNumber(text);
          if(q) questionNumber=q;
        }
        if(batchId && questionNumber) break;
        if(role==='assistant') crossedAssistant=true;
      }
    }
    return {message,batchId,batchConfidence,questionNumber,isInline:true};
  }

    let batchBindingRecovered=false;
    let batchBindingPartial=false;
    const commentsOnlyRows=rowsAreCommentsOnly(rows);
    if(/^CARDINAL_BATCH_V11(?:0|3)$/.test(String(ctx?.version||''))){
      const conversationBatch=String(binding ? (binding.batchId||'') : (inferConversationBatchId()||''));
      const expectedBatch=String(ctx?.batchId||ctx?.sessionId||'');
      if(!conversationBatch || conversationBatch!==expectedBatch){
      }
    }
      if(conversationQ && targetQ && String(Number(conversationQ))!==String(Number(targetQ))){
        throw new Error(`Sécurité Cardinal : le tableau actuel parle de Q${conversationQ}, mais la question encore en mémoire est Q${targetQ}. Reprépare Q${conversationQ} dans Formative avant de publier.`);
      }
''',
                encoding="utf-8",
            )
            patch_user_verified_118_chatgpt_batch_binding(chatgpt)
            text = chatgpt.read_text(encoding="utf-8")
            self.assertIn("function questionNumberForBatch(batchId)", text)
            self.assertIn("for(const preferredRole of ['user','assistant'])", text)
            self.assertIn("questionNumber=questionNumberForBatch(b)||questionNumber;", text)
            self.assertIn("exactBatchBinding=!!conversationBatch && conversationBatch===expectedBatch;", text)
            self.assertIn("if(!exactBatchBinding && conversationQ && targetQ", text)

            broken = root / "broken.js"
            broken.write_text("'use strict';", encoding="utf-8")
            with self.assertRaisesRegex(BaselineContractError, "ChatGPT|Adaptation"):
                patch_user_verified_118_chatgpt_batch_binding(broken)

    def test_chatgpt_auto_reload_and_replay_are_removed_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            chatgpt = root / "chatgpt.js"
            chatgpt.write_text(
                """  function queueReloadRecovery(rows,source,error,binding=null){
    let previousAttempts=0;
    try {
      const prev=JSON.parse(sessionStorage.getItem(RELOAD_QUEUE_KEY)||'null');
      if(prev && Date.now()-Number(prev.createdAt||0)<120000) previousAttempts=Number(prev.attempts||0);
    } catch {}
    if(previousAttempts>=1) throw error;
    try {
      sessionStorage.setItem(RELOAD_QUEUE_KEY,JSON.stringify({rows,source,binding:binding?{batchId:String(binding.batchId||''),batchConfidence:String(binding.batchConfidence||''),questionNumber:String(binding.questionNumber||''),isInline:!!binding.isInline}:null,createdAt:Date.now(),attempts:previousAttempts+1}));
    } catch {}
    $('panel').classList.remove('hidden');
    $('paste').classList.add('hidden');
    $('parsePaste').classList.add('hidden');
    $('msg').className='small';
    $('msg').textContent='Cardinal vient d’être rechargé. Je recharge ChatGPT une fois et je reprends automatiquement cet envoi…';
    setTimeout(()=>location.reload(),450);
  }

  async function resumeReloadQueue(){
    let pending=null;
    try { pending=JSON.parse(sessionStorage.getItem(RELOAD_QUEUE_KEY)||'null'); } catch {}
    if(!pending?.rows?.length) return;
    if(Date.now()-Number(pending.createdAt||0)>120000){
      try{sessionStorage.removeItem(RELOAD_QUEUE_KEY);}catch{}
      return;
    }
    try{sessionStorage.removeItem(RELOAD_QUEUE_KEY);}catch{}
    $('panel').classList.remove('hidden');
    $('paste').classList.add('hidden');
    $('parsePaste').classList.add('hidden');
    $('msg').className='small';
    $('msg').textContent='Cardinal reconnecté. Je reprends l’envoi vers Formative…';
    try { await sendRows(pending.rows,`${pending.source||'ChatGPT'} · reprise après mise à jour`,pending.binding||null); }
    catch(e){
      $('msg').textContent=e?.message||String(e);$('msg').className='small err';$('paste').classList.remove('hidden');$('parsePaste').classList.remove('hidden');
    }
  }
""",
                encoding="utf-8",
            )
            patch_user_verified_118_chatgpt_no_auto_reload(chatgpt)
            text = chatgpt.read_text(encoding="utf-8")
            self.assertNotIn("location.reload()", text)
            self.assertNotIn("Je reprends l’envoi vers Formative", text)
            self.assertIn("Recharge ChatGPT manuellement une seule fois", text)
            self.assertIn("sessionStorage.removeItem(RELOAD_QUEUE_KEY)", text)

            bad = root / "bad.js"
            bad.write_text("'use strict';", encoding="utf-8")
            with self.assertRaisesRegex(BaselineContractError, "disable ChatGPT auto reload|Adaptation"):
                patch_user_verified_118_chatgpt_no_auto_reload(bad)

    def test_chatgpt_bridge_ping_prevents_redundant_focus_reinjection(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            chatgpt = root / "chatgpt.js"
            chatgpt.write_text(
                """  try {
    chrome.runtime.onMessage.addListener(message=>{
      if(message?.type==='CARDINAL_SIMPLE_CONTEXT_CLEARED'){
        cachedContext=null;
        $('panel').classList.add('hidden');
        refreshButton();
      }
    });
  } catch {}
""",
                encoding="utf-8",
            )
            patch_user_verified_118_chatgpt_live_ping(chatgpt)
            text = chatgpt.read_text(encoding="utf-8")
            self.assertIn("CARDINAL_CHATGPT_BRIDGE_PING", text)
            self.assertIn("bridgeVersion:BRIDGE_VERSION", text)

            worker = root / "legacy-service-worker.js"
            worker.write_text(
                """async function cardinalReinjectChatGptBridge1000(tabId) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = String(tab?.url || '');
    if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(url)) return;
    await chrome.scripting.executeScript({ target:{ tabId }, files:['chatgpt.js'] });
  } catch {}
}
""",
                encoding="utf-8",
            )
            patch_user_verified_118_worker_chatgpt_ping(worker)
            worker_text = worker.read_text(encoding="utf-8")
            self.assertIn("CARDINAL_CHATGPT_BRIDGE_PING", worker_text)
            self.assertIn("if (live?.ok && live?.bridgeVersion === '1.1.8') return;", worker_text)

    def test_chatgpt_current_ui_patch_adds_explicit_role_markers(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            chatgpt = root / "chatgpt.js"
            chatgpt.write_text(
                """  function turnRole(turn){
    if(turn.matches?.('[data-testid="user-message"]') || turn.querySelector?.('[data-testid="user-message"]')) return 'user';
    if(turn.matches?.('[data-testid="assistant-message"]') || turn.querySelector?.('[data-testid="assistant-message"]')) return 'assistant';

    const testid=String(turn.getAttribute?.('data-testid')||'').toLowerCase();
  }

  function conversationTurns(){
    const selectors=['[data-testid^="conversation-turn-"]'];
    for(const selector of selectors){
      const all=[...document.querySelectorAll(selector)];
      if(!all.length) continue;
      const outer=all.filter(node=>!all.some(other=>other!==node && other.contains(node)));
      return outer.length ? outer : all;
    }
    return [];
  }
""",
                encoding="utf-8",
            )
            patch_user_verified_118_chatgpt_current_ui(chatgpt)
            text = chatgpt.read_text(encoding="utf-8")
            self.assertIn("data-chatgpt-search-unit-key", text)
            self.assertIn("data-content-search-unit-key", text)
            self.assertIn("data-user-message-bubble", text)

            bad = root / "bad.js"
            bad.write_text("'use strict';", encoding="utf-8")
            with self.assertRaisesRegex(BaselineContractError, "current ChatGPT|Adaptation"):
                patch_user_verified_118_chatgpt_current_ui(bad)

    def test_historical_graphql_patch_is_exact_and_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            worker = root / "legacy-service-worker.js"
            worker.write_text(
                "if(details.url.startsWith('https://svc.goformative.com/graphql/')){return true}",
                encoding="utf-8",
            )
            patch_historical_graphql(worker)
            text = worker.read_text(encoding="utf-8")
            self.assertIn("graphql(?:[/?]|$)", text)
            self.assertNotIn("startsWith('https://svc.goformative.com/graphql/')", text)

            bad = root / "bad.js"
            bad.write_text("'use strict';", encoding="utf-8")
            with self.assertRaisesRegex(BaselineContractError, "0 motif"):
                patch_historical_graphql(bad)

    def test_popup_script_compatibility_rejects_scope_and_global_collisions(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "legacy-popup.js").write_text(
                "const POPUP_SCOPE = 1; globalThis.CardinalAioPopup = { legacy: true };",
                encoding="utf-8",
            )
            (root / "aio-popup.js").write_text(
                "const POPUP_SCOPE = 2; globalThis.CardinalAioPopup = { aio: true };",
                encoding="utf-8",
            )
            (root / "popup.html").write_text(
                '<!doctype html><html><body><script src="legacy-popup.js"></script><script src="aio-popup.js"></script></body></html>',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(BaselineContractError, "popup|CardinalAioPopup|scope"):
                validate_popup_script_compatibility(root, "popup.html")

            (root / "legacy-popup.js").write_text(
                "(() => { const POPUP_SCOPE = 1; globalThis.LegacyPopupOnly = true; })();",
                encoding="utf-8",
            )
            (root / "aio-popup.js").write_text(
                "(() => { const POPUP_SCOPE = 2; globalThis.CardinalAioPopup = {}; })();",
                encoding="utf-8",
            )
            report = validate_popup_script_compatibility(root, "popup.html")
            self.assertEqual(report["scriptCount"], 2)


    def test_combined_content_script_parse_gate_catches_top_level_redeclaration(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "legacy.js").write_text("const CARDINAL_SHARED_SCOPE = 1;", encoding="utf-8")
            (root / "addon.js").write_text("const CARDINAL_SHARED_SCOPE = 2;", encoding="utf-8")
            manifest = {
                "content_scripts": [
                    {"matches": ["https://chatgpt.com/*"], "js": ["legacy.js"]},
                    {"matches": ["https://chatgpt.com/*"], "js": ["addon.js"]},
                ]
            }
            with self.assertRaisesRegex(BaselineContractError, "chatgpt.com|scope|compat"):
                validate_content_script_parse_compatibility(root, manifest)

            (root / "legacy.js").write_text(
                "(() => { const CARDINAL_SHARED_SCOPE = 1; })();",
                encoding="utf-8",
            )
            (root / "addon.js").write_text(
                "(() => { const CARDINAL_SHARED_SCOPE = 2; })();",
                encoding="utf-8",
            )
            report = validate_content_script_parse_compatibility(root, manifest)
            self.assertGreaterEqual(report["bundleCount"], 1)


    def test_validate_output_executes_full_script_set_checks(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for name in IMMUTABLE_CORE_FILES:
                (root / name).write_text("'use strict';", encoding="utf-8")
            historical = snapshot_core_hashes(root)

            (root / "legacy-service-worker.js").write_text("'use strict';", encoding="utf-8")
            (root / "classroom-background-aio.js").write_text("'use strict';", encoding="utf-8")
            (root / "background-v2.js").write_text("'use strict';", encoding="utf-8")
            (root / "service-worker.js").write_text(
                "importScripts('legacy-service-worker.js');\n"
                "importScripts('classroom-background-aio.js');\n"
                "importScripts('background-v2.js');\n",
                encoding="utf-8",
            )
            (root / "formative-session-main-v2.js").write_text("'use strict';", encoding="utf-8")
            (root / "popup.html").write_text(
                "<!doctype html><html><body><button>Préparer une correction</button></body></html>",
                encoding="utf-8",
            )

            manifest = {
                "manifest_version": 3,
                "name": "Cardinal",
                "version": "1.2.0",
                "permissions": ["scripting", "tabs", "windows", "webRequest", "storage", "alarms", "debugger"],
                "host_permissions": ["https://app.formative.com/*"],
                "background": {"service_worker": "service-worker.js"},
                "content_scripts": [
                    {
                        "matches": ["https://app.formative.com/*"],
                        "js": ["formative-network.js", "formative.js", "formative-stealth.js"],
                    },
                    {
                        "matches": ["https://app.formative.com/*"],
                        "js": ["formative-session-main-v2.js"],
                        "world": "MAIN",
                    },
                ],
                "action": {"default_popup": "popup.html"},
            }
            repo_root = Path(__file__).resolve().parents[2]
            popup_name, original_sha, adapted_sha = augment_historical_popup(repo_root, root, manifest)
            self.assertEqual(popup_name, "popup.html")
            self.assertNotEqual(original_sha, adapted_sha)
            popup_text = (root / "popup.html").read_text(encoding="utf-8")
            self.assertIn("Préparer une correction", popup_text)
            self.assertEqual(popup_text.count("cardinal-aio-dashboard"), 1)
            self.assertEqual(popup_text.count('src="aio-popup.js"'), 1)
            validate_output(root, manifest, historical)




    def test_popup_augmentation_is_additive_and_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            popup = root / "popup.html"
            popup.write_text(
                "<!doctype html><html><body><button>Préparer une correction</button></body></html>",
                encoding="utf-8",
            )
            manifest = {"action": {"default_popup": "popup.html"}}
            repo_root = Path(__file__).resolve().parents[2]

            popup_name, original_sha, adapted_sha = augment_historical_popup(repo_root, root, manifest)
            text = popup.read_text(encoding="utf-8")
            self.assertEqual(popup_name, "popup.html")
            self.assertNotEqual(original_sha, adapted_sha)
            self.assertIn("<button>Préparer une correction</button>", text)
            self.assertEqual(text.count("cardinal-aio-dashboard"), 1)
            self.assertEqual(text.count('src="aio-popup.js"'), 1)
            self.assertTrue((root / "aio-popup.js").is_file())

            with self.assertRaisesRegex(BaselineContractError, "déjà adapté"):
                augment_historical_popup(repo_root, root, manifest)


    def test_popup_augmentation_resolves_dashboard_script_from_nested_popup(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            nested = root / "ui"
            nested.mkdir()
            popup = nested / "popup.html"
            popup.write_text("<!doctype html><html><body><button>Préparer une correction</button></body></html>", encoding="utf-8")
            manifest = {"action": {"default_popup": "ui/popup.html"}}
            repo_root = Path(__file__).resolve().parents[2]

            augment_historical_popup(repo_root, root, manifest)
            text = popup.read_text(encoding="utf-8")
            self.assertIn('src="../aio-popup.js"', text)
            self.assertTrue((root / "aio-popup.js").is_file())


    def test_recovered_baseline_forensic_audit_accepts_stable_fixture_and_rejects_drift(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            manifest = {
                "manifest_version": 3,
                "name": "Cardinal - Gestion des notes",
                "version": "1.1.9",
                "permissions": ["scripting", "tabs", "windows", "webRequest", "storage"],
                "host_permissions": [
                    "https://app.formative.com/*",
                    "https://svc.goformative.com/*",
                ],
                "background": {"service_worker": "service-worker.js"},
                "content_scripts": [
                    {
                        "matches": ["https://app.formative.com/*"],
                        "js": ["formative-network.js", "formative.js", "formative-stealth.js"],
                    },
                    {
                        "matches": ["https://chatgpt.com/*"],
                        "js": ["chatgpt.js"],
                    },
                ],
                "action": {"default_popup": "popup.html"},
            }
            (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            (root / "service-worker.js").write_text(
                "'use strict';\n"
                "function probe(details){"
                "return details.url.startsWith('https://svc.goformative.com/graphql/');"
                "}\n",
                encoding="utf-8",
            )
            (root / "chatgpt.js").write_text(
                "'use strict';\nconst CARDINAL_CHATGPT_VERSION='1.1.9';\n",
                encoding="utf-8",
            )
            (root / "formative-network.js").write_text("'use strict';\n", encoding="utf-8")
            (root / "formative.js").write_text(
                "'use strict';\nconst CARDINAL_STABLE_FORMATIVE_ACTION=true;\n",
                encoding="utf-8",
            )
            (root / "formative-stealth.js").write_text("'use strict';\n", encoding="utf-8")
            (root / "gestion-bridge.js").write_text("'use strict';\n", encoding="utf-8")
            (root / "mozaik.js").write_text(
                "'use strict';\nwindow.__cardinalMozaikUiV116=true;\n",
                encoding="utf-8",
            )
            (root / "popup.html").write_text(
                "<!doctype html><html><body><button>Préparer une correction</button></body></html>",
                encoding="utf-8",
            )

            report = audit_baseline(root)
            self.assertTrue(report["pass"], report["errors"])
            self.assertTrue(report["markerStatus"]["stableFormativeAction"])
            self.assertTrue(report["markerStatus"]["mozaikUi116"])
            self.assertTrue(report["markerStatus"]["chatgpt119"])

            (root / "popup.html").write_text(
                "<!doctype html><button>Préparer une correction</button>",
                encoding="utf-8",
            )
            unadaptable = audit_baseline(root)
            self.assertFalse(unadaptable["pass"])
            self.assertTrue(any("popup" in error.lower() and "</body>" in error for error in unadaptable["errors"]))

            (root / "popup.html").write_text(
                "<!doctype html><html><body><button>Préparer une correction</button></body></html>",
                encoding="utf-8",
            )

            (root / "chatgpt.js").write_text("'use strict';\n", encoding="utf-8")
            drift = audit_baseline(root)
            self.assertFalse(drift["pass"])
            self.assertTrue(any("chatgpt.js" in error or "chatgpt119" in error for error in drift["errors"]))

    def test_full_baseline_tree_guard_detects_popup_or_asset_drift(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "popup.html").write_text("<title>stable</title>", encoding="utf-8")
            (root / "popup.js").write_text("'use strict';", encoding="utf-8")
            (root / "icon16.png").write_bytes(b"png")
            expected = snapshot_tree_hashes(root)
            digest_before = tree_hash_manifest_digest(expected)
            self.assertEqual(len(digest_before), 64)

            (root / "popup.js").write_text("changed", encoding="utf-8")
            with self.assertRaisesRegex(BaselineContractError, "popup.js"):
                verify_tree_hashes(root, expected, label="baseline fixture")


    def test_make_zip_is_byte_reproducible(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            dist = root / "dist"
            dist.mkdir()
            (dist / "a.txt").write_text("alpha", encoding="utf-8")
            (dist / "b.bin").write_bytes(b"\x00\x01\x02")
            first = root / "first.zip"
            second = root / "second.zip"
            make_zip(dist, first)

            # Rewrite the exact same bytes so filesystem mtimes differ from the first build.
            (dist / "a.txt").write_text("alpha", encoding="utf-8")
            (dist / "b.bin").write_bytes(b"\x00\x01\x02")
            make_zip(dist, second)

            self.assertEqual(first.read_bytes(), second.read_bytes())


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Rebuild Cardinal AIO only from the exact audited Gestion 1.1.9 package.

This builder intentionally has no beta fallback. If the exact 1.1.9 ZIP is not
available, it fails without producing an installable archive.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from aio_compatibility_contract import (
    CompatibilityContractError,
    assert_isolated_world_compatibility,
    assert_manifest_capability_parity,
    content_script_bundles,
    dom_id_literals,
    explicit_global_writes,
    storage_key_literals,
)

from aio_rebuild_contract import (
    BASELINE_SHA256,
    BASELINE_PROFILES,
    BaselineContractError,
    load_and_validate_extracted_baseline,
    merge_manifest,
    snapshot_core_hashes,
    snapshot_tree_hashes,
    tree_hash_manifest_digest,
    validate_baseline_zip,
    resolve_baseline_profile,
    validate_baseline_profile_manifest,
    verify_core_hashes,
    verify_tree_hashes,
)

AIO_VERSION = "1.2.0"
AIO_VERSION_NAME = "1.2.0-rc14-formative-pedago3"
CLASSROOM_COMMIT = "6887bfa2e8afd523a38a0e3286aa1f826276b8c5"
FORMATIVE_TREE_SHA = "9b1cb1c1d8c1568ea6f93750229bc26e821d66a2"
FORMATIVE_V2_ZIP = "Cardinal-Formative-Importer-STANDALONE-0.5.0-rc1.zip"
AIO_POPUP_JS = "aio-popup.js"

CLASSROOM_HOSTS = [
    "https://techno-cardi.github.io/Plan-de-cours/*",
    "https://techno-cardi.github.io/Portail-Cardinal-Roy/agendakevin",
    "https://techno-cardi.github.io/Portail-Cardinal-Roy/agendakevin/*",
    "https://classroom.google.com/*",
]

MESSAGE_NAMES = {
    "rememberGroups": "PDC_NATIVE_REMEMBER_GROUPS",
    "getGroups": "PDC_NATIVE_GET_GROUPS",
    "prepare": "PDC_NATIVE_PREPARE",
    "claim": "PDC_NATIVE_CLAIM",
    "paste": "PDC_NATIVE_PASTE",
    "publish": "PDC_NATIVE_PUBLISH",
    "activate": "PDC_NATIVE_ACTIVATE",
    "complete": "PDC_NATIVE_COMPLETE",
    "fail": "PDC_NATIVE_FAIL",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def run(cmd: list[str], cwd: Path | None = None) -> None:
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def git_rev_parse(path: Path, spec: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "rev-parse", spec],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BaselineContractError(
            f"Provenance Git impossible à vérifier pour {path}: {exc}"
        ) from exc
    return result.stdout.strip()


def git_require_clean(path: Path, pathspec: str) -> None:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "status", "--porcelain", "--untracked-files=all", "--", pathspec],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BaselineContractError(
            f"État Git impossible à vérifier pour {path}: {exc}"
        ) from exc
    if result.stdout.strip():
        raise BaselineContractError(
            f"Sources locales modifiées ou non suivies dans {pathspec}:\n{result.stdout.strip()}"
        )


def verify_source_provenance(repo_root: Path, classroom_root: Path) -> None:
    git_require_clean(repo_root, "Formative")
    git_require_clean(classroom_root, ".")

    formative_tree = git_rev_parse(repo_root, "HEAD:Formative")
    if formative_tree != FORMATIVE_TREE_SHA:
        raise BaselineContractError(
            "Sources Formative hors baseline auditée: arbre "
            f"{formative_tree}, attendu {FORMATIVE_TREE_SHA}."
        )

    classroom_head = git_rev_parse(classroom_root, "HEAD")
    if classroom_head != CLASSROOM_COMMIT:
        raise BaselineContractError(
            "Source Classroom hors commit épinglé: "
            f"{classroom_head}, attendu {CLASSROOM_COMMIT}."
        )


def verify_extension_compatibility(
    *,
    baseline_root: Path,
    baseline_manifest: dict,
    formative_root: Path,
    formative_manifest: dict,
    classroom_root: Path,
) -> tuple[dict, dict]:
    classroom_manifest_path = classroom_root / "manifest.json"
    if not classroom_manifest_path.is_file():
        raise BaselineContractError(f"Manifest Classroom absent: {classroom_manifest_path}")
    classroom_manifest = json.loads(classroom_manifest_path.read_text(encoding="utf-8"))

    reports = {}
    try:
        reports["legacyVsFormative"] = assert_isolated_world_compatibility(
            baseline_root=baseline_root,
            baseline_manifest=baseline_manifest,
            addon_root=formative_root,
            addon_manifest=formative_manifest,
        )
        reports["legacyVsClassroom"] = assert_isolated_world_compatibility(
            baseline_root=baseline_root,
            baseline_manifest=baseline_manifest,
            addon_root=classroom_root,
            addon_manifest=classroom_manifest,
        )
        reports["formativeVsClassroom"] = assert_isolated_world_compatibility(
            baseline_root=formative_root,
            baseline_manifest=formative_manifest,
            addon_root=classroom_root,
            addon_manifest=classroom_manifest,
        )
    except CompatibilityContractError as exc:
        raise BaselineContractError(str(exc)) from exc
    return classroom_manifest, reports


def extract_zip_flat(zip_path: Path, dest: Path) -> Path:
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dest)
    if (dest / "manifest.json").is_file():
        return dest
    dirs = [p for p in dest.iterdir() if p.is_dir()]
    files = [p for p in dest.iterdir() if p.is_file()]
    if not files and len(dirs) == 1 and (dirs[0] / "manifest.json").is_file():
        return dirs[0]
    raise BaselineContractError("Le ZIP 1.1.9 ne contient pas manifest.json à une racine reconnue.")


def copy_tree_contents(source: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        target = dest / item.name
        if item.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)


def patch_historical_graphql(worker: Path) -> None:
    text = worker.read_text(encoding="utf-8")
    replacement = r"/^https:\/\/svc\.goformative\.com\/graphql(?:[/?]|$)/.test(details.url)"
    candidates = [
        "details.url.startsWith('https://svc.goformative.com/graphql/')",
        'details.url.startsWith("https://svc.goformative.com/graphql/")',
    ]
    count = 0
    for old in candidates:
        hits = text.count(old)
        if hits:
            text = text.replace(old, replacement)
            count += hits
    if count != 1:
        raise BaselineContractError(
            "Correctif historique /graphql non appliqué: "
            f"{count} motif(s) attendu(s) trouvé(s) dans service-worker.js."
        )
    if "graphql(?:[/?]|$)" not in text:
        raise BaselineContractError("Le garde /graphql corrigé n'est pas présent après patch.")
    worker.write_text(text, encoding="utf-8")


def patch_user_verified_118_changed_answer_force(worker: Path) -> None:
    """Make the explicit "Publier quand même" override internally consistent.

    The first pass still blocks a changed student answer. Only the second pass,
    carrying allowChangedAnswers=True after the teacher confirms, may continue.
    Other stale guards (question, max points, rubric, class) remain unchanged.
    """
    text = worker.read_text(encoding="utf-8")

    old_fingerprint = """    if (String(c.fingerprint || '') !== target.fingerprint && !allowChangedAnswers) {
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
"""
    new_fingerprint = """    const answerChanged = String(c.fingerprint || '') !== target.fingerprint;
    if (answerChanged && !allowChangedAnswers) {
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
"""
    text = replace_exactly(
        text,
        old_fingerprint,
        new_fingerprint,
        label="Gestion 1.1.8 changed-answer explicit override marker",
    )

    old_grade_conflict = """      if (!sameAsOriginal && !sameAsDesired) {
        errors.push({answerId,kind:'conflict',message:'La note Formative a été modifiée depuis la préparation. Elle ne sera pas écrasée.'});
        continue;
      }
      noteState = sameAsDesired ? 'already' : 'write';
"""
    new_grade_conflict = """      const changedAnswerOverride = allowChangedAnswers && answerChanged;
      if (!sameAsOriginal && !sameAsDesired && !changedAnswerOverride) {
        errors.push({answerId,kind:'conflict',message:'La note Formative a été modifiée depuis la préparation. Elle ne sera pas écrasée.'});
        continue;
      }
      noteState = sameAsDesired ? 'already' : 'write';
"""
    text = replace_exactly(
        text,
        old_grade_conflict,
        new_grade_conflict,
        label="Gestion 1.1.8 changed-answer grade drift override",
    )

    if "const answerChanged =" not in text or "allowChangedAnswers && answerChanged" not in text:
        raise BaselineContractError("Correctif Publier quand même 1.1.8 incomplet après adaptation.")
    worker.write_text(text, encoding="utf-8")


def patch_user_verified_118_chatgpt_batch_binding(chatgpt: Path) -> None:
    """Prefer the exact CARDINAL_BATCH_ID over stale question text in a reused chat."""
    text = chatgpt.read_text(encoding="utf-8")

    extract_anchor = """  function extractBatchId(text){
    const m=String(text||'').match(/CARDINAL_BATCH_ID\\s*:\\s*([A-Za-z0-9-]{8,})/i);
    return m?m[1]:'';
  }

"""
    helper = """  function questionNumberForBatch(batchId){
    const wanted=String(batchId||'').trim();
    if(!wanted) return '';
    const turns=conversationTurns();
    for(const preferredRole of ['user','assistant']){
      for(let i=turns.length-1;i>=0;i--){
        if(turnRole(turns[i])!==preferredRole) continue;
        const turnText=String(turns[i].innerText||turns[i].textContent||'');
        if(extractBatchId(turnText)!==wanted) continue;
        const q=extractQuestionNumber(turnText);
        if(q) return q;
      }
    }
    return '';
  }

"""
    text = replace_exactly(
        text,
        extract_anchor,
        extract_anchor + helper,
        label="Gestion 1.1.8 ChatGPT batch question helper",
    )

    text = replace_exactly(
        text,
        "    let questionNumber=extractQuestionNumber(message?.innerText||message?.textContent||'');",
        "    let questionNumber=batchId?questionNumberForBatch(batchId):extractQuestionNumber(message?.innerText||message?.textContent||'');",
        label="Gestion 1.1.8 ChatGPT batch-aware question binding",
    )

    old_batch_found = """          if(b){
            batchId=b;
            batchConfidence=!crossedAssistant && role==='user'?'prompt':'history';
          }
"""
    new_batch_found = """          if(b){
            batchId=b;
            batchConfidence=!crossedAssistant && role==='user'?'prompt':'history';
            questionNumber=questionNumberForBatch(b)||questionNumber;
          }
"""
    text = replace_exactly(
        text,
        old_batch_found,
        new_batch_found,
        label="Gestion 1.1.8 ChatGPT batch prompt question recovery",
    )

    old_batch_guard = """    let batchBindingRecovered=false;
    let batchBindingPartial=false;
    const commentsOnlyRows=rowsAreCommentsOnly(rows);
    if(/^CARDINAL_BATCH_V11(?:0|3)$/.test(String(ctx?.version||''))){
      const conversationBatch=String(binding ? (binding.batchId||'') : (inferConversationBatchId()||''));
      const expectedBatch=String(ctx?.batchId||ctx?.sessionId||'');
      if(!conversationBatch || conversationBatch!==expectedBatch){
"""
    new_batch_guard = """    let batchBindingRecovered=false;
    let batchBindingPartial=false;
    let exactBatchBinding=false;
    const commentsOnlyRows=rowsAreCommentsOnly(rows);
    if(/^CARDINAL_BATCH_V11(?:0|3)$/.test(String(ctx?.version||''))){
      const conversationBatch=String(binding ? (binding.batchId||'') : (inferConversationBatchId()||''));
      const expectedBatch=String(ctx?.batchId||ctx?.sessionId||'');
      exactBatchBinding=!!conversationBatch && conversationBatch===expectedBatch;
      if(!exactBatchBinding){
"""
    text = replace_exactly(
        text,
        old_batch_guard,
        new_batch_guard,
        label="Gestion 1.1.8 exact batch precedence",
    )

    text = replace_exactly(
        text,
        "      if(conversationQ && targetQ && String(Number(conversationQ))!==String(Number(targetQ))){",
        "      if(!exactBatchBinding && conversationQ && targetQ && String(Number(conversationQ))!==String(Number(targetQ))){",
        label="Gestion 1.1.8 exact batch wins over inferred question",
    )

    for marker in (
        "function questionNumberForBatch(batchId)",
        "exactBatchBinding=!!conversationBatch && conversationBatch===expectedBatch;",
        "if(!exactBatchBinding && conversationQ && targetQ",
    ):
        if marker not in text:
            raise BaselineContractError(
                f"Correctif liaison ChatGPT multi-question 1.1.8 incomplet: {marker}"
            )
    chatgpt.write_text(text, encoding="utf-8")

def patch_user_verified_118_chatgpt_current_ui(chatgpt: Path) -> None:
    """Adapt the verified 1.1.8 ChatGPT bridge to explicit current UI markers."""
    text = chatgpt.read_text(encoding="utf-8")

    text = replace_exactly(
        text,
        """    if(turn.matches?.('[data-testid="user-message"]') || turn.querySelector?.('[data-testid="user-message"]')) return 'user';
    if(turn.matches?.('[data-testid="assistant-message"]') || turn.querySelector?.('[data-testid="assistant-message"]')) return 'assistant';

    const testid=String(turn.getAttribute?.('data-testid')||'').toLowerCase();
""",
        """    if(turn.matches?.('[data-testid="user-message"]') || turn.querySelector?.('[data-testid="user-message"]')) return 'user';
    if(turn.matches?.('[data-testid="assistant-message"]') || turn.querySelector?.('[data-testid="assistant-message"]')) return 'assistant';

    if(/:assistant$/i.test(String(turn.getAttribute?.('data-chatgpt-search-unit-key')||''))) return 'assistant';
    if(/:assistant$/i.test(String(turn.getAttribute?.('data-content-search-unit-key')||''))) return 'assistant';
    if(turn.hasAttribute?.('data-user-message-bubble') || turn.querySelector?.('[data-user-message-bubble]')) return 'user';

    const testid=String(turn.getAttribute?.('data-testid')||'').toLowerCase();
""",
        label="Gestion 1.1.8 current ChatGPT role markers",
    )

    text = replace_exactly(
        text,
        """      const outer=all.filter(node=>!all.some(other=>other!==node && other.contains(node)));
      return outer.length ? outer : all;
    }
    return [];
  }
""",
        """      const outer=all.filter(node=>!all.some(other=>other!==node && other.contains(node)));
      return outer.length ? outer : all;
    }

    const units=[...document.querySelectorAll(
      '[data-chatgpt-search-unit-key$=":assistant"],[data-content-search-unit-key$=":assistant"],[data-user-message-bubble]'
    )];
    if(units.length){
      const outer=units.filter(node=>!units.some(other=>other!==node && other.contains(node)));
      return outer.length ? outer : units;
    }
    return [];
  }
""",
        label="Gestion 1.1.8 current ChatGPT turn discovery",
    )

    for marker in (
        "data-chatgpt-search-unit-key",
        "data-content-search-unit-key",
        "data-user-message-bubble",
    ):
        if marker not in text:
            raise BaselineContractError(
                f"Correctif interface ChatGPT 1.1.8 incomplet: {marker}"
            )
    chatgpt.write_text(text, encoding="utf-8")


def patch_user_verified_118_chatgpt_no_auto_reload(chatgpt: Path) -> None:
    """Never navigate/reload ChatGPT automatically from Cardinal."""
    text = chatgpt.read_text(encoding="utf-8")

    text = replace_exactly(
        text,
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
""",
        """  function queueReloadRecovery(rows,source,error,binding=null){
    // Never reload ChatGPT automatically. Extension updates can invalidate an
    // already-running content-script context; navigating the page here can loop
    // and hammer ChatGPT conversation endpoints. Preserve nothing for auto-replay.
    try { sessionStorage.removeItem(RELOAD_QUEUE_KEY); } catch {}
    $('panel').classList.remove('hidden');
    $('paste').classList.add('hidden');
    $('parsePaste').classList.add('hidden');
    $('msg').className='small err';
    $('msg').textContent='Cardinal a été mis à jour pendant que cette page était ouverte. Recharge ChatGPT manuellement une seule fois, puis relance l’envoi. Aucun résultat n’a été envoyé automatiquement.';
    return {ok:false,reloading:false,contextInvalidated:true};
  }
""",
        label="Gestion 1.1.8 disable ChatGPT auto reload",
    )

    text = replace_exactly(
        text,
        """  async function resumeReloadQueue(){
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
        """  async function resumeReloadQueue(){
    // Legacy pending auto-replay is intentionally discarded. A previous AIO
    // version may have left this key behind; never turn it into a new send or
    // page reload.
    try { sessionStorage.removeItem(RELOAD_QUEUE_KEY); } catch {}
    return;
  }
""",
        label="Gestion 1.1.8 disable ChatGPT auto replay",
    )

    if "location.reload()" in text or "setTimeout(()=>location.reload()" in text:
        raise BaselineContractError("ChatGPT auto-reload interdit: location.reload encore présent.")
    if "Je reprends l’envoi vers Formative" in text:
        raise BaselineContractError("ChatGPT auto-replay interdit: ancien message de reprise encore présent.")

    chatgpt.write_text(text, encoding="utf-8")


def patch_user_verified_118_chatgpt_live_ping(chatgpt: Path) -> None:
    """Expose a live bridge ping so the worker avoids redundant reinjection."""
    text = chatgpt.read_text(encoding="utf-8")
    text = replace_exactly(
        text,
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
        """  try {
    chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
      if(message?.type==='CARDINAL_CHATGPT_BRIDGE_PING'){
        sendResponse?.({ok:true,bridgeVersion:BRIDGE_VERSION});
        return;
      }
      if(message?.type==='CARDINAL_SIMPLE_CONTEXT_CLEARED'){
        cachedContext=null;
        $('panel').classList.add('hidden');
        refreshButton();
      }
    });
  } catch {}
""",
        label="Gestion 1.1.8 live ChatGPT bridge ping",
    )
    if "CARDINAL_CHATGPT_BRIDGE_PING" not in text:
        raise BaselineContractError("Ping du pont ChatGPT 1.1.8 absent.")
    chatgpt.write_text(text, encoding="utf-8")


def patch_user_verified_118_worker_chatgpt_ping(worker: Path) -> None:
    """Ping the live bridge before injecting chatgpt.js on focus/activation."""
    text = worker.read_text(encoding="utf-8")
    text = replace_exactly(
        text,
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
        """async function cardinalReinjectChatGptBridge1000(tabId) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = String(tab?.url || '');
    if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(url)) return;

    let live = null;
    try {
      live = await chrome.tabs.sendMessage(tabId, { type:'CARDINAL_CHATGPT_BRIDGE_PING' });
    } catch {}
    if (live?.ok && live?.bridgeVersion === '1.1.8') return;

    await chrome.scripting.executeScript({ target:{ tabId }, files:['chatgpt.js'] });
  } catch {}
}
""",
        label="Gestion 1.1.8 ping-before-reinject ChatGPT bridge",
    )
    if "CARDINAL_CHATGPT_BRIDGE_PING" not in text:
        raise BaselineContractError("Worker ChatGPT ping-before-reinject absent.")
    worker.write_text(text, encoding="utf-8")


def replace_exactly(text: str, old: str, new: str, *, label: str, expected: int = 1) -> str:
    count = text.count(old)
    if count != expected:
        raise BaselineContractError(
            f"Adaptation {label} impossible: {count} occurrence(s), attendu {expected}."
        )
    return text.replace(old, new)


def patch_message_names(text: str) -> str:
    for old, new in MESSAGE_NAMES.items():
        text = text.replace(f"'{old}'", f"'{new}'")
        text = text.replace(f'"{old}"', f'"{new}"')
    return text


def replace_function(text: str, name: str, replacement: str) -> str:
    pattern = re.compile(rf"function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{.*?\n\s*\}}", re.S)
    out, n = pattern.subn(lambda _match: replacement, text, count=1)
    if n != 1:
        raise BaselineContractError(f"Adaptation Classroom impossible: fonction {name} introuvable.")
    return out


def adapt_classroom(classroom_root: Path, dist: Path) -> list[dict]:
    required = ["background.js", "generator.js", "classroom-autolink.js", "classroom.js", "manifest.json"]
    missing = [name for name in required if not (classroom_root / name).is_file()]
    if missing:
        raise BaselineContractError("Pont Classroom 1.2.3 incomplet: " + ", ".join(missing))

    source_manifest = json.loads((classroom_root / "manifest.json").read_text(encoding="utf-8"))
    if source_manifest.get("version") != "1.2.3":
        raise BaselineContractError(
            f"Pont Classroom inattendu: version {source_manifest.get('version')!r}, attendu 1.2.3."
        )

    background = patch_message_names((classroom_root / "background.js").read_text(encoding="utf-8"))
    ownership_guard = """const PDC_NATIVE_MESSAGE_TYPES = new Set([
  'PDC_NATIVE_REMEMBER_GROUPS',
  'PDC_NATIVE_GET_GROUPS',
  'PDC_NATIVE_PREPARE',
  'PDC_NATIVE_CLAIM',
  'PDC_NATIVE_PASTE',
  'PDC_NATIVE_PUBLISH',
  'PDC_NATIVE_ACTIVATE',
  'PDC_NATIVE_COMPLETE',
  'PDC_NATIVE_FAIL'
]);

"""
    if "function validGeneratorSender" not in background:
        raise BaselineContractError("Adaptation Classroom impossible: point d'insertion ownership introuvable.")
    background = background.replace("function validGeneratorSender", ownership_guard + "function validGeneratorSender", 1)
    old_listener = """chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});"""
    new_listener = """chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = String(message?.type || '');
  if (!PDC_NATIVE_MESSAGE_TYPES.has(type)) return false;
  handleMessage(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});"""
    if old_listener not in background:
        raise BaselineContractError("Adaptation Classroom impossible: listener runtime source introuvable.")
    background = background.replace(old_listener, new_listener, 1)
    background = replace_function(
        background,
        "normalizedGroup",
        """function normalizedGroup(value) {
  const raw = String(value || '').trim();
  if (/^\\d{1,3}$/.test(raw)) return raw;
  const explicit = raw.match(/\\bgroupe\\s*[-: ]?\\s*(\\d{1,3})\\b/i);
  if (explicit) return explicit[1];
  const coded = raw.match(/\\bFRA\\dSE[-\\s]?(\\d{1,3})\\b/i);
  return coded ? coded[1] : raw;
}""",
    )
    (dist / "classroom-background-aio.js").write_text(background, encoding="utf-8")

    generator = patch_message_names((classroom_root / "generator.js").read_text(encoding="utf-8"))
    generator = replace_exactly(
        generator,
        "}, 1000);",
        "}, 15000);",
        label="Classroom generator fallback polling",
    )
    (dist / "classroom-generator-aio.js").write_text(generator, encoding="utf-8")

    autolink = (classroom_root / "classroom-autolink.js").read_text(encoding="utf-8")
    autolink = replace_function(
        autolink,
        "groupFromText",
        """function groupFromText(value) {
  const text = String(value || '').replace(/\\u00a0/g, ' ');
  const explicit = text.match(/\\bgroupe\\s*[-: ]?\\s*(\\d{1,3})\\b/i);
  if (explicit) return explicit[1];
  const coded = text.match(/\\bFRA\\dSE[-\\s]?(\\d{1,3})\\b/i);
  return coded?.[1] || '';
}""",
    )
    autolink = replace_function(
        autolink,
        "sectionForGroup",
        """function sectionForGroup(_group) {
  return '';
}""",
    )
    old_candidate = """      const groups = QUICK_GROUPS.filter(group => new RegExp(`(?:groupe\\\\s*[-–—:]?\\\\s*${group}\\\\b|FRA(?:3|5)SE[-\\\\s]?${group}\\\\b)`, 'i').test(text));
      if (groups.length === 1) return text;
      if (groups.length > 1) break;"""
    new_candidate = """      const group = groupFromText(text);
      if (group) return text;"""
    if old_candidate not in autolink:
        raise BaselineContractError("Adaptation Classroom impossible: logique QUICK_GROUPS introuvable.")
    autolink = autolink.replace(old_candidate, new_candidate)
    autolink = re.sub(r"\n\s*const QUICK_GROUPS = \[[^\n]+\];", "", autolink, count=1)
    autolink = replace_exactly(
        autolink,
        "setInterval(scan, 5000);",
        "setInterval(scan, 60000);",
        label="Classroom autolink fallback polling",
    )
    (dist / "classroom-autolink-aio.js").write_text(autolink, encoding="utf-8")

    classroom = patch_message_names((classroom_root / "classroom.js").read_text(encoding="utf-8"))

    adapted_runtime = background + "\n" + generator + "\n" + classroom
    stale_types = [
        old for old in MESSAGE_NAMES
        if f"'{old}'" in adapted_runtime or f'"{old}"' in adapted_runtime
    ]
    if stale_types:
        raise BaselineContractError(
            "Adaptation Classroom incomplète, anciens types runtime encore présents: "
            + ", ".join(sorted(stale_types))
        )

    (dist / "classroom-aio.js").write_text(classroom, encoding="utf-8")

    # banner-autodismiss.js is deliberately not copied. RC2 moved dismissal
    # ownership into the component that creates the banner.
    return [
        {
            "matches": [
                "https://techno-cardi.github.io/Plan-de-cours/*",
                "https://techno-cardi.github.io/Portail-Cardinal-Roy/agendakevin",
                "https://techno-cardi.github.io/Portail-Cardinal-Roy/agendakevin/*",
            ],
            "js": ["classroom-generator-aio.js"],
            "run_at": "document_start",
        },
        {
            "matches": ["https://classroom.google.com/*"],
            "js": ["classroom-autolink-aio.js", "classroom-aio.js"],
            "run_at": "document_idle",
        },
    ]


def build_formative_v2(repo_root: Path, scratch: Path) -> tuple[Path, dict]:
    output_root = scratch / "formative-v2"
    builder = repo_root / "Formative" / "v2" / "build-extension-v2.py"
    if not builder.is_file():
        raise BaselineContractError(f"Builder Formative v2 absent: {builder}")
    run([
        sys.executable,
        str(builder),
        "--repo-root",
        str(repo_root),
        "--output-root",
        str(output_root),
    ])
    zip_path = output_root / FORMATIVE_V2_ZIP
    if not zip_path.is_file():
        raise BaselineContractError(f"Artefact Formative v2 absent après build: {zip_path}")
    extracted = scratch / "formative-v2-extracted"
    extracted.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(extracted)
    manifest = json.loads((extracted / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version_name") != "0.5.0-rc1":
        raise BaselineContractError("Version Formative v2 inattendue.")
    return extracted, manifest


def copy_formative_v2_files(source: Path, dist: Path) -> None:
    skip = {
        "manifest.json",
        "popup-v2.html",
        "popup-v2.js",
        "README.txt",
        "build-metadata.json",
    }
    for p in source.iterdir():
        if not p.is_file() or p.name in skip:
            continue
        target = dist / p.name
        if target.exists():
            if sha256(target) != sha256(p):
                raise BaselineContractError(
                    f"Collision de fichier entre Gestion 1.1.9 et Formative v2: {p.name}"
                )
            continue
        shutil.copy2(p, target)


def augment_historical_popup(
    repo_root: Path,
    dist: Path,
    manifest: dict,
    *,
    gestion_version: str = "1.1.9",
    chatgpt_version: str = "1.1.9",
) -> tuple[str, str, str]:
    """Append the documented RC2 six-module dashboard without replacing Gestion controls."""
    popup = str((manifest.get("action") or {}).get("default_popup") or "").strip()
    if not popup or popup == "popup-v2.html":
        raise BaselineContractError("Popup historique Gestion 1.1.9 absent ou remplacé.")

    popup_path = dist / popup
    if not popup_path.is_file():
        raise BaselineContractError(f"Popup historique introuvable: {popup}")
    source_js = repo_root / "Cardinal" / "AIO" / AIO_POPUP_JS
    if not source_js.is_file():
        raise BaselineContractError(f"Dashboard AIO introuvable: {source_js}")

    original_sha = sha256(popup_path)
    text = popup_path.read_text(encoding="utf-8")
    if "cardinal-aio-dashboard" in text or AIO_POPUP_JS in text:
        raise BaselineContractError("Popup historique déjà adapté; assemblage refusé pour éviter une double injection.")

    matches = list(re.finditer(r"</body\s*>", text, re.I))
    if len(matches) != 1:
        raise BaselineContractError(
            f"Popup historique non adaptable de façon déterministe: {len(matches)} fermeture(s) </body>."
        )

    marker = matches[0]
    popup_script_ref = os.path.relpath(dist / AIO_POPUP_JS, popup_path.parent).replace(os.sep, "/")
    injection = (
        "\n  <div id=\"cardinal-aio-dashboard\" aria-label=\"État Cardinal AIO\"></div>\n"
        f"  <script src=\"{popup_script_ref}\"></script>\n"
    )
    adapted = text[:marker.start()] + injection + text[marker.start():]
    popup_path.write_text(adapted, encoding="utf-8")
    dashboard = source_js.read_text(encoding="utf-8")
    dashboard = dashboard.replace("Gestion 1.1.9", f"Gestion {gestion_version}")
    dashboard = dashboard.replace("Pont ChatGPT 1.1.9", f"Pont ChatGPT {chatgpt_version}")
    (dist / AIO_POPUP_JS).write_text(dashboard, encoding="utf-8")
    return popup, original_sha, sha256(popup_path)


def manifest_direct_refs(manifest: dict) -> set[str]:
    refs: set[str] = set()
    bg = manifest.get("background") or {}
    if bg.get("service_worker"):
        refs.add(bg["service_worker"])
    action = manifest.get("action") or {}
    if action.get("default_popup"):
        refs.add(action["default_popup"])
    for block in manifest.get("content_scripts") or []:
        refs.update(block.get("js") or [])
        refs.update(block.get("css") or [])
    for block in manifest.get("web_accessible_resources") or []:
        refs.update(block.get("resources") or [])
    for value in (manifest.get("icons") or {}).values():
        refs.add(value)
    if action.get("default_icon"):
        icon = action["default_icon"]
        if isinstance(icon, str):
            refs.add(icon)
        elif isinstance(icon, dict):
            refs.update(icon.values())
    return refs


def recursive_worker_imports(dist: Path, entry: str) -> set[str]:
    seen: set[str] = set()

    def walk(name: str) -> None:
        if name in seen:
            return
        seen.add(name)
        path = dist / name
        if not path.is_file() or path.suffix != ".js":
            return
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"importScripts\s*\((.*?)\)\s*;", text, re.S):
            for quoted in re.findall(r"['\"]([^'\"]+)['\"]", match.group(1)):
                walk(quoted)

    walk(entry)
    return seen


def validate_output(
    dist: Path,
    manifest: dict,
    historical_hashes: dict[str, str],
    *,
    gestion_version: str = "1.1.9",
    chatgpt_version: str = "1.1.9",
) -> None:
    if manifest.get("key"):
        raise BaselineContractError("AIO invalide: manifest.key ne doit pas être hérité de Formative v2.")
    verify_core_hashes(dist, historical_hashes)

    refs = manifest_direct_refs(manifest)
    missing = sorted(ref for ref in refs if not (dist / ref).is_file())
    if missing:
        raise BaselineContractError("Références manifest absentes: " + ", ".join(missing))

    imports = recursive_worker_imports(dist, "service-worker.js")
    required_worker = {"legacy-service-worker.js", "classroom-background-aio.js", "background-v2.js"}
    if not required_worker.issubset(imports):
        raise BaselineContractError(
            "Chaîne service worker incomplète: "
            + ", ".join(sorted(required_worker - imports))
        )

    script_blocks = manifest.get("content_scripts") or []
    flat_js = [name for block in script_blocks for name in block.get("js") or []]
    banned = {
        "background-v091.js",
        "background-v092.js",
        "background-v093.js",
        "chatgpt-ui.js",
        "formative-simple-ui.js",
        "formative-stealth-v092.js",
        "formative-stealth-v093.js",
        "banner-autodismiss.js",
        "popup-v2.js",
    }
    active_banned = sorted(banned.intersection(set(flat_js) | imports))
    if active_banned:
        raise BaselineContractError("Script expérimental/interdit actif: " + ", ".join(active_banned))

    packaged_banned = []
    forbidden_name_re = re.compile(
        r"^(?:background-v09\\d\\.js|chatgpt-ui\\.js|formative-simple-ui\\.js|"
        r"formative-stealth-v09\\d\\.js|banner-autodismiss\\.js|popup-v2\\.js)$",
        re.I,
    )
    for path in dist.rglob("*"):
        if path.is_file() and forbidden_name_re.match(path.name):
            packaged_banned.append(str(path.relative_to(dist)).replace("\\\\", "/"))
    if packaged_banned:
        raise BaselineContractError(
            "Source expérimentale/interdite empaquetée: " + ", ".join(sorted(packaged_banned))
        )

    expected_permissions = {
        "scripting", "tabs", "windows", "webRequest", "storage", "alarms", "debugger"
    }
    actual_permissions = set(manifest.get("permissions") or [])
    if actual_permissions != expected_permissions:
        raise BaselineContractError(
            "Permissions AIO hors contrat: "
            + ", ".join(sorted(actual_permissions))
            + " ; attendu: "
            + ", ".join(sorted(expected_permissions))
        )

    broad_hosts = {
        "<all_urls>",
        "http://*/*",
        "https://*/*",
        "*://*/*",
    }
    actual_hosts = set(manifest.get("host_permissions") or [])
    forbidden_hosts = sorted(actual_hosts.intersection(broad_hosts))
    if forbidden_hosts:
        raise BaselineContractError(
            "Host permission générique interdite: " + ", ".join(forbidden_hosts)
        )
    for block in manifest.get("content_scripts") or []:
        broad_matches = sorted(set(block.get("matches") or []).intersection(broad_hosts))
        if broad_matches:
            raise BaselineContractError(
                "Content script trop large: " + ", ".join(broad_matches)
            )

    if "formative-network.js" in flat_js and "formative-session-main-v2.js" in flat_js:
        if flat_js.index("formative-network.js") > flat_js.index("formative-session-main-v2.js"):
            raise BaselineContractError("Ordre Formative invalide: le moteur historique doit être injecté avant v2.")

    # RC2 used a contextual six-module dashboard while preserving the
    # historical Gestion popup controls. The repair therefore augments the
    # historical popup instead of replacing it with Formative standalone UI.
    popup = (manifest.get("action") or {}).get("default_popup")
    if not popup or popup == "popup-v2.html":
        raise BaselineContractError("Popup contextuel Gestion 1.1.9 non préservé.")
    popup_path = dist / popup
    popup_text = popup_path.read_text(encoding="utf-8", errors="replace")
    popup_script_ref = os.path.relpath(dist / AIO_POPUP_JS, popup_path.parent).replace(os.sep, "/")
    if "cardinal-aio-dashboard" not in popup_text or f'src="{popup_script_ref}"' not in popup_text:
        raise BaselineContractError("Dashboard contextuel RC2 absent du popup historique.")
    popup_js = dist / AIO_POPUP_JS
    if not popup_js.is_file():
        raise BaselineContractError("Script du dashboard contextuel RC2 absent.")
    popup_js_text = popup_js.read_text(encoding="utf-8", errors="replace")
    for label in (
        f"Gestion {gestion_version}",
        "Correction Formative 1.1.3",
        "Importateur Formative 0.5 RC1",
        "Mozaïk v14",
        "Pont Classroom 1.2.3",
        f"Pont ChatGPT {chatgpt_version}",
    ):
        if label not in popup_js_text:
            raise BaselineContractError(f"Module RC2 absent du popup AIO: {label}")

    if gestion_version == "1.1.8":
        legacy_formative = (dist / "formative.js").read_text(encoding="utf-8", errors="replace")
        legacy_worker = (dist / "legacy-service-worker.js").read_text(encoding="utf-8", errors="replace")
        correction_context_markers = {
            "réponse élève": "lines.push(`Réponse : ${a.answerText}`);",
            "historique visible": "Échanges précédents dans Formative :",
            "anti-répétition": "ne répète pas inutilement un commentaire déjà donné",
            "lecture feedback serveur": "feedbackMessages(orderBy:{field:CREATED,direction:ASC},includeReplies:true,studentIds:$studentIds)",
            "rôle enseignant/élève": "message?.from?.teacher === true ? 'enseignant'",
            "liaison feedback-réponse": "feedbackHistory: (feedbackByAnswer.get(answerId) || []).slice(-4)",
            "override réponse modifiée": "const answerChanged = String(c.fingerprint || '') !== target.fingerprint;",
            "override pointage dérivé": "const changedAnswerOverride = allowChangedAnswers && answerChanged;",
            "liaison batch ChatGPT": "function questionNumberForBatch(batchId)",
            "priorité batch explicite": "exactBatchBinding=!!conversationBatch && conversationBatch===expectedBatch;",
        }
        worker_markers = {
            "lecture feedback serveur",
            "rôle enseignant/élève",
            "liaison feedback-réponse",
            "override réponse modifiée",
            "override pointage dérivé",
        }
        chatgpt_markers = {"liaison batch ChatGPT", "priorité batch explicite"}
        for label, marker in correction_context_markers.items():
            haystack = (
                legacy_worker if label in worker_markers
                else ((dist / "chatgpt.js").read_text(encoding="utf-8", errors="replace") if label in chatgpt_markers else legacy_formative)
            )
            if marker not in haystack:
                raise BaselineContractError(
                    f"Contexte de correction Formative 1.1.8 incomplet: {label} absent."
                )

    node = shutil.which("node")
    if not node:
        raise BaselineContractError("node est requis pour valider tous les JavaScript.")
    for js in sorted(dist.rglob("*.js")):
        run([node, "--check", str(js)])

    for path in dist.rglob("*.js"):
        text = path.read_text(encoding="utf-8", errors="replace")
        for token in ("eval(", "new Function(", "document.write(", "debugger;"):
            if token in text:
                raise BaselineContractError(f"Construction interdite {token!r} dans {path.name}")


def validate_popup_script_compatibility(dist: Path, popup: str) -> dict:
    popup_path = dist / popup
    if not popup_path.is_file():
        raise BaselineContractError(f"Popup historique absent pendant validation: {popup}")

    html = popup_path.read_text(encoding="utf-8", errors="replace")
    script_tag_re = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.I | re.S)
    src_re = re.compile(r"\bsrc\s*=\s*(['\"])([^'\"]+)\1", re.I)
    type_re = re.compile(r"\btype\s*=\s*(['\"])([^'\"]+)\1", re.I)

    all_sources: list[tuple[str, str, bool]] = []
    classic_sources: list[tuple[str, str]] = []
    for index, match in enumerate(script_tag_re.finditer(html)):
        attrs = match.group(1) or ""
        body = match.group(2) or ""
        type_match = type_re.search(attrs)
        script_type = (type_match.group(2).strip().lower() if type_match else "")
        is_module = script_type == "module"
        src_match = src_re.search(attrs)
        if src_match:
            src = src_match.group(2).strip()
            if "://" in src or src.startswith("//"):
                raise BaselineContractError(f"Script popup externe interdit dans l'AIO: {src}")
            resolved = (popup_path.parent / src).resolve()
            root = dist.resolve()
            try:
                resolved.relative_to(root)
            except ValueError as exc:
                raise BaselineContractError(f"Script popup hors paquet AIO: {src}") from exc
            if not resolved.is_file():
                raise BaselineContractError(f"Script popup référencé mais absent: {src}")
            text = resolved.read_text(encoding="utf-8", errors="replace")
            all_sources.append((src, text, is_module))
            if not is_module:
                classic_sources.append((src, text))
        elif body.strip():
            name = f"{popup}#inline-{index}"
            all_sources.append((name, body, is_module))
            if not is_module:
                classic_sources.append((name, body))

    aio_rows = [(name, text) for name, text, _is_module in all_sources if Path(name).name == AIO_POPUP_JS]
    if len(aio_rows) != 1:
        raise BaselineContractError(
            f"Le popup AIO doit charger exactement une fois {AIO_POPUP_JS}; trouvé {len(aio_rows)}."
        )
    aio_name, aio_text = aio_rows[0]
    historical_rows = [(name, text) for name, text, _is_module in all_sources if name != aio_name]

    aio_globals = explicit_global_writes(aio_text)
    aio_dom_ids = dom_id_literals(aio_text)
    aio_storage = storage_key_literals(aio_text)
    collisions = []
    for name, text in historical_rows:
        for kind, shared in (
            ("global", explicit_global_writes(text).intersection(aio_globals)),
            ("dom-id", dom_id_literals(text).intersection(aio_dom_ids)),
            ("storage", storage_key_literals(text).intersection(aio_storage)),
        ):
            for value in sorted(shared):
                collisions.append(f"{kind}={value} ({name} vs {aio_name})")
    if collisions:
        raise BaselineContractError(
            "Collision entre le popup historique Gestion et le dashboard AIO: " + "; ".join(collisions)
        )

    node = shutil.which("node")
    if not node:
        raise BaselineContractError("node est requis pour valider le scope JavaScript du popup AIO.")
    with tempfile.TemporaryDirectory(prefix="cardinal-aio-popup-bundle-") as td:
        bundle = Path(td) / "popup-bundle.js"
        bundle.write_text(
            "\n;\n".join(f"/* {name} */\n{text}" for name, text in classic_sources) + "\n",
            encoding="utf-8",
        )
        try:
            run([node, "--check", str(bundle)])
        except (OSError, subprocess.CalledProcessError) as exc:
            raise BaselineContractError(
                "Collision de scope JavaScript entre le popup Gestion et le dashboard AIO."
            ) from exc

    return {
        "scriptCount": len(all_sources),
        "classicScriptCount": len(classic_sources),
        "historicalScriptCount": len(historical_rows),
        "collisions": [],
    }


def validate_content_script_parse_compatibility(dist: Path, manifest: dict) -> dict:
    node = shutil.which("node")
    if not node:
        raise BaselineContractError("node est requis pour valider les bundles de content scripts AIO.")

    bundles = content_script_bundles(manifest)
    checked = 0
    with tempfile.TemporaryDirectory(prefix="cardinal-aio-content-bundles-") as td:
        tmp = Path(td)
        for index, ((world, host), scripts) in enumerate(sorted(bundles.items())):
            if len(scripts) < 2:
                continue
            pieces = []
            for script in scripts:
                path = dist / script
                if not path.is_file():
                    raise BaselineContractError(f"Script AIO absent pendant validation de scope: {script}")
                pieces.append(f"/* {script} */\n" + path.read_text(encoding="utf-8", errors="replace"))
            bundle = tmp / f"bundle-{index:03d}.js"
            bundle.write_text("\n;\n".join(pieces) + "\n", encoding="utf-8")
            try:
                run([node, "--check", str(bundle)])
            except (OSError, subprocess.CalledProcessError) as exc:
                raise BaselineContractError(
                    "Collision de scope JavaScript dans les content scripts AIO "
                    f"pour {host} monde {world}: {', '.join(scripts)}"
                ) from exc
            checked += 1
    return {"bundleCount": checked, "bundleKeys": [f"{world}:{host}" for world, host in sorted(bundles)]}


def validate_runtime_boot(repo_root: Path, dist: Path) -> None:
    node = shutil.which("node")
    if not node:
        raise BaselineContractError("node est requis pour le boot test AIO.")
    harness = repo_root / "Cardinal" / "AIO" / "aio_service_worker.boot.test.js"
    if not harness.is_file():
        raise BaselineContractError(f"Harness de boot AIO absent: {harness}")
    try:
        run([node, str(harness), str(dist)])
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BaselineContractError(f"Boot du service worker AIO échoué: {exc}") from exc


def make_zip(dist: Path, output: Path) -> None:
    """Create a byte-reproducible ZIP from identical input bytes."""
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(p for p in dist.rglob("*") if p.is_file()):
            arcname = str(path.relative_to(dist)).replace("\\", "/")
            info = zipfile.ZipInfo(arcname, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            info.create_system = 3
            zf.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def assemble_from_extracted_baseline(
    extracted_root: Path,
    repo_root: Path,
    classroom_root: Path,
    output: Path,
    scratch: Path,
    baseline_profile: dict | None = None,
) -> Path:
    """Assemble an AIO from an already extracted, contract-valid baseline.

    Production callers must validate the exact baseline ZIP SHA before calling
    this function. Tests may use a synthetic extracted baseline to exercise the
    complete integration path without weakening the production SHA gate.
    """
    verify_source_provenance(repo_root, classroom_root)
    baseline_manifest = load_and_validate_extracted_baseline(extracted_root)
    if baseline_profile is not None:
        chatgpt_source = (Path(extracted_root) / "chatgpt.js").read_text(
            encoding="utf-8", errors="replace"
        )
        validate_baseline_profile_manifest(baseline_profile, baseline_manifest, chatgpt_source)

    gestion_version = str(
        (baseline_profile or {}).get("version") or baseline_manifest.get("version") or "unknown"
    )
    chatgpt_version = str(
        (baseline_profile or {}).get("chatgptVersion") or gestion_version
    )

    dist = scratch / "dist"
    copy_tree_contents(extracted_root, dist)
    historical_hashes = snapshot_core_hashes(dist)

    chatgpt_path = dist / "chatgpt.js"
    original_chatgpt_sha256 = sha256(chatgpt_path)
    if gestion_version == "1.1.8":
        patch_user_verified_118_chatgpt_batch_binding(chatgpt_path)
        patch_user_verified_118_chatgpt_current_ui(chatgpt_path)
        patch_user_verified_118_chatgpt_no_auto_reload(chatgpt_path)
        patch_user_verified_118_chatgpt_live_ping(chatgpt_path)
    patched_chatgpt_sha256 = sha256(chatgpt_path)
    validated_core_hashes = snapshot_core_hashes(dist)

    popup_name = str((baseline_manifest.get("action") or {}).get("default_popup") or "").strip()
    if not popup_name:
        raise BaselineContractError(f"Popup historique Gestion {gestion_version} absent du manifest.")
    preserved_baseline_hashes = snapshot_tree_hashes(
        dist,
        exclude={"manifest.json", "service-worker.js", popup_name},
    )

    original_worker = dist / "service-worker.js"
    original_worker_sha256 = sha256(original_worker)
    legacy_worker = dist / "legacy-service-worker.js"
    shutil.copy2(original_worker, legacy_worker)
    patch_historical_graphql(legacy_worker)
    if gestion_version == "1.1.8":
        patch_user_verified_118_changed_answer_force(legacy_worker)
        patch_user_verified_118_worker_chatgpt_ping(legacy_worker)
    patched_legacy_worker_sha256 = sha256(legacy_worker)

    formative_root, formative_manifest = build_formative_v2(repo_root, scratch)
    classroom_manifest, compatibility_reports = verify_extension_compatibility(
        baseline_root=dist,
        baseline_manifest=baseline_manifest,
        formative_root=formative_root,
        formative_manifest=formative_manifest,
        classroom_root=classroom_root,
    )
    copy_formative_v2_files(formative_root, dist)

    classroom_scripts = adapt_classroom(classroom_root, dist)
    popup_name, original_popup_sha256, adapted_popup_sha256 = augment_historical_popup(
        repo_root,
        dist,
        baseline_manifest,
        gestion_version=gestion_version,
        chatgpt_version=chatgpt_version,
    )

    manifest = merge_manifest(
        baseline_manifest,
        formative_manifest,
        classroom_scripts=classroom_scripts,
        classroom_hosts=CLASSROOM_HOSTS,
    )
    manifest["version"] = AIO_VERSION
    profile_suffix = "" if gestion_version == "1.1.9" else f"-g{gestion_version.replace('.', '')}"
    manifest["version_name"] = AIO_VERSION_NAME + profile_suffix
    manifest["description"] = (
        f"Cardinal AIO: Gestion des notes {gestion_version}, correction Formative, "
        "Formative v2 et pont Classroom natif."
    )
    manifest.pop("key", None)

    try:
        manifest_parity = assert_manifest_capability_parity(
            aio_manifest=manifest,
            formative_manifest=formative_manifest,
            classroom_manifest=classroom_manifest,
            adapted_classroom_scripts=classroom_scripts,
        )
    except CompatibilityContractError as exc:
        raise BaselineContractError(str(exc)) from exc

    worker = (
        "'use strict';\n"
        "importScripts('legacy-service-worker.js');\n"
        "importScripts('classroom-background-aio.js');\n"
        "importScripts('background-v2.js');\n"
    )
    (dist / "service-worker.js").write_text(worker, encoding="utf-8")
    (dist / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    validate_output(
        dist,
        manifest,
        validated_core_hashes,
        gestion_version=gestion_version,
        chatgpt_version=chatgpt_version,
    )
    content_script_parse_report = validate_content_script_parse_compatibility(dist, manifest)
    popup_script_compatibility = validate_popup_script_compatibility(dist, popup_name)
    validate_runtime_boot(repo_root, dist)
    verify_tree_hashes(
        dist,
        preserved_baseline_hashes,
        label=f"tous les fichiers hérités de Gestion {gestion_version}",
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    metadata_path = output.with_suffix(".json")
    staged_zip = output.with_name("." + output.name + ".tmp")
    staged_metadata = metadata_path.with_name("." + metadata_path.name + ".tmp")
    for staged in (staged_zip, staged_metadata):
        staged.unlink(missing_ok=True)

    try:
        make_zip(dist, staged_zip)
        metadata = {
            "schema": "cardinal.aio.repair/1",
            "version": AIO_VERSION,
            "versionName": manifest["version_name"],
            "baselineProfile": (baseline_profile or {}).get("id", "synthetic-test"),
            "baselineVersion": gestion_version,
            "baselineChatGptBridgeVersion": chatgpt_version,
            "baselineZipSha256": (baseline_profile or {}).get("sha256", BASELINE_SHA256),
            "baselineSource": (baseline_profile or {}).get("source", "synthetic-test"),
            "classroomCommit": CLASSROOM_COMMIT,
            "formativeTreeSha": FORMATIVE_TREE_SHA,
            "outputSha256": sha256(staged_zip),
            "historicalCoreSha256": historical_hashes,
            "validatedCoreSha256": validated_core_hashes,
            "originalChatGptSha256": original_chatgpt_sha256,
            "patchedChatGptSha256": patched_chatgpt_sha256,
            "baselinePreservedFileCount": len(preserved_baseline_hashes),
            "baselinePreservedTreeSha256": tree_hash_manifest_digest(preserved_baseline_hashes),
            "originalServiceWorkerSha256": original_worker_sha256,
            "patchedLegacyServiceWorkerSha256": patched_legacy_worker_sha256,
            "popupPath": popup_name,
            "originalPopupSha256": original_popup_sha256,
            "adaptedPopupSha256": adapted_popup_sha256,
            "runtimeBootValidated": True,
            "contentScriptParseCompatibility": content_script_parse_report,
            "popupScriptCompatibility": popup_script_compatibility,
            "compatibility": compatibility_reports,
            "standaloneCapabilityParity": manifest_parity,
            "manifestSha256": sha256(dist / "manifest.json"),
            "manifestKeyPresent": False,
            "experimental09xFallback": False,
        }
        staged_metadata.write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(staged_zip, output)
        os.replace(staged_metadata, metadata_path)
    finally:
        staged_zip.unlink(missing_ok=True)
        staged_metadata.unlink(missing_ok=True)

    return metadata_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--baseline",
        type=Path,
        default=(
            Path(os.environ["CARDINAL_GESTION_ZIP"])
            if os.environ.get("CARDINAL_GESTION_ZIP")
            else (
                Path(os.environ["CARDINAL_GESTION_119_ZIP"])
                if os.environ.get("CARDINAL_GESTION_119_ZIP")
                else None
            )
        ),
        help="ZIP Gestion correspondant exactement à un profil de baseline autorisé.",
    )
    parser.add_argument(
        "--baseline-profile",
        choices=["auto", *sorted(BASELINE_PROFILES)],
        default="auto",
        help="Profil exact exigé; auto sélectionne uniquement par SHA-256 connu.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
    )
    parser.add_argument(
        "--classroom-root",
        type=Path,
        required=True,
        help=f"chrome-classroom-native-bridge at commit {CLASSROOM_COMMIT}",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("dist/Cardinal-AIO-1.2.0-rc14-formative-pedago3.zip"),
    )
    args = parser.parse_args(argv)

    if args.baseline is None:
        allowed = ", ".join(
            f"{name}={profile['sha256']}" for name, profile in BASELINE_PROFILES.items()
        )
        raise BaselineContractError(
            "Aucun paquet Gestion fourni. Le build est arrêté. "
            f"Profils exacts autorisés: {allowed}"
        )

    baseline_zip = args.baseline.resolve()
    repo_root = args.repo_root.resolve()
    classroom_root = args.classroom_root.resolve()
    output = args.output.resolve()

    requested_profile = None if args.baseline_profile == "auto" else args.baseline_profile
    baseline_profile = resolve_baseline_profile(baseline_zip, requested_profile)

    with tempfile.TemporaryDirectory(prefix="cardinal-aio-repair-") as tmp:
        scratch = Path(tmp)
        extracted_root = extract_zip_flat(baseline_zip, scratch / "baseline")
        assemble_from_extracted_baseline(
            extracted_root=extracted_root,
            repo_root=repo_root,
            classroom_root=classroom_root,
            output=output,
            scratch=scratch,
            baseline_profile=baseline_profile,
        )

    print(f"AIO_ZIP={output}")
    print(f"AIO_SHA256={sha256(output)}")
    print(f"AIO_METADATA={output.with_suffix('.json')}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BaselineContractError as exc:
        print(f"BUILD_REFUSED={exc}", file=sys.stderr)
        raise SystemExit(2)

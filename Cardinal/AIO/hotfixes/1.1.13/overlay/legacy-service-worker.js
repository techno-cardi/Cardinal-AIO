
// ===== background.js =====
const MOZAIK_URL = 'https://mozaikportail.ca/*';
const MOZAIK_HOME = 'https://mozaikportail.ca/';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'START_MOZAIK_SYNC') return;
  handleSync(message.payload)
    .then(sendResponse)
    .catch(error => sendResponse({ success: false, message: error?.message || String(error) }));
  return true;
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTabComplete(tabId, timeout = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.status === 'complete') return;
    } catch {}
    await sleep(400);
  }
  throw new Error('Mozaïk prend trop de temps à s’ouvrir. Recharge le portail puis réessaie.');
}

async function handleSync(payload) {
  if (!payload?.assignment || !payload?.group || !Array.isArray(payload?.results)) {
    throw new Error('Le lot de synchronisation est incomplet.');
  }

  let tabs = await chrome.tabs.query({ url: MOZAIK_URL });
  let tab = tabs.find(t => t.active) || tabs[0];

  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: MOZAIK_HOME, active: true });
    if (!tab?.id) throw new Error('Impossible d’ouvrir Mozaïk.');
    await waitForTabComplete(tab.id);
  } else {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.status !== 'complete') await waitForTabComplete(tab.id);
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: syncInsideMozaik,
    args: [payload]
  });

  if (!result || typeof result !== 'object') {
    throw new Error('Mozaïk n’a retourné aucun résultat exploitable. Recharge l’onglet Mozaïk et réessaie.');
  }
  return result;
}

async function syncInsideMozaik(payload, tokenOverride = '') {
  try {
    const API = 'https://apiaffaires.mozaikportail.ca';
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function norm(s) {
      return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }
    function strings(o, d = 0, out = []) {
      if (d > 4 || o == null) return out;
      if (typeof o === 'string') { out.push(o); return out; }
      if (typeof o !== 'object') return out;
      for (const v of Object.values(o)) {
        if (typeof v === 'string') out.push(v);
        else if (v && typeof v === 'object') strings(v, d + 1, out);
      }
      return out;
    }
    function findField(o, names, d = 0, seen = new WeakSet()) {
      if (!o || typeof o !== 'object' || d > 5 || seen.has(o)) return null;
      seen.add(o);
      for (const [k, v] of Object.entries(o)) {
        const nk = norm(k).replace(/ /g, '');
        if (names.includes(nk) && v != null && typeof v !== 'object') return v;
      }
      for (const v of Object.values(o)) {
        const r = findField(v, names, d + 1, seen);
        if (r != null) return r;
      }
      return null;
    }
    function fiche(m) { return findField(m, ['fiche', 'numerofiche', 'nofiche']); }
    function possibleNames(m) {
      const first = findField(m, ['prenom', 'firstname', 'first']);
      const last = findField(m, ['nom', 'lastname', 'last', 'nomfamille']);
      const arr = [];
      if (first && last) arr.push(norm(first + ' ' + last), norm(last + ' ' + first));
      const full = findField(m, ['nomcomplet', 'fullname', 'displayname']);
      if (full) arr.push(norm(full));
      return [...new Set(arr.filter(Boolean))];
    }
    function memberEmail(m) {
      return strings(m).map(x => String(x).trim().toLowerCase()).find(x => x.endsWith('@educ.cscapitale.qc.ca')) || null;
    }
    function findUuid(o, d = 0) {
      if (d > 5 || o == null) return null;
      if (typeof o === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(o)) return o;
      if (typeof o !== 'object') return null;
      for (const k of ['idActivite', 'id', 'activityId']) {
        if (typeof o[k] === 'string' && /^[0-9a-f-]{36}$/i.test(o[k])) return o[k];
      }
      for (const v of Object.values(o)) {
        const r = findUuid(v, d + 1);
        if (r) return r;
      }
      return null;
    }
    function findCompetenceArray(o, d = 0) {
      if (d > 5 || o == null) return null;
      if (Array.isArray(o) && o.some(x => x && typeof x === 'object')) {
        if (o.some(x => ['code', 'id', 'valeur', 'codeCompetence', 'numero'].some(k => x[k] != null))) return o;
      }
      if (typeof o === 'object') {
        for (const v of Object.values(o)) {
          const r = findCompetenceArray(v, d + 1);
          if (r) return r;
        }
      }
      return null;
    }
    function compInfo(c) {
      const code = c.codeCompetence ?? c.code ?? c.valeur ?? c.numero ?? c.id;
      const label = c.description ?? c.libelle ?? c.nom ?? c.titre ?? c.descriptionLongue ?? String(code ?? '');
      return { code: String(code ?? ''), label: String(label ?? '') };
    }
    function findToken() {
      const root = window.authentification;
      if (!root) return null;
      const seen = new WeakSet();
      const stack = [root];
      let steps = 0;
      while (stack.length && steps++ < 2500) {
        const o = stack.pop();
        if (!o || typeof o !== 'object' || seen.has(o)) continue;
        seen.add(o);
        try {
          if (typeof o.AccessToken === 'string' && o.AccessToken.length > 40) return o.AccessToken;
        } catch {}
        let vals = [];
        try { vals = Object.values(o); } catch {}
        for (const v of vals) if (v && typeof v === 'object') stack.push(v);
      }
      return null;
    }
    async function waitForToken(timeout = 5000) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const token = findToken();
        if (token) return token;
        await sleep(700);
      }
      throw new Error('La connexion à Mozaïk n’a pas été détectée. Connecte-toi au portail puis réessaie.');
    }
    async function request(method, path, token, body) {
      const headers = {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json, text/plain, */*',
        'Encode-Response': 'false',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      };
      const response = await fetch(API + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      const detail = typeof data === 'string' ? data : (data?.Message || data?.message || '');
      if (!response.ok) {
        const e = new Error(method + ' ' + path + ' : ' + response.status + (detail ? ' ' + detail : ''));
        e.status = response.status;
        e.path = path;
        throw e;
      }
      return data;
    }
    function schoolYearStart() {
      const d = new Date();
      return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
    }
    function currentizeId(id, establishmentId) {
      const raw = String(id || '');
      const prefix = String(establishmentId || '');
      if (!raw || !prefix) return raw;
      return raw.replace(new RegExp('^' + prefix + '\\d{4}'), prefix + String(schoolYearStart()));
    }
    function activityPayload(a, competence, existing) {
      const p = {
        codeEtape: String(a.term),
        titre: a.title,
        notePublique: existing?.notePublique ?? null,
        notePrivee: existing?.notePrivee ?? null,
        dateActivite: a.activityDate,
        periode: Number(a.period),
        faitALaMaison: !!a.homework,
        afficheeDansHoraire: !!a.showInSchedule,
        contientResultats: existing?.contientResultats ?? 'Aucun',
        competenceInvalide: false,
        parametresEvaluation: {
          evaluee: true,
          competence: String(competence),
          noteMaximale: Number(a.maxScore),
          porteeAuBulletin: !!a.reportCardEnabled,
          idCategoriePonderation: existing?.parametresEvaluation?.idCategoriePonderation ?? null,
          ponderation: a.reportCardEnabled ? Number(a.weight) : null,
          resultatsDisponibles: !!a.resultsVisible,
          ...(a.reportCardEnabled ? {} : { legende: 'MEN' })
        },
        liens: Array.isArray(existing?.liens) ? existing.liens : []
      };
      if (!existing && a.reportCardEnabled) p.categoriePonderationInexistante = false;
      return p;
    }
    function competenceWanted(a) {
      const key = norm(a.competenceKind || a.competenceKey || '');
      if (key.includes('lecture') || key === 'lire') return ['lire', 'lecture'];
      if (key.includes('ecriture') || key.includes('ecrire')) return ['ecrire', 'ecriture'];
      if (key.includes('oral')) return ['communiquer oralement', 'oral'];
      const c = norm((a.competencies || []).join(' '));
      if (c.includes('lecture')) return ['lire', 'lecture'];
      if (c.includes('ecriture')) return ['ecrire', 'ecriture'];
      if (c.includes('oral')) return ['communiquer oralement', 'oral'];
      return [];
    }
    async function resolveCompetence(a, g, token) {
      const cd = await request('GET', `/api/evaluation/matieresOrganisme/${g.establishmentId}/anneeCourante/${g.subjectCode}/competences`, token);
      const infos = (findCompetenceArray(cd) || []).map(compInfo).filter(x => x.code);
      const wanted = competenceWanted(a);
      for (const needle of wanted) {
        const hit = infos.find(x => norm(x.label).includes(needle));
        if (hit) return hit;
      }
      throw new Error('Impossible d’identifier automatiquement la compétence Mozaïk. Compétences trouvées : ' + infos.map(x => `${x.code} : ${x.label}`).join(', '));
    }
    function gradeString(value, decimal = 'comma') {
      const n = Number(value);
      if (!Number.isFinite(n)) return '';
      const s = String(n);
      return decimal === 'comma' ? s.replace('.', ',') : s;
    }

    const suppliedToken = String(tokenOverride || '').replace(/^Bearer\s+/i, '').trim();
    const token = suppliedToken || await waitForToken(5000);
    const a = payload.assignment;
    // The mapping was already validated against the live Mozaïk roster by Gestion.
    // Never rewrite the school year here: use the exact IDs that were validated.
    const g = { ...payload.group };

    const memberData = await request('GET', `/api/organisationscolaire/groupes/${g.establishmentId}/${g.groupMatterId}/membres`, token);
    const members = Array.isArray(memberData) ? memberData : (memberData?.membres || []);
    if (!members.length) throw new Error('La liste des élèves Mozaïk est vide ou illisible pour le groupe ' + g.code + '.');

    const matched = [];
    const missing = [];
    for (const r of payload.results) {
      const em = String(r.email).toLowerCase();
      let candidates = members.filter(m => memberEmail(m) === em);
      if (!candidates.length) {
        const n = norm(r.name);
        candidates = members.filter(m => possibleNames(m).includes(n));
      }
      if (candidates.length !== 1) {
        missing.push(r.name + ' (' + r.email + ')');
        continue;
      }
      const f = fiche(candidates[0]);
      if (f == null) {
        missing.push(r.name + ' (fiche introuvable)');
        continue;
      }
      matched.push({ fiche: Number(f), grade: Number(r.grade) });
    }
    if (missing.length) throw new Error('Association impossible pour : ' + missing.join(', ') + '. Aucune donnée n’a été écrite.');

    const competence = await resolveCompetence(a, g, token);
    let activityId = payload.link?.activityId || null;
    let existing = null;
    let activityList = null;

    if (activityId) {
      activityList = await request('GET', `/api/evaluation/apprentissage/${g.establishmentId}/activites/groupe/${g.groupCourseId}`, token);
      const arr = Array.isArray(activityList) ? activityList : (activityList?.activites || []);
      existing = arr.find(x => x?.id === activityId || x?.idActivite === activityId) || null;
      if (!existing) {
        const same = arr.filter(x => norm(x?.titre ?? x?.title ?? '') === norm(a.title));
        if (same.length === 1) {
          existing = same[0];
          activityId = findUuid(existing);
        } else if (same.length > 1) {
          throw new Error('Plusieurs activités portent ce titre dans Mozaïk. Renomme le travail ou supprime le doublon avant de synchroniser.');
        } else {
          activityId = null;
        }
      }
    }

    if (!activityId) {
      const created = await request('POST', `/api/evaluation/apprentissage/${g.establishmentId}/activites/groupe/${g.groupMatterId}`, token, activityPayload(a, competence.code, null));
      activityId = findUuid(created);
      if (!activityId) throw new Error('Mozaïk a créé l’activité, mais son identifiant n’a pas pu être lu. Vérifie Mozaïk avant de réessayer.');
      const plan = await request('GET', `/api/evaluation/planifications/${g.establishmentId}/groupes/${g.groupCourseId}`, token);
      const planned = Array.isArray(plan?.activites) ? plan.activites : [];
      const ids = planned.map(x => typeof x === 'string' ? x : x?.id).filter(Boolean);
      if (!ids.includes(activityId)) ids.push(activityId);
      await request('PUT', `/api/evaluation/planifications/${g.establishmentId}/groupes/${g.groupCourseId}`, token, {
        idListeCategoriesPonderation: plan?.idListeCategoriesPonderation ?? null,
        activites: ids.map(id => ({ id }))
      });
    } else {
      if (!existing) {
        activityList = activityList || await request('GET', `/api/evaluation/apprentissage/${g.establishmentId}/activites/groupe/${g.groupCourseId}`, token);
        const arr = Array.isArray(activityList) ? activityList : (activityList?.activites || []);
        existing = arr.find(x => x?.id === activityId || x?.idActivite === activityId);
      }
      if (!existing) throw new Error('Impossible de retrouver l’activité Mozaïk associée.');
      await request('PUT', `/api/evaluation/apprentissage/${g.establishmentId}/activites/groupe/${g.groupMatterId}/${activityId}`, token, activityPayload(a, competence.code, existing));
    }

    const resultPath = `/api/evaluation/resultats/${g.establishmentId}/activites/groupe/${g.groupMatterId}/${activityId}`;
    const commaPayload = { eleves: matched.map(x => ({ fiche: x.fiche, resultat: gradeString(x.grade, 'comma') })) };
    try {
      await request('PUT', resultPath, token, commaPayload);
    } catch (firstError) {
      if (firstError?.status !== 400) throw firstError;
      const dotPayload = { eleves: matched.map(x => ({ fiche: x.fiche, resultat: gradeString(x.grade, 'dot') })) };
      try {
        await request('PUT', resultPath, token, dotPayload);
      } catch (secondError) {
        const precise = matched.filter(x => {
          const s = String(x.grade);
          return s.includes('.') && s.split('.')[1].replace(/0+$/, '').length > 1;
        }).length;
        if (secondError?.status === 400 && precise) {
          throw new Error(`Mozaïk refuse le lot de notes. ${precise} note${precise === 1 ? ' comporte' : 's comportent'} plus d’une décimale. Ramène-les à une décimale puis réessaie.`);
        }
        throw secondError;
      }
    }

    return {
      success: true,
      activityId,
      competenceCode: String(competence.code),
      competenceLabel: competence.label,
      syncedCount: matched.length,
      message: 'Synchronisation réussie'
    };
  } catch (error) {
    return {
      success: false,
      activityId: '',
      competenceCode: '',
      competenceLabel: '',
      syncedCount: 0,
      message: error?.message || String(error)
    };
  }
}

// ===== background-v081.js =====
let extensionOpenedTabId = null;

async function ensureSyncUi(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['mozaik.js'] });
  } catch {}
}

async function sendSyncUi(tabId, data) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'CARDINAL_MOZAIK_SYNC_UI', ...data });
  } catch {
    await ensureSyncUi(tabId);
    await sleep(120);
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'CARDINAL_MOZAIK_SYNC_UI', ...data });
    } catch {}
  }
}

function roundedPayload(payload) {
  return {
    ...payload,
    results: (payload.results || []).map(r => ({
      ...r,
      grade: Number.isFinite(Number(r.grade))
        ? Math.round((Number(r.grade) + Number.EPSILON) * 10) / 10
        : r.grade
    }))
  };
}

function academicYearStart() {
  const d = new Date();
  return d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear();
}

function currentizePortalId(raw, establishmentId) {
  const s = String(raw || '');
  const e = String(establishmentId || '');
  if (!s || !e) return s;
  return s.replace(new RegExp('^' + e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\d{4}'), e + academicYearStart());
}

async function focusTab(tab) {
  if (!tab?.id) return;
  try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
  try { await chrome.tabs.update(tab.id, { active: true }); } catch {}
}

async function mozaikTabs() {
  const tabs = await chrome.tabs.query({ url: MOZAIK_URL });
  return [...tabs].sort((a, b) => {
    if (!!a.active !== !!b.active) return a.active ? -1 : 1;
    return Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
  });
}


// ===== Mozaïk auth fast path v1.1.5 =====
const MOZAIK_BEARER_SESSION_KEY_V115 = 'cardinal_mozaik_bearer_v115';
const MOZAIK_BEARER_TTL_MS_V115 = 20 * 60 * 1000;
const mozaikBearerByTabV115 = new Map();

function normalizeBearerV115(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return (m ? m[1] : raw).trim();
}

async function rememberMozaikBearerV115(tabId, token) {
  token = normalizeBearerV115(token);
  if (!(tabId >= 0) || token.length < 40) return;
  const row = { token, capturedAt: Date.now() };
  mozaikBearerByTabV115.set(tabId, row);
  try {
    const saved = await chrome.storage.session.get(MOZAIK_BEARER_SESSION_KEY_V115);
    const all = saved?.[MOZAIK_BEARER_SESSION_KEY_V115] && typeof saved[MOZAIK_BEARER_SESSION_KEY_V115] === 'object'
      ? { ...saved[MOZAIK_BEARER_SESSION_KEY_V115] }
      : {};
    all[String(tabId)] = row;
    await chrome.storage.session.set({ [MOZAIK_BEARER_SESSION_KEY_V115]: all });
  } catch {}
}

async function restoreMozaikBearerV115(tabId) {
  const live = mozaikBearerByTabV115.get(tabId);
  if (live?.token && Date.now() - Number(live.capturedAt || 0) < MOZAIK_BEARER_TTL_MS_V115) return live.token;
  try {
    const saved = await chrome.storage.session.get(MOZAIK_BEARER_SESSION_KEY_V115);
    const row = saved?.[MOZAIK_BEARER_SESSION_KEY_V115]?.[String(tabId)];
    if (!row?.token || Date.now() - Number(row.capturedAt || 0) >= MOZAIK_BEARER_TTL_MS_V115) return '';
    mozaikBearerByTabV115.set(tabId, { token: String(row.token), capturedAt: Number(row.capturedAt || 0) });
    return String(row.token);
  } catch { return ''; }
}

async function forgetMozaikBearerV115(tabId) {
  mozaikBearerByTabV115.delete(tabId);
  try {
    const saved = await chrome.storage.session.get(MOZAIK_BEARER_SESSION_KEY_V115);
    const all = saved?.[MOZAIK_BEARER_SESSION_KEY_V115] && typeof saved[MOZAIK_BEARER_SESSION_KEY_V115] === 'object'
      ? { ...saved[MOZAIK_BEARER_SESSION_KEY_V115] }
      : {};
    delete all[String(tabId)];
    await chrome.storage.session.set({ [MOZAIK_BEARER_SESSION_KEY_V115]: all });
  } catch {}
}

try {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    details => {
      if (details.tabId < 0) return;
      const auth = (details.requestHeaders || []).find(h => String(h.name || '').toLowerCase() === 'authorization')?.value || '';
      const token = normalizeBearerV115(auth);
      if (token.length >= 40) rememberMozaikBearerV115(details.tabId, token).catch(() => {});
    },
    { urls: ['https://apiaffaires.mozaikportail.ca/*'] },
    ['requestHeaders', 'extraHeaders']
  );
} catch {}

chrome.tabs.onRemoved.addListener(tabId => { forgetMozaikBearerV115(tabId).catch(() => {}); });

async function pageMozaikBearerV115(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const root = window.authentification;
        if (!root || typeof root !== 'object') return '';
        const seen = new WeakSet();
        const stack = [root];
        let steps = 0;
        while (stack.length && steps++ < 3500) {
          const o = stack.pop();
          if (!o || typeof o !== 'object' || seen.has(o)) continue;
          seen.add(o);
          try {
            if (typeof o.AccessToken === 'string' && o.AccessToken.length > 40) return o.AccessToken;
          } catch {}
          let vals = [];
          try { vals = Object.values(o); } catch {}
          for (const v of vals) if (v && typeof v === 'object') stack.push(v);
        }
        return '';
      }
    });
    return normalizeBearerV115(result);
  } catch { return ''; }
}

async function validateMozaikBearerV115(token) {
  token = normalizeBearerV115(token);
  if (!token) return false;
  try {
    const response = await fetch('https://apiaffaires.mozaikportail.ca/api/individu/moi/identification', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json, text/plain, */*',
        'Encode-Response': 'false'
      }
    });
    return response.ok;
  } catch { return false; }
}

async function findUsableMozaikBearerV115(tabId, timeout = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    let token = await restoreMozaikBearerV115(tabId);
    if (token && await validateMozaikBearerV115(token)) return token;
    if (token) await forgetMozaikBearerV115(tabId);

    token = await pageMozaikBearerV115(tabId);
    if (token && await validateMozaikBearerV115(token)) {
      await rememberMozaikBearerV115(tabId, token);
      return token;
    }
    await sleep(180);
  }
  return '';
}

async function resolveMozaikBearerV115(tabId) {
  let token = await findUsableMozaikBearerV115(tabId, 1800);
  if (token) return token;

  await sendSyncUi(tabId, {
    status: 'working',
    progress: 18,
    title: 'Synchronisation en cours',
    message: 'Actualisation rapide de la connexion Mozaïk…',
    indeterminate: true
  });

  // After an extension update, an already-open Mozaïk tab may not have emitted
  // any request that Cardinal could observe. One reload forces Mozaïk to emit its
  // authenticated API requests so the bearer can be captured safely.
  try {
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId, 20000);
    const tab = await chrome.tabs.get(tabId);
    await focusTab(tab);
    await ensureSyncUi(tabId);
    await sendSyncUi(tabId, {
      status: 'working',
      progress: 22,
      title: 'Synchronisation en cours',
      message: 'Connexion Mozaïk détectée. Préparation du travail…',
      indeterminate: true
    });
  } catch {}

  token = await findUsableMozaikBearerV115(tabId, 8000);
  if (token) return token;
  throw new Error('Cardinal n’a pas pu récupérer la session Mozaïk. Le portail est ouvert, mais son jeton de connexion n’a pas été détecté après l’actualisation.');
}

async function focusOrOpenMozaik({ waitComplete = false } = {}) {
  const tabs = await mozaikTabs();
  let tab = tabs[0];

  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: MOZAIK_HOME, active: true });
    if (!tab?.id) throw new Error('Impossible d’ouvrir Mozaïk.');
    extensionOpenedTabId = tab.id;
  } else {
    // v1.1.4: a Mozaïk sync must always bring the portal to the foreground.
    // The teacher needs to see the progress UI and any authentication/error state.
    await focusTab(tab);
  }

  if (waitComplete && tab.status !== 'complete') {
    try { await waitForTabComplete(tab.id, 45000); } catch {}
    try { tab = await chrome.tabs.get(tab.id); } catch {}
  }

  if (tab?.id) {
    await focusTab(tab);
    if (tab.status === 'complete') await ensureSyncUi(tab.id);
  }
  return tab;
}

async function hasMozaikToken(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const root = window.authentification;
        if (!root || typeof root !== 'object') return false;
        const seen = new WeakSet();
        const stack = [root];
        let steps = 0;
        while (stack.length && steps++ < 3000) {
          const o = stack.pop();
          if (!o || typeof o !== 'object' || seen.has(o)) continue;
          seen.add(o);
          try {
            if (typeof o.AccessToken === 'string' && o.AccessToken.length > 40) return true;
          } catch {}
          let vals = [];
          try { vals = Object.values(o); } catch {}
          for (const v of vals) if (v && typeof v === 'object') stack.push(v);
        }
        return false;
      }
    });
    return result === true;
  } catch {
    return false;
  }
}

async function waitForAuthenticatedMozaikTab(initialTabId, timeout = 180000) {
  const started = Date.now();
  let lastShownTabId = null;
  const stable = new Map();

  while (Date.now() - started < timeout) {
    const tabs = await mozaikTabs();

    for (const tab of tabs) {
      if (!tab?.id || tab.status !== 'complete') continue;
      const tokenOk = await hasMozaikToken(tab.id);
      if (!tokenOk) {
        stable.delete(tab.id);
        continue;
      }

      const url = String(tab.url || '');
      const now = Date.now();
      const prior = stable.get(tab.id);
      if (!prior || prior.url !== url) {
        stable.set(tab.id, { url, since: now, checks: 1 });
        continue;
      }
      prior.checks += 1;

      // Mozaïk often exposes the bearer a little before its SPA is actually ready.
      // Require a stable completed page for ~1.5 s, then add a short buffer.
      if (now - prior.since < 1500 || prior.checks < 3) continue;

      await focusTab(tab);
      await ensureSyncUi(tab.id);
      await sendSyncUi(tab.id, {
        status: 'working',
        progress: 24,
        title: 'Connexion détectée',
        message: 'Mozaïk est connecté. Je laisse le portail terminer son chargement puis la synchronisation reprend automatiquement…',
        indeterminate: true
      });
      await sleep(1400);

      if (extensionOpenedTabId && extensionOpenedTabId !== tab.id) {
        try {
          const old = await chrome.tabs.get(extensionOpenedTabId);
          if (old?.url?.startsWith('https://mozaikportail.ca/')) await chrome.tabs.remove(extensionOpenedTabId);
        } catch {}
        extensionOpenedTabId = null;
      }
      return tab;
    }

    const candidate = tabs.find(t => t?.id && t.status === 'complete') || tabs[0];
    if (candidate?.id && candidate.id !== lastShownTabId) {
      lastShownTabId = candidate.id;
      await focusTab(candidate);
      await ensureSyncUi(candidate.id);
      await sendSyncUi(candidate.id, {
        status: 'working',
        progress: 14,
        title: 'Connexion requise',
        message: 'Connecte-toi à Mozaïk. Cardinal attendra la fin complète de la connexion et reprendra tout seul.',
        indeterminate: true
      });
    }

    await sleep(500);
  }

  throw new Error('La connexion à Mozaïk a expiré. Connecte-toi au portail puis réessaie.');
}

async function extractOfficialRoster(group) {
  try {
    const API = 'https://apiaffaires.mozaikportail.ca';
    function norm(s){return String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
    function strings(o,d=0,out=[]){if(d>4||o==null)return out;if(typeof o==='string'){out.push(o);return out}if(typeof o!=='object')return out;for(const v of Object.values(o)){if(typeof v==='string')out.push(v);else if(v&&typeof v==='object')strings(v,d+1,out)}return out}
    function findField(o,names,d=0,seen=new WeakSet()){if(!o||typeof o!=='object'||d>5||seen.has(o))return null;seen.add(o);for(const[k,v]of Object.entries(o)){const nk=norm(k).replace(/ /g,'');if(names.includes(nk)&&v!=null&&typeof v!=='object')return v}for(const v of Object.values(o)){const r=findField(v,names,d+1,seen);if(r!=null)return r}return null}
    function findToken(){const root=window.authentification;if(!root)return null;const seen=new WeakSet(),stack=[root];let steps=0;while(stack.length&&steps++<3000){const o=stack.pop();if(!o||typeof o!=='object'||seen.has(o))continue;seen.add(o);try{if(typeof o.AccessToken==='string'&&o.AccessToken.length>40)return o.AccessToken}catch{}let vals=[];try{vals=Object.values(o)}catch{}for(const v of vals)if(v&&typeof v==='object')stack.push(v)}return null}
    const token=findToken();if(!token)return[];
    const groupMatterId = String(group.groupMatterId || '');
    const response=await fetch(`${API}/api/organisationscolaire/groupes/${group.establishmentId}/${groupMatterId}/membres`,{
      headers:{Authorization:'Bearer '+token,Accept:'application/json, text/plain, */*','Encode-Response':'false'}
    });
    if(!response.ok)return[];
    const data=await response.json();
    const members=Array.isArray(data)?data:(data?.membres||[]);
    return members.map(m=>{
      const email=strings(m).map(x=>String(x).trim().toLowerCase()).find(x=>x.endsWith('@educ.cscapitale.qc.ca'))||'';
      const firstName=String(findField(m,['prenom','firstname','first'])||'').trim();
      const lastName=String(findField(m,['nom','lastname','last','nomfamille'])||'').trim();
      return{email,firstName,lastName};
    }).filter(x=>x.email&&x.firstName&&x.lastName);
  } catch { return []; }
}

async function navigateToActivity(tabId, meta) {
  const establishmentId = String(meta.establishmentId || '');
  const groupCourseId = String(meta.groupCourseId || '');
  const activityId = String(meta.activityId || '');
  const activityTitle = String(meta.activityTitle || '');

  if (!establishmentId || !groupCourseId) return false;

  const groupHome = `https://mozaikportail.ca/${establishmentId}/groupes/${groupCourseId}/eleves/liste`;
  try {
    const current = await chrome.tabs.get(tabId);
    if (!String(current.url || '').includes(`/groupes/${groupCourseId}/`)) {
      await chrome.tabs.update(tabId, { url: groupHome, active: true });
      await waitForTabComplete(tabId, 45000);
      await sleep(900);
    }
  } catch {
    return false;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (activityId, activityTitle) => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const norm = s => String(s || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim();

        const visible = el => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
        };

        const click = el => {
          if (!el) return false;
          try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
          try { el.click(); } catch {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          }
          return true;
        };

        function clickables() {
          return [...document.querySelectorAll('a[href],button,[role="button"],[role="link"]')].filter(visible);
        }

        function activityElement() {
          const els = clickables();
          if (activityId) {
            const byId = els.find(el => String(el.getAttribute('href') || '').includes(activityId));
            if (byId) return byId;
          }
          const wanted = norm(activityTitle);
          if (!wanted) return null;
          return els.find(el => norm(el.textContent) === wanted)
            || els.find(el => {
              const t = norm(el.textContent);
              return t && (t.includes(wanted) || wanted.includes(t)) && t.length < wanted.length + 90;
            })
            || null;
        }

        function evaluationLink() {
          const els = clickables();
          return els.find(el => {
            const href = String(el.getAttribute('href') || '').toLowerCase();
            return href.includes('/evaluation') || href.includes('/evaluations');
          }) || els.find(el => {
            const text = norm(el.textContent);
            const aria = norm(el.getAttribute('aria-label'));
            const title = norm(el.getAttribute('title'));
            return [text, aria, title].some(v => v === 'evaluation' || v === 'evaluations' || v.includes('evaluation'));
          }) || null;
        }

        function activitiesLink() {
          const els = clickables();
          return els.find(el => {
            const href = String(el.getAttribute('href') || '').toLowerCase();
            return href.includes('activit');
          }) || els.find(el => {
            const text = norm(el.textContent);
            const aria = norm(el.getAttribute('aria-label'));
            const title = norm(el.getAttribute('title'));
            return [text, aria, title].some(v => v.includes('activite') || v.includes('resultat'));
          }) || null;
        }

        async function waitFor(fn, timeout = 7000) {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            const value = fn();
            if (value) return value;
            await wait(250);
          }
          return null;
        }

        let target = activityElement();
        if (target) {
          click(target);
          return { ok: true, stage: 'direct' };
        }

        const evalLink = evaluationLink();
        if (evalLink) {
          click(evalLink);
          await wait(1000);
        }

        target = await waitFor(activityElement, 2500);
        if (target) {
          click(target);
          return { ok: true, stage: 'evaluation' };
        }

        const actLink = activitiesLink();
        if (actLink) {
          click(actLink);
          await wait(1100);
        }

        target = await waitFor(activityElement, 8000);
        if (target) {
          click(target);
          return { ok: true, stage: 'activities' };
        }

        // Last pass: after SPA navigation, scan again for any evaluation/activities link that appeared later.
        const lateEval = evaluationLink();
        if (lateEval) {
          click(lateEval);
          await wait(900);
          const lateAct = activitiesLink();
          if (lateAct) {
            click(lateAct);
            await wait(900);
          }
          target = await waitFor(activityElement, 6000);
          if (target) {
            click(target);
            return { ok: true, stage: 'late' };
          }
        }

        return { ok: false };
      },
      args: [activityId, activityTitle]
    });
    return !!result?.ok;
  } catch {
    return false;
  }
}

let cardinalLastMozaikSyncTabIdV116 = null;

async function cardinalFindMozaikSyncTabV116() {
  if (cardinalLastMozaikSyncTabIdV116) {
    try {
      const tab = await chrome.tabs.get(cardinalLastMozaikSyncTabIdV116);
      if (/^https:\/\/mozaikportail\.ca\//i.test(String(tab?.url || ''))) return tab;
    } catch {}
    cardinalLastMozaikSyncTabIdV116 = null;
  }
  const tabs = await mozaikTabs();
  const active = tabs.find(t => t.active) || tabs[0] || null;
  if (active?.id) cardinalLastMozaikSyncTabIdV116 = active.id;
  return active;
}

async function cardinalShowMozaikUiFastV116(tab, data) {
  if (!tab?.id) return false;
  cardinalLastMozaikSyncTabIdV116 = tab.id;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await ensureSyncUi(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type:'CARDINAL_MOZAIK_SYNC_UI', ...data });
      return true;
    } catch {}
    await sleep(150);
  }
  return false;
}

handleSync = async function(payload) {
  if (!payload?.assignment || !payload?.group || !Array.isArray(payload?.results)) {
    throw new Error('Le lot de synchronisation est incomplet.');
  }

  const normalized = roundedPayload(payload);
  normalized.group = { ...normalized.group };

  let tab = await focusOrOpenMozaik({ waitComplete: false });
  if (!tab?.id) throw new Error('Impossible d’ouvrir Mozaïk.');
  cardinalLastMozaikSyncTabIdV116 = tab.id;
  await focusTab(tab);

  await cardinalShowMozaikUiFastV116(tab, {
    status: 'working',
    progress: 10,
    title: 'Synchronisation en cours',
    message: 'Connexion à Mozaïk…',
    indeterminate: true
  });

  const token = await resolveMozaikBearerV115(tab.id);
  try { tab = await chrome.tabs.get(tab.id); } catch {}

  await sendSyncUi(tab.id, {
    status: 'working',
    progress: 38,
    title: 'Synchronisation en cours',
    message: 'Préparation du travail et des notes…',
    indeterminate: true
  });

  let result;
  try {
    const executed = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: syncInsideMozaik,
      args: [normalized, token]
    });
    result = executed?.[0]?.result;
    if (!result || typeof result !== 'object') {
      throw new Error('Mozaïk n’a retourné aucun résultat exploitable.');
    }
  } catch (error) {
    result = { success: false, message: error?.message || String(error), syncedCount: 0 };
  }

  await sendSyncUi(tab.id, {
    status: 'working',
    progress: 86,
    title: 'Synchronisation en cours',
    message: 'Vérification finale…'
  });

  let roster = [];
  try {
    const rr = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: extractOfficialRoster,
        args: [normalized.group]
      }),
      sleep(3000).then(() => [])
    ]);
    roster = Array.isArray(rr?.[0]?.result) ? rr[0].result : [];
  } catch {}

  if (result.success) {
    const expectedCount = Array.isArray(normalized.results) ? normalized.results.length : 0;
    const syncedCount = Number(result.syncedCount || 0);
    if (!String(result.activityId || '').trim()) {
      result = { success:false, syncedCount:0, message:'Mozaïk a répondu succès sans identifiant d’activité. La synchronisation n’est pas confirmée.' };
    } else if (syncedCount !== expectedCount) {
      result = { success:false, syncedCount, message:`Mozaïk a confirmé ${syncedCount} note${syncedCount===1?'':'s'}, mais le lot en contient ${expectedCount}. La synchronisation n’est pas confirmée.` };
    }
  }

  if (result.success) {
    await sendSyncUi(tab.id, {
      status: 'success',
      progress: 100,
      title: 'Synchronisation terminée',
      message: `${result.syncedCount || 0} note${Number(result.syncedCount||0)===1?'':'s'} envoyée${Number(result.syncedCount||0)===1?'':'s'} avec succès.`,
      closable: true,
      canOpenActivity: true,
      activityId: result.activityId || '',
      activityTitle: normalized.assignment?.title || '',
      establishmentId: normalized.group?.establishmentId || '',
      groupCourseId: normalized.group?.groupCourseId || ''
    });
  } else {
    await sendSyncUi(tab.id, {
      status: 'error',
      progress: 100,
      title: 'Échec de la synchronisation',
      message: result.message || 'La synchronisation a échoué.',
      closable: true
    });
  }

  return { ...result, roster };
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SHOW_MOZAIK_SYNC_UI') {
    (async () => {
      try {
        const tab = await focusOrOpenMozaik({ waitComplete: false });
        if (tab?.id) {
          cardinalLastMozaikSyncTabIdV116 = tab.id;
          await focusTab(tab);
          await cardinalShowMozaikUiFastV116(tab, {
            status: 'working',
            progress: 5,
            title: 'Synchronisation en cours',
            message: 'Gestion des notes prépare le lot…',
            indeterminate: true
          });
        }
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, message: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message?.type === 'UPDATE_MOZAIK_SYNC_UI') {
    (async () => {
      try {
        const tab = await cardinalFindMozaikSyncTabV116();
        if (!tab?.id) {
          sendResponse({ ok:false, message:'Aucun onglet Mozaïk ouvert.' });
          return;
        }
        await cardinalShowMozaikUiFastV116(tab, message.payload || {});
        sendResponse({ ok:true });
      } catch (error) {
        sendResponse({ ok:false, message:error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message?.type === 'CARDINAL_REINJECT_MOZAIK_UI' && sender.tab?.id) {
    ensureSyncUi(sender.tab.id).catch(() => {});
    return;
  }

  if (message?.type === 'CLOSE_MOZAIK_TAB' && sender.tab?.id) {
    chrome.tabs.remove(sender.tab.id).catch(() => {});
    return;
  }

  if (message?.type === 'OPEN_MOZAIK_ACTIVITY' && sender.tab?.id) {
    const tabId = sender.tab.id;
    (async () => {
      try {
        await chrome.windows.update(sender.tab.windowId, { focused: true });
        await chrome.tabs.update(tabId, { active: true });
      } catch {}

      const ok = await navigateToActivity(tabId, message);
      if (!ok) {
        await sendSyncUi(tabId, {
          status: 'error',
          progress: 100,
          title: 'Travail introuvable',
          message: 'La synchronisation est réussie, mais Mozaïk n’a pas exposé le lien du travail dans cette vue.',
          closable: true
        });
      }
    })();
  }
});

// ---- Formative connector v0.8 ------------------------------------------------
const FORMATIVE_RESULTS_URL = 'https://app.formative.com/formatives/*/results*';
const GESTION_URL = 'https://techno-cardi.github.io/Exercices-francais/resultats/*';
const formativeHeadersByTab = new Map();
const FORMATIVE_HEADER_SESSION_KEY_V1000 = 'cardinal_formative_headers_session_v1000';
const FORMATIVE_HEADER_TTL_MS_V1000 = 2 * 60 * 60 * 1000;
const formativeHeaderPersistSignatureV1000 = new Map();

function rememberFormativeHeadersV1000(tabId, headers) {
  if (!(tabId >= 0) || !headers || typeof headers !== 'object') return;
  const auth = String(headers.authorization || '');
  if (!auth) return;
  const signature = JSON.stringify([
    auth,
    String(headers['x-user-id'] || ''),
    String(headers['x-session-id'] || ''),
    String(headers['x-tab-id'] || ''),
    String(headers['x-app-version'] || '')
  ]);
  if (formativeHeaderPersistSignatureV1000.get(tabId) === signature) return;
  formativeHeaderPersistSignatureV1000.set(tabId, signature);
  chrome.storage.session.get(FORMATIVE_HEADER_SESSION_KEY_V1000).then(data => {
    const all = data?.[FORMATIVE_HEADER_SESSION_KEY_V1000] && typeof data[FORMATIVE_HEADER_SESSION_KEY_V1000] === 'object'
      ? { ...data[FORMATIVE_HEADER_SESSION_KEY_V1000] }
      : {};
    all[String(tabId)] = { headers:{ ...headers }, capturedAt:Date.now() };
    return chrome.storage.session.set({ [FORMATIVE_HEADER_SESSION_KEY_V1000]:all });
  }).catch(() => {});
}

async function restoreFormativeHeadersV1000(tabId) {
  if (!(tabId >= 0)) return {};
  const live = formativeHeadersByTab.get(tabId) || {};
  if (typeof live.authorization === 'string' && live.authorization.length > 20) return live;
  try {
    const data = await chrome.storage.session.get(FORMATIVE_HEADER_SESSION_KEY_V1000);
    const row = data?.[FORMATIVE_HEADER_SESSION_KEY_V1000]?.[String(tabId)];
    if (!row?.headers || Date.now() - Number(row.capturedAt || 0) > FORMATIVE_HEADER_TTL_MS_V1000) return live;
    const restored = { ...row.headers };
    formativeHeadersByTab.set(tabId, restored);
    return restored;
  } catch { return live; }
}

async function forgetFormativeHeadersV1000(tabId) {
  formativeHeadersByTab.delete(tabId);
  formativeHeaderPersistSignatureV1000.delete(tabId);
  try {
    const data = await chrome.storage.session.get(FORMATIVE_HEADER_SESSION_KEY_V1000);
    const all = data?.[FORMATIVE_HEADER_SESSION_KEY_V1000] && typeof data[FORMATIVE_HEADER_SESSION_KEY_V1000] === 'object'
      ? { ...data[FORMATIVE_HEADER_SESSION_KEY_V1000] }
      : {};
    delete all[String(tabId)];
    await chrome.storage.session.set({ [FORMATIVE_HEADER_SESSION_KEY_V1000]:all });
  } catch {}
}

chrome.tabs.onRemoved.addListener(tabId => { forgetFormativeHeadersV1000(tabId).catch(() => {}); });

try {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    details => {
      if (details.tabId < 0 || !/^https:\/\/svc\.goformative\.com\/graphql(?:[/?]|$)/.test(details.url)) return;
      const allow = new Set(['authorization','x-user-id','x-session-id','x-tab-id','x-app-version','x-anonymous-id']);
      const headers = {};
      for (const h of details.requestHeaders || []) {
        const key = String(h.name || '').toLowerCase();
        if (allow.has(key) && h.value) headers[key] = h.value;
      }
      if (Object.keys(headers).length) { const prev = formativeHeadersByTab.get(details.tabId) || {}; const merged = { ...prev, ...headers }; formativeHeadersByTab.set(details.tabId, merged); rememberFormativeHeadersV1000(details.tabId, merged); }
    },
    { urls: ['https://svc.goformative.com/*'] },
    ['requestHeaders', 'extraHeaders']
  );
} catch {}

function sleepFormative(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ensureFormativeUi(tabId) {
  if (!tabId) return;
  try { await chrome.tabs.sendMessage(tabId, { type:'CARDINAL_FORMATIVE_UI', title:'Formative', message:'', status:'working' }); }
  catch {
    try { await chrome.scripting.executeScript({ target:{ tabId }, files:['formative.js'] }); } catch {}
  }
}

async function sendFormativeUi(tabId, data) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type:'CARDINAL_FORMATIVE_UI', ...data });
  } catch {
    await ensureFormativeUi(tabId);
    await sleepFormative(120);
    try { await chrome.tabs.sendMessage(tabId, { type:'CARDINAL_FORMATIVE_UI', ...data }); } catch {}
  }
}

async function ensureFormativeSession(tab, formativeId = '') {
  if (!tab?.id) throw new Error('Onglet Formative introuvable.');
  await focusTab(tab);
  await ensureFormativeUi(tab.id);
  await restoreFormativeHeadersV1000(tab.id);
  if (formativeHeadersByTab.get(tab.id)?.authorization) return tab;

  await sendFormativeUi(tab.id, {
    title:'Préparation de Formative',
    message:'Je recharge la page une fois pour détecter ta session et lire les résultats…',
    status:'working'
  });

  try {
    await chrome.tabs.reload(tab.id);
    await waitForTabComplete(tab.id, 45000);
  } catch {}

  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (formativeHeadersByTab.get(tab.id)?.authorization) {
      try { tab = await chrome.tabs.get(tab.id); } catch {}
      await ensureFormativeUi(tab.id);
      await sendFormativeUi(tab.id, {
        title:'Session Formative détectée',
        message:'Je récupère maintenant le travail, les élèves et les notes…',
        status:'working'
      });
      return tab;
    }
    await sleepFormative(250);
  }

  throw new Error('Je n’ai pas réussi à détecter ta session Formative. Recharge la page Réponses, attends que les élèves apparaissent, puis réessaie.');
}

async function formativeTabs(formativeId = '') {
  const tabs = await chrome.tabs.query({ url: 'https://app.formative.com/formatives/*/results*' });
  const sorted = [...tabs].sort((a,b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
  if (!formativeId) return sorted;
  const exact = sorted.filter(t => String(t.url || '').includes(`/formatives/${formativeId}/results`));
  return exact.length ? exact : sorted;
}

async function focusOrOpenFormative(formativeId = '') {
  let tabs = await formativeTabs(formativeId);
  let tab = tabs[0];
  if (!tab?.id) {
    if (!formativeId) throw new Error('Ouvre d’abord un travail Formative dans l’onglet Réponses.');
    tab = await chrome.tabs.create({ url: `https://app.formative.com/formatives/${formativeId}/results`, active: true });
    if (!tab?.id) throw new Error('Impossible d’ouvrir Formative.');
  } else {
    await focusTab(tab);
  }
  if (tab.status !== 'complete') {
    try { await waitForTabComplete(tab.id, 45000); } catch {}
    try { tab = await chrome.tabs.get(tab.id); } catch {}
  }
  return tab;
}

async function waitForFormativeTab(formativeId = '', timeout = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const tabs = await formativeTabs(formativeId);
    for (const tab of tabs) {
      if (!tab?.id || tab.status !== 'complete') continue;
      if (formativeHeadersByTab.get(tab.id)?.authorization) return tab;
    }
    if (tabs[0]?.id) await focusTab(tabs[0]);
    await sleepFormative(500);
  }
  throw new Error('La connexion à Formative n’a pas été détectée. Connecte-toi à Formative puis réessaie.');
}

async function formativeSnapshotInsidePage(formativeId, trackedHeaders) {
  const API = 'https://svc.goformative.com/graphql';
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/graphql-response+json,application/json;q=0.9',
    ...(trackedHeaders || {})
  };
  async function gql(kind, name, variables, query) {
    const r = await fetch(`${API}/${kind}/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ operationName: name, variables, extensions: { clientLibrary: { name: '@apollo/client', version: '4.2.7' } }, query })
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!r.ok || data?.errors?.length) {
      const msg = data?.errors?.[0]?.message || text || `HTTP ${r.status}`;
      throw new Error(`${name}: ${msg}`);
    }
    return data?.data || {};
  }
  function plainText(value) {
    if (!value) return '';
    try {
      const root = typeof value === 'string' ? JSON.parse(value) : value;
      const out = [];
      const walk = o => {
        if (!o) return;
        if (typeof o === 'string') { out.push(o); return; }
        if (Array.isArray(o)) { o.forEach(walk); return; }
        if (typeof o === 'object') {
          if (typeof o.text === 'string') out.push(o.text);
          if (Array.isArray(o.content)) o.content.forEach(walk);
        }
      };
      walk(root);
      return out.join(' ').replace(/\s+/g,' ').trim();
    } catch { return String(value).replace(/\s+/g,' ').trim(); }
  }

  const resultsQuery = `query Results($formativeId: ID!) {
    formative(id: $formativeId) {
      _id title
      assignments: teacherAssignments {
        _id
        section { _id title studentCount }
      }
      items {
        _id questionNumber type subtype text
        details { points }
      }
    }
  }`;
  const rd = await gql('query','Results',{ formativeId },resultsQuery);
  const f = rd?.formative;
  if (!f?._id) throw new Error('Formative introuvable ou session expirée.');
  const assignment = (f.assignments || []).find(a => a?.section?._id) || f.assignments?.[0];
  if (!assignment?._id || !assignment?.section?._id) throw new Error('Aucune classe assignée n’a été trouvée pour ce Formative.');
  const sectionId = assignment.section._id;
  const assignmentId = assignment._id;

  const studentsQuery = `query ResultsSummarySection($sectionId: ID!, $assignmentId: ID!, $formativeId: ID!, $archivedEnrollments: Boolean) {
    students: users(sections: [$sectionId], assignments: [$assignmentId], archivedEnrollments: $archivedEnrollments) {
      nodes {
        _id emails { address } firstName lastName
        answers(formativeId: $formativeId, latestSubmissionOnly: true) {
          nodes { _id points possiblePoints gradedAt formativeItem { _id } }
        }
      }
    }
  }`;
  let studentNodes = [];
  try {
    const sd = await gql('query','ResultsSummarySection',{ sectionId, assignmentId, formativeId, archivedEnrollments:false },studentsQuery);
    studentNodes = sd?.students?.nodes || [];
  } catch {
    const listQuery = `query ResultsSummarySection($sectionId: ID!, $assignmentId: ID!, $archivedEnrollments: Boolean) {
      students: users(sections: [$sectionId], assignments: [$assignmentId], archivedEnrollments: $archivedEnrollments) {
        nodes { _id emails { address } firstName lastName }
      }
    }`;
    const sd = await gql('query','ResultsSummarySection',{ sectionId, assignmentId, archivedEnrollments:false },listQuery);
    const basic = sd?.students?.nodes || [];
    const answerQuery = `query ResultsSummaryUserAnswers($userId: ID!, $formativeId: ID!, $latestSubmissionOnly: Boolean) {
      student: user(id: $userId) {
        _id
        answers(formativeId: $formativeId, latestSubmissionOnly: $latestSubmissionOnly) {
          nodes { _id points possiblePoints gradedAt formativeItem { _id } }
        }
      }
    }`;
    for (let i=0; i<basic.length; i+=6) {
      const batch = basic.slice(i,i+6);
      const answers = await Promise.all(batch.map(async s => {
        const x = await gql('query','ResultsSummaryUserAnswers',{ userId:s._id, formativeId, latestSubmissionOnly:true },answerQuery);
        return { ...s, answers: x?.student?.answers || { nodes: [] } };
      }));
      studentNodes.push(...answers);
    }
  }

  const questions = (f.items || [])
    .filter(x => x?.type === 'question')
    .map(x => ({
      id: String(x._id || ''),
      number: String(x.questionNumber || ''),
      label: plainText(x.text) || `Question ${x.questionNumber || ''}`.trim(),
      possiblePoints: Number(x?.details?.points || 0),
      gradedCount: 0
    }));
  const questionMap = new Map(questions.map(q => [q.id,q]));
  const students = studentNodes.map(s => {
    const answers = (s?.answers?.nodes || []).map(a => {
      const qid = String(a?.formativeItem?._id || '');
      if (a?.points !== null && a?.points !== undefined && Number.isFinite(Number(a.points)) && questionMap.has(qid)) questionMap.get(qid).gradedCount++;
      return {
        questionId: qid,
        answerId: String(a?._id || ''),
        points: a?.points === null || a?.points === undefined ? null : Number(a.points),
        possiblePoints: Number(a?.possiblePoints || 0),
        gradedAt: a?.gradedAt || null
      };
    });
    const email = (s?.emails || []).map(e => String(e?.address || '').trim().toLowerCase()).find(Boolean) || '';
    return { id:String(s?._id||''), email, firstName:String(s?.firstName||''), lastName:String(s?.lastName||''), answers };
  }).filter(s => s.email);

  const groupMatch = String(assignment.section.title || '').match(/(?:groupe|group)\s*([A-Za-z0-9][A-Za-z0-9-]{0,39})\b/i);
  return {
    id: String(f._id),
    formativeId: String(f._id),
    assignmentId: String(assignmentId),
    sectionId: String(sectionId),
    sectionTitle: String(assignment.section.title || ''),
    groupCode: groupMatch ? groupMatch[1] : '',
    title: String(f.title || 'Formative'),
    studentCount: Number(assignment.section.studentCount || students.length),
    questions,
    students
  };
}

async function readFormativeSnapshot(tabId, formativeId) {
  const tracked = formativeHeadersByTab.get(tabId) || {};
  await sendFormativeUi(tabId, {
    title:'Lecture de Formative',
    message:'Je récupère le travail, les questions, les élèves et leurs dernières notes…',
    status:'working'
  });
  let result;
  try {
    result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: formativeSnapshotInsidePage,
      args: [formativeId, tracked]
    });
  } catch (error) {
    throw new Error(`Lecture Formative impossible : ${error?.message || String(error)}`);
  }
  const first = result?.[0];
  if (first?.error) throw new Error(`Lecture Formative impossible : ${first.error?.message || first.error}`);
  const data = first?.result;
  if (!data?.formativeId) {
    const headerCount = Object.keys(tracked).length;
    throw new Error(`Formative n’a retourné aucune donnée exploitable${headerCount ? '' : ' et la session n’a pas été détectée'}.`);
  }
  return data;
}

async function formativeGradeInsidePage(formativeId, questionId, grades, trackedHeaders) {
  const API = 'https://svc.goformative.com/graphql';
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/graphql-response+json,application/json;q=0.9',
    ...(trackedHeaders || {})
  };
  async function gql(kind,name,variables,query) {
    const r = await fetch(`${API}/${kind}/${name}`, { method:'POST', headers, body:JSON.stringify({ operationName:name, variables, extensions:{clientLibrary:{name:'@apollo/client',version:'4.2.7'}}, query }) });
    const text = await r.text(); let data=null; try{data=JSON.parse(text)}catch{}
    if(!r.ok || data?.errors?.length) throw new Error(data?.errors?.[0]?.message || text || `HTTP ${r.status}`);
    return data?.data || {};
  }
  const resultQ = `query Results($formativeId: ID!) { formative(id:$formativeId){ _id assignments:teacherAssignments{_id section{_id title}} } }`;
  const rd = await gql('query','Results',{formativeId},resultQ);
  const f=rd?.formative; const assignment=(f?.assignments||[]).find(a=>a?.section?._id)||f?.assignments?.[0];
  if(!assignment?._id||!assignment?.section?._id) throw new Error('Classe Formative introuvable.');
  const sectionId=assignment.section._id, assignmentId=assignment._id;
  const listQ=`query ResultsSummarySection($sectionId: ID!, $assignmentId: ID!, $formativeId: ID!, $archivedEnrollments: Boolean) {
    students:users(sections:[$sectionId],assignments:[$assignmentId],archivedEnrollments:$archivedEnrollments){nodes{_id emails{address} answers(formativeId:$formativeId,latestSubmissionOnly:true){nodes{_id points possiblePoints formativeItem{_id}}}}}
  }`;
  let studentNodes=[];
  try {
    const sd=await gql('query','ResultsSummarySection',{sectionId,assignmentId,formativeId,archivedEnrollments:false},listQ);
    studentNodes=sd?.students?.nodes||[];
  } catch {
    const basicQ=`query ResultsSummarySection($sectionId: ID!, $assignmentId: ID!, $archivedEnrollments: Boolean) {
      students:users(sections:[$sectionId],assignments:[$assignmentId],archivedEnrollments:$archivedEnrollments){nodes{_id emails{address}}}
    }`;
    const sd=await gql('query','ResultsSummarySection',{sectionId,assignmentId,archivedEnrollments:false},basicQ);
    const basic=sd?.students?.nodes||[];
    const answerQ=`query ResultsSummaryUserAnswers($userId: ID!, $formativeId: ID!, $latestSubmissionOnly: Boolean) {
      student:user(id:$userId){_id answers(formativeId:$formativeId,latestSubmissionOnly:$latestSubmissionOnly){nodes{_id points possiblePoints formativeItem{_id}}}}
    }`;
    for(let i=0;i<basic.length;i+=6){
      const batch=basic.slice(i,i+6);
      const loaded=await Promise.all(batch.map(async st=>{
        const x=await gql('query','ResultsSummaryUserAnswers',{userId:st._id,formativeId,latestSubmissionOnly:true},answerQ);
        return {...st,answers:x?.student?.answers||{nodes:[]}};
      }));
      studentNodes.push(...loaded);
    }
  }
  const byEmail=new Map();
  for(const s of studentNodes){const email=(s.emails||[]).map(e=>String(e.address||'').trim().toLowerCase()).find(Boolean);if(email)byEmail.set(email,s)}
  const targets=[];
  for(const g of grades||[]){const email=String(g.email||'').trim().toLowerCase();const n=Number(g.grade);if(!email||!Number.isFinite(n))continue;const s=byEmail.get(email);const a=(s?.answers?.nodes||[]).find(x=>String(x?.formativeItem?._id||'')===String(questionId));if(!a?._id)continue;const max=Number(a.possiblePoints||0);if(!(max>0)||n<0||n>max)throw new Error(`Note invalide pour ${email}: ${n} / ${max}.`);targets.push({answerId:String(a._id),points:n,possiblePoints:max})}
  if(!targets.length)throw new Error('Aucune réponse Formative correspondante n’a été trouvée.');
  const groups=new Map();
  for(const t of targets){const key=`${t.points}|${t.possiblePoints}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t.answerId)}
  const mutation=`mutation ResultsSelectedItemSidebarGradeAnswers($answerIds: [ID!]!, $points: Float!, $scoreFactor: Float, $rubricLevels: [AnswerRubricLevelInput!]!) {
    teacherGradeAnswers(answerIds:$answerIds,points:$points,scoreFactor:$scoreFactor,rubricLevels:$rubricLevels){_id gradedAt points possiblePoints scoreFactor updatedAt}
  }`;
  let count=0;
  for(const [key,answerIds] of groups){const [p,m]=key.split('|').map(Number);await gql('mutation','ResultsSelectedItemSidebarGradeAnswers',{answerIds,points:p,scoreFactor:p/m,rubricLevels:[]},mutation);count+=answerIds.length}
  return { ok:true, updatedCount:count };
}

async function deliverFormativeImport(payload) {
  let tabs = await chrome.tabs.query({ url: GESTION_URL });
  let tab = [...tabs].sort((a,b)=>Number(b.lastAccessed||0)-Number(a.lastAccessed||0))[0];
  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: 'https://techno-cardi.github.io/Exercices-francais/resultats/?formativeImport=1', active: true });
    if (!tab?.id) throw new Error('Impossible d’ouvrir Gestion des notes.');
    try { await waitForTabComplete(tab.id, 45000); } catch {}
  } else await focusTab(tab);
  for (let i=0;i<20;i++) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id,{ type:'FORMATIVE_IMPORT_AVAILABLE', payload });
      if (r?.ok) return true;
    } catch {}
    await sleepFormative(350);
  }
  throw new Error('Gestion des notes est ouverte, mais le connecteur n’a pas encore répondu. Recharge la page puis réessaie.');
}

async function handleFormativeSendToGestion(senderTab, formativeId) {
  if (!senderTab?.id) throw new Error('Onglet Formative introuvable.');
  let tab = senderTab;
  try {
    tab = await ensureFormativeSession(tab, formativeId);
    const snapshot = await readFormativeSnapshot(tab.id, formativeId);
    await sendFormativeUi(tab.id, {
      title:'Données récupérées',
      message:`${snapshot.students.length} élève${snapshot.students.length===1?'':'s'} et ${snapshot.questions.length} question${snapshot.questions.length===1?'':'s'} détectés. J’ouvre Gestion des notes…`,
      status:'success'
    });
    await deliverFormativeImport(snapshot);
    return { ok:true, groupCode:snapshot.groupCode, questionCount:snapshot.questions.length, studentCount:snapshot.students.length };
  } catch (error) {
    await sendFormativeUi(tab?.id || senderTab.id, { title:'Erreur Formative', message:error?.message || String(error), status:'error' });
    throw error;
  }
}

async function handleFormativeRequest(action,payload) {
  if (action === 'captureActive') {
    let tab = await focusOrOpenFormative('');
    const id = String(tab.url||'').match(/\/formatives\/([^/]+)\/results/)?.[1] || '';
    if (!id) throw new Error('Ouvre un travail Formative dans l’onglet Réponses.');
    try {
      tab = await ensureFormativeSession(tab, id);
      const snapshot = await readFormativeSnapshot(tab.id,id);
      await sendFormativeUi(tab.id, { title:'Formative prêt', message:'Le travail et les questions ont été détectés. Retourne dans Gestion des notes pour choisir le lien.', status:'success' });
      return { ok:true, payload:snapshot };
    } catch (error) {
      await sendFormativeUi(tab?.id, { title:'Erreur Formative', message:error?.message || String(error), status:'error' });
      throw error;
    }
  }
  if (action === 'pull') {
    const id = String(payload?.formativeId||'');
    if (!id) throw new Error('Ce travail n’est pas lié à Formative.');
    let tab = await focusOrOpenFormative(id);
    try {
      tab = await ensureFormativeSession(tab, id);
      const snapshot = await readFormativeSnapshot(tab.id,id);
      await sendFormativeUi(tab.id, { title:'Lecture terminée', message:'Les résultats Formative ont été récupérés.', status:'success' });
      return { ok:true, payload:snapshot };
    } catch (error) {
      await sendFormativeUi(tab?.id, { title:'Erreur Formative', message:error?.message || String(error), status:'error' });
      throw error;
    }
  }
  if (action === 'push') {
    const id=String(payload?.formativeId||''), qid=String(payload?.questionId||'');
    if(!id||!qid)throw new Error('Le lien Formative est incomplet.');
    let tab=await focusOrOpenFormative(id);
    try {
      tab=await ensureFormativeSession(tab,id);
      await focusTab(tab);
      await sendFormativeUi(tab.id, { title:'Envoi vers Formative', message:`Je mets à jour ${Number(payload?.grades?.length||0)} note${Number(payload?.grades?.length||0)===1?'':'s'}…`, status:'working' });
      const tracked=formativeHeadersByTab.get(tab.id)||{};
      const rr=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:formativeGradeInsidePage,args:[id,qid,payload.grades||[],tracked]});
      const out=rr?.[0]?.result;
      if(!out?.ok)throw new Error(out?.message||'Formative n’a pas confirmé la mise à jour.');
      await sendFormativeUi(tab.id, { title:'Mise à jour terminée', message:`${out.updatedCount||0} note${Number(out.updatedCount||0)===1?'':'s'} mise${Number(out.updatedCount||0)===1?'':'s'} à jour dans Formative.`, status:'success' });
      return out;
    } catch (error) {
      await sendFormativeUi(tab?.id, { title:'Erreur Formative', message:error?.message || String(error), status:'error' });
      throw error;
    }
  }
  throw new Error('Action Formative inconnue.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'FORMATIVE_SEND_TO_GESTION') {
    (async()=>{
      try { sendResponse(await handleFormativeSendToGestion(sender.tab, String(message.formativeId||''))); }
      catch(error){ sendResponse({ok:false,message:error?.message||String(error)}); }
    })();
    return true;
  }
  if (message?.type === 'FORMATIVE_REQUEST') {
    (async()=>{
      const action=String(message.action||'');
      try {
        globalThis.CardinalDiagnostics?.record?.('formative-request','start',{action,tabId:sender?.tab?.id||null,payloadKeys:Object.keys(message.payload||{})});
        const result=await handleFormativeRequest(action, message.payload||{});
        globalThis.CardinalDiagnostics?.record?.('formative-request','result',{action,ok:result?.ok!==false,studentCount:result?.studentCount??null,questionCount:result?.questionCount??null,publishOk:result?.publishOk??null,blocked:result?.blocked??null,errorCount:Array.isArray(result?.errors)?result.errors.length:0});
        sendResponse(result);
      }
      catch(error){globalThis.CardinalDiagnostics?.record?.('formative-request','error',{action,message:error?.message||String(error)},'error');sendResponse({ok:false,message:error?.message||String(error)});}
    })();
    return true;
  }
});

// ===== background-v091.js =====
// Formative + ChatGPT workflow v0.9.1
// Security model:
// - Formative authorization stays inside the extension / Formative tab.
// - No authorization header, student name, or student email is sent to ChatGPT.
// - Writes are preflight-validated before any mutation.
// - Structured-rubric grading is blocked until rubric-level writes are explicitly supported.

const AI091_LEDGER_PREFIX = 'cardinal_ai091_ledger_';
const AI091_LEDGER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AI091_ACTIVE_PUBLISH_SESSIONS = new Set();

function formativeHasAuthorization091(tabId) {
  const h = formativeHeadersByTab.get(tabId) || {};
  return typeof h.authorization === 'string' && h.authorization.length > 20;
}

async function ensureFormativeSession091(tab) {
  if (!tab?.id) throw new Error('Onglet Formative introuvable.');
  await focusTab(tab);
  await ensureFormativeUi(tab.id);
  await restoreFormativeHeadersV1000(tab.id);
  if (formativeHasAuthorization091(tab.id)) return tab;

  await sendFormativeUi(tab.id, {
    title: 'Préparation de Formative',
    message: 'Je recharge la page une fois pour détecter ta session…',
    status: 'working'
  });

  try {
    await chrome.tabs.reload(tab.id);
    await waitForTabComplete(tab.id, 45000);
  } catch {}

  const started = Date.now();
  while (Date.now() - started < 18000) {
    if (formativeHasAuthorization091(tab.id)) {
      try { tab = await chrome.tabs.get(tab.id); } catch {}
      await ensureFormativeUi(tab.id);
      return tab;
    }
    await sleepFormative(250);
  }
  throw new Error('Je n’ai pas réussi à détecter l’autorisation Formative. Recharge la page Réponses, attends que les élèves apparaissent, puis réessaie.');
}

async function formativeAiSections091InsidePage(formativeId, trackedHeaders) {
  const API = 'https://svc.goformative.com/graphql';
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/graphql-response+json,application/json;q=0.9',
    ...(trackedHeaders || {})
  };

  async function gql(name, variables, query) {
    const r = await fetch(`${API}/query/${name}`, {
      method: 'POST', headers,
      body: JSON.stringify({
        operationName: name, variables,
        extensions: { clientLibrary: { name: '@apollo/client', version: '4.2.7' } },
        query
      })
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!r.ok || data?.errors?.length) throw new Error(data?.errors?.[0]?.message || text || `HTTP ${r.status}`);
    return data?.data || {};
  }

  function plainText(value) {
    if (value === null || value === undefined) return '';
    const out = [];
    const walk = v => {
      if (v === null || v === undefined) return;
      if (typeof v === 'string') {
        const str = v.trim();
        if (!str) return;
        if (str.startsWith('{') || str.startsWith('[')) {
          try { walk(JSON.parse(str)); return; } catch {}
        }
        out.push(str);
        return;
      }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === 'object') {
        if (typeof v.text === 'string') out.push(v.text);
        if (Array.isArray(v.blocks)) v.blocks.forEach(walk);
        if (Array.isArray(v.content)) v.content.forEach(walk);
      }
    };
    walk(value);
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  function isQuestionLike(item) {
    if (!item?._id && !item?.id) return false;
    const type = String(item?.type || '').toLowerCase();
    const number = String(item?.questionNumber ?? '').trim();
    // Important: les réponses élève ont aussi type=multipleChoice/fillInTheBlank.
    // On ne considère comme question que les vrais items du Formative.
    return type === 'question' || !!number;
  }

  function normalizeQuestion(item) {
    const id = String(item?._id ?? item?.id ?? '');
    if (!id || !isQuestionLike(item)) return null;
    return {
      id,
      number: String(item?.questionNumber ?? ''),
      label: plainText(item?.text) || `Question ${item?.questionNumber || ''}`.trim() || 'Question',
      possiblePoints: Number(item?.details?.points ?? item?.possiblePoints ?? 0),
      questionType: String(item?.subtype || item?.type || '')
    };
  }

  function capturedQuestionsForThisFormative() {
    const out = [];
    try {
      const records = Array.isArray(window.__cardinalFormativeGraphqlCache) ? window.__cardinalFormativeGraphqlCache : [];
      const seen = new WeakSet();
      const walk = value => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) { value.forEach(walk); return; }
        const q = normalizeQuestion(value);
        if (q) out.push(q);
        for (const child of Object.values(value)) walk(child);
      };
      for (const record of records) {
        let relevant = false;
        try {
          const vars = JSON.stringify(record?.variables || {});
          if (vars.includes(String(formativeId))) relevant = true;
          const f = record?.data?.formative;
          if (String(f?._id || f?.id || '') === String(formativeId)) relevant = true;
        } catch {}
        if (relevant) walk(record?.data);
      }
    } catch {}
    return out;
  }

  const q = `query Results($formativeId: ID!) {
    formative(id:$formativeId) {
      _id title
      assignments: teacherAssignments { _id section { _id title studentCount } }
      items { _id parentId questionNumber type subtype text details { points isRubricEnabled } }
    }
  }`;
  const d = await gql('Results', { formativeId }, q);
  const f = d?.formative;
  if (!f?._id) throw new Error('Formative introuvable ou session expirée.');

  const questionMap = new Map();
  for (const item of f.items || []) {
    const normalized = normalizeQuestion(item);
    if (normalized) questionMap.set(normalized.id, normalized);
  }
  const questions = [...questionMap.values()].sort((a,b) => {
    const an = Number(String(a.number).replace(/[^\d.]/g,''));
    const bn = Number(String(b.number).replace(/[^\d.]/g,''));
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return String(a.number || a.label).localeCompare(String(b.number || b.label), 'fr', { numeric:true, sensitivity:'base' });
  });

  const sections = (f.assignments || []).filter(a => a?._id && a?.section?._id).map(a => ({
    assignmentId: String(a._id),
    sectionId: String(a.section._id),
    title: String(a.section.title || 'Classe'),
    studentCount: Number(a.section.studentCount || 0)
  }));

  // Formative does not consistently keep the selected class in the URL.
  // Recover the active class from the most recent GraphQL variables already
  // observed in this exact tab. We only accept IDs that match the authoritative
  // teacherAssignments list returned above, so no class is guessed.
  let activeAssignmentId = '';
  let activeSectionId = '';
  try {
    const records = Array.isArray(window.__cardinalFormativeGraphqlCache) ? window.__cardinalFormativeGraphqlCache : [];
    const collectIds = value => {
      const out = [];
      const walk = (v, key='') => {
        if (v == null) return;
        if (Array.isArray(v)) { v.forEach(x => walk(x, key)); return; }
        if (typeof v === 'object') { for (const [k,x] of Object.entries(v)) walk(x, k); return; }
        if (!/(assignment|section)/i.test(String(key || ''))) return;
        const text = String(v || '').trim();
        if (text) out.push(text);
      };
      walk(value);
      return out;
    };
    for (let i = records.length - 1; i >= 0; i--) {
      const ids = new Set(collectIds(records[i]?.variables || {}));
      if (!ids.size) continue;
      const byAssignment = sections.find(section => ids.has(String(section.assignmentId)));
      const bySection = sections.find(section => ids.has(String(section.sectionId)));
      const hit = byAssignment || bySection;
      if (hit) {
        activeAssignmentId = String(hit.assignmentId || '');
        activeSectionId = String(hit.sectionId || '');
        break;
      }
    }
  } catch {}

  return {
    ok: true,
    formativeId: String(f._id),
    title: String(f.title || 'Formative'),
    activeAssignmentId,
    activeSectionId,
    sections,
    questions
  };
}


async function formativeQuestionDefinitionDiagnosticInsidePage(formativeId, questionId, trackedHeaders) {
  const API = 'https://svc.goformative.com/graphql';
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/graphql-response+json,application/json;q=0.9',
    ...(trackedHeaders || {})
  };

  async function rawGql(name, variables, query) {
    try {
      const r = await fetch(`${API}/query/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operationName: name,
          variables,
          extensions: { clientLibrary: { name: '@apollo/client', version: '4.2.7' } },
          query
        })
      });
      const raw = await r.text();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      return {
        ok: !!r.ok && !(parsed?.errors?.length),
        status: r.status,
        errors: parsed?.errors || [],
        data: parsed?.data || null,
        raw: parsed ? '' : String(raw || '').slice(0, 4000)
      };
    } catch (error) {
      return { ok:false, status:0, errors:[{message:String(error?.message||error)}], data:null, raw:'' };
    }
  }

  function unwrap(type) {
    let t = type;
    let depth = 0;
    while (t?.ofType && depth++ < 8) t = t.ofType;
    return t || null;
  }

  function safeSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    return schema;
  }

  const baseQuery = `query CardinalQuestionBase($formativeId: ID!, $id: ID!) {
    formative(id:$formativeId) {
      _id
      items { _id questionNumber type subtype text details { points } }
    }
    formativeItem(id:$id) { _id __typename }
  }`;
  const base = await rawGql('CardinalQuestionBase', { formativeId, id: questionId }, baseQuery);
  const itemFromFormative = base?.data?.formative?.items?.find(x => String(x?._id||'') === String(questionId)) || null;
  const typename = String(base?.data?.formativeItem?.__typename || '');

  const TYPE_QUERY = `query CardinalSchemaType($name: String!) {
    __type(name:$name) {
      kind
      name
      fields {
        name
        args {
          name
          defaultValue
          type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
        }
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
      }
    }
  }`;

  const schemaCache = {};
  async function schemaFor(name) {
    const n = String(name || '');
    if (!n) return null;
    if (schemaCache[n]) return schemaCache[n];
    const res = await rawGql('CardinalSchemaType', { name:n }, TYPE_QUERY);
    schemaCache[n] = { response:res, schema:res?.data?.__type || null };
    return schemaCache[n];
  }

  const rootSchemaResult = await schemaFor(typename || 'FormativeItem');
  const rootSchema = rootSchemaResult?.schema || null;

  function hasRequiredArgs(field) {
    return (field?.args || []).some(arg => arg?.type?.kind === 'NON_NULL' && (arg?.defaultValue === null || arg?.defaultValue === undefined));
  }

  const relevantName = /choice|option|answer|correct|blank|match|pair|response|solution|accept|valid|key|setting|metadata|detail|data|content|question|label|text|value|item|type|subtype/i;
  const privacyName = /owner|teacher|student|email|user|collaborator|createdBy|updatedBy/i;

  async function buildSelection(typeName, depth=0, path='root') {
    if (!typeName || depth > 3) return [];
    const got = await schemaFor(typeName);
    const schema = got?.schema;
    const fields = Array.isArray(schema?.fields) ? schema.fields : [];
    const selections = [];
    for (const field of fields) {
      const name = String(field?.name || '');
      if (!name || privacyName.test(name) || hasRequiredArgs(field)) continue;
      const baseType = unwrap(field?.type);
      if (!baseType) continue;
      if (baseType.kind === 'SCALAR' || baseType.kind === 'ENUM') {
        if (depth === 0) {
          if (/^(_id|questionNumber|type|subtype|text)$/i.test(name) || relevantName.test(name)) selections.push(name);
        } else if (relevantName.test(name) || /^(_id|id|position|order|index)$/i.test(name)) {
          selections.push(name);
        }
      } else if ((baseType.kind === 'OBJECT' || baseType.kind === 'INTERFACE') && depth < 3) {
        if (depth === 0 && !relevantName.test(name)) continue;
        if (depth > 0 && !relevantName.test(name) && !/^(details|settings|config)$/i.test(name)) continue;
        const children = await buildSelection(baseType.name, depth+1, `${path}.${name}`);
        if (children.length) selections.push(`${name} { __typename ${children.join(' ')} }`);
      }
      if (selections.length >= (depth === 0 ? 30 : 24)) break;
    }
    return [...new Set(selections)];
  }

  let definitionQuery = '';
  let definition = null;
  let definitionError = null;
  if (typename) {
    const selections = await buildSelection(typename, 0);
    if (selections.length) {
      definitionQuery = `query CardinalQuestionDefinition($id: ID!) {
        formativeItem(id:$id) {
          __typename
          ${selections.join('\n          ')}
        }
      }`;
      definition = await rawGql('CardinalQuestionDefinition', { id:questionId }, definitionQuery);
      if (!definition?.ok) definitionError = definition?.errors || [{message:'Échec de la requête de définition.'}];
    }
  }

  const cacheValue = (() => {
    try { return window.__cardinalFormativeDefinitionCache?.[String(questionId)] || null; } catch { return null; }
  })();

  return {
    ok: true,
    diagnosticVersion: 'QUESTION_SCHEMA_1.0',
    generatedAt: new Date().toISOString(),
    formativeId: String(formativeId || ''),
    questionId: String(questionId || ''),
    route: location.pathname + location.search,
    itemFromFormative,
    typename,
    base,
    rootSchema: safeSchema(rootSchema),
    schemaTypes: Object.fromEntries(Object.entries(schemaCache).map(([k,v]) => [k, {
      ok: !!v?.response?.ok,
      errors: v?.response?.errors || [],
      schema: v?.schema || null
    }])),
    definitionQuery,
    definition,
    definitionError,
    cachedDefinition: cacheValue
  };
}

async function formativeAiPrepare091InsidePage(formativeId, assignmentId, sectionId, selectedQuestionIds, mode, trackedHeaders) {
  const API = 'https://svc.goformative.com/graphql';
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/graphql-response+json,application/json;q=0.9',
    ...(trackedHeaders || {})
  };

  async function gql(kind, name, variables, query) {
    const r = await fetch(`${API}/${kind}/${name}`, {
      method: 'POST', headers,
      body: JSON.stringify({
        operationName: name, variables,
        extensions: { clientLibrary: { name: '@apollo/client', version: '4.2.7' } },
        query
      })
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!r.ok || data?.errors?.length) throw new Error(data?.errors?.[0]?.message || text || `HTTP ${r.status}`);
    return data?.data || {};
  }

  const domChoiceCache = new Map();
  function resolveChoiceTokenFromDom(raw) {
    const text = String(raw || '').trim();
    if (!text || text.length > 120) return '';
    if (domChoiceCache.has(text)) return domChoiceCache.get(text) || '';
    const tokens = text.split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens.some(t => !/^[A-Za-z0-9_-]{2,40}$/.test(t))) {
      domChoiceCache.set(text, '');
      return '';
    }
    const resolveOne = token => {
      if (domChoiceCache.has(token)) return domChoiceCache.get(token) || '';
      const selectors = [
        `input[value="${token}"]`,`option[value="${token}"]`,
        `[data-value="${token}"]`,`[data-id="${token}"]`,`[data-key="${token}"]`,`[data-choice-key="${token}"]`
      ];
      for (const sel of selectors) {
        let el = null;
        try { el = document.querySelector(sel); } catch {}
        if (!el) continue;
        const candidates = [];
        if (el.tagName === 'OPTION') candidates.push(el.textContent || '');
        if (el.labels?.length) [...el.labels].forEach(l => candidates.push(l.innerText || l.textContent || ''));
        const label = el.closest?.('label'); if (label) candidates.push(label.innerText || label.textContent || '');
        const parent = el.parentElement; if (parent) candidates.push(parent.innerText || parent.textContent || '');
        candidates.push(el.getAttribute?.('aria-label') || '', el.getAttribute?.('title') || '');
        for (let c of candidates) {
          c = String(c || '').replace(/\s+/g, ' ').trim();
          if (!c) continue;
          c = c.replace(token, '').replace(/^[\s:·•-]+|[\s:·•-]+$/g, '').trim();
          if (c && c !== token && c.length <= 500) {
            domChoiceCache.set(token, c);
            return c;
          }
        }
      }
      domChoiceCache.set(token, '');
      return '';
    };
    const resolved = tokens.map(resolveOne);
    const out = resolved.every(Boolean) ? resolved.join(' ; ') : '';
    domChoiceCache.set(text, out);
    return out;
  }

  function richInfo(value) {
    const texts = [];
    const media = new Set();
    const mediaWords = ['image','video','audio','file','attachment','drawing','embed','canvas','upload'];
    const walk = v => {
      if (v === null || v === undefined) return;
      if (typeof v === 'string') {
        const s = v.trim();
        if (!s) return;
        if (s.startsWith('{') || s.startsWith('[')) {
          try { walk(JSON.parse(s)); return; } catch {}
        }
        texts.push(s);
        return;
      }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === 'object') {
        const type = String(v.type || v.kind || v.nodeType || '').toLowerCase();
        if (type && mediaWords.some(w => type.includes(w))) media.add(type);
        if (typeof v.url === 'string' && !type.includes('link')) media.add(type || 'media');
        if (typeof v.src === 'string' && !type.includes('link')) media.add(type || 'media');
        if (typeof v.text === 'string') texts.push(v.text);
        if (v.answer !== undefined) walk(v.answer);
        if (Array.isArray(v.blocks)) v.blocks.forEach(walk);
        if (Array.isArray(v.content)) v.content.forEach(walk);
        if (Array.isArray(v.choices)) v.choices.forEach(walk);
      }
    };
    walk(value);
    return { text: texts.join(' ').replace(/\s+/g, ' ').trim(), hasMedia: media.size > 0, mediaTypes: [...media] };
  }

  function looksOpaqueToken(value) {
    const s = String(value || '').trim();
    if (!s || s.length > 120 || /\s/.test(s)) return false;
    if (/^(true|false|null|undefined)$/i.test(s)) return false;
    if (/^[0-9]+(?:[.,][0-9]+)?$/.test(s)) return false;
    if (/^[a-f0-9]{16,}$/i.test(s)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(s)) return true;
    if (/^[A-Za-z0-9_-]{2,40}$/.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s)) return true;
    return false;
  }

  function getCapturedQuestionDefinition(questionId) {
    try {
      const qid = String(questionId || '');
      const records = Array.isArray(window.__cardinalFormativeGraphqlCache) ? window.__cardinalFormativeGraphqlCache : [];
      const exact = [];
      const local = [];
      const seen = new WeakSet();
      const walk = value => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) { value.forEach(walk); return; }
        const id = String(value._id ?? value.id ?? '');
        let size = 0;
        if (id === qid) {
          try { size = JSON.stringify(value).length; } catch {}
          exact.push({ value, size });
        } else {
          for (const [key, child] of Object.entries(value)) {
            if (/(formativeItemId|questionId|itemId)$/i.test(key) && String(child ?? '') === qid) {
              try { size = JSON.stringify(value).length; } catch {}
              local.push({ value, size });
              break;
            }
          }
        }
        for (const child of Object.values(value)) walk(child);
      };
      for (let i = records.length - 1; i >= 0; i--) walk(records[i]?.data);
      exact.sort((a,b) => b.size - a.size);
      local.sort((a,b) => a.size - b.size);
      const sources = [...exact.slice(0,6).map(x => x.value), ...local.slice(0,4).map(x => x.value)];
      if (!sources.length) return null;
      return { __cardinalCapturedSources: sources };
    } catch { return null; }
  }

  const capturedTokenCache = new Map();
  function resolveTokenFromCapturedNetwork(rawToken, questionId) {
    const token = String(rawToken || '').trim();
    const qid = String(questionId || '');
    const cacheKey = `${qid}|${token}`;
    if (!token || !looksOpaqueToken(token)) return '';
    if (capturedTokenCache.has(cacheKey)) return capturedTokenCache.get(cacheKey) || '';

    const candidates = [];
    const labelKeyScore = key => {
      if (/^(label|displayText|display)$/i.test(key)) return 120;
      if (/^(text|title|name)$/i.test(key)) return 110;
      if (/^(answer|content|description)$/i.test(key)) return 90;
      if (/^(value)$/i.test(key)) return 70;
      return 25;
    };
    const ignoredKey = /(^_?id$|type|kind|typename|created|updated|owner|student|points|score|possible|correct|position|index)/i;
    const addCandidate = (value, key, bonus=0) => {
      const text = richInfo(value).text.replace(/\s+/g, ' ').trim();
      if (!text || text === token || looksOpaqueToken(text) || text.length > 500) return;
      if (/^(multipleChoice|fillInTheBlank|shortAnswer|question|answer)$/i.test(text)) return;
      candidates.push({ text, score: labelKeyScore(key) + bonus });
    };

    try {
      const records = Array.isArray(window.__cardinalFormativeGraphqlCache) ? window.__cardinalFormativeGraphqlCache : [];
      const seen = new WeakSet();
      const walk = (value, parent=null, parentKey='') => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) { value.forEach(v => walk(v, parent, parentKey)); return; }

        let directHit = false;
        for (const [key, child] of Object.entries(value)) {
          if ((typeof child === 'string' || typeof child === 'number') && String(child).trim() === token) directHit = true;
          if (String(key).trim() === token) {
            directHit = true;
            addCandidate(child, key, 35);
          }
        }
        if (directHit) {
          for (const [key, child] of Object.entries(value)) {
            if (ignoredKey.test(key)) continue;
            addCandidate(child, key, 50);
          }
          if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
            for (const [key, child] of Object.entries(parent)) {
              if (ignoredKey.test(key) || child === value) continue;
              addCandidate(child, key, 5);
            }
          }
        }
        for (const [key, child] of Object.entries(value)) walk(child, value, key);
      };
      for (let i = records.length - 1; i >= 0; i--) walk(records[i]?.data);
    } catch {}

    candidates.sort((a,b) => b.score - a.score || a.text.length - b.text.length);
    const out = candidates[0]?.text || '';
    capturedTokenCache.set(cacheKey, out);
    return out;
  }

  function unwrapGraphqlType(type) {
    let t = type;
    while (t?.ofType) t = t.ofType;
    return t || null;
  }

  const typeFieldsCache = new Map();
  async function introspectTypeFields(typeName) {
    const name = String(typeName || '');
    if (!name) return [];
    if (typeFieldsCache.has(name)) return typeFieldsCache.get(name);
    const query = `query CardinalTypeFields($name: String!) {
      __type(name:$name) {
        fields {
          name
          args { name defaultValue type { kind name ofType { kind name ofType { kind name } } } }
          type { kind name ofType { kind name ofType { kind name } } }
        }
      }
    }`;
    try {
      const data = await gql('query','CardinalTypeFields',{ name },query);
      const fields = Array.isArray(data?.__type?.fields) ? data.__type.fields : [];
      typeFieldsCache.set(name, fields);
      return fields;
    } catch {
      typeFieldsCache.set(name, []);
      return [];
    }
  }

  function hasRequiredArgs(field) {
    return (field?.args || []).some(arg => arg?.type?.kind === 'NON_NULL' && (arg?.defaultValue === null || arg?.defaultValue === undefined));
  }

  function mergeQuestionDefinition(base, extra) {
    if (!base) return extra || null;
    if (!extra) return base;
    return {
      ...base,
      ...extra,
      details: { ...(base.details || {}), ...(extra.details || {}) }
    };
  }

  async function fetchQuestionDefinitionFromApi(questionId, force=false) {
    const id = String(questionId || '');
    if (!id) return null;
    const cache = window.__cardinalFormativeDefinitionCache = window.__cardinalFormativeDefinitionCache || {};
    if (!force && cache[id]) return cache[id];
    const cachedDefinition = cache[id] || null;

    // Start with the small field set already used by Cardinal's proven v2 reader.
    // A removed/experimental advanced field must never make basic choice decoding fail.
    const coreQuery = `query CardinalItemDefinitionCore($id: ID!) {
      formativeItem(id:$id) {
        _id questionNumber type subtype text
        details {
          points
          choices
          choiceLabels
          correctAnswers
          blanks { key choices choiceLabels correctAnswers numeric }
        }
      }
    }`;
    const richQuery = `query CardinalItemDefinition($id: ID!) {
      formativeItem(id:$id) {
        _id
        questionNumber
        type
        subtype
        text
        details {
          points
          allowEquivalencies
          answerChoicePoints
          choices
          choiceLabels
          correctAnswers
          isCaseSensitive
          isKeywordGrading
          isPartialCredit
          isRandomized
          blanks {
            key
            choices
            choiceLabels
            correctAnswers
            numeric
          }
          hotText {
            choices { choice key }
            correctAnswers
            isMultiSelect
            text
          }
          dragAndDrop {
            choices { key label }
            correctAnswers { choiceKey targetKey }
            dropLocations { targetKey x y placement }
            imageSrc
            source
          }
          targets { label choices }
          matchTableGrid { isMultiSelect }
        }
      }
    }`;

    // A retry may enrich the cache, but must never replace a previously useful
    // definition by a poorer transient response.
    let definition = cachedDefinition;
    try {
      const data = await gql('query','CardinalItemDefinitionCore',{ id },coreQuery);
      definition = mergeQuestionDefinition(definition, data?.formativeItem || null);
    } catch {}
    try {
      const data = await gql('query','CardinalItemDefinition',{ id },richQuery);
      definition = mergeQuestionDefinition(definition, data?.formativeItem || null);
    } catch {}
    if (definition) cache[id] = definition;
    return definition;
  }

  async function fetchQuestionDefinitionWithRetry(questionId) {
    let definition = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      definition = await fetchQuestionDefinitionFromApi(questionId, attempt > 0);
      if (definition) return definition;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)));
    }
    return null;
  }

  function buildQuestionTokenMap(definition, questionId='') {
    const map = new Map();
    const seen = new WeakSet();
    const labelKeys = /^(label|title|name|text|displayText|display|content|description|choice)$/i;
    const idKeys = /(^_?id$|key$|token$|choice.*id$|option.*id$|answer.*id$|value$)/i;
    const human = value => {
      const t = richInfo(value).text.replace(/\s+/g,' ').trim();
      if (!t || t.length > 700 || looksOpaqueToken(t)) return '';
      return t;
    };
    const walk = value => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) { value.forEach(walk); return; }

      // Formative multiple-choice uses parallel arrays:
      // details.choices[i] is the stored answer token and details.choiceLabels[i] is the visible label.
      const choices = Array.isArray(value.choices) ? value.choices : [];
      const choiceLabels = Array.isArray(value.choiceLabels) ? value.choiceLabels : [];
      if (choices.length && choiceLabels.length) {
        const count = Math.min(choices.length, choiceLabels.length);
        for (let i = 0; i < count; i++) {
          const rawChoice = choices[i];
          const token = (typeof rawChoice === 'string' || typeof rawChoice === 'number') ? String(rawChoice).trim() : '';
          const label = human(choiceLabels[i]);
          if (token && label && token !== label) map.set(token, label);
        }
      }

      const ids = [];
      const labels = [];
      for (const [k,v] of Object.entries(value)) {
        if (idKeys.test(k) && (typeof v === 'string' || typeof v === 'number')) {
          const token = String(v).trim();
          if (token && token.length <= 120) ids.push(token);
        }
        if (labelKeys.test(k)) {
          const label = human(v);
          if (label) labels.push(label);
        }
      }
      const label = labels.sort((a,b) => a.length - b.length)[0] || '';
      if (label) for (const id of ids) if (id !== label) map.set(id, label);
      for (const v of Object.values(value)) walk(v);
    };
    walk(definition);
    for (const token of [...map.keys()]) {
      if (!map.get(token)) {
        const found = resolveTokenFromCapturedNetwork(token, questionId);
        if (found) map.set(token, found);
      }
    }
    return map;
  }

  function collectCorrectReferences(definition, tokenMap, questionId='') {
    if (!definition) return [];
    const out = [];
    const seen = new WeakSet();
    const add = value => {
      if (value === null || value === undefined) return;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const raw = String(value).trim();
        if (!raw) return;
        const mapped = tokenMap.get(raw) || resolveTokenFromCapturedNetwork(raw, questionId) || resolveChoiceTokenFromDom(raw) || raw;
        if (!looksOpaqueToken(mapped) && mapped.length <= 700) out.push(mapped);
        return;
      }
      if (Array.isArray(value)) { value.forEach(add); return; }
      if (typeof value === 'object') {
        const text = richInfo(value).text;
        if (text && !looksOpaqueToken(text) && text.length <= 700) out.push(text);
      }
    };
    const walk = value => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) { value.forEach(walk); return; }
      const entries = Object.entries(value);
      const isCorrect = value.isCorrect === true || value.correct === true || value.isAnswer === true;
      if (isCorrect) {
        for (const key of ['label','text','title','name','value','content','answer']) if (value[key] !== undefined) add(value[key]);
      }
      for (const [key,v] of entries) {
        if (/(correct.*answer|answer.*key|accepted.*answer|valid.*answer|expected.*answer|solutions?)/i.test(key)) add(v);
        walk(v);
      }
    };
    walk(definition);
    return [...new Set(out.map(x => String(x).replace(/\s+/g,' ').trim()).filter(Boolean))].slice(0,24);
  }

  function extractBlankKeyOrder(definition) {
    if (!definition || typeof definition !== 'object') return [];
    const candidates = [];
    const seen = new WeakSet();
    const walk = value => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (Array.isArray(value.blanks)) {
        const keys = value.blanks.map(b => String(b?.key || '').trim()).filter(Boolean);
        if (keys.length) candidates.push(keys);
      }
      for (const child of Object.values(value)) walk(child);
    };
    walk(definition);
    candidates.sort((a,b) => b.length - a.length);
    return candidates[0] || [];
  }

  function decodeStructuredAnswer(content, tokenMap, questionId='', definition=null) {
    const unresolved = [];
    const metadata = /^(?:_?id|type|kind|nodeType|createdAt|updatedAt|__typename|points|possiblePoints|score|correct|isCorrect|isAnswer|attrs|marks|dir|textAlign|align)$/i;
    const genericKey = /^(?:content|answer|answers|response|responses|value|values|selection|selected|choice|choices|item|items|field|fields|blank|blanks)$/i;

    const parseMaybe = value => {
      if (typeof value !== 'string') return value;
      const s = value.trim();
      if (!(s.startsWith('{') || s.startsWith('['))) return value;
      try { return JSON.parse(s); } catch { return value; }
    };

    const scalar = value => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      let raw = String(value).replace(/\s+/g,' ').trim();
      if (!raw) return '';
      if (tokenMap.has(raw)) return tokenMap.get(raw);
      const captured = resolveTokenFromCapturedNetwork(raw, questionId);
      if (captured) return captured;
      const dom = resolveChoiceTokenFromDom(raw);
      if (dom) return dom;
      const tokenParts = raw.split(/[\s,;|]+/).map(x=>x.trim()).filter(Boolean);
      if (tokenParts.length > 1 && tokenParts.every(looksOpaqueToken)) {
        const resolved = tokenParts.map(token => tokenMap.get(token) || resolveTokenFromCapturedNetwork(token, questionId) || resolveChoiceTokenFromDom(token));
        if (resolved.every(Boolean)) return resolved.join(' ; ');
        tokenParts.forEach((token,index)=>{ if(!resolved[index]) unresolved.push(token); });
        return '';
      }
      if (looksOpaqueToken(raw)) { unresolved.push(raw); return ''; }
      return raw;
    };

    const decode = (value, depth=0) => {
      if (depth > 10) return [];
      value = parseMaybe(value);
      if (value === null || value === undefined) return [];
      if (typeof value !== 'object') {
        const v = scalar(value);
        return v ? [v] : [];
      }
      if (Array.isArray(value)) {
        const rows = [];
        for (const child of value) {
          const decoded = decode(child, depth+1);
          if (!decoded.length) continue;
          if (decoded.length === 1) rows.push(decoded[0]);
          else rows.push(decoded.join(' '));
        }
        return rows;
      }

      if (String(value.type || '').toLowerCase() === 'text' && typeof value.text === 'string') {
        const v = scalar(value.text);
        return v ? [v] : [];
      }

      const rows = [];
      const objectKeys=Object.keys(value);
      const hasPayloadSibling=objectKeys.some(k=>/^(?:value|values|answer|answers|response|responses|content|text|selection|selected|choice|choices|blank|blanks)$/i.test(k));
      for (const [key, child] of Object.entries(value)) {
        if (metadata.test(key)) continue;
        // Formative often serializes a fill-in-the-blank entry as
        // { key: "<blank UUID>", value: "student text" }. The key identifies
        // the field; it is not a student answer. Treat it as structure only
        // when a real payload sibling is present. A lone {key:"choiceToken"}
        // remains decodable as an actual selected choice.
        if (/^key$/i.test(key) && hasPayloadSibling) continue;
        const decoded = decode(child, depth+1);
        if (!decoded.length) continue;
        const mappedFromDefinition = tokenMap.get(key) || '';
        const schemaLikeKey = /^[A-Za-z_$][A-Za-z0-9_$]{0,11}$/.test(key) && !/[\sÀ-ÿ]/.test(key);
        const mappedKey = mappedFromDefinition || (!looksOpaqueToken(key) && !genericKey.test(key) && !schemaLikeKey ? key : '');
        if (mappedKey) rows.push(`${mappedKey} : ${decoded.join(' ; ')}`);
        else rows.push(...decoded);
      }
      return rows;
    };

    const parsedContent = parseMaybe(content);
    const blankKeys = extractBlankKeyOrder(definition);
    let values;
    if (blankKeys.length && parsedContent && typeof parsedContent === 'object' && !Array.isArray(parsedContent) && parsedContent.answers && typeof parsedContent.answers === 'object' && !Array.isArray(parsedContent.answers)) {
      values = blankKeys.map(key => {
        const decoded = decode(parsedContent.answers[key], 1).map(x => String(x).replace(/\s+/g,' ').trim()).filter(Boolean);
        return decoded.length ? decoded.join(' ; ') : '(vide)';
      });
    } else {
      values = decode(content).map(x => String(x).replace(/\s+/g,' ').trim()).filter(Boolean);
      values = values.filter((v,i,a) => a.indexOf(v) === i);
    }
    // ProseMirror-like text can be split into tiny fragments. Prefer the existing rich text in that case.
    const rich = richInfo(content).text.replace(/\s+/g,' ').trim();
    const richParts = rich.split(/[\s,;|]+/).map(x=>x.trim()).filter(Boolean);
    const richIsOpaqueTokenList = richParts.length > 0 && richParts.every(looksOpaqueToken);
    if ((!values.length || (values.length > 1 && rich && !richIsOpaqueTokenList && !looksOpaqueToken(rich) && rich.length < 1200 && !/[|:]/.test(rich))) && rich && !richIsOpaqueTokenList) {
      values = [rich];
    }
    const text = values.length <= 1 ? (values[0] || '') : values.map((v,i) => `${i+1}. ${v}`).join('\n');
    const structuralTokens=new Set(blankKeys.map(String));
    const unresolvedTokens=[...new Set(unresolved)].filter(token=>!structuralTokens.has(String(token)));
    return { text, values, unresolvedTokens };
  }

  function rubricText(rubric) {
    if (!rubric) return '';
    const parts = [];
    if (rubric.title) parts.push(String(rubric.title));
    if (rubric.description) parts.push(String(rubric.description));
    for (const criterion of rubric.criteria || []) {
      let line = criterion.title || 'Critère';
      if (criterion.description) line += ` : ${criterion.description}`;
      parts.push(line);
      for (const level of criterion.levels || []) {
        const pts = level.points === null || level.points === undefined ? '' : ` (${level.points} pt${Number(level.points) === 1 ? '' : 's'})`;
        parts.push(`- ${level.title || 'Niveau'}${pts}${level.description ? ` : ${level.description}` : ''}`);
      }
    }
    return parts.join('\n').trim();
  }

  async function hashText(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...digest].map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function stableSerialize(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }

  const wanted = new Set((selectedQuestionIds || []).map(String).filter(Boolean));
  if (!wanted.size) throw new Error('Choisis au moins une question.');
  if (!['notes','comments','both'].includes(String(mode))) throw new Error('Mode de correction invalide.');

  let rubricKnown = true;
  const resultsWithRubric = `query Results($formativeId: ID!) {
    formative(id:$formativeId) {
      _id title
      assignments: teacherAssignments { _id section { _id title studentCount } }
      items {
        _id parentId questionNumber type subtype text details { points isRubricEnabled }
        rubric { title description criteria { id title description levels { id title description points } } }
      }
    }
  }`;
  const resultsSafe = `query Results($formativeId: ID!) {
    formative(id:$formativeId) {
      _id title
      assignments: teacherAssignments { _id section { _id title studentCount } }
      items { _id parentId questionNumber type subtype text details { points isRubricEnabled } }
    }
  }`;

  let rd;
  try { rd = await gql('query','Results',{ formativeId },resultsWithRubric); }
  catch { rd = await gql('query','Results',{ formativeId },resultsSafe); }
  const f = rd?.formative;
  if (!f?._id) throw new Error('Formative introuvable ou session expirée.');

  const assignment = (f.assignments || []).find(a => String(a?._id || '') === String(assignmentId) && String(a?.section?._id || '') === String(sectionId));
  if (!assignment?._id || !assignment?.section?._id) throw new Error('La classe sélectionnée n’est plus assignée à ce Formative.');

  const isQuestionLike = item => {
    if (!item?._id) return false;
    const type = String(item?.type || '').toLowerCase();
    const subtype = String(item?.subtype || '').toLowerCase();
    const number = String(item?.questionNumber ?? '').trim();
    return type === 'question' || !!number || /(choice|answer|blank|fill|match|categor|rank|order|numeric|short|essay|true|false|dropdown|select)/i.test(`${type} ${subtype}`);
  };
  const selectedItems = (f.items || []).filter(item => isQuestionLike(item) && wanted.has(String(item._id)));
  if (selectedItems.length !== wanted.size) throw new Error('Une ou plusieurs questions sélectionnées ne sont plus disponibles.');

  // Preserve the exact stimulus/context that Formative attaches to a child question.
  // We follow explicit parentId links only: never infer context from neighboring items.
  const formativeItemsById = new Map(
    (f.items || []).filter(row => row?._id).map(row => [String(row._id), row])
  );
  function parentContextFor(item) {
    const blocks = [];
    const seen = new Set();
    let parentId = String(item?.parentId || '').trim();
    let missing = false;
    let depth = 0;
    while (parentId && depth < 12) {
      if (seen.has(parentId)) { missing = true; break; }
      seen.add(parentId);
      const parent = formativeItemsById.get(parentId);
      if (!parent) { missing = true; break; }
      const info = richInfo(parent.text);
      if (info.text || info.hasMedia) {
        blocks.push({
          id: String(parent._id),
          text: info.text,
          hasMedia: !!info.hasMedia,
          mediaTypes: info.mediaTypes
        });
      }
      parentId = String(parent?.parentId || '').trim();
      depth += 1;
    }
    if (parentId && depth >= 12) missing = true;
    blocks.reverse();
    return { blocks, missing };
  }

  const needsNotes = mode === 'notes' || mode === 'both';
  const invalidMaxQuestions = selectedItems.filter(item => !(Number(item?.details?.points) > 0));
  if (needsNotes && invalidMaxQuestions.length) {
    const labels = invalidMaxQuestions.map(q => `Q${q.questionNumber || '?'}`).join(', ');
    throw new Error(`${labels} n’a pas un maximum de points exploitable. La publication automatique des notes est bloquée pour éviter une note invalide.`);
  }
  const rubricQuestions = selectedItems.filter(item => item?.details?.isRubricEnabled === true || (Array.isArray(item?.rubric?.criteria) && item.rubric.criteria.length > 0));
  if (needsNotes && !rubricKnown) {
    throw new Error('Je n’ai pas pu vérifier de façon fiable si ces questions utilisent une grille structurée Formative. Par sécurité, la publication automatique des notes est bloquée. Tu peux utiliser « Commentaires seulement », ou on pourra ajouter le support des grilles après avoir capturé leur fonctionnement.');
  }
  if (needsNotes && rubricQuestions.length) {
    const labels = rubricQuestions.map(q => `Q${q.questionNumber || '?'}`).join(', ');
    throw new Error(`${labels} utilise${rubricQuestions.length === 1 ? '' : 'nt'} une grille structurée Formative. Les notes automatiques sont bloquées pour ne pas effacer les niveaux de critères. Utilise « Commentaires seulement » pour ces questions.`);
  }

  const studentsQuery = `query ResultsSummarySection($sectionId: ID!, $assignmentId: ID!, $archivedEnrollments: Boolean) {
    students: users(sections:[$sectionId], assignments:[$assignmentId], archivedEnrollments:$archivedEnrollments) {
      nodes { _id emails { address } firstName lastName }
    }
  }`;
  const sd = await gql('query','ResultsSummarySection',{
    sectionId: String(sectionId), assignmentId: String(assignmentId), archivedEnrollments:false
  },studentsQuery);
  const students = (sd?.students?.nodes || []).filter(s => s?._id);
  const orderedStudents = [...students].sort((a,b) => String(a._id).localeCompare(String(b._id)));
  const studentIds = orderedStudents.map(s => String(s._id));
  const studentMap = new Map(orderedStudents.map((s,index) => [String(s._id), {
    studentId: String(s._id),
    studentLabel: `Réponse ${String(index + 1).padStart(3,'0')}`,
    studentName: [s?.firstName, s?.lastName].filter(Boolean).join(' ').trim(),
    studentEmail: (s?.emails || []).map(e => String(e?.address || '').trim().toLowerCase()).find(Boolean) || ''
  }]));

  const answerDetailsQuery = `query ResultsSelectedItemSidebarAnswerDetails($formativeItemId: ID!, $studentIds: [ID!]!) {
    answers(formativeItemId:$formativeItemId, students:$studentIds) {
      nodes { _id content points possiblePoints type owner { _id } }
    }
    formativeItem(id:$formativeItemId) {
      _id questionNumber text details { points }
      feedbackMessages(orderBy:{field:CREATED,direction:ASC},includeReplies:true,studentIds:$studentIds) {
        nodes { _id text answer { _id } from { _id teacher } }
      }
    }
  }`;
  const answerDetailsBasicQuery = `query ResultsSelectedItemSidebarAnswerDetails($formativeItemId: ID!, $studentIds: [ID!]!) {
    answers(formativeItemId:$formativeItemId, students:$studentIds) {
      nodes { _id content points possiblePoints type owner { _id } }
    }
    formativeItem(id:$formativeItemId) { _id questionNumber text details { points } }
  }`;

  const questions = [];
  let skippedBlank = 0;
  let skippedMedia = 0;
  for (const item of selectedItems) {
    let detail;
    let feedbackHistoryAvailable = true;
    try {
      detail = await gql('query','ResultsSelectedItemSidebarAnswerDetails',{
        formativeItemId: String(item._id), studentIds
      },answerDetailsQuery);
    } catch {
      feedbackHistoryAvailable = false;
      detail = await gql('query','ResultsSelectedItemSidebarAnswerDetails',{
        formativeItemId: String(item._id), studentIds
      },answerDetailsBasicQuery);
    }
    const fi = detail?.formativeItem || item;
    const feedbackByAnswer = new Map();
    if (feedbackHistoryAvailable) {
      for (const message of detail?.formativeItem?.feedbackMessages?.nodes || []) {
        const answerId = String(message?.answer?._id || '');
        const text = richInfo(message?.text).text;
        if (!answerId || !text) continue;
        if (!feedbackByAnswer.has(answerId)) feedbackByAnswer.set(answerId, []);
        feedbackByAnswer.get(answerId).push({
          role: message?.from?.teacher === true ? 'enseignant' : (message?.from?.teacher === false ? 'élève' : 'échange'),
          text: text.length > 700 ? `${text.slice(0, 697)}…` : text
        });
      }
    }
    const qInfo = richInfo(item.text || fi?.text);
    const parentContext = parentContextFor(item);
    const qHasRubric = item?.details?.isRubricEnabled === true || (Array.isArray(item?.rubric?.criteria) && item.rubric.criteria.length > 0);
    const questionId = String(item._id);
    const capturedDefinition = getCapturedQuestionDefinition(questionId);
    const apiDefinition = await fetchQuestionDefinitionWithRetry(questionId);
    const definitionSources = [apiDefinition, capturedDefinition, item].filter(Boolean);
    const decoderDefinition = definitionSources.length > 1 ? { __cardinalQuestionSources: definitionSources } : (definitionSources[0] || item);
    const tokenMap = buildQuestionTokenMap(decoderDefinition, questionId);
    const expectedAnswers = collectCorrectReferences(decoderDefinition, tokenMap, questionId);
    const answers = [];
    for (const answer of detail?.answers?.nodes || []) {
      const sid = String(answer?.owner?._id || '');
      const meta = studentMap.get(sid) || { studentId:sid, studentLabel:'Réponse', studentName:'', studentEmail:'' };
      const aInfo = richInfo(answer?.content);
      const rawAnswerText = aInfo.text;
      const decodedAnswer = decodeStructuredAnswer(answer?.content, tokenMap, questionId, decoderDefinition);
      const resolvedChoiceText = resolveTokenFromCapturedNetwork(rawAnswerText, questionId) || resolveChoiceTokenFromDom(rawAnswerText);
      if (decodedAnswer.text) aInfo.text = decodedAnswer.text;
      else if (resolvedChoiceText) aInfo.text = resolvedChoiceText;
      const possiblePoints = Number(answer?.possiblePoints ?? fi?.details?.points ?? item?.details?.points ?? 0);
      const currentPoints = answer?.points === null || answer?.points === undefined ? null : Number(answer.points);
      const answerId = String(answer?._id || '');
      if (!answerId) continue;
      if (!aInfo.text) skippedBlank++;
      if (aInfo.hasMedia) skippedMedia++;
      const fingerprint = await hashText(`${answerId}|${String(item._id)}|${possiblePoints}|${stableSerialize(answer?.content)}`);
      answers.push({
        answerId,
        formativeItemId: String(item._id),
        studentId: sid,
        studentLabel: meta.studentLabel,
        studentName: meta.studentName,
        studentEmail: meta.studentEmail,
        answerText: aInfo.text,
        rawAnswerText: rawAnswerText && rawAnswerText !== aInfo.text ? rawAnswerText : '',
        choiceLabelResolved: !!resolvedChoiceText || (!!decodedAnswer.text && decodedAnswer.text !== rawAnswerText),
        structuredAnswers: decodedAnswer.values,
        unresolvedTokens: decodedAnswer.unresolvedTokens,
        possiblePoints,
        currentPoints,
        answerType: String(answer?.type || ''),
        hasMedia: !!aInfo.hasMedia,
        mediaTypes: aInfo.mediaTypes,
        feedbackHistory: (feedbackByAnswer.get(answerId) || []).slice(-4),
        feedbackHistoryAvailable,
        fingerprint
      });
    }
    questions.push({
      id: String(item._id),
      number: String(item.questionNumber || fi?.questionNumber || ''),
      text: qInfo.text,
      parentContext: parentContext.blocks,
      parentContextMissing: parentContext.missing,
      possiblePoints: Number(item?.details?.points ?? fi?.details?.points ?? 0),
      questionHasMedia: !!qInfo.hasMedia,
      questionMediaTypes: qInfo.mediaTypes,
      hasRubric: qHasRubric,
      rubricKnown,
      rubric: rubricText(item.rubric),
      questionType: String(item.subtype || item.type || ''),
      expectedAnswers,
      decoderDefinitionFound: !!decoderDefinition,
      decoderDefinitionSource: apiDefinition ? 'server' : (capturedDefinition ? 'captured-network' : 'formative-item'),
      answers
    });
  }

  return {
    ok: true,
    format: 'CARDINAL_FORMATIVE_PREPARED_V2',
    formativeId: String(f._id),
    title: String(f.title || 'Formative'),
    assignmentId: String(assignment._id),
    sectionId: String(assignment.section._id),
    sectionTitle: String(assignment.section.title || ''),
    groupCode: String(assignment.section.title || '').match(/(?:groupe|group)\s*([A-Za-z0-9-]+)\b/i)?.[1] || '',
    studentCount: Number(assignment.section.studentCount || orderedStudents.length),
    skippedBlank,
    skippedMedia,
    questions
  };
}

async function formativeAiPreflight091InsidePage(formativeId, assignmentId, sectionId, corrections, publishNotes, publishComments, trackedHeaders, allowChangedAnswers = false) {
  const API = 'https://svc.goformative.com/graphql';
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/graphql-response+json,application/json;q=0.9',
    ...(trackedHeaders || {})
  };

  async function gql(kind, name, variables, query) {
    const r = await fetch(`${API}/${kind}/${name}`, {
      method:'POST', headers,
      body:JSON.stringify({ operationName:name, variables, extensions:{clientLibrary:{name:'@apollo/client',version:'4.2.7'}}, query })
    });
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch {}
    if (!r.ok || data?.errors?.length) throw new Error(data?.errors?.[0]?.message || text || `HTTP ${r.status}`);
    return data?.data || {};
  }

  function richText(value) {
    const out = [];
    const walk = v => {
      if (v === null || v === undefined) return;
      if (typeof v === 'string') {
        const s = v.trim(); if (!s) return;
        if (s.startsWith('{') || s.startsWith('[')) { try { walk(JSON.parse(s)); return; } catch {} }
        out.push(s); return;
      }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === 'object') {
        if (typeof v.text === 'string') out.push(v.text);
        if (v.answer !== undefined) walk(v.answer);
        if (Array.isArray(v.content)) v.content.forEach(walk);
      }
    };
    walk(value);
    return out.join(' ').replace(/\s+/g,' ').trim();
  }

  function normalizeComment(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  async function hashText(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...digest].map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function stableSerialize(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }

  const list = Array.isArray(corrections) ? corrections : [];
  if (!list.length) throw new Error('Aucune correction à publier.');
  const questionIds = [...new Set(list.map(x => String(x.questionId || x.formativeItemId || '')).filter(Boolean))];

  const assignmentQ = `query Results($formativeId: ID!) {
    formative(id:$formativeId){ _id assignments:teacherAssignments{_id section{_id title}} }
  }`;
  const rd = await gql('query','Results',{formativeId},assignmentQ);
  const exactAssignment = (rd?.formative?.assignments || []).find(a => String(a?._id || '') === String(assignmentId) && String(a?.section?._id || '') === String(sectionId));
  if (!exactAssignment) throw new Error('La classe liée à cette correction n’est plus assignée à ce Formative.');

  const studentsQ = `query ResultsSummarySection($sectionId: ID!, $assignmentId: ID!, $archivedEnrollments: Boolean) {
    students:users(sections:[$sectionId],assignments:[$assignmentId],archivedEnrollments:$archivedEnrollments){nodes{_id}}
  }`;
  const sd = await gql('query','ResultsSummarySection',{sectionId,assignmentId,archivedEnrollments:false},studentsQ);
  const studentIds = (sd?.students?.nodes || []).map(s => String(s?._id || '')).filter(Boolean);

  const answerMap = new Map();
  const existingComments = new Map();
  const rubricByQuestion = new Map();
  let commentsSafe = true;
  let rubricSafe = true;

  const fullQ = `query ResultsSelectedItemSidebarAnswerDetails($formativeItemId: ID!, $studentIds: [ID!]!) {
    answers(formativeItemId:$formativeItemId,students:$studentIds){nodes{_id content points possiblePoints owner{_id}}}
    formativeItem(id:$formativeItemId){
      _id
      details { isRubricEnabled }
      feedbackMessages(orderBy:{field:CREATED,direction:ASC},includeReplies:true,studentIds:$studentIds){
        nodes{_id text answer{_id} from{_id teacher}}
      }
    }
  }`;
  const noFeedbackQ = `query ResultsSelectedItemSidebarAnswerDetails($formativeItemId: ID!, $studentIds: [ID!]!) {
    answers(formativeItemId:$formativeItemId,students:$studentIds){nodes{_id content points possiblePoints owner{_id}}}
    formativeItem(id:$formativeItemId){_id details { isRubricEnabled }}
  }`;
  const basicQ = `query ResultsSelectedItemSidebarAnswerDetails($formativeItemId: ID!, $studentIds: [ID!]!) {
    answers(formativeItemId:$formativeItemId,students:$studentIds){nodes{_id content points possiblePoints owner{_id}}}
  }`;

  for (const qid of questionIds) {
    let detail = null;
    let gotFeedback = false;
    let gotRubric = false;
    try {
      detail = await gql('query','ResultsSelectedItemSidebarAnswerDetails',{formativeItemId:qid,studentIds},fullQ);
      gotFeedback = true; gotRubric = true;
    } catch {
      try {
        detail = await gql('query','ResultsSelectedItemSidebarAnswerDetails',{formativeItemId:qid,studentIds},noFeedbackQ);
        gotRubric = true;
      } catch {
        detail = await gql('query','ResultsSelectedItemSidebarAnswerDetails',{formativeItemId:qid,studentIds},basicQ);
      }
    }
    if (publishComments && !gotFeedback) commentsSafe = false;
    if (publishNotes && !gotRubric) rubricSafe = false;
    rubricByQuestion.set(qid, gotRubric ? (detail?.formativeItem?.details?.isRubricEnabled === true) : null);

    for (const a of detail?.answers?.nodes || []) {
      const answerId = String(a?._id || '');
      if (!answerId) continue;
      const possiblePoints = Number(a?.possiblePoints || 0);
      const fingerprint = await hashText(`${answerId}|${qid}|${possiblePoints}|${stableSerialize(a?.content)}`);
      answerMap.set(answerId, {
        answerId,
        questionId: qid,
        studentId: String(a?.owner?._id || ''),
        possiblePoints,
        currentPoints: a?.points === null || a?.points === undefined ? null : Number(a.points),
        fingerprint
      });
    }

    if (gotFeedback) {
      for (const m of detail?.formativeItem?.feedbackMessages?.nodes || []) {
        if (m?.from?.teacher !== true) continue;
        const aid = String(m?.answer?._id || '');
        if (!aid) continue;
        const text = normalizeComment(richText(m?.text));
        if (!existingComments.has(aid)) existingComments.set(aid, new Map());
        existingComments.get(aid).set(text, String(m?._id || ''));
      }
    }
  }

  if (publishComments && !commentsSafe) {
    return { ok:false, safeToWrite:false, errors:[{kind:'comment',message:'Je n’ai pas pu lire les rétroactions existantes de façon fiable. Par sécurité, aucun commentaire n’a été publié pour éviter les doublons.'}] };
  }
  if (publishNotes && !rubricSafe) {
    return { ok:false, safeToWrite:false, errors:[{kind:'note',message:'Je n’ai pas pu vérifier les grilles structurées de façon fiable. Par sécurité, aucune note n’a été publiée.'}] };
  }

  const errors = [];
  const targets = [];
  const seen = new Set();
  for (const c of list) {
    const answerId = String(c.answerId || '').trim();
    if (!answerId || seen.has(answerId)) {
      errors.push({answerId,kind:'validation',message:!answerId?'Identifiant de réponse manquant.':'Réponse présente deux fois.'});
      continue;
    }
    seen.add(answerId);
    const target = answerMap.get(answerId);
    if (!target) {
      errors.push({answerId,kind:'stale',message:'Cette réponse n’existe plus dans la classe ou la question sélectionnée.'});
      continue;
    }
    const qid = String(c.questionId || c.formativeItemId || '');
    if (qid !== target.questionId) {
      errors.push({answerId,kind:'validation',message:'La question de cette réponse ne correspond plus.'});
      continue;
    }
    if (String(c.studentId || '') !== String(target.studentId || '')) {
      errors.push({answerId,kind:'validation',message:'L’élève associé à cette réponse ne correspond plus.'});
      continue;
    }
    const answerChanged = String(c.fingerprint || '') !== target.fingerprint;
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
    if (Math.abs(Number(c.possiblePoints) - Number(target.possiblePoints)) > 1e-9) {
      errors.push({answerId,kind:'stale',message:'Le maximum de la question a changé depuis la préparation.'});
      continue;
    }

    let noteState = 'none';
    let commentState = 'none';
    if (publishNotes && c.publishNote !== false) {
      if (rubricByQuestion.get(qid) === true) {
        errors.push({answerId,kind:'rubric',message:'Cette question utilise maintenant une grille structurée. La note automatique est bloquée.'});
        continue;
      }
      const desired = Number(c.points);
      if (!Number.isFinite(desired) || desired < 0 || desired > target.possiblePoints) {
        errors.push({answerId,kind:'validation',message:`Note invalide. Attendu : 0 à ${target.possiblePoints}.`});
        continue;
      }
      const original = c.originalPoints === null || c.originalPoints === undefined ? null : Number(c.originalPoints);
      const current = target.currentPoints;
      const sameAsOriginal = (original === null && current === null) || (original !== null && current !== null && Math.abs(original-current) < 1e-9);
      const sameAsDesired = current !== null && Math.abs(current-desired) < 1e-9;
      const changedAnswerOverride = allowChangedAnswers && answerChanged;
      if (!sameAsOriginal && !sameAsDesired && !changedAnswerOverride) {
        errors.push({answerId,kind:'conflict',message:'La note Formative a été modifiée depuis la préparation. Elle ne sera pas écrasée.'});
        continue;
      }
      noteState = sameAsDesired ? 'already' : 'write';
    }

    if (publishComments && c.publishComment !== false) {
      const comment = String(c.comment || '').trim();
      if (!comment) {
        errors.push({answerId,kind:'validation',message:'Commentaire vide.'});
        continue;
      }
      const existingId = existingComments.get(answerId)?.get(normalizeComment(comment)) || '';
      commentState = existingId ? 'already' : 'write';
      targets.push({ ...target, ...c, noteState, commentState, existingFeedbackMessageId: existingId });
    } else {
      targets.push({ ...target, ...c, noteState, commentState });
    }
  }

  if (errors.length) return { ok:false, safeToWrite:false, errors, targets:[] };
  return { ok:true, safeToWrite:true, errors:[], targets };
}

async function formativeAiWriteNote091InsidePage(answerIds, points, possiblePoints, trackedHeaders) {
  const API = 'https://svc.goformative.com/graphql';
  const headers = {'content-type':'application/json','accept':'application/graphql-response+json,application/json;q=0.9',...(trackedHeaders||{})};
  const mutation = `mutation ResultsSelectedItemSidebarGradeAnswers($answerIds:[ID!]!,$points:Float!,$scoreFactor:Float,$rubricLevels:[AnswerRubricLevelInput!]!){
    teacherGradeAnswers(answerIds:$answerIds,points:$points,scoreFactor:$scoreFactor,rubricLevels:$rubricLevels){_id gradedAt points possiblePoints scoreFactor updatedAt}
  }`;
  const r = await fetch(`${API}/mutation/ResultsSelectedItemSidebarGradeAnswers`,{
    method:'POST',headers,
    body:JSON.stringify({operationName:'ResultsSelectedItemSidebarGradeAnswers',variables:{answerIds,points,scoreFactor:possiblePoints>0?points/possiblePoints:null,rubricLevels:[]},extensions:{clientLibrary:{name:'@apollo/client',version:'4.2.7'}},query:mutation})
  });
  const text=await r.text();let data=null;try{data=JSON.parse(text)}catch{}
  if(!r.ok||data?.errors?.length)throw new Error(data?.errors?.[0]?.message||text||`HTTP ${r.status}`);
  const returned=data?.data?.teacherGradeAnswers;
  if(!Array.isArray(returned))throw new Error('Formative n’a pas retourné la liste des notes modifiées.');
  const byId=new Map(returned.map(x=>[String(x?._id||''),x]));
  const missing=(answerIds||[]).filter(id=>!byId.has(String(id)));
  if(missing.length)throw new Error(`Formative n’a pas confirmé ${missing.length} note${missing.length===1?'':'s'} demandée${missing.length===1?'':'s'}.`);
  const wrong=(answerIds||[]).filter(id=>{
    const row=byId.get(String(id));
    return row?.points===null||row?.points===undefined||Math.abs(Number(row.points)-Number(points))>1e-9;
  });
  if(wrong.length)throw new Error(`Formative a retourné une valeur inattendue pour ${wrong.length} note${wrong.length===1?'':'s'}.`);
  return {ok:true,updatedCount:answerIds.length};
}

async function formativeAiVerifyNotes091InsidePage(rows, trackedHeaders) {
  const API='https://svc.goformative.com/graphql';
  const headers={'content-type':'application/json','accept':'application/graphql-response+json,application/json;q=0.9',...(trackedHeaders||{})};
  async function gql(name,variables,query){
    const r=await fetch(`${API}/query/${name}`,{method:'POST',headers,body:JSON.stringify({operationName:name,variables,extensions:{clientLibrary:{name:'@apollo/client',version:'4.2.7'}},query})});
    const text=await r.text();let data=null;try{data=JSON.parse(text)}catch{}
    if(!r.ok||data?.errors?.length)throw new Error(data?.errors?.[0]?.message||text||`HTTP ${r.status}`);
    return data?.data||{};
  }
  const query=`query ResultsSelectedItemSidebarAnswerDetails($formativeItemId:ID!,$studentIds:[ID!]!){answers(formativeItemId:$formativeItemId,students:$studentIds){nodes{_id points possiblePoints owner{_id}}}}`;
  const expected=Array.isArray(rows)?rows.filter(r=>r?.answerId&&r?.questionId&&r?.studentId&&Number.isFinite(Number(r?.points))):[];
  const groups=new Map();
  for(const row of expected){const q=String(row.questionId);if(!groups.has(q))groups.set(q,[]);groups.get(q).push(row);}
  const verifyOnce=async()=>{
    const mismatches=[];
    for(const [qid,list] of groups){
      const studentIds=[...new Set(list.map(r=>String(r.studentId)).filter(Boolean))];
      const data=await gql('ResultsSelectedItemSidebarAnswerDetails',{formativeItemId:qid,studentIds},query);
      const byId=new Map((data?.answers?.nodes||[]).map(a=>[String(a?._id||''),a]));
      for(const row of list){
        const got=byId.get(String(row.answerId));
        if(!got||got?.points===null||got?.points===undefined||Math.abs(Number(got.points)-Number(row.points))>1e-9){
          mismatches.push({answerId:String(row.answerId),studentName:String(row.studentName||''),questionNumber:String(row.questionNumber||''),expected:Number(row.points),actual:got?.points===null||got?.points===undefined?null:Number(got.points)});
        }
      }
    }
    return mismatches;
  };
  let mismatches=await verifyOnce();
  if(mismatches.length){await new Promise(r=>setTimeout(r,450));mismatches=await verifyOnce();}
  return {ok:mismatches.length===0,mismatches};
}

async function formativeAiWriteComment091InsidePage(input, trackedHeaders) {
  const API = 'https://svc.goformative.com/graphql';
  const headers = {'content-type':'application/json','accept':'application/graphql-response+json,application/json;q=0.9',...(trackedHeaders||{})};
  function documentText(text) {
    const lines=String(text||'').replace(/\r\n/g,'\n').split(/\n+/).map(s=>s.trim()).filter(Boolean);
    return JSON.stringify({type:'doc',attrs:{dir:'auto'},content:(lines.length?lines:['']).map(line=>({type:'paragraph',attrs:{dir:'auto',textAlign:null},...(line?{content:[{type:'text',text:line}]}:{})}))});
  }
  const mutation=`mutation AddFeedbackMessage($input:AddFeedbackMessageInput!){addFeedbackMessage(input:$input){feedbackMessage{_id delayed}}}`;
  const r=await fetch(`${API}/mutation/AddFeedbackMessage`,{
    method:'POST',headers,
    body:JSON.stringify({operationName:'AddFeedbackMessage',variables:{input:{delayed:null,answerId:String(input.answerId),formativeItemId:String(input.questionId),studentId:String(input.studentId),text:documentText(input.comment)}},extensions:{clientLibrary:{name:'@apollo/client',version:'4.2.7'}},query:mutation})
  });
  const text=await r.text();let data=null;try{data=JSON.parse(text)}catch{}
  if(!r.ok||data?.errors?.length)throw new Error(data?.errors?.[0]?.message||text||`HTTP ${r.status}`);
  const id=String(data?.data?.addFeedbackMessage?.feedbackMessage?._id||'');
  if(!id)throw new Error('Formative n’a pas retourné l’identifiant du commentaire publié.');
  return {ok:true,feedbackMessageId:id};
}

async function formativeSnapshotForSection091InsidePage(formativeId, assignmentId, sectionId, trackedHeaders) {
  const API='https://svc.goformative.com/graphql';
  const headers={'content-type':'application/json','accept':'application/graphql-response+json,application/json;q=0.9',...(trackedHeaders||{})};
  async function gql(name,variables,query){const r=await fetch(`${API}/query/${name}`,{method:'POST',headers,body:JSON.stringify({operationName:name,variables,extensions:{clientLibrary:{name:'@apollo/client',version:'4.2.7'}},query})});const text=await r.text();let d=null;try{d=JSON.parse(text)}catch{}if(!r.ok||d?.errors?.length)throw new Error(d?.errors?.[0]?.message||text||`HTTP ${r.status}`);return d?.data||{}}
  function plainText(value){if(!value)return'';const out=[];const walk=v=>{if(v==null)return;if(typeof v==='string'){const s=v.trim();if(!s)return;if(s.startsWith('{')||s.startsWith('[')){try{walk(JSON.parse(s));return}catch{}}out.push(s);return}if(Array.isArray(v)){v.forEach(walk);return}if(typeof v==='object'){if(typeof v.text==='string')out.push(v.text);if(Array.isArray(v.content))v.content.forEach(walk)}};walk(value);return out.join(' ').replace(/\s+/g,' ').trim()}
  const resultsQ=`query Results($formativeId:ID!){formative(id:$formativeId){_id title assignments:teacherAssignments{_id section{_id title studentCount}} items{_id questionNumber type subtype text details{points}}}}`;
  const rd=await gql('Results',{formativeId},resultsQ);const f=rd?.formative;if(!f?._id)throw new Error('Formative introuvable ou session expirée.');
  const assignment=(f.assignments||[]).find(a=>String(a?._id||'')===String(assignmentId)&&String(a?.section?._id||'')===String(sectionId));if(!assignment)throw new Error('Classe Formative introuvable.');
  const studentsQ=`query ResultsSummarySection($sectionId:ID!,$assignmentId:ID!,$formativeId:ID!,$archivedEnrollments:Boolean){students:users(sections:[$sectionId],assignments:[$assignmentId],archivedEnrollments:$archivedEnrollments){nodes{_id emails{address} firstName lastName answers(formativeId:$formativeId,latestSubmissionOnly:true){nodes{_id points possiblePoints gradedAt formativeItem{_id}}}}}}`;
  let nodes=[];
  try{const sd=await gql('ResultsSummarySection',{sectionId,assignmentId,formativeId,archivedEnrollments:false},studentsQ);nodes=sd?.students?.nodes||[]}catch{
    const basicQ=`query ResultsSummarySection($sectionId:ID!,$assignmentId:ID!,$archivedEnrollments:Boolean){students:users(sections:[$sectionId],assignments:[$assignmentId],archivedEnrollments:$archivedEnrollments){nodes{_id emails{address} firstName lastName}}}`;
    const sd=await gql('ResultsSummarySection',{sectionId,assignmentId,archivedEnrollments:false},basicQ);const basic=sd?.students?.nodes||[];
    const answerQ=`query ResultsSummaryUserAnswers($userId:ID!,$formativeId:ID!,$latestSubmissionOnly:Boolean){student:user(id:$userId){_id answers(formativeId:$formativeId,latestSubmissionOnly:$latestSubmissionOnly){nodes{_id points possiblePoints gradedAt formativeItem{_id}}}}}`;
    for(let i=0;i<basic.length;i+=6){const batch=basic.slice(i,i+6);const loaded=await Promise.all(batch.map(async s=>{const x=await gql('ResultsSummaryUserAnswers',{userId:s._id,formativeId,latestSubmissionOnly:true},answerQ);return{...s,answers:x?.student?.answers||{nodes:[]}}}));nodes.push(...loaded)}
  }
  const questions=(f.items||[]).filter(x=>x?.type==='question').map(x=>({id:String(x._id||''),number:String(x.questionNumber||''),label:plainText(x.text)||`Question ${x.questionNumber||''}`.trim(),possiblePoints:Number(x?.details?.points||0),gradedCount:0}));
  const qmap=new Map(questions.map(q=>[q.id,q]));
  const students=nodes.map(s=>{const answers=(s?.answers?.nodes||[]).map(a=>{const qid=String(a?.formativeItem?._id||'');if(a?.points!==null&&a?.points!==undefined&&Number.isFinite(Number(a.points))&&qmap.has(qid))qmap.get(qid).gradedCount++;return{questionId:qid,answerId:String(a?._id||''),points:a?.points===null||a?.points===undefined?null:Number(a.points),possiblePoints:Number(a?.possiblePoints||0),gradedAt:a?.gradedAt||null}});const email=(s?.emails||[]).map(e=>String(e?.address||'').trim().toLowerCase()).find(Boolean)||'';return{id:String(s?._id||''),email,firstName:String(s?.firstName||''),lastName:String(s?.lastName||''),answers}}).filter(s=>s.email);
  return{id:String(f._id),formativeId:String(f._id),assignmentId:String(assignmentId),sectionId:String(sectionId),sectionTitle:String(assignment.section.title||''),groupCode:String(assignment.section.title||'').match(/(?:groupe|group)\s*([A-Za-z0-9-]+)\b/i)?.[1]||'',title:String(f.title||'Formative'),studentCount:Number(assignment.section.studentCount||students.length),questions,students};
}

async function getAi091Ledger(sessionId) {
  const key = AI091_LEDGER_PREFIX + String(sessionId || '');
  const data = await chrome.storage.local.get(key);
  return data?.[key] || { createdAt: Date.now(), updatedAt: Date.now(), notes:{}, comments:{} };
}

async function saveAi091Ledger(sessionId, ledger) {
  const key = AI091_LEDGER_PREFIX + String(sessionId || '');
  ledger.updatedAt = Date.now();
  await chrome.storage.local.set({ [key]: ledger });
}

async function pruneAi091Ledgers() {
  try {
    const all = await chrome.storage.local.get(null);
    const remove = [];
    for (const [key,value] of Object.entries(all || {})) {
      if (!key.startsWith(AI091_LEDGER_PREFIX)) continue;
      if (Date.now() - Number(value?.updatedAt || value?.createdAt || 0) > AI091_LEDGER_TTL_MS) remove.push(key);
    }
    if (remove.length) await chrome.storage.local.remove(remove);
  } catch {}
}

async function deliverFormativeAiFeedbackToGestion091(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!payload?.formativeId || !items.length) return false;
  let tabs = await chrome.tabs.query({ url: GESTION_URL });
  let tab = [...tabs].sort((a,b)=>Number(b.lastAccessed||0)-Number(a.lastAccessed||0))[0];
  if (!tab?.id) {
    tab = await chrome.tabs.create({url:'https://techno-cardi.github.io/Exercices-francais/resultats/?formativeFeedback=1',active:false});
    if (!tab?.id) return false;
    try{await waitForTabComplete(tab.id,45000)}catch{}
  }
  for(let i=0;i<20;i++){
    try{const r=await chrome.tabs.sendMessage(tab.id,{type:'FORMATIVE_CHATGPT_FEEDBACK_AVAILABLE',payload});if(r?.ok)return true}catch{}
    await sleepFormative(350);
  }
  return false;
}

async function handleFormativeAiRequest091(action, payload) {
  const formativeId = String(payload?.formativeId || '');
  let tab = await focusOrOpenFormative(formativeId);
  tab = await ensureFormativeSession091(tab);
  const tracked = formativeHeadersByTab.get(tab.id) || {};

  if (action === 'aiSectionsV2') {
    const rr = await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:formativeAiSections091InsidePage,args:[formativeId,tracked]});
    const out=rr?.[0]?.result;if(!out?.ok)throw new Error(out?.message||'Impossible de lire les classes et les questions.');return out;
  }

  if (action === 'aiQuestionDiagnosticV2') {
    const questionId=String(payload?.questionId||'');
    if(!questionId)throw new Error('Question manquante pour le diagnostic.');
    const rr=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:formativeQuestionDefinitionDiagnosticInsidePage,args:[formativeId,questionId,tracked]});
    const out=rr?.[0]?.result;
    if(!out?.ok)throw new Error(out?.message||'Impossible de produire le diagnostic de cette question.');
    return out;
  }

  if (action === 'aiPrepareV2') {
    await sendFormativeUi(tab.id,{title:'Préparation pour ChatGPT',message:'Je récupère exactement la classe, les questions et les réponses sélectionnées…',status:'working'});
    const rr=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:formativeAiPrepare091InsidePage,args:[formativeId,String(payload?.assignmentId||''),String(payload?.sectionId||''),payload?.questionIds||[],String(payload?.mode||'notes'),tracked]});
    const out=rr?.[0]?.result;if(!out?.ok)throw new Error(out?.message||'Impossible de préparer les réponses pour ChatGPT.');return out;
  }

  if (action === 'aiPublishV2') {
    await pruneAi091Ledgers();
    const sessionId=String(payload?.sessionId||'');
    if(!sessionId)throw new Error('Session de correction manquante. Reprépare le lot.');
    const publishLockKey=`${formativeId}|${sessionId}`;
    if(AI091_ACTIVE_PUBLISH_SESSIONS.has(publishLockKey)){
      return{ok:true,publishOk:false,partial:false,blocked:true,notesUpdated:0,commentsAdded:0,commentsSkippedDuplicate:0,errors:[{kind:'duplicate-submit',message:'Ce lot est déjà en cours de publication. Attends la fin de la première confirmation.'}]};
    }
    AI091_ACTIVE_PUBLISH_SESSIONS.add(publishLockKey);
    try {
    const publishNotes=payload?.publishNotes===true, publishComments=payload?.publishComments===true;
    if(!publishNotes&&!publishComments)throw new Error('Choisis Notes, Commentaires, ou les deux.');
    const corrections=(Array.isArray(payload?.corrections)?payload.corrections:[]).map(x=>({...x,publishNote:publishNotes&&x.publishNote!==false,publishComment:publishComments&&x.publishComment!==false}));
    if(!corrections.length)throw new Error('Aucune correction sélectionnée.');

    const bufferedPreview=await getPendingSimplePreview0934();
    if(!bufferedPreview || String(bufferedPreview?.context?.sessionId||'')!==sessionId || String(bufferedPreview?.context?.formativeId||'')!==formativeId || String(bufferedPreview?.context?.assignmentId||'')!==String(payload?.assignmentId||'') || String(bufferedPreview?.context?.sectionId||'')!==String(payload?.sectionId||'')){
      return{ok:true,publishOk:false,partial:false,blocked:true,notesUpdated:0,commentsAdded:0,commentsSkippedDuplicate:0,errors:[{kind:'batch',message:'Le tampon local ne correspond plus à ce lot Formative. Reprends la correction depuis la prévisualisation.'}]};
    }
    const bufferedByAnswerId=new Map((bufferedPreview.rows||[]).map(row=>[String(row?.answerId||''),row]));
    for(const correction of corrections){
      const buffered=bufferedByAnswerId.get(String(correction?.answerId||''));
      if(!buffered){
        return{ok:true,publishOk:false,partial:false,blocked:true,notesUpdated:0,commentsAdded:0,commentsSkippedDuplicate:0,errors:[{kind:'batch',message:`${correction?.questionNumber?`Q${correction.questionNumber} - `:''}${correction?.studentName||'Cible inconnue'} : cette correction ne fait pas partie du tampon local confirmé.`}]};
      }
      const sameTarget=String(correction?.questionId||correction?.formativeItemId||'')===String(buffered?.questionId||buffered?.formativeItemId||'') && String(correction?.studentId||'')===String(buffered?.studentId||'');
      const samePoints=(correction?.points===null||correction?.points===undefined)&&(buffered?.points===null||buffered?.points===undefined) || (Number.isFinite(Number(correction?.points))&&Number.isFinite(Number(buffered?.points))&&Math.abs(Number(correction.points)-Number(buffered.points))<1e-9);
      const sameComment=String(correction?.comment||'')===String(buffered?.comment||'');
      if(!sameTarget || !samePoints || !sameComment){
        return{ok:true,publishOk:false,partial:false,blocked:true,notesUpdated:0,commentsAdded:0,commentsSkippedDuplicate:0,errors:[{kind:'batch',message:`${buffered?.questionNumber?`Q${buffered.questionNumber} - `:''}${buffered?.studentName||'Cible'} : le payload de publication diffère du tampon local prévisualisé.`}]};
      }
    }

    await sendFormativeUi(tab.id,{title:'Vérification finale',message:'Je relis Formative avant toute écriture pour détecter les réponses ou notes modifiées…',status:'working'});
    const allowChangedAnswers=payload?.allowChangedAnswers===true;
    const pre=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:formativeAiPreflight091InsidePage,args:[formativeId,String(payload?.assignmentId||''),String(payload?.sectionId||''),corrections,publishNotes,publishComments,tracked,allowChangedAnswers]});
    const preflight=pre?.[0]?.result;
    if(!preflight?.ok){return{ok:true,publishOk:false,partial:false,blocked:true,notesUpdated:0,commentsAdded:0,commentsSkippedDuplicate:0,errors:preflight?.errors||[{message:'Vérification finale impossible.'}]};}

    const ledger=await getAi091Ledger(sessionId);
    let notesUpdated=0, notesAlready=0, commentsAdded=0, commentsSkippedDuplicate=0;
    const feedbackMessageIds={};
    const errors=[];

    if(publishNotes){
      const groups=new Map();
      for(const row of preflight.targets||[]){
        if(row.noteState==='already'){notesAlready++;ledger.notes[row.answerId]={points:Number(row.points),at:Date.now()};continue;}
        if(row.noteState!=='write')continue;
        const key=`${String(row.questionId||row.formativeItemId||'')}|${Number(row.points)}|${Number(row.possiblePoints)}`;
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
      }
      for(const [key,rows] of groups){
        const parts=key.split('|');
        const points=Number(parts[1]),possiblePoints=Number(parts[2]);
        try{
          const wr=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:formativeAiWriteNote091InsidePage,args:[rows.map(r=>r.answerId),points,possiblePoints,tracked]});
          const out=wr?.[0]?.result;if(!out?.ok)throw new Error(out?.message||'Formative n’a pas confirmé les notes.');
          notesUpdated+=rows.length;
          for(const r of rows)ledger.notes[r.answerId]={points,at:Date.now()};
          await saveAi091Ledger(sessionId,ledger);
        }catch(error){errors.push(...rows.map(r=>({answerId:r.answerId,kind:'note',message:error?.message||String(error)})));break;}
      }
    }

    if(publishNotes && !errors.length){
      const toVerify=(preflight.targets||[]).filter(r=>r.publishNote!==false&&r.points!==null&&r.points!==undefined&&Number.isFinite(Number(r.points)));
      if(toVerify.length){
        try{
          const vr=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:formativeAiVerifyNotes091InsidePage,args:[toVerify,tracked]});
          const verified=vr?.[0]?.result;
          if(!verified?.ok){
            const mm=Array.isArray(verified?.mismatches)?verified.mismatches:[];
            errors.push(...(mm.length?mm.map(x=>({answerId:x.answerId,kind:'note-verify',message:`Vérification échouée${x.studentName?` pour ${x.studentName}`:''}${x.questionNumber?` (Q${x.questionNumber})`:''} : attendu ${x.expected}, Formative retourne ${x.actual===null?'aucune note':x.actual}.`})):[{kind:'note-verify',message:'Formative n’a pas confirmé les notes après écriture.'}]));
          }
        }catch(error){errors.push({kind:'note-verify',message:`Impossible de relire les notes après écriture : ${error?.message||String(error)}`});}
      }
    }

    if(publishComments && !errors.length){
      for(const row of preflight.targets||[]){
        if(row.commentState==='already'){
          commentsSkippedDuplicate++;
          if(row.existingFeedbackMessageId)feedbackMessageIds[row.answerId]=row.existingFeedbackMessageId;
          ledger.comments[row.answerId]={comment:String(row.comment||''),feedbackMessageId:String(row.existingFeedbackMessageId||''),at:Date.now()};
          continue;
        }
        if(row.commentState!=='write')continue;
        try{
          const wr=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:formativeAiWriteComment091InsidePage,args:[{answerId:row.answerId,questionId:row.questionId,studentId:row.studentId,comment:String(row.comment||'')},tracked]});
          const out=wr?.[0]?.result;if(!out?.ok)throw new Error(out?.message||'Formative n’a pas confirmé le commentaire.');
          commentsAdded++;
          feedbackMessageIds[row.answerId]=String(out.feedbackMessageId||'');
          ledger.comments[row.answerId]={comment:String(row.comment||''),feedbackMessageId:String(out.feedbackMessageId||''),at:Date.now()};
          await saveAi091Ledger(sessionId,ledger);
        }catch(error){errors.push({answerId:row.answerId,kind:'comment',message:error?.message||String(error)});break;}
      }
    }
    await saveAi091Ledger(sessionId,ledger);

    let copiedToGestion=false;
    if(payload?.copyCommentsToGestion===true && publishComments){
      const successful=new Set((preflight.targets||[]).filter(r=>r.commentState==='already'||feedbackMessageIds[r.answerId]).map(r=>String(r.answerId)));
      const items=corrections.filter(c=>successful.has(String(c.answerId))&&String(c.comment||'').trim()).map(c=>({
        answerId:String(c.answerId),email:String(c.studentEmail||'').trim().toLowerCase(),formativeItemId:String(c.questionId||''),questionNumber:String(c.questionNumber||''),questionLabel:String(c.questionLabel||''),feedback:String(c.comment||'').trim(),feedbackMessageId:feedbackMessageIds[String(c.answerId)]||null
      })).filter(x=>x.email);
      if(items.length)copiedToGestion=await deliverFormativeAiFeedbackToGestion091({formativeId,groupCode:String(payload?.groupCode||''),items});
    }

    return{ok:true,publishOk:errors.length===0,partial:errors.length>0&&(notesUpdated+notesAlready+commentsAdded+commentsSkippedDuplicate>0),blocked:false,notesUpdated,notesAlready,notesVerified:publishNotes&&errors.length===0,commentsAdded,commentsSkippedDuplicate,feedbackMessageIds,copiedToGestion,errors};
    } finally {
      AI091_ACTIVE_PUBLISH_SESSIONS.delete(publishLockKey);
    }
  }

  if(action==='sendToGestionSectionV2'){
    await sendFormativeUi(tab.id,{title:'Mise à jour de Gestion des notes',message:'Je relis les résultats de cette classe dans Formative…',status:'working'});
    const rr=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:formativeSnapshotForSection091InsidePage,args:[formativeId,String(payload?.assignmentId||''),String(payload?.sectionId||''),tracked]});
    const snapshot=rr?.[0]?.result;if(!snapshot?.formativeId)throw new Error('Impossible de relire les résultats de cette classe.');
    await deliverFormativeImport(snapshot);
    return{ok:true,studentCount:snapshot.students?.length||0,questionCount:snapshot.questions?.length||0,groupCode:snapshot.groupCode};
  }

  throw new Error('Action ChatGPT/Formative inconnue.');
}

const handleFormativeRequestV081_091 = handleFormativeRequest;
handleFormativeRequest = async function(action, payload) {
  if (['aiSectionsV2','aiQuestionDiagnosticV2','aiPrepareV2','aiPublishV2','sendToGestionSectionV2'].includes(action)) {
    return handleFormativeAiRequest091(action, payload || {});
  }
  return handleFormativeRequestV081_091(action, payload);
};

// ===== background-v092.js =====
// v0.9.2: simple correction bridge + Mozaik discovery.
// Keep the proven Mozaik/Formative engines from v0.8.2/v0.9.1 and add thin orchestration only.

const SIMPLE_CONTEXT_KEY = 'cardinal_simple_formative_context_v0933';
const MOZAIK_DISCOVERY_KEY = 'cardinal_mozaik_discovery_v092';
const SIMPLE_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
const DISCOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// v0.9.1 can dynamically inject formative-ui.js. In v0.9.2 always inject the simple UI instead.
ensureFormativeUi = async function(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type:'CARDINAL_FORMATIVE_UI', title:'Formative', message:'', status:'working' });
  } catch {
    try { await chrome.scripting.executeScript({ target:{ tabId }, files:['formative.js'] }); } catch {}
  }
};

function normalizePersonName092(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function nameKeys092(value) {
  const n = normalizePersonName092(value);
  if (!n) return [];
  const p = n.split(' ').filter(Boolean);
  const out = new Set([n]);
  if (p.length >= 2) out.add([...p].reverse().join(' '));
  return [...out];
}

function parseGrade092(value, maxScore) {
  let raw = String(value ?? '').trim();
  if (!raw) return null;
  raw = raw.replace(',', '.').replace(/\s+/g, '');
  const fraction = raw.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const n = Number(fraction[1]), d = Number(fraction[2]);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
    return { value: n * Number(maxScore) / d, sourceMax: d };
  }
  const pct = raw.match(/^(-?\d+(?:\.\d+)?)%$/);
  if (pct) {
    const n = Number(pct[1]);
    if (!Number.isFinite(n)) return null;
    return { value: n * Number(maxScore) / 100, sourceMax: 100 };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return { value: n, sourceMax: Number(maxScore) };
}

async function getSimpleContext092() {
  const o = await chrome.storage.local.get(SIMPLE_CONTEXT_KEY);
  const ctx = o?.[SIMPLE_CONTEXT_KEY] || null;
  if (!ctx || !ctx.createdAt || Date.now() - Number(ctx.createdAt) > SIMPLE_CONTEXT_TTL_MS) {
    await chrome.storage.local.remove(SIMPLE_CONTEXT_KEY);
    return null;
  }
  return ctx;
}

async function saveSimpleContext092(ctx) {
  // Une nouvelle correction rend automatiquement tout ancien lot en attente obsolète.
  await chrome.storage.local.remove(SIMPLE_PENDING_PREVIEW_KEY);
  await chrome.storage.local.set({ [SIMPLE_CONTEXT_KEY]: { ...ctx, createdAt: Date.now() } });
}

async function clearSimpleContext0933() {
  await chrome.storage.local.remove([SIMPLE_CONTEXT_KEY, SIMPLE_PENDING_PREVIEW_KEY]);
  const tabs = await chrome.tabs.query({ url:['https://chatgpt.com/*','https://chat.openai.com/*'] }).catch(()=>[]);
  for (const tab of tabs || []) {
    if (!tab?.id) continue;
    chrome.tabs.sendMessage(tab.id,{type:'CARDINAL_SIMPLE_CONTEXT_CLEARED'}).catch(()=>{});
  }
}

function mapChatGptRows092(ctx, rows) {
  const question = ctx?.question;
  const answers = Array.isArray(question?.answers) ? question.answers : [];
  const maxScore = Number(question?.possiblePoints || 0);
  const index = new Map();
  for (const a of answers) {
    for (const key of nameKeys092(a.studentName)) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(a);
    }
  }

  const mapped = [];
  const unmatched = [];
  const ambiguous = [];
  const invalid = [];
  const seenAnswerIds = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.name || row?.student || row?.eleve || '').trim();
    if (!name) continue;
    const candidates = new Map();
    for (const key of nameKeys092(name)) {
      for (const a of index.get(key) || []) candidates.set(String(a.answerId), a);
    }
    const list = [...candidates.values()];
    if (!list.length) { unmatched.push(name); continue; }
    if (list.length !== 1) { ambiguous.push(name); continue; }
    const a = list[0];
    if (seenAnswerIds.has(String(a.answerId))) { ambiguous.push(name); continue; }

    const parsed = parseGrade092(row?.grade ?? row?.note ?? '', maxScore);
    const hasGrade = parsed !== null;
    const comment = String(row?.comment ?? row?.feedback ?? row?.commentaire ?? '').trim();
    if (!hasGrade && !comment) { invalid.push(`${name} : aucune note ni commentaire`); continue; }
    let grade = null;
    if (hasGrade) {
      grade = Math.round((Number(parsed.value) + Number.EPSILON) * 1000) / 1000;
      if (!Number.isFinite(grade) || grade < 0 || grade > maxScore + 1e-9) {
        invalid.push(`${name} : note invalide (${String(row?.grade ?? row?.note ?? '')})`);
        continue;
      }
    }
    seenAnswerIds.add(String(a.answerId));
    mapped.push({
      answerId: String(a.answerId),
      questionId: String(a.formativeItemId || question.id),
      formativeItemId: String(a.formativeItemId || question.id),
      studentId: String(a.studentId || ''),
      studentName: String(a.studentName || name),
      studentEmail: String(a.studentEmail || ''),
      questionNumber: String(question.number || ''),
      questionLabel: String(question.text || ''),
      possiblePoints: maxScore,
      originalPoints: a.currentPoints === null || a.currentPoints === undefined ? null : Number(a.currentPoints),
      points: hasGrade ? grade : null,
      comment,
      fingerprint: String(a.fingerprint || ''),
      publishNote: hasGrade,
      publishComment: !!comment
    });
  }

  return { mapped, unmatched, ambiguous, invalid, maxScore };
}


function contextQuestions1100(ctx) {
  return Array.isArray(ctx?.questions) && ctx.questions.length ? ctx.questions : (ctx?.question ? [ctx.question] : []);
}

function canonicalQuestionNumber1100(value) {
  const raw = String(value ?? '').trim();
  const m = raw.match(/(?:question|q)?\s*#?\s*(\d{1,3})/i);
  return m ? String(Number(m[1])) : '';
}

function rawGradeValue1100(row) {
  if (row && Object.prototype.hasOwnProperty.call(row, 'grade')) return row.grade;
  if (row && Object.prototype.hasOwnProperty.call(row, 'note')) return row.note;
  return '';
}

function sameGradeValue1100(a, b) {
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty || bEmpty) return aEmpty && bEmpty;
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

function sameCorrectionTarget1100(a, b) {
  return sameGradeValue1100(a?.points, b?.points) &&
    String(a?.comment || '') === String(b?.comment || '') &&
    Boolean(a?.publishNote) === Boolean(b?.publishNote) &&
    Boolean(a?.publishComment) === Boolean(b?.publishComment);
}

function mapChatGptRows1100(ctx, rows) {
  const questions = contextQuestions1100(ctx);
  const multi = questions.length > 1;
  const byNumber = new Map();
  for (const q of questions) {
    const n = canonicalQuestionNumber1100(q?.number);
    if (n) byNumber.set(n, q);
  }

  const indexes = new Map();
  for (const q of questions) {
    const idx = new Map();
    for (const a of Array.isArray(q?.answers) ? q.answers : []) {
      for (const key of nameKeys092(a.studentName)) {
        if (!idx.has(key)) idx.set(key, []);
        idx.get(key).push(a);
      }
    }
    indexes.set(String(q.id || ''), idx);
  }

  const mapped = [], unmatched = [], ambiguous = [], invalid = [], duplicatesIgnored = [];
  const mappedByTargetKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.name || row?.student || row?.eleve || '').trim();
    if (!name) continue;
    let question = questions[0] || null;
    if (multi) {
      const qn = canonicalQuestionNumber1100(row?.question ?? row?.questionNumber ?? row?.q ?? '');
      if (!qn) { invalid.push(`${name} : numéro de question manquant`); continue; }
      question = byNumber.get(qn) || null;
      if (!question) { invalid.push(`${name} : Q${qn} n’est pas dans le lot préparé`); continue; }
    }
    if (!question) { invalid.push(`${name} : question introuvable`); continue; }

    const qLabel = `Q${question.number || '?'} · `;
    const idx = indexes.get(String(question.id || '')) || new Map();
    const candidates = new Map();
    for (const key of nameKeys092(name)) {
      for (const a of idx.get(key) || []) candidates.set(String(a.answerId), a);
    }
    const list = [...candidates.values()];
    if (!list.length) { unmatched.push(`${qLabel}${name}`); continue; }
    if (list.length !== 1) { ambiguous.push(`${qLabel}${name}`); continue; }
    const a = list[0];

    const maxScore = Number(question.possiblePoints);
    if (!Number.isFinite(maxScore) || maxScore < 0 || (ctx?.mode !== 'comments' && maxScore <= 0)) {
      invalid.push(`${qLabel}${name} : maximum de la question invalide ou manquant`);
      continue;
    }

    const rawGrade = rawGradeValue1100(row);
    const gradeProvided = rawGrade !== null && rawGrade !== undefined && String(rawGrade).trim() !== '';
    const parsed = gradeProvided ? parseGrade092(rawGrade, maxScore) : null;
    const comment = String(row?.comment ?? row?.feedback ?? row?.commentaire ?? '').trim();
    if (gradeProvided && parsed === null) {
      invalid.push(`${qLabel}${name} : note « ${String(rawGrade)} » invalide; attendu un nombre entre 0 et ${maxScore}`);
      continue;
    }
    let hasGrade = parsed !== null;
    if (!hasGrade && !comment) { invalid.push(`${qLabel}${name} : aucune note ni commentaire`); continue; }
    if (ctx?.mode === 'comments' && hasGrade) { invalid.push(`${qLabel}${name} : le lot est en mode commentaires seulement, mais une note a été fournie`); continue; }
    if (hasGrade && a?.gradeEligible === false) {
      // Be tolerant when ChatGPT merely repeats the exact existing score beside a
      // requested comment. Treat it as "preserve existing note", not as a write.
      // A different score remains blocked unless the teacher explicitly prepared
      // the lot for reviewing already-graded answers.
      const proposed=Math.round((Number(parsed.value)+Number.EPSILON)*1000)/1000;
      const existing=a?.currentPoints===null||a?.currentPoints===undefined?null:Number(a.currentPoints);
      if(existing!==null&&Number.isFinite(existing)&&Number.isFinite(proposed)&&Math.abs(existing-proposed)<1e-9){
        hasGrade=false;
      }else{
        invalid.push(`${qLabel}${name} : cette réponse est présente pour commentaire seulement; son pointage Formative doit rester inchangé. Reprépare le lot avec « Inclure aussi les réponses déjà notées » si tu veux réellement revoir sa note.`);
        continue;
      }
    }

    let grade = null;
    if (hasGrade) {
      grade = Math.round((Number(parsed.value) + Number.EPSILON) * 1000) / 1000;
      if (!Number.isFinite(grade) || grade < 0 || grade > maxScore + 1e-9) {
        invalid.push(`${qLabel}${name} : note ${String(rawGrade)} invalide; maximum de la question = ${maxScore}`);
        continue;
      }
    }

    const mappedRow = {
      answerId: String(a.answerId),
      questionId: String(a.formativeItemId || question.id),
      formativeItemId: String(a.formativeItemId || question.id),
      studentId: String(a.studentId || ''),
      studentName: String(a.studentName || name),
      studentEmail: String(a.studentEmail || ''),
      questionNumber: String(question.number || ''),
      questionLabel: String(question.text || ''),
      possiblePoints: maxScore,
      originalPoints: a.currentPoints === null || a.currentPoints === undefined ? null : Number(a.currentPoints),
      points: hasGrade ? grade : null,
      comment,
      fingerprint: String(a.fingerprint || ''),
      publishNote: hasGrade,
      publishComment: !!comment
    };

    const targetKey = [String(ctx?.sessionId||''),String(ctx?.formativeId||''),mappedRow.questionId,mappedRow.studentId,mappedRow.answerId].join('|');
    const previous = mappedByTargetKey.get(targetKey);
    if (previous) {
      if (sameCorrectionTarget1100(previous, mappedRow)) {
        duplicatesIgnored.push(`${qLabel}${mappedRow.studentName}`);
      } else {
        const previousGrade = previous.points === null || previous.points === undefined ? 'aucune note' : `${previous.points}/${previous.possiblePoints}`;
        const nextGrade = mappedRow.points === null || mappedRow.points === undefined ? 'aucune note' : `${mappedRow.points}/${mappedRow.possiblePoints}`;
        invalid.push(`${qLabel}${mappedRow.studentName} : deux corrections différentes ont été reçues pour la même cible (${previousGrade} puis ${nextGrade})`);
      }
      continue;
    }

    mappedByTargetKey.set(targetKey, mappedRow);
    mapped.push(mappedRow);
  }
  return { mapped, unmatched, ambiguous, invalid, duplicatesIgnored, questionCount: questions.length };
}

function technicalPreviewBlock1100(preview = {}) {
  // Only corrupt/unmappable rows are blockers. A partial but unambiguous table is
  // safe to preview and publish as a partial import: absent rows simply remain
  // unchanged in Formative. Completeness is surfaced prominently to the teacher.
  return [
    preview.unmatched,
    preview.ambiguous,
    preview.invalid
  ].some(list => Array.isArray(list) && list.length > 0);
}

async function focusOrOpenChatGpt092() {
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*','https://chat.openai.com/*'] });
  let tab = [...tabs].sort((a,b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0];
  if (tab?.id) {
    try { await chrome.windows.update(tab.windowId, { focused:true }); } catch {}
    try { await chrome.tabs.update(tab.id, { active:true }); } catch {}
    return tab;
  }
  return chrome.tabs.create({ url:'https://chatgpt.com/', active:true });
}

const SIMPLE_PENDING_PREVIEW_KEY = 'cardinal_simple_pending_preview_v092';
const SIMPLE_PENDING_PREVIEW_TTL_MS = 12 * 60 * 60 * 1000;

async function getPendingSimplePreview0934() {
  const o = await chrome.storage.local.get(SIMPLE_PENDING_PREVIEW_KEY);
  const preview = o?.[SIMPLE_PENDING_PREVIEW_KEY] || null;
  // Les anciens lots sans horodatage (versions <= 0.9.5.0) sont considérés périmés.
  if (!preview?.createdAt || Date.now() - Number(preview.createdAt) > SIMPLE_PENDING_PREVIEW_TTL_MS) {
    if (preview) await chrome.storage.local.remove(SIMPLE_PENDING_PREVIEW_KEY);
    return null;
  }
  return preview;
}

async function discardPendingSimplePreview0951() {
  await chrome.storage.local.remove(SIMPLE_PENDING_PREVIEW_KEY);
  return { ok:true };
}

async function retryPendingSimplePreview0934() {
  const preview = await getPendingSimplePreview0934();
  if (!preview?.context?.formativeId || !Array.isArray(preview?.rows) || !preview.rows.length) {
    throw new Error('Aucun envoi Formative en attente.');
  }
  const tab = await focusOrOpenFormative(String(preview.context.formativeId || ''));
  await ensureFormativeUi(tab.id);
  try {
    await chrome.tabs.sendMessage(tab.id, { type:'CARDINAL_SIMPLE_IMPORT_PREVIEW', preview });
  } catch {
    await ensureFormativeUi(tab.id);
    await sleepFormative(150);
    await chrome.tabs.sendMessage(tab.id, { type:'CARDINAL_SIMPLE_IMPORT_PREVIEW', preview });
  }
  const qs=Array.isArray(preview.context?.questions)?preview.context.questions:[];
  return {
    ok:true,
    recognized:preview.rows.length,
    questionNumber:preview.context?.question?.number || null,
    questionCount:qs.length || (preview.context?.question?1:0),
    sectionTitle:preview.context?.sectionTitle || '',
    title:preview.context?.title || ''
  };
}

async function deliverSimplePreview092(payload) {
  const ctx = await getSimpleContext092();
  if (!ctx) throw new Error('Le lot Formative n’est plus en mémoire. Retourne dans Formative et prépare de nouveau la correction.');
  const expectedSession=String(payload?.contextSessionId||'').trim();
  if(expectedSession && expectedSession!==String(ctx?.sessionId||'')) throw new Error('Le lot Formative a changé depuis que ce tableau a été préparé. Reprends la correction depuis Formative.');

  const questions=contextQuestions1100(ctx);
  if(!questions.length) throw new Error('Aucune question n’est associée au lot Formative actif.');
  if(questions.length===1){
    const hintedQuestion=String(payload?.questionNumberHint||'').trim();
    const activeQuestion=String(questions[0]?.number||'').trim();
    if(hintedQuestion && activeQuestion && String(Number(hintedQuestion))!==String(Number(activeQuestion))) {
      throw new Error(`Sécurité Cardinal : ce tableau correspond à Q${hintedQuestion}, mais la question active dans Formative est Q${activeQuestion}. Reprépare la bonne question avant de publier.`);
    }
  }

  const parsed = mapChatGptRows1100(ctx, payload?.rows || []);
  // A comments-only return is allowed to target only the students who actually
  // need feedback. Missing students/questions are therefore not an error as long
  // as every supplied row maps cleanly and no grade is present. Grade-bearing
  // tables keep the strict completeness requirement.
  const allowPartialComments=parsed.mapped.length>0 && parsed.mapped.every(r=>r?.publishNote!==true && r?.publishComment===true);
  const mappedQuestionIds=new Set(parsed.mapped.map(r=>String(r.questionId||r.formativeItemId||'')).filter(Boolean));
  // A selected question with zero answers sent to ChatGPT is not "missing". It is
  // intentionally present for batch identity/context only and expects no table row.
  // Completeness applies only to rows whose NOTE is actually eligible for
  // reevaluation. Already-graded or blank rows may stay in the context solely so
  // ChatGPT can later generate a comment without Cardinal demanding a note row.
  const questionsExpectingRows=questions.filter(q=>Array.isArray(q?.answers)&&q.answers.some(a=>a?.gradeEligible!==false));
  const missingQuestions=allowPartialComments?[]:questionsExpectingRows.filter(q=>!mappedQuestionIds.has(String(q.id||''))).map(q=>String(q.number||'?'));
  const mappedAnswerIds=new Set(parsed.mapped.map(r=>String(r.answerId||'')).filter(Boolean));
  const missingRows=[];
  if(!allowPartialComments){
    for(const q of questions){
      for(const a of Array.isArray(q?.answers)?q.answers:[]){
        if(a?.gradeEligible===false) continue;
        const aid=String(a?.answerId||'');
        if(aid && !mappedAnswerIds.has(aid)) missingRows.push(`Q${q?.number||'?'} · ${String(a?.studentName||'élève')}`);
      }
    }
  }
  if (!parsed.mapped.length) {
    const detail = [...parsed.unmatched, ...parsed.ambiguous, ...parsed.invalid].slice(0,8).join(', ');
    throw new Error(`Aucun résultat n’a pu être associé au lot Formative${detail ? ` : ${detail}` : '.'}`);
  }

  const minimalQuestions=questions.map(q=>({id:String(q.id||''),number:String(q.number||''),text:String(q.text||''),possiblePoints:Number(q.possiblePoints||0)}));
  const preview = {
    context: {
      formativeId: ctx.formativeId,
      assignmentId: ctx.assignmentId,
      sectionId: ctx.sectionId,
      sectionTitle: ctx.sectionTitle,
      groupCode: ctx.groupCode,
      title: ctx.title,
      sessionId: ctx.sessionId,
      mode: ctx.mode || 'notes',
      notePublishingBlocked: !!ctx.notePublishingBlocked,
      questions: minimalQuestions,
      question: minimalQuestions.length===1?minimalQuestions[0]:null,
      partialComments: allowPartialComments
    },
    rows: parsed.mapped,
    unmatched: parsed.unmatched,
    ambiguous: parsed.ambiguous,
    invalid: parsed.invalid,
    duplicatesIgnored: parsed.duplicatesIgnored || [],
    missingQuestions,
    missingRows,
    partialImport: missingQuestions.length>0 || missingRows.length>0,
    blockPublication: technicalPreviewBlock1100({
      unmatched: parsed.unmatched,
      ambiguous: parsed.ambiguous,
      invalid: parsed.invalid,
      missingQuestions,
      missingRows
    }),
    source: String(payload?.source || 'ChatGPT'),
    createdAt: Date.now()
  };
  await chrome.storage.local.set({ [SIMPLE_PENDING_PREVIEW_KEY]: preview });
  const tab = await focusOrOpenFormative(String(ctx.formativeId || ''));
  await ensureFormativeUi(tab.id);
  try {
    await chrome.tabs.sendMessage(tab.id, { type:'CARDINAL_SIMPLE_IMPORT_PREVIEW', preview });
  } catch {
    await ensureFormativeUi(tab.id);
    await sleepFormative(150);
    await chrome.tabs.sendMessage(tab.id, { type:'CARDINAL_SIMPLE_IMPORT_PREVIEW', preview }).catch(() => {});
  }
  return { ok:true, recognized:parsed.mapped.length, questionCount:parsed.questionCount, unmatched:parsed.unmatched.length, ambiguous:parsed.ambiguous.length, invalid:parsed.invalid.length, duplicatesIgnored:(parsed.duplicatesIgnored||[]).length, missing:missingRows.length };
}

// -------- Mozaik discovery ----------------------------------------------------
function academicYearKey092() {
  const d = new Date();
  const start = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${start+1}`;
}

function parseMozaikDiscoveryUrl092(url) {
  const u = String(url || '');
  const out = [];
  let m;
  if ((m = u.match(/\/api\/evaluation\/planifications\/(\d+)\/groupes\/([^/?#]+)/i))) {
    out.push({ establishmentId:m[1], id:decodeURIComponent(m[2]), kind:'course' });
  }
  if ((m = u.match(/\/api\/organisationscolaire\/groupes\/(\d+)\/([^/?#]+)\/membres/i))) {
    out.push({ establishmentId:m[1], id:decodeURIComponent(m[2]), kind:'matter' });
  }
  if ((m = u.match(/\/api\/evaluation\/apprentissage\/(\d+)\/activites\/groupe\/([^/?#]+)/i))) {
    const id = decodeURIComponent(m[2]);
    out.push({ establishmentId:m[1], id, kind:/\d{4}M\d+-[^/]+$/i.test(id) ? 'matter' : 'course' });
  }
  if ((m = u.match(/\/api\/evaluation\/resultats\/(\d+)\/[^?#]*?\/groupe\/([^/?#]+)/i))) {
    out.push({ establishmentId:m[1], id:decodeURIComponent(m[2]), kind:'matter' });
  }
  if ((m = u.match(/^https:\/\/mozaikportail\.ca\/(\d+)\/groupes\/([^/?#]+)/i))) {
    out.push({ establishmentId:m[1], id:decodeURIComponent(m[2]), kind:'course' });
  }
  return out;
}

async function rememberDiscoveryUrl092(url) {
  const items = parseMozaikDiscoveryUrl092(url);
  if (!items.length) return;
  const o = await chrome.storage.local.get(MOZAIK_DISCOVERY_KEY);
  const root = o?.[MOZAIK_DISCOVERY_KEY] || {};
  const year = academicYearKey092();
  root[year] = root[year] || { seen:[], updatedAt:0 };
  const seen = new Map((root[year].seen || []).map(x => [`${x.kind}|${x.establishmentId}|${x.id}`, x]));
  for (const item of items) seen.set(`${item.kind}|${item.establishmentId}|${item.id}`, { ...item, at:Date.now() });
  root[year].seen = [...seen.values()].slice(-400);
  root[year].updatedAt = Date.now();
  await chrome.storage.local.set({ [MOZAIK_DISCOVERY_KEY]: root });
}

try {
  chrome.webRequest.onCompleted.addListener(
    details => { rememberDiscoveryUrl092(details.url).catch(() => {}); },
    { urls:['https://mozaikportail.ca/*','https://apiaffaires.mozaikportail.ca/*'] }
  );
} catch {}

async function scanMozaikPage092(tabId) {
  const rr = await chrome.scripting.executeScript({
    target:{ tabId }, world:'MAIN',
    func:() => {
      const urls = new Set([location.href]);
      try { document.querySelectorAll('a[href]').forEach(a => urls.add(a.href)); } catch {}
      try { performance.getEntriesByType('resource').forEach(e => e?.name && urls.add(e.name)); } catch {}
      return [...urls];
    }
  });
  const urls = Array.isArray(rr?.[0]?.result) ? rr[0].result : [];
  for (const u of urls) await rememberDiscoveryUrl092(u);
  return urls;
}

function groupCodeFromMozaikId092(id) {
  const m = String(id || '').match(/-([A-Za-z0-9]+)$/);
  return m ? m[1] : '';
}

function subjectCodeFromMatterId092(id) {
  const m = String(id || '').match(/M(\d+)-[A-Za-z0-9]+$/i);
  return m ? m[1] : '';
}

async function getDiscoveryCandidates092(groupCode) {
  const o = await chrome.storage.local.get(MOZAIK_DISCOVERY_KEY);
  const root = o?.[MOZAIK_DISCOVERY_KEY] || {};
  const bucket = root[academicYearKey092()] || { seen:[] };
  return (bucket.seen || []).filter(x => groupCodeFromMozaikId092(x.id) === String(groupCode));
}

function chooseDiscovery092(candidates, groupCode) {
  const yearStart = Number(academicYearKey092().split('-')[0] || 0);
  const currentYearId = x => !yearStart || String(x?.id || '').includes(String(yearStart));
  let course = candidates.filter(x => x.kind === 'course');
  let matter = candidates.filter(x => x.kind === 'matter');
  const currentCourse = course.filter(currentYearId), currentMatter = matter.filter(currentYearId);
  if (currentCourse.length) course = currentCourse;
  if (currentMatter.length) matter = currentMatter;
  const coursePreferred = course.find(x => /CFRA/i.test(x.id)) || course[course.length - 1] || null;
  let matterPreferred = null;
  if (coursePreferred) matterPreferred = matter.filter(x => x.establishmentId === coursePreferred.establishmentId).slice(-1)[0] || null;
  matterPreferred = matterPreferred || matter[matter.length - 1] || null;
  const establishmentId = String(coursePreferred?.establishmentId || matterPreferred?.establishmentId || '');
  if (!coursePreferred || !matterPreferred || !establishmentId) return null;
  const subjectCode = subjectCodeFromMatterId092(matterPreferred.id);
  if (!subjectCode) return null;
  return {
    code:String(groupCode),
    establishmentId,
    groupCourseId:String(coursePreferred.id),
    groupMatterId:String(matterPreferred.id),
    subjectCode
  };
}

async function discoverMozaikGroup092(groupCode, force=false) {
  const code = String(groupCode || '').trim();
  if (!code) throw new Error('Groupe manquant.');

  let candidates = await getDiscoveryCandidates092(code);
  let chosen = chooseDiscovery092(candidates, code);
  const hadCachedGroup = !!chosen;

  let tab = await focusOrOpenMozaik({ waitComplete:true });
  tab = await waitForAuthenticatedMozaikTab(tab.id, 180000);
  await scanMozaikPage092(tab.id).catch(() => {});
  candidates = await getDiscoveryCandidates092(code);
  chosen = chooseDiscovery092(candidates, code);

  // If the course group is known but the matter group has not been observed yet,
  // load the roster view. Mozaik normally requests /membres there, which exposes
  // the exact matter-group id without guessing it.
  if (!chosen) {
    const yearStart = Number(academicYearKey092().split('-')[0] || 0);
    let courseCandidates = candidates.filter(x => x.kind === 'course');
    const currentCourses = courseCandidates.filter(x => !yearStart || String(x.id || '').includes(String(yearStart)));
    if (currentCourses.length) courseCandidates = currentCourses;
    const c = courseCandidates.find(x => /CFRA/i.test(x.id)) || courseCandidates.slice(-1)[0];
    if (c?.establishmentId && c?.id) {
      const rosterUrl = `https://mozaikportail.ca/${c.establishmentId}/groupes/${c.id}/eleves/liste`;
      try {
        await chrome.tabs.update(tab.id, { url:rosterUrl, active:true });
        await waitForTabComplete(tab.id, 45000);
        await sleep(1800);
        await scanMozaikPage092(tab.id);
      } catch {}
      candidates = await getDiscoveryCandidates092(code);
      chosen = chooseDiscovery092(candidates, code);
    }
  }

  if (!chosen) {
    return { ok:false, message:`Je n’ai pas encore pu détecter automatiquement les deux identifiants Mozaïk du groupe ${code}. Ouvre une fois la liste des élèves de ce groupe dans Mozaïk, puis réessaie.`, candidates };
  }

  let roster = [];
  try {
    const rr = await chrome.scripting.executeScript({ target:{tabId:tab.id}, world:'MAIN', func:extractOfficialRoster, args:[chosen] });
    roster = Array.isArray(rr?.[0]?.result) ? rr[0].result : [];
  } catch {}
  return { ok:true, group:chosen, roster, source:hadCachedGroup&&!force?'cache+live-roster':'live' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CARDINAL_SAVE_SIMPLE_CONTEXT') {
    (async()=>{
      try { await saveSimpleContext092(message.context || {}); sendResponse({ok:true}); }
      catch(error){ sendResponse({ok:false,message:error?.message||String(error)}); }
    })();
    return true;
  }

  if (message?.type === 'CARDINAL_CLEAR_SIMPLE_CONTEXT') {
    (async()=>{
      try { await clearSimpleContext0933(); sendResponse({ok:true}); }
      catch(error){ sendResponse({ok:false,message:error?.message||String(error)}); }
    })();
    return true;
  }

  if (message?.type === 'CARDINAL_GET_SIMPLE_CONTEXT') {
    (async()=>{
      try { sendResponse({ok:true,context:await getSimpleContext092()}); }
      catch(error){ sendResponse({ok:false,message:error?.message||String(error)}); }
    })();
    return true;
  }

  if (message?.type === 'CARDINAL_OPEN_CHATGPT') {
    (async()=>{
      try { const tab=await focusOrOpenChatGpt092(); sendResponse({ok:!!tab?.id}); }
      catch(error){ sendResponse({ok:false,message:error?.message||String(error)}); }
    })();
    return true;
  }

  if (message?.type === 'CARDINAL_CHATGPT_RESULTS') {
    (async()=>{
      const payload=message.payload||{};
      try {
        globalThis.CardinalDiagnostics?.record?.('correction-preview','start',{rowCount:Array.isArray(payload.rows)?payload.rows.length:0,batchIdHint:payload.batchIdHint||null,contextSessionId:payload.contextSessionId||null,questionNumbersHint:payload.questionNumbersHint||[]});
        const result=await deliverSimplePreview092(payload);
        globalThis.CardinalDiagnostics?.record?.('correction-preview','result',{ok:result?.ok===true,recognized:result?.recognized||0,questionCount:result?.questionCount||0,unmatched:result?.unmatched||0,ambiguous:result?.ambiguous||0,invalid:result?.invalid||0,missing:result?.missing||0});
        sendResponse(result);
      }
      catch(error){globalThis.CardinalDiagnostics?.record?.('correction-preview','error',{message:error?.message||String(error)},'error');sendResponse({ok:false,message:error?.message||String(error)});}
    })();
    return true;
  }

  if (message?.type === 'CARDINAL_GET_PENDING_PREVIEW') {
    (async()=>{
      try {
        const preview = await getPendingSimplePreview0934();
        sendResponse({ok:true,preview});
      } catch(error) { sendResponse({ok:false,message:error?.message||String(error)}); }
    })();
    return true;
  }

  if (message?.type === 'CARDINAL_RETRY_PENDING_PREVIEW') {
    (async()=>{
      try { sendResponse(await retryPendingSimplePreview0934()); }
      catch(error){ sendResponse({ok:false,message:error?.message||String(error)}); }
    })();
    return true;
  }

  if (message?.type === 'CARDINAL_DISCARD_PENDING_PREVIEW') {
    (async()=>{
      try { sendResponse(await discardPendingSimplePreview0951()); }
      catch(error){ sendResponse({ok:false,message:error?.message||String(error)}); }
    })();
    return true;
  }

  if (message?.type === 'DISCOVER_MOZAIK_GROUP') {
    (async()=>{
      try { sendResponse(await discoverMozaikGroup092(message.groupCode, message.force === true)); }
      catch(error){ sendResponse({ok:false,message:error?.message||String(error)}); }
    })();
    return true;
  }
});

// Global Formative result import: keep all question-level grading in Formative,
// but mark the outgoing snapshot so Gestion des notes can default to one global evaluation result.
const handleFormativeRequestV091_092 = handleFormativeRequest;
handleFormativeRequest = async function(action, payload) {
  if (action === 'sendGlobalToGestionV3') {
    const formativeId = String(payload?.formativeId || '');
    cardinalDiagnosticRecord112('global-to-gestion','request.start',{formativeId,assignmentId:String(payload?.assignmentId||''),sectionId:String(payload?.sectionId||'')});
    try{
      if (!formativeId) throw new Error('Formative manquant.');
      let tab = await focusOrOpenFormative(formativeId);
      tab = await ensureFormativeSession091(tab);
      const tracked = formativeHeadersByTab.get(tab.id) || {};
      cardinalDiagnosticRecord112('global-to-gestion','session.ready',{tabId:tab.id,formativeId,hasAuthorization:typeof tracked.authorization==='string'&&tracked.authorization.length>20});
      await sendFormativeUi(tab.id,{title:'Résultat global',message:'Je relis toutes les questions et tous les résultats de cette classe…',status:'working'});
      const rr = await chrome.scripting.executeScript({
        target:{tabId:tab.id}, world:'MAIN', func:formativeSnapshotForSection091InsidePage,
        args:[formativeId,String(payload?.assignmentId||''),String(payload?.sectionId||''),tracked]
      });
      const snapshot = rr?.[0]?.result;
      cardinalDiagnosticRecord112('global-to-gestion','snapshot.read',{tabId:tab.id,formativeId,ok:!!snapshot?.formativeId,studentCount:snapshot?.students?.length||0,questionCount:snapshot?.questions?.length||0,groupCode:snapshot?.groupCode||null});
      if (!snapshot?.formativeId) throw new Error('Impossible de relire les résultats de cette classe.');
      snapshot.globalImport = true;
      snapshot.importIntent = 'global_evaluation_result';
      await deliverFormativeImport(snapshot);
      cardinalDiagnosticRecord112('global-to-gestion','delivery.success',{formativeId,studentCount:snapshot.students?.length||0,questionCount:snapshot.questions?.length||0,groupCode:snapshot.groupCode||null});
      return {ok:true,studentCount:snapshot.students?.length||0,questionCount:snapshot.questions?.length||0,groupCode:snapshot.groupCode};
    }catch(error){
      cardinalDiagnosticRecord112('global-to-gestion','request.error',{formativeId,assignmentId:String(payload?.assignmentId||''),sectionId:String(payload?.sectionId||''),message:error?.message||String(error)},'error');
      throw error;
    }
  }
  return handleFormativeRequestV091_092(action, payload);
};

// ===== background-v093.js =====
// v0.9.3 beta: safer annual Mozaik discovery.

// Formative stays visually untouched until Cardinal is explicitly invoked.
// When UI is needed, inject the working interface and its stealth layer together.
ensureFormativeUi = async function(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type:'CARDINAL_FORMATIVE_UI', title:'Formative', message:'', status:'working' });
  } catch {
    try {
      await chrome.scripting.executeScript({ target:{ tabId }, files:['formative.js','formative-stealth.js'] });
    } catch {}
  }
};

// Uses the last known Gestion mapping only as a navigation hint, then validates the
// discovered roster before the backend is allowed to replace group identifiers.

function cleanFallbackGroup093(value, groupCode) {
  const g = value && typeof value === 'object' ? value : {};
  const establishmentId = String(g.establishmentId || '').trim();
  const groupCourseId = String(g.groupCourseId || '').trim();
  const groupMatterId = String(g.groupMatterId || '').trim();
  const subjectCode = String(g.subjectCode || '').trim();
  const code = String(groupCode || g.code || '').trim();
  if (!/^\d+$/.test(establishmentId) || !code) return null;
  if (!groupCourseId.endsWith(`-${code}`) || !groupMatterId.endsWith(`-${code}`)) return null;
  return { code, establishmentId, groupCourseId, groupMatterId, subjectCode };
}

async function rosterForGroup093(tabId, group) {
  try {
    const rr = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: extractOfficialRoster,
      args: [group]
    });
    return Array.isArray(rr?.[0]?.result) ? rr[0].result : [];
  } catch {
    return [];
  }
}

async function navigateFallbackGroup093(tab, fallback) {
  const groupCourseId = currentizePortalId(fallback.groupCourseId, fallback.establishmentId);
  const groupMatterId = currentizePortalId(fallback.groupMatterId, fallback.establishmentId);
  const group = { ...fallback, groupCourseId, groupMatterId };
  const url = `https://mozaikportail.ca/${group.establishmentId}/groupes/${group.groupCourseId}/eleves/liste`;
  try {
    const current = await chrome.tabs.get(tab.id);
    if (!String(current?.url || '').includes(`/groupes/${group.groupCourseId}/`)) {
      await chrome.tabs.update(tab.id, { url, active: true });
      await waitForTabComplete(tab.id, 45000);
    }
    await sleep(1400);
    await scanMozaikPage092(tab.id).catch(() => {});
  } catch {}
  return group;
}

async function discoverMozaikGroup093(groupCode, force = false, fallbackGroup = null) {
  const code = String(groupCode || '').trim();
  if (!code) throw new Error('Groupe manquant.');

  // First use passive/live discovery. This is the preferred path and avoids navigation.
  let first = null;
  try { first = await discoverMozaikGroup092(code, force); } catch {}
  if (first?.ok && Array.isArray(first.roster) && first.roster.length) {
    return { ...first, source: `${first.source || 'live'}+validated-roster` };
  }

  const fallback = cleanFallbackGroup093(fallbackGroup, code);
  if (!fallback) return first || { ok:false, message:`Le groupe ${code} n'a pas encore pu être détecté automatiquement dans Mozaïk.` };

  let tab = await focusOrOpenMozaik({ waitComplete:true });
  tab = await waitForAuthenticatedMozaikTab(tab.id, 180000);
  const currentizedFallback = await navigateFallbackGroup093(tab, fallback);

  // Navigation to the list normally causes Mozaik to reveal the current course/matter IDs.
  let second = null;
  try { second = await discoverMozaikGroup092(code, true); } catch {}
  if (second?.ok) {
    const roster = Array.isArray(second.roster) && second.roster.length
      ? second.roster
      : await rosterForGroup093(tab.id, second.group);
    return { ...second, roster, source:'fallback-navigation+live' };
  }

  // Last safe fallback: currentize the previous year's IDs and ask the live members API.
  // Supabase v3 will refuse to save changed IDs unless the returned roster matches Gestion.
  const roster = await rosterForGroup093(tab.id, currentizedFallback);
  if (!roster.length) {
    return first || { ok:false, message:`Je n'ai pas pu valider la liste officielle du groupe ${code}. La configuration Mozaïk existante reste inchangée.` };
  }
  return { ok:true, group:currentizedFallback, roster, source:'fallback-currentized+validated-roster' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'DISCOVER_MOZAIK_GROUP_V2') return;
  (async () => {
    try {
      sendResponse(await discoverMozaikGroup093(message.groupCode, message.force === true, message.fallbackGroup || null));
    } catch (error) {
      sendResponse({ ok:false, message:error?.message || String(error) });
    }
  })();
  return true;
});

// ===== background-v094.js =====
// v0.9.4.0: durable Mozaik discovery.
// The live portal is authoritative. Calendar-derived school year is only a fallback.

const MOZAIK_DISCOVERY_KEY_V094 = 'cardinal_mozaik_discovery_v094';

function cleanGroupCode094(value) {
  return String(value || '').trim().slice(0, 40);
}

function schoolYearFallback094() {
  const d = new Date();
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
}

function yearFromMozaikId094(id, establishmentId) {
  const s = String(id || '');
  const e = String(establishmentId || '');
  if (!s || !e || !s.startsWith(e)) return null;
  const m = s.slice(e.length).match(/^(20\d{2})/);
  return m ? Number(m[1]) : null;
}

function groupCodeFromMozaikId094(id) {
  const m = String(id || '').match(/-([A-Za-z0-9][A-Za-z0-9-]{0,39})$/);
  return m ? m[1] : '';
}

function subjectCodeFromMatterId094(id) {
  const m = String(id || '').match(/M(\d+)-[A-Za-z0-9-]+$/i);
  return m ? m[1] : '';
}

function parseMozaikDiscoveryUrl094(url) {
  const u = String(url || '');
  const out = [];
  let m;
  const add = (establishmentId, id, kind) => {
    const decoded = decodeURIComponent(String(id || ''));
    const academicYearStart = yearFromMozaikId094(decoded, establishmentId);
    const groupCode = groupCodeFromMozaikId094(decoded);
    if (!decoded || !groupCode) return;
    out.push({
      establishmentId: String(establishmentId || ''),
      id: decoded,
      kind,
      groupCode,
      academicYearStart,
      subjectCode: kind === 'matter' ? subjectCodeFromMatterId094(decoded) : '',
    });
  };

  if ((m = u.match(/\/api\/evaluation\/planifications\/(\d+)\/groupes\/([^/?#]+)/i))) add(m[1], m[2], 'course');
  if ((m = u.match(/\/api\/organisationscolaire\/groupes\/(\d+)\/([^/?#]+)\/membres/i))) add(m[1], m[2], 'matter');
  if ((m = u.match(/\/api\/evaluation\/apprentissage\/(\d+)\/activites\/groupe\/([^/?#]+)/i))) {
    const id = decodeURIComponent(m[2]);
    add(m[1], id, /\d{4}M\d+-[^/]+$/i.test(id) ? 'matter' : 'course');
  }
  if ((m = u.match(/\/api\/evaluation\/resultats\/(\d+)\/[^?#]*?\/groupe\/([^/?#]+)/i))) add(m[1], m[2], 'matter');
  if ((m = u.match(/^https:\/\/mozaikportail\.ca\/(\d+)\/groupes\/([^/?#]+)/i))) add(m[1], m[2], 'course');
  return out;
}

async function rememberDiscoveryUrl094(url) {
  const items = parseMozaikDiscoveryUrl094(url);
  if (!items.length) return;
  const saved = await chrome.storage.local.get(MOZAIK_DISCOVERY_KEY_V094);
  const root = saved?.[MOZAIK_DISCOVERY_KEY_V094] || { seen: [] };
  const seen = new Map((root.seen || []).map(x => [`${x.kind}|${x.establishmentId}|${x.id}`, x]));
  const now = Date.now();
  for (const item of items) {
    seen.set(`${item.kind}|${item.establishmentId}|${item.id}`, { ...item, at: now });
  }
  root.seen = [...seen.values()].sort((a,b) => Number(a.at||0)-Number(b.at||0)).slice(-900);
  root.updatedAt = now;
  await chrome.storage.local.set({ [MOZAIK_DISCOVERY_KEY_V094]: root });
}

try {
  chrome.webRequest.onCompleted.addListener(
    details => { rememberDiscoveryUrl094(details.url).catch(() => {}); },
    { urls:['https://mozaikportail.ca/*','https://apiaffaires.mozaikportail.ca/*'] }
  );
} catch {}

async function scanMozaikPage094(tabId) {
  const rr = await chrome.scripting.executeScript({
    target:{ tabId }, world:'MAIN',
    func:() => {
      const urls = new Set([location.href]);
      try { document.querySelectorAll('a[href]').forEach(a => urls.add(a.href)); } catch {}
      try { performance.getEntriesByType('resource').forEach(e => e?.name && urls.add(e.name)); } catch {}
      return [...urls];
    }
  });
  const urls = Array.isArray(rr?.[0]?.result) ? rr[0].result : [];
  for (const u of urls) await rememberDiscoveryUrl094(u);
  return urls;
}

async function allCandidates094(groupCode) {
  const code = cleanGroupCode094(groupCode);
  const saved = await chrome.storage.local.get(MOZAIK_DISCOVERY_KEY_V094);
  const root = saved?.[MOZAIK_DISCOVERY_KEY_V094] || { seen: [] };
  return (root.seen || []).filter(x => String(x.groupCode || '') === code);
}

function candidateContexts094(candidates, fallbackGroup = null) {
  const fallback = fallbackGroup && typeof fallbackGroup === 'object' ? fallbackGroup : {};
  const fallbackSubject = String(fallback.subjectCode || '').trim();
  const fallbackEstablishment = String(fallback.establishmentId || '').trim();
  const contexts = new Map();

  for (const item of candidates || []) {
    const year = Number(item.academicYearStart || 0);
    if (!year || year < 2000 || year > 2100) continue;
    const key = `${item.establishmentId}|${year}`;
    if (!contexts.has(key)) contexts.set(key, { establishmentId:String(item.establishmentId), academicYearStart:year, course:[], matter:[], latestAt:0 });
    const ctx = contexts.get(key);
    ctx[item.kind === 'matter' ? 'matter' : 'course'].push(item);
    ctx.latestAt = Math.max(ctx.latestAt, Number(item.at || 0));
  }

  const groups = [];
  for (const ctx of contexts.values()) {
    if (!ctx.course.length || !ctx.matter.length) continue;
    const courses = [...ctx.course].sort((a,b) => Number(b.at||0)-Number(a.at||0));
    const matters = [...ctx.matter].sort((a,b) => {
      const af = fallbackSubject && String(a.subjectCode) === fallbackSubject ? 1 : 0;
      const bf = fallbackSubject && String(b.subjectCode) === fallbackSubject ? 1 : 0;
      return bf-af || Number(b.at||0)-Number(a.at||0);
    });
    for (const c of courses.slice(0,4)) {
      for (const m of matters.slice(0,6)) {
        const subjectCode = String(m.subjectCode || subjectCodeFromMatterId094(m.id));
        if (!subjectCode) continue;
        const group = {
          code: String(m.groupCode || c.groupCode || ''),
          establishmentId: ctx.establishmentId,
          groupCourseId: String(c.id),
          groupMatterId: String(m.id),
          subjectCode,
          academicYearStart: ctx.academicYearStart,
        };
        let rank = ctx.latestAt;
        if (fallbackSubject && subjectCode === fallbackSubject) rank += 1e13;
        if (fallbackEstablishment && ctx.establishmentId === fallbackEstablishment) rank += 5e12;
        groups.push({ group, rank });
      }
    }
  }

  const dedup = new Map();
  for (const item of groups) {
    const g = item.group;
    const key = `${g.establishmentId}|${g.academicYearStart}|${g.groupCourseId}|${g.groupMatterId}`;
    const old = dedup.get(key);
    if (!old || item.rank > old.rank) dedup.set(key, item);
  }
  return [...dedup.values()].sort((a,b) => b.rank-a.rank);
}

async function rosterForCandidate094(tabId, group) {
  return rosterForGroup093(tabId, group);
}

async function candidatesWithRoster094(tabId, ranked, max = 8) {
  const out = [];
  for (const item of (ranked || []).slice(0, max)) {
    const roster = await rosterForCandidate094(tabId, item.group);
    if (!Array.isArray(roster) || !roster.length) continue;
    out.push({ group:item.group, roster, source:'live-observation', rank:item.rank });
  }
  return out;
}

function replaceYearInPortalId094(raw, establishmentId, year) {
  const s = String(raw || '');
  const e = String(establishmentId || '');
  if (!s || !e || !Number.isFinite(Number(year))) return s;
  return s.replace(new RegExp('^' + e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '20\\d{2}'), `${e}${Number(year)}`);
}

function cleanFallbackGroup094(value, groupCode) {
  const g = value && typeof value === 'object' ? value : {};
  const establishmentId = String(g.establishmentId || '').trim();
  const groupCourseId = String(g.groupCourseId || '').trim();
  const groupMatterId = String(g.groupMatterId || '').trim();
  const subjectCode = String(g.subjectCode || '').trim();
  const code = cleanGroupCode094(groupCode || g.code);
  const academicYearStart = Number(g.academicYearStart || yearFromMozaikId094(groupMatterId, establishmentId) || 0) || null;
  if (!/^\d+$/.test(establishmentId) || !code) return null;
  if (!groupCourseId.endsWith(`-${code}`) || !groupMatterId.endsWith(`-${code}`)) return null;
  return { code, establishmentId, groupCourseId, groupMatterId, subjectCode, academicYearStart };
}

async function latestObservedSchoolYear094() {
  const saved = await chrome.storage.local.get(MOZAIK_DISCOVERY_KEY_V094);
  const rows = saved?.[MOZAIK_DISCOVERY_KEY_V094]?.seen || [];
  const valid = rows.filter(x => Number(x.academicYearStart) >= 2000 && Number(x.academicYearStart) <= 2100)
    .sort((a,b) => Number(b.at||0)-Number(a.at||0));
  return Number(valid[0]?.academicYearStart || 0) || null;
}

async function navigateFallbackGroup094(tab, fallback) {
  const observedYear = await latestObservedSchoolYear094();
  const targetYear = observedYear || schoolYearFallback094();
  const groupCourseId = replaceYearInPortalId094(fallback.groupCourseId, fallback.establishmentId, targetYear);
  const groupMatterId = replaceYearInPortalId094(fallback.groupMatterId, fallback.establishmentId, targetYear);
  const group = { ...fallback, groupCourseId, groupMatterId, academicYearStart:targetYear };
  const url = `https://mozaikportail.ca/${group.establishmentId}/groupes/${group.groupCourseId}/eleves/liste`;
  try {
    const current = await chrome.tabs.get(tab.id);
    if (!String(current?.url || '').includes(`/groupes/${group.groupCourseId}/`)) {
      await chrome.tabs.update(tab.id, { url, active:true });
      await waitForTabComplete(tab.id, 45000);
    }
    await sleep(1500);
    await scanMozaikPage094(tab.id).catch(() => {});
  } catch {}
  return group;
}

async function discoverMozaikGroup094(groupCode, force = false, fallbackGroup = null) {
  const code = cleanGroupCode094(groupCode);
  if (!code) throw new Error('Groupe manquant.');

  let tab = await focusOrOpenMozaik({ waitComplete:true });
  tab = await waitForAuthenticatedMozaikTab(tab.id, 180000);

  // Fast path: the backend only stores mappings that already passed roster validation.
  // Re-check that exact mapping directly through the live members API. This avoids
  // navigating to /eleves/liste on every normal sync and avoids needless SPA reloads.
  const stored = cleanFallbackGroup094(fallbackGroup, code);
  if (stored && !force) {
    const roster = await rosterForCandidate094(tab.id, stored);
    if (Array.isArray(roster) && roster.length) {
      return {
        ok:true,
        group:stored,
        roster,
        candidates:[{ group:stored, roster, source:'stored-live-validation', rank:Number.MAX_SAFE_INTEGER }],
        source:'v095-stored-live-validation'
      };
    }
  }

  await scanMozaikPage094(tab.id).catch(() => {});

  let candidates = await allCandidates094(code);
  let ranked = candidateContexts094(candidates, fallbackGroup);
  let withRoster = await candidatesWithRoster094(tab.id, ranked);

  // A unique live candidate is safe to hand to the backend validator immediately.
  if (withRoster.length === 1) {
    const one = withRoster[0];
    return { ok:true, group:one.group, roster:one.roster, candidates:withRoster, source:'v094-live-unique' };
  }

  // If a course group is known but the matter ID has not been observed, navigate to
  // the official roster page so Mozaik itself reveals the matter-group members URL.
  if (!withRoster.length) {
    const recentCourse = [...candidates]
      .filter(x => x.kind === 'course')
      .sort((a,b) => Number(b.at||0)-Number(a.at||0))[0];
    if (recentCourse?.establishmentId && recentCourse?.id) {
      try {
        const rosterUrl = `https://mozaikportail.ca/${recentCourse.establishmentId}/groupes/${recentCourse.id}/eleves/liste`;
        await chrome.tabs.update(tab.id, { url:rosterUrl, active:true });
        await waitForTabComplete(tab.id, 45000);
        await sleep(1600);
        await scanMozaikPage094(tab.id);
      } catch {}
      candidates = await allCandidates094(code);
      ranked = candidateContexts094(candidates, fallbackGroup);
      withRoster = await candidatesWithRoster094(tab.id, ranked);
      if (withRoster.length === 1) {
        const one = withRoster[0];
        return { ok:true, group:one.group, roster:one.roster, candidates:withRoster, source:'v094-roster-navigation-unique' };
      }
    }
  }

  // Last navigation hint: use the previous validated mapping only to reach the likely
  // current roster page. The resulting IDs still need live roster validation server-side.
  const fallback = cleanFallbackGroup094(fallbackGroup, code);
  if (!withRoster.length && fallback) {
    const hinted = await navigateFallbackGroup094(tab, fallback);
    candidates = await allCandidates094(code);
    ranked = candidateContexts094(candidates, fallback);
    withRoster = await candidatesWithRoster094(tab.id, ranked);
    if (!withRoster.length) {
      const roster = await rosterForCandidate094(tab.id, hinted);
      if (roster.length) withRoster = [{ group:hinted, roster, source:'fallback-navigation', rank:0 }];
    }
  }

  if (!withRoster.length) {
    return {
      ok:false,
      message:`Je n’ai pas pu valider automatiquement le groupe ${code} dans Mozaïk. Ouvre la liste des élèves de ce groupe puis réessaie.`,
      candidates:ranked.slice(0,8).map(x => ({group:x.group, roster:[]})),
    };
  }

  // Multiple plausible groups are intentionally returned to Gestion. The backend knows
  // the expected Gestion roster and is the authority that may select/save one candidate.
  return {
    ok:true,
    ambiguous:withRoster.length > 1,
    group:withRoster[0].group,
    roster:withRoster[0].roster,
    candidates:withRoster.map(x => ({ group:x.group, roster:x.roster })),
    source:withRoster.length > 1 ? 'v094-live-multiple' : 'v094-live',
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'DISCOVER_MOZAIK_GROUP_V3') return;
  (async () => {
    try {
      sendResponse(await discoverMozaikGroup094(message.groupCode, message.force === true, message.fallbackGroup || null));
    } catch (error) {
      sendResponse({ ok:false, message:error?.message || String(error) });
    }
  })();
  return true;
});

// ===== v1.1.0 ChatGPT bridge recovery =====
// When an unpacked extension is reloaded, old content scripts in already-open tabs
// keep their DOM but lose chrome.runtime. Reinject the current bridge whenever the
// user returns to an existing ChatGPT tab, so no page refresh is normally required.
async function cardinalReinjectChatGptBridge1000(tabId) {
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

chrome.tabs.onActivated.addListener(({ tabId }) => {
  cardinalReinjectChatGptBridge1000(tabId).catch(() => {});
});

chrome.windows.onFocusChanged.addListener(async windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const tabs = await chrome.tabs.query({ active:true, windowId });
    if (tabs?.[0]?.id) await cardinalReinjectChatGptBridge1000(tabs[0].id);
  } catch {}
});


function cardinalDiagnosticRecord112(scope,event,data={},level='info'){
  try{ globalThis.CardinalDiagnostics?.record?.(scope,event,data,level); }catch{}
}

// ===== v1.1.0 Formative orchestration =====
// A popup-triggered action lives in the service worker, not in the current Formative
// content-script request. If Formative must reload once to expose its live session,
// the service worker survives that navigation and automatically resumes the exact
// action after the new page is ready. The user should never need a second click.
function cardinalCurrentExtensionBuild1000() {
  try {
    const manifest = chrome.runtime.getManifest();
    return String(manifest.version_name || manifest.version || '');
  } catch { return ''; }
}

async function cardinalWaitForFormativeBridgeV1000(tabId, timeoutMs = 12000) {
  const started = Date.now();
  const expectedBuild = cardinalCurrentExtensionBuild1000();
  let injectedCurrentBridge = false;
  while (Date.now() - started < timeoutMs) {
    // Always inject the files from THIS extension build at least once before
    // accepting a bridge. This avoids trusting a still-alive content script from
    // the previous unpacked-extension build.
    if (!injectedCurrentBridge) {
      try {
        await chrome.scripting.executeScript({ target:{tabId}, files:['formative.js','formative-stealth.js'] });
        injectedCurrentBridge = true;
        await sleepFormative(80);
      } catch {}
    }

    let ping = null;
    try { ping = await chrome.tabs.sendMessage(tabId, { type:'CARDINAL_SIMPLE_PING' }); } catch {}
    if (ping?.ok && (!expectedBuild || ping?.extensionBuild === expectedBuild)) return true;

    // If another/stale bridge answered, reinject the current package. The active
    // token in formative.js ensures only the newest injected instance responds.
    if (ping?.ok && expectedBuild && ping?.extensionBuild !== expectedBuild) {
      try {
        await chrome.scripting.executeScript({ target:{tabId}, files:['formative.js','formative-stealth.js'] });
        injectedCurrentBridge = true;
      } catch {}
    } else {
      try { await ensureFormativeUi(tabId); } catch {}
    }
    await sleepFormative(180);
  }
  return false;
}

async function cardinalRunFormativePopupActionV1000(tabId, action) {
  cardinalDiagnosticRecord112('formative-orchestrator','action.start',{tabId,action});
  try{
    if (!tabId) throw new Error('Onglet Formative introuvable.');
    let tab = await chrome.tabs.get(tabId);
    const url = String(tab?.url || '');
    const formativeId = url.match(/\/formatives\/([^/]+)\/results/i)?.[1] || '';
    cardinalDiagnosticRecord112('formative-orchestrator','tab.resolved',{tabId,action,formativeId,url});
    if (!formativeId) throw new Error('Ouvre un travail Formative dans l’onglet Réponses.');

    // This may reload the tab once, but the action continues here afterwards.
    tab = await ensureFormativeSession091(tab);
    cardinalDiagnosticRecord112('formative-orchestrator','session.ready',{tabId:tab.id,action,formativeId,hasAuthorization:formativeHasAuthorization091(tab.id)});
    await ensureFormativeUi(tab.id);
    cardinalDiagnosticRecord112('formative-orchestrator','ui.ensure.requested',{tabId:tab.id,action,formativeId});
    const ready = await cardinalWaitForFormativeBridgeV1000(tab.id);
    cardinalDiagnosticRecord112('formative-orchestrator','bridge.wait.complete',{tabId:tab.id,action,formativeId,ready});
    if (!ready) throw new Error('Cardinal n’a pas réussi à réactiver son interface dans Formative après l’actualisation.');

    const type = action === 'global' ? 'CARDINAL_SIMPLE_SEND_GLOBAL' : 'CARDINAL_SIMPLE_OPEN_CORRECTION';
    let lastError = null;
    for (let i = 0; i < 20; i++) {
      try {
        const r = await chrome.tabs.sendMessage(tab.id, { type });
        cardinalDiagnosticRecord112('formative-orchestrator','bridge.action.response',{tabId:tab.id,action,type,attempt:i+1,ok:r?.ok===true,message:r?.message||null});
        if (r?.ok) return { ok:true, action, formativeId, resumed:true };
        if (r?.message) lastError = new Error(r.message);
      } catch(error) {
        lastError = error;
        cardinalDiagnosticRecord112('formative-orchestrator','bridge.action.error',{tabId:tab.id,action,type,attempt:i+1,message:error?.message||String(error)},'error');
      }
      await sleepFormative(180);
    }
    throw lastError || new Error('L’action Cardinal n’a pas pu s’ouvrir dans Formative.');
  }catch(error){
    cardinalDiagnosticRecord112('formative-orchestrator','action.error',{tabId,action,message:error?.message||String(error)},'error');
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CARDINAL_STABLE_FORMATIVE_ACTION') return;
  (async () => {
    try {
      sendResponse(await cardinalRunFormativePopupActionV1000(Number(message.tabId || 0), String(message.action || 'correction')));
    } catch(error) {
      sendResponse({ ok:false, message:error?.message || String(error) });
    }
  })();
  return true;
});
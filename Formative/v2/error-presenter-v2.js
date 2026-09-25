(() => {
  'use strict';

  const MAP = Object.freeze({
    SESSION_REAUTH_REQUIRED: ['Reconnecte-toi à Formative, puis réessaie.', 'Ouvrir Formative', 'reauth'],
    SESSION_NOT_PROVEN: ['Cardinal ne peut pas confirmer ta session Formative. Recharge Formative, puis réessaie.', 'Revérifier', 'retry'],

    PACKAGE_REQUIRED: ['Aucun questionnaire Cardinal n’a été détecté dans cette réponse.', 'Analyser de nouveau', 'retry'],
    PACKAGE_TOO_LARGE: ['Le questionnaire préparé est trop volumineux pour être transmis en sécurité.', 'Voir les détails', 'details'],
    PACKAGE_BLOCK_TOO_LARGE: ['Le bloc technique Cardinal est trop volumineux pour être analysé en sécurité.', 'Voir les détails', 'details'],
    PACKAGE_SENTINEL_AMBIGUOUS: ['Plusieurs marqueurs de paquet Cardinal ont été trouvés dans le même bloc. Cardinal ne choisira pas au hasard.', 'Voir les détails', 'details'],
    PACKAGE_JSON_INCOMPLETE: ['Le paquet Cardinal est coupé ou incomplet. Aucun import ne sera proposé à partir de ce bloc.', 'Analyser de nouveau', 'retry'],
    PACKAGE_JSON_INVALID: ['Le paquet Cardinal contient un JSON invalide. Aucun import ne sera lancé.', 'Voir les détails', 'details'],
    PACKAGE_ENVELOPE_INVALID: ['Le paquet ne respecte pas le protocole Cardinal Formative v2 attendu.', 'Voir les détails', 'details'],
    PACKAGE_MULTIPLE_JSON_OBJECTS: ['Le bloc technique contient plusieurs objets JSON. Cardinal exige un seul paquet non ambigu.', 'Voir les détails', 'details'],
    PACKAGE_MULTIPLE_CANDIDATES: ['Plusieurs paquets Cardinal valides ont été détectés dans la même réponse. Garde une seule version avant l’import.', 'Voir les détails', 'details'],
    IMPORTER_COMMAND_SOURCE_FORBIDDEN: ['Cette commande d’import ne vient pas d’une surface Cardinal autorisée.', 'Voir les détails', 'details'],
    IMPORTER_COMMAND_TAB_REQUIRED: ['Cardinal ne peut pas relier cette commande à l’onglet ChatGPT qui l’a lancée. Recharge cette page puis réessaie.', 'Recharger', 'reload'],
    STALE_PREPARATION: ['Une préparation plus récente a remplacé celle-ci. Cardinal ignorera l’ancienne.', 'Utiliser la plus récente', 'retry'],
    STALE_UI_ACTION: ['Ce bouton appartient à une ancienne préparation. Utilise le bouton du résultat le plus récent.', 'Analyser de nouveau', 'retry'],
    PREPARATION_REQUIRED: ['Le questionnaire doit être revérifié avant de pouvoir être importé.', 'Revérifier', 'retry'],

    TARGET_REQUIRED: ['Cardinal doit savoir exactement quel Formative modifier avant de commencer.', 'Choisir le Formative', 'choose-target'],
    TARGET_READ_ONLY: ['Cette évaluation est en lecture seule avec la session actuelle.', 'Changer de Formative', 'choose-target'],
    TARGET_EDIT_PERMISSION_NOT_PROVEN: ['Cardinal ne peut pas confirmer que tu peux modifier cette évaluation.', 'Revérifier', 'retry'],
    TARGET_SELECTION_REQUIRED: ['Choisis l’évaluation Formative à utiliser.', 'Choisir', 'choose-target'],
    MULTIPLE_EDITABLE_TARGETS: ['Plusieurs évaluations Formative sont ouvertes. Choisis la bonne.', 'Choisir', 'choose-target'],
    MULTIPLE_TABS_SAME_TARGET: ['La même évaluation Formative est ouverte dans plusieurs onglets. Choisis l’onglet à utiliser pour garder une cible stable.', 'Choisir', 'choose-target'],
    NO_FORMATIVE_TAB: ['Aucun onglet Formative n’est ouvert. Ouvre l’évaluation cible, puis reviens ici.', 'Ouvrir Formative', 'reauth'],
    NO_EDITABLE_FORMATIVE_TAB: ['Cardinal voit Formative, mais aucun onglet ouvert ne peut être confirmé comme modifiable.', 'Revérifier', 'retry'],
    REQUESTED_TAB_NOT_FOUND: ['L’onglet Formative choisi n’existe plus. Cardinal ne choisira pas un autre onglet à ta place.', 'Choisir', 'choose-target'],
    REQUESTED_TAB_NOT_EDITABLE: ['L’onglet Formative choisi n’est plus modifiable avec la session actuelle.', 'Choisir', 'choose-target'],
    REQUESTED_TARGET_TAB_MISMATCH: ['L’onglet choisi affiche maintenant un autre Formative. Cardinal bloque l’import pour éviter d’écrire au mauvais endroit.', 'Revérifier', 'retry'],
    REQUESTED_TARGET_NOT_OPEN: ['Le Formative choisi n’est plus ouvert. Ouvre-le de nouveau avant l’import.', 'Choisir', 'choose-target'],
    TARGET_ID_MISMATCH: ['Le Formative ouvert n’est plus celui qui a été vérifié.', 'Revérifier', 'retry'],
    TARGET_TAB_CHANGED: ['L’onglet Formative a changé depuis la vérification.', 'Revérifier', 'retry'],
    TARGET_OBSERVATION_STALE: ['La vérification de Formative est trop ancienne. Cardinal va la refaire avant d’écrire.', 'Revérifier', 'retry'],
    TARGET_IMPORT_ALREADY_RUNNING: ['Un import Cardinal est déjà en cours pour ce Formative. Attends sa fin ou reprends cet import au lieu d’en lancer un deuxième.', 'Voir l’import en cours', 'details'],
    TARGET_PROBE_FAILED: ['Cardinal voit l’onglet Formative, mais n’arrive pas à confirmer son état ou tes droits de modification.', 'Revérifier', 'retry'],

    MUTATION_TARGET_CHANGED_SINCE_PREFLIGHT: ['Cette question a changé depuis la vérification. Cardinal n’a rien écrasé.', 'Revérifier', 'retry'],
    CREATE_TARGET_CHANGED_SINCE_PREFLIGHT: ['Le questionnaire Formative a changé depuis la vérification. Cardinal n’a rien créé.', 'Revérifier', 'retry'],
    SERVER_THREE_WAY_CONFLICT: ['La question a été modifiée à la fois dans Formative et dans le nouveau paquet. Choisis quelle version conserver.', 'Voir le conflit', 'resolve-conflict'],
    SOURCE_REQUIRED: ['Il manque une source nécessaire pour construire une correction fiable.', 'Voir la question', 'review'],
    TOTAL_POINTS_MISMATCH: ['Le total des points ne correspond pas au document. Vérifie le pointage avant l’import.', 'Voir les points', 'review'],
    BLOCKED_UNSUPPORTED_SUBTYPE: ['Ce type de question n’est pas encore importé de façon suffisamment fiable.', 'Voir la question', 'review'],
    CAPABILITY_PARTIAL: ['Cardinal sait déjà manipuler une partie de ce type de question, mais pas encore le relire et le comparer de bout en bout sans risque.', 'Voir la question', 'review'],
    CAPABILITY_NOT_PROVEN: ['Ce type de question n’est pas encore prouvé de bout en bout dans Cardinal.', 'Voir la question', 'review'],
    CAPABILITY_OPERATION_NOT_PROVEN: ['Cette opération n’est pas encore prouvée pour ce type de question. Cardinal la bloque plutôt que de tenter une conversion.', 'Voir la question', 'review'],
    PREFLIGHT_SERVER_SNAPSHOT_INCOMPLETE: ['Cardinal n’a pas reçu la liste complète des questions Formative. Aucun import n’a été lancé.', 'Réessayer', 'retry'],
    PREFLIGHT_SERVER_DETAIL_INCOMPLETE: ['Cardinal voit le questionnaire, mais il lui manque des détails pour comparer les questions existantes sans risque.', 'Revérifier', 'retry'],
    CREATE_PREFLIGHT_SNAPSHOT_INCOMPLETE: ['Cardinal ne peut pas confirmer l’état complet du questionnaire avant la création.', 'Réessayer', 'retry'],
    SERVER_DETAIL_READER_REQUIRED: ['Le Formative contient déjà des éléments et Cardinal doit les relire en détail avant de comparer ou modifier quoi que ce soit.', 'Revérifier', 'retry'],
    SERVER_READINESS_VALIDATOR_REQUIRED: ['La vérification détaillée du contenu Formative n’est pas disponible. Cardinal bloque l’écriture plutôt que de comparer à l’aveugle.', 'Voir les détails', 'details'],

    INCOMPLETE_JOURNAL_REQUIRES_RECOVERY: ['Un import précédent n’est pas terminé. Cardinal doit d’abord le reprendre ou vérifier son état.', 'Reprendre l’import', 'resume'],
    UNCERTAIN: ['Cardinal n’est pas certain que Formative ait enregistré la dernière opération. Il doit vérifier avant de réessayer.', 'Vérifier et reprendre', 'resume'],
    UNCERTAIN_UNPERSISTED: ['La dernière opération doit être vérifiée dans Formative avant toute nouvelle écriture.', 'Vérifier et reprendre', 'resume'],
    RECONCILIATION_FAILED: ['Cardinal n’arrive pas à confirmer ce qui a été enregistré. Aucune nouvelle écriture automatique ne sera faite.', 'Voir les détails', 'details'],
    RECONCILIATION_STATE_CHANGED: ['Le Formative a changé depuis que les correspondances ont été affichées. Cardinal doit les recalculer.', 'Revérifier', 'retry'],
    RECONCILIATION_APPROVAL_STALE: ['Une correspondance n’est plus identique à celle que tu avais confirmée. Cardinal ne l’utilisera pas sans nouvelle vérification.', 'Revérifier', 'retry'],
    CREATE_MULTIPLE_NEW_CANDIDATES: ['Plusieurs nouvelles questions pourraient correspondre à la création interrompue. Cardinal ne choisira pas au hasard.', 'Voir les détails', 'details'],
    CREATE_CANDIDATE_DIVERGED: ['Une nouvelle question est apparue, mais son contenu ne correspond plus exactement à ce qui était attendu.', 'Voir les détails', 'details'],
    INITIAL_NONEMPTY_TARGET_REQUIRES_RECONCILIATION: ['Ce Formative contient déjà des questions inconnues de Cardinal. Une première association est nécessaire pour éviter les doublons.', 'Vérifier le Formative', 'review'],
    DELETE_PROPOSED: ['Une question Cardinal n’est plus dans le paquet. Elle sera conservée tant que tu ne confirmes pas sa suppression.', 'Vérifier', 'review'],
    DELETE_PROPOSED_EXTERNAL_CHANGE: ['Une question absente du nouveau paquet a aussi été modifiée manuellement dans Formative. Elle ne sera pas supprimée automatiquement.', 'Vérifier', 'review'],

    MUTATION_POINTS_INVALID: ['Le pointage d’une question est invalide. Corrige-le avant l’import.', 'Voir les points', 'review'],
    MUTATION_POINTS_PRECISION: ['Formative recevra seulement des pointages à une décimale maximum. Corrige le pointage proposé.', 'Voir les points', 'review'],
    MUTATION_KEYWORD_EMPTY: ['Une question à correction automatique n’a aucune réponse active. Cardinal refuse de créer une question impossible à corriger.', 'Voir le corrigé', 'review'],
    MUTATION_KEYWORD_TEXT_EMPTY: ['Une réponse automatique vide s’est glissée dans le corrigé. Retire-la ou remplace-la.', 'Voir le corrigé', 'review'],
    MUTATION_KEYWORD_SCORE_RANGE: ['Un mot-clé vaut plus que le maximum de la question ou possède un pointage négatif.', 'Voir le corrigé', 'review'],
    MUTATION_KEYWORD_SCORE_PRECISION: ['Un mot-clé possède un pointage trop précis. Utilise au maximum une décimale.', 'Voir le corrigé', 'review'],
    MUTATION_KEYWORD_SCORE_CONFLICT: ['Le même mot-clé est associé à deux pointages différents. Cardinal ne choisira pas lequel appliquer.', 'Voir le corrigé', 'review'],
    MUTATION_MANUAL_WITH_ACTIVE_MATCHES: ['La question est marquée manuelle, mais contient encore des réponses automatiques actives. Choisis un seul mode de correction.', 'Voir le corrigé', 'review'],
    MUTATION_FITB_EMPTY: ['La question à trous ne contient aucun trou à répondre.', 'Voir la question', 'review'],
    MUTATION_FITB_ANSWERS_EMPTY: ['Au moins un trou n’a aucune réponse acceptée.', 'Voir le corrigé', 'review'],
    MUTATION_FITB_DUPLICATE_ANSWERS: ['Un trou contient deux réponses équivalentes en double. Nettoie le corrigé avant l’import.', 'Voir le corrigé', 'review'],
    MUTATION_MANUAL_FITB_UNSUPPORTED: ['La correction manuelle d’un texte à trous n’est pas encore branchée de façon sûre.', 'Voir la question', 'review'],
    MUTATION_FITB_PARTIAL_MODE_UNPROVEN: ['Ce mode de crédit partiel pour texte à trous n’est pas encore prouvé dans Formative.', 'Voir la question', 'review'],
    MUTATION_SUBTYPE_CONFLICT: ['La question existante n’est plus du même type que la question préparée. Cardinal ne la convertira pas silencieusement.', 'Vérifier la question', 'review'],
    FITB_EXISTING_KEYS_UNSAFE: ['Cardinal ne peut pas confirmer les identifiants internes des trous de cette question existante. Elle ne sera pas réécrite.', 'Vérifier la question', 'review'],
    KEYWORD_TO_MANUAL_TRANSITION_NOT_PROVEN: ['Cette question passerait d’une correction automatique à manuelle. Cardinal conserve l’ancien corrigé tant que le nettoyage natif n’est pas prouvé.', 'Vérifier la question', 'review'],

    FORMATIVE_RATE_LIMITED: ['Formative limite temporairement les requêtes. Cardinal n’enverra pas une deuxième mutation à l’aveugle.', 'Vérifier et reprendre', 'resume'],
    FORMATIVE_SERVER_ERROR: ['Formative a retourné une erreur serveur pendant l’opération. Cardinal doit vérifier l’état réel avant de reprendre.', 'Vérifier et reprendre', 'resume'],
    FORMATIVE_NETWORK_ERROR: ['La connexion a été interrompue pendant l’opération. Cardinal doit vérifier Formative avant tout nouvel essai.', 'Vérifier et reprendre', 'resume'],
    FORMATIVE_GRAPHQL_ERROR: ['Formative a refusé ou interrompu l’opération. Cardinal doit relire l’état avant tout nouvel essai.', 'Vérifier et reprendre', 'resume'],

    HOST_COMPATIBILITY_BLOCKED: ['La configuration de l’importeur entre en collision avec Gestion des notes. Cardinal désactive l’import plutôt que de risquer une régression.', 'Voir les détails', 'details'],
    STORAGE_SCOPE_COLLISION: ['La session Formative et l’historique d’import utilisent le même stockage. Cette configuration n’est pas sécuritaire.', 'Voir les détails', 'details'],
    RECOVERY_PLAN_MISSING: ['Un import incomplet existe, mais son plan de reprise est incomplet. Cardinal ne repartira pas de zéro.', 'Voir les détails', 'details'],
    RECOVERY_CONTRACT_INVALID: ['Le plan d’un import interrompu ne correspond plus au contrat enregistré. Cardinal bloque toute nouvelle écriture.', 'Voir les détails', 'details'],
    EXTENSION_CONTEXT_INVALIDATED: ['Cardinal a été mis à jour pendant que cette page était ouverte. Recharge la page une fois.', 'Recharger', 'reload']
  });

  function codeOf(input) {
    if (typeof input === 'string') return input;
    return input?.code || input?.reason || input?.lastError?.code || 'UNKNOWN_ERROR';
  }

  function rawMessage(input) {
    if (typeof input === 'string') return '';
    return input?.message || input?.lastError?.message || '';
  }

  function diagnosticDetails(input) {
    if (!input || typeof input === 'string') return '';
    const pairs = [
      ['tabId', input.tabId],
      ['expectedTargetFormativeId', input.expectedTargetFormativeId],
      ['urlTargetFormativeId', input.urlTargetFormativeId],
      ['targetFormativeId', input.targetFormativeId],
      ['serverTargetFormativeId', input.serverTargetFormativeId],
      ['observedTargetFormativeId', input.observedTargetFormativeId]
    ].filter(([, value]) => value != null && value !== '');
    return pairs.map(([key, value]) => `${key}: ${String(value)}`).join('\n');
  }

  function present(input, options = {}) {
    const code = codeOf(input);
    const row = MAP[code];
    const message = rawMessage(input);
    const diagnostics = diagnosticDetails(input);
    const technical = [message, diagnostics].filter(Boolean).join('\n');

    if (row) {
      return {
        code,
        title: options.title || (code.includes('UNCERTAIN') ? 'Vérification nécessaire' : 'Cardinal a protégé l’import'),
        message: row[0],
        action: { label: row[1], id: row[2] },
        technicalDetails: technical || null,
        showTechnicalByDefault: false
      };
    }

    return {
      code,
      title: 'Import interrompu',
      message: 'Cardinal a arrêté l’opération avant de continuer. Aucun nouvel essai automatique ne sera fait tant que l’état n’est pas vérifié.',
      action: { label: 'Voir les détails', id: 'details' },
      technicalDetails: technical || code,
      showTechnicalByDefault: false
    };
  }

  function summarizeIssues(issues = []) {
    const blockers = issues.filter(x => x?.severity === 'blocker');
    const warnings = issues.filter(x => x?.severity === 'warning');
    const primary = blockers[0] || warnings[0] || null;
    return {
      blockers: blockers.length,
      warnings: warnings.length,
      primary: primary ? present(primary) : null,
      details: issues.map(issue => ({ issue, presentation: present(issue) }))
    };
  }

  const api = { MAP, present, summarizeIssues, diagnosticDetails };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ErrorPresenter = api;
})();

# Cardinal AIO - Formative 1.1.12 diagnostics

Date: 2026-09-25

Cette version ajoute une couche de diagnostic durable afin qu'un échec ne soit plus analysé uniquement à partir de symptômes comme « le bouton ne fait rien ».

## Méthode suivie avant modification

Sources relues avant de toucher au build 1.1.11:

- `techno-cardi/database/Formative/SKILL.md`
- `Formative/README.md`
- `Formative/CURRENT_STATE.md`
- `Formative/MAINTENANCE_PLAYBOOK.md`
- `Formative/GESTION_NOTES_INTEGRATION_CONTRACT.md`
- `Formative/TROUBLESHOOTING_HISTORY.md`
- `Formative/SECURITY_AND_INVARIANTS.md`
- `Formative/VALIDATOR_V2_SPEC.md`
- `Formative/PROTOCOL_V2_PLAN.md`
- `techno-cardi/Exercices-francais/CHATGPT_PROJECT_INSTRUCTIONS.md`
- `resultats/docs/CURRENT_STATE.md`
- `resultats/docs/FORMATIVE_PROTOCOL.md`
- build AIO 1.1.11 exact ayant servi de base

La règle de maintenance demeure: lire la documentation et le code courant avant modification, réparer la couche fautive et conserver les autres workflows.

## Diagnostic utilisateur

Le popup Cardinal possède maintenant un panneau repliable `Diagnostic` avec:

- `Mode diagnostic approfondi`
- `Exporter`
- `Effacer`

Le journal léger est actif en permanence. Le mode approfondi augmente seulement la quantité de métadonnées nettoyées capturées.

Procédure recommandée pour un bug:

1. ouvrir Cardinal;
2. ouvrir `Diagnostic`;
3. activer le mode approfondi pour un bug réseau/DOM difficile;
4. cliquer `Effacer`;
5. reproduire le problème une fois;
6. cliquer `Exporter`;
7. joindre `Cardinal-diagnostic-*.json` au chat de dépannage.

## Ce que le rapport permet de voir

Le bundle `cardinal.diagnostics/1` contient notamment:

- version exacte du build, manifest et content scripts;
- onglets Formative, ChatGPT, Gestion et Mozaïk concernés;
- santé des bridges Formative/ChatGPT;
- présence de la session Formative sans exporter ses secrets;
- état du tampon de correction;
- état de l'importeur Formative v2;
- présence des boutons/modales et nombre de questions cochées;
- résolution de classe pour Résultat global -> Gestion;
- opérations GraphQL récentes Formative;
- statut HTTP, erreurs GraphQL et erreurs réseau;
- structure nettoyée des réponses serveur;
- étapes des commandes runtime;
- erreurs JavaScript et unhandled rejections des composants instrumentés.

## Résilience du diagnostic

`diagnostics.js` est importé avant les autres modules du service worker.

Les gros modules sont ensuite chargés dans des `try/catch` séparés. Si par exemple `legacy-service-worker.js` plante au chargement, la couche diagnostic reste vivante et peut rapporter le module fautif.

`popup-diagnostics.js` est aussi chargé avant `popup.js`. L'export diagnostic ne dépend donc pas entièrement du code principal du popup.

## Confidentialité

Conformément à `SECURITY_AND_INVARIANTS.md`, l'export nettoie ou n'exporte pas:

- Authorization;
- cookies;
- bearer/JWT/tokens;
- password/secret/API keys;
- emails;
- noms et identifiants personnels reconnus;
- texte brut des réponses élèves dans les branches answers/responses/submissions/feedback.

Les identifiants techniques nécessaires au dépannage peuvent rester visibles, par exemple formativeId, assignmentId, sectionId, question IDs et batch/session Cardinal.

Ne jamais demander à Kevin d'exporter un HAR actif pour ce diagnostic normal.

## Instrumentation ajoutée

- `diagnostics.js`: ring buffer session, sanitizer, export bundle, page snapshots, bridge health, GraphQL status.
- `popup-diagnostics.js`: contrôle et téléchargement du rapport.
- `formative.js`: préparation, sélection, lecture, batch, résultat global et erreurs.
- `formative-network.js`: statut/réponse structurée/erreurs GraphQL.
- `legacy-service-worker.js`: orchestration popup, correction, publication, résultat global.
- `runtime-message-router-v2.js`: PREPARE/APPLY/REPREPARE/RECONCILE/DISMISS/STATUS.
- `chatgpt-content-v2.js`: import de paquet ChatGPT -> Formative.
- `chatgpt.js`: retour correction ChatGPT -> Formative.
- `service-worker.js`: survie du diagnostic aux erreurs de chargement des autres modules.

## Build

- Version name: `1.2.0-formative-1.1.12-diagnostics-g118`
- ZIP: `Cardinal-AIO-1.2.0-Formative-1.1.12-diagnostics.zip`
- ZIP SHA-256: `081af8aa7ce978526637144c9069e4634a62241143c0a91ab38795adec022754`
- Patch 1.1.11 -> 1.1.12 SHA-256: `8a635ee84fc32a2cbe902b1d6f02a429dfea60c3d6f97d41fb148bba63f30785`

## Validation exécutée

- 69/69 JavaScript: `node --check` PASS;
- sanitizer Authorization/JWT/email/PII: PASS;
- export `cardinal.diagnostics/1` sans secrets: PASS;
- runtime router instrumenté sans capturer les messages étrangers: PASS;
- panne simulée d'un module worker: diagnostic encore vivant et erreur enregistrée: PASS;
- capture GraphQL succès, erreur GraphQL et erreur réseau: PASS;
- diagnostic popup chargé avant le popup principal: PASS;
- diagnostic service worker chargé avant les autres modules: PASS;
- bridge Formative 1.1.12: PASS;
- ZIP final réextrait et 69/69 JavaScript revérifiés: PASS.

Ce build ne doit être qualifié stable qu'après smoke test réel des workflows affectés.

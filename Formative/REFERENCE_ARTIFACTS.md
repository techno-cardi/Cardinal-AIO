# Artefacts de référence Formative

Dernière consolidation: 2026-09-20

Ce document inventorie les artefacts déjà produits pendant l'exploration et les baselines à conserver. Il sert à éviter de les chercher, régénérer ou confondre.

## 1. Dépôt vivant Cardinal / Gestion des notes

Repository:

`techno-cardi/Exercices-francais`

Documents canoniques à relire avant toute modification de production:

- `CHATGPT_PROJECT_INSTRUCTIONS.md`
- `resultats/docs/CURRENT_STATE.md`
- `resultats/docs/FORMATIVE_PROTOCOL.md`

Les SHA cités dans d'anciens échanges ne doivent jamais servir pour une future écriture sans fetch courant.

## 2. Dossier mémoire Formative

Repository:

`techno-cardi/database`

Dossier:

`Formative/`

Documents désormais prioritaires:

- `README.md`
- `SKILL.md`
- `CURRENT_STATE.md`
- `PROTOCOL_V2_PLAN.md`
- `MAINTENANCE_PLAYBOOK.md`
- `CAPABILITY_MATRIX.md`
- `API_GRAPHQL_NOTES.md`
- `TROUBLESHOOTING_HISTORY.md`
- `SECURITY_AND_INVARIANTS.md`
- `DISCOVERY_TIMELINE.md`

## 3. Contrat d'import historique v1

Schéma:

`cardinal.formative/1`

Le contrat v1 a servi aux tests réels du standalone 0.4.1.

Il reste la forme reconnue par la baseline actuelle.

Le futur `cardinal.formative/2` est documenté dans `PROTOCOL_V2_PLAN.md` mais n'est pas encore la baseline d'exécution.

## 4. Première cartographie

Artefacts historiques:

- `cardinal-formative-diagnostic.txt`
- `cardinal-formative-diagnostic.js`
- diagnostics JSON;
- mapper v1;
- mapper v2 AutoLab;
- mapper v2.1 Safe AutoLab.

Référence finale de cette phase: Mapper v2.1 Safe AutoLab.

## 5. Direct Lab v3

`cardinal-formative-direct-lab-v3.txt`

Rôle:

- création directe;
- bridge page-context;
- session en mémoire;
- test de subtypes;
- export nettoyé.

## 6. Prototype importer historique v0.1

Schéma historique:

`cardinal.formative.import/0.1`

Supportait shortAnswer / multipleChoice / fillInTheBlank.

Transport de cette génération obsolète à cause de `Failed to fetch`.

## 7. Générations transport/synchronisation v4-v12

Familles historiques:

- native replay;
- native piggyback;
- direct transport;
- direct API;
- live-sync probes;
- Apollo sync;
- SPA sync;
- stable create;
- native live create.

Historique ayant mené à v13.

## 8. Direct Live Sync v13

Preuve clé:

- permission edit;
- création directe;
- update;
- x-tab-id distinct;
- apparition live;
- route inchangée;
- aucun menu/navigation/reload requis pour rendre l'état visible.

## 9. Import Core v14.1

Preuve 4/4:

- Short Answer;
- Multiple Choice;
- Multiple Selection;
- Fill In The Blank.

## 10. Upsert Core v15-v15.1

Passage au modèle comparaison / create / update.

## 11. Extended / Smart Upsert v16-v16.8

Acquis:

- Long Answer;
- Inline Choice;
- Resequence;
- Matching;
- Categorize;
- plan CREATE/UPDATE/UNCHANGED;
- préservation items non Cardinal;
- conflits subtype;
- points avant answerChoicePoints.

## 12. Matching v16.9-v17.0

v17.0 = preuve principale du correctif Matching natif avec IDs préservés et `MatchingEditableDetailsContainerMutation`.

## 13. Keyword v17.1-v17.4

v17.4 = preuve serveur du scoring absolu.

Mode:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

## 14. Functionalized Text / passages v18.0-v18.1

v18.0:

- functionalizedText;
- TextEditableUpdate;
- parentId.

v18.1:

- parent functionalizedText;
- 3 enfants Short Answer;
- parentId partagé;
- succès complet.

## 15. Builder Standalone historique 0.1.x

Artefacts:

- `Cardinal-Formative-Builder-beta-0.8.2-PATCH.zip`
- `Cardinal-Formative-Builder-STANDALONE-0.1.0.zip`
- `Cardinal-Formative-Builder-STANDALONE-0.1.1.zip`

Statut actuel: historique. Supersédé pour la reprise par l'importer standalone 0.4.1.

## 16. Importer Standalone 0.3.x

Série de développement UX/intégration ayant permis de découvrir/corriger:

- barres dupliquées;
- placement DOM ChatGPT;
- progression perdue;
- masquage X trop large;
- session oubliée quand service worker dort;
- reloads Formative trop fréquents;
- progression Formative;
- answer keys Free Response;
- contexte extension invalidé.

Ne pas utiliser une sous-version 0.3.x comme nouvelle baseline.

## 17. Baseline actuelle: Standalone 0.4.1

Artefact:

`Cardinal-Formative-Importer-STANDALONE-0.4.1.zip`

SHA-256 ZIP:

`b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4`

Contenu et SHA-256:

| Fichier | SHA-256 |
| --- | --- |
| README.txt | `ed7c59afaa341357bad7a719b222fef11bb5b95bc0921c9eb591112a2dd9ce08` |
| background.js | `cfedbed3a6ffb2c5b67f0635815d7bfca59b75dcba46dfa5f03a0d53d1082ac8` |
| chatgpt-bridge.js | `abbed0442f85427454d2d288fe4073bad680d256918f34298331cf34f2e47fc3` |
| formative-engine.js | `5e145cb49160d1094c614a2ee6b6c296f679fa49f775464b3dbdf773fc4c2c7b` |
| formative-progress-ui.js | `1d63d7d67c4ea61ccc95aca2c68508dccd56d38d9d4fa75a83cc741d49858dd8` |
| formative-session-bridge.js | `bf676c777481c39b43e8a8dcabe8aa1da1825110dce61ddafe6fc614aa88fab2` |
| formative-session-main.js | `80252a59c95c9d6e1c3c82b2591b41307159d5b588554e7fe8833bafe514e2b4` |
| manifest.json | `27c31b7e45b4d70de54f9594a79493789ffc44c0f603d4d3247a3064a99fc329` |
| popup.html | `fba73fa02f15a557e7c2f5e55ee9b8433033e545ad37df354b633cd99c077d8` |
| popup.js | `2d158de022a0bca8a44d2f56c32c0ba014dfa5465cac514740aaafdf465ccd8d` |
| smoke-test-package.json | `b422e599b682e6060d364df86c09e4f5783ac5d80cf92fed41864990f5ae31f4` |

### Fonctions validées 0.4.1

- bridge ChatGPT durci;
- erreurs de paquet visibles;
- import multiquestions réel;
- progression ChatGPT;
- progression Formative;
- session locale réutilisée;
- bootstrap initial;
- Short Answer Keyword;
- Long Answer Keyword;
- update ciblé;
- réimport unchanged;
- récupération prudente sans mapping local;
- contexte extension invalidé récupéré;
- manifest.key stable.

### Cycle réel de validation

Questionnaire Tchernobyl:

1. import complet;
2. modification Q16;
3. update de la même question;
4. aucune duplication;
5. réimport identique;
6. déjà à jour / unchanged.

## 18. Snapshot source 0.4.1

Le dépôt doit conserver le source exact sous:

`Formative/standalone-0.4.1/`

Fichiers à considérer autoritaires pour reconstruire la baseline:

- manifest.json;
- background.js;
- chatgpt-bridge.js;
- formative-engine.js;
- formative-progress-ui.js;
- formative-session-main.js;
- formative-session-bridge.js;
- popup.html;
- popup.js;
- README.txt;
- smoke-test-package.json.

La valeur `manifest.key` du snapshot doit être conservée dans toutes les futures versions dérivées pour garder la même identité Chrome.

## 19. Futur protocole v2

Document:

`PROTOCOL_V2_PLAN.md`

Objectif 0.5.0:

- bouton Préparer pour Formative;
- protocole autonome;
- cardinal.formative/2;
- concepts/termes;
- auto/assisted/manual;
- provenance;
- fingerprints;
- validateur;
- dry-run;
- journal/reprise;
- rapport final.

0.4.1 reste fallback tant que 0.5.0 n'a pas passé un vrai end-to-end.

## 20. Bundles Formative repérés

Familles historiques:

- formative-react-formative-items;
- formative-react-reporting;
- formative-react-gradecam.

Pistes seulement. Un bundle n'est pas une API stable.

## 21. Artefacts bruts à ne pas committer sans vérification

- HAR Formative;
- dump Authorization/cookies/tokens;
- PII inutile;
- diagnostics réseau non nettoyés;
- clé privée servant éventuellement à générer une clé publique manifest.

Le `manifest.key` public peut être committé. Une clé privée, jamais.

## 22. Phrase de reprise

`Lis Formative/SKILL.md, CURRENT_STATE.md et MAINTENANCE_PLAYBOOK.md; si le sujet concerne PDF/import, lis aussi PROTOCOL_V2_PLAN.md. Pour le code standalone, pars du snapshot 0.4.1 et conserve sa manifest.key.`
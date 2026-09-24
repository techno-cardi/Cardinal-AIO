# État actuel - Formative/Cardinal

Dernière mise à jour: 2026-09-21

Ce fichier est la synthèse durable du projet. Pour le détail exécutable 0.5.x, lire aussi `v2/README.md`, `v2/RUNTIME_UI_V2.md` et `v2/ENGINEERING_HARDENING.md`.

## 1. Source de vérité et couches du projet

Le travail Formative comporte maintenant cinq couches distinctes:

1. **Correction assistée**, stable dans `techno-cardi/Exercices-francais`.
2. **Preuves techniques Formative**, issues des labs v13 à v18.1 et documentées dans ce dépôt.
3. **Cardinal Formative Importer Standalone 0.4.1**, baseline stable pour l'import réel ChatGPT -> Formative.
4. **Protocole `cardinal.formative/2`**, contrat produit et pédagogique indépendant de la mémoire ChatGPT.
5. **Cardinal Formative Importer 0.5.x**, couche exécutable défensive actuellement livrée sous forme de RC standalone.

Toujours distinguer:

- ce qui est observé/prouvé dans Formative;
- ce qui est implémenté/testé en CI;
- ce qui a été smoke-testé dans les vraies interfaces;
- ce qui reste seulement planifié.

## 2. Baseline stable historique: 0.4.1

Artefact historique:

`Cardinal-Formative-Importer-STANDALONE-0.4.1.zip`

SHA-256:

`b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4`

Snapshot reproductible:

`Formative/standalone-0.4.1/archive/`

La CI reconstruit cette archive, vérifie son SHA et vérifie le hash de sa `manifest.key`.

La 0.4.1 demeure le fallback stable tant que la 0.5.x n'a pas passé les smoke tests réels complets.

Cycle historique réellement validé sur un questionnaire réel:

1. paquet détecté dans ChatGPT;
2. import complet multiquestions;
3. corrigés/Keyword intégrés;
4. UPDATE ciblé d'une Free Response existante;
5. récupération de la bonne question;
6. aucune duplication;
7. réimport identique -> UNCHANGED;
8. progression visible dans Formative et ChatGPT.

## 3. Release candidate actuelle: 0.5.0-rc1

Artefact CI:

`Cardinal-Formative-Importer-STANDALONE-0.5.0-rc1`

La RC est construite automatiquement par GitHub Actions à partir de `Formative/v2/`.

Le build:

- conserve exactement la `manifest.key` de 0.4.1;
- utilise Manifest V3;
- charge `background-v2.js` comme service worker;
- charge les content scripts ChatGPT et Formative;
- inclut le popup de récupération/diagnostic;
- inclut la capture/bootstrap de session Formative;
- inclut l'overlay de progression Formative;
- embarque le protocole v2 sous `CARDINAL_FORMATIVE_PROTOCOL_V2.md`;
- expose cet asset aux hôtes ChatGPT prévus seulement;
- vérifie que les modules service worker du builder correspondent exactement aux modules réellement importés au runtime.

Une RC construite et verte en CI n'est pas encore déclarée remplaçante de 0.4.1. La gate suivante reste le test réel dans ChatGPT + Formative.

## 4. Architecture produit finale

La cible production reste **une seule extension Cardinal**, avec modules internes indépendants:

- Formative;
- Gestion des notes;
- Mozaïk;
- Classroom;
- `shared` uniquement pour ce qui est réellement commun.

Principe:

> Une extension pour l'utilisateur, plusieurs modules indépendants pour le développeur.

Les standalone/dev restent conservés pour développer et réparer un module sans risquer les autres.

Ne pas fusionner Formative 0.5.x dans l'extension Cardinal principale avant d'avoir identifié le build Gestion des notes réellement installé et vérifié ses comportements actuels.

## 5. Workflow utilisateur cible

Workflow:

`PDF(s) -> Préparer pour Formative -> validation humaine compacte -> corrigé détaillé -> dry-run -> import -> vérification serveur -> journal/reprise`

Par défaut:

- le texte source sert à comprendre et corriger, mais reste externe à Formative;
- les sections/instructions peuvent devenir des blocs texte;
- les numéros source restent dans les métadonnées, jamais dans le prompt Formative;
- une source absente est signalée;
- un corrigé officiel fourni a priorité;
- les concepts attendus sont définis avant les mots-clés;
- les mots-clés doivent être discriminants;
- les variantes mécaniques sûres peuvent être générées automatiquement;
- les termes trop génériques vont dans les garde-fous/riskyTerms;
- une tâche complexe doit être `assisted`, pas artificiellement `auto`.

Priorité de provenance:

`corrigé fourni > source explicite > inférence prudente > intrinsèque à la question > aucune invention`

## 6. Protocole v2

Contrat:

- `schema = cardinal.formative/2`;
- `protocolVersion = 2.0.0`;
- `packageMode = full | patch`.

Documents normatifs:

- `SCHEMA_V2.md`;
- `cardinal.formative.v2.schema.json`;
- `VALIDATOR_V2_SPEC.md`;
- `CHATGPT_GENERATOR_PROMPT_V2.md`;
- `PROTOCOL_V2_TEST_MATRIX.md`.

### `full`

Décrit l'évaluation complète voulue.

Une question Cardinal absente peut devenir `DELETE_PROPOSED`, mais n'est jamais supprimée automatiquement.

### `patch`

Décrit uniquement les items présents.

Absence != suppression.

Une modification ciblée comme Q16 doit donc rester un patch.

## 7. Types production-ready de la première tranche

Supportés de bout en bout dans la 0.5.x actuelle:

- `shortAnswer`;
- `longAnswer`;
- `fillInTheBlank`.

Les blocs texte nécessaires aux sections/instructions sont aussi représentés par les primitives historiques prouvées.

Les autres subtypes Formative restent bloqués tant que CREATE + READ + UPDATE + VERIFY n'ont pas été prouvés avec leur contrat natif exact.

## 8. Couche exécutable 0.5.x

Dossier:

`Formative/v2/`

La chaîne actuelle couvre maintenant:

`parser -> validator -> adapter -> managed state -> lecture serveur -> planner -> réconciliation -> journal/executor -> transport guard -> gateway -> primitives 0.4.1 -> verify`

Et, côté navigateur:

`ChatGPT scanner/UI -> runtime router -> service worker bridge -> browser controller -> target selector -> production stack -> Formative`

Modules structurants:

- `validator-v2.js`;
- `adapter-v2.js`;
- `managed-state-v2.js`;
- `planner-v2.js`;
- `baseline-store-v2.js`;
- `preflight-v2.js`;
- `bootstrap-reconciliation-v2.js`;
- `reconciliation-flow-v2.js`;
- `journal-v2.js`;
- `executor-v2.js`;
- `transport-bridge-v2.js`;
- `mutation-input-guard-v2.js`;
- `legacy-primitives-v041.js`;
- `server-stack-v2.js`;
- `production-stack-v2.js`;
- `session-store-v2.js`;
- `session-bootstrap-v2.js`;
- `session-capture-bridge-v2.js`;
- `target-enumerator-v2.js`;
- `target-selector-v2.js`;
- `browser-controller-v2.js`;
- `runtime-message-router-v2.js`;
- `service-worker-bridge-v2.js`;
- `extension-app-v2.js`;
- `background-v2.js`.

Les invariants de refactorisation/performance sont documentés dans `v2/ENGINEERING_HARDENING.md`.

## 9. Invariants de robustesse

### Diff et modifications externes

Le planner compare trois états:

`dernier import Cardinal vérifié / Formative actuel / nouveau paquet`

Décisions:

- CREATE;
- UPDATE;
- UNCHANGED;
- PRESERVE_EXTERNAL;
- BLOCKED;
- DELETE_PROPOSED.

Une modification manuelle faite dans Formative n'est jamais écrasée silencieusement.

### Reprise après incident

Statuts de journal:

- PENDING;
- IN_PROGRESS;
- VERIFIED;
- FAILED;
- UNCERTAIN;
- BLOCKED;
- SKIPPED.

Invariant:

> Une mutation possiblement reçue par Formative mais dont la réponse est perdue devient UNCERTAIN. Cardinal relit le serveur avant toute décision. Aucun retry aveugle.

### CREATE

Aucun CREATE potentiellement committé n'est rejoué sans réconciliation serveur.

### Cible

- cible Formative explicite;
- plusieurs onglets ambigus -> sélection explicite;
- URL et ID relus avant mutation;
- cible fermée/changée -> blocage;
- un seul run peut posséder une cible donnée à la fois.

### Session liée à la cible

Une session Formative v2 appartient à un onglet exact.

Stockage:

`cardinal.formative.v2.session.tab.<tabId>`

Règles:

- record sans `tabId` explicite -> refus;
- une opération gateway sans `targetTabId` -> blocage avant GraphQL;
- la session d'un autre onglet n'est jamais utilisée comme fallback;
- deux onglets avec deux sessions différentes restent isolés;
- les scopes de session sont sérialisés autour du gateway gardé afin que les primitives 0.4.1 imbriquées ne changent jamais de session au milieu d'une opération;
- l'ancien record global n'est jamais migré vers une cible, car sa provenance n'est pas prouvable;
- fermeture d'un onglet -> suppression de sa session volatile seulement.

Le chemin MAIN world est prioritaire pour capturer la session. Le fallback `webRequest` exige une provenance `app.formative.com` explicite; une provenance absente ou ambiguë est ignorée.

### Stockage

- sessions et secrets dans `chrome.storage.session`;
- baseline/journal/historique dans `chrome.storage.local`;
- aucune session/header/token dans la baseline;
- diagnostics de session sans valeur Authorization/session/user ID.

## 10. Préparer pour Formative

La RC contient un bouton ChatGPT autonome.

`chatgpt-prepare-helper-v2.js`:

- charge le protocole embarqué;
- l'ajoute comme pièce jointe au composeur actif;
- ajoute la consigne Cardinal;
- ne soumet pas automatiquement le message;
- bloque si l'ajout de la pièce jointe ne peut pas être confirmé.

Durcissement du 21 septembre 2026:

- le nom du protocole présent dans un ancien message ne compte pas;
- une ancienne pièce jointe visible plus haut dans le chat ne compte pas;
- le nom du fichier présent seulement dans le texte du composeur ne compte pas;
- la présence est évaluée dans le composeur courant et son contrôle de fichiers;
- les rafales `MutationObserver`/resize/scroll sont regroupées en un seul repositionnement par frame afin d'éviter des lectures de layout inutiles pendant le streaming ChatGPT.

Cela évite qu'un vieux protocole ou un simple texte historique fasse sauter silencieusement l'ajout du protocole courant, tout en gardant l'UI légère.

## 11. Corrigé et pédagogie

Keyword Grading Formative observé:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

Donc:

- score d'un mot = score direct de cette correspondance;
- plusieurs mots ne s'additionnent pas;
- auto seulement pour les tâches déterministes;
- assisted pour explication, multipartie ou réponse nécessitant jugement;
- manuel seulement lorsque nécessaire;
- une Free Response peut avoir un corrigé Keyword riche sans prétendre être totalement auto-corrigeable.

Le popup et la barre ChatGPT contiennent l'audit du corrigé réellement destiné à Formative.

## 12. CI / build

Workflow:

`.github/workflows/formative-v2-tests.yml`

La CI actuelle:

- reconstruit l'archive 0.4.1;
- vérifie son SHA;
- vérifie le hash de sa `manifest.key`;
- inspecte le contrat/session/primitives historiques;
- fait les checks de syntaxe;
- exécute tous les tests unitaires/intégration v2;
- construit `0.5.0-rc1`;
- vérifie le manifest et les fichiers référencés;
- vérifie l'identité Chrome;
- vérifie popup, audit du corrigé, scripts de session/progression;
- vérifie le protocole v2 embarqué;
- compare automatiquement les modules service worker du builder à ceux réellement chargés par `background-v2.js`;
- téléverse la RC comme artefact Actions.

Le workflow doit se déclencher sur toute modification de:

- `Formative/v2/**`;
- schéma v2;
- `SCHEMA_V2.md`;
- `CHATGPT_GENERATOR_PROMPT_V2.md`;
- archive 0.4.1;
- workflow lui-même.

Le générateur ChatGPT est embarqué dans la RC, donc sa modification doit toujours reconstruire et revalider l'artefact.

## 13. Compatibilité Gestion des notes / Mozaïk

Contrat durable:

`GESTION_NOTES_INTEGRATION_CONTRACT.md`

À préserver absolument:

- propriétaire Mozaïk `app-patch-v14.js`;
- `#syncMozaikBtn` avec `dataset.cardinalSyncOwner = "v14"`;
- workflow Formative -> Gestion séparé;
- mode **Associer sans toucher aux notes**;
- lorsqu'un travail Gestion existe déjà et que l'import des notes est désactivé, l'association Formative doit être possible sans modifier les notes locales et sans déclencher Mozaïk;
- résultat global Formative avec présélection des questions déjà corrigées.

Le namespace Formative v2 reste `cardinal.formative.v2.*` pour survivre à la future fusion sans orpheliner baseline/journaux.

## 14. Angles morts déjà traités explicitement

En documentation, code ou tests:

- autre chat/autre compte;
- PDF questions/source/corrigé;
- source absente;
- points manquants ou incohérents;
- question reformulée;
- mapping perdu;
- cible déjà remplie;
- plusieurs Formative;
- mauvais target;
- deux onglets avec sessions/comptes potentiellement différents;
- session globale réutilisée sur la mauvaise cible;
- appel serveur sans `targetTabId`;
- capture `webRequest` sans provenance Formative prouvée;
- fermeture d'onglet et session volatile périmée;
- coexistence de plusieurs listeners `tabs.onRemoved`;
- modification manuelle après PREPARE;
- field ownership;
- patch vs full;
- suppression;
- question étrangère;
- import interrompu;
- timeout après mutation;
- service worker endormi/crash;
- double exécution;
- secrets/PII;
- changement API Formative;
- changement DOM ChatGPT;
- tempête de mutations DOM ChatGPT et lectures de layout redondantes;
- divergence entre fichiers service worker du builder et du runtime;
- termes génériques;
- négation;
- collisions de mots/pointages;
- clés FITB aléatoires;
- protocol asset manquant ou périmé;
- ancienne mention du protocole dans l'historique ChatGPT;
- gros questionnaires/token limits.

Voir `PROTOCOL_V2_TEST_MATRIX.md` pour la gate détaillée et `v2/ENGINEERING_HARDENING.md` pour les invariants d'ingénierie.

## 15. Ce qui reste réellement avant promotion 0.5.x

Le code et le build sont assemblés. La priorité suivante est la preuve en conditions réelles.

Ordre recommandé:

1. installer la RC 0.5.0-rc1;
2. smoke test réel shortAnswer `CREATE -> VERIFY -> UPDATE -> UNCHANGED`;
3. même cycle pour longAnswer;
4. même cycle pour FITB;
5. modification manuelle après PREPARE -> blocage attendu;
6. perte de réponse/timeout après mutation -> relecture et reprise sans doublon;
7. Formative déjà rempli -> rapprochement explicite;
8. deux onglets Formative, idéalement avec sessions/comptes distincts -> sélection et cloisonnement sûrs en conditions réelles;
9. redémarrage service worker/browser -> reprise journal;
10. nouveau chat/autre compte -> préparation et import;
11. probes Keyword réels: sous-chaîne, ponctuation, accents, casse, termes imbriqués et plusieurs matches;
12. corriger tout écart découvert et garder 0.4.1 comme fallback;
13. identifier ensuite le build Cardinal/Gestion des notes réellement installé;
14. tester la fusion avec Mozaïk v14 et **Associer sans toucher aux notes**;
15. seulement ensuite promouvoir le module Formative dans Cardinal principal.

Les nouveaux types de questions seront ajoutés après cette première tranche stable, un type à la fois, avec contrat natif et tests dédiés.

## 16. Hiérarchie des sources

Correction/Gestion production:

`techno-cardi/Exercices-francais`

Import stable historique:

- snapshot 0.4.1;
- ce `CURRENT_STATE.md`;
- preuves v13-v18.1.

Développement v2:

1. `SCHEMA_V2.md` + schéma JSON;
2. `VALIDATOR_V2_SPEC.md`;
3. code `Formative/v2/` + tests;
4. `CHATGPT_GENERATOR_PROMPT_V2.md`;
5. `PROTOCOL_V2_TEST_MATRIX.md`;
6. `GRAPHQL_RECIPES.md` pour la frontière Formative;
7. `v2/README.md` et `v2/RUNTIME_UI_V2.md` pour l'état exécutable courant;
8. `v2/ENGINEERING_HARDENING.md` pour les invariants de sécurité, durabilité et performance.

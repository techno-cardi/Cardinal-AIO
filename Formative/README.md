# Formative - Base de connaissance Cardinal

Dernière consolidation/audit: 2026-09-20

Ce dossier est la mémoire technique, fonctionnelle et pédagogique du travail Formative avec Cardinal. Son objectif est de rendre inutile toute reconstruction de l'historique dans un nouveau chat, un autre compte ChatGPT ou après un changement de code Formative.

## Règle de reprise

Quand Kevin demande de continuer un travail Formative, lire dans cet ordre:

1. `SKILL.md`
2. `CURRENT_STATE.md`
3. `PROTOCOL_V2_PLAN.md` si la demande touche PDF -> Formative, réponses, mots-clés ou UX d'import
4. `SCHEMA_V2.md` + `cardinal.formative.v2.schema.json`
5. `VALIDATOR_V2_SPEC.md`
6. `CHATGPT_GENERATOR_PROMPT_V2.md`
7. **le code courant sous `v2/` et ses tests** si la demande touche 0.5.x
8. `PROTOCOL_V2_TEST_MATRIX.md` avant toute déclaration de stabilité
9. `CARDINAL_MODULAR_ARCHITECTURE.md` si la demande touche fusion avec Gestion des notes, Mozaïk ou Classroom
10. `MAINTENANCE_PLAYBOOK.md` pour bug/changement externe
11. `CAPABILITY_MATRIX.md`
12. `API_GRAPHQL_NOTES.md`
13. `GRAPHQL_RECIPES.md` avant toute écriture d'intégration Formative
14. `DISCOVERY_TIMELINE.md` seulement pour retrouver une preuve/lab ancien
15. les fichiers actuels de `techno-cardi/Exercices-francais` avant toute modification de production.

Le dépôt vivant de l'extension Cardinal/Gestion des notes reste `techno-cardi/Exercices-francais`.

`techno-cardi/database/Formative` sert de mémoire consolidée, archive de preuves, baseline reproductible et chantier exécutable v2.

## Cinq couches à distinguer

### 1. Correction Formative assistée par ChatGPT

Workflow stable:

`Formative -> Cardinal -> ChatGPT -> prévisualisation -> Formative -> résultat global -> Gestion des notes -> Mozaïk`

Formative demeure la source de vérité question par question.

### 2. Création/import technique

Les labs v13-v18.1 ont prouvé les mutations, l'API directe, l'upsert et les structures spécialisées.

Ils sont des preuves/reconstruction guides, pas l'UX produit finale.

### 3. Cardinal Formative Importer Standalone 0.4.1

Baseline stable actuelle.

Workflow validé:

`ChatGPT package v1 -> Cardinal -> CREATE/UPDATE/UNCHANGED -> Formative`

Acquis:

- détection robuste dans ChatGPT;
- import réel multiquestions;
- Short/Long Answer Keyword;
- progression ChatGPT + Formative;
- update ciblé sans doublon;
- réimport idempotent;
- récupération de mapping;
- récupération contexte extension invalidé;
- identité Chrome stable.

Ne pas modifier cette baseline pendant le chantier 0.5.x.

### 4. Protocole Cardinal Formative v2

Workflow produit cible:

`joindre PDF(s) -> Préparer pour Formative -> vérifier -> Importer`

Indépendant de Memory/compte/conversation.

Contrat:

- `cardinal.formative/2`;
- `protocolVersion = 2.0.0`;
- `packageMode = full | patch`;
- source exacte séparée du prompt Formative;
- concepts et provenance;
- auto/assisted/manual;
- validation avant mutation.

### 5. Couche exécutable v2 sous `Formative/v2/`

Actuellement codés:

- `validator-v2.js`;
- `adapter-v2.js`;
- `managed-state-v2.js`;
- `planner-v2.js`;
- `baseline-store-v2.js`;
- `preflight-v2.js`;
- `journal-v2.js`;
- tests unitaires/intégration correspondants.

Ces couches sont pures et testables sans réseau/DOM afin de verrouiller la logique avant de la brancher aux mutations 0.4.1.

CI:

`.github/workflows/formative-v2-tests.yml`

Chaque changement `Formative/v2/**` doit passer syntax check + toutes les suites `*.test.js`.

## Documents principaux

- `SKILL.md`: règles obligatoires de reprise.
- `CURRENT_STATE.md`: état courant complet.
- `PROTOCOL_V2_PLAN.md`: intention produit/pédagogique.
- `SCHEMA_V2.md`: contrat humain.
- `cardinal.formative.v2.schema.json`: contrat machine.
- `VALIDATOR_V2_SPEC.md`: validation, diff à trois états, field ownership, reprise.
- `CHATGPT_GENERATOR_PROMPT_V2.md`: prompt autonome derrière Préparer pour Formative.
- `PROTOCOL_V2_TEST_MATRIX.md`: gate d'angles morts.
- `CARDINAL_MODULAR_ARCHITECTURE.md`: une extension Cardinal, modules Formative/Grades/Mozaïk/Classroom isolés.
- `MAINTENANCE_PLAYBOOK.md`: dépannage et changement externe.
- `CORRECTION_WORKFLOW.md`: workflow correction.
- `IMPORT_AND_CREATION.md`: import actuel / API.
- `MAPPER_DISCOVERY.md`: méthodes de cartographie.
- `API_GRAPHQL_NOTES.md`: endpoints/champs/invariants.
- `GRAPHQL_RECIPES.md`: recettes minimales prouvées.
- `CAPABILITY_MATRIX.md`: statut des types.
- `BUILDER_STANDALONE.md`: historique standalone.
- `DISCOVERY_TIMELINE.md`: chronologie labs.
- `TROUBLESHOOTING_HISTORY.md`: pièges à ne pas répéter.
- `SECURITY_AND_INVARIANTS.md`: sessions/PII/secrets.
- `REFERENCE_ARTIFACTS.md`: inventaire des preuves/snapshots.

## Snapshot exact 0.4.1

Sous:

`Formative/standalone-0.4.1/archive/`

Sept parties Base64 + `MANIFEST.md`.

SHA-256 ZIP attendu:

`b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4`

Ce snapshot protège la baseline exacte et la `manifest.key` publique stable.

## Sources de vérité

### Production correction/Gestion

Toujours vérifier `techno-cardi/Exercices-francais` avant modification.

### Import standalone stable

1. snapshot 0.4.1;
2. `CURRENT_STATE.md`;
3. preuves v13-v18.1;
4. anciens labs seulement pour détail spécialisé.

### Développement 0.5.x

1. `SCHEMA_V2.md` + schéma JSON;
2. `VALIDATOR_V2_SPEC.md`;
3. **code sous `v2/` + tests/CI**;
4. `CHATGPT_GENERATOR_PROMPT_V2.md`;
5. `PROTOCOL_V2_TEST_MATRIX.md`;
6. `GRAPHQL_RECIPES.md` lorsqu'on touche la frontière Formative.

La baseline 0.4.1 reste le fallback jusqu'à validation complète de 0.5.x.

## Acquis à ne plus redécouvrir

- API directe authentifiée localement;
- permission edit;
- `x-tab-id` Cardinal distinct;
- création/update live sans menu;
- mutations documentées dans `GRAPHQL_RECIPES.md`;
- Keyword Grading absolu/non additif;
- ordre points max avant answerChoicePoints;
- bloc texte natif = functionalizedText;
- passage partagé = parent functionalizedText + enfants parentId;
- Free Response avec answer key Keyword;
- bootstrap session exceptionnel;
- récupération contexte Chrome invalidé;
- manifest.key stable;
- CREATE / UPDATE / UNCHANGED;
- items étrangers préservés.

## Principe fondamental de preuve

Ne jamais confondre:

- **PROVEN**: capturé/testé/vérifié;
- **INTEGRATED**: branché dans la baseline courante;
- **PARTIAL**;
- **NOT_PROVEN**;
- **NOT_MAPPED**;
- **OUT_OF_PROFILE**.

Une capacité prouvée dans un vieux lab n'est pas automatiquement activée dans le nouvel adaptateur v2.

On ne devine jamais une mutation ou une représentation Formative. On capture, normalise, teste, vérifie, puis active.

## Phrase de reprise minimale

> Lis `Formative/SKILL.md`, `Formative/CURRENT_STATE.md`, le contrat v2 et le dossier `Formative/v2/`; lance/consulte les tests v2 avant toute modification; vérifie `techno-cardi/Exercices-francais` avant de toucher la production.

Cela doit suffire pour reprendre sans demander à Kevin de raconter l'exploration.
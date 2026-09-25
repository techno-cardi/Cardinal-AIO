# Cardinal AIO - hotfix 1.1.11

Date: 2026-09-25

Ce dossier documente le correctif construit après audit des sources de vérité GitHub avant modification.

## Sources relues avant le correctif

- techno-cardi/database/Formative/SKILL.md
- techno-cardi/database/Formative/README.md
- techno-cardi/database/Formative/CURRENT_STATE.md
- techno-cardi/database/Formative/MAINTENANCE_PLAYBOOK.md
- techno-cardi/database/Formative/GESTION_NOTES_INTEGRATION_CONTRACT.md
- techno-cardi/database/Formative/TROUBLESHOOTING_HISTORY.md
- techno-cardi/database/Formative/VALIDATOR_V2_SPEC.md
- techno-cardi/database/Formative/PROTOCOL_V2_PLAN.md
- techno-cardi/Exercices-francais/CHATGPT_PROJECT_INSTRUCTIONS.md
- techno-cardi/Exercices-francais/resultats/docs/CURRENT_STATE.md
- techno-cardi/Exercices-francais/resultats/docs/FORMATIVE_PROTOCOL.md
- code courant du build AIO 1.1.10 fourni à Kevin

## Bugs corrigés

### Résultat global Formative -> Gestion

Le bridge 1.1.10 dépendait principalement de selectedAssignmentId dans l'URL Formative. Or Formative ne conserve pas toujours la classe active dans l'URL. Le résultat était le faux message:

`Choisis d’abord la classe dans Formative, puis relance « Résultat global → Gestion ».`

Le correctif 1.1.11 résout la classe dans cet ordre:

1. selectedAssignmentId de l'URL lorsqu'il existe et correspond à teacherAssignments;
2. assignmentId/sectionId observé dans les variables GraphQL récentes du même onglet, accepté uniquement s'il correspond à teacherAssignments de l'évaluation;
3. classe actuellement choisie dans le menu Cardinal;
4. choix Cardinal mémorisé pour ce Formative;
5. section active observée;
6. classe unique lorsqu'il n'y en a qu'une.

Aucune classe n'est devinée. Si plusieurs classes restent réellement ambiguës, Cardinal demande un choix et le mémorise.

### Import ChatGPT -> Formative bloqué inutilement

La documentation v2 distingue les blocages techniques des points pédagogiques à vérifier. Deux divergences ont été corrigées:

- `ASSISTED_REQUIRED` est un warning, conformément à VALIDATOR_V2_SPEC.md;
- `TOTAL_POINTS_MISMATCH` devient une vérification explicite avant import, conformément à PROTOCOL_V2_PLAN.md qui prévoit correction ou confirmation explicite.

Les issues `severity:blocker` simplement émises par ChatGPT restent visibles mais ne sont plus, à elles seules, autorisées à créer un blocage technique. Cardinal reste l'autorité pour les bloqueurs techniques via son validator, planner, preflight et vérifications serveur.

Les vrais bloqueurs restent bloquants: schéma/structure impossible, points invalides, subtype non supporté, placeholders incohérents, source manquante incompatible avec auto, cible ambiguë, conflits serveur, mutation incertaine et mismatch après écriture.

## Build testé

Version name: `1.2.0-formative-1.1.11-g118`

ZIP: `Cardinal-AIO-1.2.0-Formative-1.1.11-github-audited.zip`

SHA-256: `735d5c3534f5b8fbf113b9d10e7fbf41a3d56aa4603ceae5192a8a084d40755f`

Tests locaux effectués:

- 67/67 fichiers JavaScript passent `node --check`;
- résolution de classe exacte: 7 scénarios;
- récupération de classe active depuis variables GraphQL autoritatives: 5 scénarios;
- validator/presentation v2: 5 scénarios, dont warning ASSISTED_REQUIRED, confirmation TOTAL_POINTS_MISMATCH, issue blocker rapportée par ChatGPT non bloquante, et vrai blocage technique toujours bloquant;
- ZIP final réextrait puis revérifié.

## Base du patch

Le fichier `1.1.10-to-1.1.11.patch` décrit exactement les changements appliqués au build AIO 1.1.10 qui était utilisé pour ce correctif.

Ne pas promouvoir ce hotfix comme stable sans smoke test réel dans Formative et Gestion des notes. Ne pas repartir d'une ancienne baseline en ignorant ce patch.

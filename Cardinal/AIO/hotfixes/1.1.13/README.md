# Cardinal AIO - Formative 1.1.13 flow fix

Date: 2026-09-25

Cette version part du build 1.1.12 diagnostics et de son export réel `Cardinal-diagnostic-20260925-135325.json`.

## Preuves du diagnostic

### Résultat global vers Gestion

Le bridge Formative voyait bien **2 sections**, mais aucune classe active n'était détectée. Le choix mémorisé de la correction pointait vers `Français SAÉ — Groupe 31`. Le bouton Résultat global réutilisait donc ce choix sans offrir de sélecteur propre au résultat global.

Correctif produit:

- le bouton `Résultat global → Gestion` ouvre maintenant un sélecteur de classe dédié;
- toutes les classes retournées par `aiSectionsV2` sont proposées, quel que soit leur nom;
- le choix global est stocké séparément du choix de correction;
- un choix mémorisé peut seulement être préselectionné, jamais envoyé sans clic explicite;
- le diagnostic exporte maintenant le catalogue nettoyé des sections.

### Import ChatGPT -> Formative

Le diagnostic montrait:

- paquet préparé: 10 questions;
- 10 CREATE;
- 51 warnings;
- 0 blocker;
- `FormativeTeacherAddFormativeItem`: HTTP 200;
- `QuestionEditableUpdateFormativeItem`: HTTP 400;
- état final: `uncertain`.

L'audit du contrat GraphQL a trouvé un défaut concret:

`QuestionEditableUpdateFormativeItem` déclarait `$withHasItemTags: Boolean!` sans utiliser cette variable dans le document GraphQL, pendant que les primitives l'envoyaient avec `false`.

Le build 1.1.13 retire cette variable du contrat et des variables envoyées.

Le correctif canonique correspondant est aussi ouvert dans `techno-cardi/database` PR #10 afin que la source de vérité ne conserve pas l'ancien contrat fautif.

## Reprise après CREATE partiel

Si CREATE a retourné un ID puis la configuration a échoué, Cardinal ne doit ni recréer aveuglément ni rester dans une boucle de vérification.

1. relire le Formative;
2. identifier les items absents du snapshot de départ;
3. exiger un seul candidat du subtype attendu;
4. vérifier que le candidat est encore vide et correspond temporellement à l'échec, ou que son ID est enregistré dans le journal;
5. terminer la configuration de cet item;
6. relire et vérifier l'état désiré;
7. marquer l'opération vérifiée.

Tout candidat non vide, multiple ou ambigu reste bloqué.

## UX importeur simplifiée

Le flux normal devient:

`paquet détecté -> analyse automatique -> Importer dans Formative -> terminé`

Les avertissements pédagogiques restent dans `Détails` mais ne créent plus une étape mécanique supplémentaire. Toutes les questions sont incluses par défaut; `Questions X/Y · Modifier` est facultatif.

Les états `Préparer`, `Vérifier`, `Importer après vérification` ne sont plus empilés pour un paquet techniquement valide.

La carte ChatGPT a aussi été simplifiée visuellement: statut compact, boutons cohérents, aucun faux indicateur de progression lorsque le paquet est simplement prêt et détails pédagogiques gardés à la demande.

Une interruption réelle propose `Reprendre l'import`; la reprise relit Formative avant toute nouvelle écriture.

## Erreurs exploitables

Le journal conserve maintenant, quand disponible:

- code;
- message;
- phase;
- operationName;
- HTTP status;
- formativeItemId;
- jusqu'à quatre erreurs GraphQL nettoyées.

## Build

- Version name: `1.2.0-formative-1.1.13-flow-fix-g118`
- ZIP CI autoritaire: `Cardinal-AIO-1.2.0-formative-1.1.13-flow-fix-g118.zip`
- SHA-256: `dbbb41dbd7dc204fd9b0ca41db4fa33d18b12f45a1043427474e2326f7542991`

## Tests exécutés

- 69/69 fichiers JavaScript: `node --check` PASS;
- manifest JSON: PASS;
- réextraction du ZIP final et 69/69 JS: PASS;
- test statique NoUnusedVariables sur tous les documents GraphQL du contrat: PASS;
- `withHasItemTags` absent du contrat updateQuestion: PASS;
- warning-only package -> action primaire directe `Importer dans Formative`: PASS;
- 51 warnings -> acknowledgeWarnings automatique au clic Importer: PASS;
- sélection de questions facultative et toutes sélectionnées par défaut: PASS;
- groupe global: sélecteur dédié, aucun nom Groupe 31/32 codé en dur: PASS;
- récupération d'un unique item longAnswer vide après CREATE partiel: `repairable`: PASS;
- transport de réparation modifie l'ID existant et n'appelle pas CREATE: PASS.

Ce build reste candidat jusqu'au smoke test réel du groupe 32 et du paquet questionnaire.


## Source de vérité exécutable

Le hotfix historique n'existe plus seulement dans un ZIP de travail. Les fichiers exacts nécessaires au build 1.1.13 sont versionnés dans:

`Cardinal/AIO/hotfixes/1.1.13/overlay/`

Le builder déterministe `Cardinal/AIO/rebuild_aio_safe.py` applique cet overlay uniquement au profil utilisateur vérifié Gestion 1.1.8, puis intègre le moteur Formative v2 épinglé et le pont Classroom épinglé.

Build CI de référence:

- commit exécutable: `0f0c87138f9823017f97ad5e72e4b60a9dc81d97`;
- workflow: `Cardinal AIO repair contract`;
- run: `36177530518`;
- contrat: PASS;
- reconstruction baseline Gestion 1.1.8: PASS;
- build exact AIO: PASS;
- réextraction et vérification du candidat: PASS;
- upload artefact CI: PASS;
- suite Formative v2 sur la branche: PASS.

Le ZIP ci-dessus est l'artefact construit par GitHub Actions à partir de cette source, pas un ZIP modifié à la main après coup.

# Cardinal tout-en-un — architecture durable

Dernière mise à jour: 2026-09-21

## Décision produit

La cible finale est **une seule extension Cardinal installée**, avec des modules internes isolés:

- `formative/` — import/création, correction, résultats, feedback;
- `gestion-notes/` — modèle intermédiaire des évaluations/résultats;
- `mozaik/` — synchronisation vers Mozaïk;
- `classroom/` — pont natif Classroom et fonctions associées;
- `shared/` — bus, stockage générique, progression, diagnostics, feature flags et UI commune seulement.

Les builds standalone Formative/Classroom/Mozaïk peuvent rester disponibles comme **laboratoires de développement et solutions de reprise**, mais l'utilisateur normal ne doit avoir qu'une extension Cardinal.

## Règle d'isolation

Aucun module ne doit appeler directement une fonction privée d'un autre module.

Flux normal:

`module -> contrat normalisé -> shared bus -> module consommateur`

Exemples:

`Formative -> AssessmentResults -> Gestion des notes -> GradeSyncBatch -> Mozaïk`

`Classroom -> ClassroomResourceEvent -> shared bus`

`PDF/ChatGPT -> cardinal.formative/2 -> Formative`

Une panne ou un changement de Mozaïk ne doit pas rendre Formative inutilisable. Une panne Classroom ne doit pas empêcher la gestion des notes.

## Versions

L'extension possède une version produit, mais chaque module possède aussi sa propre version interne.

Exemple:

- Cardinal `2.0.0`;
- Formative `0.5.x`;
- Gestion des notes `1.x`;
- Mozaïk `1.x`;
- Classroom Bridge `1.x`.

Les diagnostics doivent toujours inclure les versions de modules, sans secrets ni données élèves.

## Feature flags

Prévoir des flags locaux:

- `formativeImporterEnabled`;
- `formativeResultsEnabled`;
- `mozaikSyncEnabled`;
- `classroomBridgeEnabled`;
- `gestionNotesEnabled`.

Un module défectueux peut ainsi être désactivé sans retirer l'extension ni casser les autres workflows.

Les flags ne doivent jamais contourner les garde-fous de sécurité d'un module; ils activent/désactivent une capacité entière.

## Permissions Chrome

Principe du minimum nécessaire:

- regrouper les host permissions par module;
- documenter pourquoi chaque permission existe;
- éviter qu'un module utilise les host permissions d'un autre par commodité;
- ne jamais stocker de token/session dans le dépôt;
- session Formative dans `chrome.storage.session`;
- persistance non secrète uniquement pour mappings, journaux, préférences et diagnostics bornés.

Lors de la fusion, comparer le manifest final avec chaque standalone et conserver les permissions strictement nécessaires.

## Service worker

Le service worker commun sert de routeur, pas de monolithe métier.

Il doit:

1. recevoir un message;
2. identifier le module;
3. valider le contrat/version;
4. router vers le handler du module;
5. isoler les erreurs;
6. retourner une réponse normalisée.

Il ne doit pas contenir toute la logique Formative + Mozaïk + Classroom dans un seul fichier géant.

## Noms de stockage

Chaque module possède son namespace:

- `cardinal.formative.*`;
- `cardinal.mozaik.*`;
- `cardinal.classroom.*`;
- `cardinal.grades.*`;
- `cardinal.shared.*`.

Aucun module ne lit/écrit directement le storage privé d'un autre module.

## Bus commun

Le bus commun transporte uniquement des objets versionnés.

Exemples de contrats futurs:

- `cardinal.assessment-results/1`;
- `cardinal.grade-sync-batch/1`;
- `cardinal.classroom-resource/1`;
- `cardinal.progress/1`.

Tout contrat inconnu est rejeté, jamais deviné.

## UX

Le popup Cardinal final doit rester simple:

- état Formative;
- état Gestion des notes;
- état Mozaïk;
- état Classroom;
- diagnostic/reconnexion seulement lorsqu'une action est nécessaire.

Pas de panneau technique par défaut.

Les workflows principaux restent contextuels:

- dans ChatGPT: `Préparer pour Formative` / `Importer dans Formative`;
- dans Formative: progression et actions Formative;
- dans Gestion des notes: préparation/validation des résultats;
- dans Mozaïk: progression de synchronisation;
- Classroom: pont transparent, avec statut dans Cardinal.

## Erreurs

Une erreur module doit avoir:

- `module`;
- `code` stable;
- message utilisateur;
- détails techniques optionnels;
- action de récupération;
- aucun secret.

Le routeur commun ne transforme jamais une erreur Formative en erreur Mozaïk générique.

## Tests

CI par module + tests d'intégration des contrats communs.

Minimum avant fusion:

1. suite standalone Formative verte;
2. suite Mozaïk verte;
3. suite Classroom verte;
4. suite Gestion des notes verte;
5. test que désactiver un module n'affecte pas les autres;
6. test de redémarrage du service worker;
7. test de migration storage;
8. test de manifest/permissions;
9. test d'identité Chrome;
10. test rollback.

## Migration vers le tout-en-un

Ne pas fusionner tant que Formative v2 n'a pas passé un vrai test end-to-end.

Ordre recommandé:

1. conserver la baseline standalone 0.4.1 intacte;
2. finir/tester Formative 0.5.x en module isolé;
3. figer les contrats communs;
4. créer un build Cardinal intégration;
5. intégrer Formative sans modifier Mozaïk;
6. exécuter toutes les régressions Mozaïk;
7. intégrer Classroom derrière un feature flag;
8. exécuter les régressions globales;
9. seulement ensuite promouvoir le tout-en-un.

## Rollback

Toujours conserver:

- dernier build Cardinal stable;
- standalone Formative stable;
- source exacte et SHA-256 des artefacts importants;
- manifest/key stable;
- notes de migration storage.

Une mise à jour d'un module qui échoue ne doit jamais forcer à reconstruire les autres modules depuis zéro.

## Règle d'architecture finale

> Une seule extension pour l'utilisateur, plusieurs produits bien isolés pour le développeur.

C'est le compromis retenu entre simplicité d'utilisation et facilité de maintenance.
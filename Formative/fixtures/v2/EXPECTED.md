# Fixtures Cardinal Formative v2 - résultats attendus

Dernière mise à jour: 2026-09-20

Ces fixtures servent aux tests unitaires du validateur 0.5.x et aux tests de régression.

## `valid-full-mixed.json`

Attendu:

- JSON Schema: PASS;
- validation sémantique: PASS;
- état global: `✓ Prêt`;
- packageMode: full;
- total calculé: 9;
- total déclaré: 9;
- q1: auto;
- q2: assisted à cause de `distinctConcepts=2` + `explainEach=2`;
- q3: auto;
- aucun blocker;
- les `riskyTerms` de q2 ne doivent pas être envoyés automatiquement dans le corrigé actif;
- le texte source ne doit pas devenir un passage Formative.

## `valid-patch-q16.json`

Attendu:

- JSON Schema: PASS;
- validation sémantique: PASS avec revue de transformation requise;
- packageMode: patch;
- aucune absence de Q1-Q15/Q17+ ne peut être interprétée comme suppression;
- aucune vérification de total complet obligatoire;
- q16: assisted;
- `removeSourceNumber` ne nécessite pas de confirmation;
- transformation `other` avec `requiresReview=true` doit produire `⚠ À vérifier` tant qu'elle n'est pas approuvée;
- si une Q16 existante est retrouvée de manière unique, le plan cible UPDATE, pas CREATE;
- un deuxième import identique après confirmation doit donner UNCHANGED.

## `valid-source-missing.json`

Attendu:

- JSON Schema: PASS;
- validation sémantique: PASS avec warning;
- état global: `⚠ À vérifier`;
- `starship.status = missing`;
- q17 ne peut pas être auto;
- q17 reste manual;
- aucun corrigé Starship inventé;
- `SOURCE_REQUIRED` visible;
- la question peut être créée seulement si elle reste pédagogiquement utilisable avec une source externe dont l'enseignant dispose réellement;
- si le média/source est indispensable aux élèves et absent de leur contexte cible, le planner peut hausser le cas à blocker.

## `invalid-semantic-conflicts.json`

Le fichier est volontairement conçu pour être **structurellement acceptable** mais sémantiquement invalide.

Attendu:

- JSON Schema: PASS;
- validation sémantique: BLOCKED.

Problèmes attendus q1:

- `SOURCE_REQUIRED`: source manquante;
- mode auto incompatible avec `sourceMissing`;
- `SCORE_GT_MAX`: score concept 4 > question 3;
- `TERM_SCORE_CONFLICT`: `graphite` apparaît dans deux concepts avec scores 4 et 2;
- concepts de provenance `sourceMissing` ne peuvent pas générer de termes actifs fiables.

Problèmes attendus q2:

- `PLACEHOLDER_MISMATCH`: le prompt contient `{{pays}}` et `{{annee}}`, mais seul `pays` est défini.

Problème attendu assessment:

- `TOTAL_POINTS_MISMATCH`: total déclaré 10, total calculé 5.

État global:

`✕ Bloqué`

Aucune mutation Formative ne doit être envoyée.

# Règle de test

Le même validateur doit servir:

- au dry-run;
- au vrai import;
- à la reprise après erreur.

Il est interdit d'avoir un validateur simplifié pour le preview et un autre pour l'écriture.

# Tests additionnels à ajouter pendant l'implémentation

- version inconnue;
- duplicate item id;
- duplicate order full;
- deux questions identiques mais numéros/pages différents;
- même terme normalisé dans deux concepts;
- accents/apostrophes/traits d'union;
- multipleChoice zéro ou deux réponses correctes;
- dropdown correct absent des options;
- matching update avec choice keys existantes;
- full avec item serveur absent du paquet => DELETE_PROPOSED seulement;
- patch avec item serveur absent du paquet => aucune suppression;
- trois-way diff sans conflit;
- trois-way diff avec conflit;
- mutation timeout après CREATE mais item réellement créé;
- plusieurs onglets Formative;
- permission edit absente;
- question déjà répondue par élèves + changement de points/corrigé;
- champ Formative non géré ajouté manuellement puis réimport;
- paquet généré dans un chat vierge avec le prompt autonome.
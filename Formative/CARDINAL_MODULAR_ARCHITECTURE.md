# Cardinal - architecture modulaire cible

Dernière mise à jour: 2026-09-20
Statut: décision d'architecture pour la future extension Cardinal unifiée

## Décision

La cible produit est **une seule extension Cardinal installée par l'utilisateur**, mais composée de modules internes fortement isolés.

Modules prévus:

- `modules/formative/`
- `modules/grades/` (Gestion des notes)
- `modules/mozaik/`
- `modules/classroom/`
- `shared/`

Les builds standalone de laboratoire restent conservés pour Formative, Classroom et, au besoin, Mozaïk. Ils servent à tester/réparer un module sans risquer une régression dans l'extension principale.

## Objectif utilisateur

Une seule installation et une seule identité Cardinal.

Parcours naturel:

`PDF / ChatGPT -> Formative -> résultats normalisés -> Gestion des notes -> Mozaïk`

et, lorsque pertinent:

`Classroom -> contrats partagés Cardinal -> Formative / Gestion des notes`

L'utilisateur ne doit pas avoir à comprendre l'architecture interne.

## Principe d'isolation

> Aucun module ne dépend directement des détails privés d'un autre module.

Interdit:

- Formative qui appelle une fonction interne privée de Mozaïk;
- Classroom qui écrit directement dans le stockage privé de Gestion des notes;
- un module qui suppose le DOM, le token ou le format API interne d'un autre module;
- un état global géant partagé entre tous les modules.

Les échanges passent par des contrats normalisés versionnés dans `shared/contracts/`.

Exemples de contrats:

- `assessmentResults/v1`;
- `gradeTransfer/v1`;
- `classroomContext/v1`;
- `moduleHealth/v1`.

## Arborescence cible

```text
cardinal/
  manifest.json
  background/
    service-worker.js
  modules/
    formative/
      manifest-fragment.js
      adapter/
      session/
      importer/
      grading/
      ui/
      diagnostics/
      tests/
    grades/
      core/
      ui/
      storage/
      tests/
    mozaik/
      adapter/
      session/
      sync/
      ui/
      diagnostics/
      tests/
    classroom/
      bridge/
      ui/
      diagnostics/
      tests/
  shared/
    contracts/
    bus/
    storage/
    logging/
    progress/
    errors/
    feature-flags/
    versioning/
  tests/
    integration/
    regression/
```

Le nom exact peut évoluer, mais l'isolation ne doit pas être sacrifiée.

## Versionnement

L'extension possède une version produit globale, mais chaque module possède aussi sa version interne.

Exemple:

```text
Cardinal 2.0.0
Formative 0.5.0
Gestion des notes 1.2.1
Mozaïk 1.1.4
Classroom Bridge 1.0.3
```

Les rapports de diagnostic doivent toujours inclure les versions internes pour faciliter la reprise.

## Manifest et identité Chrome

Une fois la fusion commencée:

- conserver une identité Chrome stable;
- préserver la `manifest.key` décidée pour la lignée officielle;
- ne jamais changer de clé comme solution de dépannage;
- faire évoluer les permissions de façon minimale et documentée;
- éviter d'accorder à tous les modules les permissions d'un module spécialisé lorsque Chrome permet de les restreindre.

Avant fusion de la lignée standalone Formative, décider explicitement quelle `manifest.key` devient la clé officielle de Cardinal principal. Ne pas fusionner deux identités de stockage en supposant qu'elles sont compatibles.

## Stockage

Chaque module possède un namespace explicite.

Exemples:

- `cardinal.formative.*`
- `cardinal.grades.*`
- `cardinal.mozaik.*`
- `cardinal.classroom.*`
- `cardinal.shared.*`

Règles:

- pas de clés génériques comme `token`, `state`, `current`;
- données de session sensibles dans `chrome.storage.session` lorsque possible;
- secrets/tokens jamais exportés dans diagnostics, GitHub ou ChatGPT;
- migrations de storage versionnées et idempotentes;
- un module ne supprime jamais le namespace d'un autre lors d'un reset.

## Service worker / bus interne

Le service worker sert d'orchestrateur et de routeur, pas de monolithe métier.

Format de message partagé recommandé:

```json
{
  "contract": "cardinal.message/1",
  "module": "formative",
  "type": "IMPORT_PROGRESS",
  "requestId": "...",
  "payload": {}
}
```

Le routeur valide `module`, `type`, `requestId` et la version du contrat avant dispatch.

Un handler qui plante ne doit pas empêcher les autres modules de répondre.

## Gestion des erreurs

Chaque module capture ses erreurs et les convertit en erreurs Cardinal normalisées.

Champs utiles:

- module;
- code stable;
- message utilisateur;
- détail diagnostic non secret;
- version module;
- requestId;
- timestamp.

Une erreur Formative ne doit pas faire passer Mozaïk ou Classroom en état cassé.

## Feature flags

Prévoir des flags locaux versionnés:

- `formative.importerV2`;
- `formative.pdfWorkflow`;
- `mozaik.sync`;
- `classroom.bridge`;
- `grades.core`.

Ils servent à:

- désactiver rapidement une fonction cassée sans neutraliser Cardinal au complet;
- tester une nouvelle implémentation avant de remplacer l'ancienne;
- garder un fallback stable pendant une migration.

Les flags ne doivent pas masquer une migration de données incomplète.

## Diagnostics

Le popup Cardinal doit pouvoir afficher simplement:

```text
Formative      ✓ actif
Gestion notes  ✓ actif
Mozaïk         ✓ actif
Classroom      ✓ actif
```

Un écran diagnostic avancé peut afficher:

- version module;
- état session;
- dernière opération;
- dernier code d'erreur;
- capacité détectée;
- bouton de test ciblé;
- export diagnostic redacted.

Aucun header Authorization, cookie, token ou donnée élève brute dans l'export.

## Progression

Le composant `shared/progress` fournit le rendu commun, mais le contenu de progression reste produit par le module.

Exemple:

- Formative: question 12/23;
- Mozaïk: élève 18/31;
- Classroom: synchronisation du cours.

Chaque opération possède un `requestId`; deux opérations concurrentes ne doivent jamais partager la même barre ou le même état.

## Contrats entre modules

### Formative -> Gestion des notes

Formative produit un résultat normalisé. Gestion des notes ne lit pas directement le DOM ou les objets internes Formative.

### Gestion des notes -> Mozaïk

Gestion des notes produit un `gradeTransfer` normalisé. Mozaïk ne dépend pas du format interne de Formative.

### Classroom

Classroom expose uniquement le contexte nécessaire via contrat. Il ne doit pas devenir un raccourci caché vers les fonctions privées des autres modules.

## Standalone de développement

Conserver:

- Formative standalone stable;
- Classroom bridge standalone;
- Mozaïk dev build lorsque des changements profonds sont nécessaires.

Règle de promotion:

`standalone/dev -> tests ciblés -> tests de régression -> intégration Cardinal -> tests intégrés -> production`

Ne jamais corriger directement le module fusionné sans reporter le correctif dans son harness/test de référence.

## Compatibilité et changements externes

Formative, Mozaïk, Classroom ou Chrome peuvent changer indépendamment.

Chaque adaptateur externe doit donc être une frontière claire:

- `formative/adapter/` pour API/DOM Formative;
- `mozaik/adapter/` pour Mozaïk;
- `classroom/bridge/` pour Classroom;
- `shared/` ne contient aucune connaissance spécifique de ces plateformes.

Si Formative change une mutation, on remplace/teste l'adaptateur Formative sans modifier Mozaïk.

## Gate de fusion d'un module

Un module n'entre dans Cardinal principal que si:

1. ses tests unitaires passent;
2. son standalone/harness passe les scénarios réels;
3. les erreurs sont namespacées;
4. le storage est namespacé et migrable;
5. les permissions sont connues;
6. les diagnostics sont redacted;
7. l'activation/désactivation ne casse pas les autres modules;
8. les tests de régression globaux passent.

## Gate de release Cardinal

Avant publication:

- Formative CREATE/UPDATE/UNCHANGED;
- Gestion des notes workflow courant;
- Mozaïk synchro complète + reprise erreur;
- Classroom pont natif;
- reload extension;
- restart Chrome;
- service worker endormi/réveillé;
- plusieurs onglets;
- absence d'un service externe;
- permissions refusées;
- aucune fuite de secrets;
- migration depuis version précédente;
- désactivation individuelle de chaque module.

## Principe UX

> Une extension pour l'utilisateur, plusieurs modules pour le développeur.

La modularité ne doit jamais créer quatre interfaces séparées ou quatre workflows à comprendre.

Le popup principal reste simple. Les détails techniques sont disponibles seulement dans Diagnostic.

## Relation avec Formative 0.4.1 / 0.5.x

La baseline Formative 0.4.1 reste intacte pendant le développement v2.

Le module Formative v2 est développé/testé séparément. La fusion dans Cardinal principal n'a lieu qu'après validation complète du workflow 0.5.x et régression des fonctions Gestion des notes/Mozaïk/Classroom.

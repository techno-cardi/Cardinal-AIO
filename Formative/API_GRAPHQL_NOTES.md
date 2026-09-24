# Formative API / GraphQL notes

Dernière consolidation: 2026-09-18, audit des preuves jusqu'à v18.1

Ce document ne contient que des opérations observées/capturées dans nos propres tests. Un champ vu dans un fragment n'implique pas que son workflow d'écriture est automatiquement prouvé.

## Hôte principal

`https://svc.goformative.com/graphql/`

## 1. Permission

Endpoint:

`https://svc.goformative.com/graphql/query/FormativePermissionCheck`

Operation:

`FormativePermissionCheck`

Variable:

`formativeId`

Validation utilisée:

- transport OK;
- HTTP 2xx;
- aucune erreur GraphQL;
- `formative._id` égal au Formative courant;
- `viewerPermissions` contient `edit`.

## 2. Lecture du Formative

### FormativeLayout

Operation observée/utilisée dans les labs d'import:

`FormativeLayout`

Sert notamment au préflight et au plan d'upsert: items, subtype, position, points, parentId, texte, sections.

### FormativeTeacher

Operation utilisée par les générations Extended/Smart Upsert pour relire une définition plus complète du Formative et de ses items.

Ne jamais inclure dans Git les données personnelles inutiles que cette query peut retourner.

## 3. Création d'un item

Endpoint:

`https://svc.goformative.com/graphql/mutation/FormativeTeacherAddFormativeItem`

Operation:

`FormativeTeacherAddFormativeItem`

Variables:

- `formativeId: ID!`;
- `subtype: FormativeItemSubType!`;
- `parentId: ID`;
- `input: FormativeItemInput!`.

Retour critique:

`formativeItem._id`

Utilisations prouvées:

- question ordinaire;
- `functionalizedText`;
- question enfant avec `parentId`.

Le test v18.1 a prouvé un parent `functionalizedText` et trois enfants `shortAnswer` partageant le même `parentId`.

## 4. Mise à jour générique d'une question

Endpoint:

`https://svc.goformative.com/graphql/mutation/QuestionEditableUpdateFormativeItem`

Operation:

`QuestionEditableUpdateFormativeItem`

Variables:

- `formativeItemId`;
- `input`;
- `withHasItemTags`.

Utilisé pour:

- texte Tiptap de question;
- paramètres comme `correctAnswers`, `isKeywordGrading`, `isPartialCredit`, `answerChoicePoints` lorsque le subtype les accepte;
- plusieurs structures simples/avancées durant les labs.

## 5. Points

Endpoint:

`https://svc.goformative.com/graphql/mutation/FormativeItemEditableUpdatePoints`

Operation:

`FormativeItemEditableUpdatePoints`

Variables:

- `formativeItemId`;
- `points: Float!`.

### Règle critique d'ordre

Pour une question avec `answerChoicePoints`:

1. écrire le maximum `points` d'abord;
2. écrire les pondérations finales ensuite;
3. ne plus changer `points` après.

Les tests v16.8 ont montré que Formative peut redimensionner les `answerChoicePoints` si le maximum est modifié après les pondérations.

## 6. Questions à choix

Endpoint:

`https://svc.goformative.com/graphql/mutation/WithChoicesMutation`

Operation:

`WithChoicesMutation`

Entrée utilisée:

- `choiceLabels`;
- `choices`;
- `correctAnswers`;
- selon le type: partial credit / `answerChoicePoints` via update complémentaire.

La création/configuration de Multiple Choice et Multiple Selection a été validée dans l'import v14.1.

Les clés `choices` sont des identifiants internes, distincts des libellés visibles.

## 7. Fill In The Blank

Endpoint:

`https://svc.goformative.com/graphql/mutation/FillInTheBlankEditableContainerMutation`

Operation:

`FillInTheBlankEditableContainerMutation`

Entrée importante:

- `text` Tiptap contenant des nœuds `blankItem`;
- `blanks` avec `key`, réponses acceptées et `numeric`.

Nœud Tiptap observé:

```json
{
  "type": "blankItem",
  "attrs": {
    "dir": "auto",
    "id": "<blank-key>",
    "index": null,
    "type": "text"
  }
}
```

L'ordre des blancs doit rester celui du texte.

## 8. Inline Choice / Dropdown

Sous-type confirmé:

`inlineChoice`

Structure prouvée:

- texte Tiptap avec `blankItem`;
- `blanks[].choiceLabels`;
- `blanks[].choices`;
- `blanks[].correctAnswers`;
- `blanks[].key`;
- `numeric: false`.

## 9. Resequence

Sous-type:

`resequence`

Structure testée:

- `choiceLabels`;
- `choices`;
- `correctAnswers` dans l'ordre attendu;
- `isPartialCredit` lorsque souhaité.

## 10. Matching natif

Endpoint:

`https://svc.goformative.com/graphql/mutation/MatchingEditableDetailsContainerMutation`

Operation:

`MatchingEditableDetailsContainerMutation`

Entrée native capturée:

- `choiceLabels`;
- `labels`;
- `choices`;
- `correctAnswers`.

Règle importante d'update:

**préserver les clés existantes** dans `choices` et `correctAnswers` lorsque l'on modifie une question existante.

Observation d'encodage:

- la lecture `targets[].label` peut exposer une chaîne simple;
- la mutation native de Matching a été capturée avec `labels` en Tiptap JSON sérialisé.

Le correctif v17.0 a reçu une réponse serveur valide et a confirmé les libellés `miaule / aboie / chante` avec les IDs conservés.

## 11. Categorize

Structure serveur observée et fonctionnelle:

- `choiceLabels`;
- `choices`;
- `correctAnswers`;
- `targets[]`;
- `targets[].label`;
- `targets[].choices`.

Exemple observé:

- cible `Animaux` -> clés de `chat`, `chien`;
- cible `Fruits` -> clés de `pomme`, `poire`.

Le Smart Upsert choisissait volontairement de préserver une Q9 déjà correcte au lieu de réécrire son contenu spécialisé. La création fallback était fonctionnelle, mais l'adaptateur d'update spécialisé définitif reste à figer.

## 12. Bloc de texte / Functionalized Text

Sous-type natif:

`functionalizedText`

Création:

`FormativeTeacherAddFormativeItem`

### Mutation native de texte

Endpoint:

`https://svc.goformative.com/graphql/mutation/TextEditableUpdate`

Operation:

`TextEditableUpdate`

Variables:

- `formativeItemId`;
- `text: String!` contenant le document Tiptap sérialisé.

La capture v18.0 a observé exactement cette mutation après une édition manuelle d'un bloc texte.

## 13. Passage partagé

Structure prouvée:

1. créer un parent `functionalizedText`;
2. écrire son texte;
3. créer chaque question enfant avec `parentId` égal à l'ID du parent.

v18.1 a validé parent + 3 enfants `shortAnswer`.

Ne pas inventer une mutation distincte `passageGroup`: dans les preuves actuelles, la relation native repose sur `functionalizedText` + `parentId`.

## 14. Keyword Grading absolu

Preuve serveur v17.4:

```text
galette      -> 4
beurre       -> 4
grand-mère   -> 3
mère-grand   -> 3
aller porter -> 2
apporter     -> 2
```

État retourné:

- `points: 4`;
- `correctAnswers` correspondants;
- `answerChoicePoints: [4,4,3,3,2,2]`;
- `isKeywordGrading: true`;
- `isPartialCredit: true`;
- `isCaseSensitive: false`.

Interprétation confirmée:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

Cardinal n'additionne jamais les valeurs de plusieurs mots-clés.

## 15. Champs observés dans FormativeItem

Parmi les champs lus dans les fragments:

- `_id`, `subtype`, `type`, `text`, `position`, `parentId`;
- `details.points`;
- `details.correctAnswers`;
- `details.choices`, `details.choiceLabels`, `details.answerChoicePoints`;
- `details.blanks`;
- `details.isCaseSensitive`, `isKeywordGrading`, `isPartialCredit`, `partialCreditMode`;
- `details.allowEquivalencies`;
- `details.isRandomized`, `isRequired`, `isRubricEnabled`;
- `details.showWordCount`;
- `details.dragAndDrop`, `hotSpot`, `hotText`, `matchTableGrid`;
- `details.targets`, `tabs`, `pins`;
- `variants`, `rubric`, `hints`, `tags`;
- structures Graphing.

Lecture d'un champ != preuve d'écriture.

## 16. Structures avancées encore partielles

### Drag and Drop

Champs observés:

- `choices { key label }`;
- `correctAnswers { choiceKey targetKey }`;
- `dropLocations { placement targetKey x y }`;
- `imageSrc`;
- `source`.

### Hot Spot

- `correctAnswers`;
- `isMultiSelect`;
- `shapes`.

### Hot Text

- `choices`;
- `correctAnswers`;
- `isMultiSelect`;
- `text`.

### Match Table Grid

- `isMultiSelect` et structure associée observée;
- configuration complète non figée.

## 17. Texte riche Tiptap

Forme minimale courante:

```json
{
  "type": "doc",
  "attrs": { "dir": "auto" },
  "content": [
    {
      "type": "paragraph",
      "attrs": { "dir": "auto", "textAlign": null },
      "content": [{ "type": "text", "text": "..." }]
    }
  ]
}
```

Le document complet est généralement sérialisé comme chaîne JSON avant envoi.

## 18. Transport / session / x-tab-id

En-têtes observés dans les labs:

- `accept`;
- `authorization`;
- `content-type`;
- `x-anonymous-id`;
- `x-app-version`;
- `x-session-id`;
- `x-tab-id`;
- `x-user-id`;
- parfois `x-ntp-t0`.

Les valeurs ne doivent jamais être exportées ou commitées.

La voie qui a fonctionné de façon fiable utilise les credentials de la session locale et un `x-tab-id` Cardinal distinct. Les premiers prototypes basés sur un `fetch` direct depuis le userscript ont rencontré `Failed to fetch`; la famille GM/direct transport a résolu ce problème.

Dans l'extension stable, les secrets actifs restent locaux, idéalement dans `chrome.storage.session`.

## 19. Mutation de notes élèves

Endpoint:

`https://svc.goformative.com/graphql/mutation/ResultsSelectedItemSidebarGradeAnswers`

Operation:

`ResultsSelectedItemSidebarGradeAnswers`

Variables:

- `answerIds`;
- `points`;
- `scoreFactor`;
- `rubricLevels`.

Succès uniquement après réponse complète + relecture serveur.

## 20. Feedback

- `AddFeedbackMessage`;
- `RemoveFeedbackMessage`;
- aucune opération séparée d'édition prouvée.

## 21. Introspection GraphQL

Les Smart Upsert ont exploré la possibilité d'interroger `__type(FormativeItemInput)`, mais l'introspection GraphQL n'est pas une dépendance fiable de l'architecture et a été observée comme désactivée/non exploitable dans le contexte Formative.

Règle: ne pas dépendre de l'introspection pour générer les adaptateurs. Capturer les mutations natives réelles.

## 22. Règle de preuve

Avant d'ajouter une opération comme PROVEN:

1. capturer ou reproduire la requête native;
2. noter le contexte exact;
3. conserver variables utiles sans secrets;
4. tester sur un Formative contrôlé;
5. vérifier HTTP + erreurs GraphQL;
6. vérifier les champs critiques de réponse;
7. relire l'état serveur ou l'UI lorsque pertinent;
8. documenter les règles de conservation d'IDs/ordre si nécessaires.
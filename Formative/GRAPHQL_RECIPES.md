# Recettes GraphQL Formative - versions nettoyées

Dernière consolidation: 2026-09-18

But: permettre de reconstruire les adaptateurs prouvés sans devoir recapturer toute l'API.

Ces recettes sont volontairement **minimales et sans IDs/secrets**. Avant une promotion en production après un changement de Formative, tester sur un Formative contrôlé.

## Règles communes

Hôte observé:

`https://svc.goformative.com`

Pattern d'endpoint:

- query: `/graphql/query/<OperationName>`
- mutation: `/graphql/mutation/<OperationName>`

Requête HTTP:

- POST;
- `Content-Type: application/json`;
- `Accept: application/graphql-response+json,application/json;q=0.9`;
- credentials/session locale Formative;
- en-têtes de session capturés localement;
- ne jamais committer les valeurs d'Authorization/cookies/tokens.

Corps:

```json
{
  "operationName": "...",
  "variables": {},
  "query": "..."
}
```

HTTP 2xx ne suffit pas: vérifier `errors`, retour attendu et état final.

# 1. Permission edit

Operation:

`FormativePermissionCheck`

Endpoint:

`/graphql/query/FormativePermissionCheck`

Recette minimale conceptuelle:

```graphql
query FormativePermissionCheck($formativeId: ID!) {
  formative(id: $formativeId) {
    _id
    viewerPermissions
  }
}
```

Valide seulement si `_id` correspond et `viewerPermissions` contient `edit`.

# 2. Créer un item

Operation:

`FormativeTeacherAddFormativeItem`

Endpoint:

`/graphql/mutation/FormativeTeacherAddFormativeItem`

```graphql
mutation FormativeTeacherAddFormativeItem(
  $formativeId: ID!,
  $subtype: FormativeItemSubType!,
  $parentId: ID,
  $input: FormativeItemInput!
) {
  payload: addFormativeItem(
    formativeId: $formativeId,
    subtype: $subtype,
    parentId: $parentId,
    input: $input
  ) {
    formativeItem {
      _id
      subtype
      type
      parentId
    }
  }
}
```

Input de création simple utilisé:

```json
{
  "isRequired": true,
  "preventReuseChoices": null
}
```

Pour un bloc texte, subtype = `functionalizedText`.

Pour une question enfant de passage partagé, fournir `parentId` = ID du `functionalizedText` parent.

# 3. Mettre à jour une question

Operation:

`QuestionEditableUpdateFormativeItem`

Endpoint:

`/graphql/mutation/QuestionEditableUpdateFormativeItem`

```graphql
mutation QuestionEditableUpdateFormativeItem(
  $formativeItemId: ID!,
  $input: FormativeItemInput!,
  $withHasItemTags: Boolean!
) {
  updateFormativeItem(id: $formativeItemId, input: $input) {
    formativeItem {
      _id
      subtype
      text
      details {
        points
        correctAnswers
        answerChoicePoints
        choices
        choiceLabels
        isKeywordGrading
        isPartialCredit
        isCaseSensitive
        partialCreditMode
      }
    }
  }
}
```

`withHasItemTags` a été utilisé à `false` dans les labs.

# 4. Points

Operation:

`FormativeItemEditableUpdatePoints`

Endpoint:

`/graphql/mutation/FormativeItemEditableUpdatePoints`

```graphql
mutation FormativeItemEditableUpdatePoints(
  $formativeItemId: ID!,
  $points: Float!
) {
  updateFormativeItem(
    id: $formativeItemId,
    input: { points: $points }
  ) {
    formativeItem {
      _id
      details { points }
    }
  }
}
```

Invariant:

**points max d'abord, answerChoicePoints ensuite.**

# 5. Choix - Multiple Choice / Multiple Selection

Operation:

`WithChoicesMutation`

Endpoint:

`/graphql/mutation/WithChoicesMutation`

```graphql
mutation WithChoicesMutation($id: ID!, $input: FormativeItemInput!) {
  payload: updateFormativeItem(id: $id, input: $input) {
    formativeItem {
      _id
      details {
        choiceLabels
        choices
        correctAnswers
        answerChoicePoints
        isPartialCredit
        points
      }
    }
  }
}
```

Input principal:

```json
{
  "choiceLabels": ["<Tiptap label>", "<Tiptap label>"],
  "choices": ["<key1>", "<key2>"],
  "correctAnswers": ["<key2>"]
}
```

Les libellés visibles ne sont pas les keys internes.

# 6. Fill In The Blank

Operation:

`FillInTheBlankEditableContainerMutation`

Endpoint:

`/graphql/mutation/FillInTheBlankEditableContainerMutation`

```graphql
mutation FillInTheBlankEditableContainerMutation(
  $formativeItemId: ID!,
  $input: FormativeItemInput!
) {
  payload: updateFormativeItem(id: $formativeItemId, input: $input) {
    formativeItem {
      _id
      text
      details {
        blanks {
          key
          correctAnswers
          choiceLabels
          choices
          numeric
        }
      }
    }
  }
}
```

Le texte Tiptap doit contenir des `blankItem` dont les IDs correspondent aux `blanks[].key`.

# 7. Matching

Operation:

`MatchingEditableDetailsContainerMutation`

Endpoint:

`/graphql/mutation/MatchingEditableDetailsContainerMutation`

```graphql
mutation MatchingEditableDetailsContainerMutation(
  $formativeItemId: ID!,
  $input: FormativeItemInput!
) {
  payload: updateFormativeItem(id: $formativeItemId, input: $input) {
    formativeItem {
      _id
      details {
        choiceLabels
        labels
        choices
        correctAnswers
      }
    }
  }
}
```

Input natif:

```json
{
  "choiceLabels": ["chat", "chien", "oiseau"],
  "labels": ["<Tiptap miaule>", "<Tiptap aboie>", "<Tiptap chante>"],
  "choices": ["<existing-key-1>", "<existing-key-2>", "<existing-key-3>"],
  "correctAnswers": ["<existing-key-1>", "<existing-key-2>", "<existing-key-3>"]
}
```

Sur update, préserver les keys existantes lues sur l'item.

# 8. Bloc texte Functionalized Text

Création:

`FormativeTeacherAddFormativeItem` avec subtype `functionalizedText`.

Écriture du texte:

Operation:

`TextEditableUpdate`

Endpoint:

`/graphql/mutation/TextEditableUpdate`

Recette minimale:

```graphql
mutation TextEditableUpdate($formativeItemId: ID!, $text: String!) {
  updateFormativeItem(
    id: $formativeItemId,
    input: { text: $text }
  ) {
    formativeItem {
      _id
      text
      subtype
    }
  }
}
```

Le `text` est un document Tiptap sérialisé en chaîne JSON.

# 9. Passage partagé

Il n'existe pas, dans nos preuves actuelles, une mutation séparée nommée `passageGroup`.

Recette prouvée:

1. créer `functionalizedText` parent;
2. `TextEditableUpdate` sur parent;
3. pour chaque enfant, `FormativeTeacherAddFormativeItem` avec `parentId` du parent;
4. configurer l'enfant avec les mutations normales de son subtype.

# 10. Short Answer Keyword absolu

Une fois le maximum fixé:

```json
{
  "correctAnswers": [
    "galette",
    "beurre",
    "grand-mère",
    "mère-grand",
    "aller porter",
    "apporter"
  ],
  "answerChoicePoints": [4, 4, 3, 3, 2, 2],
  "isKeywordGrading": true,
  "isPartialCredit": true,
  "isCaseSensitive": false
}
```

Mode prouvé:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

# 11. Inline Choice

Structure d'item prouvée:

- texte Tiptap avec nœud `blankItem`;
- `blanks[]` contenant:
  - `key`;
  - `choiceLabels`;
  - `choices`;
  - `correctAnswers`;
  - `numeric: false`.

Utiliser la voie d'update compatible avec l'item et conserver la cohérence `blankItem.id == blank.key`.

# 12. Resequence

Structure prouvée:

```json
{
  "choiceLabels": ["..."],
  "choices": ["<key1>", "<key2>", "<key3>"],
  "correctAnswers": ["<key2>", "<key1>", "<key3>"],
  "isPartialCredit": true
}
```

`correctAnswers` encode l'ordre attendu des keys.

# 13. Categorize

Structure connue:

```json
{
  "choiceLabels": ["chat", "chien", "pomme", "poire"],
  "choices": ["<k1>", "<k2>", "<k3>", "<k4>"],
  "correctAnswers": ["<k1>", "<k2>", "<k3>", "<k4>"],
  "targets": [
    { "label": "<encoded Animaux>", "choices": ["<k1>", "<k2>"] },
    { "label": "<encoded Fruits>", "choices": ["<k3>", "<k4>"] }
  ]
}
```

Statut: chemin fonctionnel connu, mais l'update spécialisé final reste PARTIAL. Préserver un Categorize déjà conforme plutôt que le réécrire inutilement.

# 14. Notes élèves

Operation:

`ResultsSelectedItemSidebarGradeAnswers`

Endpoint:

`/graphql/mutation/ResultsSelectedItemSidebarGradeAnswers`

Signature observée:

```graphql
mutation ResultsSelectedItemSidebarGradeAnswers(
  $answerIds: [ID!]!,
  $points: Float!,
  $scoreFactor: Float,
  $rubricLevels: [AnswerRubricLevelInput!]!
) {
  teacherGradeAnswers(
    answerIds: $answerIds,
    points: $points,
    scoreFactor: $scoreFactor,
    rubricLevels: $rubricLevels
  ) {
    _id
    points
    possiblePoints
    scoreFactor
    rubricLevels { criterionId levelId }
    updatedAt
  }
}
```

Après mutation: relecture indépendante obligatoire.

# 15. Feedback

Ajout:

`AddFeedbackMessage`

Input connu:

```json
{
  "input": {
    "delayed": null,
    "answerId": "<ANSWER_ID>",
    "formativeItemId": "<QUESTION_ID>",
    "studentId": "<STUDENT_ID>",
    "text": "<TIPTAP_JSON_STRING>"
  }
}
```

Suppression:

`RemoveFeedbackMessage`

Aucune mutation séparée d'édition n'est prouvée.

# 16. Tiptap minimal

```json
{
  "type": "doc",
  "attrs": { "dir": "auto" },
  "content": [
    {
      "type": "paragraph",
      "attrs": { "dir": "auto", "textAlign": null },
      "content": [
        { "type": "text", "text": "Texte" }
      ]
    }
  ]
}
```

Dans les mutations observées, le document est souvent envoyé comme **chaîne JSON sérialisée**.

# 17. Vérification commune

Pour chaque écriture:

1. transport OK;
2. HTTP 2xx;
3. `errors` GraphQL absent/vide;
4. payload attendu non nul;
5. IDs/champs critiques présents;
6. relire le layout/item si nécessaire;
7. vérifier la SPA seulement lorsque le comportement visible est lui-même une exigence;
8. ne jamais annoncer succès avant ces vérifications.

# 18. Ce qui n'est volontairement pas ici

- Authorization réel;
- cookies;
- x-tab-id réel;
- IDs de Formative/items de calibration;
- énormes fragments GraphQL de l'application;
- opérations non prouvées.

Le but est de conserver le savoir reconstructible, pas un dump fragile de l'application.
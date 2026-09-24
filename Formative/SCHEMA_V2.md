# Cardinal Formative v2 - schéma canonique

Dernière mise à jour: 2026-09-20
Statut: **contrat v2 figé pour implémentation 0.5.x**
Schéma: `cardinal.formative/2`
Version de protocole initiale: `2.0.0`

## But

Ce document fige la forme du paquet produit par ChatGPT et consommé par Cardinal pour le workflow:

`PDF(s) -> Préparer pour Formative -> tableau de vérification -> Importer`

Le paquet doit être portable dans un nouveau chat, un autre compte ChatGPT et un autre modèle. Il ne doit dépendre d'aucune mémoire conversationnelle.

Le schéma décrit l'intention pédagogique. Cardinal demeure responsable de la normalisation technique, des fingerprints, de la validation, de l'upsert, de la vérification serveur et du journal.

## Principe

> ChatGPT comprend et propose. Cardinal valide et normalise. Formative exécute et confirme.

Aucune donnée technique de session Formative ne fait partie du paquet.

## Enveloppe obligatoire

```json
{
  "schema": "cardinal.formative/2",
  "protocolVersion": "2.0.0",
  "packageMode": "full",
  "assessment": {},
  "sources": [],
  "items": [],
  "issues": []
}
```

### `packageMode`

Deux valeurs seulement:

- `full`: le paquet décrit l'évaluation complète voulue à partir des sources fournies;
- `patch`: le paquet ne décrit que les éléments explicitement présents.

Règle critique:

- en mode `patch`, l'absence d'une question ne signifie **jamais** qu'elle a été supprimée;
- en mode `full`, un item Formative existant absent du paquet peut devenir `DELETE_PROPOSED`, jamais une suppression automatique.

Le test ciblé Q16 doit donc être un `patch`, pas un faux questionnaire complet d'une seule question.

## Assessment

Champs canoniques:

```json
{
  "title": "L'explosion de Tchernobyl",
  "language": "fr-CA",
  "sourceMode": "external-reference-only",
  "declaredTotalPoints": {
    "value": 85,
    "provenance": "provided"
  },
  "targetHint": "Tchernobyl - Groupe 51"
}
```

### `sourceMode`

- `external-reference-only`: défaut. Les textes de lecture servent à construire le corrigé mais ne sont pas injectés dans Formative;
- `embedded`: utilisé seulement si le passage doit réellement être visible dans Formative.

### `declaredTotalPoints.provenance`

- `provided`: total explicitement fourni par la source;
- `proposed`: proposé par ChatGPT parce que la source ne l'indique pas;
- `derived`: somme calculée depuis des points fournis individuellement.

Cardinal recalcule toujours le total effectif.

## Sources

Chaque source reçoit une clé logique locale au paquet.

Exemple:

```json
{
  "id": "questions",
  "role": "questionnaire",
  "label": "Questionnaire Tchernobyl",
  "fileName": "questionnaire.pdf",
  "status": "provided"
}
```

### Rôles permis

- `questionnaire`;
- `text`;
- `answerKey`;
- `rubric`;
- `appendix`;
- `unknown`.

### Statuts permis

- `provided`: source réellement fournie dans le chat;
- `missing`: source nécessaire identifiée mais absente;
- `external`: source volontairement externe au paquet.

Exemple source manquante:

```json
{
  "id": "starship",
  "role": "text",
  "label": "Texte Starship",
  "status": "missing"
}
```

### Fingerprints

ChatGPT n'invente pas le fingerprint canonique.

Cardinal enrichit localement la source avec, lorsque disponible:

- SHA-256 binaire du fichier;
- fingerprint sémantique normalisé;
- métadonnées de page utiles.

Un hash binaire seul ne peut pas définir l'identité éternelle d'une source: un même document réexporté peut changer octet par octet sans changer pédagogiquement. Cardinal doit pouvoir rapprocher des versions par contenu/sourcePromptExact lorsque nécessaire.

## Identité des items

Chaque item contient un `id` logique unique dans le paquet, par exemple `q16` ou `section-interpretation`.

Cet `id` est utile aux références internes mais **n'est pas** l'identité canonique durable.

Cardinal calcule un `itemFingerprint` à partir des meilleures preuves disponibles:

1. fingerprint source;
2. page;
3. numéro et sous-numéro source;
4. `promptExact`;
5. ancrages structurels utiles.

Ordre de résolution d'un item Formative existant:

1. mapping local connu;
2. item fingerprint;
3. source + page + numéro;
4. ancien prompt exact;
5. similarité forte, unique et non ambiguë;
6. sinon `BLOCKED`.

## Ordre des items

Chaque item possède un entier `order`.

- en `full`, l'ordre décrit l'ordre complet voulu;
- en `patch`, l'ordre est un indice de position/source mais l'absence d'autres ordres ne déclenche aucun réordonnancement global.

Les ordres dupliqués sont un problème de validation.

## Types d'items

Le v2 accepte quatre `kind` conceptuels:

- `section`;
- `instruction`;
- `question`;
- `passageGroup`.

Le texte source externe n'est pas un item Formative en mode `external-reference-only`; il vit dans `sources`.

## Section

```json
{
  "id": "section-comprehension",
  "kind": "section",
  "order": 1,
  "content": "COMPRÉHENSION"
}
```

Une section devient normalement un `functionalizedText` simple.

## Instruction

```json
{
  "id": "instruction-1",
  "kind": "instruction",
  "order": 2,
  "content": "Réponds en phrases complètes."
}
```

Une instruction n'est jamais une question notée.

## Passage partagé

Utiliser seulement lorsque le passage doit être intégré dans Formative.

```json
{
  "id": "passage-1",
  "kind": "passageGroup",
  "order": 3,
  "embed": true,
  "sourceRefs": ["texte-a"],
  "content": "...",
  "questionIds": ["q1", "q2", "q3"]
}
```

Implémentation native prouvée:

1. parent `functionalizedText`;
2. texte du parent via `TextEditableUpdate`;
3. enfants créés avec `parentId` du parent.

Le rendu visuel side-by-side exact reste une capacité distincte à ne pas inventer.

## Question

Structure commune:

```json
{
  "id": "q6",
  "kind": "question",
  "order": 8,
  "source": {
    "sourceRef": "questions",
    "page": 3,
    "printedPage": "4",
    "number": "6",
    "subNumber": null,
    "promptExact": "6) Explique la chaîne cause-conséquence..."
  },
  "sourceRefs": ["texte-principal"],
  "prompt": "Explique la chaîne cause-conséquence...",
  "subtype": "shortAnswer",
  "required": true,
  "points": {
    "value": 3,
    "provenance": "provided",
    "graded": true,
    "bonus": false
  },
  "grading": {},
  "transformations": [],
  "issues": []
}
```

### `source.promptExact`

Doit conserver la formulation source aussi fidèlement que possible, y compris la numérotation.

### `prompt`

Texte envoyé à Formative.

Par défaut, seule une transformation technique telle que retirer `6)` ou `Q6` est permise sans revue.

Toute réécriture qui change potentiellement le construit évalué doit être inscrite dans `transformations` et normalement exiger une revue.

## Sous-types v2

Sous-types autorisés par le schéma initial:

- `shortAnswer`;
- `longAnswer`;
- `multipleChoice`;
- `multipleSelection`;
- `fillInTheBlank`;
- `inlineChoice`;
- `resequence`;
- `matching`;
- `unsupported`.

`unsupported` signifie: la question est préservée dans le paquet mais l'import doit être bloqué ou transformé explicitement. Cela vaut mieux que d'inventer un subtype.

Le fait qu'un subtype soit permis par le schéma ne suffit pas: Cardinal vérifie aussi la matrice de capacités intégrées de sa propre version.

## Points

Objet canonique:

```json
{
  "value": 4,
  "provenance": "provided",
  "graded": true,
  "bonus": false
}
```

Règles:

- valeur >= 0;
- maximum une décimale;
- `provided`, `proposed` ou `derived`;
- `graded:false` distingue une question volontairement non notée d'un oubli;
- `bonus:true` doit être explicite;
- aucun score de concept ne dépasse `points.value`.

## Grading

Trois modes seulement:

- `auto`;
- `assisted`;
- `manual`.

Structure:

```json
{
  "mode": "assisted",
  "expectedAnswer": "Le xénon-135 s'accumule et freine la réaction...",
  "provenance": {
    "kind": "sourceExplicit",
    "sourceRefs": ["texte-principal"]
  },
  "partialCredit": true,
  "caseSensitive": false,
  "requirements": [],
  "concepts": []
}
```

### Provenance

Valeurs permises:

- `providedAnswerKey`;
- `sourceExplicit`;
- `sourceInferred`;
- `questionIntrinsic`;
- `teacherApproved`;
- `sourceMissing`.

Priorité pédagogique:

`providedAnswerKey > sourceExplicit > sourceInferred > questionIntrinsic > aucune réponse`

`teacherApproved` signifie qu'une décision locale du professeur a remplacé la proposition initiale.

Une provenance `sourceMissing` interdit un mode `auto`.

## Concepts

Le v2 raisonne par concepts avant de générer les termes.

```json
{
  "id": "xenon",
  "label": "Accumulation de xénon",
  "description": "Le xénon-135 agit comme un poison neutronique et freine la réaction.",
  "score": 2.5,
  "provenance": "sourceExplicit",
  "terms": ["xénon", "xénon-135", "empoisonnement"],
  "riskyTerms": ["gaz"]
}
```

Règles:

- `score` = note absolue déclenchée par un match Formative;
- les scores ne sont jamais additionnés côté Cardinal;
- les `terms` d'un même concept partagent le même score;
- un même terme ne peut pas appartenir à deux concepts avec des scores différents;
- `riskyTerms` servent à la revue mais ne sont pas activés automatiquement;
- un concept n'existe pas simplement parce qu'un mot apparaît dans la source: il doit représenter une idée réellement attendue.

## Variantes mécaniques

ChatGPT produit les équivalences sémantiques.

Cardinal génère lorsque sûr:

- version sans accents;
- apostrophes droites/typographiques;
- casse lorsque non sensible;
- certaines variantes espace/trait d'union.

Ces variantes sont dédupliquées avant envoi.

Les fautes réelles comme `grafite` restent une décision sémantique/pédagogique, pas une transformation mécanique universelle.

## Requirements

Les exigences de tâche servent à éviter une fausse autocorrection.

Exemple:

```json
{
  "type": "distinctConcepts",
  "count": 2,
  "note": "Nommer deux conséquences différentes."
}
```

Types prévus:

- `distinctConcepts`;
- `explainEach`;
- `compareSources`;
- `argumentAndEvidence`;
- `chooseNofM`;
- `citation`;
- `relation`;
- `other`.

Si une question exige plusieurs composantes et que Formative ne peut pas vérifier leur présence/association avec le mécanisme Keyword absolu, le mode doit généralement être `assisted`.

## Multiple Choice / Multiple Selection

Utiliser `response.options`:

```json
{
  "response": {
    "options": [
      {"id": "a", "label": "Réponse A", "correct": false},
      {"id": "b", "label": "Réponse B", "correct": true}
    ]
  }
}
```

Règles:

- IDs d'option uniques dans la question;
- Multiple Choice: exactement une option correcte;
- Multiple Selection: au moins une correcte;
- un `score` optionnel peut être utilisé lorsque la pondération partielle est explicitement voulue et supportée.

## Fill In The Blank

Format compact v2:

```json
{
  "prompt": "Date: {{date}}. Pays actuel: {{pays}}.",
  "response": {
    "blanks": [
      {"id": "date", "answers": ["1986"]},
      {"id": "pays", "answers": ["Ukraine"]}
    ]
  }
}
```

Cardinal transforme les placeholders `{{id}}` en nœuds Tiptap `blankItem`.

Validations obligatoires:

- chaque placeholder possède exactement une définition;
- aucune définition orpheline;
- chaque blanc possède au moins une réponse;
- IDs uniques.

## Inline Choice / Dropdown

```json
{
  "prompt": "La centrale se trouve aujourd'hui en {{pays}}.",
  "response": {
    "dropdowns": [
      {
        "id": "pays",
        "options": ["Ukraine", "Russie", "Biélorussie"],
        "correct": ["Ukraine"]
      }
    ]
  }
}
```

Même règle de correspondance placeholder <-> définition.

## Resequence

```json
{
  "response": {
    "sequence": ["Le", "chat", "dort", "ici"]
  }
}
```

L'ordre du tableau est l'ordre correct.

## Matching

```json
{
  "response": {
    "pairs": [
      {"left": "chat", "right": "miaule"},
      {"left": "chien", "right": "aboie"}
    ]
  }
}
```

Cardinal génère les clés internes à la création et préserve les clés réelles existantes lors d'un update.

## Transformations

Format:

```json
{
  "code": "removeSourceNumber",
  "description": "Retrait de '6)' parce que Formative numérote déjà.",
  "requiresReview": false
}
```

Codes prévus:

- `removeSourceNumber`;
- `normalizeTypography`;
- `splitQuestion`;
- `mergeQuestion`;
- `changeResponseType`;
- `other`.

Seuls `removeSourceNumber` et une normalisation typographique sans effet de sens sont silencieux par défaut.

`splitQuestion`, `mergeQuestion` et `changeResponseType` nécessitent une revue parce qu'ils peuvent modifier le construit évalué.

## Issues

Format:

```json
{
  "severity": "blocker",
  "code": "SOURCE_REQUIRED",
  "message": "Le texte Starship nécessaire à la correction n'a pas été fourni.",
  "itemId": "q17",
  "sourceRef": "starship"
}
```

Deux sévérités:

- `warning`;
- `blocker`.

L'interface utilisateur traduit ensuite en trois états simples:

- `✓ Prêt`;
- `⚠ À vérifier`;
- `✕ Bloqué`.

## Field ownership

Le paquet v2 ne doit pas contenir arbitrairement tous les champs Formative.

Par défaut, Cardinal peut gérer seulement les champs qu'il sait représenter et vérifier:

- texte/prompt;
- points;
- required;
- showWordCount lorsqu'explicite;
- answer key / Keyword grading;
- choix/blancs/dropdowns/séquence/paires;
- blocs texte/passages créés par Cardinal.

Cardinal doit préserver les champs existants qu'il ne possède pas, notamment sauf support explicite ultérieur:

- rubriques;
- médias/images;
- hints;
- tags;
- réglages spécialisés inconnus;
- autres métadonnées Formative.

Absence d'un champ dans le paquet != demande d'effacement.

## Suppression

Aucune suppression directe dans le schéma v2 initial.

En mode `full`, Cardinal peut détecter un item ancien non revendiqué et produire `DELETE_PROPOSED` dans le plan local. Une confirmation distincte est obligatoire avant toute future mutation de suppression.

En mode `patch`, aucune déduction de suppression n'est permise.

## Validation structurale vs sémantique

Le fichier `cardinal.formative.v2.schema.json` valide la structure JSON.

Le validateur Cardinal doit ajouter les règles sémantiques qui ne s'expriment pas proprement en JSON Schema, notamment:

- somme des points;
- unicité des IDs/order au niveau métier;
- termes dupliqués entre concepts;
- score <= maximum;
- classification auto/assisted/manual;
- source manquante;
- placeholder/blank exact;
- subtype réellement intégré dans la version courante;
- conflit avec le serveur;
- ownership des champs;
- cible Formative;
- full vs patch;
- modifications externes depuis le dernier import.

Voir `VALIDATOR_V2_SPEC.md`.

## Compatibilité et évolution

Le v2 initial accepte exactement:

`schema = cardinal.formative/2`

`protocolVersion = 2.0.0`

Une extension ne doit pas accepter silencieusement une version future inconnue.

Règle de compatibilité:

- même version connue: accepter si validation OK;
- version inconnue: `BLOCKED_PROTOCOL_VERSION`;
- migration explicite requise si un futur 2.x/3.x change le contrat.

## Exemple minimal complet

```json
{
  "schema": "cardinal.formative/2",
  "protocolVersion": "2.0.0",
  "packageMode": "patch",
  "assessment": {
    "title": "Tchernobyl",
    "language": "fr-CA",
    "sourceMode": "external-reference-only"
  },
  "sources": [
    {
      "id": "questions",
      "role": "questionnaire",
      "label": "Questionnaire",
      "fileName": "questions.pdf",
      "status": "provided"
    },
    {
      "id": "texte",
      "role": "text",
      "label": "Texte Tchernobyl",
      "fileName": "texte.pdf",
      "status": "provided"
    }
  ],
  "items": [
    {
      "id": "q6",
      "kind": "question",
      "order": 6,
      "source": {
        "sourceRef": "questions",
        "page": 3,
        "number": "6",
        "promptExact": "6) Explique pourquoi la chute de puissance..."
      },
      "sourceRefs": ["texte"],
      "prompt": "Explique pourquoi la chute de puissance...",
      "subtype": "shortAnswer",
      "required": true,
      "points": {
        "value": 3,
        "provenance": "provided",
        "graded": true,
        "bonus": false
      },
      "grading": {
        "mode": "assisted",
        "expectedAnswer": "La chute favorise l'accumulation de xénon; les opérateurs retirent davantage de barres et réduisent la marge de sécurité.",
        "provenance": {
          "kind": "sourceExplicit",
          "sourceRefs": ["texte"]
        },
        "partialCredit": true,
        "caseSensitive": false,
        "requirements": [
          {
            "type": "relation",
            "note": "La réponse doit expliquer la chaîne cause-conséquence."
          }
        ],
        "concepts": [
          {
            "id": "xenon",
            "label": "Xénon",
            "score": 2.5,
            "provenance": "sourceExplicit",
            "terms": ["xénon", "xénon-135", "empoisonnement"]
          },
          {
            "id": "barres",
            "label": "Retrait des barres",
            "score": 2.5,
            "provenance": "sourceExplicit",
            "terms": ["barres", "retrait"]
          },
          {
            "id": "marge",
            "label": "Perte de marge de sécurité",
            "score": 3,
            "provenance": "sourceExplicit",
            "terms": ["marge", "sécurité"]
          }
        ]
      },
      "transformations": [
        {
          "code": "removeSourceNumber",
          "description": "Retrait de '6)' du prompt Formative.",
          "requiresReview": false
        }
      ],
      "issues": []
    }
  ],
  "issues": []
}
```

## Règle de sortie pour ChatGPT

Le prompt embarqué dans Cardinal doit demander à ChatGPT de produire:

1. un tableau humain compact;
2. le paquet `CARDINAL_FORMATIVE_PACKAGE_V2` contenant un objet conforme à ce contrat;
3. aucun secret/session/ID technique Formative;
4. aucun fait inventé lorsque la source ne le permet pas;
5. des `issues` explicites pour tout doute matériel.

Le paquet technique peut être masqué par l'extension après détection.

## Décision figée

Ce schéma est la cible de développement de 0.5.x.

Ne pas modifier sa structure de fond pendant l'implémentation pour corriger un simple détail UI. Toute modification normative doit être documentée ici, reflétée dans le JSON Schema, ajoutée à la matrice de tests et versionnée.
# Import et création de questionnaires Formative

Dernière consolidation: 2026-09-20

## Objectif

Transformer une source pédagogique, notamment un PDF, en questionnaire Formative structuré, révisable, cohérent pédagogiquement et importable par Cardinal sans recréation manuelle question par question.

Le workflow doit rester simple pour Kevin:

`joindre PDF(s) -> Préparer pour Formative -> vérifier un tableau -> Importer`

## État actuel

### Schéma en production standalone

`cardinal.formative/1`

### Baseline importeur

`Cardinal Formative Importer Standalone 0.4.1`

### Prochaine cible

`cardinal.formative/2` + 0.5.0

Lire `PROTOCOL_V2_PLAN.md` avant de modifier le contrat ou l'UX.

## Architecture actuelle validée

1. ChatGPT lit les sources.
2. ChatGPT distingue texte, questions, corrigé et consignes.
3. ChatGPT produit un tableau visible de validation.
4. ChatGPT produit un paquet `cardinal.formative/1` cachable par l'extension.
5. Cardinal détecte le paquet dans ChatGPT.
6. Cardinal valide le paquet.
7. Cardinal identifie le Formative cible et la permission `edit`.
8. Cardinal lit l'état actuel.
9. Cardinal produit un plan CREATE / UPDATE / UNCHANGED / BLOCKED.
10. Cardinal écrit séquentiellement via mutations natives.
11. Cardinal affiche la progression dans ChatGPT et Formative.
12. Cardinal conserve un statut d'import non secret.
13. Un réimport identique ne doit pas dupliquer.

Cycle réel validé sur Tchernobyl:

`CREATE -> UPDATE ciblé -> UNCHANGED`

## Règle de source par défaut

### Texte + questions

Le texte sert à établir le corrigé.

Par défaut:

`sourceMode = external-reference-only`

Le texte de lecture n'est pas importé dans Formative.

Seules les questions, sections et consignes utiles sont importées.

### Questionnaire seul

Les questions peuvent être préparées. Si une correction dépend d'un texte absent, marquer la source comme manquante au lieu d'inventer.

### Corrigé fourni

Le corrigé fourni a priorité sur une déduction ChatGPT, sauf conflit clair avec la consigne/source.

## Fidélité de la question

Ne jamais ajouter le numéro source dans le prompt Formative.

Exemple source:

`16) Le texte présente plusieurs conséquences...`

Prompt Formative:

`Le texte présente plusieurs conséquences...`

Le numéro doit rester une métadonnée, pas du texte visible du prompt.

Ne pas réécrire silencieusement une question sur le fond. Si une incohérence est détectée, la montrer dans la preview.

## Schéma canonique v1

Exemple minimal:

```json
{
  "schema": "cardinal.formative/1",
  "assessment": {
    "id": "...",
    "title": "...",
    "language": "fr-CA",
    "sourceMode": "external-reference-only"
  },
  "items": [
    {
      "id": "q-001",
      "kind": "question",
      "subtype": "shortAnswer",
      "prompt": "Quelle est la quête...?",
      "points": 4,
      "grading": {
        "mode": "keyword-absolute",
        "partialCredit": true,
        "caseSensitive": false,
        "matches": [
          {"text": "galette", "score": 4, "enabled": true}
        ]
      }
    }
  ]
}
```

## Preview visible

Le JSON technique ne doit jamais être la seule manière de valider.

Le tableau doit montrer au minimum:

- numéro source;
- question;
- type Formative;
- points;
- mode de correction;
- résumé du corrigé.

Le futur v2 doit permettre un bouton `Voir le corrigé` pour afficher la banque réelle sans surcharger le tableau.

## Keyword Grading

Preuve serveur:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

Un match ne constitue pas un bonus additionné à d'autres matches.

Ordre d'écriture:

1. maximum de points;
2. `correctAnswers` / `answerChoicePoints`;
3. ne plus changer le maximum.

### Philosophie pédagogique

Produire beaucoup de réponses acceptables, mais privilégier des termes discriminants.

Priorité:

1. mots uniques discriminants;
2. synonymes équivalents;
3. flexions utiles;
4. fautes plausibles peu ambiguës;
5. expressions courtes lorsque nécessaires.

Ne pas utiliser un mot générique à forte valeur simplement parce qu'il se trouve dans la source.

## Free Response / Long Answer

Baseline 0.4.1 peut configurer des mots-clés pondérés sur `longAnswer`.

C'est désormais souhaité: les réponses libres doivent aussi avoir un corrigé lorsque la source permet d'établir des éléments attendus.

Cependant, la présence d'un answer key ne signifie pas qu'une question complexe est fiable en auto-correction.

Le futur protocole v2 distingue:

- `auto`;
- `assisted`;
- `manual`.

### Pourquoi `assisted`

Cas typiques:

- deux conséquences à expliquer;
- deux arguments;
- comparer deux textes;
- repérer deux marqueurs et expliquer chacun;
- jugement argumenté.

Un mot-clé seul ne prouve pas que toutes les composantes sont présentes.

## Négation / contradiction

Exemple:

`Il n'y a pas eu d'explosion.`

contient `explosion`.

Donc les questions où un bon mot peut apparaître dans une réponse fausse doivent être traitées avec prudence, généralement `assisted`.

## Génération par concepts

Le futur schéma v2 doit regrouper les mots par concepts attendus.

Exemple:

- concept `extrémité des barres` -> graphite, pointe, extrémité;
- concept `effet` -> sursaut, augmente, réaction;
- concept `état du réacteur` -> emballement, instable.

Cardinal pourra ensuite générer les variantes mécaniques accent/apostrophe/casse.

## Bloc texte natif

PROVEN:

`functionalizedText`

Création:

`FormativeTeacherAddFormativeItem`

Écriture:

`TextEditableUpdate`

Les sections comme COMPRÉHENSION / INTERPRÉTATION peuvent être des blocs texte.

Ne pas confondre section et texte source de lecture.

## Passage partagé

Structure PROVEN:

1. parent `functionalizedText`;
2. texte du passage sur parent;
3. questions enfants avec `parentId`.

Le passage partagé ne doit être utilisé que si le besoin pédagogique exige réellement le texte dans Formative. Par défaut, le texte source reste externe.

## Smart Upsert

Actions:

- CREATE;
- UPDATE;
- UNCHANGED;
- BLOCKED.

0.4.1 ajoute une récupération prudente si le mapping local manque:

- subtype identique;
- texte exact ou forte similarité;
- différence claire avec le deuxième candidat.

Plusieurs candidats = bloquer, pas deviner.

Futur v2: fingerprints déterministes à partir des sources.

## Identité future v2

Cardinal doit calculer les fingerprints.

Données source à conserver:

- fichier;
- SHA-256 fichier;
- page;
- numéro source;
- prompt exact;
- éventuellement références de texte.

Le même document doit produire la même identité dans un autre chat/autre compte.

## Points

Règles:

- conserver les points fournis;
- une décimale maximum;
- vérifier total annoncé;
- si points absents, marquer les points comme proposés;
- score Keyword <= maximum;
- total incohérent => avertissement bloquant ou confirmation explicite.

## Types branchés dans 0.4.1

- shortAnswer;
- longAnswer;
- multipleChoice;
- multipleSelection;
- fillInTheBlank;
- inlineChoice;
- resequence;
- matching;
- categorize.

Contenu:

- functionalizedText;
- parent/enfants via parentId.

Lire `CAPABILITY_MATRIX.md` pour le niveau exact de preuve de chaque type.

## Matching

Mutation native:

`MatchingEditableDetailsContainerMutation`

Sur update, préserver les IDs/keys existants.

## Fill In The Blank

Chaque blanc logique doit avoir une clé unique cohérente avec le `blankItem` Tiptap.

Le nombre de blancs et de définitions doit correspondre.

Les réponses acceptées doivent être nombreuses mais pertinentes.

## Inline Choice

Le blanc Tiptap et les structures `choiceLabels` / `choices` / `correctAnswers` doivent rester alignés.

## Angles morts que l'import final doit vérifier

- source indispensable absente;
- plusieurs textes;
- image/figure/graphique/tableau requis par la question;
- PDF scanné/ordre de lecture incertain;
- deux questions portant le même numéro;
- sous-questions a/b/c;
- points absents;
- total incohérent;
- question multipartie;
- mot trop générique;
- négation;
- prompt réécrit sans avertissement;
- numérotation source visible dans Formative;
- mauvais Formative cible;
- plusieurs onglets Formative;
- import interrompu;
- double clic;
- suppression implicite;
- réordonnancement;
- mapping perdu;
- contexte extension invalidé;
- changement API Formative;
- changement DOM ChatGPT;
- session expirée;
- erreur GraphQL avec HTTP 200;
- réponse serveur différente de l'état désiré.

## Futur validateur v2

Avant import:

- schema/version supportés;
- fingerprints/IDs uniques;
- subtype supporté;
- points cohérents;
- correction présente;
- score <= maximum;
- blanks valides;
- choix valides;
- source manquante détectée;
- texte source non embarqué par accident;
- termes génériques signalés;
- cible explicite;
- plan CREATE/UPDATE/UNCHANGED/BLOCKED.

## Dry-run / reprise

Fonctions souhaitées 0.5.0:

- `Vérifier sans importer`;
- plan lisible;
- journal item par item;
- reprise après erreur;
- verrou anti-double-import;
- suppressions seulement proposées;
- rapport final.

## Interdictions

Ne jamais:

- parser le PDF dans l'extension;
- utiliser le menu `+` comme moteur normal;
- utiliser un bouton générique `Ajouter`;
- recharger Formative comme mécanisme normal de synchro;
- recréer un item identique;
- toucher à un item non revendiqué;
- inventer une mutation;
- additionner les scores Keyword;
- changer le maximum après les pondérations;
- changer les IDs internes Matching sans raison;
- traiter HTTP 200 comme seule preuve de succès;
- dépendre de l'introspection GraphQL;
- importer le texte source par défaut;
- laisser la numérotation source dans le prompt Formative;
- inventer une correction lorsque la source nécessaire manque.

## Prochaine étape produit

0.5.0 doit surtout standardiser le protocole, pas réexplorer l'API.

Lire `PROTOCOL_V2_PLAN.md` et conserver 0.4.1 intact comme fallback jusqu'à validation end-to-end de v2.
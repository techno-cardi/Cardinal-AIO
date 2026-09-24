# Matrice de capacités Formative

Dernière mise à jour: 2026-09-20

## Légende

- `PROVEN`: création/configuration pertinente capturée et testée avec vérification suffisante.
- `INTEGRATED`: branché dans la baseline standalone 0.4.1.
- `PARTIAL`: structure ou création connue, mais update/configuration avancée ou validation finale reste incomplète.
- `NOT_PROVEN`: représentation connue mais aucune écriture fiable prouvée.
- `NOT_MAPPED`: type répertorié mais pas encore priorisé.
- `OUT_OF_PROFILE`: volontairement exclu du profil actuel.

Important: `PROVEN` et `INTEGRATED` sont deux axes différents. Une capacité peut être prouvée historiquement sans être branchée dans le moteur courant, ou être branchée avec prudence malgré une preuve plus partielle de certains updates spécialisés.

## Baseline 0.4.1

`CFI_SUPPORTED_QUESTION_TYPES` contient:

- shortAnswer;
- longAnswer;
- multipleChoice;
- multipleSelection;
- fillInTheBlank;
- inlineChoice;
- resequence;
- matching;
- categorize.

Éléments de contenu branchés:

- functionalizedText;
- parent/enfants via parentId.

## Questions

| Type Formative | Sous-type interne / structure | Preuve technique | Intégré 0.4.1 | Note |
| --- | --- | --- | --- | --- |
| Free Response | `longAnswer` | PROVEN | oui | points/showWordCount historiques + answer key Keyword branché et testé dans workflow réel 0.4.x |
| Multiple Choice | `multipleChoice` | PROVEN | oui | choix/clé via `WithChoicesMutation` |
| Multiple Selection | `multipleSelection` | PROVEN | oui | partial credit/pondérations historiquement testés |
| Short Answer | `shortAnswer` | PROVEN | oui | v13 live + v14.1 + v17.4 Keyword absolu |
| Drawing | `drawing` | NOT_MAPPED | non | pas prioritaire |
| True or False | à confirmer définitivement | PARTIAL | non | adaptateur final non figé |
| Multi-Part | conteneur | PARTIAL | non | ne pas confondre avec functionalizedText |
| Audio Response | audio response | NOT_MAPPED | non | réponse manuelle |
| Categorize | `categorize` | PARTIAL | oui, prudent | structure fonctionnelle connue; éviter de réécrire inutilement un item spécialisé déjà correct |
| Drag and Drop | `dragAndDrop` | PARTIAL | non | création connue, configuration avancée non figée |
| File Response | file response | NOT_MAPPED | non | réponse manuelle |
| Fill In The Blank | `fillInTheBlank` | PROVEN | oui | blankItem + mutation FITB native |
| Graphing | graphing | NOT_MAPPED | non | fragments lus, écriture non prête |
| Number Line | number line | NOT_MAPPED | non | pas prioritaire |
| Hot Spot | hotSpot probable | NOT_MAPPED | non | écriture non prouvée |
| Hot Text | hotText probable | PARTIAL | non | structure lue, adaptateur final non figé |
| Dropdown | `inlineChoice` | PROVEN | oui | blank Tiptap + choices/choiceLabels/correctAnswers |
| Match Table Grid | `matchTableGrid` | PARTIAL | non | configuration complète non figée |
| Matching | `matching` | PROVEN | oui | mutation native capturée/testée, IDs/keys à préserver |
| Numeric | `numeric` | OUT_OF_PROFILE | non | volontairement exclu |
| Resequence | `resequence` | PROVEN | oui | ordre + partial credit testés |
| Video Response | video response | NOT_MAPPED | non | réponse manuelle |

## Éléments de contenu et groupes

| Élément | Représentation native | Preuve | Intégré 0.4.1 | Note |
| --- | --- | --- | --- | --- |
| Bloc de texte | `functionalizedText` | PROVEN | oui | v18.0 + TextEditableUpdate |
| Passage partagé | parent functionalizedText + enfants parentId | PROVEN | oui | v18.1 parent + 3 enfants |
| Relation parent/enfants | `parentId` | PROVEN | oui | structure native |
| Side-by-side visuel exact | réglage éventuel distinct | PARTIAL | non garanti | ne pas surpromettre |

## Keyword Grading

État: **PROVEN côté serveur**.

Mode:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

Exemple /4:

- galette -> 4;
- beurre -> 4;
- grand-mère -> 3;
- mère-grand -> 3;
- aller porter -> 2;
- apporter -> 2.

Invariant d'ordre:

1. fixer points;
2. écrire answerChoicePoints;
3. ne plus modifier le maximum.

## Free Response Keyword

Baseline 0.4.1 branche sur `longAnswer`:

- correctAnswers;
- answerChoicePoints;
- isKeywordGrading;
- isPartialCredit;
- isCaseSensitive.

Cette capacité est **INTEGRATED** et a été utilisée dans le test réel de mise à jour Q16.

Limite pédagogique: une banque Keyword sur Free Response ne rend pas automatiquement fiable une auto-correction de tâche complexe. Le protocole v2 prévoit `auto` / `assisted` / `manual`.

## Moteur d'upsert

### Preuve historique

Smart Upsert v16.8:

- CREATE;
- UPDATE;
- UNCHANGED;
- conflit;
- préservation items non Cardinal;
- zéro requête pour unchanged;
- relecture finale.

### Baseline 0.4.1

Cycle réel validé:

- import questionnaire réel;
- update ciblé;
- réimport unchanged;
- aucune duplication.

Fallback si mapping local perdu:

- subtype identique;
- texte exact;
- sinon forte similarité + marge suffisante;
- ambiguïté => pas de choix arbitraire.

Futur v2: fingerprints déterministes issus des sources.

## Adaptateurs/opérations principales

| Fonction | Opération principale |
| --- | --- |
| permission | `FormativePermissionCheck` |
| lecture layout | `FormativeLayout` |
| création item | `FormativeTeacherAddFormativeItem` |
| texte/réglages question | `QuestionEditableUpdateFormativeItem` |
| points | `FormativeItemEditableUpdatePoints` |
| choix | `WithChoicesMutation` |
| texte à trous | `FillInTheBlankEditableContainerMutation` |
| matching | `MatchingEditableDetailsContainerMutation` |
| bloc texte | `TextEditableUpdate` |
| notes élèves | `ResultsSelectedItemSidebarGradeAnswers` |
| feedback | `AddFeedbackMessage` / `RemoveFeedbackMessage` |

## Capacités produit futures indépendantes du type Formative

| Capacité | État actuel | Cible v2 |
| --- | --- | --- |
| Détection paquet ChatGPT | intégré 0.4.1 | conserver |
| Erreur visible JSON invalide | intégré 0.4.1 | conserver |
| Progression ChatGPT | intégré 0.4.1 | conserver |
| Progression Formative bas-droite | intégré 0.4.1 | conserver |
| Statut importé/update | intégré 0.4.1 | conserver |
| Identité Chrome stable | intégré 0.4.0+ | conserver manifest.key |
| Fingerprint source déterministe | non | requis 0.5.0 |
| Concepts de correction | non formalisés v1 | requis v2 |
| Modes auto/assisted/manual | non formalisés v1 | requis v2 |
| Provenance des réponses | non | requis v2 |
| Variantes mécaniques côté extension | non | requis v2 |
| Dry-run | non | requis v2 |
| Journal/reprise item par item | partiel/non | requis v2 |
| Suppression proposée seulement | conceptuel | requis v2 |
| Cible Formative explicite | partiel | requis v2 |
| Rapport final détaillé | partiel | requis v2 |

## Priorités restantes

### Produit

1. figer `cardinal.formative/2`;
2. protocole autonome embarqué;
3. bouton `Préparer pour Formative`;
4. concepts + provenance + modes de correction;
5. fingerprints;
6. validateur;
7. dry-run/journal/reprise;
8. test dans un nouveau chat/autre compte.

### API/types secondaires

1. verrouiller update spécialisé Categorize si nécessaire;
2. Drag and Drop avancé;
3. Match Table Grid;
4. True/False;
5. Hot Text;
6. Multi-Part;
7. side-by-side exact seulement si besoin réel.

## Règle de preuve

Une capacité passe à PROVEN seulement avec une combinaison suffisante de:

- mutation native identifiée;
- variables utiles capturées;
- test contrôlé;
- aucune erreur GraphQL;
- champs critiques validés;
- état serveur relu ou visible;
- aucun champ critique deviné.

Une capacité passe à INTEGRATED seulement lorsqu'elle existe réellement dans la baseline actuelle et a au minimum passé ses tests de régression pertinents.
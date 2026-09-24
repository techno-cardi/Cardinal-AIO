# Correction Formative assistée par ChatGPT

## Objectif

Corriger des questions Formative avec l'aide de ChatGPT sans perdre le contexte de la question, sans publier sur la mauvaise question et sans remplacer la logique native de Formative pour les questions déjà autocorrigées.

## Rôle des systèmes

- **Formative**: source de vérité pour la correction question par question.
- **ChatGPT**: analyse pédagogique et proposition de notes/commentaires.
- **Cardinal**: extraction, liaison de contexte, validation locale, prévisualisation, publication et vérification serveur.
- **Gestion des notes**: reçoit normalement le résultat global/final de l'évaluation, pas un devoir par question.
- **Mozaïk**: reçoit ensuite le résultat global depuis Gestion des notes.

## Workflow stable

1. Kevin ouvre/sélectionne une question dans les résultats Formative.
2. Il lance `Préparer une correction` depuis l'extension Cardinal.
3. Cardinal extrait:
   - l'évaluation;
   - la question exacte;
   - le type de question;
   - le maximum de points;
   - le corrigé/référence détecté lorsqu'il existe;
   - les réponses des élèves;
   - les pointages actuels Formative comme référence seulement;
   - le protocole Cardinal d'évaluation.
4. Cardinal ouvre/copie le prompt pour ChatGPT.
5. ChatGPT corrige indépendamment des pointages actuels.
6. Kevin peut calibrer librement: barème, exemples, plus sévère, plus généreux, commentaires, exceptions pédagogiques, etc.
7. ChatGPT retourne le tableau complet importable.
8. Le bridge ChatGPT/Cardinal vérifie que le retour correspond encore à la bonne question/session.
9. Cardinal exécute ses contrôles locaux de cohérence.
10. Cardinal affiche une prévisualisation des changements.
11. Rien n'est écrit tant que Kevin n'a pas confirmé.
12. Cardinal publie notes et/ou commentaires.
13. Cardinal valide la réponse de mutation.
14. Cardinal relit le serveur et vérifie les points réellement enregistrés.
15. Seulement après cette relecture, Cardinal peut annoncer la réussite.

## Format de retour

### Une question

Tableau Markdown obligatoire:

| Élève | Note | Commentaire |
| --- | ---: | --- |

Règles:

- nom inchangé;
- note numérique;
- note dans `0..maximum`;
- commentaire facultatif;
- ne jamais inventer un élève absent du payload;
- ne jamais mettre automatiquement 0 à une réponse absente/incomplète simplement parce qu'elle n'est pas dans la liste à corriger.

### Lot multiquestions

Le format historique utilisé par Cardinal pour plusieurs questions est:

| Question | Élève | Note | Commentaire |
| --- | --- | ---: | --- |

La colonne Question utilise `Q` + numéro, par exemple `Q3`.

Après une révision, renvoyer le tableau complet de toutes les questions sélectionnées, pas seulement les lignes modifiées.

## Protocole Cardinal d'évaluation v1.1

1. Corriger indépendamment des scores actuels Formative.
2. Établir les critères à partir de la consigne, des références détectées et des sources réellement fournies.
3. Ne jamais inventer un fait, une citation ou un numéro de ligne/page.
4. Si une source indispensable manque, ne pas deviner une note définitive.
5. Évaluer le sens plutôt qu'une correspondance exacte de mots, sauf si la forme exacte est ce qui est évalué.
6. Les réponses identiques ou sémantiquement équivalentes doivent recevoir le même traitement.
7. Les réponses à plusieurs éléments sont évaluées élément par élément. Un même élément répété n'est compté qu'une fois.
8. Une ambiguïté raisonnable dans la consigne ne doit pas pénaliser l'élève.
9. Faire une deuxième passe silencieuse de cohérence.
10. Toute note doit être justifiable par la consigne et les preuves disponibles.
11. Une référence fournie par Kevin, comme un corrigé, une rubrique, une réponse attendue ou des exemples, devient la référence pédagogique principale. Si elle entre clairement en conflit avec la consigne ou une source vérifiable, signaler le conflit.

## Décodage des questions

Cardinal doit préférer la définition Formative réelle plutôt que des heuristiques DOM.

Champs utiles observés:

- `_id`
- `questionNumber`
- `subtype`
- `details.points`
- `details.isRubricEnabled`
- `details.choices`
- `details.choiceLabels`
- `details.correctAnswers`
- `details.blanks`
- `rubric`
- `text` riche DraftJS/Tiptap

### QCM

Règle confirmée:

`token de réponse stocké -> index dans details.choices -> libellé au même index dans details.choiceLabels`

### Fill in the blank

Préserver l'ordre exact des blancs dans la définition de question. Chaque champ retourné doit être évalué séparément.

### Texte riche

Pour DraftJS, extraire le vrai texte des blocs afin que ChatGPT reçoive la consigne complète et non un générique `Question N`.

## Contrôles locaux avant publication

Cardinal doit bloquer ou signaler notamment:

- réponses identiques/équivalentes avec des notes incohérentes;
- réponse objectivement correcte selon la référence mais non créditée comme prévu;
- note hors bornes;
- changement de question/session active;
- réponse élève modifiée depuis la préparation;
- élève ambigu ou non apparié;
- mismatch de contexte Q2/Q3 ou équivalent;
- question à rubrique structurée non supportée de façon prouvée.

## Mutation de notes

Operation:

`ResultsSelectedItemSidebarGradeAnswers`

Endpoint:

`POST https://svc.goformative.com/graphql/mutation/ResultsSelectedItemSidebarGradeAnswers`

Variables connues:

- `answerIds: [ID!]!`
- `points: Float!`
- `scoreFactor: Float`
- `rubricLevels: [AnswerRubricLevelInput!]!`

Retour attendu de `teacherGradeAnswers` incluant notamment:

- `_id`
- `points`
- `possiblePoints`
- `rubricLevels`
- `scoreFactor`
- timestamps

Les notes décimales fonctionnent.

### Validation de succès

Une mutation 200 n'est pas suffisante.

Cardinal doit vérifier:

1. tous les IDs demandés sont dans `teacherGradeAnswers`;
2. les points retournés sont ceux demandés;
3. une relecture indépendante du serveur confirme les mêmes points.

## Rubriques

Ne pas supposer que `rubricLevels: []` est sans danger lorsqu'une question utilise réellement une rubrique structurée.

Si `details.isRubricEnabled` ou une rubrique active est détectée, bloquer l'écriture automatique tant que le comportement exact des niveaux de rubrique n'a pas été capturé et validé.

## Feedback textuel

Operation d'ajout connue:

`AddFeedbackMessage`

Entrée connue:

```json
{
  "input": {
    "delayed": null,
    "answerId": "ANSWER_ID",
    "formativeItemId": "QUESTION_ID",
    "studentId": "STUDENT_ID",
    "text": "TIPTAP_JSON_AS_A_STRING"
  }
}
```

Le champ `text` contient un document Tiptap/ProseMirror sérialisé en chaîne JSON.

Suppression connue:

`RemoveFeedbackMessage`

Aucune mutation d'édition séparée n'est prouvée.

## Résultat global

Quand toutes les questions sont correctement notées dans Formative:

`Envoyer le résultat global dans Gestion des notes`

Doit créer ou mettre à jour **une seule évaluation** Gestion des notes pour l'ensemble du Formative avec:

- le vrai maximum total de l'évaluation;
- le résultat final de chaque élève.

Ne jamais créer automatiquement un devoir Gestion distinct pour chaque question Formative.

## UX à préserver

- aucune UI Cardinal permanente sur Formative en projection;
- actions enseignant déclenchées par l'extension;
- UI temporaire seulement après action volontaire;
- vocabulaire neutre comme `Correction assistée`, `Copier les réponses`, `Retour de correction`;
- Kevin ne doit pas manipuler des JSON, IDs, batch IDs ou codes techniques;
- notes et commentaires contrôlables séparément;
- prévisualisation obligatoire avant publication.
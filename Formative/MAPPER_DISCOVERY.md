# Mapper et cartographie technique Formative

## Références à distinguer

### Mapper UI

**Cardinal Formative Mapper v2.1 Safe AutoLab** reste la référence de cartographie **UI/bundles/actions**.

Version: `2.1.0`.

### Cartographie directe

Après le Mapper v2.1, l'exploration a continué avec **Cardinal Formative Direct Lab v3**, puis les labs de transport/import v4 à v18.1.

Donc v2.1 n'est plus « le dernier état de l'API ». Il reste le meilleur outil de cartographie UI sécurisée, tandis que `API_GRAPHQL_NOTES.md`, `CAPABILITY_MATRIX.md` et `DISCOVERY_TIMELINE.md` contiennent les preuves techniques ultérieures.

## Mapper v2.1: objectifs

Cartographier:

- interface;
- types de questions;
- réglages;
- mutations/opérations GraphQL;
- endpoints;
- liens actions -> requêtes;
- bundles JavaScript.

## Contextes d'URL

Le userscript couvre:

- `https://*.formative.com/*`
- `https://formative.com/*`
- `https://*.goformative.com/*`
- `https://goformative.com/*`

## Sécurité AutoLab

À utiliser uniquement dans un **Formative poubelle**.

Bouton exact:

`button[data-testid="new-formative-item-circle-button"]`

Repli strict historiquement observé:

`button[aria-label="Ajoute un nouvel objet"]`

Une fois le menu ouvert, seuls les éléments dont le `data-testid` commence par:

`add-formative-item-menu-`

sont considérés.

Si le vrai bouton ou menu n'est pas détecté, arrêt. Aucun clic générique `Ajouter`.

## 22 types répertoriés par le Mapper

1. Free Response
2. Multiple Choice
3. Multiple Selection
4. Short Answer
5. Drawing
6. True or False
7. Multi-Part
8. Audio Response
9. Categorize
10. Drag and Drop
11. File Response
12. Fill In The Blank
13. Graphing
14. Number Line
15. Hot Spot
16. Hot Text
17. Dropdown
18. Match Table Grid
19. Matching
20. Numeric
21. Resequence
22. Video Response

## Profil AutoLab v2.1

Cibles:

- Multiple Choice
- Multiple Selection
- Fill In The Blank
- True or False
- Dropdown
- Matching
- Resequence
- Short Answer
- Free Response
- Drag and Drop
- Hot Text
- Categorize
- Multi-Part

Numeric est volontairement exclu.

Le fait qu'un type soit ciblé par AutoLab ne signifie pas que son adaptateur complet est PROVEN. Voir `CAPABILITY_MATRIX.md`.

## Capacités documentaires embarquées

Le Mapper embarque une matrice indicative autoGrade/partialMatch/partialCredit.

Exemples:

- Free Response: autoGrade oui, partialMatch oui, partialCredit avancé;
- Multiple Choice: autoGrade oui;
- Multiple Selection: autoGrade oui, partialCredit automatique;
- Short Answer: autoGrade oui, partialMatch oui;
- Categorize / Drag and Drop / FITB / Hot Spot / Hot Text / Dropdown / Match Table Grid / Matching / Resequence: autocorrection documentée;
- Numeric: autocorrection/équivalences documentées mais hors profil;
- Drawing, Audio Response, File Response, Video Response: pas d'autocorrection dans cette matrice;
- Multi-Part: conteneur.

Cette matrice est documentaire, pas une preuve d'écriture.

## Réglages surveillés

Notamment:

- Partial Match;
- Partial Credit;
- Case Sensitive;
- Required;
- Rubric;
- Show Your Work;
- Display Word Count;
- Equivalencies;
- Subtract points;
- Answer key;
- Points;
- Extra Credit;
- Reuse Answer Choices;
- Multi-select;
- Choice Explanations;
- Hint;
- Standards;
- Shuffle/Randomize.

## Captures du Mapper

### Réseau

- fetch/XHR;
- méthode/URL/statut/durée;
- body parsé;
- opérations GraphQL;
- variables nettoyées;
- réponse JSON raisonnable;
- fingerprint/preview.

### Actions UI

- pointerdown/change/input pertinent;
- cible/sélecteur;
- contexte;
- état avant/après;
- requêtes associées dans une fenêtre temporelle.

### DOM

- types/réglages visibles;
- contrôles interactifs;
- changements d'attributs pertinents.

### Bundles

Recherche de termes techniques et noms potentiels d'opérations.

Familles vues:

- `formative-react-formative-items`;
- `formative-react-reporting`;
- `formative-react-gradecam`.

Un bundle n'est pas une API stable.

## Fonctionnement AutoLab

Pour chaque cible:

1. fermer les menus résiduels;
2. ouvrir le vrai menu;
3. trouver le vrai item;
4. cliquer;
5. attendre `FormativeTeacherAddFormativeItem`;
6. enregistrer subtype/variables;
7. exporter.

## Mode passif

Le scan sans création:

- scanne UI;
- ouvre le vrai menu seulement pour observation;
- scanne bundles;
- ne crée pas automatiquement les questions cibles.

## Export

Schéma:

`cardinal.formative.mapper/1`

Contient:

- version/page/résumé;
- matrice;
- types/réglages/opérations/endpoints;
- résultats AutoLab;
- bundles;
- action-operation links;
- actions/réseau/snapshots/mutations/diagnostics.

## Protection des données

Le Mapper masque/alias:

- Authorization/cookies/tokens/secrets;
- courriels;
- téléphones;
- identifiants/UUID pertinents;
- clés sensibles.

Les exports ne doivent pas contenir les secrets bruts.

# Direct Lab v3

Après AutoLab, Direct Lab v3 a supprimé le besoin du menu pour tester des subtypes.

Architecture:

- injection d'un bridge en contexte page;
- capture locale des en-têtes de session;
- `window.postMessage` entre UI userscript et bridge;
- `DIRECT_CREATE` vers `FormativeTeacherAddFormativeItem`;
- `requestId` pour corrélation;
- timeout;
- export sans token.

Messages principaux:

- `PING`
- `READY`
- `OBSERVED_CREATE`
- `DIRECT_CREATE`
- `DIRECT_CREATE_RESULT`

Candidats historiques testés:

- multipleChoice;
- multipleSelection;
- fillInTheBlank;
- trueFalse / trueOrFalse;
- inlineChoice;
- matching;
- resequence;
- shortAnswer;
- freeResponse (candidat historique, plus tard `longAnswer` devient la référence prouvée);
- dragAndDrop / dragDrop;
- hotText;
- categorize;
- multiPart / multipart;
- hotSpot.

Important: ces candidats étaient exploratoires. Ne pas réutiliser un alias refusé quand une version ultérieure a prouvé le subtype réel.

# Évolution après v3

La cartographie directe a ensuite progressé:

- v4-v12: transports et synchro;
- v13: création/update live directe stable;
- v14.1: import 4 types;
- v15-v16.8: upsert et types avancés;
- v17.0: Matching natif;
- v17.4: Keyword absolu;
- v18.0/v18.1: functionalizedText et passages partagés.

Voir `DISCOVERY_TIMELINE.md` pour l'histoire complète.

## Historique de fichiers de cartographie

- `cardinal-formative-diagnostic.txt`
- `cardinal-formative-diagnostic.js`
- `cardinal-formative-webpack-diagnostic.txt`
- `cardinal-formative-mapper-v1.txt`
- `cardinal-formative-mapper-v1.user.js`
- `cardinal-formative-mapper-v2-autolab.txt`
- `cardinal-formative-mapper-v2.1-safe-autolab.txt`
- `cardinal-formative-direct-lab-v3.txt`

Règle: utiliser v2.1 pour une nouvelle cartographie UI, mais consulter les preuves v13-v18 avant de tester un endpoint/subtype déjà connu.
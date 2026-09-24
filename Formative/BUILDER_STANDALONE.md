# Cardinal Formative Importer Standalone

Dernière mise à jour: 2026-09-20

## Statut actuel

Baseline actuelle: **Cardinal Formative Importer Standalone 0.4.1**

Artefact:

`Cardinal-Formative-Importer-STANDALONE-0.4.1.zip`

SHA-256 du ZIP:

`b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4`

Statut: **baseline autonome de référence pour l'import/création Formative**.

Elle ne remplace pas encore l'extension principale `Cardinal - Gestion des notes` dans `techno-cardi/Exercices-francais`.

Les anciens Builder Standalone 0.1.0/0.1.1 restent historiques et sont supersédés pour la reprise du développement.

## Ce qui a été validé réellement avec 0.4.1

Sur un vrai questionnaire Tchernobyl:

- paquet détecté dans ChatGPT;
- import multiquestions complet;
- création de sections/questions;
- correction Keyword sur Short Answer;
- correction Keyword sur Free Response / Long Answer;
- progression visible dans ChatGPT;
- progression visible dans Formative en bas à droite;
- mise à jour ciblée d'une question existante;
- récupération d'une question même après perte potentielle du mapping local;
- aucune duplication lors de l'update ciblé;
- réimport identique reconnu comme déjà à jour / UNCHANGED.

Cycle validé:

`CREATE -> UPDATE -> UNCHANGED`

## Contenu du ZIP 0.4.1

Le ZIP contient:

- `README.txt`
- `background.js`
- `chatgpt-bridge.js`
- `formative-engine.js`
- `formative-progress-ui.js`
- `formative-session-bridge.js`
- `formative-session-main.js`
- `manifest.json`
- `popup.html`
- `popup.js`
- `smoke-test-package.json`

Le snapshot source doit être conservé dans ce dépôt afin qu'une reprise soit possible sans dépendre d'un ancien lien de téléchargement.

## Architecture 0.4.1

### `chatgpt-bridge.js`

Responsabilités:

- détecter `CARDINAL_FORMATIVE_PACKAGE_V1`;
- scanner `pre` et `code` au lieu de dépendre d'un seul wrapper;
- extraire un JSON équilibré;
- afficher une erreur visible si le paquet est invalide;
- retrouver un conteneur de message assistant avec fallback;
- afficher la barre Cardinal près du tableau de preview;
- masquer le paquet technique lorsque pertinent;
- lancer import / update / réimport;
- afficher progression et statut;
- récupérer les contextes Chrome invalidés.

### `background.js`

Responsabilités:

- capturer/réutiliser la session Formative;
- conserver les headers actifs dans `chrome.storage.session`;
- bootstrap initial si aucune requête authentifiée n'a encore été observée;
- orchestrer le moteur;
- envoyer la progression vers ChatGPT et Formative;
- conserver statut d'import non secret;
- gérer le contexte Formative cible.

### `formative-session-main.js`

Hook MAIN-world dans Formative:

- observe `fetch`/XHR GraphQL natifs;
- extrait seulement les headers autorisés nécessaires;
- transmet localement au bridge extension;
- ne doit jamais exporter les valeurs ailleurs.

### `formative-session-bridge.js`

Pont page -> extension pour transmettre les headers capturés au service worker.

### `formative-progress-ui.js`

Overlay temporaire en bas à droite de Formative:

- titre Cardinal;
- pourcentage;
- étape/item;
- bleu en cours;
- vert succès;
- rouge erreur;
- auto-masquage après la fin.

### `formative-engine.js`

Responsabilités:

- validation paquet;
- permission edit;
- lecture layout;
- plan idempotent;
- création/update;
- adaptateurs type par type;
- mapping item logique -> Formative;
- récupération prudente d'item existant;
- vérification et résultats.

## Types branchés dans 0.4.1

Le set supporté contient:

- `shortAnswer`;
- `longAnswer`;
- `multipleChoice`;
- `multipleSelection`;
- `fillInTheBlank`;
- `inlineChoice`;
- `resequence`;
- `matching`;
- `categorize`.

Éléments de contenu:

- `functionalizedText`;
- passages parent/enfants via `parentId`.

Attention: présence dans le moteur != même niveau de preuve pour tous les types. Lire `CAPABILITY_MATRIX.md`.

## Free Response / Long Answer

0.4.1 peut écrire un answer key Keyword sur `longAnswer`.

Ordre:

1. texte/paramètres;
2. points maximum;
3. `correctAnswers`;
4. `answerChoicePoints`;
5. `isKeywordGrading=true`;
6. `isPartialCredit` selon paquet.

Usage pédagogique futur:

- `auto` pour réponses factuelles réellement automatisables;
- `assisted` pour réponses libres/multiparties;
- `manual` seulement si nécessaire.

Le protocole v1 ne encode pas encore proprement ces trois niveaux. Ils sont prévus pour v2.

## Détection ChatGPT 0.4.0+

Durcissements importants après les bugs 0.3.x:

- ne plus dépendre exclusivement de `[data-message-author-role="assistant"] pre`;
- scan global `pre, code`;
- exclusion des messages utilisateur;
- fallback `article` / ancêtres;
- JSON extrait par équilibre des accolades;
- erreur visible plutôt qu'échec silencieux;
- placement relatif au tableau précédant le paquet.

Règle future: conserver cette philosophie tolérante. Ne jamais réduire le bridge à un unique sélecteur CSS fragile.

## Idempotence 0.4.1

Ordre actuel de reconnaissance:

1. mapping local connu;
2. subtype + texte exact;
3. fallback de similarité forte et non ambiguë.

Le fallback de similarité a été ajouté pour reconnaître le cas:

`ancien prompt` -> `ancien prompt + phrase ajoutée`

Garde-fous:

- subtype identique;
- seuil fort;
- meilleur candidat nettement supérieur au deuxième;
- ambiguïté => ne pas choisir arbitrairement.

Objectif v2: fingerprints déterministes de sources pour réduire encore la dépendance aux heuristiques.

## Identité Chrome stable

0.4.0 a ajouté une propriété `manifest.key`.

0.4.1 conserve exactement la même clé.

Règle absolue:

> Toute future version dérivée de 0.4.1 doit conserver exactement cette clé.

Sinon Chrome peut attribuer une nouvelle ID d'extension, isoler le storage et perdre les mappings locaux.

Le snapshot `manifest.json` 0.4.1 dans ce dépôt est la source de vérité de cette clé.

## Sessions Formative

Headers actifs:

- capturés localement;
- stockés dans `chrome.storage.session`;
- réutilisés après sommeil du service worker;
- jamais dans GitHub/ChatGPT.

Après installation/reload d'extension, un bootstrap initial peut être requis pour observer une requête authentifiée Formative. Ce comportement doit rester exceptionnel, pas répété à chaque import.

## Contexte extension invalidé

Bugs rencontrés:

- `Extension context invalidated`;
- `Cannot read properties of undefined (reading 'sendMessage')`.

Cause: extension rechargée alors qu'un ancien content script reste dans l'onglet ChatGPT.

0.4.1:

- vérifie la disponibilité de `chrome.runtime.sendMessage`;
- normalise ces erreurs;
- recharge ChatGPT une fois;
- garde anti-boucle.

## Relation avec l'extension principale

Le standalone reste volontairement isolé pour protéger Gestion des notes/Mozaïk pendant le développement.

Fusion éventuelle seulement lorsque:

- protocole v2 figé;
- validateur prêt;
- workflow reproductible dans un nouveau chat/autre compte;
- régressions 0.4.1 couvertes;
- fusion possible sans réécrire les workflows stables existants.

## Prochaine version cible: 0.5.0

Ne pas repartir sur une suite de micro-patches UI.

0.5.0 doit surtout apporter le **protocole universel PDF -> Formative**:

- bouton `Préparer pour Formative`;
- protocole embarqué;
- `cardinal.formative/2`;
- concepts/termes;
- modes auto/assisted/manual;
- sourcePromptExact;
- provenance;
- fingerprints déterministes;
- validateur silencieux;
- preview légère + `Voir le corrigé`;
- dry-run;
- journal/reprise;
- verrou anti-double-clic;
- cible explicite;
- rapport final.

Lire `PROTOCOL_V2_PLAN.md` avant tout code 0.5.0.

## Tests de régression minimum avant nouvelle baseline

- syntaxe JS;
- paquet ChatGPT détecté;
- paquet invalide => erreur visible;
- barre correctement placée;
- session fraîche;
- session réutilisée;
- progression Formative;
- progression ChatGPT;
- Short Answer Keyword;
- Long Answer Keyword;
- création;
- update ciblé;
- réimport inchangé;
- aucun doublon;
- mapping perdu + récupération prudente;
- contexte extension invalidé;
- item non Cardinal préservé;
- conflit subtype bloqué;
- aucun secret persistant/exporté.

Voir `MAINTENANCE_PLAYBOOK.md`.
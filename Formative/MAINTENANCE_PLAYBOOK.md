# Playbook de maintenance Formative/Cardinal

Dernière mise à jour: 2026-09-20

## But

Ce document existe pour reprendre rapidement le projet si Formative change son code, si une mutation cesse de fonctionner, si le DOM de ChatGPT évolue ou si une nouvelle version de Cardinal doit être reconstruite.

Il doit permettre à un futur ChatGPT de diagnostiquer sans refaire toute l'exploration.

## Baseline actuelle à préserver

Baseline import/création: **Cardinal Formative Importer Standalone 0.4.1**.

Fonctions validées dans le cycle réel de test:

- détection de paquet dans ChatGPT;
- import d'un questionnaire réel multiquestions;
- progression visible dans ChatGPT;
- progression visible dans Formative en bas à droite;
- session Formative capturée/reprise;
- premier bootstrap géré;
- création directe sans menu `+`;
- mise à jour ciblée d'une question existante;
- réimport idempotent sans duplication;
- récupération prudente d'une question existante lorsque le mapping local est perdu;
- answer key Keyword sur Short Answer;
- answer key Keyword sur Free Response/Long Answer;
- points écrits avant pondérations;
- clé Chrome stable depuis 0.4.0/0.4.1.

Ne pas confondre cette baseline avec l'extension principale Gestion des notes dans `techno-cardi/Exercices-francais`.

## Avant toute modification

Lire dans cet ordre:

1. `Formative/README.md`
2. `Formative/SKILL.md`
3. `Formative/CURRENT_STATE.md`
4. `Formative/PROTOCOL_V2_PLAN.md` si le sujet touche PDF -> Formative
5. `Formative/CAPABILITY_MATRIX.md`
6. `Formative/API_GRAPHQL_NOTES.md`
7. `Formative/TROUBLESHOOTING_HISTORY.md`
8. `Formative/SECURITY_AND_INVARIANTS.md`
9. le snapshot source 0.4.1 si le code de l'importeur doit être repris
10. le dépôt vivant `techno-cardi/Exercices-francais` si une intégration dans Cardinal/Gestion des notes est concernée.

## Règle de preuve

Ne jamais supposer qu'une API est restée identique parce que Formative change rarement.

Une fonctionnalité est saine seulement si:

1. la requête part;
2. HTTP est acceptable;
3. aucune erreur GraphQL n'est présente;
4. l'ID/subtype retourné est celui attendu;
5. les champs critiques correspondent;
6. l'état final serveur est relu lorsque pertinent;
7. l'UI ne contredit pas l'état serveur lorsque le cache de l'éditeur compte.

## Symptôme -> zone à inspecter

### Aucun bouton Cardinal dans ChatGPT

Vérifier:

- content script chargé;
- `CARDINAL_FORMATIVE_PACKAGE_V1` présent dans `pre` ou `code`;
- bridge 0.4.x encore actif;
- DOM ChatGPT: rôle assistant, `article`, wrappers de code;
- popup `Analyser cette page ChatGPT`;
- erreur rouge de parsing;
- contexte d'extension invalidé après reload de l'extension.

Ne jamais revenir à un sélecteur DOM unique et fragile.

### `Extension context invalidated` ou `sendMessage undefined`

Cause connue: l'extension a été rechargée alors que l'onglet ChatGPT contient encore l'ancien content script.

0.4.1 normalise notamment:

- `Extension context invalidated`;
- `Cannot read properties of undefined (reading 'sendMessage')`.

Comportement attendu: reload ChatGPT unique, protection anti-boucle.

### Formative recharge à chaque import

Ce n'est pas le comportement normal.

Vérifier:

- `chrome.storage.session`;
- capture headers dans `formative-session-main.js`;
- bridge page -> extension;
- durée de vie du service worker;
- bootstrap initial seulement.

Un reload unique peut être nécessaire après installation/reload de l'extension pour capter une première session. Il ne doit pas devenir le mécanisme de synchro normal.

### Création fonctionne mais l'UI Formative ne se met pas à jour

Référence: v13 Direct Live Sync a prouvé l'apparition live avec un `x-tab-id` Cardinal distinct.

Vérifier:

- headers session;
- `x-tab-id`;
- réponse de mutation;
- changements éventuels du mécanisme realtime/cache de Formative.

Ne pas réintroduire navigation SPA, menus natifs ou reload systématique sans preuve qu'ils sont redevenus nécessaires.

### Question dupliquée au lieu d'être mise à jour

Vérifier dans cet ordre:

1. mapping local item logique -> item Formative;
2. Formative ID cible;
3. changement d'identité Chrome;
4. fingerprint source;
5. subtype;
6. texte normalisé;
7. similarité forte/non ambiguë;
8. plusieurs candidats possibles.

0.4.1 possède un fallback conservateur de similarité pour le cas « même question + phrase ajoutée ».

Plusieurs candidats = ne pas choisir au hasard.

### Pondérations incorrectes après update

Invariant:

1. `points` maximum final;
2. `correctAnswers` / `answerChoicePoints` ensuite;
3. ne plus modifier le maximum.

Le mode Keyword est `ABSOLUTE_PER_MATCH_NOT_ADDITIVE`.

### Matching cassé

Utiliser la mutation native `MatchingEditableDetailsContainerMutation` et préserver les IDs/keys existants.

Ne pas régénérer les choice keys lors d'un simple update.

### Functionalized Text / passage cassé

Référence prouvée:

- parent `functionalizedText`;
- texte via `TextEditableUpdate`;
- enfants créés avec `parentId` du parent.

Ne pas inventer un subtype `passageGroup` côté Formative: c'est une abstraction du contrat Cardinal.

### Free Response n'a plus son corrigé

0.4.1 configure `longAnswer` avec:

- `correctAnswers`;
- `answerChoicePoints`;
- `isKeywordGrading`;
- `isPartialCredit`;
- `isCaseSensitive`;
- points d'abord.

Si Formative change ce comportement, recapturer une édition native avant d'adapter.

## Comment recapturer Formative proprement

Si une mutation change:

1. utiliser un Formative poubelle contrôlé;
2. faire une seule modification manuelle dans l'UI native;
3. capturer la requête réseau correspondante;
4. consigner operation name + endpoint + variables utiles;
5. nettoyer Authorization/cookies/tokens/PII;
6. comparer avec `API_GRAPHQL_NOTES.md`;
7. reproduire avec un script chirurgical;
8. vérifier réponse + état serveur;
9. seulement ensuite modifier l'adaptateur de production;
10. documenter immédiatement la nouvelle preuve.

Ne pas utiliser l'introspection GraphQL comme raccourci. Elle a déjà été observée désactivée/non exploitable.

## Comment tester un correctif d'adaptateur

Toujours tester trois passages:

### Création

Item absent -> `CREATE`.

### Mise à jour

Modifier un seul champ -> `UPDATE` sur cet item uniquement.

### Idempotence

Relancer exactement le même paquet -> `UNCHANGED`, zéro duplication.

Ajouter aussi lorsque pertinent:

- item non Cardinal préexistant -> préservé;
- conflit subtype -> `BLOCKED`;
- deux candidats similaires -> `BLOCKED`;
- session fraîche vs session réutilisée;
- extension rechargée pendant que ChatGPT est ouvert;
- deux onglets Formative ouverts.

## Tests de régression minimum 0.4.x

Après toute modification du cœur:

1. `node --check` sur tous les JS;
2. détection paquet ChatGPT;
3. barre sous le tableau;
4. erreur visible si JSON invalide;
5. import d'une question Short Answer;
6. import d'une question Long Answer avec Keyword;
7. FITB avec plusieurs réponses;
8. progression dans Formative;
9. progression/status dans ChatGPT;
10. update ciblé;
11. réimport inchangé;
12. aucun doublon;
13. pas de reload Formative récurrent;
14. aucun secret dans storage local/log/export.

Avant promotion plus large, ajouter MC, MS, Inline Choice, Resequence, Matching et autres types réellement utilisés.

## Maintenance du DOM ChatGPT

Le bridge 0.4.0+ a été durci pour ne pas dépendre d'un seul sélecteur:

- scan `pre, code`;
- recherche de sentinelle;
- extraction JSON équilibrée;
- fallback message assistant -> `article` -> ancêtres;
- erreur de parsing visible;
- placement relatif au tableau qui précède réellement le paquet.

Si le DOM change encore, conserver cette philosophie: détection sémantique/tolérante, pas un CSS selector unique fragile.

## Identité Chrome

0.4.0 a ajouté `manifest.key`.

0.4.1 conserve exactement la même clé.

Règle absolue pour les futures versions dérivées:

- conserver la même valeur `manifest.key`;
- sinon Chrome attribue une nouvelle identité;
- nouvelle identité = storage différent, mappings perdus, risque de doublons.

Le snapshot 0.4.1 est la source autoritaire de cette clé.

## Stockage

### `chrome.storage.session`

Pour:

- session Formative;
- headers auth nécessaires;
- état éphémère;
- bootstrap/reload guards.

### `chrome.storage.local`

Pour données non secrètes seulement:

- mapping idempotent;
- hash/fingerprint;
- statut d'import;
- préférences/masquages UI non sensibles.

Jamais Authorization/cookies/tokens en local persistant.

## Quand Formative change son API

Ne pas modifier plusieurs adaptateurs à la fois.

Procédure:

1. identifier précisément l'opération cassée;
2. reproduire dans l'UI native;
3. capturer la nouvelle mutation;
4. comparer variables et fragments;
5. créer un lab/surgical fix minimal;
6. confirmer sur un Formative poubelle;
7. intégrer au moteur;
8. exécuter les tests CREATE/UPDATE/UNCHANGED;
9. mettre à jour:
   - `API_GRAPHQL_NOTES.md`;
   - `CAPABILITY_MATRIX.md`;
   - `CURRENT_STATE.md`;
   - `TROUBLESHOOTING_HISTORY.md` si le changement révèle un piège;
   - `DISCOVERY_TIMELINE.md` si la nouvelle preuve supersède l'ancienne;
   - snapshot source si une nouvelle baseline stable est déclarée.

## Quand le protocole pédagogique change

Ne pas modifier les mutations Formative si le problème est seulement pédagogique.

Exemples:

- mots-clés trop génériques;
- modes auto/assisted/manual;
- source manquante;
- points proposés;
- tableau de preview;
- concepts/termes.

Ces sujets appartiennent au protocole v2 / validateur, pas au transport GraphQL.

## Quand fusionner dans Cardinal Gestion des notes

Ne fusionner que lorsque:

- le standalone est stable;
- le protocole v2 est figé;
- le validateur passe les tests;
- un workflow PDF réel est reproductible dans un nouveau chat;
- la fusion n'oblige pas à réécrire les workflows stables de correction/Mozaïk.

Pendant la fusion, garder le moteur d'import modulaire pour pouvoir le tester indépendamment.

## Artefacts à conserver pour toute nouvelle baseline

À chaque baseline stable:

- source exacte de l'extension;
- manifest complet;
- version + clé stable;
- SHA-256 des fichiers;
- README de la version;
- smoke-test package;
- liste des capacités branchées;
- tests passés;
- limitations connues;
- date de validation;
- lien/chemin du snapshot GitHub.

## Règle de fin

Quand quelque chose casse, ne jamais repartir de zéro.

Identifier la couche exacte:

`ChatGPT bridge -> protocole/paquet -> validateur -> session -> plan/upsert -> adaptateur GraphQL -> vérification -> UI`

Réparer la couche fautive, conserver les autres et documenter la preuve.
# Chronologie de l'exploration Formative

Dernière mise à jour: 2026-09-20

Ce fichier explique pourquoi les artefacts existent et lequel a supersédé lequel. Un futur ChatGPT ne doit pas recommencer un ancien cul-de-sac simplement parce qu'il trouve un script historique.

## Phase 1 - Diagnostic et cartographie

Artefacts historiques:

- diagnostic initial;
- webpack diagnostic;
- Mapper v1;
- Mapper v2 AutoLab;
- Mapper v2.1 Safe AutoLab.

Acquis:

- types/questions/options;
- endpoints/opérations GraphQL;
- capture réseau/action/UI;
- AutoLab sécurisé;
- Numeric exclu.

Référence finale: Mapper v2.1 Safe AutoLab.

## Phase 2 - Direct Lab v3

Objectif: découvrir les subtypes sans ouvrir le menu Formative.

Acquis:

- bridge page-context;
- session en mémoire;
- window.postMessage;
- création directe;
- essais de subtypes;
- export nettoyé.

## Phase 3 - Importer Prototype 0.1

Premier package -> Formative.

Support historique:

- shortAnswer;
- multipleChoice;
- fillInTheBlank.

Échec important: `Failed to fetch` sur la voie de transport testée.

Conclusion: structure utile, transport obsolète.

## Phase 4 - v4 à v7: transport stable

Familles:

- native replay;
- piggyback;
- direct transport;
- direct API;
- live-sync probes.

Historique uniquement.

## Phase 5 - v8 à v12: synchronisation éditeur

Explorations Apollo / SPA / stable create / native live create.

But: faire apparaître proprement les créations dans la SPA sans bricolage destructif.

## Phase 6 - v13: Direct Live Sync réussi

Point de bascule majeur:

- permission edit;
- création directe;
- update texte;
- x-tab-id Cardinal distinct;
- apparition live;
- aucun menu;
- aucune navigation;
- aucun reload;
- route inchangée.

Anciennes voies replay/piggyback ne sont plus l'architecture cible.

## Phase 7 - v14/v14.1: premier import multi-types

v14.1 confirme 4/4:

- Short Answer;
- Multiple Choice;
- Multiple Selection;
- Fill In The Blank.

## Phase 8 - v15/v15.1: Upsert Core

Passage du modèle « Formative vierge » au modèle comparaison/create/update.

## Phase 9 - v16 à v16.5: Extended Upsert

Ajouts:

- Long Answer;
- Inline Choice;
- Resequence;
- Matching;
- Categorize;
- structures avancées.

## Phase 10 - v16.6/v16.7: capture native et Matching

Acquis:

- structure choix/cibles;
- preservation choice keys;
- MatchingEditableDetailsContainerMutation;
- formats lecture/écriture des labels.

## Phase 11 - v16.8: Smart Upsert

Acquis:

- plan avant écriture;
- CREATE / UPDATE / UNCHANGED;
- conflits bloquants;
- items non Cardinal préservés;
- zéro requête pour unchanged;
- types avancés;
- relecture finale;
- points avant answerChoicePoints.

## Phase 12 - v16.9/v17.0: Matching surgical fix

v17.0 confirme mutation Matching native avec IDs préservés.

## Phase 13 - v17.1/v17.2: calibration Short Answer

Prépare le modèle Keyword pondéré.

## Phase 14 - v17.3/v17.4: Keyword absolu

Preuve serveur finale:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

Exemple /4:

- galette 4;
- beurre 4;
- grand-mère 3;
- mère-grand 3;
- aller porter 2;
- apporter 2.

## Phase 15 - v18.0: functionalizedText

Capture native:

- subtype functionalizedText;
- TextEditableUpdate;
- enfants avec parentId.

## Phase 16 - v18.1: parent + 3 enfants

Preuve automatisée:

- parent functionalizedText;
- texte;
- 3 Short Answer;
- même parentId;
- succès complet.

Conclusion: Text block et passage parent/enfants PROVEN.

## Phase 17 - Builder Standalone 0.1.x

Artefacts:

- beta 0.8.2 PATCH;
- standalone 0.1.0;
- standalone 0.1.1.

Rôle: première intégration bridge ChatGPT + UI + moteur.

Limite: sous-ensemble des adaptateurs prouvés.

Statut actuel: historique, supersédé pour la reprise par le standalone 0.4.1.

## Phase 18 - Importer standalone 0.3.x: UX et intégration réelle

Date principale: 2026-09-20.

Cette série a transformé le prototype en workflow réellement utilisable avec ChatGPT.

### 0.3.1 et premières itérations

Objectifs:

- paquet caché;
- bouton sous le tableau;
- import direct;
- statut.

Problèmes découverts:

- menu/revue trop lourd;
- barre dupliquée;
- mauvais placement;
- X masquant trop largement;
- progression perdue par reconstruction DOM;
- session Formative oubliée quand le service worker dort;
- reload trop fréquent.

### 0.3.2-0.3.8

Corrections successives:

- status persistant;
- chrome.storage.session pour la session;
- progression par question;
- barre stable par signature;
- masquage par version de paquet;
- progression visible;
- session bootstrap unique;
- placement plus robuste;
- récupération du contexte extension invalidé.

Ces versions sont importantes pour l'historique des bugs, pas comme baseline.

### 0.3.9

Ajouts structurants:

- overlay de progression dans Formative en bas à droite;
- Keyword/answer key sur Free Response/Long Answer;
- progression ChatGPT conservée.

## Phase 19 - 0.4.0: durcissement du bridge et identité

Bugs observés avant 0.4.0:

- paquet visible mais aucun bouton;
- DOM ChatGPT trop variable;
- mapping local potentiellement perdu entre versions.

0.4.0 introduit:

- scan global `pre, code`;
- extraction JSON équilibrée;
- fallback conteneur message;
- erreurs de parsing visibles;
- placement relatif au tableau précédant réellement le paquet;
- récupération d'item existant par subtype + texte;
- `manifest.key` pour stabiliser l'identité Chrome.

Un import complet réel Tchernobyl fonctionne avec cette famille.

## Phase 20 - 0.4.1: baseline actuelle

Bug réel après reload d'extension:

`Cannot read properties of undefined (reading 'sendMessage')`

Il s'agit d'une variante de contexte Chrome invalide.

0.4.1 ajoute:

- vérification de disponibilité chrome.runtime.sendMessage;
- normalisation des variantes de contexte invalide;
- reload ChatGPT unique avec garde anti-boucle;
- fallback de similarité forte et non ambiguë pour retrouver une question existante dont le prompt a légèrement changé;
- même `manifest.key` que 0.4.0.

### Validation réelle 0.4.1

Cycle validé:

1. questionnaire réel déjà importé;
2. modification volontaire de Q16 Free Response;
3. Q16 retrouvée;
4. UPDATE ciblé;
5. aucune duplication;
6. réimport identique reconnu comme déjà à jour / UNCHANGED.

Baseline courante:

**Cardinal Formative Importer Standalone 0.4.1**

## Phase 21 - Protocole v2 / future 0.5.0

Décision produit après validation 0.4.1:

ne plus enchaîner des micro-patches API/UI. Standardiser maintenant un workflow universel indépendant de la mémoire ChatGPT.

Objectif:

`joindre PDF(s) -> Préparer pour Formative -> vérifier -> Importer`

Axes:

- protocole autonome embarqué;
- cardinal.formative/2;
- sourcePromptExact;
- fingerprints déterministes;
- concepts de correction;
- termes discriminants;
- modes auto/assisted/manual;
- provenance des réponses;
- variantes mécaniques côté Cardinal;
- validateur silencieux;
- preview compacte + Voir le corrigé;
- cible Formative explicite;
- dry-run;
- journal/reprise;
- verrou anti-concurrence;
- suppressions proposées seulement;
- rapport final.

Référence: `PROTOCOL_V2_PLAN.md`.

## Règle pour le futur

Quand une nouvelle version apparaît:

- ne pas supprimer l'histoire;
- ajouter la nouvelle preuve ici;
- mettre à jour CURRENT_STATE;
- ne jamais réactiver une ancienne approche si une preuve ultérieure l'a supersédée;
- préférer la preuve la plus récente/spécifique;
- distinguer lab, standalone et production;
- archiver la source exacte de toute nouvelle baseline stable;
- conserver la manifest.key 0.4.x si la nouvelle version dérive de cette baseline.
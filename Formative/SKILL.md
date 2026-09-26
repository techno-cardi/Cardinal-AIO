# SKILL - Continuer le projet Formative/Cardinal

Dernière mise à jour: 2026-09-20

## Mission

Ce fichier définit la méthode obligatoire pour tout futur ChatGPT qui reprend un sujet Formative avec Kevin Tremblay.

Objectif: continuer à partir des acquis réels, sans refaire la cartographie, sans réinventer l'API, sans dépendre de la mémoire d'un compte ChatGPT et sans casser les workflows stables.

## 1. Lire avant d'agir

Toujours lire, dans cet ordre:

1. `Formative/README.md`
2. `Formative/CURRENT_STATE.md`
3. `Formative/PROTOCOL_V2_PLAN.md` si la demande touche PDF -> Formative, réponses, points, mots-clés, preview ou future 0.5.0
4. `Formative/MAINTENANCE_PLAYBOOK.md` si la demande touche un bug, un changement de version, Formative ou ChatGPT
5. `Formative/CAPABILITY_MATRIX.md`
6. `Formative/API_GRAPHQL_NOTES.md`
7. le document spécialisé concerné
8. `Formative/DISCOVERY_TIMELINE.md` si une ancienne version/lab est mentionnée
9. les fichiers actuels du dépôt vivant `techno-cardi/Exercices-francais` si la demande touche l'extension principale, Gestion des notes ou Mozaïk.

Pour le dépôt vivant, lire en priorité:

- `CHATGPT_PROJECT_INSTRUCTIONS.md`
- `resultats/docs/CURRENT_STATE.md`
- `resultats/docs/FORMATIVE_PROTOCOL.md`

Ne jamais se fier seulement à un numéro de version mémorisé. Le Git courant est autoritaire pour la production.

## 2. Ne pas confondre les couches

### A. Correction assistée stable

Flux:

`Formative -> Cardinal -> ChatGPT -> tableau importable -> prévisualisation -> Formative -> résultat global -> Gestion -> Mozaïk`

### B. Import/création standalone actuel

Baseline actuelle:

**Cardinal Formative Importer Standalone 0.4.1**

Flux:

`source -> ChatGPT -> cardinal.formative/1 -> tableau visible -> Cardinal -> plan idempotent -> Formative`

Cycle validé sur un vrai questionnaire:

`CREATE -> UPDATE ciblé -> UNCHANGED`, sans duplication.

### C. Protocole cible v2 / 0.5.0

Objectif:

`joindre PDF(s) -> Préparer pour Formative -> vérifier -> Importer`

Le protocole doit être embarqué dans l'extension et fonctionner dans un nouveau chat/autre compte sans mémoire préalable.

## 3. Règles absolues de développement

- Préserver le comportement stable avant toute amélioration.
- 0.4.1 est le fallback de référence pendant le développement 0.5.0.
- Ne jamais inventer endpoint, mutation, subtype, champ ou structure GraphQL.
- Une capacité est `PROVEN` seulement après test réel et validation suffisante.
- Distinguer `PROVEN` de `INTEGRATED`.
- HTTP 200 seul ne suffit jamais.
- Relire l'état serveur ou l'état final lorsque pertinent.
- Écritures séquentielles lorsque l'ordre compte.
- Préférer les définitions/mutations Formative aux heuristiques DOM.
- Ne jamais réintroduire un MutationObserver qui réécrit le DOM qu'il observe.
- Ne jamais utiliser un bouton générique `Ajouter`.
- Le menu `+` n'est pas le moteur normal d'import.
- Ne pas recharger Formative uniquement pour rendre visible une création directe.
- Un bootstrap initial de session peut être nécessaire après installation/reload de l'extension, mais pas à chaque import.
- Conserver CREATE / UPDATE / UNCHANGED / BLOCKED.
- Préserver tout item non revendiqué par le paquet.
- Un subtype incompatible ou plusieurs candidats = BLOCKED, pas de devinette.
- Ne jamais dépendre de l'introspection GraphQL.
- Conserver exactement la même `manifest.key` dans les futures versions dérivées de 0.4.1.
- Avant modification du cœur, lire le snapshot source courant et `MAINTENANCE_PLAYBOOK.md`.

## 4. Invariants techniques prouvés

### Session et transport

- permission `edit` obligatoire;
- Authorization/session restent locales;
- `chrome.storage.session` pour la session active;
- `x-tab-id` Cardinal distinct a été prouvé fonctionnel;
- ne jamais exporter Authorization/cookies/tokens;
- contexte extension invalidé après reload doit être récupéré proprement.

### Texte

- question: `QuestionEditableUpdateFormativeItem`;
- bloc texte: subtype `functionalizedText`;
- texte bloc: `TextEditableUpdate`.

### Passage partagé

Structure prouvée:

1. parent `functionalizedText`;
2. texte du passage sur le parent;
3. questions enfants créées avec `parentId` du parent.

### Matching

Utiliser `MatchingEditableDetailsContainerMutation`.

Préserver les choice keys existantes sur update.

### Pondérations / Keyword Grading

`answerChoicePoints` = **notes absolues**, mode:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

Ordre obligatoire:

1. fixer le maximum final `points`;
2. écrire les `answerChoicePoints` finaux;
3. ne plus changer le maximum.

Preuve réelle du 2026-09-25: lors de l'écriture Keyword, Formative aligne aussi `details.points` sur le plus grand `answerChoicePoints`. Donc `max(answerChoicePoints)` doit correspondre au maximum de la question. Pour `auto` comme pour `assisted`, si tous les concepts sont partiels, Cardinal utilise la réponse attendue complète déjà fournie comme ancre technique de pleine note, sans gonfler le score d'un mot isolé.

Ne jamais sommer les matches côté Cardinal.

### Free Response / Long Answer

Baseline 0.4.1 branche un vrai answer key Keyword sur `longAnswer` via l'update générique:

- `correctAnswers`;
- `answerChoicePoints`;
- `isKeywordGrading`;
- `isPartialCredit`;
- `isCaseSensitive`.

Ne pas confondre disponibilité du corrigé et fiabilité d'une auto-correction complète pour une question complexe.

## 4.1 Séparation des responsabilités

ChatGPT porte le jugement pédagogique final du paquet: type, mode de correction, réponse attendue, concepts, termes, pondérations et issues pédagogiques.

Cardinal ne refait pas ce jugement. Il peut signaler des risques par warning, mais ses blockers sont réservés à la structure, la représentabilité technique, les contradictions explicites du paquet, l'identité/cible, l'état serveur et la sécurité des mutations. Toute issue `blocker` explicitement produite par ChatGPT doit être propagée jusqu'au preflight et à l'UI.

## 5. Règles absolues de création pédagogique

### Source et fidélité

- Le texte source sert à construire le corrigé mais n'est pas importé dans Formative par défaut.
- Source mode par défaut: `external-reference-only`.
- Les sections/instructions peuvent devenir des blocs texte.
- Ne jamais injecter un texte de lecture complet simplement parce qu'il est joint au questionnaire.
- Conserver séparément formulation source exacte et prompt Formative.
- Retirer la numérotation source du prompt Formative puisque Formative numérote déjà.
- Conserver le numéro source dans les métadonnées/future identité.
- Ne jamais réécrire silencieusement une question sur le fond.
- Si une formulation semble erronée par rapport au texte, afficher un avertissement.

### Priorité des sources de correction

`corrigé fourni > texte source fourni > information intrinsèque à la question > inférence prudente > aucune réponse`

Une source indispensable absente => `SOURCE_REQUIRED`, pas de réponse inventée.

### Concepts avant mots

Avant de générer les mots-clés, identifier les concepts attendus.

Un terme reçoit un score parce qu'il représente un concept attendu, pas simplement parce qu'il apparaît dans le texte.

### Mots-clés

Priorité:

1. mots uniques discriminants;
2. synonymes réellement équivalents;
3. flexions utiles;
4. fautes fréquentes peu ambiguës;
5. expressions courtes si un mot seul est trop vague.

Éviter seuls:

- `aller`;
- `voir`;
- `faire`;
- `important`;
- `problème`;
- autres termes qui peuvent apparaître dans une mauvaise réponse.

À terme, accents/apostrophes/casse doivent être normalisés côté Cardinal lorsque possible afin que ChatGPT se concentre sur les variantes sémantiques.

### Questions multiparties

Détecter:

- nomme deux/trois;
- pour chacune;
- argument + justification;
- cause + conséquence;
- compare A/B;
- repère deux éléments et explique chacun.

Un moteur `max(keyword)` ne prouve pas que toutes les composantes sont présentes. Ces questions sont généralement correction `assisted`.

### Négation et contradiction

Un bon mot dans une phrase fausse ne doit pas être traité comme une preuve de réponse complète.

Exemple: « il n'y a pas eu d'explosion » contient `explosion`.

Cela justifie `assisted` plutôt que `auto` dans plusieurs cas.

## 6. Trois modes cibles de correction

### `auto`

Question factuelle/structurée où les réponses proposées peuvent raisonnablement produire la note automatique.

### `assisted`

Réponse libre, explication, interprétation, jugement ou multipartie. Fournir quand même un corrigé riche et des mots discriminants, mais considérer la note comme pré-correction pouvant nécessiter validation enseignante.

### `manual`

Opinion réellement ouverte, source/média absent ou tâche impossible à automatiser correctement.

Ne jamais choisir `manual` par paresse si une correction assistée utile est possible.

## 7. Points

- Conserver exactement les points fournis dans la source.
- Maximum une décimale.
- Vérifier le total annoncé.
- Si les points sont absents, les points proposés par ChatGPT doivent être marqués comme proposés.
- Aucun score de mot-clé > maximum.
- Total incohérent => bloquer ou demander confirmation explicite.

## 8. Preview / UX cible

Le tableau doit rester léger:

`# | Question | Type | Pts | Correction`

La cellule Correction peut afficher:

- `Auto · 3 concepts · 18 termes`;
- `Assistée · 4 concepts · 22 termes`;
- `⚠ Source manquante`.

Actions principales:

- `Voir le corrigé`;
- `Importer dans Formative`;
- `×`.

Ne pas exiger une case « je valide les mots-clés » à chaque import. Le corrigé doit être visible/vérifiable sans friction répétitive.

États utilisateur seulement:

- `✓ Prêt`;
- `⚠ À vérifier`;
- `✕ Bloqué`.

## 9. Responsabilités de ChatGPT pour `cardinal.formative/1`

Tant que v2 n'est pas en production, ChatGPT doit:

- lire toutes les sources fournies;
- distinguer texte/questionnaire/corrigé;
- détecter consignes, questions, sections, blocs texte et passages;
- préserver ordre et points;
- retirer les numéros des prompts Formative;
- choisir un type supporté;
- proposer corrigés et mots discriminants;
- mettre des réponses même aux Free Response quand une correction assistée utile existe;
- signaler ambiguïtés/source manquante;
- produire le paquet v1 détectable par 0.4.1.

ChatGPT ne doit pas écrire directement dans Formative. Cardinal prend en charge l'écriture locale authentifiée.

## 10. Futur `cardinal.formative/2`

Le schéma cible doit inclure notamment:

- `protocolVersion`;
- `sourcePromptExact`;
- source file/page/number;
- concepts attendus;
- termes par concept;
- expectedAnswer lisible;
- provenance de la correction;
- mode `auto` / `assisted` / `manual`;
- points fournis vs proposés;
- références multi-sources;
- flags source/média manquant.

Les fingerprints définitifs doivent être calculés par Cardinal, pas inventés par le modèle.

Lire `PROTOCOL_V2_PLAN.md` avant de coder v2.

## 11. Validateur futur obligatoire

Cardinal doit refuser ou avertir sur:

- schema/version inconnus;
- subtype non supporté;
- IDs/fingerprints en conflit;
- total incohérent;
- score > maximum;
- blank sans réponse;
- correction absente quand requise;
- source manquante pour une question prétendument auto;
- mot trop générique;
- numérotation répétée dans prompt;
- texte source accidentellement embarqué;
- plusieurs candidats Formative ambigus;
- plusieurs onglets/cible ambiguë;
- conflit subtype;
- suppression implicite.

## 12. Idempotence et reprise

Matching actuel:

1. mapping local;
2. subtype + texte exact;
3. similarité forte et non ambiguë en fallback 0.4.1.

Futur v2:

1. mapping local;
2. fingerprint source déterministe;
3. source page/number;
4. texte exact;
5. similarité prudente;
6. sinon BLOCKED.

Un import interrompu doit être journalisé item par item et repris sans recréer ce qui a déjà réussi.

Double clic => verrou par assessment + Formative cible.

Suppression => proposée, jamais automatique.

## 13. Capacités actuelles à connaître sans redemander

### Branchées dans le moteur 0.4.1

- shortAnswer;
- longAnswer;
- multipleChoice;
- multipleSelection;
- fillInTheBlank;
- inlineChoice;
- resequence;
- matching;
- categorize;
- functionalizedText;
- passage parent/enfants.

### PROVEN techniquement mais prudence selon adaptateur

Voir `CAPABILITY_MATRIX.md` pour le détail exact.

### OUT OF PROFILE

Numeric reste volontairement exclu.

## 14. Sécurité

Ne jamais demander ni committer:

- Authorization Formative;
- cookies;
- tokens de session;
- bearer Mozaïk;
- service-role Supabase;
- mots de passe;
- HAR avec credentials actifs.

Sessions Formative locales uniquement.

Les paquets ChatGPT décrivent l'évaluation, jamais la session authentifiée.

## 15. Comment traiter une nouvelle découverte

Après une preuve nouvelle:

1. noter opération + endpoint;
2. noter variables/champs critiques;
3. noter la validation effectuée;
4. mettre à jour `REFERENCE_ARTIFACTS.md`;
5. mettre à jour `API_GRAPHQL_NOTES.md` si API concernée;
6. mettre à jour `CAPABILITY_MATRIX.md`;
7. mettre à jour `CURRENT_STATE.md`;
8. ajouter à `DISCOVERY_TIMELINE.md` si l'histoire du moteur change;
9. ajouter au `TROUBLESHOOTING_HISTORY.md` si un piège nouveau a été découvert;
10. si une nouvelle baseline est déclarée, archiver son source exact + SHA-256;
11. conserver l'ancien comportement stable jusqu'au test end-to-end.

## 16. Ce qu'il ne faut pas redemander à Kevin

Ne pas lui redemander:

- rôle Formative vs Gestion des notes;
- besoin d'une UI simple;
- besoin de progression dans Formative;
- règle Keyword absolue;
- ordre points puis answerChoicePoints;
- comment créer un bloc texte;
- comment créer un passage parent/enfants;
- mutation native Matching;
- pourquoi Numeric est exclu;
- pourquoi le texte source n'est pas importé par défaut;
- pourquoi les numéros de questions ne doivent pas être dans les prompts Formative;
- besoin de nombreux mots discriminants, y compris pour les réponses libres;
- besoin de portabilité autre conversation/autre compte;
- besoin de preview visible avant import;
- besoin d'idempotence sans doublon;
- besoin d'un workflow final `PDF -> préparer -> vérifier -> importer`.

Lire la documentation et poursuivre à partir de l'état réel.
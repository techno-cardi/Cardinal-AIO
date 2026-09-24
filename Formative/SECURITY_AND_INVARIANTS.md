# Sécurité et invariants Formative/Cardinal

Dernière mise à jour: 2026-09-20

## Objectif

Conserver une intégration puissante sans exposer les sessions Formative, les données élèves ou les secrets du projet, tout en garantissant l'intégrité des imports.

## Secrets à ne jamais demander, afficher, copier dans ChatGPT ou committer

- Authorization Formative
- cookies Formative
- tokens de session
- bearer Mozaïk
- cookies Mozaïk
- service-role Supabase
- mots de passe
- numéros de fiche
- clés privées
- HAR contenant des credentials actifs

Même dans un dépôt privé, un secret actif n'a pas sa place dans Git.

## Session Formative

Baseline 0.4.1:

- headers capturés localement;
- conservation dans `chrome.storage.session`;
- session réutilisée après sommeil du service worker;
- hooks `fetch`/XHR natifs dans Formative;
- aucun envoi de credentials vers ChatGPT/GitHub/Supabase.

Un bootstrap initial peut être requis après installation/reload d'extension afin d'observer une première requête native authentifiée. Il ne doit pas devenir un reload à chaque import.

## En-têtes observés

Noms observés:

- accept
- authorization
- content-type
- x-anonymous-id
- x-app-version
- x-ntp-t0 parfois
- x-session-id
- x-tab-id
- x-user-id

Ne jamais documenter/exporter les valeurs réelles.

## x-tab-id

v13 a prouvé qu'un x-tab-id Cardinal distinct pouvait créer/update avec synchro live.

Si Formative change son backend/realtime, retester avant de considérer ce comportement éternel.

## Identité Chrome

0.4.0 a introduit `manifest.key`.

0.4.1 conserve exactement la même clé.

Invariant:

- futures versions dérivées de 0.4.1 doivent conserver cette valeur;
- sinon Chrome peut attribuer une nouvelle ID;
- nouvelle ID => autre storage => mappings perdus => risque de duplication.

Le snapshot `manifest.json` 0.4.1 est la référence.

## Stockage

### `chrome.storage.session`

Autorisé pour:

- session Formative;
- headers actifs;
- état éphémère;
- guards bootstrap/reload;
- paquet temporaire si nécessaire.

### `chrome.storage.local`

Uniquement données non secrètes:

- mapping item logique -> item Formative;
- hash/fingerprint;
- statut d'import;
- préférences UI;
- masquages de barres.

Jamais Authorization/cookies/tokens en local persistant.

## Hash/fingerprint

Hash utile mais non autoritaire.

Règle:

- hash/map locale = indice;
- état Formative réel = autorité;
- source fingerprint futur v2 = identité reproductible;
- si mapping et serveur divergent, relire/réconcilier.

## Données dans les paquets ChatGPT

Un paquet ne doit jamais contenir:

- Authorization;
- cookies;
- session ID secret;
- identifiants élèves inutiles;
- secrets Mozaïk/Supabase;
- données personnelles non nécessaires à l'évaluation.

Il décrit l'état pédagogique désiré, pas la session qui l'écrira.

## Sources PDF / confidentialité

Lors de l'analyse de documents scolaires:

- minimiser les données personnelles;
- ne pas recopier dans le paquet des métadonnées inutiles;
- ne pas transformer un nom d'élève apparaissant par hasard dans une source en donnée d'import;
- préférer des fingerprints de fichier calculés localement plutôt que des noms sensibles lorsque possible.

## UI projetée en classe

La page Formative normale doit rester propre.

0.4.x ajoute un overlay de progression temporaire en bas à droite. Il doit:

- apparaître seulement pendant une action d'import;
- disparaître automatiquement;
- ne montrer aucun secret/ID technique sensible;
- ne pas devenir un panneau permanent.

## Publication de notes

Invariants historiques conservés:

- prévisualisation obligatoire;
- confirmation obligatoire;
- note dans 0..maximum;
- pas de zéro automatique pour absence hors contrat explicite;
- étudiants absents du retour laissés intacts;
- question/session vérifiée;
- réponse inchangée depuis préparation;
- IDs exacts localement;
- rubriques détectées/protégées;
- pas de succès avant relecture serveur.

## Import/création

Invariants actuels:

- permission edit obligatoire;
- aucune mutation inventée;
- écritures séquentielles lorsque l'ordre compte;
- CREATE / UPDATE / UNCHANGED / BLOCKED;
- préserver items non revendiqués;
- conflit/ambiguïté = BLOCKED;
- aucun reload comme mécanisme normal de synchro;
- aucun pilotage normal du menu `+`;
- aucune recréation d'un item identique;
- points avant answerChoicePoints;
- ne pas additionner les matches Keyword;
- préserver choice keys Matching;
- vérifier l'état final;
- suppression jamais automatique;
- plusieurs candidats similaires = ne pas choisir arbitrairement.

## Idempotence et perte du mapping

0.4.1 utilise:

1. mapping local si disponible;
2. subtype + texte exact;
3. similarité forte/non ambiguë en fallback.

Le fallback est un mécanisme de sécurité, pas une permission de fuzzy-match agressif.

Futur v2 doit privilégier des fingerprints déterministes issus des sources.

## Contexte extension invalidé

Cas réels:

- `Extension context invalidated`;
- `Cannot read properties of undefined (reading 'sendMessage')`.

0.4.1 normalise et récupère ce cas par reload ChatGPT unique avec garde anti-boucle.

Ne pas laisser une barre ancienne effectuer des writes avec un contexte partiellement mort.

## Keyword Grading et intégrité pédagogique

Mode:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

Risques:

- mot générique;
- bonne expression dans une phrase négative;
- réponse multipartie incomplète;
- un seul match trop généreux.

Futur v2 doit classer les questions:

- auto;
- assisted;
- manual.

Un answer key riche peut être fourni aux réponses libres sans prétendre que la note est automatiquement parfaite.

## Source manquante

Si une question dépend d'un texte/média absent:

- ne pas inventer le corrigé;
- marquer source requise;
- ne pas déclarer la question auto-corrigeable.

## Médias

Une question dépendant d'une image/figure/graphique/tableau absent peut être pédagogiquement cassée même si l'import technique réussit.

Futur validateur doit détecter ces références et avertir/bloquer.

## Points

- conserver points source;
- une décimale max;
- aucun score Keyword > maximum;
- vérifier total annoncé;
- points proposés clairement marqués si absents du document;
- incohérence de total ne doit pas passer silencieusement.

## Passages partagés

Parent functionalizedText + enfants parentId.

Avant suppression/migration, préserver la relation et éviter enfants orphelins.

## Rubriques

Ne jamais supposer que `rubricLevels: []` est neutre.

Bloquer/éviter l'écriture automatique tant que le comportement exact n'est pas prouvé.

## Journaux et diagnostics

Avant commit/export:

1. vérifier Authorization/cookies/tokens;
2. vérifier PII élèves/enseignants;
3. supprimer IDs inutiles;
4. préférer export nettoyé;
5. conserver seulement les preuves nécessaires;
6. ne jamais committer un HAR actif simplement parce que le dépôt est privé.

## Future journalisation 0.5.0

Le journal d'import item par item doit être non secret.

Peut contenir:

- assessment fingerprint;
- formativeId si nécessaire localement;
- item fingerprint;
- action CREATE/UPDATE/UNCHANGED/BLOCKED;
- timestamp;
- vérification réussite/erreur.

Ne doit pas contenir headers/cookies/tokens.

## Double import / concurrence

Futur 0.5.0:

- verrou par assessment fingerprint + Formative cible;
- deuxième clic => « import déjà en cours »;
- pas deux plans en écriture simultanée sur le même questionnaire.

## Cible Formative

Si plusieurs Formative sont ouverts:

- afficher la cible;
- ne pas choisir silencieusement une cible ambiguë;
- avertir si le titre/état est fortement incompatible avec le paquet.

## Règle de fin

La puissance vient de la session locale et des mutations natives.

GitHub conserve le savoir, les sources et les preuves.

Il ne conserve jamais les credentials.
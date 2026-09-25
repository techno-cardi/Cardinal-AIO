# Cardinal Formative v2 - spécification du validateur

Dernière mise à jour: 2026-09-20
Statut: normative pour le développement 0.5.x

## Objectif

Le JSON Schema valide la forme. Le validateur Cardinal valide le sens technique et les garde-fous pédagogiques avant toute écriture Formative.

L'interface normale doit rester légère. La majorité des contrôles sont silencieux lorsqu'ils passent.

États utilisateur seulement:

- `✓ Prêt`;
- `⚠ À vérifier`;
- `✕ Bloqué`.

## Pipeline de validation

Ordre obligatoire:

1. parse et version;
2. structure JSON Schema;
3. cohérence des sources;
4. fidélité source -> prompt;
5. points et total;
6. correction/concepts/termes;
7. structure propre au subtype;
8. capacités réellement intégrées;
9. identité et packageMode;
10. cible Formative/session/permission;
11. lecture serveur et diff;
12. plan CREATE / UPDATE / UNCHANGED / BLOCKED / DELETE_PROPOSED;
13. dry-run facultatif;
14. écriture séquentielle;
15. vérification après chaque mutation;
16. journal/reprise;
17. rapport final.

Aucune étape plus tardive ne doit masquer un échec plus tôt.

# 1. Version et structure

Bloquer si:

- `schema != cardinal.formative/2`;
- `protocolVersion != 2.0.0`;
- JSON invalide;
- champ obligatoire absent;
- subtype hors enum;
- propriété inconnue hors `extensions`.

Codes:

- `BLOCKED_SCHEMA`;
- `BLOCKED_PROTOCOL_VERSION`;
- `BLOCKED_STRUCTURE`.

Une version future inconnue n'est jamais acceptée silencieusement.

# 2. Sources

Vérifier:

- `sources[].id` uniques;
- toutes les `sourceRef/sourceRefs` pointent vers une source déclarée;
- une source `missing` n'est jamais traitée comme fournie;
- le corrigé fourni a priorité sur une inférence ChatGPT;
- plusieurs versions de corrigé incompatibles créent un conflit visible;
- aucune donnée élève inutile n'est transportée.

Codes possibles:

- `DUPLICATE_SOURCE_ID`;
- `UNKNOWN_SOURCE_REF`;
- `SOURCE_REQUIRED`;
- `ANSWER_KEY_CONFLICT`;
- `PII_IN_PACKAGE`.

Règle source manquante:

Si ChatGPT déclare explicitement `grading.provenance.kind = sourceMissing`, le mode `auto` constitue une contradiction du contrat et Cardinal bloque avant mutation.

Une source référencée avec `status = missing` ne suffit pas, à elle seule, à autoriser Cardinal à reclasser pédagogiquement la question. Cardinal l'affiche comme avertissement. Si l'absence rend réellement la question inutilisable, ChatGPT doit l'exprimer par une `issue` `blocker`; cette issue est alors contraignante pour l'import.

# 3. Fidélité source -> Formative

Comparer `source.promptExact` et `prompt`.

Transformations silencieuses admises:

- retrait du numéro source;
- normalisation typographique sans changement de sens.

Toute autre différence significative exige une entrée `transformations`.

`splitQuestion`, `mergeQuestion` et `changeResponseType` exigent `requiresReview=true`.

Codes:

- `SOURCE_PROMPT_DRIFT`;
- `TRANSFORMATION_UNDECLARED`;
- `TRANSFORMATION_REVIEW_REQUIRED`.

Le validateur ne doit pas corriger automatiquement une incohérence pédagogique du document.

# 4. IDs, ordre et packageMode

Vérifier:

- IDs d'items uniques;
- `order` unique dans un package `full`;
- références `questionIds` valides;
- aucune collision source numéro/page ambiguë non résolue.

### `patch`

Règle absolue:

> l'absence d'un item n'implique rien sur les autres items.

Interdictions:

- pas de suppression proposée à partir des absents;
- pas de réordonnancement global implicite;
- pas de recalcul du total complet si le paquet ne prétend pas être complet.

### `full`

Les items existants non revendiqués peuvent devenir `DELETE_PROPOSED`, mais jamais être supprimés automatiquement.

Codes:

- `DUPLICATE_ITEM_ID`;
- `DUPLICATE_ORDER`;
- `INVALID_ITEM_REFERENCE`;
- `PATCH_DELETE_FORBIDDEN`;
- `DELETE_PROPOSED`.

# 5. Points

Vérifier pour chaque question:

- `value >= 0`;
- une décimale maximum;
- provenance connue;
- `graded:false` distingue un vrai non-noté;
- `bonus:true` est explicite;
- aucun score concept/option > maximum;
- aucune valeur NaN/Infinity;
- total calculé cohérent avec `declaredTotalPoints` lorsque celui-ci est `provided`.

Tolérance de comparaison du total: exacte à 0,1 près après normalisation décimale.

Codes:

- `INVALID_POINTS`;
- `PROPOSED_POINTS` (warning);
- `SCORE_GT_MAX`;
- `TOTAL_POINTS_MISMATCH`;
- `UNEXPECTED_ZERO_POINTS`.

Une incohérence de total `provided` bloque l'import tant qu'elle n'est pas résolue explicitement.

# 6. Choix du mode de correction

Le mode `auto` / `assisted` / `manual` appartient à la décision pédagogique produite par ChatGPT. Cardinal ne le recalcule pas et ne le remplace pas silencieusement.

Le validateur peut détecter des signaux de risque et les afficher comme avertissements, mais il ne refait pas le jugement pédagogique de la consigne. Il bloque seulement lorsqu'il existe une contradiction explicite du paquet ou lorsque le mode demandé ne peut pas être représenté fidèlement par le transport Formative.

Exemples de contradictions techniques bloquantes:

- `grading.provenance.kind = sourceMissing` combiné à `grading.mode = auto`;
- un terme réellement envoyé avec un score supérieur au maximum;
- le même terme normalisé réellement envoyé avec deux scores différents;
- un subtype natif dont le mode `manual` ne peut pas être représenté sans écrire une clé automatique.

## Signaux à avertir, sans changer le mode

La consigne peut notamment comporter:

- deux ou plusieurs éléments distincts;
- `pour chacun/chacune`;
- explication + justification;
- argument + exemple/preuve;
- cause + conséquence;
- comparaison de sources;
- relation logique entre concepts;
- opinion justifiée avec éléments source;
- réponse libre où un seul match ne prouve pas la complétude.

Code d'avertissement:

- `ASSISTED_REQUIRED`.

Cardinal conserve toutefois le mode déclaré dans le paquet. Si ChatGPT veut réellement empêcher l'import, il produit une `issue` de sévérité `blocker`, que Cardinal respecte comme partie du contrat.

## `manual` selon ChatGPT

`manual` reste la décision de ChatGPT lorsque la correction automatique/assistée n'est pas pédagogiquement appropriée. Cardinal vérifie seulement que ce mode est techniquement représentable pour le subtype demandé.

# 7. Concepts et mots-clés

Règle centrale:

> le score appartient à un concept attendu, pas au simple fait qu'un mot apparaît dans le texte.

Vérifier:

- concepts IDs uniques par question;
- `terms` non vides;
- termes normalisés non dupliqués;
- un même terme ne porte pas deux scores différents;
- `riskyTerms` jamais activés automatiquement;
- score de concept <= points maximum;
- provenance du concept cohérente avec celle du corrigé;
- `sourceMissing` ne produit pas de terme automatique actif.

Codes:

- `DUPLICATE_CONCEPT_ID`;
- `EMPTY_CONCEPT_TERMS`;
- `DUPLICATE_TERM`;
- `TERM_SCORE_CONFLICT`;
- `RISKY_TERM`;
- `CONCEPT_PROVENANCE_CONFLICT`.

## Mots trop génériques

Maintenir une heuristique/listes de termes fréquemment trop larges, par exemple:

- faire;
- voir;
- aller;
- chose;
- important;
- problème;
- texte;
- auteur;
- réacteur si la question exige un mécanisme beaucoup plus précis.

Un terme générique n'est pas automatiquement interdit, mais:

- en score élevé => warning fort ou blocage;
- s'il peut raisonnablement apparaître dans de nombreuses mauvaises réponses => `riskyTerm`.

Code:

- `GENERIC_TERM`.

## Variantes mécaniques Cardinal

Avant envoi à Formative:

1. conserver la forme fournie;
2. générer les variantes mécaniques sûres;
3. normaliser pour déduplication;
4. détecter les collisions inter-concepts;
5. ne jamais générer automatiquement une faute réelle non triviale;
6. journaliser le nombre final de termes envoyés.

Normalisations sûres initiales:

- accents;
- casse si non sensible;
- apostrophe droite/typographique;
- espace/trait d'union seulement dans une liste de cas contrôlés.

# 8. Risques Keyword impossibles à résoudre par simple matching

Le moteur historique est:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`.

Ne jamais sommer les matches côté Cardinal.

Cas à marquer `assisted` ou `manual`:

- négation: `il n'y a pas eu d'explosion`;
- contradiction contenant le bon terme;
- concepts corrects reliés de manière fausse;
- copie brute du texte lorsqu'une explication est exigée;
- plusieurs éléments obligatoires mais un seul terme trouvé.

Codes:

- `KEYWORD_NEGATION_RISK`;
- `KEYWORD_RELATION_RISK`;
- `MULTIPART_KEYWORD_LIMIT`.

## Probes obligatoires avant 0.5 stable

Mesurer réellement Formative pour:

- frontières de mots (`eau` dans `beaucoup`, `air` dans `faire`);
- ponctuation;
- accents;
- apostrophes;
- mots imbriqués (`xénon` vs `xénon-135`);
- plusieurs matches avec scores différents;
- casse lorsque `caseSensitive=false`.

Tant qu'un comportement n'est pas prouvé, ne pas le transformer en hypothèse silencieuse du validateur.

# 9. Structure par subtype

## Multiple Choice

- >= 2 options;
- IDs uniques;
- exactement une correcte;
- option correcte présente dans la liste.

Codes:

- `CHOICE_ID_DUPLICATE`;
- `MCQ_CORRECT_COUNT`.

## Multiple Selection

- >= 2 options;
- IDs uniques;
- >= 1 correcte;
- scores partiels seulement si adaptateur courant le supporte.

## Fill In The Blank

Extraire tous les placeholders `{{id}}` du prompt.

Exiger:

- même ensemble exact que `response.blanks[].id`;
- chaque blank >= 1 réponse;
- aucun ID dupliqué;
- aucun placeholder orphelin;
- aucune définition orpheline.

Code:

- `PLACEHOLDER_MISMATCH`.

## Inline Choice

Même règle placeholder/définition.

En plus:

- >= 2 options par dropdown;
- chaque réponse correcte existe dans les options.

## Resequence

- >= 2 éléments;
- ordre non vide;
- doublons identiques permis seulement si l'adaptateur sait les distinguer; sinon warning/blocker.

## Matching

- >= 2 paires;
- aucune paire vide;
- update d'un item existant préserve les choice keys réelles lues sur le serveur.

## Unsupported

Toujours `BLOCKED_UNSUPPORTED_SUBTYPE` sauf transformation explicitement revue vers un subtype intégré.

# 10. Dépendances média

Détecter dans la consigne et les métadonnées:

- image;
- figure;
- schéma;
- carte;
- graphique;
- tableau;
- document externe;
- audio/vidéo;
- équation/rich content indispensable.

Si Cardinal détecte seulement par heuristique qu'un média pourrait manquer, il émet un warning. Cardinal ne décide pas lui-même que la question devient pédagogiquement impossible.

Si ChatGPT a établi, à partir des sources, que le média manquant rend la question inutilisable ou change son sens, le paquet porte explicitement une issue `blocker` telle que `MEDIA_DEPENDENCY_MISSING`, et Cardinal respecte ce blocker.

Codes:

- `MEDIA_DEPENDENCY`;
- `MEDIA_DEPENDENCY_MISSING`;
- `RICH_CONTENT_UNSUPPORTED`.

# 11. Field ownership

Cardinal ne possède que les champs qu'il sait représenter et relire.

Par défaut, ne pas effacer ni remplacer silencieusement:

- rubric;
- media/image;
- hints;
- tags;
- réglages spécialisés inconnus;
- paramètres Formative ajoutés manuellement et non représentés dans le paquet.

Absence d'un champ du paquet != valeur vide.

Code:

- `UNMANAGED_FIELD_PRESERVED` (journal/info interne);
- `FIELD_OWNERSHIP_CONFLICT` si une mise à jour exige d'écraser un champ externe connu.

# 12. Identité et diff à trois états

Pour un item déjà importé, conserver autant que possible:

- `baseline`: dernier état Cardinal confirmé;
- `server`: état Formative actuel;
- `desired`: nouvel état v2.

Décision:

### Safe update

`server == baseline` et `desired != baseline`

=> UPDATE.

### Unchanged

`server == desired`

=> UNCHANGED.

### Modification externe seulement

`desired == baseline` et `server != baseline`

=> préserver le serveur; signaler qu'une modification manuelle existe.

### Conflit réel

`server != baseline`, `desired != baseline`, `server != desired`

=> BLOCKED sur les champs gérés affectés.

Code:

- `SERVER_EXTERNAL_CHANGE`;
- `SERVER_THREE_WAY_CONFLICT`.

Cette règle empêche Cardinal d'écraser une correction manuelle faite directement dans Formative depuis le dernier import.

# 13. Récupération sans mapping local

Ordre:

1. fingerprint;
2. source/page/numéro;
3. prompt exact;
4. forte similarité + subtype identique + candidat unique;
5. sinon blocker.

Jamais choisir entre deux candidats similaires.

Codes:

- `RECOVERED_EXISTING_ITEM`;
- `AMBIGUOUS_EXISTING_ITEM`.

# 14. Cible Formative

Avant mutation:

- au moins un Formative ouvert/accessible;
- permission `edit`;
- cible non ambiguë;
- titre affiché à l'utilisateur;
- si plusieurs onglets plausibles: sélection explicite;
- divergence forte titre paquet/cible => warning.

Codes:

- `NO_FORMATIVE_TARGET`;
- `AMBIGUOUS_FORMATIVE_TARGET`;
- `TARGET_TITLE_MISMATCH`;
- `PERMISSION_DENIED`.

# 15. Évaluation déjà utilisée par des élèves

Angle mort à protéger.

Si Cardinal peut déterminer qu'un Formative possède déjà des réponses/soumissions, toute modification de:

- points;
- correctAnswers;
- answerChoicePoints;
- subtype;
- structure de choix/blancs;

doit au minimum produire un avertissement fort avant écriture.

Si l'état des réponses n'est pas disponible avec une query prouvée, ne pas prétendre savoir qu'il n'y en a pas.

Code:

- `EXISTING_RESPONSES_GRADING_CHANGE`.

Statut initial: à brancher seulement sur une lecture serveur prouvée.

# 16. Dry-run

`Vérifier sans importer` exécute tout jusqu'au plan inclus, sans mutation.

Sortie compacte:

`14 créations · 7 mises à jour · 2 inchangées · 1 bloquée · 0 suppression automatique`

Le dry-run doit utiliser le même validateur et le même planner que le vrai import. Pas de logique parallèle simplifiée.

Les `issues` déclarées dans le paquet et dans chaque question font partie de l'entrée du validateur. Elles sont validées structurellement, dédupliquées et propagées jusqu'à l'UI. Une `issue` déclarée `blocker` ne peut jamais disparaître entre ChatGPT, le preflight et la barre d'import.

# 17. Verrou et concurrence

Clé de verrou:

`assessmentFingerprint + formativeId`

Pendant un import actif:

- second clic => `IMPORT_ALREADY_RUNNING`;
- aucun second plan concurrent;
- expiration/cleanup du lock après succès ou erreur terminale;
- reprise après crash via journal, pas via un nouveau plan aveugle.

# 18. Journal transactionnel

Après chaque item confirmé, enregistrer localement un événement non secret:

- package/protocol version;
- assessment fingerprint;
- formativeId;
- item logical ID/fingerprint;
- action;
- formativeItemId;
- desired hash;
- verified state hash;
- timestamp;
- statut.

Ne jamais journaliser Authorization/cookies/tokens.

Si Q15 échoue après Q1-Q14:

- Q1-Q14 = confirmed;
- Q15 = failed/uncertain;
- Q16+ = notStarted;
- prochain clic relit le serveur et reprend sans recréer les confirmées.

# 19. Mutation incertaine / timeout

Cas critique:

La requête peut avoir été exécutée côté serveur mais la réponse perdue côté client.

Interdiction:

- retry CREATE aveugle.

Procédure:

1. marquer `UNCERTAIN`;
2. relire le serveur;
3. rechercher l'item par fingerprint/mapping/texte;
4. si retrouvé conforme => confirmed;
5. si absent => retry contrôlé;
6. si ambigu => BLOCKED.

Code:

- `MUTATION_UNCERTAIN`.

# 20. Vérification post-écriture

HTTP 200 seul ne suffit jamais.

Après chaque mutation, vérifier les champs critiques du subtype.

Au minimum:

- ID;
- subtype;
- prompt/texte;
- points;
- required;
- grading/correctAnswers;
- answerChoicePoints;
- options/blanks/pairs/sequence;
- parentId lorsque pertinent.

Si la réponse immédiate est insuffisante, faire une relecture serveur.

Code:

- `POSTWRITE_MISMATCH`.

Une mismatch stoppe les écritures suivantes sauf si le planner peut prouver qu'elles sont indépendantes et qu'une politique explicite autorise de continuer. Pour 0.5.0 initial, préférer l'arrêt propre.

# 21. Gestion des erreurs réseau

Catégories:

- 401/403: session/permission;
- 429: rate limit;
- 5xx: serveur;
- timeout/offline;
- GraphQL errors avec HTTP 200;
- réponse structurale inattendue.

Règles:

- backoff raisonnable seulement pour opérations idempotentes ou après relecture;
- jamais boucle rapide;
- jamais retry CREATE incertain sans réconciliation;
- progression UI reste informative;
- état final honnête.

# 22. Rapport final

Rapport minimal:

- questions/items traités;
- CREATE;
- UPDATE;
- UNCHANGED;
- BLOCKED;
- DELETE_PROPOSED;
- termes de corrigé effectivement envoyés;
- erreurs;
- reprise disponible ou non;
- cible Formative;
- version importer/protocole.

UI normale peut afficher une seule phrase et un bouton `Voir le rapport`.

# 23. Politique de friction

Ne pas exiger une case de validation pour chaque banque de mots sûre.

Normal:

- validateur passe;
- tableau visible;
- bouton Importer actif.

Demander une action seulement pour:

- blocker;
- transformation pédagogique;
- points proposés/incohérents importants;
- source manquante;
- terme risqué à score significatif;
- conflit serveur;
- média manquant;
- cible ambiguë;
- modification potentiellement dangereuse sur évaluation déjà utilisée.

Objectif:

> maximum d'intelligence, minimum d'interface.

# 24. Codes minimums à implémenter en 0.5.x

Blockers/erreurs:

- `BLOCKED_SCHEMA`
- `BLOCKED_PROTOCOL_VERSION`
- `BLOCKED_STRUCTURE`
- `SOURCE_REQUIRED`
- `TOTAL_POINTS_MISMATCH`
- `SCORE_GT_MAX`
- `TERM_SCORE_CONFLICT`
- `PLACEHOLDER_MISMATCH`
- `BLOCKED_UNSUPPORTED_SUBTYPE`
- `AMBIGUOUS_EXISTING_ITEM`
- `SERVER_THREE_WAY_CONFLICT`
- `AMBIGUOUS_FORMATIVE_TARGET`
- `PERMISSION_DENIED`
- `IMPORT_ALREADY_RUNNING`
- `MUTATION_UNCERTAIN`
- `POSTWRITE_MISMATCH`

Warnings principaux:

- `PROPOSED_POINTS`
- `GENERIC_TERM`
- `RISKY_TERM`
- `ASSISTED_REQUIRED`
- `MEDIA_DEPENDENCY`
- `TARGET_TITLE_MISMATCH`
- `SERVER_EXTERNAL_CHANGE`
- `EXISTING_RESPONSES_GRADING_CHANGE`
- `DELETE_PROPOSED`

# 25. Critère de sortie 0.5.0

0.5.0 n'est pas stable tant que:

1. le JSON Schema est appliqué;
2. les règles sémantiques MUST de `PROTOCOL_V2_TEST_MATRIX.md` ont un test;
3. les probes critiques Keyword ont été réellement mesurés ou explicitement neutralisés par une politique sûre;
4. full vs patch est testé;
5. diff à trois états est testé;
6. reprise après mutation incertaine est testée;
7. aucun item non géré n'est effacé;
8. CREATE -> UPDATE -> UNCHANGED reste vert;
9. le même workflow réussit dans un chat vierge sans mémoire du projet;
10. la baseline 0.4.1 reste reconstructible comme fallback.
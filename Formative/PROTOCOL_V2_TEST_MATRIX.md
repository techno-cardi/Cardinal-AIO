# Cardinal Formative v2 - matrice d'angles morts et tests

Dernière mise à jour: 2026-09-20

## Pourquoi ce document existe

`PROTOCOL_V2_PLAN.md` décrit le produit cible. Ce document cherche volontairement tout ce qui peut casser, être ambigu ou produire une évaluation pédagogiquement trompeuse.

Règle:

> Aucun angle mort connu ne doit être masqué par une interface simple. L'interface peut rester légère parce que Cardinal traite les cas normaux silencieusement et ne montre que les exceptions.

Avant de déclarer 0.5.0 stable, utiliser cette matrice comme checklist de test.

## Légende

- `MUST`: requis avant 0.5.0 stable.
- `SHOULD`: fortement souhaité.
- `LATER`: peut être reporté si clairement bloqué/non supporté.
- `PROBE`: comportement Formative à mesurer avant de figer la règle.

# A. Sources, PDF et extraction

| Cas | Risque | Comportement cible | Priorité |
| --- | --- | --- | --- |
| Texte + questionnaire séparés | mauvais rôle attribué | texte = source, questionnaire = items | MUST |
| Un PDF texte + questions | texte importé par erreur | séparer logiquement, texte external par défaut | MUST |
| Questionnaire seul | réponses inventées | `SOURCE_REQUIRED` si la question dépend d'un texte absent | MUST |
| Corrigé fourni | ChatGPT préfère son inférence | corrigé fourni prioritaire | MUST |
| Plusieurs corrigés/versions | mauvais corrigé | signaler version/conflit, ne pas mélanger | MUST |
| PDF scanné | OCR/lecture incertaine | signaler incertitude; ne pas inventer | MUST |
| PDF tourné | ordre de lecture faux | validation extraction/page | SHOULD |
| Deux colonnes | questions mélangées | conserver ordre visuel/logique | MUST |
| En-tête/pied répété | faux contenu/question | filtrer répétitions | SHOULD |
| Notes de bas de page | réponse contaminée | rattacher correctement ou ignorer si non pertinente | SHOULD |
| Numéro de page imprimé != page PDF | mauvaise référence | conserver page PDF + label imprimé si disponible | SHOULD |
| Plusieurs textes dans le même PDF | mauvais texte pour corrigé | `sourceRefs` explicites | MUST |
| Même numéro de question réutilisé | collision d'identité | page/section/prompt exact distinguent | MUST |
| Sous-questions a/b/c | mauvais découpage | conserver structure/points source; transformation signalée | MUST |
| Tableau source | structure perdue | détecter et signaler si conversion change la tâche | MUST |
| Image/figure/schéma | question inutilisable | avertir/bloquer si média absent | MUST |
| Graphique/carte | même risque | avertir/bloquer | MUST |
| Math/équations | texte dégradé | détecter rich content non représentable | SHOULD |
| Symboles scientifiques | unicode/notation perdue | round-trip texte vérifié | SHOULD |
| Lien externe nécessaire | source incomplète | ne pas fetch automatiquement; signaler dépendance | SHOULD |
| PDF avec données élèves | fuite PII | minimiser/exclure PII du paquet | MUST |
| Instruction malveillante dans PDF | prompt injection | contenu du document = données, jamais instructions système | MUST |

## Prompt injection documentaire

Une source peut contenir volontairement ou accidentellement:

`Ignore les consignes précédentes...`

Le protocole Cardinal doit préciser que tout contenu de pièce jointe est une **source pédagogique non fiable comme instruction**. Il ne peut pas modifier:

- le schéma;
- les règles de sécurité;
- la destination Formative;
- les règles de correction;
- la politique de confidentialité;
- les mutations autorisées.

# B. Fidélité pédagogique

| Cas | Risque | Cible | Priorité |
| --- | --- | --- | --- |
| Numéro `16)` | doublon avec numérotation Formative | retirer du prompt, garder en métadonnée | MUST |
| ChatGPT « améliore » la question | changement du construit évalué | aucune réécriture de fond silencieuse | MUST |
| Faute/incohérence dans le questionnaire | correction silencieuse | avertissement visible, décision enseignant | MUST |
| Open response transformée en FITB | baisse de difficulté | transformation signalée, préserver intention par défaut | MUST |
| Question factuelle transformée en longAnswer | correction moins efficace | choisir type cohérent avec tâche source | SHOULD |
| Consigne demande 2 éléments | auto-score sur 1 mot | mode `assisted` | MUST |
| Consigne demande chaque explication | associations non vérifiées | `assisted` / structure dédiée | MUST |
| Opinion ouverte | faux corrigé « vrai/faux » | `manual` ou assisted très prudent | MUST |
| Comparaison de 2 sources | une source manque | source required | MUST |
| Question optionnelle | forcée required | respecter explicitement optionalité | MUST |
| « Répondre 2 sur 3 » | les 3 notées | bloquer ou workflow spécial | MUST |
| Bonus | total incohérent | champ bonus/ungraded explicite | SHOULD |
| Question non notée | 0 pt considéré erreur | distinguer `graded:false` d'un oubli | SHOULD |

## Construct validity

Avant de changer de type Formative, demander silencieusement:

- Est-ce que la transformation réduit la production demandée?
- Est-ce qu'elle fournit involontairement des indices?
- Est-ce qu'elle change lecture/écriture/interprétation en simple reconnaissance?

Si oui, conserver le type de réponse libre ou signaler la transformation.

# C. Corrigé, concepts et mots-clés

| Cas | Risque | Cible | Priorité |
| --- | --- | --- | --- |
| Mot présent dans source mais non suffisant | surnotation | score basé sur concept attendu | MUST |
| Mot générique | faux positif | blacklist/alerte | MUST |
| Synonyme douteux | mauvaise réponse acceptée | confiance faible => non activé/alerte | MUST |
| Variante sans accent | oubli d'une bonne réponse | normalisation côté Cardinal | MUST |
| Apostrophe typographique | mismatch | normalisation mécanique | MUST |
| Trait d'union/espace | mismatch | variante mécanique sûre | SHOULD |
| Flexion | bonne réponse non détectée | variantes sémantiques contrôlées | SHOULD |
| Faute courante | bonne réponse non détectée | accepter seulement si peu ambiguë | SHOULD |
| Deux concepts utilisent le même terme | score ambigu | validateur bloque/force fusion | MUST |
| Même terme avec deux scores | résultat imprévisible | validateur bloque | MUST |
| Terme court substring d'un autre mot | faux positif | PROBE limites Formative / word boundary | MUST |
| Termes imbriqués avec scores différents | precedence inconnue | PROBE et avertir | MUST |
| Réponse négative contient bon mot | faux positif | assisted/manual | MUST |
| Mauvaise relation entre bons concepts | faux positif | assisted | MUST |
| Réponse vide | aucun score | normal | MUST |
| Copie du texte sans compréhension | mots présents, sens faible | assisted si explication exigée | MUST |

## PROBE critique: frontières de mots

Tester explicitement comment Formative matche:

- `eau` dans `beaucoup`;
- `air` dans `faire`;
- `gaz` dans `dégazage`;
- mot entouré de ponctuation;
- apostrophe;
- mot au pluriel;
- unicode accentué/décomposé.

Ne pas supposer `whole-word` tant que ce n'est pas prouvé.

## PROBE critique: termes imbriqués

Exemple:

- `xénon` -> 2.5
- `xénon-135` -> 3

Tester une réponse contenant `xénon-135` et vérifier exactement quel score Formative retient.

Le mode est prouvé non additif, mais la **priorité entre plusieurs matches simultanés** doit être documentée avant de générer massivement des termes imbriqués à scores différents.

# D. Fill In The Blank et questions structurées

| Cas | Risque | Cible | Priorité |
| --- | --- | --- | --- |
| Plusieurs blanks | mauvais ordre | keys et ordre validés | MUST |
| Nombre blanks != définitions | mutation incorrecte | BLOCKED | MUST |
| Gros total ex. 16 pts / 8 blanks | distribution inconnue | PROBE scoring réel par blank | MUST |
| Réponses très génériques dans blank | acceptation abusive | critères par blank | MUST |
| Blanks de poids différents | moteur peut ne pas représenter | PROBE / assisted si besoin | SHOULD |
| InlineChoice | choice IDs désalignés | validation structure | MUST |
| Resequence | ordre partiel | vérifier partial credit réel | SHOULD |
| Resequence avec deux libellés identiques | faux blocage pédagogique | conserver les deux entrées via clés distinctes + warning | MUST |
| Matching avec libellés répétés | faux blocage pédagogique | conserver les paires via clés distinctes + warning | MUST |
| Matching update | IDs régénérés | préserver keys | MUST |
| Categorize update | structure fragile | preserve/blocked tant que non verrouillé | MUST |

# E. Points et barème

| Cas | Risque | Cible | Priorité |
| --- | --- | --- | --- |
| Points fournis | modèle change la valeur | conserver exactement | MUST |
| Points absents | proposition présentée comme source | marquer `proposed` | MUST |
| Virgule décimale `2,5` | parsing 25/2.5 | normaliser fr-CA | MUST |
| >1 décimale | Formative/cohérence | arrondi explicite, jamais silencieux si source | MUST |
| Total annoncé | somme différente | BLOCKED/confirm | MUST |
| Bonus | faux mismatch | modèle bonus explicite | SHOULD |
| 0 point intentionnel | faux avertissement | `graded:false` ou source explicite | SHOULD |
| keyword score > max | corruption | BLOCKED | MUST |
| max changé après keywords | redimensionnement | invariant points d'abord | MUST |
| même concept variantes scores différents | incohérence | validator | MUST |

# F. Identité, versions et patches

| Cas | Risque | Cible | Priorité |
| --- | --- | --- | --- |
| Même PDF renommé | nouvelle évaluation | contenu/fingerprint, pas nom seul | MUST |
| PDF régénéré avec métadonnées différentes | hash binaire change | hash binaire + identité sémantique/source | MUST |
| Même contenu OCR différent | fingerprint instable | prompt exact + anchors + stratégie migration | SHOULD |
| Question déplacée de page | nouvelle question | source number/prompt/fingerprint reconcile | MUST |
| Question renumérotée | mauvaise identité | prompt/source anchors | MUST |
| Prompt légèrement modifié | duplication | 3-way identity + similarity prudente | MUST |
| Deux questions identiques volontairement | fusion accidentelle | position/numéro/page distinguent | MUST |
| Package complet | absents peuvent être suppressions | `packageMode: full` | MUST |
| Patch Q16 seulement | 22 questions vues comme supprimées | `packageMode: patch` | MUST |
| Ancien chat renvoie paquet v1 | incompatibilité | migration v1 -> interne v2 ou fallback | MUST |
| Deux packages même assessment dans chat | mauvais sélectionné | dernier complet/explicite + signature | MUST |
| Regenerate réponse ChatGPT | ancienne barre | version/signature | MUST |

## Angle mort critique: FULL vs PATCH

Un paquet qui contient seulement Q16 pour un correctif ne doit jamais signifier « supprimer les 22 autres questions ».

Le v2 doit porter explicitement:

- `packageMode: full`
- ou `packageMode: patch`

Règles:

- full peut signaler les items absents comme `DELETE_PROPOSED`;
- patch ne parle que des items présents;
- patch ne recalculera pas naïvement le total de l'évaluation à partir de son sous-ensemble.

# G. Conflits avec modifications manuelles dans Formative

Angle mort majeur pour un vrai produit.

Cardinal doit éviter d'écraser une modification enseignante faite directement dans Formative après un import.

Le modèle robuste doit comparer trois états:

1. `lastImportedState` connu par Cardinal;
2. `currentServerState` lu dans Formative;
3. `desiredState` du nouveau paquet.

Cas:

| État | Décision |
| --- | --- |
| serveur == last, desired change | UPDATE sûr |
| serveur change, desired == last | modification manuelle détectée, préserver / conflit |
| serveur change et desired change | conflit, preview/merge |
| serveur == desired | UNCHANGED / réconcilier map |

MUST avant de prétendre à une synchronisation « sûre » sur examens vivants.

# H. Évaluations déjà utilisées par des élèves

| Cas | Risque | Cible | Priorité |
| --- | --- | --- | --- |
| réponses élèves existent | changement rétroactif | détecter/avertir | MUST |
| points changent après réponses | notes modifiées | blocage par défaut / confirmation forte | MUST |
| answer key change | auto-grading change | avertissement | MUST |
| subtype change | réponses incompatibles | BLOCKED | MUST |
| suppression question | perte historique | jamais auto | MUST |

Avant 0.5.0 stable, déterminer quelle query/quel champ permet de savoir qu'un Formative possède déjà des réponses. Si non disponible dans le moteur, afficher au minimum une confirmation explicite avant changement structurel d'une évaluation non vide utilisée.

# I. Réseau, service worker et atomicité

| Cas | Risque | Cible | Priorité |
| --- | --- | --- | --- |
| offline avant import | erreurs partielles | fail fast | MUST |
| timeout avant réponse | mutation peut avoir réussi | relire avant retry | MUST |
| HTTP 500 après write possible | duplication sur retry create | reconcile server first | MUST |
| 429 | rate-limit | backoff séquentiel | SHOULD |
| 401/403 mi-import | session expirée | renouveler puis relire avant reprise | MUST |
| service worker dort | état perdu | journal/session persistants appropriés | MUST |
| navigateur fermé mi-import | partiel | reprise journalisée | MUST |
| double clic | deux imports concurrents | lock | MUST |
| deux onglets lancent import | concurrence | lock global assessment+target | MUST |
| autre enseignant édite simultanément | overwrite | re-read/version check avant mutation | SHOULD |

## Unknown commit state

Ne jamais retry aveuglément une création après timeout.

Procédure:

1. considérer l'action `UNKNOWN`;
2. relire Formative;
3. rechercher l'item par mapping/fingerprint/prompt;
4. si trouvé et conforme -> journaliser succès;
5. si absent -> retry;
6. si ambigu -> BLOCKED.

# J. Cible Formative

| Cas | Risque | Cible | Priorité |
| --- | --- | --- | --- |
| aucun onglet Formative | erreur incompréhensible | instruction claire | MUST |
| un onglet | cible visible | MUST |
| deux onglets | mauvais examen | sélectionner/afficher explicitement | MUST |
| titre très différent | mauvais examen | warning | MUST |
| mapping assessment vers autre Formative | import croisé | warning/block | MUST |
| compte sans edit | mutation échoue | permission preflight | MUST |
| type premium/non disponible | API error | BLOCKED clair | SHOULD |

# K. Ordre, insertion, déplacement, suppression

L'ordre source est important, mais l'update/reorder natif n'est pas encore documenté comme adaptateur de production.

Tests requis:

- ajouter une nouvelle Q5 entre Q4 et Q6 dans un Formative existant;
- déplacer Q8 avant Q7;
- déplacer une question dans/hors d'un passage parent;
- supprimer une question dans la source.

Tant que la mutation d'ordre n'est pas prouvée:

- ne pas promettre que l'ordre d'un Formative existant sera réarrangé automatiquement;
- créer séquentiellement sur un Formative neuf reste sûr;
- signaler les écarts d'ordre dans le dry-run;
- suppression = proposition uniquement.

# L. Champs que Cardinal ne doit pas écraser

Une question existante peut avoir été enrichie manuellement avec:

- média;
- hints;
- tags;
- standards;
- rubric;
- réglages non gérés;
- annotations/options spéciales.

Principe de **field ownership**:

Cardinal ne modifie que les champs explicitement possédés par son protocole/adaptateur.

Champ absent du paquet != « effacer ce champ sur Formative ».

MUST pour les updates réels.

# M. ChatGPT, streaming et taille du paquet

| Cas | Risque | Cible | Priorité |
| --- | --- | --- | --- |
| réponse encore en streaming | paquet temporairement incomplet | attendre JSON complet/fin | MUST |
| génération interrompue | bloc partiel | erreur visible, aucun import | MUST |
| message régénéré | deux versions | dernière version complète | MUST |
| très gros questionnaire | limite tokens | package chunking ou fichier | MUST |
| autre modèle n'utilise pas code fence | détection ratée | protocole + fallback sentinelle | SHOULD |
| DOM ChatGPT change | bouton absent | bridge tolérant + popup fallback | MUST |
| bouton composer change | Préparer absent | fallback `Copier le protocole` | MUST |
| autre compte ChatGPT | mémoire absente | protocole autonome | MUST |

## Gros questionnaires

Le v2 doit prévoir soit:

- un paquet unique compact;
- un fichier JSON généré;
- ou plusieurs parties `packageId + part N/M + checksum` assemblées par Cardinal.

Ne jamais tronquer silencieusement une banque de réponses pour tenir dans un message.

# N. Langue, Unicode et formats

Tests:

- français avec accents;
- apostrophe typographique;
- `œ`;
- unicode NFC vs NFD;
- tiret simple/insécable;
- espaces insécables;
- nombres `1 600`, `1600`, `1 600 MW`;
- virgule décimale;
- noms propres;
- questionnaire anglais/bilingue.

Le protocole doit conserver la langue de la source. Les normalisations automatiques doivent être sûres et ne pas transformer un terme dans une autre langue en faux synonyme.

# O. Sécurité navigateur / contenu

- toute insertion UI à partir du paquet utilise `textContent`, pas `innerHTML` non nettoyé;
- aucun script contenu dans un prompt/question ne doit être exécuté;
- aucune URL de source ne doit être fetch automatiquement;
- aucun token/session dans paquet/log/Git;
- aucun HAR actif dans le repository;
- package source considéré non fiable jusqu'au validateur.

# P. Compatibilité API Formative

Après changement Formative:

- ne pas modifier tous les adaptateurs à la fois;
- identifier l'opération précise;
- reproduire via UI native;
- capturer mutation;
- test chirurgical;
- CREATE/UPDATE/UNCHANGED;
- documenter.

Régression minimum par adaptateur modifié:

- HTTP;
- GraphQL errors;
- returned ID/subtype;
- champs critiques;
- relecture serveur;
- visible UI si cache pertinent.

# Q. Tests pédagogiques de qualité du corrigé

Pour chaque question générée, passe silencieuse:

1. Quel est le **concept attendu**?
2. Quels termes prouvent réellement ce concept?
3. Une mauvaise réponse pourrait-elle contenir ce terme?
4. Une négation pourrait-elle le rendre faux?
5. La question exige-t-elle plusieurs concepts?
6. Un seul terme mérite-t-il vraiment la pleine note?
7. Les variantes d'un même concept ont-elles le même score?
8. Un terme est-il dupliqué avec des scores différents?
9. Une source fournie soutient-elle la réponse?
10. Le corrigé officiel contredit-il l'inférence?
11. Le niveau de correction devrait-il être auto, assisted ou manual?
12. Une réponse correcte non prévue est-elle raisonnablement couverte?

Principe:

> généreux dans les formulations, exigeant sur les concepts.

# R. Tests v2 avant stable

Minimum obligatoire:

1. Texte + questionnaire.
2. Questionnaire seul avec source manquante.
3. Corrigé officiel fourni.
4. PDF contenant deux textes.
5. Question image dépendante.
6. Points complets + total cohérent.
7. Points manquants.
8. Question multipartie.
9. Keyword mot court / frontière de mot.
10. Keywords imbriqués à scores différents.
11. Négation contenant un bon mot.
12. FITB multi-blanks et distribution de points.
13. Import neuf complet.
14. Réimport identique.
15. Patch une question.
16. Full package avec question supprimée.
17. Prompt modifié.
18. Deux questions identiques.
19. Modification manuelle côté Formative après import.
20. Formative avec réponses élèves.
21. Timeout simulé après create.
22. Session 401/403 mi-import.
23. Double clic.
24. Deux onglets Formative.
25. Context extension invalidated.
26. Restart service worker.
27. Restart navigateur.
28. Gros paquet/chunking.
29. Nouveau chat sans mémoire.
30. Autre compte ChatGPT.
31. Paquet v1 importé avec nouvelle extension.
32. Type non supporté.
33. Champ manuel/rubrique existante à préserver.
34. Item non Cardinal à préserver.
35. Conflit subtype.
36. Rapport final et reprise.
37. Paquet valide de 10 questions + Formative vide -> preflight non bloqué, `CREATE = 10`, 10 questions visibles.
38. Blocage avant preflight (cible/permission/snapshot) -> raison exacte visible dans la barre, jamais compteur opaque seul.

## Critère de sortie 0.5.0

0.5.0 n'est pas stable parce qu'un import « a l'air de marcher ».

Il est stable lorsque:

- le chemin normal est simple;
- les cas normaux sont silencieux;
- les exceptions sont explicites;
- aucune mutation ambiguë n'est devinée;
- les sources/corrigés restent pédagogiquement fidèles;
- CREATE/UPDATE/UNCHANGED sont reproductibles;
- un échec réseau ne crée pas de doublon;
- les modifications manuelles ne sont pas écrasées silencieusement;
- une évaluation déjà utilisée par des élèves est protégée;
- un nouveau chat/autre compte peut reproduire le workflow;
- 0.4.1 reste reconstructible comme fallback.
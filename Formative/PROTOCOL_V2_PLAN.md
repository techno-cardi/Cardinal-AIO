# Cardinal Formative v2 - protocole cible

Dernière mise à jour: 2026-09-20

## Objectif produit

Le workflow final doit rester extrêmement simple pour l'enseignant:

`joindre PDF(s) -> Préparer pour Formative -> vérifier un tableau -> Importer`

La complexité doit rester derrière l'interface.

Le protocole ne doit dépendre ni de la mémoire d'un compte ChatGPT, ni de cette conversation, ni d'un modèle précis. Il doit voyager avec l'extension Cardinal afin qu'un nouveau chat, un autre compte ou un autre modèle puisse reproduire le même comportement.

## Principe d'architecture

Trois responsabilités seulement:

1. **ChatGPT décide pédagogiquement**: lit les sources, distingue texte/questions/corrigé, comprend la tâche et produit l'intention pédagogique finale à importer: type, mode `auto/assisted/manual`, réponses attendues, concepts, termes, pondérations et issues pédagogiques.
2. **Cardinal normalise et vérifie techniquement**: parse le paquet, calcule les identités, ajoute seulement les variantes mécaniques sûres, vérifie la représentabilité technique, les bornes de points, la cohérence structurale, la cible et l'état serveur, puis prépare le plan. Cardinal ne remplace jamais une décision pédagogique de ChatGPT par sa propre interprétation.
3. **Formative reçoit et confirme**: Cardinal écrit via les mutations natives prouvées, relit le serveur, vérifie la postcondition exacte et journalise le résultat.

Règle de séparation durable:

- une heuristique Cardinal sur le sens d'une consigne, un média, un mot générique ou le caractère multipartie peut produire un **warning**, jamais un veto pédagogique implicite;
- un **blocker Cardinal** est réservé à une contradiction explicite du paquet, une structure impossible à transporter fidèlement, une ambiguïté d'identité/cible, un conflit avec l'état serveur ou une sécurité de mutation;
- un **blocker explicitement produit par ChatGPT dans `issues`** est respecté par Cardinal et n'est jamais perdu;
- Cardinal ne fabrique jamais de distracteur, synonyme, réponse, score, pondération ou changement de mode pour « réparer » le paquet.

Règle fondamentale:

> ChatGPT propose. Cardinal vérifie. Formative exécute. Aucun des trois ne doit inventer silencieusement l'état des deux autres.

## Sources acceptées

### Texte + questionnaire

- le texte est la source de vérité pour les réponses;
- seules les questions vont dans Formative par défaut;
- le texte reste physiquement/externalisé à moins d'une demande explicite d'intégration.

### Questionnaire seul

- les questions sont importables;
- une réponse déductible directement de la question peut être proposée;
- une question qui dépend d'un texte absent doit être marquée `SOURCE_REQUIRED`;
- ne jamais inventer une correction définitive à partir de connaissances générales si la consigne dit de répondre selon un texte absent.

### Questionnaire + corrigé

Priorité pédagogique:

`corrigé fourni > texte source fourni > information intrinsèque à la question > inférence prudente > aucune réponse`

Un corrigé fourni devient la référence principale, sauf conflit manifeste avec la consigne ou une source fournie.

### Un seul PDF contenant texte + questions

ChatGPT doit séparer les rôles logiques du document. Le fait que le texte et les questions partagent un fichier ne signifie pas que le texte doit être injecté dans Formative.

## Fidélité aux documents

Conserver séparément:

- `sourcePromptExact`: formulation exacte du PDF;
- `formativePrompt`: formulation envoyée à Formative.

Par défaut, la seule transformation silencieuse autorisée est technique, notamment retirer `16)`, `Q16`, etc. puisque Formative numérote déjà les questions.

Une amélioration rédactionnelle ou une correction de contenu doit être signalée dans la prévisualisation au lieu d'être appliquée silencieusement.

## Identité déterministe

ChatGPT ne doit pas inventer l'identité canonique finale.

Cardinal doit calculer:

- fingerprint SHA-256 de chaque fichier source;
- `assessmentFingerprint` à partir de l'ensemble de sources pertinentes;
- `itemFingerprint` à partir du fichier, page, numéro source, prompt exact normalisé et autres ancrages utiles.

Objectif: le même document doit produire la même identité dans un autre chat, un autre compte ChatGPT ou sur un autre ordinateur.

Ordre de résolution d'un item existant:

1. mapping Formative local connu;
2. item fingerprint source;
3. sourceNumber + sourcePage + sourceFile fingerprint;
4. ancien prompt exact;
5. similarité forte et non ambiguë;
6. sinon `BLOCKED`, jamais une devinette.

Une suppression n'est jamais automatique. Un item existant absent de la nouvelle source devient une suppression proposée à confirmer.

## Schéma conceptuel v2

Le schéma v2 doit être plus compact que v1 et raisonner par concepts plutôt que par une liste plate de variantes.

Exemple conceptuel:

```json
{
  "schema": "cardinal.formative/2",
  "protocolVersion": "2.0.0",
  "assessment": {
    "title": "...",
    "language": "fr-CA",
    "sourceMode": "external-reference-only"
  },
  "items": [
    {
      "source": {
        "file": "questionnaire.pdf",
        "page": 3,
        "number": "6",
        "promptExact": "6) Explique ..."
      },
      "kind": "question",
      "subtype": "shortAnswer",
      "prompt": "Explique ...",
      "points": 3,
      "grading": {
        "mode": "auto",
        "expectedAnswer": "...",
        "concepts": [
          {
            "concept": "xénon",
            "score": 2.5,
            "terms": ["xénon", "xénon-135", "empoisonnement"]
          }
        ]
      }
    }
  ]
}
```

Le schéma définit les données pédagogiques. Les variantes purement mécaniques doivent être générées par Cardinal lorsque possible.

## Variantes de réponse

### ChatGPT doit produire

- mots uniques réellement discriminants en priorité;
- synonymes réellement équivalents;
- flexions sémantiquement pertinentes;
- fautes fréquentes peu ambiguës lorsque pédagogiquement utile;
- expressions courtes seulement lorsqu'un mot seul serait trop ambigu.

### Cardinal peut générer automatiquement

- accentué / sans accent;
- apostrophe droite / typographique;
- casse lorsque `caseSensitive=false`;
- certaines variations de traits d'union et espaces lorsqu'elles sont sûres.

Objectif: réduire les paquets, améliorer la constance et laisser ChatGPT réfléchir aux vraies équivalences plutôt qu'à la duplication mécanique.

## Raisonner par concepts

Une banque de mots n'est pas une fin en soi.

Pour chaque question corrigeable, ChatGPT doit d'abord identifier les concepts attendus, puis choisir les termes qui représentent réellement ces concepts.

Exemple:

| Concept | Termes discriminants | Score absolu possible |
| --- | --- | ---: |
| extrémité des barres | graphite, pointe, extrémité | 3 |
| effet produit | sursaut, augmente, réaction | 2.5 |
| état du réacteur | emballement, instable | 2 |

Un mot ne reçoit pas un score élevé simplement parce qu'il apparaît dans la source.

## Trois modes de correction seulement

### `auto`

Question factuelle ou structurée où la correspondance peut raisonnablement produire une note automatique.

### `assisted`

Explication, interprétation, jugement, réponse à plusieurs composantes ou contexte où les mots-clés sont utiles pour pré-corriger mais ne prouvent pas à eux seuls une réponse complète.

Les réponses libres doivent quand même recevoir un vrai corrigé riche quand la source le permet.

### `manual`

Opinion réellement ouverte, média/source absent, tâche non représentable correctement par le moteur disponible ou autre situation où l'automatisation serait trompeuse.

`manual` ne doit jamais être choisi par paresse si une correction assistée utile est possible.

## Détection des tâches multiparties

ChatGPT/Cardinal doivent reconnaître les formulations comme:

- nomme deux;
- donne trois;
- pour chacune;
- argument + exemple;
- cause et conséquence;
- compare A et B;
- repère deux marqueurs et explique leur fonction.

Ces questions sont généralement `assisted` même si une banque de mots existe, car le modèle `ABSOLUTE_PER_MATCH_NOT_ADDITIVE` ne vérifie pas naturellement le nombre de composantes ni leur association.

## Limite fondamentale du Keyword Grading

Preuve serveur existante:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

Donc un seul match peut déclencher la valeur absolue qui lui est associée. Le système doit éviter d'accorder la pleine note à un terme isolé lorsqu'une réponse complexe exige plusieurs éléments.

Cas à surveiller:

- négation: « il n'y a pas eu d'explosion » contient `explosion`;
- contradiction: une mauvaise réponse peut réutiliser un bon terme;
- mot générique: `réacteur`, `important`, `problème`, `faire`, `voir`, etc.;
- réponse multipartie incomplète.

Les mots trop génériques doivent être exclus ou fortement dévalorisés.

## Provenance du corrigé

Chaque concept/réponse peut porter une provenance:

- `providedAnswerKey`;
- `sourceExplicit`;
- `sourceInferred`;
- `questionIntrinsic`;
- `teacherApproved`;
- `sourceMissing`.

Cette provenance aide la prévisualisation et l'audit sans alourdir l'interface normale.

## Points

Règles:

- conserver exactement les points fournis;
- maximum une décimale;
- si un total est annoncé, vérifier la somme;
- si les points sont absents, ChatGPT peut proposer une valeur mais elle doit être marquée `proposed`;
- aucun score de mot-clé ne peut dépasser le maximum;
- pour `answerChoicePoints`, points maximum d'abord, pondérations ensuite;
- ne jamais additionner les matches côté Cardinal.

Une incohérence de total doit bloquer l'import jusqu'à correction ou confirmation explicite.

## Texte source et blocs Formative

Par défaut:

`sourceMode = external-reference-only`

Le texte de lecture n'est pas importé dans Formative.

Distinguer explicitement:

- `sectionHeading`;
- `instructionBlock`;
- `sourceText`;
- `passageGroup`.

Les sections comme COMPRÉHENSION / INTERPRÉTATION peuvent devenir des blocs texte. Le texte de lecture ne devient un passage partagé que si le besoin pédagogique le demande explicitement.

## Images, graphiques et dépendances visuelles

Détecter les références:

- image;
- figure;
- schéma;
- carte;
- tableau ci-dessus;
- document 2;
- graphique;
- illustration.

Si la question dépend d'un média qui ne sera pas présent dans Formative, afficher un avertissement ou bloquer selon la gravité. Ne jamais importer une question devenue inutilisable hors contexte.

## Plusieurs textes

Permettre plusieurs `sourceRefs` par question.

Exemple:

- Q1-Q5 -> texte A;
- Q6-Q10 -> texte B;
- Q11 -> textes A + B.

Ne jamais utiliser le mauvais texte pour construire le corrigé simplement parce qu'il se trouve dans la même pièce jointe.

## Preview légère

Le tableau visible doit rester compact:

| # | Question | Type | Pts | Correction |
| --- | --- | --- | ---: | --- |
| 6 | Explique la chaîne... | Réponse courte | 3 | Auto · 3 concepts · 18 termes |
| 11 | Selon toi... | Réponse libre | 4 | Assistée · 4 concepts · 22 termes |
| 17 | Fais un lien avec Starship... | Réponse libre | 4 | ⚠ Source manquante |

La barre Cardinal peut afficher:

`23 questions · 85 pts · 10 auto · 11 assistées · 2 à vérifier`

Actions principales:

- `Voir le corrigé`;
- `Importer dans Formative`;
- `×`.

Pas de case « je valide les mots-clés » à chaque import. La vérification doit être visible et accessible, sans friction répétitive inutile.

## Validateur Cardinal

Avant d'activer l'import, vérifier silencieusement:

- schéma/protocolVersion supportés;
- IDs/fingerprints uniques;
- ordre stable;
- subtype supporté;
- nombre de questions;
- points et total;
- maximum une décimale;
- aucun score > maximum;
- corrigé présent lorsque requis;
- aucun blanc sans réponse;
- structures choix/correctAnswers cohérentes;
- prompts sans numérotation source répétée;
- absence de texte source accidentel en mode external;
- source requise non manquante pour une question prétendument auto;
- mots-clés trop génériques;
- doublons de termes;
- type Formative réellement PROVEN/branché;
- conflit avec l'état serveur;
- cible Formative clairement identifiée.

La majorité de ces contrôles ne doivent produire aucune UI lorsqu'ils passent.

## États utilisateur

Seulement trois niveaux:

- `✓ Prêt`;
- `⚠ À vérifier`;
- `✕ Bloqué`.

Éviter une interface remplie de badges techniques.

## Dry-run et plan

Avant écriture, Cardinal peut produire:

- CREATE;
- UPDATE;
- UNCHANGED;
- BLOCKED;
- DELETE_PROPOSED, jamais automatique.

Mode `Vérifier sans importer` souhaité:

`14 créations · 7 mises à jour · 2 inchangées · 0 suppression automatique · 3 avertissements`

## Journal transactionnel et reprise

Après chaque item réussi, enregistrer le résultat non secret.

Si l'import échoue à Q15:

- Q1-Q14 restent journalisées;
- Q15 = erreur;
- Q16-Q23 = non traitées;
- prochain clic reprend proprement sans recréer Q1-Q14.

Verrou d'import par `assessmentFingerprint + formativeId` pour empêcher double clic/concurrence.

## Cible Formative

Si plusieurs onglets Formative sont ouverts, ne jamais choisir silencieusement un questionnaire ambigu.

Afficher au minimum:

`Cible: Tchernobyl - Groupe 51`

Si le titre du paquet et celui du Formative divergent fortement, avertir avant écriture.

## Vérification après mutation

Succès = désiré comparé à retourné/relit.

HTTP 200 seul ne suffit pas.

Vérifier selon le type:

- ID;
- subtype;
- texte;
- points;
- correctAnswers;
- answerChoicePoints;
- choix/keys;
- parentId;
- champs spécialisés.

Une réponse serveur inattendue doit interrompre proprement le plan.

## Rapport final

Exemple:

`23 questions traitées · 17 créées · 4 mises à jour · 2 inchangées · 0 erreur · 174 réponses/corrigés configurés`

Permettre `Voir le rapport` sans encombrer l'usage quotidien.

## Portabilité

Le bouton cible `Préparer pour Formative` doit injecter un prompt/protocole autonome contenant:

- version du protocole;
- schéma attendu;
- règles de source;
- types permis;
- règles pédagogiques;
- règles de concepts/termes;
- comportement source manquante;
- comportement points;
- format de sortie.

Ainsi un ChatGPT vierge peut réussir sans connaître Kevin, les conversations passées ou la mémoire du compte.

## Hors scope initial 0.5.0

Ne pas alourdir la première version avec:

- éditeur complet de questionnaire dans l'extension;
- rubriques avancées non prouvées;
- média complexe non validé;
- synchronisation bidirectionnelle complète;
- dizaines de réglages utilisateur;
- types Formative non prouvés.

## Scope recommandé 0.5.0

1. protocole v2 embarqué;
2. bouton `Préparer pour Formative`;
3. schéma concepts + provenance + sourcePromptExact;
4. normalisation de variantes côté Cardinal;
5. validateur silencieux;
6. tableau compact + `Voir le corrigé`;
7. cible Formative affichée;
8. dry-run;
9. journal/reprise;
10. rapport final;
11. conserver 0.4.1 intact comme fallback durant le développement.

## Principe pédagogique final

> Une correction généreuse dans ses formulations, mais exigeante sur les concepts.

Le maximum d'intelligence doit produire le minimum d'interface.
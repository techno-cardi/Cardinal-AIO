# Cardinal Formative v2 - chantier exécutable 0.5.x

Dernière mise à jour: 2026-09-24

## État actuel

Le protocole `cardinal.formative/2`, version `2.0.0`, est la base normative du développement 0.5.x.

Documents de référence:

- `../SCHEMA_V2.md`;
- `../cardinal.formative.v2.schema.json`;
- `../VALIDATOR_V2_SPEC.md`;
- `../CHATGPT_GENERATOR_PROMPT_V2.md`;
- `../PROTOCOL_V2_TEST_MATRIX.md`;
- `../GRAPHQL_RECIPES.md`.

La baseline stable historique reste **Cardinal Formative Importer 0.4.1**. Elle n'est pas modifiée par le chantier 0.5.x. Son ZIP exact est reconstructible depuis `../standalone-0.4.1/archive/` et sa `manifest.key` est vérifiée en CI.

La RC actuelle est:

`Cardinal-Formative-Importer-STANDALONE-0.5.0-rc1`

Elle est maintenant réellement construite par GitHub Actions à partir du code de ce dossier. Le build conserve exactement l'identité Chrome de 0.4.1 et embarque le protocole ChatGPT v2 comme ressource de l'extension.

Important: **RC construite et testée en CI ne signifie pas encore remplacement de production de 0.4.1**. Les smoke tests réels dans Formative restent la prochaine gate.

## Invariant d'autorité pédagogique

Le paquet ChatGPT est l'intention pédagogique à transporter. Cardinal ne recalcule pas le sens de la consigne et ne choisit pas à la place de ChatGPT entre `auto`, `assisted` et `manual`.

Le preflight peut bloquer seulement pour une incohérence explicite du contrat, une représentation Formative impossible, une cible/identité ambiguë, un conflit serveur ou une sécurité de mutation. Les heuristiques de contenu restent des warnings. Les blockers déclarés dans le paquet sont conservés et affichés.

## Chaîne exécutable actuelle

La chaîne de sûreté est matérialisée jusqu'au navigateur et aux primitives GraphQL prouvées:

`Réponse ChatGPT ou document -> Copier le prompt Formative -> paquet v2 -> validation -> aperçu/dry-run -> cible explicite -> lecture serveur -> diff à trois états -> journal -> mutation gardée -> relecture serveur -> baseline vérifiée`

Côté code:

`parser/scanner ChatGPT -> runtime navigateur -> production stack -> validator -> adapter -> managed state -> reader serveur -> planner -> executor/journal -> transport guard -> primitives 0.4.1 -> verify`

Les types actuellement prouvés dans le pipeline complet sont:

- `shortAnswer`;
- `longAnswer`;
- `fillInTheBlank`;
- `multipleChoice` et `multipleSelection`;
- `inlineChoice`;
- `resequence` et `matching`;
- blocs texte internes nécessaires aux sections/instructions.

`categorize`, `passageGroup` et les autres types partiels ne sont pas annoncés comme sûrs.

## Copier le prompt Formative

La RC contient maintenant `chatgpt-prepare-helper-v2.js`.

Le bouton **Copier le prompt Formative** copie une consigne compacte de moins de 3 500 caractères. Le professeur la colle dans ChatGPT et envoie lui-même le message. Si son brouillon contient déjà une demande ou un examen, Cardinal copie seulement la consigne à coller à la fin: il ne réécrit pas le brouillon et ne le duplique pas.

La consigne couvre les réponses déjà présentes dans le chat, les PDF, DOCX et autres pièces jointes pertinentes. Elle demande un tableau humain, un paquet v2, des types de questions adaptés, un corrigé fondé sur les sources et des mots clés discriminants avec scores absolus prudents. Le protocole détaillé reste dans le dépôt comme référence normative; le flux actif ne le joint plus automatiquement à ChatGPT.

L'importeur affiche sous la réponse une barre d'aperçu. **Voir le corrigé préparé** montre la réponse attendue, les exigences, les mots clés actifs et les termes à vérifier avant import. Les retours à la ligne des questions et consignes sont conservés comme paragraphes Formative.

## Composition exécutable

### `legacy-primitives-v041.js`

Réutilise les opérations GraphQL observées dans l'archive exacte 0.4.1, notamment:

- `FormativeTeacherAddFormativeItem`;
- `QuestionEditableUpdateFormativeItem`;
- `FillInTheBlankEditableContainerMutation`;
- `TextEditableUpdate`.

Garde-fous:

- relecture détaillée avant UPDATE;
- conflit de subtype bloqué avant mutation;
- clés FITB existantes conservées ou opération bloquée;
- total de points appliqué avant les pondérations Keyword;
- CREATE possiblement committé traité comme incertain, jamais rejoué aveuglément;
- transition Keyword -> manuel bloquée tant que le nettoyage natif exact n'est pas prouvé;
- DELETE non exposé tant que son contrat natif n'est pas prouvé.

### `mutation-input-guard-v2.js`

Dernière barrière fail-closed avant mutation:

- type prouvé seulement;
- prompt/bloc texte non vide;
- points finis et précision bornée;
- correction manuelle ou `keyword-absolute` seulement;
- au moins un match actif en mode Keyword;
- score de match borné par le maximum de la question;
- collisions de termes/pointages bloquées;
- FITB incomplet bloqué;
- FITB manuel et crédit partiel non prouvé bloqués.

### `server-stack-v2.js`

Compose:

`session-store -> GraphQL client -> detailed reader -> raw 0.4.1 primitives -> mutation guard -> gateway`

Le caller reçoit le gateway gardé, jamais les primitives brutes.

### `production-stack-v2.js`

Façade de production utilisée par le standalone 0.5.x:

- `chrome.storage.session` pour la session Formative;
- `chrome.storage.local` pour baseline, journal et historique;
- persistence;
- orchestrator;
- runtime;
- transport transactionnel.

Le stockage de session et le stockage persistant ne peuvent pas être le même objet.

La façade publique reste étroite:

- `prepare`;
- `confirmReconciliation`;
- `execute`;
- `discardIncompleteRecovery`;
- capture/diagnostic/effacement de session;
- lecture de baseline/historique.

## Modules de sécurité principaux

### `validator-v2.js`

Valide avant mutation:

- schéma/protocole/packageMode;
- sources et références;
- IDs et ordre;
- points et totaux;
- provenance et source manquante;
- auto/assisted/manual;
- concepts, termes et collisions;
- mots génériques/risqués;
- fidélité sourcePrompt/prompt;
- transformations à revoir;
- dépendances média.

Principe: une représentation non verrouillée est bloquée plutôt qu'inventée.

### `adapter-v2.js`

Convertit l'intention v2 vers les structures v1 prouvées.

Mappings actifs:

- section/instruction -> bloc texte;
- shortAnswer;
- longAnswer;
- fillInTheBlank.

L'identité d'une question privilégie la source et un fingerprint stable plutôt que le prompt courant, afin qu'une reformulation ne crée pas automatiquement une nouvelle question.

### `managed-state-v2.js`

Normalise desired et serveur dans un état sémantique minimal commun.

Il protège notamment:

- Tiptap;
- ordre sémantique des blancs FITB plutôt que leurs clés aléatoires;
- ownership minimal des champs;
- incohérences `correctAnswers` / `answerChoicePoints`;
- subtype serveur inconnu;
- champs Formative non gérés par Cardinal.

### `planner-v2.js`

Diff à trois états:

`baseline Cardinal vérifiée / serveur actuel / nouveau paquet`

Décisions possibles:

- CREATE;
- UPDATE;
- UNCHANGED;
- PRESERVE_EXTERNAL;
- BLOCKED;
- DELETE_PROPOSED.

Aucune suppression automatique.

### `bootstrap-reconciliation-v2.js` et `reconciliation-flow-v2.js`

Gèrent un Formative déjà rempli ou un mapping perdu.

- rapprochement explicite;
- approbation liée à l'état serveur réellement relu;
- approbation périmée si la question change;
- ambiguïté entre candidats jamais résolue arbitrairement.

### `journal-v2.js`, `executor-v2.js`, `transport-bridge-v2.js`

Ordre de confirmation:

1. mutation;
2. relecture serveur;
3. postcondition exacte;
4. baseline mise à jour;
5. journal VERIFIED en dernier.

Une mutation possiblement reçue par Formative mais dont la réponse a été perdue devient UNCERTAIN. Elle est réconciliée par relecture serveur et n'est jamais rejouée aveuglément.

Entre PREPARE et APPLY, la cible et les préconditions sont relues. Une modification manuelle faite entre les deux bloque l'opération plutôt que d'être écrasée.

### Session et cible

`session-store-v2.js`, `graphql-client-v2.js`, `session-bootstrap-v2.js`, `session-capture-bridge-v2.js`, `target-enumerator-v2.js` et `target-selector-v2.js` couvrent maintenant la tranche navigateur de la RC.

Principes:

- secrets Formative uniquement dans `chrome.storage.session`;
- whitelist stricte d'en-têtes;
- cible explicite;
- plusieurs onglets ambigus -> choix demandé;
- URL relue avant mutation;
- cible changée/fermée -> blocage;
- aucune relance aveugle d'une mutation réseau incertaine.

## Runtime navigateur et UI

Voir `RUNTIME_UI_V2.md`.

La RC embarque maintenant:

- parser de paquet v2;
- scanner ChatGPT fail-closed;
- barre ChatGPT;
- audit du corrigé réel;
- bouton Copier le prompt Formative;
- popup de récupération/diagnostic;
- routeur runtime exact;
- contrôleur navigateur;
- sélection sécuritaire de cible;
- capture/bootstrap de session;
- progression liée aux onglets exacts;
- overlay Formative;
- background/service worker v2.

## Compatibilité Gestion des notes / Mozaïk

Voir `../GESTION_NOTES_INTEGRATION_CONTRACT.md` et `host-compat-v2.js`.

Le futur Cardinal principal doit préserver:

- le propriétaire Mozaïk `app-patch-v14.js`;
- `#syncMozaikBtn` avec `dataset.cardinalSyncOwner = "v14"`;
- le workflow Formative -> Gestion existant;
- le mode **Associer sans toucher aux notes** via `#formativeImportGrades`;
- le résultat global Formative et la présélection des questions déjà corrigées.

L'importeur ChatGPT -> Formative possède ses propres messages, IDs DOM, sources `window.postMessage` et namespace de stockage `cardinal.formative.v2.*`.

Ne pas fusionner 0.5.x dans Gestion des notes avant d'avoir identifié et audité le build réellement installé.

## CI / non-régression

Workflow:

`.github/workflows/formative-v2-tests.yml`

La CI:

1. reconstruit l'archive exacte 0.4.1;
2. vérifie son SHA connu;
3. vérifie le hash de sa `manifest.key` sans exposer la clé;
4. inspecte les contrats/primitives historiques;
5. fait `node --check` sur tous les `.js`;
6. exécute tous les `*.test.js` sous Node 22;
7. construit `0.5.0-rc1`;
8. vérifie le manifest, l'identité Chrome, les scripts et le popup;
9. vérifie maintenant explicitement l'asset `CARDINAL_FORMATIVE_PROTOCOL_V2.md` et son exposition aux hôtes ChatGPT;
10. téléverse la RC comme artefact GitHub Actions.

Le workflow se déclenche aussi lorsque `../CHATGPT_GENERATOR_PROMPT_V2.md` change. Cela empêche une modification du protocole embarqué d'échapper à la reconstruction et aux validations du build.

## État vérifié au 21 septembre 2026

La PR de durcissement #4 a été fusionnée dans `main` au commit:

`2734c476378fadd3ba45add98c0f4413d0453e65`

Le workflow `Formative v2 tests`, run `191`, a ensuite repassé avec succès directement sur `main` et a reconstruit:

`Cardinal-Formative-Importer-STANDALONE-0.5.0-rc1`

Digest de l'artefact Actions de ce run:

`sha256:3d7a3e9c529379c4cb3f3434d472e96547450f1726070dc0ad2bb301fe955629`

Ce run confirme la reconstruction 0.4.1, les tests v2, le build RC, l'identité Chrome historique et la présence/exposition du protocole embarqué. Il ne remplace pas les smoke tests réels ChatGPT + Formative.

## Ce qui est réellement terminé

- baseline 0.4.1 archivée/reconstructible;
- identité Chrome protégée;
- contrat v2 et validateur;
- adapter/managed state/planner/baseline;
- full vs patch;
- diff à trois états;
- réconciliation de cible déjà remplie;
- journal transactionnel et reprise;
- guards de mutation et transport;
- primitives 0.4.1 réutilisées derrière une façade gardée;
- production stack;
- service worker v2;
- capture/bootstrap de session;
- cible Formative explicite;
- scanner/barre ChatGPT;
- audit du corrigé;
- popup;
- progression ChatGPT/Formative;
- bouton Copier le prompt Formative;
- build installable automatisé;
- CI complète et reconstruction 0.4.1.

## Ce qui reste avant de remplacer 0.4.1

La prochaine gate n'est plus d'assembler le code. Elle est de le prouver dans les vraies interfaces.

À faire en priorité:

1. installer la RC et exécuter un smoke test réel `CREATE -> READ/VERIFY -> UPDATE -> UNCHANGED` pour shortAnswer, longAnswer et FITB;
2. modifier manuellement une question entre PREPARE et APPLY et confirmer le blocage;
3. simuler une réponse perdue/timeout après mutation et confirmer la reprise sans doublon;
4. tester un Formative déjà rempli et le rapprochement explicite;
5. tester deux onglets Formative ouverts;
6. tester redémarrage du service worker et reprise d'un journal incomplet;
7. tester nouveau chat/autre compte ChatGPT;
8. sonder réellement le moteur Keyword: sous-chaîne, ponctuation, accents, casse, termes imbriqués et plusieurs matches;
9. vérifier l'UX enseignant sur erreurs réelles de session/cible/source;
10. conserver 0.4.1 comme fallback jusqu'à réussite de cette matrice;
11. identifier ensuite le build Cardinal/Gestion des notes réellement installé;
12. tester la fusion avec Mozaïk v14 et **Associer sans toucher aux notes** inchangé;
13. seulement ensuite promouvoir Formative 0.5.x dans l'extension Cardinal principale.

Les types de questions supplémentaires viennent après cette tranche stable, un type à la fois, avec CREATE + READ + UPDATE + VERIFY et tests dédiés.

## Règle de développement

Ne pas réécrire les mutations Formative stables tant que les primitives 0.4.1 prouvées peuvent être réutilisées.

Ajouter les couches de sûreté devant, tester chaque frontière, bloquer en cas d'incertitude, puis seulement exposer une façade produit étroite à l'UI et au service worker.

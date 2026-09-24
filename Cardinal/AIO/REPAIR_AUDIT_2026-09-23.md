# Cardinal AIO - audit de réparation du 23 septembre 2026

## Statut

La reconstruction `Cardinal-AIO-1.2.0-rc2-REBUILD.zip` du 23 septembre 2026 ne doit plus être utilisée.

Elle n'est pas l'artefact RC2 audité du 21-22 septembre. Elle a été reconstruite à partir d'une lignée expérimentale différente et a réintroduit des défauts que l'architecture AIO auditée devait précisément éviter.

Branche de réparation propre :

`cardinal/aio-repair-20260923`

Base exacte :

`56d05b5b114b2ec4f7eb8c819a66bd7a0d3f34bd`

PR de réparation :

`#8`

## Artefacts à ne pas confondre

### RC2 originale auditée

Nom : `Cardinal-AIO-1.2.0-rc2.zip`

SHA-256 :

`b3c20657461aa43e4aaea7e9c61804821b9793c359fb738e3a030d0f4d35b9c1`

Cette archive avait été construite localement puis auditée après ré-extraction, mais n'a pas été conservée dans Git, Drive, une Release GitHub ou un artefact Actions.

### Rebuild fautif du 23 septembre

Nom : `Cardinal-AIO-1.2.0-rc2-REBUILD.zip`

SHA-256 :

`377cd780efa4a34517f86ccb32c1ec16dcc08640e0c95e584cb14ff4e5d5048d`

Cette archive est différente de la RC2 auditée.

Symptômes observés :

- Formative non détecté correctement
- action `Préparer une correction` indisponible
- menu AIO non contextuel
- conversations ChatGPT pouvant afficher `impossible de charger cette conversation`

## Baseline de production obligatoire

Le seul paquet historique accepté comme base de Gestion est :

`cardinal-gestion-des-notes-v1.1.9.zip`

SHA-256 :

`b8ef9a94cb9f55aca5957371ba239c67efdff943aa457b5aeed56afd005f69d7`

Le builder de réparation refuse maintenant tout autre fichier.

Aucun fallback vers 0.9.x n'est autorisé.

## Causes racines confirmées

### 1. Mauvaise baseline

Le rebuild fautif repartait de `cardinal-mozaik-extension-v0.9.3-beta.zip` plutôt que du paquet Gestion 1.1.9 audité.

Conséquences :

- architecture de worker différente
- ancien pont ChatGPT
- anciennes interfaces Formative/Mozaïk
- dépendances historiques 0.9.x
- risque de réintroduire des comportements explicitement abandonnés

### 2. Chaîne de worker incomplète

Le rebuild pouvait contenir :

`background-v093.js -> background-v092.js -> background-v091.js`

sans inclure correctement toute la chaîne attendue.

Une erreur au démarrage du service worker coupe ensuite les fonctions qui dépendent du runtime de l'extension.

### 3. Injection ChatGPT globale incorrecte

`chatgpt-ui.js` de la lignée expérimentale pouvait être injecté automatiquement sur ChatGPT.

Le comportement historique stable doit rester celui de `chatgpt.js` 1.1.9. Aucun ancien `chatgpt-ui.js` 0.9.x ne doit être global.

### 4. Popup/contextualité remplacés

Le rebuild partait du popup 0.9.3 et le transformait en surface AIO générique.

L'audit RC2 du 21-22 septembre établit toutefois un second contrat que la première réparation avait trop simplifié : la RC2 affichait un tableau de bord contextuel à six modules tout en conservant les capacités historiques de Gestion.

La réparation applique maintenant une adaptation additive :

- le chemin de popup du manifest Gestion 1.1.9 reste inchangé;
- le HTML historique reste la surface fonctionnelle et conserve ses commandes, notamment `Préparer une correction`;
- un hôte `cardinal-aio-dashboard` et `aio-popup.js` sont ajoutés avant `</body>`;
- le tableau de bord affiche exactement les six modules documentés par RC2;
- les états restent prudents : neutre par défaut, contexte ouvert sans prétendre que le moteur est confirmé, vert seulement lorsqu'un runtime peut réellement être interrogé, orange lorsqu'une action Classroom est requise;
- le dashboard est isolé dans un Shadow DOM afin de ne pas modifier le style ou les sélecteurs du popup historique;
- le popup standalone Formative v2 n'est pas promu comme popup principal AIO.

Le code source exact du popup RC2 local n'avait pas été persisté. Cette partie est donc une reconstruction du contrat documenté, pas une prétention de reproduction byte pour byte du popup RC2 disparu.

### 5. Réintroduction de sources UI obsolètes

Le rebuild superposait des fichiers suivis dans `Exercices-francais` qui ne correspondent pas aux versions cibles AIO :

- `formative-ui.js` suivi avec une garde historique v0.8
- `mozaik-ui.js` suivi avec une garde historique v0.7

La cible documentée reste :

- correction Formative stable, bridge 1.1.3
- Mozaïk v14, extension UI 1.1.6
- pont ChatGPT 1.1.9

Ces moteurs doivent venir du vrai paquet Gestion 1.1.9, pas de fichiers génériques plus anciens.

### 6. Risque MutationObserver de la lignée 0.9.3

La documentation stable Formative interdit le retour au prototype où un MutationObserver réécrivait le DOM Formative observé et pouvait se redéclencher jusqu'au gel de la page.

Le builder de réparation n'importe aucune source 0.9.x.

### 7. `manifest.key` Formative v2 copié dans l'AIO

Le builder Formative standalone conserve volontairement la clé Chrome de Formative 0.4.1 pour conserver l'identité de cette extension standalone.

Cette clé ne doit pas être copiée dans Cardinal AIO.

La baseline Gestion 1.1.9 n'avait pas de `manifest.key`.

Le builder de réparation supprime explicitement toute clé additive et le CI vérifie son absence.

### 8. Manifest reconstruit au lieu d'être dérivé

Le rebuild fautif reconstruisait un manifest à partir de plusieurs sources.

Le builder de réparation part maintenant d'une copie profonde du manifest Gestion 1.1.9 et ajoute seulement les capacités AIO nécessaires.

Sont notamment préservés :

- `action`
- chemin du popup historique, ensuite adapté additivement pour rétablir le tableau de bord RC2
- icônes
- CSP
- propriétés historiques non connues du builder
- ordre des content scripts historiques

### 9. Ordre Formative

Le moteur historique `formative-network.js` doit être injecté avant `formative-session-main-v2.js`.

Le merge et le CI vérifient explicitement cet ordre.

### 10. Endpoint Formative exact `/graphql`

La RC2 originale avait fermé un angle mort où certaines détections ne reconnaissaient que `/graphql/...`.

Le builder de réparation applique un patch borné au worker historique pour accepter :

- `/graphql`
- `/graphql?... `
- `/graphql/...`

sans accepter un préfixe voisin comme `/graphql-evil`.

Le patch échoue si le motif historique attendu n'apparaît pas exactement une fois.

Formative v2 possède déjà son correctif correspondant et ses tests.

### 11. Ownership runtime Classroom

Les messages génériques Classroom peuvent entrer en collision avec d'autres modules dans une extension AIO.

L'adaptateur de réparation utilise des types `PDC_NATIVE_*`.

### 12. Groupes Classroom codés en dur

Le pont 1.2.3 source contenait des chemins d'auto-liaison centrés sur 31, 32 et 51.

L'adaptateur AIO reconnaît maintenant les groupes numériques explicites plutôt qu'une liste fermée.

### 13. Polling Classroom

Les fallbacks de polling rapides ne doivent pas devenir le chemin principal.

L'adaptateur AIO conserve les événements/messages comme chemin principal, ralentit les fallbacks et garde le MutationObserver pour les changements DOM pertinents du module Classroom.

### 14. Script `banner-autodismiss.js`

La RC2 auditée avait retiré ce script global.

Le builder de réparation ne le copie pas et le CI vérifie son absence.

### 15. Tests trop superficiels du rebuild fautif

Le rebuild fautif validait surtout :

- présence de fichiers
- références du manifest
- syntaxe JavaScript
- présence de certaines chaînes

Cela ne validait pas réellement l'adaptation Classroom, le build Formative v2 ni l'assemblage complet.

Le nouveau CI exécute maintenant :

- compilation Python
- tests de contrat
- patch historique `/graphql`
- validation de dérive SHA des moteurs historiques
- adaptation du vrai Classroom 1.2.3 au commit épinglé
- `node --check` sur les scripts Classroom adaptés
- build réel de Formative v2 0.5.0-rc1
- assemblage complet d'un AIO synthétique à travers le chemin de production
- validation du worker chain
- validation de l'ordre Formative
- validation du popup historique, conservation de `Préparer une correction` et présence du dashboard RC2 à six modules
- absence de `manifest.key`
- absence de scripts 0.9.x actifs
- refus de build lorsque la baseline 1.1.9 exacte manque

## Invariants de réparation

Le builder `rebuild_aio_safe.py` doit toujours respecter les invariants suivants :

1. SHA-256 exact du ZIP Gestion 1.1.9 avant extraction.
2. Aucun fallback automatique.
3. Aucun `manifest.key` AIO hérité de Formative standalone.
4. Les fichiers suivants restent byte pour byte identiques à la baseline :
   - `chatgpt.js`
   - `formative-network.js`
   - `formative.js`
   - `formative-stealth.js`
   - `gestion-bridge.js`
   - `mozaik.js`
5. Le worker historique est conservé sous `legacy-service-worker.js` et seul le correctif borné `/graphql` y est appliqué.
6. Le worker AIO charge dans cet ordre :
   - `legacy-service-worker.js`
   - `classroom-background-aio.js`
   - `background-v2.js`
7. Les content scripts historiques restent avant les scripts Formative v2.
8. Le popup principal reste celui de Gestion 1.1.9; le dashboard RC2 à six modules lui est ajouté de façon additive sans remplacer ses commandes historiques.
9. Aucun `chatgpt-ui.js`, `background-v09x.js`, `formative-simple-ui.js` ou `formative-stealth-v09x.js` expérimental ne peut devenir actif.
10. Aucun ZIP installable n'est produit si une validation échoue.

## Pipeline dangereux neutralisé

La branche `cardinal/aio-rebuild-20260923` possédait encore un workflow capable de télécharger la beta 0.9.3 et de produire `Cardinal-AIO-1.2.0-rc2-FIX2.zip`.

Ce workflow a été remplacé par un job de refus explicite au commit :

`e1020c31c143edac2d30719fa90d2c410b96cadb`

Il ne peut plus republier automatiquement une reconstruction basée sur 0.9.x.

## Blocage restant

Le fichier exact `cardinal-gestion-des-notes-v1.1.9.zip` n'est actuellement présent dans aucun des emplacements persistants vérifiés :

- branches GitHub accessibles
- Releases GitHub
- code indexé
- Google Drive connecté
- Library ChatGPT
- anciennes conversations récupérables
- artefact Actions connu

Le checksum attendu est connu, mais les octets ne sont pas récupérables depuis ces sources.

Par conséquent, aucun nouveau ZIP de production n'est publié à partir d'une baseline substituée.

La réparation logicielle et le pipeline de validation sont prêts, mais la génération de l'artefact réel reste volontairement bloquée tant que la baseline exacte n'est pas disponible.

## Gate de publication

Même après récupération de la baseline exacte et réussite du build, la promotion exige encore un smoke test Chrome réel :

1. popup Cardinal et actions contextuelles
2. Gestion des notes
3. correction ChatGPT historique
4. préparation Formative
5. aperçu, publication et relecture serveur
6. envoi du résultat global vers Gestion
7. Mozaïk v14
8. Classroom
9. importateur Formative v2
10. navigation entre plusieurs conversations ChatGPT sans crash
11. rechargement de Formative sans session périmée
12. vérification qu'aucune ancienne extension Cardinal/Classroom séparée n'est active simultanément pendant le test AIO


## Audit additionnel après CI initial

### 16. Ownership Classroom réellement fail-closed

Le premier adaptateur de réparation renommait les commandes Classroom en `PDC_NATIVE_*`, mais son listener `chrome.runtime.onMessage` appelait encore `handleMessage()` pour tout message reçu et retournait `true`.

Cela créait encore une course possible avec Gestion, ChatGPT et Formative, même si les noms de commandes avaient été renommés.

Correctif :

- ensemble explicite `PDC_NATIVE_MESSAGE_TYPES`;
- retour immédiat `false` pour tout message étranger;
- aucun `sendResponse` Classroom pour un message Formative/ChatGPT inconnu;
- les anciens noms génériques comme `prepare` ne sont plus réclamés par le worker AIO.

Test runtime ajouté :

- `CARDINAL_FORMATIVE_IMPORT_STATUS` depuis ChatGPT est ignoré;
- `prepare` générique est ignoré;
- `PDC_NATIVE_REMEMBER_GROUPS` est accepté;
- le groupe futur `42` est mémorisé et relu correctement.

### 17. Boot du service worker AIO complet

Le CI ne se limite plus à `node --check`.

Le harness `aio_service_worker.boot.test.js` charge réellement dans le même contexte :

1. `service-worker.js`;
2. `legacy-service-worker.js`;
3. `classroom-background-aio.js`;
4. `background-v2.js` et toutes ses dépendances `importScripts`.

Sur le run #50, le boot synthétique vérifié attache les trois familles runtime attendues et démarre Formative v2 sans exception.

### 18. Permissions et hôtes verrouillés

Le manifest AIO final doit contenir exactement :

`[scripting, tabs, windows, webRequest, storage, alarms, debugger]`

Toute permission supplémentaire ou manquante fait échouer le build.

Les host permissions génériques sont interdites, notamment :

- `<all_urls>`;
- `http://*/*`;
- `https://*/*`;
- `*://*/*`.

Le même garde s'applique aux `content_scripts.matches`.

### 19. Aucun fichier expérimental mort dans le ZIP

Le contrôle ne vérifie plus seulement les scripts actifs.

Le build échoue si le paquet contient même comme fichier mort :

- `background-v09x.js`;
- `chatgpt-ui.js`;
- `formative-simple-ui.js`;
- `formative-stealth-v09x.js`;
- `banner-autodismiss.js`;
- `popup-v2.js`.

### 20. Protection de tout l'arbre Gestion 1.1.9

Au-delà des six moteurs critiques, tous les fichiers de la baseline Gestion 1.1.9 sont hachés avant intégration.

Tous doivent rester byte pour byte identiques après assemblage, sauf les fichiers volontairement adaptés :

- `manifest.json`;
- `service-worker.js`;
- le HTML désigné par `action.default_popup`, uniquement pour l'injection additive du dashboard RC2.

Les scripts historiques du popup, les moteurs, CSS, icônes et autres ressources restent byte pour byte identiques. Le HTML du popup doit conserver ses commandes historiques et n'accepte qu'une injection déterministe unique avant `</body>`.

Les métadonnées du build enregistrent :

- le nombre de fichiers historiques protégés;
- un digest SHA-256 de l'arbre protégé;
- le SHA du worker original;
- le SHA du worker historique patché;
- le chemin du popup;
- le SHA du popup historique avant adaptation;
- le SHA du popup final adapté;
- le SHA du manifest final.

### 21. Provenance Git exacte

Le builder vérifie maintenant les sources elles-mêmes avant assemblage.

Formative doit correspondre exactement à l'arbre Git :

`b5546e6d4536bee2a2bf2da0d89e1bf842a14788`

Cet arbre couvre tout `Formative/`, donc notamment :

- `Formative/v2/`;
- le protocole ChatGPT v2;
- la baseline standalone 0.4.1 utilisée par le builder Formative.

Classroom doit être exactement au commit :

`6887bfa2e8afd523a38a0e3286aa1f826276b8c5`

Les working trees Formative et Classroom doivent aussi être propres. Une modification locale ou un fichier non suivi dans les chemins utilisés bloque le build.

### 22. ZIP reproductible

`make_zip()` n'utilise plus les dates de modification du runner.

Les entrées ZIP sont écrites :

- dans un ordre déterministe;
- avec timestamp fixe;
- avec permissions fixes;
- avec compression fixe.

Deux assemblages issus des mêmes octets doivent donc produire exactement le même ZIP et le même SHA-256.

Un test compare directement les octets de deux ZIP reconstruits à partir des mêmes fichiers.

### 23. Publication atomique

Le ZIP et son fichier de métadonnées sont d'abord construits sous des noms temporaires.

Ils ne remplacent les sorties finales qu'après réussite complète de toutes les validations et de l'écriture des métadonnées.

Un échec intermédiaire ne publie donc pas un nouvel artefact partiel sous le nom installable.

### 24. CI final vérifié

Le workflow `Cardinal AIO repair contract`, run #50, est vert sur le code head :

`b9941bceadb3536b767248b6ea40e82bb0d0e458`

Le run couvre :

- compilation Python;
- tests de contrat;
- protection arbre historique;
- reproductibilité ZIP;
- adaptation Classroom réelle;
- test runtime ownership Classroom et groupe 42;
- build réel Formative v2;
- assemblage AIO synthétique complet;
- boot du service worker AIO complet;
- validation des permissions et hôtes;
- validation du worker chain;
- validation ordre Formative;
- absence de `manifest.key`;
- absence de sources 0.9.x empaquetées;
- refus sans baseline 1.1.9 exacte.



### 25. Contrat du popup RC2 rétabli après contre-audit

Le contre-audit du 23 septembre a mis en évidence une contradiction entre le builder de réparation et les documents RC2 eux-mêmes. Le builder préservait le popup Gestion 1.1.9 sans modification, alors que `AUDIT_RC2.md` et `CURRENT_STATE.md` attestent qu'un popup AIO contextuel à six modules avait été testé dans cinq contextes.

Correctif durable :

- test Node `Cardinal/AIO/aio-popup.test.js` verrouillant les six libellés RC2 et les contextes Gestion, Formative, ChatGPT, Classroom, Mozaïk et générique;
- `aio-popup.js` reconstruit avec états prudents et sans `innerHTML`, `eval`, `new Function`, `document.write` ou `debugger`;
- adaptation additive du popup historique, sans remplacement de ses commandes;
- refus fail-closed si le popup n'a pas exactement une fermeture `</body>` ou s'il a déjà été adapté;
- validation de l'assemblage synthétique sur le vrai chemin de production;
- conservation explicite du bouton historique `Préparer une correction` dans le test d'intégration;
- SHA avant/après du popup enregistré dans les métadonnées.



### 26. Parité du popup Formative standalone restaurée

Le popup standalone Formative v2 possédait deux commandes de récupération qui auraient disparu si `popup-v2.html/js` était simplement exclu de l'AIO :

- `Analyser cette page ChatGPT`;
- `Réafficher les barres masquées`.

Ces commandes sont maintenant intégrées dans le dashboard AIO lorsque l'onglet actif est ChatGPT.

Le dashboard utilise exactement :

- `CARDINAL_FORMATIVE_UI_RESCAN`;
- `cardinal.formative.v2.ui.dismissed`.

Le test `aio-popup.test.js` compare directement ces constantes aux exports de `chatgpt-content-v2.js` et `popup-v2.js`. Une dérive future du moteur Formative fera donc échouer la CI AIO.

Le module Importateur indique aussi le nombre d'évaluations Formative ouvertes, comme le popup standalone fournissait un état des cibles.

### 27. Risques créés uniquement par la fusion d'extensions

Des extensions Chrome séparées possèdent des mondes isolés, des workers et des stockages distincts. Une fusion AIO peut donc créer des collisions qui n'existaient pas auparavant.

Le nouveau contrat `aio_compatibility_contract.py` vérifie maintenant entre Gestion, Formative v2 et Classroom :

- écritures explicites sur `globalThis` ou `window`;
- IDs DOM utilisés/créés sur les mêmes hôtes;
- clés `chrome.storage`;
- globals explicites dans les service workers;
- chevauchement des hôtes de content scripts;
- séparation correcte des scripts `world: MAIN` et du monde `ISOLATED`.

Le build réel exécute ces comparaisons sur les octets de la vraie baseline 1.1.9 lorsqu'elle est disponible.

### 28. Collisions de scope JavaScript top-level

Une collision `const` ou `let` entre deux anciens content scripts peut casser la fusion même sans écrire explicitement sur `window`.

Le builder construit donc, uniquement pour validation, des bundles par :

- hôte;
- monde Chrome (`ISOLATED` ou `MAIN`);
- ordre réel du manifest.

Les scripts susceptibles de coexister sont concaténés avec une frontière explicite puis validés par `node --check`.

Cela détecte notamment une redéclaration top-level qui n'existait pas lorsque les scripts appartenaient à deux extensions différentes.

Le même principe est appliqué aux scripts classiques du popup historique et à `aio-popup.js`.

### 29. Parité de capacités des manifests séparés

Le build vérifie explicitement que le manifest AIO final conserve toutes les capacités requises par les extensions séparées :

- permissions Formative v2;
- permissions Classroom;
- host permissions Formative v2;
- host permissions Classroom;
- blocs `content_scripts` Formative v2 inchangés;
- blocs Classroom adaptés présents;
- ressources `web_accessible_resources` Formative v2 présentes.

Les seules substitutions volontaires restent documentées :

- le worker principal devient l'orchestrateur AIO;
- le popup principal reste celui de Gestion et reçoit le dashboard AIO;
- la `manifest.key` du standalone Formative n'est pas héritée;
- `banner-autodismiss.js` n'est pas repris.

### 30. Adaptation Classroom rendue fail-closed

Les changements de polling Classroom ne sont plus des `replace()` silencieux.

Le builder exige exactement les motifs attendus avant de modifier :

- le fallback du générateur de 1 seconde vers 15 secondes;
- le fallback d'auto-liaison de 5 secondes vers 60 secondes.

Si le commit Classroom épinglé dérive ou si le motif attendu disparaît, le build échoue.

Après adaptation, aucun ancien type runtime générique parmi `rememberGroups`, `getGroups`, `prepare`, `claim`, `paste`, `publish`, `activate`, `complete`, `fail` ne peut rester comme littéral de message. Les types AIO doivent être les `PDC_NATIVE_*`.

### 31. Régressions Formative rejouées dans la CI AIO

La CI de réparation ne se contente plus de construire Formative v2.

Elle exécute aussi tous les fichiers :

`Formative/v2/*.test.js`

sur chaque modification AIO.

Cela empêche une branche AIO de rester verte si l'intégration casse un contrat Formative que le workflow standalone aurait détecté séparément.

### 32. Boot et ownership devenus gates du build de production

Le boot complet AIO n'est plus seulement exercé dans une étape CI externe.

`rebuild_aio_safe.py` appelle maintenant le harness `aio_service_worker.boot.test.js` avant publication du ZIP.

Le harness vérifie aussi l'ownership runtime dans le worker fusionné :

- message inconnu : 0 propriétaire;
- `CARDINAL_FORMATIVE_IMPORT_STATUS` : exactement 1 propriétaire;
- `PDC_NATIVE_GET_GROUPS` : exactement 1 propriétaire.

Une vraie baseline 1.1.9 dont le worker historique entrerait en conflit avec ces routes sera donc refusée avant publication.

### 33. Récupération locale fail-closed renforcée

Le scanner Windows ne qualifie plus un dossier de `StrongCandidate` simplement parce que son score dépasse un seuil.

Un candidat fort doit maintenant cumuler tous les critères :

- version 1.1.9;
- `service-worker.js`;
- aucune `manifest.key`;
- tous les fichiers stables requis;
- marqueur Formative stable;
- marqueur Mozaïk UI 1.1.6;
- marqueur ChatGPT 1.1.9;
- popup existant;
- popup adaptable avec exactement un `</body>`;
- surface `Préparer une correction` présente.

L'auto-test Windows contient également un cas négatif : après suppression d'un fichier requis, le dossier reste reportable mais ne peut plus être classé fort.

### 34. Matrice de compatibilité live

La procédure complète de validation est maintenant figée dans :

`Cardinal/AIO/COMPATIBILITY_SMOKE_MATRIX.md`

Elle couvre Gestion, ChatGPT historique, correction Formative historique, importateur Formative v2, Mozaïk v14, Classroom, navigation/rechargement et coexistence.

Le dernier head fonctionnel avant cette mise à jour documentaire est :

`98290d1ef0a0324b88d7d54247ba265cbb5fa279`

Les runs `Cardinal AIO repair contract` push #169 et PR #170 sont verts sur ce head.


## Récupération locale automatisée

Le cloud et les dépôts persistants ne contiennent pas les octets du ZIP Gestion 1.1.9. Un scanner Windows read-only a donc été ajouté :

`Cardinal/AIO/recover_baseline_windows.ps1`

SHA attendu du ZIP :

`b8ef9a94cb9f55aca5957371ba239c67efdff943aa457b5aeed56afd005f69d7`

Le scanner :

- calcule le SHA-256 de tous les ZIP trouvés dans Downloads, Desktop, Documents, TEMP et OneDrive;
- inspecte aussi les variantes OneDrive entreprise/personnel;
- inspecte les ZIP encore accessibles dans la Corbeille Windows;
- lit les profils Chrome, Edge et Brave;
- récupère les chemins d'extensions unpacked consignés dans `Preferences` et `Secure Preferences`;
- inspecte aussi les répertoires `Extensions` des profils Chromium;
- cherche les `manifest.json` Cardinal dans les emplacements utilisateur;
- reconnaît un dossier Gestion 1.1.9 à partir du manifest, du worker, des fichiers historiques requis et des marqueurs connus;
- calcule un digest d'arbre pour tout candidat;
- ne modifie jamais le profil navigateur;
- ne remplace aucun fichier source;
- copie uniquement le ZIP exact dans le dossier de récupération si son SHA correspond exactement.

L'option `-Deep` étend la recherche à tout le profil utilisateur.

Un mode `-SelfTest` construit un candidat 1.1.9 synthétique et valide toute la logique de détection.

Le workflow `Cardinal AIO repair contract` exécute maintenant :

- un parse PowerShell du scanner sur Ubuntu;
- un job `windows-latest` qui exécute réellement `recover_baseline_windows.ps1 -SelfTest`.

Le run PR #68 est vert pour le job principal et pour `recovery_windows`.

## Recherche de baseline - couverture exhaustive au 23 septembre 2026

Sources vérifiées sans retrouver les octets exacts :

- branches et arbres GitHub accessibles de `techno-cardi/database`;
- branches et historique de `techno-cardi/Exercices-francais`;
- recherche code/commits/issues/PR dans l'organisation `techno-cardi`;
- Releases GitHub;
- artefacts Actions associés aux promotions 1.0.x et aux commits Mozaïk;
- artefacts GitHub Pages historiques, qui ne contiennent que le site déployé;
- Google Drive par mots-clés;
- Google Drive par MIME `application/zip`, `application/x-zip-compressed` et `name contains '.zip'`;
- Library ChatGPT par recherche et inventaire brut des ZIP;
- conversations historiques et contexte personnel indexé;
- pièces jointes/courriels indexés accessibles au contexte personnel;
- recherche web publique par nom exact et SHA;
- Supabase Storage du projet, qui ne contient actuellement aucun bucket/objet de fichier exploitable;
- archives/base64 suivies dans `database`, où seule la baseline Formative standalone 0.4.1 est archivée.

Constat historique supplémentaire :

- au commit de promotion Cardinal 1.0.2 `45cc69aea021c6b39473a3649c32a9907ff39982`, le dossier suivi `resultats/mozaik/extension/` était encore en version 0.8.1;
- les commits de promotion 1.0.0, 1.0.1 et 1.0.2 ne modifiaient que le fichier de métadonnées/checksum de release;
- les builds stables 1.x étaient donc bien construits et distribués localement sans source finale commitée;
- aucun commit indexé de l'organisation ne contient les fichiers finaux `chatgpt.js`, `formative-network.js`, `gestion-bridge.js`, `formative-stealth.js`, `service-worker.js` ou `mozaik.js` sous les noms utilisés par Gestion 1.1.9.

La récupération sur le poste où l'extension stable a été construite/installée est donc la voie restante la plus fiable.

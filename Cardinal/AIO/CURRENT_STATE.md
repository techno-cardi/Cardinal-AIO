# MISE À JOUR CHATGPT / FORMATIVE - 2026-09-24

État validé sur la branche `cardinal/chatgpt-resilient-scanner-20260924`.

## Robustesse de détection ChatGPT

Le scanner Formative v2 ne dépend plus d'un seul DOM ChatGPT ni de la présence obligatoire d'un bloc `<pre>/<code>`.

Signaux pris en charge, de façon défensive et fail-closed :

- `data-message-author-role`;
- `data-turn`;
- `data-role`;
- `data-message-author`;
- wrappers `data-testid="conversation-turn-*"`;
- `article`;
- action assistant `copy-turn-action-button` comme signal de secours.

Le paquet `CARDINAL_FORMATIVE_PACKAGE_V2` est recherché dans le texte complet d'un tour assistant. Le HTML `pre/code` sert seulement d'ancrage facultatif pour masquer le bloc technique et placer la barre. Un paquet présent dans un tour utilisateur reste refusé.

`Analyser cette page` renvoie maintenant un résultat observable. Si aucun content script ne répond, le popup AIO réinjecte la chaîne ChatGPT Formative v2 avec `chrome.scripting.executeScript`, puis relance le scan. Le bouton n'est donc plus dépendant du scanner qu'il est censé récupérer.

## Prompt Formative copié

`Copier le prompt Formative` copie une consigne structurée et lisible d'environ 5,3 k caractères. Elle conserve le contrat technique `cardinal.formative/2` et reprend les exigences pédagogiques du protocole de correction Cardinal :

- indépendance des pointages actuels;
- critères de réussite établis avant le corrigé;
- priorité au corrigé/barème/exemples de l'enseignant;
- équivalence sémantique;
- cohérence entre réponses équivalentes;
- traitement élément par élément des questions multiparties;
- gestion des ambiguïtés raisonnables;
- blocage lorsque la source nécessaire manque;
- deuxième passe silencieuse de cohérence;
- vérification explicite des angles morts pédagogiques.

## Build public autonome

La baseline utilisateur vérifiée Gestion 1.1.8 est maintenant persistée sous :

`Cardinal/AIO/baselines/gestion-1.1.8-user-verified/`

Contrat :

- taille ZIP : 89836 octets;
- SHA-256 : `1a8b2f592f7b112e68ce488a4b63c2175fc535c54eebb17d0fd195d53c0a9a0d`.

Le workflow public `Cardinal AIO repair contract` reconstruit cette baseline localement, construit le candidat AIO, le réextrait, le revalide et téléverse l'artefact.

Run de validation complet : `36067661617`.

Artefact : `Cardinal-AIO-1.2.0-rc3-repair-g118`.

Digest de l'artefact Actions : `sha256:ff09797724237354062bbef8d33b155e628ef0730cba9916e4c80da5e36cc6ac`.

---

# AVIS DE RÉPARATION - 2026-09-23

L'état de publication décrit plus bas correspond à la RC2 originale auditée localement les 21-22 septembre 2026. Son ZIP exact n'est plus récupérable dans les sources persistantes disponibles.

Ne pas utiliser `Cardinal-AIO-1.2.0-rc2-REBUILD.zip` ni `Cardinal-AIO-1.2.0-rc2-FIX2.zip` comme substituts. Ces reconstructions partent de la lignée expérimentale 0.9.x et ne sont pas équivalentes à la RC2 auditée.

État de réparation courant :

- branche : `cardinal/aio-repair-20260923`
- PR : `#8`
- builder : `Cardinal/AIO/rebuild_aio_safe.py`
- baseline obligatoire : `cardinal-gestion-des-notes-v1.1.9.zip`
- SHA-256 obligatoire : `b8ef9a94cb9f55aca5957371ba239c67efdff943aa457b5aeed56afd005f69d7`
- aucun fallback 0.9.x
- aucun nouveau ZIP de production tant que la baseline exacte n'est pas disponible
- audit détaillé : `Cardinal/AIO/REPAIR_AUDIT_2026-09-23.md`
- head fonctionnel validé avant cette mise à jour documentaire : `98290d1ef0a0324b88d7d54247ba265cbb5fa279`
- workflow `Cardinal AIO repair contract` : push #169 et PR #170, succès complet sur ce head
- boot AIO complet vérifié et désormais obligatoire dans le chemin de build réel avant publication
- ownership runtime AIO complet vérifié : message inconnu 0 propriétaire, Formative v2 exactement 1, Classroom exactement 1
- suite complète `Formative/v2/*.test.js` rejouée dans la CI AIO
- parité de manifest avec les extensions Formative et Classroom séparées vérifiée : permissions, hôtes, content scripts et ressources web
- collisions créées par la fusion interdites : globals, IDs DOM, clés chrome.storage, scope top-level des content scripts et scope des scripts du popup
- bundles de content scripts validés par hôte et monde Chrome avec `node --check`
- compatibilité du popup historique et de `aio-popup.js` validée ensemble
- fonctions popup Formative standalone restaurées dans l'AIO sur ChatGPT : `Analyser cette page ChatGPT` et `Réafficher les barres masquées`
- nombre d'évaluations Formative ouvertes affiché dans l'état du module Importateur
- constantes des actions popup AIO liées directement aux constantes du moteur Formative v2 pour empêcher toute dérive
- groupe Classroom futur `42` vérifié
- arbre Git Formative et commit Classroom épinglés et vérifiés
- tout l'arbre hérité Gestion 1.1.9 protégé byte pour byte sauf manifest/worker et le HTML du popup, adapté de façon additive
- popup historique Gestion conservé avec ses commandes, dont `Préparer une correction`, plus tableau de bord RC2 à six modules reconstruit selon le contrat audité
- SHA du popup historique avant adaptation et SHA du popup final consignés dans les métadonnées
- permissions/hôtes génériques bloqués
- ZIP reproductible et publication atomique
- scanner Windows read-only `Cardinal/AIO/recover_baseline_windows.ps1`
- récupération par SHA exact dans ZIP locaux/OneDrive/Corbeille
- détection des chemins unpacked Chrome/Edge/Brave et des dossiers Extensions
- auto-test réel sur `windows-latest` validé
- matrice de compatibilité live : `Cardinal/AIO/COMPATIBILITY_SMOKE_MATRIX.md`

Le workflow dangereux de la branche `cardinal/aio-rebuild-20260923` a été neutralisé et ne peut plus republier automatiquement un rebuild 0.9.x.

---

# Cardinal AIO - état courant

Dernière mise à jour : 2026-09-23

## Cible

Une seule extension Chrome Cardinal regroupant :

- Gestion des notes
- correction Formative existante
- pont ChatGPT existant
- Mozaïk
- importateur de questions Formative v2
- Pont natif Classroom

La règle d'architecture demeure : intégrer les moteurs éprouvés, ne pas les réécrire sans défaut démontré.

## Baselines verrouillées

### Cardinal Gestion des notes

Paquet source : `cardinal-gestion-des-notes-v1.1.9.zip`.

SHA-256 : `b8ef9a94cb9f55aca5957371ba239c67efdff943aa457b5aeed56afd005f69d7`.

Contrats à préserver :

- pont ChatGPT 1.1.9;
- correction Formative stable, bridge 1.1.3;
- Mozaïk v14, UI 1.1.6;
- écriture Formative suivie d'une relecture serveur;
- aperçu avant publication;
- lots multiquestions et commentaires partiels;
- association Formative vers Gestion sans effet secondaire sur les notes lorsque l'import de notes est désactivé;
- aucune synchronisation Mozaïk implicite dans ce scénario.

### Importateur de questions Formative

Source : `Formative/v2/` dans ce dépôt.

Version intégrée : `0.5.0-rc1`.

Protocole : `cardinal.formative/2`, version `2.0.0`.

Le module complète la correction Formative historique, il ne la remplace pas.

### Pont natif Classroom

Source : `techno-cardi/Plan-de-cours/chrome-classroom-native-bridge`.

Version de base : `1.2.3`.

Commit épinglé : `6887bfa2e8afd523a38a0e3286aa1f826276b8c5`.

## Candidate courante

**Cardinal AIO 1.2.0-rc2**

Nom manifeste : `Cardinal`.

Permissions :

`[scripting, tabs, windows, webRequest, storage, alarms, debugger]`

Ces permissions ont été rapprochées des API réellement utilisées pendant l'audit RC2.

## Architecture du service worker

Ordre de chargement :

1. worker historique Gestion 1.1.9 sous `legacy-service-worker.js`;
2. worker Classroom adapté à l'AIO;
3. `background-v2.js` de l'importateur Formative.

L'adaptateur Classroom utilise maintenant uniquement des messages `PDC_NATIVE_*`. Les anciens types génériques ne sont plus réclamés par l'AIO. Un message générique provenant de ChatGPT ou d'un autre module est ignoré sans `sendResponse`.

L'importateur Formative v2 ne possède que les messages `CARDINAL_FORMATIVE_IMPORT_*` qu'il reconnaît explicitement.

## Coexistence Formative

Le moteur historique et le module v2 peuvent observer la même requête GraphQL sans la doubler. L'audit RC2 prouve une seule requête réseau sous-jacente avec les deux consommateurs actifs.

Les endpoints suivants sont reconnus :

- `/graphql`
- `/graphql?…`
- `/graphql/...`

Un chemin ressemblant, par exemple `/graphql-evil`, est rejeté.

Les sessions sont liées à l'onglet et invalidées au début d'un rechargement/navigation afin d'éviter de conserver une autorisation périmée après un changement de compte.

## Classroom

La RC2 retire la dépendance à la liste annuelle `31/32/51`. Les groupes numériques futurs sont acceptés lorsqu'ils proviennent d'une valeur explicite ou d'un libellé non ambigu, par exemple `Groupe 42` ou `FRA4SE-42`.

Le polling inutile a été réduit. Les événements et observers ciblés sont les chemins normaux, avec watchdog lent seulement comme secours.

Les liaisons Classroom sont stockées dans `pdcNativeClassroomGroupMapV1`. Comme l'AIO possède son propre stockage Chrome, une ancienne extension Classroom séparée ne transmet pas magiquement ce stockage. Le popup RC2 indique clairement lorsqu'il faut réapprendre les groupes.

## Popup AIO

Le popup RC2 est un tableau de bord compact de l'AIO. Il affiche les six modules intégrés :

- Gestion 1.1.9
- Correction Formative 1.1.3
- Importateur Formative 0.5 RC1
- Mozaïk v14
- Pont Classroom 1.2.3
- Pont ChatGPT 1.1.9

Un module empaqueté n'est plus affiché en vert par défaut. Le vert est réservé à un état réellement confirmé, l'orange aux actions requises et l'état neutre signifie simplement que le module est inclus.

La réparation du 23 septembre conserve le popup Gestion 1.1.9 comme surface fonctionnelle et lui ajoute ce tableau de bord de façon additive. Le code source exact du popup RC2 local n'avait pas été persisté; la reconstruction est donc fondée sur le contrat RC2 documenté et testée explicitement, sans remplacer les commandes historiques.

Sur une page ChatGPT active, le popup AIO restaure aussi les deux commandes de récupération de l'extension Formative v2 séparée : `Analyser cette page ChatGPT` et `Réafficher les barres masquées`. Le module Importateur indique également le nombre d'évaluations Formative ouvertes. Ces constantes sont testées directement contre les exports du moteur Formative v2 pour empêcher une dérive future.

Depuis le 24 septembre, l'action **Copier le prompt Formative** copie une consigne compacte dans le presse-papiers. Le professeur la colle à la fin de sa demande ChatGPT. Le popup ne réécrit plus le brouillon; la consigne demande un corrigé complet, des mots clés discriminants et une présentation en paragraphes. Le panneau de révision sous la réponse affiche les termes actifs et les termes risqués avant l'import.

## Validation RC2

Voir `Cardinal/AIO/AUDIT_RC2.md` pour le détail.

Résumé :

- 76 fichiers dans l'artefact final;
- 66 fichiers JavaScript valides;
- boot complet du worker réussi;
- toutes les références manifest présentes;
- ownership runtime validé;
- coexistence Formative historique + v2 validée sans double requête;
- purge des sessions Formative validée;
- groupe Classroom futur `42` validé;
- popup réel testé dans cinq contextes sans overflow;
- aucun script JavaScript mort détecté dans le graphe du paquet;
- aucun `eval`, `new Function`, `document.write`, `debugger` ou marqueur TODO/FIXME/HACK/XXX détecté;
- CI Formative v2 run #221 verte avec vrai test de boot.

Artefact : `Cardinal-AIO-1.2.0-rc2.zip`

SHA-256 : `b3c20657461aa43e4aaea7e9c61804821b9793c359fb738e3a030d0f4d35b9c1`

## Gate avant promotion stable

La prochaine étape est un smoke test réel dans Chrome, pas une nouvelle refonte statique.

Ordre recommandé :

1. popup Cardinal et version RC2;
2. Gestion des notes, comportement normal;
3. correction ChatGPT existante;
4. correction Formative historique, aperçu, publication et relecture serveur;
5. Mozaïk v14 sur un petit lot;
6. Classroom, réapprentissage des groupes au besoin puis publication test;
7. importateur Formative v2 sur un petit questionnaire;
8. reprise/rechargement pour confirmer les scénarios de session.

Les versions séparées restent disponibles comme rollbacks tant que cette matrice n'est pas passée. Une régression observée doit être corrigée dans l'adaptateur AIO en priorité plutôt que par une refonte du moteur historique.

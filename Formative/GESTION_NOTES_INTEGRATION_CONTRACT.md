# Contrat d’intégration — Cardinal Formative v2 + Gestion des notes

Dernière vérification du dépôt hôte: 2026-09-21

Ce document protège le comportement actuel de **Cardinal - Gestion des notes** avant d’y fusionner l’importeur ChatGPT → Formative.

Le principe est simple: l’importeur de questions devient un module de la même extension, mais il ne devient pas propriétaire des workflows Gestion des notes, correction Formative ou Mozaïk déjà en production.

## État hôte réellement observé

Le dépôt `techno-cardi/Exercices-francais` contient actuellement un frontend de Gestion des notes dont le flux Mozaïk est possédé par `app-patch-v14.js`.

Le bouton `#syncMozaikBtn` est possédé par v14 via `dataset.cardinalSyncOwner = "v14"`.

Le flux Mozaïk normal est borné:

1. affichage immédiat de la progression;
2. extension prête: 1,8 s max;
3. flush des sauvegardes de notes: 7 s max;
4. validation groupe + notes;
5. préparation du job: 10 s max;
6. claim du code exact retourné: 10 s max;
7. envoi à l’extension: 35 s max;
8. validation stricte du nombre synchronisé;
9. succès seulement avec `activityId`;
10. fermeture du job exact: 10 s max;
11. rafraîchissement de statut non bloquant après succès.

En cas d’échec, la fermeture du job exact est bornée à 5 s lorsqu’elle est possible.

L’importeur Formative ne doit jamais modifier cette séquence.

## Namespaces déjà occupés

### Mozaïk

Sources `window.postMessage` réservées:

- `cardinal-mozaik-console`
- `cardinal-mozaik-extension`

Messages réservés, entre autres:

- `MOZAIK_EXTENSION_READY`
- `MOZAIK_EXTENSION_PING`
- `MOZAIK_EXTENSION_SHOW_PROGRESS`
- `MOZAIK_EXTENSION_PROGRESS`
- `MOZAIK_EXTENSION_SYNC`
- `MOZAIK_EXTENSION_RESULT`
- `SHOW_MOZAIK_SYNC_UI`
- `START_MOZAIK_SYNC`

### Formative / Gestion des notes

Sources réservées:

- `cardinal-formative-console`
- `cardinal-formative-extension`

Messages réservés:

- `FORMATIVE_EXTENSION_PING`
- `FORMATIVE_EXTENSION_REQUEST`
- `FORMATIVE_EXTENSION_READY`
- `FORMATIVE_EXTENSION_RESULT`
- `FORMATIVE_REQUEST`
- `FORMATIVE_IMPORT_AVAILABLE`
- `FORMATIVE_CHATGPT_FEEDBACK_AVAILABLE`

Clés sessionStorage existantes à ne pas réutiliser pour l’importeur de questions:

- `pending_formative_import`
- `pending_formative_chatgpt_feedback`
- `cardinal_global_formative_import`

L’importeur v2 utilise son propre espace de noms:

- messages runtime: `CARDINAL_FORMATIVE_IMPORT_*`
- sources de page: `cardinal-formative-import-*`
- stockage persistant/session v2 existant: `cardinal.formative.v2.*`
- IDs DOM: `cardinalFormativeImport*`

Le préfixe de stockage `cardinal.formative.v2.*` est volontairement conservé: `session-store-v2.js`, `baseline-store-v2.js` et `persistence-v2.js` l’utilisent déjà. Le renommer pendant la fusion pourrait rendre invisibles des baselines ou journaux de reprise valides.

La règle de cohabitation est testée dans `v2/host-compat-v2.test.js`.

## Comportement Formative → Gestion à préserver

Gestion des notes possède déjà un autre sens du mot « import »:

- associer un travail Gestion à un Formative;
- importer le résultat global ou certaines questions déjà corrigées;
- éventuellement renvoyer des notes vers Formative;
- conserver des rétroactions ChatGPT/Formative;
- synchroniser ensuite vers Mozaïk lorsque l’utilisateur le demande.

Ce workflow utilise notamment:

- `#formativeImportDialog`
- `#formativeQuestionList`
- `#formativeDestination`
- `#formativeImportGrades`
- `#formativePullBtn`
- `#formativePushBtn`
- `#confirmFormativeImport`

L’importeur **ChatGPT → création/modification des questions Formative** ne doit pas réutiliser ces IDs ni injecter son UI dans la page Gestion des notes.

## Nouveau comportement de sécurité observé dans Gestion des notes

Quand la destination est un travail Gestion déjà existant, l’interface permet maintenant une **association sans toucher aux notes**.

Le contrôle `#formativeImportGrades` détermine si les notes corrigées dans Formative peuvent remplacer les notes locales. Lorsqu’il est désactivé pour un travail existant:

- l’association Formative est enregistrée;
- aucune note Gestion n’est modifiée;
- la synchronisation Mozaïk est désactivée pour cette opération;
- le bouton devient « Associer sans toucher aux notes ».

Ce comportement est une garantie UX et doit survivre à la fusion de l’importeur.

## Résultat global

Le module `formative-global-v01.js` traite `FORMATIVE_IMPORT_AVAILABLE` avec `globalImport` et présélectionne les questions déjà notées pour former une seule note globale. Il ajoute aussi les raccourcis « Sélectionner tout » et « Sélectionner les questions corrigées ».

L’importeur de questions ne doit pas produire `FORMATIVE_IMPORT_AVAILABLE`: ce message appartient au flux **Formative → Gestion**, pas au flux **ChatGPT → Formative**.

## Règles de cohabitation de l’extension fusionnée

1. Le routeur du service worker doit **déléguer/ignorer tout message qu’un module ne possède pas**. Aucun handler importeur catch-all.
2. Les modules importeur ne sont injectés que dans les rôles `chatgpt` et `formative-editor`.
3. Ils ne s’injectent pas dans la page Gestion des notes simplement parce que la même extension y est active.
4. L’importeur ne touche jamais à `#syncMozaikBtn`, à `cardinalSyncOwner`, ni aux messages `MOZAIK_*`.
5. Les en-têtes/session Formative de l’importeur restent dans `chrome.storage.session` et dans le namespace v2 prévu. Ils ne doivent jamais écraser le bearer Mozaïk, les tokens Gestion ou les files de jobs Mozaïk.
6. Sur Formative, un `MutationObserver` importeur peut observer pour détecter sa cible ou maintenir **sa propre UI possédée**, mais ne doit pas réécrire le DOM applicatif de Formative.
7. Le workflow correction ChatGPT → notes/commentaires Formative reste indépendant du workflow ChatGPT → structure de questionnaire Formative.
8. Les états d’un importeur interrompu (journal/baseline/reprise) ne peuvent jamais déclencher automatiquement une synchronisation Mozaïk.
9. Une création/modification de questionnaire ne doit pas modifier les notes d’élèves existantes, les paramètres d’un travail Gestion ou l’association Formative/Gestion sans action explicite dédiée.
10. Une future migration de stockage doit être additive et versionnée; aucune clé historique n’est renommée/supprimée silencieusement.
11. En production, les mutations de questionnaire doivent passer par `server-stack-v2.js`: ce point de composition n’expose pas les primitives GraphQL brutes et place `mutation-input-guard-v2.js` devant le gateway.

## Angles morts de fusion à tester

Avant promotion dans Cardinal principal:

- Gestion ouverte pendant un import de questions;
- Formative ouvert dans plusieurs onglets;
- synchronisation Mozaïk en cours pendant qu’un package ChatGPT est détecté;
- correction d’élève Formative en cours pendant qu’un autre onglet édite le questionnaire;
- redémarrage du service worker pendant chacun de ces workflows;
- ancien message `FORMATIVE_REQUEST` reçu pendant un import v2;
- ancien `FORMATIVE_IMPORT_AVAILABLE` reçu pendant un import v2;
- fermeture de l’overlay importeur sans fermer le panneau de progression Mozaïk;
- aucun listener importeur ajouté à `#syncMozaikBtn`;
- aucun listener Mozaïk ajouté au bouton ChatGPT « Importer dans Formative »;
- session Formative expirée sans suppression des états Mozaïk/Gestion;
- suppression/rechargement de l’extension sans création en double après reprise;
- page Gestion avec le mode « Associer sans toucher aux notes »: aucune régression;
- résultat global Formative: présélection des questions corrigées toujours intacte;
- baselines/journaux v2 existants toujours lisibles après mise à jour de l’extension;
- paquet invalide bloqué avant la toute première requête GraphQL de mutation.

## Incohérence de version à ne pas masquer

Le dépôt contient encore des métadonnées de distribution et un dossier `resultats/mozaik/extension/` historiques qui ne correspondent pas nécessairement au comportement v14 documenté et actuellement chargé par le frontend.

En particulier, le dossier `resultats/mozaik/extension/` ne doit **pas** être utilisé comme source de vérité pour reconstruire l’extension fusionnée tant que le paquet réellement installé/stable n’a pas été identifié et comparé.

La fusion finale doit partir du build Cardinal réellement utilisé, puis y ajouter le module Formative v2. On ne doit pas reconstruire Cardinal à partir d’un ancien manifest simplement parce qu’il est encore présent dans le dépôt.

## Gate avant fusion

La fusion vers l’extension Gestion des notes est bloquée tant que:

- `legacy-primitives-v041.test.js` n’est pas vert;
- `legacy-stack-v2.test.js` n’est pas vert;
- `server-stack-v2.test.js` n’est pas vert;
- `host-compat-v2.test.js` n’est pas vert;
- la CI v2 complète n’est pas verte;
- le build Cardinal hôte exact n’est pas identifié;
- ses messages, permissions, content scripts, stockage et `manifest.key` ont été comparés;
- le smoke test Formative CREATE → UPDATE → UNCHANGED → conflit manuel → reprise incertaine est vert;
- le smoke test Gestion/Mozaïk confirme que v14 et le mode « Associer sans toucher aux notes » sont inchangés.

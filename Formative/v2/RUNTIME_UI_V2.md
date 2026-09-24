# Cardinal Formative v2 - runtime navigateur et UI 0.5.x

Dernière mise à jour: 2026-09-24

Ce document décrit la tranche navigateur réellement embarquée dans `Cardinal-Formative-Importer-STANDALONE-0.5.0-rc1`.

Lire aussi `ENGINEERING_HARDENING.md` pour les invariants de durabilité, de cloisonnement des sessions et de performance qui ne doivent pas être perdus lors d'une refactorisation.

Il faut toujours distinguer deux choses:

- **assemblé et testé en CI**: le code, le manifest, l'identité Chrome, les content scripts, le protocole embarqué et les tests automatisés;
- **prouvé en conditions réelles**: les smoke tests ChatGPT + Formative qui restent la prochaine gate avant de remplacer 0.4.1.

## Chaîne actuelle

```text
Réponse ChatGPT ou document pertinent (PDF, DOCX, autre)
  -> Copier le prompt Formative, puis coller dans ChatGPT
  -> consigne Cardinal compacte dans le message courant
  -> réponse assistant ChatGPT
  -> package-parser-v2.js
  -> chatgpt-scanner-v2.js
  -> chatgpt-content-v2.js
  -> chatgpt-correction-audit-v2.js
  -> runtime-message-router-v2.js
  -> service-worker-bridge-v2.js
  -> browser-controller-v2.js
  -> target-enumerator-v2.js / target-selector-v2.js
  -> extension-app-v2.js
  -> production-stack-v2.js
  -> runtime/orchestrator/preflight/executor
  -> Formative
```

La progression suit le chemin inverse sans exposer les objets techniques:

```text
progress-v2.js
  -> progress-relay-v2.js
      -> onglet ChatGPT exact
      -> onglet Formative exact
  -> formative-progress-content-v2.js
```

## Préparer pour Formative

`chatgpt-prepare-helper-v2.js` est inclus dans la RC.

Le bouton copie la consigne compacte dans le presse-papiers. Le professeur la colle à la fin de son brouillon, ou dans un message vide pour utiliser la dernière source pertinente. L'extension ne modifie pas le texte déjà saisi et ne joint pas le long protocole Markdown.

La limite protège la consigne ajoutée par Cardinal; un examen déjà saisi par le professeur n'est pas rejeté à cause de sa longueur. La copie échoue avec un message visible si le presse-papiers est refusé. Un marqueur Cardinal déjà présent dans le brouillon empêche une deuxième copie accidentelle.

### Coût navigateur

ChatGPT peut produire de nombreuses mutations DOM pendant le streaming.

Le helper regroupe maintenant les signaux `MutationObserver`, `resize` et `scroll` en un seul recalcul de position par frame. Le premier placement reste immédiat, mais une rafale de changements n'entraîne plus une rafale équivalente de `getBoundingClientRect()`.

Ce comportement est couvert par test automatisé.

## Paquet ChatGPT

Le seul paquet accepté est:

- sentinelle `CARDINAL_FORMATIVE_PACKAGE_V2`;
- `schema: cardinal.formative/2`;
- `protocolVersion: 2.0.0`;
- un seul objet JSON complet;
- `packageMode: full|patch`.

`package-parser-v2.js` bloque explicitement:

- JSON incomplet;
- JSON invalide;
- mauvaise enveloppe/protocole;
- plusieurs sentinelles dans un même bloc;
- plusieurs objets JSON valides dans un même bloc;
- plusieurs paquets valides concurrents dans la même réponse;
- bloc trop volumineux.

`chatgpt-scanner-v2.js` ne rend exécutable qu'un paquet dont la provenance **assistant** est prouvée. Un paquet collé dans un message utilisateur, dans un article au rôle ambigu ou dans une structure DOM sans preuve d'auteur est ignoré.

## Barre ChatGPT

`chatgpt-content-v2.js`:

- masque le bloc technique seulement après détection;
- place la barre après le dernier tableau de validation qui précède le paquet;
- conserve seulement la version la plus récente d'une même évaluation dans le chat;
- calcule une signature locale du paquet pour que le X masque seulement cette version;
- stocke uniquement les signatures masquées, jamais le paquet;
- effectue un PREPARE/dry-run avant d'offrir une mutation;
- affiche un sélecteur si plusieurs Formative modifiables sont ouverts;
- exige un geste de vérification avant d'acquitter des avertissements;
- fait un REPREPARE avant un réimport, jamais un replay direct de l'ancien plan;
- n'utilise jamais `innerHTML` avec le contenu du paquet;
- traite les variantes connues de contexte Chrome invalidé et limite le rechargement automatique.

Une réponse incomplète pendant le streaming bénéficie d'un court délai avant d'afficher une erreur afin d'éviter un faux échec pendant que ChatGPT écrit encore le JSON.

## Audit du corrigé

`chatgpt-correction-audit-v2.js` expose le corrigé réel que Cardinal prévoit transmettre à Formative.

But:

- permettre une vérification pédagogique avant mutation;
- rendre visibles type, points, mode de correction et réponses/keywords;
- éviter qu'une transformation technique invisible modifie le sens attendu.

Le build CI vérifie explicitement la présence de cet audit dans la RC.

## Messages runtime possédés

Le routeur v2 possède exactement:

- `CARDINAL_FORMATIVE_IMPORT_PREPARE`;
- `CARDINAL_FORMATIVE_IMPORT_APPLY`;
- `CARDINAL_FORMATIVE_IMPORT_REPREPARE`;
- `CARDINAL_FORMATIVE_IMPORT_RECONCILE`;
- `CARDINAL_FORMATIVE_IMPORT_DISMISS`;
- `CARDINAL_FORMATIVE_IMPORT_STATUS`.

Il ne possède pas les messages Mozaïk, les anciens messages Formative/Gestion des notes ni un futur message simplement parce qu'il commence par `CARDINAL_FORMATIVE_IMPORT_`.

Les réponses runtime sont filtrées. Aucun paquet complet, journal, client GraphQL, snapshot serveur ou objet interne de mutation ne doit ressortir vers le content script.

## Provenance d'une commande

`service-worker-bridge-v2.js` exige:

- une commande ChatGPT provenant réellement de `chatgpt.com` ou `chat.openai.com`;
- l'ID exact de l'onglet émetteur;
- une page d'extension de la même extension pour les commandes de contrôle;
- aucune commande d'écriture provenant du content script Formative.

Si l'onglet ChatGPT ne peut pas être identifié, l'opération est bloquée avant le contrôleur.

## Session Formative

La RC charge:

- `formative-session-main-v2.js` dans le monde MAIN au `document_start`;
- `formative-session-content-v2.js` dans le monde isolé;
- `session-capture-bridge-v2.js` et `session-bootstrap-v2.js` côté service worker.

Principes:

- capture locale seulement;
- whitelist stricte des en-têtes nécessaires;
- stockage des secrets uniquement dans `chrome.storage.session`;
- aucune session/token/header dans baseline, journal ou historique;
- bootstrap contrôlé lorsque nécessaire;
- session absente/expirée -> erreur explicite plutôt qu'invention d'état.

### Cloisonnement par onglet

Une session v2 appartient désormais à son onglet exact:

`cardinal.formative.v2.session.tab.<tabId>`

Un record sans `tabId` prouvé est refusé. L'ancien record global n'est jamais promu vers un onglet, parce que sa provenance ne peut pas être démontrée.

Toute opération gateway est enveloppée dans le scope du `targetTabId` sélectionné. Les lectures de permission, snapshots, mutations et vérifications consomment donc la session du même onglet.

Deux onglets avec deux sessions différentes sont couverts par test automatisé. Un appel serveur sans onglet explicite est bloqué avant GraphQL avec `mutationMayHaveCommitted=false`.

Les scopes de session sont sérialisés pour que les primitives 0.4.1 imbriquées ne puissent jamais changer de session active au milieu d'une opération.

### Provenance de capture passive

Le chemin MAIN world reste prioritaire.

Le fallback `webRequest` ne capture que si:

- l'URL est un endpoint GraphQL Formative attendu;
- le `tabId` est valide;
- `initiator`, `documentUrl` ou `originUrl` prouve une page HTTPS `app.formative.com`.

Une requête dont l'origine n'est pas prouvée est ignorée plutôt que transformée en session implicite.

Quand un onglet ferme, seule la session volatile de cet onglet est supprimée. Les sessions des autres onglets restent intactes.

## Cible Formative

`target-enumerator-v2.js`, `target-selector-v2.js` et `extension-app-v2.js` gèrent la sélection et la revalidation de cible.

Cas bloqués:

- aucun Formative modifiable ouvert;
- plusieurs cibles sans choix explicite;
- onglet fermé;
- onglet qui n'affiche plus une évaluation;
- onglet passé à une autre évaluation;
- permission/identité serveur incompatible;
- cible modifiée après PREPARE sans relecture;
- session manquante pour l'onglet explicitement choisi.

Une URL seule n'est jamais considérée comme une permission d'écriture, et une session d'un autre onglet n'est jamais utilisée comme fallback.

## Progression sans fuite inter-onglets

`progress-relay-v2.js` maintient une liaison volatile:

```text
runId -> ChatGPT tab exact + Formative tab exact
```

Règles:

- jamais de diffusion à tous les onglets ChatGPT/Formative;
- un second chat ne vole pas la progression d'un run déjà lié;
- une commande du popup n'hérite pas du dernier chat connu;
- fermeture d'un onglet -> suppression de sa route;
- mémoire bornée des anciens runs;
- échec d'affichage dans un onglet détaché ne fait jamais échouer ou rejouer une mutation;
- `detail` est filtré à une petite allow-list UI;
- Authorization, journal, paquet et réponse serveur ne passent jamais par cette voie.

Le nettoyage de progression et le nettoyage de session utilisent deux listeners `tabs.onRemoved` indépendants. Leur coexistence et leur détachement sont couverts par test.

## Progression dans Formative

`formative-progress-content-v2.js`:

- écoute uniquement `CARDINAL_FORMATIVE_IMPORT_PROGRESS`;
- exige `schema: cardinal.progress/1` et `module: formative`;
- n'émet aucune commande;
- affiche une UI Cardinal possédée en bas à droite;
- respecte l'ordre monotone de `progress-v2.js`;
- masque automatiquement les états terminaux après un délai;
- ne réécrit jamais le DOM applicatif Formative.

## Popup de récupération

`popup-v2.html` et `popup-v2.js` sont inclus dans le manifest de la RC.

Le popup sert aux cas où le content script n'est pas le bon endroit pour guider le prof:

- diagnostic de session;
- récupération/reprise;
- relance de scan UI;
- état compréhensible sans exposer de secrets.

Les diagnostics de session n'exposent que des métadonnées sûres: disponibilité, onglets, âge et présence booléenne des catégories d'en-têtes. Ils ne retournent pas les valeurs Authorization/session/user ID.

Le popup ne doit jamais contourner les garde-fous du runtime ou muter Formative directement.

## Concurrence et boutons périmés

Deux niveaux protègent la concurrence:

1. `browser-controller-v2.js`: un nouveau PREPARE invalide le token UI précédent et un double clic APPLY ne lance pas deux exécutions;
2. `run-gate-v2.js`: une seule exécution peut posséder un `targetFormativeId` donné à la fois.

Le scope de session ajoute une troisième protection technique: deux opérations provenant d'onglets Formative différents ne partagent jamais simultanément une session active dans la pile legacy.

Un bouton provenant d'une ancienne réponse ne peut donc pas muter la cible du paquet plus récent.

## Redémarrage du service worker

Le token UI du contrôleur est volontairement volatil.

Après un redémarrage:

- `STATUS` peut retourner `idle` si aucun état volatile n'existe;
- le content script doit refaire PREPARE;
- baseline/journal/historique persistent dans `chrome.storage.local`;
- sessions Formative persistent uniquement dans `chrome.storage.session` selon le cycle de vie Chrome et restent séparées par `tabId`;
- un journal incomplet déclenche la logique de reprise serveur, pas un replay.

## Build réel de la RC

`build-extension-v2.py` construit:

`Cardinal-Formative-Importer-STANDALONE-0.5.0-rc1.zip`

Le manifest produit:

- conserve la `manifest.key` historique 0.4.1;
- utilise `background-v2.js`;
- charge les scripts ChatGPT, session Formative et progression;
- définit `popup-v2.html` comme popup;
- expose `CARDINAL_FORMATIVE_PROTOCOL_V2.md` aux hôtes ChatGPT.

La CI vérifie explicitement:

- reconstruction 0.4.1 et identité historique;
- syntaxe et tests v2;
- fichiers réellement référencés par le manifest;
- popup;
- audit du corrigé;
- session MAIN world;
- scripts d'entrée ChatGPT/Formative;
- protocole embarqué et version 2.0.0;
- `web_accessible_resources` du protocole;
- correspondance exacte et ordonnée entre les modules service worker du builder et ceux réellement importés par `background-v2.js`.

`asset-wiring-v2.test.js` protège ce dernier invariant afin qu'un module testé dans le dépôt ne puisse pas être oublié dans le ZIP, et inversement.

Toute modification de `../CHATGPT_GENERATOR_PROMPT_V2.md` doit déclencher cette CI, puisque ce fichier devient un asset de la RC.

## Compatibilité Gestion des notes / Mozaïk

Toujours conserver:

- `#syncMozaikBtn` propriétaire v14;
- les messages `MOZAIK_*` existants;
- les anciens messages Formative -> Gestion;
- les clés de stockage Gestion existantes;
- le mode **Associer sans toucher aux notes**;
- le résultat global et la présélection des questions déjà corrigées.

L'importeur de questions n'injecte pas son UI dans Gestion des notes.

Ne pas fusionner la 0.5.x au Cardinal principal avant d'avoir identifié le build Gestion des notes réellement utilisé.

## État au 21 septembre 2026

Déjà codé et couvert par la CI:

- protocole embarqué et bouton Préparer pour Formative;
- parser v2 robuste;
- scanner ChatGPT fail-closed;
- placement de la barre sous le tableau;
- audit du corrigé;
- popup;
- routeur runtime exact;
- contrôleur navigateur et token périmé;
- sélecteur de cible;
- verrou par Formative;
- relais de progression lié aux onglets exacts;
- bridge service worker;
- composition navigateur `extension-app-v2`;
- production stack;
- capture/bootstrap de session;
- cloisonnement strict des sessions par onglet;
- refus d'un appel GraphQL sans `targetTabId`;
- provenance stricte du fallback `webRequest`;
- nettoyage de session à la fermeture d'un onglet;
- coexistence des listeners de cycle de vie;
- barre ChatGPT v2;
- coalescence des recalculs de layout du helper ChatGPT;
- overlay Formative v2;
- garde anti-dérive builder/runtime pour les assets service worker;
- build RC installable avec identité 0.4.1 conservée;
- détection du protocole limitée au composeur actif.

## Gate restante avant remplacement de 0.4.1

Les tâches suivantes nécessitent maintenant une vraie session ChatGPT/Formative ou des probes réelles:

1. smoke test shortAnswer `CREATE -> VERIFY -> UPDATE -> UNCHANGED`;
2. même test longAnswer;
3. même test FITB;
4. modification manuelle entre PREPARE et APPLY -> blocage;
5. perte de réponse/timeout après mutation -> reprise sans doublon;
6. Formative déjà rempli -> rapprochement explicite;
7. plusieurs onglets Formative, idéalement avec sessions/comptes distincts -> sélection et cloisonnement réels;
8. redémarrage du service worker et reprise d'un journal incomplet;
9. nouveau chat/autre compte;
10. probes Keyword réels: sous-chaîne, ponctuation, accents, casse, termes imbriqués, plusieurs matches;
11. UX réelle des erreurs de session/cible/source;
12. seulement après réussite: considérer la 0.5.x comme remplaçante du fallback 0.4.1;
13. ensuite seulement: intégration au Cardinal principal après audit du build Gestion des notes installé.

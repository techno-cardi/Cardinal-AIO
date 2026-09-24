# Cardinal Formative v2 - invariants de durcissement

Dernière mise à jour: 2026-09-21

Ce document complète `README.md` et `RUNTIME_UI_V2.md`. Il conserve les décisions d'ingénierie qui ne doivent pas être perdues lors d'une future refactorisation ou de la fusion dans l'extension Cardinal principale.

Objectifs permanents:

- sûreté avant mutation;
- simplicité pour le prof;
- code lisible et testable;
- coût navigateur raisonnable;
- reprise déterministe après incident;
- aucun secret ou état ambigu réutilisé par commodité.

## 1. Une session Formative appartient à un onglet exact

Une session Formative v2 n'est jamais considérée comme globale au navigateur.

Stockage:

`cardinal.formative.v2.session.tab.<tabId>`

Chaque capture contient son `tabId`. Un record sans onglet explicite est refusé.

Pourquoi:

- deux onglets Formative peuvent être ouverts en même temps;
- les deux onglets peuvent théoriquement représenter des comptes ou sessions différents;
- la dernière requête observée ne doit jamais devenir implicitement la session de toutes les cibles.

Invariant:

> Toute lecture ou mutation GraphQL doit utiliser uniquement la session capturée depuis l'onglet Formative explicitement sélectionné pour cette opération.

L'ancien draft global `cardinal.formative.v2.session` n'est jamais migré vers un onglet, car sa provenance ne peut pas être prouvée. Il peut seulement être supprimé.

## 2. Le scope de session enveloppe le gateway gardé

Les primitives 0.4.1 prouvées ne sont pas réécrites simplement pour leur ajouter un `tabId` à chaque fonction interne.

À la place:

`gateway gardé -> withTabScope(targetTabId) -> primitives 0.4.1 -> GraphQL client`

Le scope couvre toute l'opération, incluant les lectures de permission, snapshots, mutation et vérification.

Les scopes sont sérialisés. Cela empêche deux opérations de deux onglets différents de changer de session active au milieu d'une séquence legacy imbriquée.

Ce choix est volontaire:

- un import Cardinal est déjà transactionnel et séquentiel;
- la sérialisation ne pénalise donc pas le chemin normal;
- elle évite une réécriture risquée des primitives stables;
- elle rend l'invariant de session simple à tester.

Ne pas remplacer cette sérialisation par un état global concurrent sans refaire la preuve complète de toutes les primitives.

## 3. Capture de session: MAIN world prioritaire, webRequest seulement en fallback

La capture via `formative-session-main-v2.js` + `formative-session-content-v2.js` est le chemin principal.

Le fallback `webRequest` est fail-closed:

- `tabId` navigateur valide requis;
- URL `https://svc.goformative.com/graphql/...` requise;
- `initiator`, `documentUrl` ou `originUrl` doit prouver une page HTTPS `app.formative.com`;
- absence de provenance explicite -> aucune capture passive.

Une capture passive moins fiable ne doit jamais élargir silencieusement la confiance uniquement pour augmenter le taux de réussite.

Le bootstrap contrôlé reste préférable à une session d'origine incertaine.

## 4. Cycle de vie d'un onglet

Quand un onglet ferme:

- `progress-relay-v2.js` retire sa route de progression;
- `session-capture-bridge-v2.js` supprime la session volatile liée à son `tabId`;
- les autres onglets et leurs sessions restent intacts.

Quand un onglet commence à charger un nouveau document (`tabs.onUpdated` avec `status: loading`):

- sa session précédente est invalidée immédiatement;
- un simple changement de titre ou l'état `complete` ne vide pas la session;
- le nouveau document Formative doit recapturer ses propres en-têtes avant utilisation serveur.

Ce nettoyage couvre notamment reload, navigation, logout/login ou changement de compte dans le même onglet. Il évite qu'un `tabId` correct soit associé temporairement à une session devenue historique.

Les listeners `tabs.onRemoved` et `tabs.onUpdated` doivent coexister avec ceux du bootstrap et de la progression. Les tests simulent plusieurs listeners, comme Chrome réel.

## 5. Aucun appel serveur sans cible d'onglet

Le server stack bloque tout appel gateway qui ne possède pas un `targetTabId` explicite.

Erreur attendue:

`SESSION_TAB_BINDING_REQUIRED`

La requête est bloquée avant GraphQL et `mutationMayHaveCommitted=false`.

Une session présente ailleurs dans `chrome.storage.session` ne constitue jamais un fallback implicite.

## 6. Les diagnostics ne doivent pas devenir une fuite de secrets

Les diagnostics de session peuvent exposer:

- disponibilité;
- `tabId`;
- âge de la capture;
- noms des en-têtes présents;
- présence booléenne de Authorization/session/user ID.

Ils ne doivent pas exposer:

- valeur Authorization;
- token;
- session ID;
- user ID;
- cookie;
- paquet ou réponse serveur brute.

## 7. Le builder et le runtime doivent charger exactement la même pile

`asset-wiring-v2.test.js` compare automatiquement:

- `SERVICE_WORKER_FILES` dans `build-extension-v2.py`;
- `CORE_SCRIPTS` de `background-v2.js` + `background-v2.js` lui-même.

Les deux listes doivent être identiques et dans le même ordre.

But:

- éviter qu'un nouveau module soit testé dans le dépôt mais absent du ZIP;
- éviter qu'un ancien module soit encore embarqué par erreur;
- détecter les dépendances ou doublons avant publication d'une RC.

Ne pas supprimer ce test au profit d'une vérification manuelle du manifest.

## 8. ChatGPT: ne pas faire un layout complet à chaque mutation DOM

ChatGPT peut générer de nombreuses mutations DOM pendant le streaming d'une réponse.

`chatgpt-prepare-helper-v2.js` regroupe désormais:

- MutationObserver;
- `resize`;
- `scroll`;

en un seul repositionnement par frame via `requestAnimationFrame` avec fallback contrôlé.

Invariant performance:

> Une rafale de signaux avant la prochaine frame ne doit provoquer qu'un seul recalcul de position du bouton.

Le premier placement au démarrage reste immédiat.

Cela conserve une UI réactive sans multiplier inutilement `getBoundingClientRect()`.

## 9. Optimiser sans contourner les garde-fous

Les optimisations acceptables réduisent:

- scans DOM redondants;
- lectures de layout;
- copies inutiles;
- artefacts de build divergents;
- états volatils périmés.

Elles ne doivent jamais réduire:

- relecture serveur avant mutation;
- vérification après mutation;
- diff à trois états;
- verrou de cible;
- vérification du `targetTabId`;
- journal transactionnel;
- traitement UNCERTAIN;
- sélection explicite en cas d'ambiguïté.

La rapidité recherchée est celle du chemin sûr, pas celle obtenue en supprimant une preuve nécessaire.

## 10. Couverture automatisée minimale à conserver

Les tests doivent continuer à prouver au minimum:

- deux onglets, deux sessions différentes, aucune fuite croisée;
- appel sans onglet bloqué avant GraphQL;
- fermeture d'un onglet ne supprime pas la session d'un autre;
- reload/navigation invalide l'ancienne session avant recapture;
- changement de titre/état `complete` ne vide pas inutilement la session;
- bootstrap reload et nettoyage de session coexistent sans replay de commande;
- vieux record global non migré;
- provenance `webRequest` ambiguë refusée;
- coexistence des listeners de cycle de vie;
- façade production transmet le `tabId` aux diagnostics/effacements;
- builder et runtime ont les mêmes modules;
- rafale DOM ChatGPT coalescée en un layout par frame.

Ces tests automatisés ne remplacent pas les smoke tests réels. La matrice réelle doit encore couvrir plusieurs onglets, idéalement avec des états de session distincts, avant promotion de 0.5.x.

## 11. Règle pour les futures refactorisations

Avant de simplifier une couche, répondre à ces questions:

1. Quelle ambiguïté cette couche empêchait-elle?
2. Le nouvel état peut-il provenir du mauvais onglet, du mauvais Formative ou d'un ancien run?
3. Une mutation peut-elle avoir été committée si l'appel échoue?
4. Le comportement est-il couvert par un test qui échouerait si l'invariant disparaissait?
5. La simplification conserve-t-elle la même identité Chrome et le même fallback 0.4.1?
6. Touche-t-elle Gestion des notes, Mozaïk ou le mode `Associer sans toucher aux notes`?

En cas de doute, bloquer ou relire plutôt qu'inférer.

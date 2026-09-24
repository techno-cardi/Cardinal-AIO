# Cardinal AIO - matrice de compatibilité avec les extensions séparées

Date : 2026-09-23

## Principe

La cible AIO doit fournir les mêmes capacités utiles que l'installation séparée :

- Gestion des notes 1.1.9
- Correction Formative historique 1.1.3
- Pont ChatGPT historique 1.1.9
- Mozaïk v14 / UI 1.1.6
- Importateur Formative v2 0.5.0-rc1
- Pont Classroom 1.2.3

Une fusion n'est considérée compatible que si les contrats des extensions séparées restent présents et qu'aucune collision créée par le partage du même ID d'extension, du même service worker, du même monde isolé ou du même chrome.storage n'est détectée.

## Gate automatisée obligatoire avant publication

Le builder de production doit échouer avant de produire le ZIP si un seul des contrôles suivants échoue.

| Domaine | Contrôle |
| --- | --- |
| Baseline Gestion | ZIP exact 1.1.9, SHA-256 `b8ef9a94cb9f55aca5957371ba239c67efdff943aa457b5aeed56afd005f69d7` |
| Sources Formative | arbre Git exact `b5546e6d4536bee2a2bf2da0d89e1bf842a14788` |
| Source Classroom | commit exact `6887bfa2e8afd523a38a0e3286aa1f826276b8c5` |
| Dérive Gestion | moteurs historiques inchangés byte pour byte |
| Manifest | permissions, hôtes, content scripts et ressources Formative/Classroom préservés |
| Identité | aucune `manifest.key` Formative standalone héritée dans l'AIO |
| Worker | ordre Gestion -> Classroom -> Formative v2 |
| Boot worker | boot réel du service worker fusionné dans le harness Node |
| Runtime | message inconnu 0 propriétaire, Formative v2 1 propriétaire, Classroom 1 propriétaire |
| Formative v2 | tous les `Formative/v2/*.test.js` rejoués dans la CI AIO |
| GraphQL | `/graphql`, query string et sous-chemin reconnus; faux préfixe rejeté |
| Sessions | invalidation au rechargement et isolation par onglet |
| Content scripts | concaténation de validation par hôte et monde Chrome, puis `node --check` |
| Namespaces | collisions globales explicites entre extensions séparées interdites |
| DOM | collisions d'ID DOM entre moteurs partageant le même hôte interdites |
| Stockage | collisions de clés chrome.storage entre anciennes extensions interdites |
| Popup | commandes historiques Gestion conservées, dont `Préparer une correction` |
| Popup AIO | six modules RC2 présents dans un Shadow DOM |
| Popup Formative | `Analyser cette page ChatGPT` et `Réafficher les barres masquées` restaurés |
| Popup scope | scripts popup historiques + `aio-popup.js` validés ensemble contre collisions |
| Classroom | types génériques remplacés par `PDC_NATIVE_*`, aucun ancien type restant |
| Classroom groupes | groupes futurs explicites, dont 42, acceptés |
| Classroom polling | chemins de secours bornés et transformation fail-closed |
| Sources obsolètes | 0.9.x, `chatgpt-ui.js`, `popup-v2.js`, `banner-autodismiss.js` interdits dans le ZIP |
| Sécurité build | aucune permission/hôte générique non prévu |
| Reproductibilité | mêmes octets d'entrée = même ZIP |
| Publication | ZIP et métadonnées remplacés seulement après toutes les validations |

## Parité fonctionnelle attendue

### Gestion des notes

1. Ouvrir Gestion normalement.
2. Vérifier les fonctions habituelles de notes et de correction.
3. Vérifier que le popup conserve les commandes historiques.
4. Vérifier que l'ajout du dashboard AIO ne modifie aucun sélecteur ou style historique.

### Correction ChatGPT historique

1. Ouvrir plusieurs conversations ChatGPT existantes.
2. Naviguer entre elles sans erreur de chargement.
3. Préparer une correction avec le flux 1.1.9.
4. Vérifier que l'UI historique apparaît une seule fois.
5. Recharger la conversation et vérifier l'absence de duplication.
6. Naviguer vers une conversation sans paquet Formative et vérifier qu'aucune UI v2 parasite n'apparaît.

### Correction Formative historique

1. Ouvrir un Formative existant.
2. Vérifier sa détection depuis Gestion/ChatGPT.
3. Utiliser `Préparer une correction`.
4. Vérifier l'aperçu avant publication.
5. Publier un petit test.
6. Vérifier la relecture serveur après écriture.
7. Vérifier le score, le commentaire et les commentaires partiels.
8. Vérifier un lot multiquestions.
9. Vérifier qu'une association Formative -> Gestion avec import de notes désactivé ne modifie aucune note et ne déclenche aucune synchro Mozaïk.

### Importateur Formative v2

1. Sur ChatGPT, vérifier `Préparer pour Formative`.
2. Vérifier l'ajout unique du protocole v2.
3. Générer un petit paquet valide.
4. Vérifier la barre d'import et le corrigé préparé.
5. Vérifier le dry-run.
6. Appliquer l'import.
7. Vérifier la relecture serveur et l'état terminal.
8. Rejouer l'import pour vérifier l'idempotence/réconciliation.
9. Masquer la barre, puis utiliser `Réafficher les barres masquées` dans le popup AIO.
10. Utiliser `Analyser cette page ChatGPT` et vérifier qu'aucune duplication n'apparaît.

### Mozaïk v14

1. Utiliser un petit lot contrôlé.
2. Vérifier la préparation.
3. Vérifier l'écriture des notes.
4. Vérifier le résultat final avant de fermer le statut.
5. Vérifier l'absence de double clic/double synchronisation.
6. Vérifier qu'un flux Formative qui ne demande pas Mozaïk n'en déclenche pas.

### Classroom

1. Ouvrir le Générateur/Agenda.
2. Laisser les groupes Classroom se réapprendre dans le stockage AIO.
3. Vérifier un groupe historique.
4. Vérifier un groupe futur explicite, par exemple 42.
5. Publier une annonce courte.
6. Vérifier le collage riche.
7. Vérifier la publication visible dans le flux.
8. Modifier une annonce existante.
9. Vérifier qu'un brouillon existant n'est pas écrasé.
10. Fermer un onglet pendant un test contrôlé et vérifier la récupération du job.

## Cas de coexistence et de reprise

- Pendant le smoke test AIO, les anciennes extensions Cardinal/Formative/Classroom séparées doivent être désactivées pour éviter une double injection provenant de deux IDs d'extension différents.
- Le stockage d'une extension Chrome séparée n'est pas automatiquement partagé avec l'AIO. Les liaisons Classroom doivent donc pouvoir être réapprises proprement.
- La perte du stockage Formative standalone ne doit jamais provoquer une écriture aveugle : le moteur v2 doit repartir de sa lecture serveur, de son dry-run et de sa réconciliation.
- Une invalidation du contexte d'extension dans ChatGPT ne doit provoquer au maximum qu'un seul rechargement protégé par session, jamais une boucle.
- Un rechargement/navigation Formative doit purger les sessions capturées périmées.

## Critère de promotion

Le statut stable n'est permis que lorsque :

1. toutes les gates automatisées passent sur le ZIP construit depuis la vraie baseline 1.1.9;
2. le ZIP réextrait repasse les mêmes validations;
3. toute la matrice live ci-dessus passe dans le Chrome réel du poste;
4. aucun crash de conversation ChatGPT, double UI, double publication ou double synchronisation n'est observé;
5. les extensions séparées restent disponibles uniquement comme rollback jusqu'à la fin de cette validation.

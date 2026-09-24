# Cardinal AIO 1.2.0-rc2 - audit préinstallation

Date : 2026-09-21

## Baselines

- Gestion des notes 1.1.9, ZIP SHA-256 `b8ef9a94cb9f55aca5957371ba239c67efdff943aa457b5aeed56afd005f69d7`
- Mozaïk v14, UI 1.1.6
- correction Formative, bridge 1.1.3
- importateur Formative v2 0.5.0-rc1
- Pont Classroom 1.2.3, commit `6887bfa2e8afd523a38a0e3286aa1f826276b8c5`

## Défauts réels trouvés pendant la révision

1. L'importateur Formative v2 pouvait échouer au démarrage avec `presentation dependency required`. `presentation-v2.js` était oublié à la fois par le worker et le builder, ce qui rendait l'ancien test de câblage insuffisant.
2. Les capteurs Formative v2 ne reconnaissaient pas l'endpoint exact `/graphql`, seulement `/graphql/...`.
3. La correction Formative historique avait le même angle mort sur l'endpoint exact `/graphql`.
4. Le worker Classroom séparé utilisait des types runtime génériques qui pouvaient entrer en collision une fois fusionnés dans l'AIO.
5. Classroom utilisait plusieurs surveillances/pollings évitables et une liste de groupes codée en dur `31/32/51`.
6. Le popup initial présentait trop facilement un module empaqueté comme un module réellement confirmé actif.
7. Plusieurs interfaces avaient des améliorations possibles de focus, d'annonces ARIA, de progression et de contraste.

## Correctifs RC2

- dépendance `presentation-v2.js` chargée et empaquetée;
- vrai test de boot du service worker v2 ajouté à la CI;
- `/graphql` et `/graphql/*` acceptés;
- session Formative invalidée au chargement/navigation afin d'éviter un jeton périmé après changement de compte;
- messages Classroom préfixés `PDC_NATIVE_*`, compatibilité historique limitée aux origines légitimes;
- groupes Classroom futurs détectés uniquement dans des libellés explicites, par exemple `Groupe 42` ou `FRA4SE-42`;
- polling Classroom et ChatGPT réduit, événements et observers filtrés privilégiés;
- popup AIO contextuel et états de santé prudents, neutres tant qu'un module n'est pas réellement confirmé;
- accessibilité renforcée dans Formative, ChatGPT, Mozaïk et Classroom;
- script global Classroom d'auto-fermeture retiré, sa fonction étant assumée directement par le composant qui crée le bandeau.

## Validation finale de l'artefact

Le ZIP final a été construit, réextrait dans un dossier neuf, puis les tests ont été rejoués sur les octets réextraits.

- 76 fichiers dans le ZIP;
- 66 fichiers JavaScript de production, tous valides avec `node --check`;
- 24 références directes du manifest, toutes présentes;
- boot complet du service worker réussi;
- 10 listeners runtime, 5 listeners de fermeture d'onglet, 2 listeners de navigation, 3 capteurs `webRequest` et 1 listener d'alarme s'attachent sans exception;
- chaîne réseau Formative historique + v2 : une seule requête sous-jacente, deux consommateurs, réussi;
- endpoint nu `/graphql`, requête avec query string et sous-chemin `/graphql/*` reconnus, chemin ressemblant `/graphql-evil` rejeté;
- purge des deux sessions Formative au rechargement : réussie;
- ownership des messages runtime : commandes Classroom, Formative v2 et messages inconnus isolés correctement;
- groupe Classroom futur `42` : mémorisation et préparation réussies;
- 66 fichiers JavaScript sur 66 atteignables depuis le manifest, le worker, le popup ou leurs dépendances, aucun script mort détecté;
- aucun `eval`, `new Function`, `document.write`, `debugger`, TODO/FIXME/HACK/XXX détecté;
- permissions du manifest reliées à des API réellement utilisées;
- jetons Formative et Mozaïk conservés dans `chrome.storage.session`, pas dans le stockage persistant;
- popup testé avec son vrai JavaScript dans cinq contextes : générique, Formative, ChatGPT, Classroom sans liaison, Classroom avec liaison;
- 6 modules affichés dans chaque scénario, aucun débordement horizontal;
- contrastes des petits textes corrigés pour atteindre au moins 4,5:1 dans les zones vérifiées;
- Gestion bridge, `formative-network.js` et `formative-stealth.js` demeurent byte pour byte identiques à la RC1.

## Validation GitHub

La CI `Formative v2 tests`, run #221, est verte sur le SHA `42087a03f57654e9dde9a16dc4c726796cd0400e`. Elle inclut le vrai test de boot qui aurait bloqué la RC précédente.

Le correctif MAIN-world pour l'endpoint exact `/graphql` a ensuite été synchronisé sur la branche AIO au commit `7d0159653914b4a20ae69471f3a84b13c44f28ca`.

## Artefact final

`Cardinal-AIO-1.2.0-rc2.zip`

SHA-256 :

`b3c20657461aa43e4aaea7e9c61804821b9793c359fb738e3a030d0f4d35b9c1`

## Limite volontaire

Cette révision ne remplace pas un smoke test dans le vrai Chrome connecté à Formative, Mozaïk, Classroom et Gestion. Le Chromium du conteneur applique une politique administrateur qui bloque le chargement des extensions non empaquetées; il ne peut donc pas fournir cette preuve. La promotion au statut stable doit attendre le test réel sur le poste utilisateur. Les versions séparées restent des rollbacks pendant ce test.
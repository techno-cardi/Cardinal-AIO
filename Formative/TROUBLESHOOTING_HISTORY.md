# Historique des bugs, échecs et pièges Formative

Dernière mise à jour: 2026-09-20

Ce fichier existe pour éviter de répéter des erreurs déjà vécues. Toujours lire `CURRENT_STATE.md` et `MAINTENANCE_PLAYBOOK.md` en parallèle.

## 1. MutationObserver qui gèle Formative

Ancienne expérimentation: un MutationObserver réécrivait le DOM qu'il observait et pouvait s'auto-déclencher jusqu'au gel.

Règle: un observer doit rester lecture seule sur son sous-arbre observé, ou être conçu pour ne jamais réécrire ce qu'il observe.

## 2. Session de correction perdue après fermeture/reload

Ancien symptôme: Cardinal ne retrouvait plus l'identifiant du lot préparé.

Le workflow stable utilise `chrome.storage.session` et un contexte question/session robuste.

Règle: Kevin ne doit jamais recopier un batch ID technique.

## 3. Reload: correction vs import

Pour correction, un reload peut être requis selon le workflow mais l'action doit reprendre.

Pour création/import, v13/v14.1 ont prouvé la synchro live sans reload.

0.3.x a montré un autre cas: après installation/reload d'une extension, une première capture de session peut nécessiter un bootstrap unique. Ce bootstrap ne doit pas devenir un reload à chaque import.

## 4. `Failed to fetch` des anciens prototypes

Les premiers `fetch` directs ont rencontré CORS/transport.

La voie locale actuelle utilise la session native capturée et le transport direct prouvé.

Ne pas revenir au prototype historique simplement parce qu'il est plus court.

## 5. Replay / piggyback / Apollo / SPA sync

Historique v4-v12. Ces voies ont mené à v13 mais ne sont plus l'architecture cible.

## 6. Préflight « Formative vierge »

Protection historique utile en calibration, supersédée par l'upsert.

Règle actuelle: analyser l'existant, ne pas exiger un Formative vide.

## 7. Pondérations redimensionnées après changement du total

Piège critique.

Ordre correct:

1. points maximum;
2. answerChoicePoints;
3. ne plus changer le maximum.

## 7.1 Maximum de question écrasé par une pondération Keyword plus faible

Symptôme observé le 2026-09-25:

- question à 2 points;
- relecture intermédiaire: `points: 2`, `answerChoicePoints: [2, ...]`;
- écriture des pondérations partielles à 1 point;
- relecture finale: `points: 1`, `answerChoicePoints: [1, ...]`;
- Cardinal tombe ensuite en `POSTCONDITION_MISMATCH` et en reprise incertaine.

Cause: dans ce flux Formative, le maximum visible suit le plus grand `answerChoicePoints`.

Correctif:

- ne jamais fabriquer une échelle Keyword où un mot-clé partiel est artificiellement gonflé au maximum;
- pour `auto` et `assisted`, conserver les scores fournis par ChatGPT et, si aucun match n'atteint le maximum, ajouter `expectedAnswer` comme ancre technique de pleine note lorsqu'elle est disponible;
- si ni match exploitable ni `expectedAnswer` ne permet de représenter la correction, bloquer techniquement avant mutation;
- garder l'ordre `points` puis `answerChoicePoints`, et ne plus réécrire `points` ensuite.

## 8. Score Keyword absolu vs somme

Mode prouvé:

`ABSOLUTE_PER_MATCH_NOT_ADDITIVE`

Ne jamais sommer plusieurs mots-clés.

## 9. Mots-clés trop vagues

Une grande banque de réponses ne doit pas sacrifier la précision.

Éviter seuls des termes comme:

- aller;
- voir;
- faire;
- important;
- problème;
- autres mots facilement présents dans une mauvaise réponse.

## 10. Question complexe + mot-clé isolé

Angle mort pédagogique important.

Une question qui demande deux conséquences + explications ne doit pas être considérée entièrement correcte parce qu'un seul bon mot apparaît.

Le futur protocole v2 doit distinguer `auto` et `assisted`.

## 11. Négation contenant un bon mot

Exemple:

`Il n'y a pas eu d'explosion.`

contient `explosion`.

Le Keyword Grading n'est pas une compréhension sémantique complète. Les questions sensibles à la négation/contradiction doivent être assistées ou manuelles.

## 12. Matching: IDs/keys à préserver

La mutation native fiable est:

`MatchingEditableDetailsContainerMutation`

Sur update, préserver les choice keys existantes.

## 13. Matching: formats de labels différents lecture/écriture

Lecture et mutation peuvent exposer des formats différents. Utiliser la mutation native capturée, ne pas extrapoler depuis un fragment de lecture.

## 14. Categorize: préserver ce qui est correct

L'adaptateur spécialisé n'est pas aussi verrouillé que Matching.

Si une structure Categorize existante est déjà correcte, préférer UNCHANGED/preserve à une réécriture risquée.

## 15. Blocs texte/passages déclarés trop tôt non prouvés

Statut corrigé:

- functionalizedText PROVEN;
- TextEditableUpdate PROVEN;
- parent + enfants parentId PROVEN.

Seul un éventuel réglage visuel side-by-side distinct reste partiel.

## 16. Introspection GraphQL

Observée désactivée/non exploitable.

Ne jamais construire le moteur autour de l'introspection.

## 17. HTTP 200 = succès insuffisant

Toujours vérifier erreurs GraphQL, item retourné, champs critiques et état final.

## 18. RubricLevels vide

Ne jamais supposer que `rubricLevels: []` est neutre sur une question à rubrique.

## 19. Fragment GraphQL != adaptateur d'écriture

Voir un champ Drag and Drop, Hot Spot, Graphing, etc. n'est pas une preuve d'écriture.

## 20. IDs de test

Ne jamais coder en dur un ID de diagnostic. Préserver seulement les IDs d'un item réel lorsqu'un update spécialisé l'exige.

## 21. Réécrire un sous-système stable « pour nettoyer »

Ne pas refactorer lourdement un moteur stable sans tests de régression complets.

## 22. Numéro de question ajouté au prompt Formative

Bug UX/pédagogique observé pendant les tests Tchernobyl: le paquet mettait `3)` ou autre numéro dans le prompt alors que Formative numérote déjà.

Règle:

- garder le numéro source en métadonnée;
- retirer la numérotation du prompt Formative.

## 23. Texte source injecté dans Formative alors qu'il est distribué à côté

Erreur de conception observée au début du workflow Tchernobyl.

Règle par défaut:

`sourceMode = external-reference-only`

Le texte sert de source de correction mais n'est pas importé, sauf demande pédagogique explicite.

## 24. Corrigé présent dans le paquet mais pas réellement écrit dans Formative

Ancien piège: un champ `gradingGuide` pouvait exister comme métadonnée sans être exploité par l'adaptateur.

Règle:

La preview doit refléter la correction que l'adaptateur écrit réellement, pas seulement des métadonnées descriptives.

## 25. Trop d'expressions longues dans les réponses acceptées

Kevin veut prioritairement des mots individuels discriminants, nombreux et pertinents.

Exemple attendu:

`demande`, `électrique`, `réseau`, `Kiev`, etc.

Les expressions longues ne doivent être qu'un complément.

## 26. Validation Keyword trop lourde

Une page séparée avec case « je valide les mots-clés » à chaque import a été jugée trop lourde.

Règle produit:

- tableau compact visible;
- `Voir le corrigé` si besoin;
- avertir/bloquer seulement quand nécessaire;
- ne pas exiger une confirmation mécanique répétitive pour chaque banque de mots.

## 27. Barre Cardinal multipliée dans ChatGPT

Les premières versions 0.3.x reconstruisaient la barre à répétition à cause du DOM/MutationObserver de ChatGPT.

Conséquences:

- plusieurs barres;
- progression perdue;
- statut qui oscillait.

Correctif conceptuel:

- signature de paquet;
- conserver la barre si le contenu n'a pas changé;
- dédoublonner;
- ne reconstruire que sur vraie modification.

## 28. X de fermeture masquait tout un assessment

Une version mémorisait seulement `assessment.id`, donc fermer une ancienne barre masquait aussi les futures versions du même questionnaire.

Correctif:

masquage par `assessment.id + signature du paquet`.

## 29. Barre placée au bas de la fenêtre / au-dessus du tableau

Plusieurs approches basées sur `closest([class*=overflow])` ou wrappers génériques de ChatGPT ont mal placé la barre.

Leçon:

- ne pas dépendre d'un wrapper `overflow` générique;
- repérer le tableau qui précède réellement le paquet;
- placer relativement à la branche DOM locale du message.

## 30. Détection ChatGPT trop stricte = aucun bouton, aucun message

0.3.9 pouvait dépendre d'un `pre` dans un message assistant au DOM exact et d'un JSON parfaitement pur.

Symptôme: paquet visible mais aucun bouton.

0.4.0 a durci:

- scan `pre, code`;
- extraction JSON équilibrée;
- fallback message/`article`/ancêtres;
- erreur visible si paquet invalide.

Règle: jamais d'échec silencieux.

## 31. `Extension context invalidated`

Cause: extension rechargée alors que l'onglet ChatGPT conserve un ancien content script.

0.3.8 a commencé à récupérer ce cas.

## 32. `Cannot read properties of undefined (reading 'sendMessage')`

Variante réelle observée du même problème de contexte Chrome invalide.

0.4.1:

- vérifie `chrome.runtime.sendMessage`;
- normalise cette variante;
- recharge ChatGPT une fois;
- garde anti-boucle.

Ne pas traiter seulement la chaîne littérale `Extension context invalidated`.

## 33. Session oubliée quand le service worker dort

Cause identifiée dans 0.3.x: headers uniquement en mémoire.

Correctif:

`chrome.storage.session`.

Un service worker endormi ne doit pas forcer un reload Formative à chaque clic.

## 34. Premier bootstrap de session

Une extension installée après que Formative a déjà effectué ses requêtes ne peut pas observer rétroactivement les headers.

Correctif actuel:

- hooks document_start;
- tentative passive;
- un bootstrap/reload initial contrôlé si nécessaire;
- session ensuite réutilisée.

## 35. Progression invisible parce que la barre ChatGPT était reconstruite

Cause: l'événement progress arrivait sur une ancienne barre retirée du DOM.

Correctif: bar stable par signature + progression également affichée directement dans Formative.

## 36. Progression seulement dans ChatGPT

Kevin préfère voir l'import depuis Formative.

0.3.9+ ajoute un overlay temporaire bas-droite dans Formative.

Conserver cet UX lors de la fusion éventuelle dans Cardinal principal.

## 37. Mapping local perdu lors d'un changement d'identité Chrome

Changer l'ID d'une extension isole le storage et peut perdre les associations item logique -> Formative item.

0.4.0 a ajouté `manifest.key`.

0.4.1 conserve la même clé.

Règle: futures versions dérivées doivent conserver exactement la même clé.

## 38. Mise à jour d'un prompt après perte du mapping

Matching exact du texte insuffisant si le prompt a été modifié.

0.4.1 ajoute un fallback conservateur:

- même subtype;
- similarité forte;
- meilleur candidat nettement supérieur aux autres;
- ambiguïté => ne pas deviner.

Ce mécanisme a permis le test réel Q16 sans duplication.

## 39. Plusieurs onglets Formative

Angle mort à traiter davantage en v2.

Ne pas choisir silencieusement une cible ambiguë. Afficher la cible avant import et avertir si titre/source divergent fortement.

## 40. Import interrompu au milieu

Angle mort futur critique.

0.5.0 doit journaliser item par item et permettre reprise sans recréer ce qui a déjà réussi.

## 41. Double clic / concurrence

Futur 0.5.0: verrou par assessment + Formative cible. Un deuxième import ne doit pas courir en parallèle.

## 42. Suppression d'une question dans une nouvelle version

Ne jamais supprimer automatiquement l'item Formative correspondant.

Afficher suppression proposée à confirmer.

## 43. PDF/scans/images

Une question qui dépend d'une image, figure, graphique ou tableau absent de Formative peut devenir inutilisable.

Futur validateur doit détecter ces dépendances et avertir/bloquer.

## 44. Versions à ne pas confondre

- extension principale Gestion des notes = dépôt vivant `Exercices-francais`;
- labs v4-v18.1 = preuves historiques;
- Builder 0.1.x = prototype historique;
- Importer standalone 0.4.1 = baseline import actuelle;
- futur 0.5.0 = protocole v2, pas encore baseline.

Toujours lire `CURRENT_STATE.md` avant de recommander une version.
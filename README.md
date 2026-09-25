# Cardinal AIO

Dépôt public de développement et d'intégration de Cardinal AIO.

## Contenu

- `Cardinal/AIO/` : assemblage, contrats, audits et tests Cardinal AIO
- `Formative/` : importateur Formative, protocole v2, runtime et tests
- `.github/workflows/` : CI AIO et Formative

## Source de migration

État initial migré depuis `techno-cardi/database`, branche `cardinal/aio-repair-20260923`.

Les données internes AppSP et la documentation privée non liée à AIO ne sont pas copiées dans ce dépôt.

## État courant

Le scanner ChatGPT Formative v2 est conçu pour tolérer plusieurs variantes du DOM ChatGPT et ne dépend plus obligatoirement de `data-message-author-role` ni de `<pre>/<code>`. L'action **Analyser cette page** peut réinjecter automatiquement le bridge v2 lorsqu'un onglet ChatGPT a été ouvert avant le rechargement de l'extension.

Le build public est autonome grâce à la baseline Gestion 1.1.8 user-verified persistée et vérifiée par SHA. Voir `Cardinal/AIO/CURRENT_STATE.md` pour l'état détaillé et les gates de validation.

### RC4

La RC4 ajoute un sélecteur de questions avant l'import ChatGPT → Formative. Un sous-ensemble est importé en mode `patch`, ce qui protège les questions non sélectionnées. Le build vérifie aussi explicitement que l'historique des échanges enseignant/élève reste inclus dans le prompt de correction Formative.

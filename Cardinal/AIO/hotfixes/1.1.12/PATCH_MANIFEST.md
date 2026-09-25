# Patch manifest - 1.1.11 -> 1.1.12 diagnostics

Base build:
- Cardinal AIO 1.2.0 - Formative 1.1.11 GitHub audited
- SHA-256 ZIP de base: 735d5c3534f5b8fbf113b9d10e7fbf41a3d56aa4603ceae5192a8a084d40755f

Build produit:
- Cardinal-AIO-1.2.0-Formative-1.1.12-diagnostics.zip
- SHA-256: 081af8aa7ce978526637144c9069e4634a62241143c0a91ab38795adec022754

Diff exact généré:
- Cardinal-AIO-1.1.11-to-1.1.12-diagnostics.patch
- taille: 75 812 octets
- SHA-256: 8a635ee84fc32a2cbe902b1d6f02a429dfea60c3d6f97d41fb148bba63f30785

Fichiers ajoutés:
- diagnostics.js
- popup-diagnostics.js

Fichiers modifiés:
- service-worker.js
- popup.html
- popup.js
- formative.js
- formative-network.js
- legacy-service-worker.js
- runtime-message-router-v2.js
- chatgpt-content-v2.js
- chatgpt.js
- aio-popup.js
- manifest.json
- README.txt

Invariants:
- aucune mutation Formative n'est effectuée par la couche diagnostic;
- aucun workflow Mozaïk n'est propriétaire de messages diagnostics;
- aucune Authorization/cookie/token n'est exportée volontairement;
- les diagnostics sont dans un namespace dédié CARDINAL_DIAGNOSTIC_* et cardinal.diagnostics.v1.*;
- le mode approfondi modifie uniquement la collecte du diagnostic, jamais la logique métier;
- effacer les diagnostics efface seulement le journal de diagnostic;
- les diagnostics survivent autant que possible à un échec de chargement d'un module métier.

Tests:
- 69/69 JS syntaxiquement valides;
- sanitizer secrets/PII PASS;
- export bundle PASS;
- runtime router isolation PASS;
- service-worker load failure resilience PASS;
- GraphQL success/error/network failure capture PASS;
- popup and service-worker load-order wiring PASS;
- final ZIP re-extraction and syntax PASS.

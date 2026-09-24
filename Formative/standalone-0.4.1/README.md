# Snapshot source - Cardinal Formative Importer Standalone 0.4.1

Date d'archivage: 2026-09-20

Ce dossier conserve la baseline exacte utilisée comme référence après validation du cycle réel:

`CREATE -> UPDATE ciblé -> UNCHANGED`

sans duplication sur le questionnaire Tchernobyl.

## Artefact original

Nom:

`Cardinal-Formative-Importer-STANDALONE-0.4.1.zip`

SHA-256:

`b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4`

Taille ZIP:

`28524 octets`

## Archive exacte dans GitHub

Le ZIP est conservé en Base64 dans:

`archive/part01.b64` à `archive/part07.b64`

Les parties doivent être concaténées strictement dans cet ordre, sans séparateur.

Le fichier `archive/MANIFEST.md` contient:

- ordre des parties;
- tailles;
- Git blob SHA de chaque partie;
- longueur Base64 totale;
- commandes de reconstruction;
- hash ZIP attendu.

Cette archive permet de reconstruire la baseline exacte même si l'ancien lien de téléchargement n'existe plus.

## Reconstruction PowerShell

Depuis le dossier `archive`:

```powershell
$parts = 1..7 | ForEach-Object { Get-Content -Raw ("part{0:d2}.b64" -f $_) }
$b64 = ($parts -join '') -replace '\s',''
[IO.File]::WriteAllBytes('Cardinal-Formative-Importer-STANDALONE-0.4.1.zip', [Convert]::FromBase64String($b64))
Get-FileHash 'Cardinal-Formative-Importer-STANDALONE-0.4.1.zip' -Algorithm SHA256
```

Résultat attendu:

`B62F567AAF3917DF8B021C6AE00965176391F416537662B22303C9656FACFDA4`

## Reconstruction Python

```python
from pathlib import Path
import base64, re, hashlib

parts = [Path(f'part{i:02d}.b64').read_text() for i in range(1, 8)]
raw = re.sub(r'\s+', '', ''.join(parts))
data = base64.b64decode(raw)
Path('Cardinal-Formative-Importer-STANDALONE-0.4.1.zip').write_bytes(data)
print(len(raw))
print(len(data))
print(hashlib.sha256(data).hexdigest())
```

Sortie attendue:

```text
38032
28524
b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4
```

## Contenu attendu du ZIP

- `README.txt`
- `background.js`
- `chatgpt-bridge.js`
- `formative-engine.js`
- `formative-progress-ui.js`
- `formative-session-bridge.js`
- `formative-session-main.js`
- `manifest.json`
- `popup.html`
- `popup.js`
- `smoke-test-package.json`

## SHA-256 des fichiers internes

| Fichier | SHA-256 |
| --- | --- |
| README.txt | `ed7c59afaa341357bad7a719b222fef11bb5b95bc0921c9eb591112a2dd9ce08` |
| background.js | `cfedbed3a6ffb2c5b67f0635815d7bfca59b75dcba46dfa5f03a0d53d1082ac8` |
| chatgpt-bridge.js | `abbed0442f85427454d2d288fe4073bad680d256918f34298331cf34f2e47fc3` |
| formative-engine.js | `5e145cb49160d1094c614a2ee6b6c296f679fa49f775464b3dbdf773fc4c2c7b` |
| formative-progress-ui.js | `1d63d7d67c4ea61ccc95aca2c68508dccd56d38d9d4fa75a83cc741d49858dd8` |
| formative-session-bridge.js | `bf676c777481c39b43e8a8dcabe8aa1da1825110dce61ddafe6fc614aa88fab2` |
| formative-session-main.js | `80252a59c95c9d6e1c3c82b2591b41307159d5b588554e7fe8833bafe514e2b4` |
| manifest.json | `27c31b7e45b4d70de54f9594a79493789ffc44c0f603d4d3247a3064a99fc329` |
| popup.html | `fba73fa02f15a557e7c2f5e55ee9b8433033e545ad37df354b633cd99c077d8` |
| popup.js | `2d158de022a0bca8a44d2f56c32c0ba014dfa5465cac514740aaafdf465ccd8d` |
| smoke-test-package.json | `b422e599b682e6060d364df86c09e4f5783ac5d80cf92fed41864990f5ae31f4` |

## Invariant critique de version

Le `manifest.json` de cette archive contient la `manifest.key` publique qui stabilise l'identité Chrome à partir de 0.4.0/0.4.1.

Toute future version dérivée doit conserver exactement cette valeur.

Ne jamais committer une clé privée. Seule la clé publique du manifest fait partie du snapshot.

## Rôle de ce snapshot

- fallback stable pendant le développement 0.5.0;
- reconstruction si un lien de téléchargement disparaît;
- comparaison/régression lors d'un changement Formative;
- référence pour conserver `manifest.key`;
- preuve du code exact correspondant aux documents `CURRENT_STATE.md`, `BUILDER_STANDALONE.md` et `REFERENCE_ARTIFACTS.md`.

Ne pas modifier les parties d'archive en place. Une future baseline doit avoir son propre dossier/version.
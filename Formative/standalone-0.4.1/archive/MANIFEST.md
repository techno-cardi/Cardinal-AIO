# Manifest de l'archive 0.4.1

L'archive Base64 exacte est répartie en sept fichiers afin de rester simple à conserver dans GitHub.

## Ordre obligatoire

1. `part01.b64`
2. `part02.b64`
3. `part03.b64`
4. `part04.b64`
5. `part05.b64`
6. `part06.b64`
7. `part07.b64`

Longueur Base64 totale attendue: **38032 caractères**.

Taille ZIP décodée attendue: **28524 octets**.

SHA-256 ZIP attendu:

`b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4`

## Vérification des parties

| Partie | Taille | Git blob SHA-1 attendu |
| --- | ---: | --- |
| part01.b64 | 6000 | `73c265d9decadcec83e7b48099b9283797652b09` |
| part02.b64 | 6000 | `3b78498a61aba79105f5b561059414c7cfc03a48` |
| part03.b64 | 6000 | `dd4ea1734a6618ee66602aaf0474d4c65eefa02d` |
| part04.b64 | 6000 | `d37910ed08a8eb3ce9635f70676e801a3b4eaa7f` |
| part05.b64 | 6000 | `6d234f0a126193c90cd004cc902a2570ecedeca6` |
| part06.b64 | 4000 | `323ef71a5a50ad8a5cd2b60816bc0d4cf49e95d8` |
| part07.b64 | 4032 | `4f421ada2b1b4e1522565056779db084bf2eef15` |

Ces blob SHA correspondent aux parties calculées depuis le ZIP local validé. La liste du dossier GitHub a été relue après écriture pour confirmer tailles et SHA.

## Reconstruction PowerShell

Depuis le dossier `archive`:

```powershell
$parts = 1..7 | ForEach-Object { Get-Content -Raw ("part{0:d2}.b64" -f $_) }
$b64 = ($parts -join '') -replace '\s',''
[IO.File]::WriteAllBytes('Cardinal-Formative-Importer-STANDALONE-0.4.1.zip', [Convert]::FromBase64String($b64))
Get-FileHash 'Cardinal-Formative-Importer-STANDALONE-0.4.1.zip' -Algorithm SHA256
```

## Reconstruction Python

```python
from pathlib import Path
import base64, hashlib, re

parts = [Path(f'part{i:02d}.b64').read_text() for i in range(1, 8)]
b64 = re.sub(r'\s+', '', ''.join(parts))
data = base64.b64decode(b64)
Path('Cardinal-Formative-Importer-STANDALONE-0.4.1.zip').write_bytes(data)
print(len(b64))
print(len(data))
print(hashlib.sha256(data).hexdigest())
```

Sortie attendue:

```text
38032
28524
b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4
```

## Pourquoi conserver le ZIP exact

Le ZIP est la source exacte de:

- la `manifest.key` publique à conserver dans les futures versions;
- la baseline de code validée;
- les réglages de session/progression;
- le bridge ChatGPT 0.4.1;
- le moteur d'import et ses adaptateurs;
- le smoke-test package.

Si une future modification casse le projet, reconstruire d'abord ce ZIP et comparer avant de modifier la baseline.
param(
  [string]$OutputRoot = (Join-Path $env:USERPROFILE "Desktop\Cardinal-Recovery"),
  [switch]$Deep,
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedZipSha256 = "b8ef9a94cb9f55aca5957371ba239c67efdff943aa457b5aeed56afd005f69d7"
$RequiredFiles = @(
  "manifest.json",
  "service-worker.js",
  "chatgpt.js",
  "formative-network.js",
  "formative.js",
  "formative-stealth.js",
  "gestion-bridge.js",
  "mozaik.js"
)

function Write-Info([string]$Message) {
  Write-Host "[Cardinal recovery] $Message"
}

function Normalize-PathString([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  $v = $Value
  try { $v = [System.Text.RegularExpressions.Regex]::Unescape($v) } catch {}
  $v = $v -replace '/', '\'
  if ($v -match '^[A-Za-z]:\\' -or $v -match '^\\\\') {
    return $v
  }
  return $null
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TreeDigest([string]$Root) {
  $lines = New-Object System.Collections.Generic.List[string]
  Get-ChildItem -LiteralPath $Root -File -Recurse -Force -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    ForEach-Object {
      $rel = $_.FullName.Substring($Root.Length).TrimStart('\')
      $sha = Get-Sha256 $_.FullName
      $lines.Add($rel + [char]0 + $sha)
    }
  $payload = [string]::Join([Environment]::NewLine, $lines)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Test-CardinalDirectory([string]$Dir) {
  $manifestPath = Join-Path $Dir "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $null }

  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }

  $name = [string]$manifest.name
  $version = [string]$manifest.version
  if ($name -notmatch 'Cardinal') { return $null }

  $missing = @($RequiredFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $Dir $_) -PathType Leaf)
  })

  $worker = ""
  try { $worker = [string]$manifest.background.service_worker } catch {}
  $hasKey = $false
  try { $hasKey = -not [string]::IsNullOrWhiteSpace([string]$manifest.key) } catch {}

  $popupPath = ""
  try { $popupPath = [string]$manifest.action.default_popup } catch {}
  $popupExists = $false
  $popupAdaptable = $false
  $popupHasPrepareAction = $false
  if (-not [string]::IsNullOrWhiteSpace($popupPath)) {
    $popupFullPath = Join-Path $Dir $popupPath
    $popupExists = Test-Path -LiteralPath $popupFullPath -PathType Leaf
    if ($popupExists) {
      try {
        $popupSource = Get-Content -LiteralPath $popupFullPath -Raw -Encoding UTF8
        $popupAdaptable = ([regex]::Matches($popupSource, '</body\s*>', 'IgnoreCase').Count -eq 1)
        $popupHasPrepareAction = $popupSource -match 'Préparer une correction'
      } catch {}
    }
  }

  if (-not $popupHasPrepareAction) {
    Get-ChildItem -LiteralPath $Dir -Filter 'popup*.js' -File -Recurse -ErrorAction SilentlyContinue |
      ForEach-Object {
        try {
          if ((Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8) -match 'Préparer une correction') {
            $popupHasPrepareAction = $true
          }
        } catch {}
      }
  }

  $markerText = ""
  Get-ChildItem -LiteralPath $Dir -Filter *.js -File -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object {
      try {
        $text = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
        if ($text -match 'CARDINAL_STABLE_FORMATIVE_ACTION|__cardinalMozaikUiV116|1\.1\.9') {
          $markerText += "$($_.Name):"
          if ($text -match 'CARDINAL_STABLE_FORMATIVE_ACTION') { $markerText += "FORMATIVE_ACTION;" }
          if ($text -match '__cardinalMozaikUiV116') { $markerText += "MOZAIK_V116;" }
          if ($text -match '1\.1\.9') { $markerText += "VERSION_119;" }
        }
      } catch {}
    }

  $score = 0
  if ($version -eq "1.1.9") { $score += 50 }
  if ($worker -eq "service-worker.js") { $score += 15 }
  if (-not $hasKey) { $score += 5 }
  if ($missing.Count -eq 0) { $score += 20 }
  if ($markerText -match 'FORMATIVE_ACTION') { $score += 5 }
  if ($markerText -match 'MOZAIK_V116') { $score += 5 }

  $strongCandidate = (
    $version -eq "1.1.9" -and
    $worker -eq "service-worker.js" -and
    -not $hasKey -and
    $missing.Count -eq 0 -and
    $markerText -match 'FORMATIVE_ACTION' -and
    $markerText -match 'MOZAIK_V116' -and
    $markerText -match 'VERSION_119' -and
    $popupExists -and
    $popupAdaptable -and
    $popupHasPrepareAction
  )

  return [pscustomobject]@{
    Path = $Dir
    Name = $name
    Version = $version
    ServiceWorker = $worker
    ManifestKeyPresent = $hasKey
    MissingRequiredFiles = ($missing -join ",")
    MarkerEvidence = $markerText
    PopupPath = $popupPath
    PopupExists = $popupExists
    PopupAdaptable = $popupAdaptable
    PopupHasPrepareAction = $popupHasPrepareAction
    Score = $score
    StrongCandidate = [bool]$strongCandidate
    TreeSha256 = if ($missing.Count -eq 0) { Get-TreeDigest $Dir } else { "" }
  }
}

function Export-StrongCandidate([string]$SourceDir, [string]$DestinationRoot, [int]$Index) {
  $dest = Join-Path $DestinationRoot ("candidate-" + $Index.ToString("000"))
  New-Item -ItemType Directory -Path $dest -Force | Out-Null

  Get-ChildItem -LiteralPath $SourceDir -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
    }

  Set-Content -LiteralPath (Join-Path $dest "RECOVERY_SOURCE_PATH.txt") -Value $SourceDir -Encoding UTF8

  $rows = New-Object System.Collections.Generic.List[object]
  Get-ChildItem -LiteralPath $SourceDir -File -Recurse -Force -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    ForEach-Object {
      $rows.Add([pscustomobject]@{
        RelativePath = $_.FullName.Substring($SourceDir.Length).TrimStart('\')
        Length = $_.Length
        Sha256 = Get-Sha256 $_.FullName
      })
    }
  $rows | Export-Csv -LiteralPath (Join-Path $dest "RECOVERY_FILE_HASHES.csv") -NoTypeInformation -Encoding UTF8
  return $dest
}

function Get-BrowserProfiles {
  $bases = @(
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data"),
    (Join-Path $env:LOCALAPPDATA "BraveSoftware\Brave-Browser\User Data")
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }

  foreach ($base in $bases) {
    Get-ChildItem -LiteralPath $base -Directory -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq "Default" -or $_.Name -like "Profile *" } |
      ForEach-Object {
        [pscustomobject]@{
          UserData = $base
          Profile = $_.FullName
        }
      }
  }
}

function Get-BrowserPreferenceFiles {
  foreach ($profile in Get-BrowserProfiles) {
    foreach ($name in @("Preferences", "Secure Preferences")) {
      $p = Join-Path $profile.Profile $name
      if (Test-Path -LiteralPath $p -PathType Leaf) { $p }
    }
  }
}

function Resolve-RecordedExtensionPath([string]$RawPath, [string]$PreferenceFile) {
  if ([string]::IsNullOrWhiteSpace($RawPath)) { return $null }

  $absolute = Normalize-PathString $RawPath
  if ($absolute -and (Test-Path -LiteralPath $absolute -PathType Container)) {
    return (Resolve-Path -LiteralPath $absolute).Path
  }

  try {
    $decoded = [System.Text.RegularExpressions.Regex]::Unescape($RawPath) -replace '/', '\'
    $profileDir = Split-Path -Parent $PreferenceFile
    $relative = Join-Path $profileDir $decoded
    if (Test-Path -LiteralPath $relative -PathType Container) {
      return (Resolve-Path -LiteralPath $relative).Path
    }
  } catch {}

  return $null
}

function Get-PathsFromPreferences([string]$PreferenceFile) {
  try {
    $raw = Get-Content -LiteralPath $PreferenceFile -Raw -Encoding UTF8
  } catch {
    return
  }

  try {
    $json = $raw | ConvertFrom-Json
    $settings = $json.extensions.settings
    if ($null -ne $settings) {
      foreach ($prop in $settings.PSObject.Properties) {
        $entry = $prop.Value
        $recorded = ""
        try { $recorded = [string]$entry.path } catch {}
        $resolved = Resolve-RecordedExtensionPath $recorded $PreferenceFile
        if ($resolved) { $resolved }
      }
    }
  } catch {}

  $regexes = @(
    '"path"\s*:\s*"([^"]+)"',
    '"install_path"\s*:\s*"([^"]+)"'
  )
  foreach ($regex in $regexes) {
    foreach ($m in [regex]::Matches($raw, $regex)) {
      $resolved = Resolve-RecordedExtensionPath $m.Groups[1].Value $PreferenceFile
      if ($resolved) { $resolved }
    }
  }
}

function Get-BrowserExtensionDirectories {
  foreach ($profile in Get-BrowserProfiles) {
    $root = Join-Path $profile.Profile "Extensions"
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }

    Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue |
      ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -Directory -Force -ErrorAction SilentlyContinue |
          Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "manifest.json") -PathType Leaf } |
          ForEach-Object { $_.FullName }
      }
  }
}

function Get-SearchRoots {
  $roots = New-Object System.Collections.Generic.List[string]
  foreach ($candidate in @(
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Desktop"),
    (Join-Path $env:USERPROFILE "Documents"),
    $env:TEMP,
    $env:TMP,
    $env:OneDrive,
    $env:OneDriveCommercial,
    $env:OneDriveConsumer,
    (Join-Path $env:PUBLIC "Downloads"),
    (Join-Path $env:PUBLIC "Desktop"),
    (Join-Path $env:SystemDrive '$Recycle.Bin')
  )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) {
      if (-not $roots.Contains($candidate)) { $roots.Add($candidate) }
    }
  }
  if ($Deep -and (Test-Path -LiteralPath $env:USERPROFILE -PathType Container)) {
    if (-not $roots.Contains($env:USERPROFILE)) { $roots.Add($env:USERPROFILE) }
  }
  return $roots
}

if ($SelfTest) {
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cardinal-recovery-selftest-" + [Guid]::NewGuid().ToString("N"))
  $exportTmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cardinal-recovery-export-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  New-Item -ItemType Directory -Path $exportTmp -Force | Out-Null
  try {
    $manifest = [ordered]@{
      manifest_version = 3
      name = "Cardinal - Gestion des notes"
      version = "1.1.9"
      background = [ordered]@{ service_worker = "service-worker.js" }
      action = [ordered]@{ default_popup = "popup.html" }
    }
    $manifest | ConvertTo-Json -Depth 8 |
      Set-Content -LiteralPath (Join-Path $tmp "manifest.json") -Encoding UTF8
    "<!doctype html><html><body><button>Préparer une correction</button></body></html>" |
      Set-Content -LiteralPath (Join-Path $tmp "popup.html") -Encoding UTF8

    foreach ($file in $RequiredFiles | Where-Object { $_ -ne "manifest.json" }) {
      $body = "'use strict';"
      if ($file -eq "formative.js") { $body += " CARDINAL_STABLE_FORMATIVE_ACTION" }
      if ($file -eq "mozaik.js") { $body += " window.__cardinalMozaikUiV116 = true;" }
      if ($file -eq "chatgpt.js") { $body += " const VERSION = '1.1.9';" }
      Set-Content -LiteralPath (Join-Path $tmp $file) -Value $body -Encoding UTF8
    }

    $result = Test-CardinalDirectory $tmp
    if ($null -eq $result) { throw "Self-test: candidate was not detected." }
    if ($result.Version -ne "1.1.9") { throw "Self-test: wrong version." }
    if ($result.Score -ne 100) { throw "Self-test: expected score 100, got $($result.Score)." }
    if (-not $result.StrongCandidate) { throw "Self-test: complete stable fixture was not classified strong." }
    if (-not $result.PopupAdaptable) { throw "Self-test: popup should be adaptable." }
    if (-not $result.PopupHasPrepareAction) { throw "Self-test: historical prepare action missing." }
    if ([string]::IsNullOrWhiteSpace($result.TreeSha256)) { throw "Self-test: tree digest missing." }

    $preserved = Export-StrongCandidate $tmp $exportTmp 1
    if (-not (Test-Path -LiteralPath (Join-Path $preserved "manifest.json") -PathType Leaf)) {
      throw "Self-test: preserved manifest missing."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $preserved "RECOVERY_FILE_HASHES.csv") -PathType Leaf)) {
      throw "Self-test: preserved file hash inventory missing."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $preserved "RECOVERY_SOURCE_PATH.txt") -PathType Leaf)) {
      throw "Self-test: preserved source path missing."
    }

    Remove-Item -LiteralPath (Join-Path $tmp "gestion-bridge.js") -Force
    $incomplete = Test-CardinalDirectory $tmp
    if ($null -eq $incomplete) { throw "Self-test: incomplete candidate should still be reportable." }
    if ($incomplete.StrongCandidate) { throw "Self-test: incomplete candidate must never be classified strong." }

    Write-Info "Self-test Windows recovery: OK"
    exit 0
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $exportTmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$reportDir = Join-Path $OutputRoot "reports"
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null

Write-Info "SHA ZIP attendu: $ExpectedZipSha256"

$exactZipHits = New-Object System.Collections.Generic.List[object]
$zipSeen = @{}
foreach ($root in Get-SearchRoots) {
  Write-Info "Recherche ZIP: $root"
  Get-ChildItem -LiteralPath $root -Filter *.zip -File -Recurse -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
      if ($zipSeen.ContainsKey($_.FullName)) { return }
      $zipSeen[$_.FullName] = $true
      try {
        $sha = Get-Sha256 $_.FullName
        if ($sha -eq $ExpectedZipSha256) {
          $hit = [pscustomobject]@{
            Path = $_.FullName
            Size = $_.Length
            Sha256 = $sha
          }
          $exactZipHits.Add($hit)
          $dest = Join-Path $OutputRoot "cardinal-gestion-des-notes-v1.1.9-EXACT.zip"
          Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
          Write-Info "ZIP EXACT TROUVÉ: $($_.FullName)"
        }
      } catch {}
    }
}

$candidateDirs = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)

foreach ($pref in Get-BrowserPreferenceFiles) {
  Write-Info "Inspection profil navigateur: $pref"
  foreach ($p in Get-PathsFromPreferences $pref) {
    [void]$candidateDirs.Add($p)
  }
}

foreach ($dir in Get-BrowserExtensionDirectories) {
  [void]$candidateDirs.Add($dir)
}

foreach ($root in Get-SearchRoots) {
  Write-Info "Recherche manifest Cardinal: $root"
  Get-ChildItem -LiteralPath $root -Filter manifest.json -File -Recurse -Force -ErrorAction SilentlyContinue |
    ForEach-Object { [void]$candidateDirs.Add($_.Directory.FullName) }
}

$candidates = New-Object System.Collections.Generic.List[object]
$strongCandidateIndex = 0
$strongCandidateRoot = Join-Path $OutputRoot "strong-candidates"
foreach ($dir in $candidateDirs) {
  $result = Test-CardinalDirectory $dir
  if ($null -ne $result) {
    $candidates.Add($result)
    if ($result.StrongCandidate) {
      $strongCandidateIndex += 1
      New-Item -ItemType Directory -Path $strongCandidateRoot -Force | Out-Null
      $preserved = Export-StrongCandidate $result.Path $strongCandidateRoot $strongCandidateIndex
      Write-Info "Candidat fort: $($result.Path) version=$($result.Version) score=$($result.Score)"
      Write-Info "Copie de préservation: $preserved"
    }
  }
}

$exactZipHits | ConvertTo-Json -Depth 5 |
  Set-Content -LiteralPath (Join-Path $reportDir "exact-zip-hits.json") -Encoding UTF8

$candidates | Sort-Object -Property @{ Expression = "Score"; Descending = $true }, @{ Expression = "Path"; Descending = $false } |
  ConvertTo-Json -Depth 5 |
  Set-Content -LiteralPath (Join-Path $reportDir "cardinal-directory-candidates.json") -Encoding UTF8

$summary = [ordered]@{
  expectedZipSha256 = $ExpectedZipSha256
  generatedAt = (Get-Date).ToString("o")
  exactZipHitCount = $exactZipHits.Count
  candidateDirectoryCount = $candidates.Count
  strongCandidates = @($candidates | Where-Object { $_.StrongCandidate } | Sort-Object Score -Descending)
  outputRoot = $OutputRoot
  deepScan = [bool]$Deep
}

$summary | ConvertTo-Json -Depth 8 |
  Set-Content -LiteralPath (Join-Path $reportDir "summary.json") -Encoding UTF8

if ($exactZipHits.Count -gt 0) {
  Write-Info "SUCCÈS: baseline ZIP exacte récupérée dans $OutputRoot"
  exit 0
}

$strong = @($candidates | Where-Object { $_.StrongCandidate })
if ($strong.Count -gt 0) {
  Write-Info "Baseline ZIP exacte non trouvée, mais $($strong.Count) dossier(s) 1.1.9 fort(s) détecté(s)."
  Write-Info "Rapport: $(Join-Path $reportDir 'summary.json')"
  exit 2
}

Write-Info "Aucune baseline 1.1.9 exploitable trouvée dans les emplacements inspectés."
Write-Info "Rapport: $(Join-Path $reportDir 'summary.json')"
exit 3

# Installs PiSpark for this Windows user, or updates or repairs an existing install:
#
#   irm https://raw.githubusercontent.com/prakashrx/pispark/main/install/install.ps1 | iex
#
# Options, as environment variables set before running it:
#   $env:PISPARK_CHANNEL = "latest"   # "stable" (default): tested releases; "latest": every change merged to main
#   $env:PISPARK_NAME = "dev"         # a second install beside the main one: "PiSpark (dev)", its own
#                                     # folder, data (~\.pispark-dev), port, login entry and pispark-dev command
#   $env:PISPARK_VERSION = "0.2.0"    # that version (any channel), kept there until you resume updates
#   $env:PISPARK_PORT = "3000"        # default 3000, or the next free port
#   $env:PISPARK_HOME = "..."         # the data folder, default ~\.pispark
#   $env:PISPARK_INSTALL_DIR = "..."  # another folder (then your PATH and an earlier install are left alone)
#
# What it does: downloads the newest release for Windows from GitHub Releases, checks it against
# the release's SHA256SUMS, unpacks it into %LOCALAPPDATA%\Programs\PiSpark\versions\<version>,
# then hands over to PiSpark's launcher, which starts PiSpark at login (a per-user Run entry; no admin
# rights), adds a Start menu entry and the `pispark` command, starts it and opens it.
# Your data stays in ~\.pispark. Remove PiSpark with: pispark uninstall
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

& {
  $channel = if ($env:PISPARK_CHANNEL) { $env:PISPARK_CHANNEL } else { "stable" }
  if ($channel -notin "stable", "latest") { throw "PISPARK_CHANNEL must be stable or latest" }
  $name = $env:PISPARK_NAME
  if ($name -and $name -notmatch "^[a-z0-9][a-z0-9-]{0,19}$") { throw "PISPARK_NAME: lowercase letters, digits and dashes, up to 20 (e.g. dev)" }
  $label = if ($name) { "PiSpark ($name)" } else { "PiSpark" }
  $command = if ($name) { "pispark-$name" } else { "pispark" }
  $root = if ($env:PISPARK_INSTALL_DIR) { $env:PISPARK_INSTALL_DIR } elseif ($name) { Join-Path $env:LOCALAPPDATA "Programs\PiSpark-$name" } else { Join-Path $env:LOCALAPPDATA "Programs\PiSpark" }
  $releases = if ($env:PISPARK_RELEASES_URL) { $env:PISPARK_RELEASES_URL } else { "https://api.github.com/repos/prakashrx/pispark/releases?per_page=100" }
  $tar = Join-Path $env:SystemRoot "System32\tar.exe"
  if (-not (Test-Path $tar)) { throw "This Windows has no tar.exe (Windows 10 1803 or later has it)." }

  Write-Host "$label installer" -ForegroundColor Cyan

  # Pi's bash tool runs on Git Bash.
  $gitBash = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $gitBash) {
    Write-Host "PiSpark's agents run commands with Git Bash, which comes with Git for Windows. It is not installed."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      $answer = Read-Host "Install Git for Windows now with winget? [Y/n]"
      if ($answer -eq "" -or $answer -match "^[Yy]") { winget install --id Git.Git -e --source winget }
      else { Write-Host "Continuing without it. Install it later from https://git-scm.com/download/win" }
    } else { Write-Host "Install it from https://git-scm.com/download/win; continuing." }
  }

  # The newest release on the channel with a Windows archive (releases are listed newest first), or the one asked for.
  $wanted = if ($env:PISPARK_VERSION) { $env:PISPARK_VERSION -replace "^v", "" } else { $null }
  if ($wanted) { Write-Host "Finding PiSpark $wanted..." } else { Write-Host "Finding the newest $channel release..." }
  $list = Invoke-RestMethod -Uri $releases -Headers @{ "User-Agent" = "pispark-installer"; Accept = "application/vnd.github+json" }
  $pick = $null
  foreach ($r in $list) {
    $version = $r.tag_name -replace "^v", ""
    if ($r.draft) { continue }
    if ($wanted) { if ($version -ne $wanted) { continue } }
    elseif ($r.prerelease -and $channel -eq "stable") { continue }
    $archive = $r.assets | Where-Object { $_.name -eq "pispark-$version-win-x64.tar.gz" } | Select-Object -First 1
    $sums = $r.assets | Where-Object { $_.name -eq "SHA256SUMS" } | Select-Object -First 1
    if ($archive -and $sums) { $pick = @{ version = $version; archive = $archive; sums = $sums }; break }
  }
  if (-not $pick) { if ($wanted) { throw "There is no release $wanted for Windows." } else { throw "No $channel release for Windows was found at $releases" } }
  $version = $pick.version
  $target = Join-Path $root "versions\$version"

  if (Test-Path (Join-Path $target "release.json")) {
    Write-Host "PiSpark $version is already downloaded."
  } else {
    $temp = Join-Path ([IO.Path]::GetTempPath()) ("pispark-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Force $temp | Out-Null
    try {
      $file = Join-Path $temp $pick.archive.name
      Write-Host "Downloading PiSpark $version..."
      Invoke-WebRequest -UseBasicParsing -Uri $pick.archive.browser_download_url -OutFile $file -Headers @{ "User-Agent" = "pispark-installer" }
      $sumsText = (Invoke-WebRequest -UseBasicParsing -Uri $pick.sums.browser_download_url -Headers @{ "User-Agent" = "pispark-installer" }).Content
      if ($sumsText -is [byte[]]) { $sumsText = [Text.Encoding]::UTF8.GetString($sumsText) }
      $line = ($sumsText -split "`n") | Where-Object { $_ -match ("^([0-9a-fA-F]{64})\s+\*?" + [regex]::Escape($pick.archive.name) + "\s*$") } | Select-Object -First 1
      if (-not $line -or -not ($line -match "^([0-9a-fA-F]{64})")) { throw "SHA256SUMS lists no $($pick.archive.name)" }
      $expected = $Matches[1].ToLower()
      $actual = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLower()
      if ($actual -ne $expected) { throw "The download does not match SHA256SUMS; nothing was installed." }
      Write-Host "Checked. Unpacking..."
      $staging = Join-Path $root "versions\.unpack-$version"
      if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
      New-Item -ItemType Directory -Force $staging | Out-Null
      & $tar -xzf $file -C $staging
      if ($LASTEXITCODE -ne 0) { throw "Unpacking failed" }
      $top = Get-ChildItem $staging | Select-Object -First 1
      Move-Item $top.FullName $target
      Remove-Item -Recurse -Force $staging
    } finally {
      Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
    }
  }

  # The hand-built PiSpark from before the installer: its launcher and Start menu entry go, your data stays.
  $old = Join-Path $env:LOCALAPPDATA "PiSpark"
  if (-not $env:PISPARK_INSTALL_DIR -and -not $name -and (Test-Path (Join-Path $old "PiSpark.vbs"))) {
    Write-Host "Found an earlier hand-built PiSpark in $old (your data in ~\.pispark is separate and stays)."
    $answer = Read-Host "Stop it and remove that folder? [Y/n]"
    if ($answer -eq "" -or $answer -match "^[Yy]") {
      Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*$old\app\*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Seconds 1
      Remove-Item -Recurse -Force $old -ErrorAction SilentlyContinue
    }
  }

  # The launcher does the rest: the login start, the Start menu entry, the pispark command, start and open.
  $node = Join-Path $target "node\node.exe"
  $launcher = Join-Path $target "app\apps\launcher\dist\pispark.mjs"
  $setup = @($launcher, "setup", "--channel", $channel)
  if ($env:PISPARK_PORT) { $setup += @("--port", $env:PISPARK_PORT) }
  if ($env:PISPARK_HOME) { $setup += @("--home", $env:PISPARK_HOME) }
  if ($wanted) { $setup += "--keep" }
  if ($name) { $setup += @("--name", $name) }
  if ($env:PISPARK_NO_AUTOSTART) { $setup += "--no-autostart" }
  if ($env:PISPARK_NO_OPEN) { $setup += "--no-open" }
  & $node @setup
  if ($LASTEXITCODE -ne 0) { throw "Setup failed. See $root\logs" }

  # The pispark command, for new terminals.
  $bin = Join-Path $root "bin"
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $env:PISPARK_INSTALL_DIR -and -not (($userPath -split ";") -contains $bin)) {
    [Environment]::SetEnvironmentVariable("Path", (($userPath, $bin) | Where-Object { $_ }) -join ";", "User")
    Write-Host "Added $bin to your PATH (new terminals): $command status | open | update | stop | uninstall"
  }
  if ($env:PISPARK_NO_AUTOSTART) { Write-Host "Done." -ForegroundColor Green } else { Write-Host "Done. $label starts when you sign in; it is in the Start menu and the tray." -ForegroundColor Green }
}

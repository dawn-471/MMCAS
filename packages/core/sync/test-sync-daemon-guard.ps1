# MMCAS sync-daemon guard verification harness (end-to-end, scratch repo).
# Rule-level unit tests live in test-sync-daemon-detector.mjs (same directory).
#
# Purpose: prove with a throwaway repo that sync-daemon v0.2.x actually
#   (A)  refuses to commit while a merge conflict is unresolved -- `git add -A` would otherwise
#        stage the conflict markers and silently clear the UU state (proven failure mode),
#   (B1) blocks a pending file that carries a PAIRED conflict marker,
#   (B2) only WARNS on GBK-mojibake signatures (still commits and pushes),
#   (B3) blocks a pending CODE file carrying an illegal codepoint (e.g. U+FE3C),
#   (B4) only WARNS on a MARKDOWN file quoting that same codepoint (incident documentation),
#   (B5) only WARNS on a pending JSON DATA file (U+FFFD) and still commits -- the v1.2
#        data-file exemption (code-dir JSON logs must never freeze a sync round),
#   (C)  persists conflictMode across a daemon restart.
#
# Run:  powershell -NoProfile -File test-sync-daemon-guard.ps1 [-DaemonSrc <path to sync-daemon.mjs>]
#   Default source: sync-daemon.mjs next to this script. The source is copied into a scratch
#   repo before the run, so the tested artifact is always the current release file.
#
# NOTE 1 -- this file is deliberately ASCII-ONLY. Windows PowerShell 5.1 reads .ps1 as ANSI
#   unless a BOM is present, so non-ASCII comments come back as mojibake (that encoding trap is
#   what damaged two repo files on 2026-09-10/11). Keep it ASCII. See memory/shared/rules.md R-08.
# NOTE 2 -- it spawns node -> git. In a sandbox that forbids piped stdio the daemon dies with
#   "spawn EPERM" and EVERY CASE WOULD FALSELY PASS (nothing is ever attempted). The script prints
#   "!! SANITY FAIL" whenever EPERM appears in the daemon log -- if you see it, the run proves
#   nothing and must be repeated with normal (non-sandboxed) permissions.
# NOTE 3 -- daemon path defaults to this script's directory; use -DaemonSrc to point it at another copy.
#
# Verified 2026-09-11 against v0.2.1 (sha256 prefix C77983DDF29D84E3): 6/6 PASS.
# Extended in v1.2 with case B5 (data-file exemption): 7/7 PASS expected.

param(
    [string]$DaemonSrc = (Join-Path $PSScriptRoot 'sync-daemon.mjs')
)

$ErrorActionPreference = 'Continue'
if (-not (Test-Path $DaemonSrc)) { Write-Output "!! DaemonSrc not found: $DaemonSrc"; exit 2 }
$scratch = Join-Path $env:TEMP 'mmcas_daemon_test'
Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $scratch | Out-Null
$repo = Join-Path $scratch 'repo'
$bare = Join-Path $scratch 'origin.git'
$logs = Join-Path $scratch 'logs'
$DAEMON = Join-Path $scratch 'sync-daemon.under-test.mjs'
$CONFIG = Join-Path $scratch 'sync.config.json'
New-Item -ItemType Directory -Path $repo, $logs | Out-Null

function Write-NoBom([string]$path, [string]$text) {
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Init-Repo {
    git -C $repo init -q -b main 2>&1 | Out-Null
    git -C $repo config user.name test; git -C $repo config user.email t@t
    Write-NoBom (Join-Path $repo 'a.py') "x = 1`n"
    Write-NoBom (Join-Path $repo 'notes.md') "hello`n"
    git -C $repo add -A; git -C $repo commit -qm base
    git init -q --bare $bare
    git -C $repo remote add origin $bare
    git -C $repo push -q origin main
}

function Write-Cfg {
    $cfg = @"
{
  "repoDir": "$($repo -replace '\\','/')",
  "gitBin": "git",
  "pullIntervalSec": 2,
  "conflictRetrySec": 2,
  "pushMaxRetries": 1,
  "authorName": "mmcas-agent",
  "authorEmail": "agent@mmcas.local",
  "remote": "origin",
  "branch": "main",
  "logDir": "$($logs -replace '\\','/')"
}
"@
    Write-NoBom $CONFIG $cfg
}

function Run-Daemon([int]$Seconds, [string]$tag) {
    Remove-Item (Join-Path $logs 'sync.log') -Force -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath 'node' -ArgumentList @($DAEMON, '--config', $CONFIG) -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds $Seconds
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
    Start-Sleep -Milliseconds 500
    Write-Output "----- [$tag] daemon log -----"
    if (Test-Path (Join-Path $logs 'sync.log')) {
        Get-Content (Join-Path $logs 'sync.log') -Encoding utf8 | ForEach-Object { "   $_" }
    } else { Write-Output "   (no log file)" }
    $st = Join-Path $logs 'sync.state.json'
    if (Test-Path $st) { Write-Output ("   state: " + ((Get-Content $st -Raw -Encoding utf8) -replace '\s+', ' ')) }
    $logTxt = ''
    if (Test-Path (Join-Path $logs 'sync.log')) { $logTxt = Get-Content (Join-Path $logs 'sync.log') -Raw -Encoding utf8 }
    if ($logTxt -match 'EPERM') { Write-Output "   !! SANITY FAIL: daemon could not spawn git -> this run proves NOTHING" }
}

Init-Repo
Write-Cfg
Copy-Item $DaemonSrc $DAEMON -Force

Write-Output "===== A. unresolved merge conflict (expect: refuse to commit, UU preserved) ====="
git -C $repo checkout -qb side
Write-NoBom (Join-Path $repo 'a.py') "side`n"
git -C $repo add -A; git -C $repo commit -qm side
git -C $repo checkout -q main
Write-NoBom (Join-Path $repo 'a.py') "master`n"
git -C $repo add -A; git -C $repo commit -qm master
$before = (git -C $repo rev-list --count HEAD)
git -C $repo merge side 2>&1 | Out-Null
$uu = @(git -C $repo ls-files -u).Count
Write-Output "   after merge: UU entries=$uu  commits=$before"
Run-Daemon 8 'A'
$after = (git -C $repo rev-list --count HEAD)
$uuAfter = @(git -C $repo ls-files -u).Count
Write-Output "   => commits $before -> $after (expect unchanged); UU $uu -> $uuAfter (expect >0)"
Write-Output "   => RESULT A: $(if ($after -eq $before -and $uuAfter -gt 0) {'PASS'} else {'FAIL'})"

Write-Output ""
Write-Output "===== B1. no UU, but a to-be-committed file carries paired conflict markers (expect: hard block) ====="
git -C $repo merge --abort
git -C $repo checkout -q main
$markers = "z = 1`n<<<<<<< HEAD`nz = 2`n=======`nz = 3`n>>>>>>> other`n"
Write-NoBom (Join-Path $repo 'bad2.py') $markers
$b1 = (git -C $repo rev-list --count HEAD)
Write-Output "   commits before=$b1; UU=$(@(git -C $repo ls-files -u).Count); pending file bad2.py carries markers"
Run-Daemon 8 'B1'
$b1After = (git -C $repo rev-list --count HEAD)
Write-Output "   => commits $b1 -> $b1After (expect unchanged)"
Write-Output "   => RESULT B1: $(if ($b1After -eq $b1) {'PASS (blocked)'} else {'FAIL (committed anyway)'})"

Write-Output ""
Write-Output "===== B2. GBK-mojibake signature only (expect: warn, still commit + push) ====="
Remove-Item (Join-Path $repo 'bad2.py') -Force
$moji = [string]([char]0x951B) + [char]0x9225 + [char]0x9428 + [char]0x6D93 + [char]0x9352
Write-NoBom (Join-Path $repo 'moji.md') ("warn-only-signature: " + $moji + "`n")
$b2 = (git -C $repo rev-list --count HEAD)
Run-Daemon 8 'B2'
$b2After = (git -C $repo rev-list --count HEAD)
Write-Output "   => commits $b2 -> $b2After (expect +1)"
Write-Output "   => remote main count=$((git -C $bare rev-list --count main)) (expect = local)"
Write-Output "   => RESULT B2: $(if ($b2After -gt $b2) {'PASS (warn only)'} else {'FAIL'})"

Write-Output ""
Write-Output "===== C. state.mode=conflict survives restart (expect: enters conflict mode at startup) ====="
Write-NoBom (Join-Path $logs 'sync.state.json') '{"mode":"conflict","lastEvent":"injected-for-test"}'
Run-Daemon 4 'C'

Write-Output ""
Write-Output "===== B3. pending .py carrying U+FE3C (expect: hard block; this is the a_shrink_dbg case) ====="
$fe3c = [string]([char]0xFE3C)
Write-NoBom (Join-Path $repo 'bad_code.py') ("x = 1`n# " + $fe3c + "`n")
$b3 = (git -C $repo rev-list --count HEAD)
Write-Output "   commits before=$b3; pending file bad_code.py contains U+FE3C"
Run-Daemon 8 'B3'
$b3After = (git -C $repo rev-list --count HEAD)
Write-Output "   => commits $b3 -> $b3After (expect unchanged)"
Write-Output "   => RESULT B3: $(if ($b3After -eq $b3) {'PASS (blocked)'} else {'FAIL'})"

Write-Output ""
Write-Output "===== B4. pending .md QUOTING U+FE3C (expect: warn only, still commits; v0.2.1 refinement) ====="
Remove-Item (Join-Path $repo 'bad_code.py') -Force
Write-NoBom (Join-Path $repo 'incident_note.md') ("quoting the damaged sample: " + $fe3c + "`n")
$b4 = (git -C $repo rev-list --count HEAD)
Run-Daemon 8 'B4'
$b4After = (git -C $repo rev-list --count HEAD)
Write-Output "   => commits $b4 -> $b4After (expect +1)"
Write-Output "   => RESULT B4: $(if ($b4After -gt $b4) {'PASS (documentation not blocked)'} else {'FAIL'})"

Write-Output ""
Write-Output "===== B5. pending .json DATA file carrying U+FFFD (expect: warn only, still commits; v1.2 data-file exemption) ====="
Remove-Item (Join-Path $repo 'incident_note.md') -Force
$fffd = [string]([char]0xFFFD)
Write-NoBom (Join-Path $repo 'run_log.json') ('{"event":"parse-fail","raw":"' + $fffd + '"}' + "`n")
$b5 = (git -C $repo rev-list --count HEAD)
Run-Daemon 8 'B5'
$b5After = (git -C $repo rev-list --count HEAD)
$logRaw = ''
if (Test-Path (Join-Path $logs 'sync.log')) { $logRaw = Get-Content (Join-Path $logs 'sync.log') -Raw -Encoding utf8 }
$warnOnly = $logRaw -match 'only-warn|warn' -and $logRaw -notmatch 'blocked'
Write-Output "   => commits $b5 -> $b5After (expect +1; data file must NOT freeze the round)"
Write-Output "   => RESULT B5: $(if ($b5After -gt $b5) {'PASS (data file not blocked)'} else {'FAIL (blocked a data file)'})"

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$depsRoot = if ((Split-Path -Leaf $scriptRoot) -ieq 'scripts') {
    Split-Path -Parent $scriptRoot
} else {
    $scriptRoot
}

# The deployed copy lives in D:\llmwiki-deps.  The repository copy can also
# be run directly, so include both exact build locations without matching an
# arbitrary process merely because its name contains "wiki".
$projectRoot = 'D:\project\llmwiki'
$allowedExecutables = @(
    (Join-Path $depsRoot 'app\llm-wiki.exe'),
    (Join-Path $depsRoot 'cargo-target\debug\llm-wiki.exe'),
    (Join-Path $projectRoot 'src-tauri\target\debug\llm-wiki.exe'),
    (Join-Path $projectRoot 'src-tauri\target\release\llm-wiki.exe')
) | ForEach-Object {
    try { [System.IO.Path]::GetFullPath($_).TrimEnd('\') } catch { $null }
} | Where-Object { $_ }

$logDirectory = Join-Path $depsRoot 'logs'
$logFile = Join-Path $logDirectory 'stop.log'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Write-StopLog {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
    Write-Host $Message
}

function Normalize-Path {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    try { return [System.IO.Path]::GetFullPath($Path).TrimEnd('\') } catch { return $null }
}

function Test-AllowedRootProcess {
    param($ProcessInfo)
    $path = Normalize-Path $ProcessInfo.ExecutablePath
    if (-not $path) { return $false }
    foreach ($allowed in $allowedExecutables) {
        if ($path.Equals($allowed, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$launcherScripts = @(
    (Join-Path $depsRoot 'run-llmwiki.ps1'),
    (Join-Path $depsRoot 'prepare-llmwiki.ps1'),
    (Join-Path $depsRoot 'prepare-llmwiki.cmd')
) | ForEach-Object { [System.IO.Path]::GetFullPath($_) }
$roots = @($all | Where-Object {
    if (Test-AllowedRootProcess $_) { return $true }
    $commandLine = [string]$_.CommandLine
    foreach ($script in $launcherScripts) {
        if ($commandLine.IndexOf($script, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $true
        }
    }
    return $false
})

if ($roots.Count -eq 0) {
    Write-StopLog 'LLM Wiki is not running. Nothing was changed.'
    exit 0
}

# Snapshot descendants before requesting graceful shutdown.  Only descendants
# of an exact approved LLM Wiki executable are eligible for forced cleanup.
$ownedIds = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($root in $roots) { [void]$ownedIds.Add([int]$root.ProcessId) }
do {
    $added = $false
    foreach ($candidate in $all) {
        if ($ownedIds.Contains([int]$candidate.ParentProcessId) -and
            -not $ownedIds.Contains([int]$candidate.ProcessId)) {
            [void]$ownedIds.Add([int]$candidate.ProcessId)
            $added = $true
        }
    }
} while ($added)

foreach ($root in $roots) {
    $process = Get-Process -Id $root.ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    Write-StopLog ("Requesting graceful shutdown for PID {0}: {1}" -f $process.Id, $root.ExecutablePath)
    try { [void]$process.CloseMainWindow() } catch { }
}

$deadline = (Get-Date).AddSeconds(8)
do {
    $remainingRoots = @($roots | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
    if ($remainingRoots.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

$remainingIds = @()
foreach ($id in $ownedIds) {
    if (Get-Process -Id $id -ErrorAction SilentlyContinue) { $remainingIds += $id }
}
if ($remainingIds.Count -gt 0) {
    Write-StopLog ("Graceful shutdown timed out; stopping {0} verified process(es)." -f $remainingIds.Count)
    # Children first, then the root executable.
    foreach ($id in ($remainingIds | Sort-Object -Descending)) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Milliseconds 500
$stillRunning = @($roots | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
if ($stillRunning.Count -gt 0) {
    Write-StopLog ("Failed to stop LLM Wiki PID(s): {0}" -f (($stillRunning.ProcessId) -join ', '))
    exit 1
}

$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 19827, 19828 -and $ownedIds.Contains([int]$_.OwningProcess) })
if ($listeners.Count -gt 0) {
    Write-StopLog 'LLM Wiki exited, but one of its verified local listeners is still present.'
    exit 1
}

Write-StopLog 'LLM Wiki stopped successfully.'
exit 0

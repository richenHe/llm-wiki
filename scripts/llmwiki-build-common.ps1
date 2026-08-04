$ErrorActionPreference = 'Stop'

function Get-LlmWikiBuildInputFiles {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $rootFiles = @(
        'index.html',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'tsconfig.app.json',
        'tsconfig.node.json',
        'vite.config.ts',
        'src-tauri\build.rs',
        'src-tauri\Cargo.toml',
        'src-tauri\Cargo.lock',
        'src-tauri\tauri.conf.json',
        'mcp-server\package.json',
        'mcp-server\package-lock.json',
        'mcp-server\tsconfig.json'
    )
    $sourceDirectories = @(
        'public',
        'src',
        'src-tauri\src',
        'src-tauri\capabilities',
        'src-tauri\pdfium',
        'mcp-server\src'
    )

    $files = foreach ($relativePath in $rootFiles) {
        $path = Join-Path $ProjectRoot $relativePath
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Get-Item -LiteralPath $path
        }
    }
    foreach ($relativePath in $sourceDirectories) {
        $path = Join-Path $ProjectRoot $relativePath
        if (Test-Path -LiteralPath $path -PathType Container) {
            $files += Get-ChildItem -LiteralPath $path -File -Recurse |
                Where-Object {
                    $_.FullName -notmatch '\\(?:node_modules|target|dist)\\' -and
                    $_.Name -notmatch '\.(?:test|spec)\.[^.]+$'
                }
        }
    }

    return @($files | Sort-Object FullName -Unique)
}

function Get-LlmWikiBuildInputHash {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $normalizedRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $entries = foreach ($file in Get-LlmWikiBuildInputFiles -ProjectRoot $normalizedRoot) {
        $relativePath = $file.FullName.Substring($normalizedRoot.Length).TrimStart('\').Replace('\', '/')
        $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash
        "$relativePath|$fileHash"
    }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes(($entries -join "`n"))
        return ([System.BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace('-', '')
    } finally {
        $sha256.Dispose()
    }
}

function Get-LlmWikiBuildInfo {
    param([Parameter(Mandatory = $true)][string]$BuildInfoFile)

    if (-not (Test-Path -LiteralPath $BuildInfoFile -PathType Leaf)) {
        return @{}
    }

    try {
        return ConvertFrom-StringData (Get-Content -LiteralPath $BuildInfoFile -Raw)
    } catch {
        return @{}
    }
}

function Test-LlmWikiBuildCurrent {
    param(
        [Parameter(Mandatory = $true)][string]$AppExe,
        [Parameter(Mandatory = $true)][hashtable]$BuildInfo,
        [Parameter(Mandatory = $true)][string]$InputHash
    )

    return (
        (Test-Path -LiteralPath $AppExe -PathType Leaf) -and
        $BuildInfo.ContainsKey('input_sha256') -and
        $BuildInfo.input_sha256 -eq $InputHash
    )
}

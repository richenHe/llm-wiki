param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CargoArguments
)

$ErrorActionPreference = 'Stop'
$depsRoot = 'D:\llmwiki-deps'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cargoExe = Join-Path $depsRoot 'cargo\bin\cargo.exe'
$protocExe = Join-Path $depsRoot 'protobuf\bin\protoc.exe'

if (-not $CargoArguments -or $CargoArguments.Count -eq 0) {
    $CargoArguments = @(
        'test',
        '--manifest-path', (Join-Path $projectRoot 'src-tauri\Cargo.toml')
    )
}

$env:CARGO_HOME = Join-Path $depsRoot 'cargo'
$env:RUSTUP_HOME = Join-Path $depsRoot 'rustup'
$env:CARGO_TARGET_DIR = Join-Path $depsRoot 'cargo-test-target'
$env:PROTOC = $protocExe
$env:TEMP = Join-Path $depsRoot 'tmp\rust-tests'
$env:TMP = $env:TEMP
$env:PATH = "$(Join-Path $env:CARGO_HOME 'bin');$(Join-Path $depsRoot 'protobuf\bin');$env:PATH"

New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null

Write-Host "Rust tests use the isolated cache: $env:CARGO_TARGET_DIR"
Write-Host 'The desktop build cache will not be changed.'
& $cargoExe @CargoArguments
exit $LASTEXITCODE

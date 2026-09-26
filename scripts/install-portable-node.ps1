param(
  [Parameter(Mandatory = $false)]
  [string]$TargetDir = (Join-Path $PSScriptRoot '..\bin')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$resolvedTargetDir = [System.IO.Path]::GetFullPath($TargetDir)
if (-not (Test-Path -LiteralPath $resolvedTargetDir)) {
  New-Item -ItemType Directory -Path $resolvedTargetDir -Force | Out-Null
}

Write-Host "======================================================"
Write-Host "   Instalador do Node.js Portátil para CineLocal      "
Write-Host "======================================================"
Write-Host ""
Write-Host "Destino: $resolvedTargetDir"

$arch = 'x64'
if ([IntPtr]::Size -eq 4) {
  $arch = 'x86'
} elseif ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
  $arch = 'arm64'
}

$nodeVersion = 'v20.18.3'
$zipFileName = "node-$nodeVersion-win-$arch.zip"
$zipUrl = "https://nodejs.org/dist/$nodeVersion/$zipFileName"

$tempZip = Join-Path $env:TEMP "cinelocal_$zipFileName"
$extractDir = Join-Path $env:TEMP "cinelocal_node_extract"

try {
  if (Test-Path -LiteralPath $extractDir) {
    Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $tempZip) {
    Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
  }

  Write-Host "[1/3] Baixando Node.js $nodeVersion LTS ($arch)..."
  Write-Host "      URL: $zipUrl"
  Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing -TimeoutSec 300

  Write-Host "[2/3] Extraindo arquivos..."
  Expand-Archive -Path $tempZip -DestinationPath $extractDir -Force

  $subFolder = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
  if (-not $subFolder) {
    throw "Não foi possível localizar os arquivos extraídos do Node.js."
  }

  Write-Host "[3/3] Configurando executáveis em $resolvedTargetDir..."
  Get-ChildItem -LiteralPath $subFolder.FullName | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $resolvedTargetDir -Recurse -Force
  }

  $nodeExe = Join-Path $resolvedTargetDir 'node.exe'
  $npmCmd = Join-Path $resolvedTargetDir 'npm.cmd'

  if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $npmCmd)) {
    $ver = & $nodeExe --version
    Write-Host ""
    Write-Host "[OK] Node.js portátil ($ver) configurado com sucesso!" -ForegroundColor Green
    Write-Host "     Executáveis disponíveis na pasta bin\"
    exit 0
  } else {
    throw "Arquivos essenciais (node.exe ou npm.cmd) não foram encontrados após a extração."
  }
} catch {
  Write-Host ""
  Write-Host "[FALHA] Erro ao configurar Node.js portátil: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if (Test-Path -LiteralPath $tempZip) {
    Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $extractDir) {
    Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

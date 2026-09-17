<#
.SYNOPSIS
    Gera o esqueleto Laravel 13 neste repositório sem sobrescrever o que já existe.

.DESCRIPTION
    O repositório nasceu com contrato, ADRs e configuração de agentes antes do código PHP,
    porque o PHP depende do Herd estar instalado. `laravel new` exige diretório vazio, então
    este script cria o projeto num diretório temporário e copia de lá apenas o que falta aqui.

    Seguro de rodar mais de uma vez: nada que já existe é tocado.

.EXAMPLE
    .\scripts\bootstrap.ps1
#>

[CmdletBinding()]
param(
    [switch]$SkipComposerPackages
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "Flight Search API — bootstrap" -ForegroundColor Green
Write-Host "Repositório: $repoRoot`n"

# --- Pré-requisitos -------------------------------------------------------

function Test-Tool {
    param([string]$Name, [string]$InstallHint)

    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Host "FALTA: $Name" -ForegroundColor Red
        Write-Host "  $InstallHint`n"
        return $false
    }
    Write-Host "  OK   $Name -> $($cmd.Source)"
    return $true
}

Write-Host "Verificando ferramentas..."
$ok = $true
$ok = (Test-Tool 'php' 'Instale o Laravel Herd: https://herd.laravel.com/windows') -and $ok
$ok = (Test-Tool 'composer' 'O Composer vem com o Herd. Reabra o terminal depois de instalar.') -and $ok

if (-not $ok) {
    Write-Host "`nInstale o que falta e rode de novo." -ForegroundColor Yellow
    exit 1
}

$phpVersion = (php -r 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;')
Write-Host "  PHP $phpVersion"

if ([version]$phpVersion -lt [version]'8.3') {
    Write-Host "`nLaravel 13 exige PHP 8.3 ou superior. Ajuste a versão no Herd." -ForegroundColor Red
    exit 1
}

# --- Esqueleto Laravel ----------------------------------------------------

if (Test-Path (Join-Path $repoRoot 'artisan')) {
    Write-Host "`nEsqueleto Laravel já existe — pulando a geração." -ForegroundColor Yellow
}
else {
    $temp = Join-Path $repoRoot '.bootstrap-tmp'
    if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }

    Write-Host "`nGerando o esqueleto Laravel 13..." -ForegroundColor Cyan
    composer create-project laravel/laravel $temp --no-interaction

    Write-Host "Copiando para o repositório sem sobrescrever..." -ForegroundColor Cyan
    # /XC /XN /XO: não copia arquivo que já existe aqui, seja mais novo, mais velho ou igual.
    robocopy $temp $repoRoot /E /XC /XN /XO /NFL /NDL /NJH /NJS | Out-Null

    Remove-Item -Recurse -Force $temp
    Write-Host "Esqueleto pronto."
}

# --- Pacotes --------------------------------------------------------------

if (-not $SkipComposerPackages) {
    Write-Host "`nInstalando pacotes do projeto..." -ForegroundColor Cyan

    composer require laravel/sanctum --no-interaction
    composer require --dev pestphp/pest pestphp/pest-plugin-laravel larastan/larastan --no-interaction

    php artisan install:api --no-interaction
}

# --- Banco de desenvolvimento --------------------------------------------

$sqlite = Join-Path $repoRoot 'database\database.sqlite'
if (-not (Test-Path $sqlite)) {
    Write-Host "`nCriando o banco SQLite de desenvolvimento..." -ForegroundColor Cyan
    New-Item -ItemType File -Path $sqlite -Force | Out-Null
}

if (Test-Path (Join-Path $repoRoot '.env')) {
    Write-Host "  .env já existe — não foi tocado."
}
else {
    Copy-Item (Join-Path $repoRoot '.env.example') (Join-Path $repoRoot '.env')
    php artisan key:generate
    Write-Host "  .env criado a partir do .env.example."
}

php artisan migrate --no-interaction

# --- Próximos passos ------------------------------------------------------

Write-Host "`n--------------------------------------------------" -ForegroundColor Green
Write-Host "Bootstrap concluído." -ForegroundColor Green
Write-Host @"

Próximos passos:

  1. Coloque o token do Duffel no .env:
       DUFFEL_API_TOKEN=duffel_test_...

  2. Suba a API:
       herd php artisan serve

  3. Rode a suíte:
       herd php artisan test --parallel

  4. No repo do frontend, sincronize os tipos do contrato:
       npm run sync:api-types

O domínio de voos (providers, aggregator, circuit breaker) ainda não existe.
Peça ao agent backend-coder para implementá-lo seguindo openapi.yaml e a
ADR em docs/adr/0001-cadeia-de-providers-com-failover.md.

"@

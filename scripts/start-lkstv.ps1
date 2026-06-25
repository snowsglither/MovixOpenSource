# LKS TV - Démarrage automatique des services + tunnels Cloudflare
param()

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT        = "C:\Users\ruben\Desktop\MovixOpenSource"
$CLOUDFLARED = "$ROOT\cloudflared.exe"
$PYTHON_ENV  = "$ROOT\API\proxiesembed\.env"

# Charge les secrets locaux (gitignored)
$secretsFile = Join-Path $PSScriptRoot "secrets.ps1"
if (Test-Path $secretsFile) { . $secretsFile }

$CF_API_TOKEN  = $env:CF_API_TOKEN
$CF_ACCOUNT_ID = $env:CF_ACCOUNT_ID
$CF_PROJECT    = "lks-tv"

Write-Host "=== LKS TV - Demarrage ===" -ForegroundColor Cyan

# 1. Docker (MySQL + Redis)
Write-Host "Demarrage Docker (MySQL + Redis)..." -ForegroundColor Yellow
docker compose -f "$ROOT\docker-compose.yml" up -d 2>&1 | Out-Null
Write-Host "Attente demarrage MySQL/Redis (10s)..." -ForegroundColor Gray
Start-Sleep -Seconds 10

# 2. Tunnels Cloudflare
Write-Host "Demarrage tunnels Cloudflare..." -ForegroundColor Yellow
Stop-Process -Name "cloudflared" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-Process -FilePath $CLOUDFLARED -ArgumentList "tunnel --url http://localhost:25565" -RedirectStandardError "$env:TEMP\tunnel1.txt" -WindowStyle Hidden
Start-Process -FilePath $CLOUDFLARED -ArgumentList "tunnel --url http://localhost:25566" -RedirectStandardError "$env:TEMP\tunnel2.txt" -WindowStyle Hidden
Start-Process -FilePath $CLOUDFLARED -ArgumentList "tunnel --url http://localhost:25569" -RedirectStandardError "$env:TEMP\tunnel3.txt" -WindowStyle Hidden

Write-Host "Attente URLs tunnels (15s)..." -ForegroundColor Gray
Start-Sleep -Seconds 15

# 3. Recuperer les URLs
$url1 = Get-Content "$env:TEMP\tunnel1.txt" -ErrorAction SilentlyContinue | Select-String "trycloudflare.com" | ForEach-Object { if ($_ -match 'https://[\w\-]+\.trycloudflare\.com') { $Matches[0] } } | Select-Object -Last 1
$url2 = Get-Content "$env:TEMP\tunnel2.txt" -ErrorAction SilentlyContinue | Select-String "trycloudflare.com" | ForEach-Object { if ($_ -match 'https://[\w\-]+\.trycloudflare\.com') { $Matches[0] } } | Select-Object -Last 1
$url3 = Get-Content "$env:TEMP\tunnel3.txt" -ErrorAction SilentlyContinue | Select-String "trycloudflare.com" | ForEach-Object { if ($_ -match 'https://[\w\-]+\.trycloudflare\.com') { $Matches[0] } } | Select-Object -Last 1

if (-not $url1 -or -not $url2 -or -not $url3) {
    Write-Host "ERREUR: URLs tunnels manquantes, arret." -ForegroundColor Red
    Read-Host "Appuie sur Entree pour fermer"
    exit 1
}

Write-Host ""
Write-Host "=== URLs des tunnels ===" -ForegroundColor Green
Write-Host "MAIN API   = $url1" -ForegroundColor White
Write-Host "WATCHPARTY = $url2" -ForegroundColor White
Write-Host "PROXY      = $url3" -ForegroundColor White
Write-Host ""

# 4. Mettre a jour PROXY_BASE dans le .env Python
$envContent = Get-Content $PYTHON_ENV -Raw
$envContent = $envContent -replace 'PROXY_BASE=.*', "PROXY_BASE=$url3"
Set-Content -Path $PYTHON_ENV -Value $envContent.TrimEnd() -Encoding UTF8

# 5. Demarrage des services
Write-Host "Demarrage API principale..." -ForegroundColor Yellow
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "$ROOT\API\Mainapi" -WindowStyle Hidden

Write-Host "Demarrage WatchParty API..." -ForegroundColor Yellow
Start-Process -FilePath "node" -ArgumentList "watchparty.js" -WorkingDirectory "$ROOT\API\watchpartyAPI" -WindowStyle Hidden

Write-Host "Demarrage proxy Python..." -ForegroundColor Yellow
Start-Process -FilePath "python" -ArgumentList "server.py" -WorkingDirectory "$ROOT\API\proxiesembed" -WindowStyle Hidden

Write-Host "Attente demarrage services (10s)..." -ForegroundColor Gray
Start-Sleep -Seconds 10

# 5b. Purge cache AnimeSama
Write-Host "Purge cache AnimeSama..." -ForegroundColor Yellow
try {
    $purge = Invoke-RestMethod -Uri "http://localhost:25565/anime/purge-all" -Method Get -TimeoutSec 10
    Write-Host "Cache anime purge: $($purge.purged.disk) fichiers" -ForegroundColor Green
} catch {
    Write-Host "Purge cache anime echouee (non bloquant)" -ForegroundColor DarkYellow
}

# 6. Mise a jour Cloudflare Pages (automatique)
Write-Host "Mise a jour Cloudflare Pages..." -ForegroundColor Yellow
$headers = @{ "Authorization" = "Bearer $CF_API_TOKEN"; "Content-Type" = "application/json" }
$body = @{ deployment_configs = @{ production = @{ env_vars = @{
    VITE_MAIN_API           = @{ value = $url1 }
    VITE_WATCHPARTY_API     = @{ value = $url2 }
    VITE_PROXY_BASE_URL     = @{ value = $url3 }
    VITE_PROXIES_EMBED_API  = @{ value = $url3 }
    VITE_API_PROXY_BASE_URL = @{ value = $url3 }
}}}} | ConvertTo-Json -Depth 6

try {
    $patch = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$CF_PROJECT" -Method Patch -Headers $headers -Body $body
    if ($patch.success) {
        Write-Host "Variables CF mises a jour OK" -ForegroundColor Green
        $deploy = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$CF_PROJECT/deployments" -Method Post -Headers $headers -Body "{}"
        if ($deploy.success) {
            Write-Host "Re-deploy declenche (attendre 2-3 min pour le site)" -ForegroundColor Green
        }
    } else {
        Write-Host "Erreur CF Pages: $($patch.errors | ConvertTo-Json)" -ForegroundColor Red
    }
} catch {
    Write-Host "Erreur CF Pages: $_" -ForegroundColor Red
}

# 7. Mise a jour Kodi (plugin.video.lkstv)
Write-Host "Mise a jour Kodi..." -ForegroundColor Yellow
$kodiPy = "$ROOT\kodi\plugin.video.lkstv\default.py"
$kodiContent = Get-Content $kodiPy -Raw
$kodiContent = $kodiContent -replace "API_BASE = '.*'", "API_BASE = '$url1'"
Set-Content -Path $kodiPy -Value $kodiContent.TrimEnd() -Encoding UTF8

# Repackage le zip
python -c "
import zipfile, os, shutil
d = r'$ROOT\kodi\plugin.video.lkstv'
z = r'$ROOT\kodi\plugin.video.lkstv.zip'
with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in ['addon.xml', 'default.py']:
        zf.write(os.path.join(d, f), 'plugin.video.lkstv/' + f)
shutil.copy(z, r'C:\Users\ruben\Desktop\plugin.video.lkstv.zip')
" 2>$null
Write-Host "Kodi zip mis a jour sur le bureau" -ForegroundColor Green

Write-Host ""
Write-Host "=== Tous les services sont demarres ===" -ForegroundColor Green
Write-Host "Le site sera mis a jour dans ~2-3 min" -ForegroundColor Yellow
Write-Host ""

Read-Host "Appuie sur Entree pour fermer cette fenetre"

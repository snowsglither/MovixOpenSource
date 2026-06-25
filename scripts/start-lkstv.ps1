# LKS TV - Démarrage automatique des services + tunnels Cloudflare
# Lance ce script au démarrage pour tout remettre en ligne

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT        = "C:\Users\ruben\Desktop\MovixOpenSource"
$CLOUDFLARED = "$ROOT\cloudflared.exe"
$PYTHON_ENV  = "$ROOT\API\proxiesembed\.env"

# === CONFIG CLOUDFLARE ===
# Définir CF_API_TOKEN et CF_ACCOUNT_ID dans les variables d'environnement Windows
# ou les passer en paramètre : .\start-lkstv.ps1 -CfToken "..." -CfAccount "..."
param(
  [string]$CfToken   = $env:CF_API_TOKEN,
  [string]$CfAccount = $env:CF_ACCOUNT_ID
)
$CF_API_TOKEN  = $CfToken
$CF_ACCOUNT_ID = $CfAccount
$CF_PROJECT    = "lks-tv"
# =========================

Write-Host "=== LKS TV - Demarrage ===" -ForegroundColor Cyan

# 1. Docker (MySQL + Redis)
Write-Host "Demarrage Docker (MySQL + Redis)..." -ForegroundColor Yellow
docker compose -f "$ROOT\docker-compose.yml" up -d 2>&1 | Out-Null
Write-Host "Attente demarrage MySQL/Redis (10s)..." -ForegroundColor Gray
Start-Sleep -Seconds 10

# 2. Tunnels Cloudflare en premier pour connaitre les URLs publiques
Write-Host "Demarrage tunnels Cloudflare..." -ForegroundColor Yellow
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
Write-Host "VITE_MAIN_API           = $url1" -ForegroundColor White
Write-Host "VITE_WATCHPARTY_API     = $url2" -ForegroundColor White
Write-Host "VITE_PROXIES_EMBED_API  = $url3" -ForegroundColor White
Write-Host ""

# 4. Mettre a jour PROXY_BASE dans le .env Python avec l'URL publique du tunnel
Write-Host "Mise a jour PROXY_BASE dans .env Python..." -ForegroundColor Yellow
$envContent = Get-Content $PYTHON_ENV -Raw
$envContent = $envContent -replace 'PROXY_BASE=.*', "PROXY_BASE=$url3"
Set-Content -Path $PYTHON_ENV -Value $envContent.TrimEnd() -Encoding UTF8
Write-Host "PROXY_BASE = $url3" -ForegroundColor Green

# 5. Demarrage des services (apres mise a jour .env)
Write-Host "Demarrage API principale..." -ForegroundColor Yellow
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "$ROOT\API\Mainapi" -WindowStyle Hidden

Write-Host "Demarrage WatchParty API..." -ForegroundColor Yellow
Start-Process -FilePath "node" -ArgumentList "watchparty.js" -WorkingDirectory "$ROOT\API\watchpartyAPI" -WindowStyle Hidden

Write-Host "Demarrage proxy Python..." -ForegroundColor Yellow
Start-Process -FilePath "python" -ArgumentList "server.py" -WorkingDirectory "$ROOT\API\proxiesembed" -WindowStyle Hidden

Write-Host "Attente demarrage services (8s)..." -ForegroundColor Gray
Start-Sleep -Seconds 8

# 5b. Purge cache AnimeSama au demarrage (force un re-scrape frais)
Write-Host "Purge cache AnimeSama..." -ForegroundColor Yellow
try {
    $purge = Invoke-RestMethod -Uri "http://localhost:25565/anime/purge-all" -Method Get -TimeoutSec 10
    Write-Host "Cache anime purge: $($purge.purged.disk) fichiers" -ForegroundColor Green
} catch {
    Write-Host "Purge cache anime echouee (non bloquant): $_" -ForegroundColor DarkYellow
}

# 6. Mise a jour Cloudflare Pages
Write-Host "Mise a jour Cloudflare Pages..." -ForegroundColor Yellow

$headers = @{
    "Authorization" = "Bearer $CF_API_TOKEN"
    "Content-Type"  = "application/json"
}

$body = @{
    deployment_configs = @{
        production = @{
            env_vars = @{
                VITE_MAIN_API           = @{ value = $url1 }
                VITE_WATCHPARTY_API     = @{ value = $url2 }
                VITE_PROXY_BASE_URL     = @{ value = $url3 }
                VITE_PROXIES_EMBED_API  = @{ value = $url3 }
                VITE_API_PROXY_BASE_URL = @{ value = $url3 }
            }
        }
    }
} | ConvertTo-Json -Depth 6

try {
    $patch = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$CF_PROJECT" -Method Patch -Headers $headers -Body $body
    if ($patch.success) {
        Write-Host "Variables CF mises a jour OK" -ForegroundColor Green

        $deploy = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$CF_PROJECT/deployments" -Method Post -Headers $headers -Body "{}"
        if ($deploy.success) {
            Write-Host "Re-deploy declenche OK (attendre ~2-3 min)" -ForegroundColor Green
            Write-Host "Suivi: https://dash.cloudflare.com/$CF_ACCOUNT_ID/pages/view/$CF_PROJECT" -ForegroundColor Cyan
        } else {
            Write-Host "Erreur re-deploy: $($deploy.errors | ConvertTo-Json)" -ForegroundColor Red
        }
    } else {
        Write-Host "Erreur update CF: $($patch.errors | ConvertTo-Json)" -ForegroundColor Red
    }
} catch {
    Write-Host "Erreur API CF: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Tous les services sont demarres ===" -ForegroundColor Green

Read-Host "Appuie sur Entree pour fermer cette fenetre"

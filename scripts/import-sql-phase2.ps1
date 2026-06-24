# Phase 2 SQL import — à lancer UNE FOIS après le 1er démarrage de l'API
# Ces scripts altèrent des tables (films, download_links_history, wishboard_status_history)
# qui sont créées automatiquement par node API/Mainapi/server.js au 1er run.

$scripts = @(
    "add_download_links.sql",
    "add_link_type_to_history.sql",
    "add_greenlight_tracking.sql"
)

$basePath = Join-Path $PSScriptRoot "..\API\Mainapi\exportscripts"

Write-Host "=== Import SQL Phase 2 ===" -ForegroundColor Cyan

foreach ($script in $scripts) {
    $file = Join-Path $basePath $script
    $sql = Get-Content $file -Raw -Encoding UTF8
    $result = $sql | docker exec -i lkstv_mysql mariadb -u root movix 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK]   $script" -ForegroundColor Green
    } else {
        $msg = ($result | Out-String).Trim() -replace "[\r\n]+"," "
        Write-Host "  [ERR]  $script" -ForegroundColor Red
        Write-Host "         $msg"
    }
}

Write-Host "`nTerminé. Lance npm run dev si ce n'est pas déjà fait." -ForegroundColor Cyan

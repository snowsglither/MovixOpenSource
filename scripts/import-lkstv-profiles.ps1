$sql = Get-Content "scripts\lkstv-schema.sql" -Raw
docker exec -i lkstv_mysql mariadb -u root movix -e $sql
Write-Host "LKS TV schema imported"

# LKS TV — Roadmap & Transfer Guide

---

## Transfert sur le vieux laptop

### Prérequis à installer (dans l'ordre)

1. **Git** → https://git-scm.com
2. **Node.js 20+** → https://nodejs.org
3. **Docker Desktop** → https://www.docker.com/products/docker-desktop
4. **Python 3.10+** → https://www.python.org (pour le proxy embed)

### Étapes

```powershell
# 1. Cloner le repo
git clone https://github.com/snowsglither/MovixOpenSource.git
cd MovixOpenSource

# 2. Installer les dépendances frontend
npm install

# 3. Installer les dépendances backend
cd API/Mainapi
npm install
cd ../..

# 4. Installer les dépendances proxy Python
cd API/proxiesembed
pip install -r requirements.txt
cd ../..
```

### Fichiers à copier depuis l'ancien PC (clé USB)

Ces fichiers ne sont pas dans git (données sensibles) :

| Fichier | Destination |
|---------|-------------|
| `API/Mainapi/.env` | `API/Mainapi/.env` |
| `API/proxiesembed/.env` | `API/proxiesembed/.env` |

### Démarrer les services

```powershell
# Démarrer Docker (MySQL + Redis)
docker compose up -d

# Attendre 15 secondes que MySQL démarre, puis créer le compte admin
cd API/Mainapi
node -e "
const crypto = require('crypto'), { v4: uuidv4 } = require('uuid'), mysql = require('mysql2/promise');
async function main() {
  const pool = await mysql.createPool({ host:'localhost', port:3306, user:'root', password:'', database:'movix' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise((res,rej) => crypto.scrypt('Azerty123', salt, 64, (e,k) => e ? rej(e) : res(salt+':'+k.toString('hex'))));
  const id = uuidv4();
  await pool.execute('INSERT INTO local_accounts (id,username,password_hash) VALUES (?,?,?)',[id,'rubenAdmin',hash]);
  await pool.execute('INSERT IGNORE INTO admins (user_id,auth_type) VALUES (?,?)',[id,'local']);
  console.log('Admin créé, id:', id);
  await pool.end();
}
main().catch(console.error);
"
cd ../..

# Lancer tout (backend + tunnels + mise à jour CF Pages)
.\scripts\start-lkstv.ps1
```

### Démarrage automatique au boot

Dans PowerShell **en administrateur** (adapter le chemin) :

```powershell
$path = "C:\chemin\vers\MovixOpenSource"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File $path\scripts\start-lkstv.ps1"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "LKSTV_Autostart" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
```

---

## Futures améliorations

### Priorité haute

- [ ] **Tunnel Cloudflare permanent** — remplacer les quick tunnels (`trycloudflare.com`) par un vrai tunnel avec domaine fixe. Gratuit, stable, URL qui ne change pas au redémarrage → plus besoin de redéployer CF Pages à chaque restart.
  ```bash
  cloudflared tunnel create lkstv
  cloudflared tunnel route dns lkstv api.lks-tv.com
  ```

- [ ] **Limit upload / protection streaming** — limiter le nombre de streams simultanés par compte pour protéger la bande passante

- [ ] **Page d'erreur "site en maintenance"** — quand le backend est injoignable, afficher une page propre au lieu d'un écran blanc

- [ ] **Logs d'accès admin** — voir dans `/rubenchef` qui s'est connecté, quand, depuis quel appareil

### Priorité moyenne

- [ ] **Invitations par lien** — générer un lien d'invitation depuis l'admin pour créer un compte sans passer par le setup (lien à usage unique avec expiration)

- [ ] **Expiration de token** — actuellement les JWT n'expirent jamais. Ajouter une durée de vie (ex: 30 jours) pour forcer une reconnexion périodique

- [ ] **Historique par profil cross-device** — l'historique est déjà en DB, mais vérifier que la sync fonctionne bien entre plusieurs appareils sur le même profil

- [ ] **Notifications push** — prévenir les utilisateurs quand un nouveau film/série est disponible (via Web Push API)

### Priorité basse / cosmétique

- [ ] **Page `/rubenchef` plus complète** — stats globales (nb connexions aujourd'hui, contenu le plus regardé, bande passante utilisée)

- [ ] **Thème clair/sombre par profil** — chaque profil mémorise sa préférence de thème

- [ ] **Profils avec avatar image** — permettre d'uploader une image au lieu d'une couleur unie

### Infrastructure (quand tu veux vraiment scaler)

- [ ] **Migrer le backend sur VPS** — Contabo (~4€/mois) ou Oracle Cloud (gratuit). Tourne 24/7 sans dépendre du laptop. Setup : Ubuntu + Docker + Nginx reverse proxy + Certbot SSL.

- [ ] **CI/CD GitHub Actions** — déploiement automatique du backend sur le VPS à chaque push sur `main`

- [ ] **Backup automatique MySQL** — cron job qui dump la DB toutes les nuits vers un stockage externe (Backblaze B2 gratuit jusqu'à 10 Go)

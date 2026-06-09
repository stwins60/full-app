# Project Scenario: Deploying the Inventory Tracker for Meridian Supply Co.

## The Scenario

**Company:** Meridian Supply Co. — a mid-sized regional distributor of industrial parts.

**The Problem:**
The warehouse team at Meridian has been tracking inventory on a shared spreadsheet for three years. It breaks constantly, nobody knows who changed what, and last quarter a data entry error caused a $40,000 overstock on a single part.

The development team built a replacement: a lightweight web app with a **Flask REST API** backed by **MySQL** and a clean browser-based frontend. The code is done. It has been tested locally. The developers have handed it off.

Now it is your turn.

**Your Role:** DevOps Engineer at Meridian Supply Co.

**Your Mission:** Take the application from a developer's laptop and deploy it to the company's Ubuntu production server so that the warehouse team can start using it on Monday morning.

**The server is already provisioned.** It is running Ubuntu 22.04 LTS. It has a static IP. The domain `inventory.meridian-internal.com` already points to it. Nothing else is running on it yet.

You have SSH access. You have sudo. You have the code in `/srv/full-app`.

The clock is ticking.

---

## The Cast

| Person | Role | What they want from you |
|--------|------|------------------------|
| **Dana** | Lead Developer | Confirmation the app behaves exactly as it does locally |
| **Marcus** | Warehouse Manager | A URL he can open on Monday, no training required |
| **Priya** | IT Security | No root DB user in production, no secrets in the repo |
| **You** | DevOps Engineer | To go home on Friday knowing it won't page you at 2am |

---

## Act 1: Understand What You Are Deploying

Before touching the server, read the code. You need to know what the app expects before you can give it what it needs.

The repository structure handed to you:

```
/srv/full-app/
├── backend/              # Flask REST API — must run as a long-lived process
│   ├── app.py
│   ├── requirements.txt
│   ├── schema.sql        # The database structure Meridian's data will live in
│   └── .env.example      # The secrets template — your first stop
└── frontend/             # Static HTML/CSS/JS — no build step needed
    ├── index.html
    ├── css/style.css
    └── js/
        ├── config.js     # This file needs one change before go-live
        └── app.js
```

The backend exposes a REST API that the frontend calls:

| Method | Endpoint | What it does |
|--------|----------|--------------|
| GET | `/api/health` | Confirms the app can reach the database |
| GET | `/api/items` | Returns all inventory items |
| GET | `/api/items/:id` | Returns one item |
| POST | `/api/items` | Creates a new item |
| PUT | `/api/items/:id` | Updates an item |
| DELETE | `/api/items/:id` | Removes an item |

Dana confirms: the frontend and backend are meant to be served from the **same domain**. Nginx will sit in front of both — serving the static files directly and forwarding `/api/` traffic to Flask on port 5000.

Priya's requirement is already noted: no root database credentials. You will create a dedicated MySQL user.

---

## Act 2: Preparing the Server

You SSH into the production server for the first time. It is a clean install. Almost nothing is on it.

### Install dependencies

```bash
sudo apt update && sudo apt install -y \
  python3 python3-pip python3-venv \
  mysql-server \
  nginx \
  pkg-config \
  libmysqlclient-dev
```

This installs everything Meridian's stack needs:
- Python 3 and venv tooling for the Flask backend
- MySQL 8 for the database
- Nginx to serve the frontend and act as a reverse proxy
- The MySQL C client headers, which `mysqlclient` (the Python driver) needs to compile

---

## Act 3: Setting Up the Database

This is the step most people rush. Don't. If the database is wrong, nothing else works.

### 3.1 Lock down MySQL

The server is fresh, but MySQL installs with loose defaults. Tighten them:

```bash
sudo mysql_secure_installation
```

- Set a strong root password
- Remove anonymous users
- Disable remote root login
- Remove the test database

Priya will ask if you did this. You will be able to say yes.

### 3.2 Create Meridian's database and a dedicated user

Log in as root:

```bash
sudo mysql -u root -p
```

Run the following — replace the password with something strong and store it in your password manager:

```sql
CREATE DATABASE meridian_inventory;
CREATE USER 'meridian_app'@'localhost' IDENTIFIED BY 'your-strong-password';
GRANT ALL PRIVILEGES ON meridian_inventory.* TO 'meridian_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

The user `meridian_app` only has access to one database. If the app is ever compromised, the blast radius is contained. Priya will be satisfied.

### 3.3 Load the schema

Dana wrote the schema. You just need to run it:

```bash
mysql -u meridian_app -p meridian_inventory < /srv/full-app/backend/schema.sql
```

No output means success. Verify:

```bash
mysql -u meridian_app -p meridian_inventory -e "SHOW TABLES;"
```

You should see the `items` table. The database is ready.

---

## Act 4: Configuring and Starting the Backend

### 4.1 Create the environment file

The `.env.example` file is the contract between the developer and the environment. Copy it and fill it in:

```bash
cd /srv/full-app/backend
cp .env.example .env
nano .env
```

```
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=meridian_app
MYSQL_PASSWORD=your-strong-password
MYSQL_DB=meridian_inventory
SECRET_KEY=generate-a-random-64-char-string-here
FLASK_DEBUG=false
PORT=5000
```

To generate a good `SECRET_KEY`:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Set the file permissions so only root and the service user can read it:

```bash
sudo chmod 640 /srv/full-app/backend/.env
sudo chown root:www-data /srv/full-app/backend/.env
```

### 4.2 Install Python dependencies

Never install packages into the system Python. Create a virtual environment:

```bash
cd /srv/full-app/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
```

### 4.3 Smoke test before handing it to systemd

Before you write the service file, confirm the app actually starts:

```bash
cd /srv/full-app/backend
source venv/bin/activate
python app.py
```

In a second terminal:

```bash
curl http://localhost:5000/api/health
```

Expected response:

```json
{"db": "connected", "status": "ok"}
```

If you see that, the backend is working and the database connection is good. Dana's code is sound. Kill the manual process and hand control to systemd.

### 4.4 Write the systemd service

This is what makes the app survive a reboot, a crash, or a 2am server restart:

```bash
sudo nano /etc/systemd/system/meridian-backend.service
```

```ini
[Unit]
Description=Meridian Inventory Flask Backend
After=network.target mysql.service

[Service]
User=www-data
Group=www-data
WorkingDirectory=/srv/full-app/backend
EnvironmentFile=/srv/full-app/backend/.env
ExecStart=/srv/full-app/backend/venv/bin/python app.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable meridian-backend
sudo systemctl start meridian-backend
sudo systemctl status meridian-backend
```

The status output should show `active (running)`. If it shows `failed`, check the logs:

```bash
journalctl -u meridian-backend -n 50
```

---

## Act 5: Serving the Frontend with Nginx

The warehouse team will open a browser. They will not type port numbers. Nginx handles the rest.

### 5.1 Update the frontend's API base URL

Because Nginx will proxy `/api/` to Flask, the frontend no longer needs to know that Flask runs on port 5000. It just needs to call the same origin it was loaded from.

Edit `frontend/js/config.js`:

```bash
nano /srv/full-app/frontend/js/config.js
```

Change it to:

```js
const API_BASE = "";  // same origin — Nginx proxies /api/ to Flask
```

### 5.2 Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/meridian-inventory
```

```nginx
server {
    listen 80;
    server_name inventory.meridian-internal.com;

    # Serve the static frontend
    root /srv/full-app/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Reverse proxy API calls to the Flask backend
    location /api/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable the site, test the config, and reload:

```bash
sudo ln -s /etc/nginx/sites-available/meridian-inventory /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` must say `syntax is ok` and `test is successful` before you reload. If it does not, fix the config — never reload a broken Nginx config on production.

---

## Act 6: Go-Live Checklist

It is Sunday evening. Marcus needs this working by Monday morning. Run through every item on this list before you sign off.

- [ ] `curl http://inventory.meridian-internal.com/api/health` returns `{"status":"ok","db":"connected"}`
- [ ] Opening `http://inventory.meridian-internal.com` in a browser loads the inventory page
- [ ] Creating a new item via the form saves it and shows it in the table
- [ ] Editing an item updates it correctly
- [ ] Deleting an item removes it
- [ ] `sudo reboot` — after the server comes back up, the app is running without manual intervention
- [ ] `systemctl status meridian-backend` shows `active (running)` after the reboot
- [ ] The `.env` file is not readable by the `www-data` user directly (only via the service)
- [ ] No test data left in the database from smoke testing

---

## Act 7: What Can Go Wrong (and How to Fix It)

You will not always get a clean run on the first try. Here is what Dana, Marcus, and Priya have each run into before, and how to get past it.

| Symptom | What is actually happening | Fix |
|---------|---------------------------|-----|
| `502 Bad Gateway` in the browser | Nginx is up but Flask is not | `sudo systemctl restart meridian-backend` then `journalctl -u meridian-backend -n 30` |
| `Access denied for user 'meridian_app'` in logs | Password or DB name mismatch in `.env` | Re-check `.env` against what you created in MySQL |
| Frontend loads, clicking anything does nothing | `API_BASE` in `config.js` still has `localhost:5000` | Set it to `""` and hard-refresh the browser |
| `error: command '/usr/bin/x86_64-linux-gnu-gcc' failed` during pip install | Missing C build tools for `mysqlclient` | `sudo apt install libmysqlclient-dev pkg-config build-essential` |
| `nginx -t` fails after editing config | Syntax error in the Nginx config | Read the error line number carefully; usually a missing semicolon or brace |
| App works but dies overnight | Server ran out of memory, OOM killer hit Flask | Check `dmesg | grep -i kill`; consider adding a swap file |

---

## Epilogue

Monday morning. Marcus opens his browser, types the URL, and the inventory app loads. He creates his first real item. It saves. He refreshes. It is still there.

He sends a message to the team channel: "This is way better than the spreadsheet."

Priya runs a quick audit. Dedicated DB user, no debug mode, secrets not in the repo, `.env` permissions locked down. She marks it compliant.

Dana gets a notification that the health check is green. She closes her laptop for the weekend, a day late but satisfied.

You get nothing except the quiet confidence that it will still be running when you check on Tuesday.

That is the job.

# Project Scenario: Deploying the Inventory Tracker for Meridian Supply Co.

## The Scenario

**Company:** Meridian Supply Co. — a mid-sized regional distributor of industrial parts.

**The Problem:**
The warehouse team at Meridian has been tracking inventory on a shared spreadsheet for three years. It breaks constantly, nobody knows who changed what, and last quarter a data entry error caused a $40,000 overstock on a single part.

The development team built a replacement: a lightweight web app with a **Flask REST API** backed by **MySQL** and a clean browser-based frontend. The code is done. It has been tested locally. The developers have handed it off.

Now it is your turn.

**Your Role:** DevOps Engineer at Meridian Supply Co.

**Your Mission:** Take the application from a developer's laptop and deploy it to the company's Ubuntu production server using **Docker**. Every part of the stack — the Flask backend, the MySQL database, and the Nginx frontend — runs in its own container. No dependencies are installed directly on the host. If the server dies, you spin it up somewhere else in minutes.

**The server is already provisioned.** It is running Ubuntu 22.04 LTS. It has a static IP. The domain `inventory.meridian-internal.com` already points to it. Docker and Docker Compose are the only things that need to be on it.

You have SSH access. You have sudo. You have the code in `/srv/full-app`.

The clock is ticking.

---

## The Cast

| Person | Role | What they want from you |
|--------|------|------------------------|
| **Dana** | Lead Developer | Confirmation the app behaves exactly as it does locally |
| **Marcus** | Warehouse Manager | A URL he can open on Monday, no training required |
| **Priya** | IT Security | No root DB user in production, no secrets in the repo, containers not running as root |
| **You** | DevOps Engineer | To go home on Friday knowing it won't page you at 2am |

---

## Act 1: Understand What You Are Deploying

Before touching the server, read the code. You need to know what the app expects before you can give it what it needs.

The repository structure handed to you:

```
/srv/full-app/
├── backend/              # Flask REST API
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

Dana confirms: the frontend and backend are served from the **same domain**. An Nginx container will sit in front of both — serving the static files directly and forwarding `/api/` traffic to the Flask container.

The full Docker stack will be three containers managed by Docker Compose:

```
┌─────────────────────────────────────────┐
│            Docker Compose               │
│                                         │
│  ┌──────────┐      ┌──────────────────┐ │
│  │  nginx   │─────▶│  flask-backend   │ │
│  │ :80      │      │  :5000 (internal)│ │
│  └──────────┘      └────────┬─────────┘ │
│                             │           │
│                    ┌────────▼─────────┐ │
│                    │      mysql       │ │
│                    │  :3306 (internal)│ │
│                    └──────────────────┘ │
└─────────────────────────────────────────┘
```

Only Nginx is exposed to the outside world on port 80. MySQL and Flask are internal to the Docker network.

---

## Act 2: Preparing the Server

You SSH into the production server. It is a clean Ubuntu 22.04 install. The only thing you need on the host is Docker.

### Install Docker and Docker Compose

```bash
sudo apt update && sudo apt install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

Add yourself to the docker group so you do not need `sudo` on every command:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

Verify:

```bash
docker --version
docker compose version
```

That is all that goes on the host. Everything else lives inside containers.

---

## Act 3: Writing the Dockerfiles

You need two Dockerfiles — one for the backend, one for the frontend. Dana wrote the application code. You write the container definitions.

### 3.1 Backend Dockerfile

Create `backend/Dockerfile`:

```dockerfile
FROM python:3.11-slim

# Install the MySQL C client that mysqlclient needs to compile
RUN apt-get update && apt-get install -y \
    pkg-config \
    libmysqlclient-dev \
    gcc \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a non-root user — Priya's requirement
RUN useradd -m appuser
USER appuser

EXPOSE 5000

CMD ["python", "app.py"]
```

### 3.2 Frontend Dockerfile

The frontend is purely static files. Nginx serves them and proxies `/api/` to the Flask container.

Create `frontend/Dockerfile`:

```dockerfile
FROM nginx:1.25-alpine

COPY . /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
```

Create `frontend/nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass         http://backend:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Notice `proxy_pass http://backend:5000` — `backend` is the Docker Compose service name. Containers on the same Compose network resolve each other by service name automatically.

---

## Act 4: Writing docker-compose.yml

This is the file that ties the whole stack together. Create `docker-compose.yml` at the project root:

```yaml
services:

  db:
    image: mysql:8.0
    container_name: meridian-db
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DB}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    volumes:
      - db-data:/var/lib/mysql
      - ./backend/schema.sql:/docker-entrypoint-initdb.d/schema.sql:ro
    networks:
      - meridian-net
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    container_name: meridian-backend
    restart: always
    environment:
      MYSQL_HOST: db
      MYSQL_PORT: 3306
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      MYSQL_DB: ${MYSQL_DB}
      SECRET_KEY: ${SECRET_KEY}
      FLASK_DEBUG: "false"
      PORT: 5000
    depends_on:
      db:
        condition: service_healthy
    networks:
      - meridian-net

  frontend:
    build: ./frontend
    container_name: meridian-frontend
    restart: always
    ports:
      - "80:80"
    depends_on:
      - backend
    networks:
      - meridian-net

volumes:
  db-data:

networks:
  meridian-net:
```

Key decisions worth noting:

- **`db-data` volume** — MySQL data persists across container restarts and rebuilds. The warehouse team's records will not vanish if you `docker compose down`.
- **`schema.sql` mount** — MySQL's official image runs any `.sql` file placed in `/docker-entrypoint-initdb.d/` on first boot. Dana's schema loads automatically.
- **`depends_on` with `service_healthy`** — the backend waits for MySQL to be genuinely ready before starting, not just started. This prevents the Flask container from crashing on boot because the database is still initialising.
- **Only port 80 is exposed** — Flask and MySQL are unreachable from outside the Docker network. Priya will be satisfied.

---

## Act 5: Configuring Secrets

### 5.1 Update the frontend API base URL

Because Nginx handles routing inside the Docker network, the frontend calls the same origin it was loaded from. Edit `frontend/js/config.js`:

```js
const API_BASE = "";  // same origin — Nginx proxies /api/ to the backend container
```

### 5.2 Create the .env file

Docker Compose reads a `.env` file in the same directory as `docker-compose.yml` and injects the values at runtime. Create it:

```bash
cd /srv/full-app
cp backend/.env.example .env
nano .env
```

```
MYSQL_ROOT_PASSWORD=a-very-strong-root-password
MYSQL_USER=meridian_app
MYSQL_PASSWORD=another-strong-password
MYSQL_DB=meridian_inventory
SECRET_KEY=generate-a-random-64-char-string-here
```

Generate a good `SECRET_KEY` on the spot:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Lock down the file so only root can read it:

```bash
sudo chmod 600 /srv/full-app/.env
```

Do not commit `.env` to version control. `.env.example` goes in the repo. `.env` stays on the server.

---

## Act 6: Building and Starting the Stack

With the Dockerfiles, Compose file, and `.env` in place, you are ready to bring the stack up.

### Build the images

```bash
cd /srv/full-app
docker compose build
```

This builds the backend and frontend images from their respective Dockerfiles. The MySQL image is pulled from Docker Hub as-is.

### Start the stack

```bash
docker compose up -d
```

The `-d` flag runs everything in the background. Docker Compose will:
1. Pull the MySQL 8.0 image
2. Build the Flask backend image
3. Build the Nginx frontend image
4. Start the `db` container and wait for its health check to pass
5. Start `backend` once `db` is healthy
6. Start `frontend` once `backend` is up

Watch it come up:

```bash
docker compose logs -f
```

Wait until you see Flask's startup message in the `backend` logs and Nginx confirm it is ready in the `frontend` logs. Then hit `Ctrl+C` to stop following logs — the containers keep running.

### Smoke test

```bash
curl http://localhost/api/health
```

Expected:

```json
{"db": "connected", "status": "ok"}
```

If you see that, all three containers are up and talking to each other correctly.

---

## Act 7: Making It Survive a Reboot

Every service has `restart: always` in the Compose file. This tells Docker to restart individual containers if they crash. But you also need the Docker daemon itself to start on boot, which brings the containers with it.

```bash
sudo systemctl enable docker
```

Verify by rebooting the server and checking the stack came back on its own:

```bash
sudo reboot
# ... wait for SSH to come back ...
docker compose -f /srv/full-app/docker-compose.yml ps
```

All three containers should show `running`. Marcus does not need to know any of this happened.

---

## Act 8: Go-Live Checklist

It is Sunday evening. Run through every item before you sign off.

- [ ] `curl http://inventory.meridian-internal.com/api/health` returns `{"status":"ok","db":"connected"}`
- [ ] Opening `http://inventory.meridian-internal.com` in a browser loads the inventory page
- [ ] Creating a new item via the form saves it and shows it in the table
- [ ] Editing an item updates it correctly
- [ ] Deleting an item removes it
- [ ] `docker compose ps` shows all three containers as `running`
- [ ] `sudo reboot` — after the server comes back, all containers restart automatically
- [ ] The `.env` file is not in the git repository
- [ ] MySQL is not reachable from outside the server (`curl http://inventory.meridian-internal.com:3306` should time out)
- [ ] No test data left in the database from smoke testing — `docker compose exec db mysql -u meridian_app -p meridian_inventory -e "DELETE FROM items;"`

---

## Act 9: What Can Go Wrong

| Symptom | What is actually happening | Fix |
|---------|---------------------------|-----|
| `backend` container exits immediately on startup | Flask cannot reach MySQL — db not ready yet | Check `docker compose logs db`; the healthcheck may need more retries if the server is slow |
| `502 Bad Gateway` in the browser | Nginx is up but the backend container is down | `docker compose restart backend` then `docker compose logs backend` |
| `Access denied for user` in backend logs | Credentials in `.env` do not match what MySQL was initialised with | The `db-data` volume was created with different credentials — run `docker compose down -v` to wipe it and start fresh |
| `schema.sql` did not load | The `db-data` volume already existed from a previous run — init scripts only run on first boot | `docker compose down -v && docker compose up -d` |
| Frontend loads but API calls fail | `API_BASE` in `config.js` still set to `localhost:5000` | Set it to `""`, rebuild the frontend image: `docker compose build frontend && docker compose up -d frontend` |
| Port 80 already in use on the host | Another process (old Nginx, Apache) is bound to port 80 | `sudo ss -tlnp | grep :80` to find it, then stop it |

---

## Epilogue

Monday morning. Marcus opens his browser, types the URL, and the inventory app loads. He creates his first real item. It saves. He refreshes. It is still there.

He sends a message to the team channel: "This is way better than the spreadsheet."

Priya runs a quick audit. Containers running as non-root, MySQL not exposed externally, secrets not in the repo, `.env` permissions locked down. She marks it compliant.

Dana gets a notification that the health check is green. She closes her laptop for the weekend, a day late but satisfied.

You get nothing except the quiet confidence that if the server dies tonight, you can have the entire stack running somewhere else before anyone notices.

That is the job.

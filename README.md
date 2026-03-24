# Finanz Helper

Monorepo für Finanz-Tools: Anonymisierung und KI-Beratung von Kontoumsätzen.

## Apps

| App | Service | Technologie | Port | Beschreibung |
|-----|---------|-------------|------|-------------|
| **Anonymizer** | API | Express (Node 20) | 8080 | REST-API, CSV-Import, Anonymisierungsregeln |
| | Web | Vue 3 + Vite | 5173 | SPA, mobil-first |
| **Sparbot** | API | Express (Node 20) | 8081 | Chat-API, Multi-LLM (OpenAI/Gemini/Claude) |
| | Web | Vue 3 + Vite | 5174 | Chat-UI, Onboarding, Action-Buttons |
| **DB** | | PostgreSQL 16 | 5432 | Shared zwischen allen Apps |

## Voraussetzungen

- Docker + Docker Compose (v2)
- LLM API Key (OpenAI, Gemini oder Anthropic) für Sparbot

## Lokale Entwicklung

```bash
# .env Datei erstellen (siehe .env.example)
cp .env.example .env
# API Keys eintragen

docker compose up --build
```

- Anonymizer Web: http://localhost:5173
- Anonymizer API: http://localhost:8080
- Sparbot Web: http://localhost:5174
- Sparbot API: http://localhost:8081

### Session / Auth

Beide Apps teilen die gleiche `user_tokens`-Tabelle. Das Frontend erstellt beim ersten Laden eine Session über `POST /api/session`, speichert den Token in `localStorage` und sendet ihn bei weiteren Requests als Header `x-token`.

### Stop

```bash
docker compose down
```

### Reset (Datenbank komplett leeren)

⚠️ Löscht das Postgres-Volume (alle Daten):

```bash
docker compose down -v
docker compose up --build
```

## Umgebungsvariablen

### Anonymizer API (`apps/anonymizer/api`)

| Variable | Beschreibung | Pflicht |
|---|---|---|
| `DATABASE_URL` | Postgres Connection String | ✅ |
| `PORT` | API-Port (default: `8080`) | – |
| `NODE_ENV` | `production` / `development` | – |
| `COOKIE_SECRET` | Secret für signierte Cookies (cookieParser) | ✅ in Prod |
| `SUPPORT_TOKEN` | Auth-Token für Admin-Endpoints (`/api/support/*`) | ✅ in Prod |

### Anonymizer Web (`apps/anonymizer/web`)

| Variable | Beschreibung | Pflicht |
|---|---|---|
| `VITE_API_BASE` | URL der Anonymizer-API (Build-Zeit) | ✅ in Prod |
| `VITE_SPARBOT_URL` | URL der Sparbot-Web-App (Link im Anonymizer-Header) | – |

### Sparbot API (`apps/sparbot/api`)

| Variable | Beschreibung | Pflicht |
|---|---|---|
| `DATABASE_URL` | Postgres Connection String | ✅ |
| `PORT` | API-Port (default: `8081`) | – |
| `COOKIE_SECRET` | Secret für signierte Cookies | ✅ in Prod |
| `LLM_PROVIDER` | `openai` / `gemini` / `anthropic` | ✅ |
| `LLM_MODEL` | Model override (optional) | – |
| `OPENAI_API_KEY` | OpenAI API Key | wenn `LLM_PROVIDER=openai` |
| `GEMINI_API_KEY` | Gemini API Key | wenn `LLM_PROVIDER=gemini` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | wenn `LLM_PROVIDER=anthropic` |
| `LLM_DAILY_REQUEST_LIMIT` | Max Anfragen/User/Tag (default: 50) | – |
| `LLM_DAILY_TOKEN_LIMIT` | Max Tokens/User/Tag (default: 100000) | – |

### Sparbot Web (`apps/sparbot/web`)

| Variable | Beschreibung | Pflicht |
|---|---|---|
| `VITE_API_BASE` | URL der Sparbot-API (Build-Zeit) | ✅ in Prod |

> **Hinweis:** `VITE_API_BASE` wird von Vite zur **Build-Zeit** eingebettet. Änderungen erfordern einen Rebuild.

> **LLM-Provider wechseln:** `LLM_PROVIDER` in `.env` ändern → `docker compose restart sparbot-api`

## Deploy

### Render.com

Im Repo-Root liegt eine `render.yaml` (Blueprint). Render provisioniert:

- **haushalt-db** – Postgres 16 (Region: Frankfurt)
- **haushalt-api** – Anonymizer API (`rootDir: apps/anonymizer/api`)
- **haushalt-web** – Anonymizer Web (`rootDir: apps/anonymizer/web`)
- **sparbot-api** – Sparbot API (`rootDir: apps/sparbot/api`)
- **sparbot-web** – Sparbot Web (`rootDir: apps/sparbot/web`)

**Ablauf:**
1. Repo nach GitHub pushen
2. Render Dashboard → **Blueprints** → **New Blueprint Instance** → Repo auswählen
3. `LLM_PROVIDER` + entsprechenden API Key manuell setzen
4. `VITE_API_BASE` ggf. nach erstem Deploy auf die tatsächliche API-URL anpassen
5. Deploy starten

### Coolify (Docker Images auf Dedi)

Alle Dockerfiles sind production-ready:

- `apps/anonymizer/api/Dockerfile` → Node 20 + Express
- `apps/anonymizer/web/Dockerfile` → Multi-Stage (Vite Build → nginx)
- `apps/sparbot/api/Dockerfile` → Node 20 + Express
- `apps/sparbot/web/Dockerfile` → Multi-Stage (Vite Build → nginx)

Für Web-Apps muss `VITE_API_BASE` als Build-Arg übergeben werden:

```bash
docker build --build-arg VITE_API_BASE=https://api.example.com -t finanz-web ./apps/anonymizer/web
docker build --build-arg VITE_API_BASE=https://sparbot-api.example.com -t sparbot-web ./apps/sparbot/web
```

## Datenbank

Die DB wird von allen Apps geteilt. Migrationen laufen automatisch beim API-Start.

### Anonymizer-Tabellen (`apps/anonymizer/api/migrations/`)
- `user_tokens` – Sessions (shared)
- `accounts` – Konten pro User
- `imports` – Import-Batches
- `masked_transactions` – Anonymisierte Umsätze
- `anon_rules` – Anonymisierungsregeln pro User
- `bank_mapping` – CSV-Spalten-Mappings
- `bank_format_requests` – Anfragen für unbekannte Bankformate

### Sparbot-Tabellen (`apps/sparbot/api/migrations/`)
- `sparbot_profiles` – User-Profil (Name, Ansprache, Summary-Cache)
- `sparbot_messages` – Chatverlauf
- `sparbot_usage` – LLM Token-Nutzung pro Tag

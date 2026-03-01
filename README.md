# Finanz Helper

Anonymisierte Kontoumsätze verwalten: CSV-Import → Pseudonymisierung im Browser → Speicherung in Postgres.

## Architektur

| Service | Technologie | Beschreibung |
|---|---|---|
| **Web** | Vue 3 + Vite | SPA, mobil-first |
| **API** | Express (Node 20) | REST-API, Migrationen, Anonymisierungsregeln |
| **DB** | PostgreSQL 16 | Shared mit anderen Apps (z.B. Bank-Konfiguration) |

## Voraussetzungen

- Docker + Docker Compose (v2)

## Lokale Entwicklung

```bash
docker compose up --build
```

- Web: http://localhost:5173
- API: http://localhost:8080

### Session / Auth

Das Frontend erstellt beim ersten Laden eine Session über `POST /api/session`, speichert den Token in `localStorage` (`hm_token`) und sendet ihn bei weiteren Requests als Header `x-token`.

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

## Deploy

### Render.com (Static Site + Docker API)

Im Repo-Root liegt eine `render.yaml` (Blueprint). Render provisioniert:

- **haushalt-db** – Postgres 16
- **haushalt-api** – Web Service (Docker)
- **haushalt-web** – Static Site (Vite Build)

**Ablauf:**
1. Repo nach GitHub pushen
2. Render Dashboard → **Blueprints** → **New Blueprint Instance** → Repo auswählen
3. Deploy starten

**Hinweis:** `VITE_API_BASE` wird zur Build-Zeit eingebettet. Falls die API-URL sich ändert, in Render anpassen und Rebuild triggern.

### Coolify (Docker Images auf Dedi)

Beide Dockerfiles sind production-ready:

- `apps/api/Dockerfile` → Node 20 + Express
- `apps/web/Dockerfile` → Multi-Stage (Vite Build → nginx)

Für die Web-App muss `VITE_API_BASE` als Build-Arg übergeben werden:

```bash
docker build --build-arg VITE_API_BASE=https://api.example.com -t finanz-web ./apps/web
```

## Datenbank

Die DB wird mit anderen Apps geteilt. Migrationen laufen automatisch beim API-Start (`apps/api/migrations/`).

Tabellen dieser App:
- `user_tokens` – Sessions
- `accounts` – Konten pro User
- `imports` – Import-Batches
- `masked_transactions` – Anonymisierte Umsätze
- `anon_rules` – Anonymisierungsregeln pro User
- `bank_mapping` – CSV-Spalten-Mappings (shared, auch von externer App befüllt)
- `bank_format_requests` – Anfragen für unbekannte Bankformate

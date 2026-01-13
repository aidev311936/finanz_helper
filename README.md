# Haushaltmanager (Phase 1 – Step 6: Budget‑Wizard + Abo‑Zusammenfassung)

Minimaler, lauffähiger Prototyp nach deinem Konzept:

- UI = **Chat** (mobil‑first, wenige UI‑Elemente)
- CSV‑Import → **lokale Pseudonymisierung/Maskierung im Browser** (ohne KI)
- Speicherung **anonymisierter Umsätze** in Postgres
- Kategorisierung läuft als **Job** im Worker (ohne Redis) über **austauschbaren LLM‑Provider**
- Chat Q&A: KI nutzt **Tools (SQL)** auf anonymisierte Umsätze, stellt Rückfragen und liefert Buttons/Datepicker
- Step 4: zusätzliche **Insights‑Tools** (Monatsübersicht, Top Händler, Fixkosten vs variabel, Sparpotenziale)
- Step 5: **Budgets** (pro Kategorie), **Alerts** (Budget überschritten + ungewöhnliche Anstiege) und stärkere **Abo/Recurring-Erkennung** (Merchant + Betrag + Intervall)
- Step 6: **Budget‑Wizard** (Top‑Kategorien als Buttons + Vorschlagswerte) und **Abo‑Zusammenfassung** (Buckets wie Streaming/Musik + Kündigungs‑Kandidaten)

## Voraussetzungen

- Docker + Docker Compose (v2)

## Start

Im Repo‑Root:

```bash
docker compose up --build
```

Dann öffnen:

- Web: http://localhost:5173
- API: http://localhost:8080

### Session / Auth

Das Frontend erstellt beim ersten Laden eine Session über `POST /api/session`, speichert den Token in `localStorage` (`hm_token`) und sendet ihn bei weiteren Requests als Header `x-token`. Dadurch funktionieren Deployments auch ohne Cookie‑Sonderfälle (SameSite/Third‑Party Cookies).

> Postgres läuft als eigener Service im Compose und hat einen Healthcheck. API/Worker starten erst, wenn die DB „ready“ ist.

## Stop

```bash
docker compose down
```

## Reset (Datenbank komplett leeren)

⚠️ Löscht das Postgres‑Volume (alle Daten):

```bash
docker compose down -v
docker compose up --build
```

## Entwickeln ohne Node.js lokal (VS Code / Antigravity mit Devcontainer)

Wenn du **Node.js nicht lokal installieren** möchtest, nutze den mitgelieferten Devcontainer (`.devcontainer/`).

### VS Code
1. Extension **Dev Containers** installieren (`ms-vscode-remote.remote-containers`).
2. Repo öffnen → Command Palette → **Dev Containers: Reopen in Container**.
3. Im Container-Terminal starten:
   ```bash
   docker compose up --build
   ```

### Antigravity
Antigravity kann Devcontainer ebenfalls öffnen. Wähle das Repo aus und öffne es in der Container-Umgebung. Danach gilt das gleiche Startkommando:

```bash
docker compose up --build
```

**Reset** (DB löschen) im Devcontainer wie gewohnt:

```bash
docker compose down -v
docker compose up --build
```

## Konfiguration (LLM Provider)

Die wichtigsten ENV‑Variablen stehen in `docker-compose.yml` (bei `api` **und** `worker`):

| Variable | Bedeutung |
|---|---|
| `LLM_PROVIDER` | `openai` · `gemini` · `local` (OpenAI‑kompatibel) |
| `LLM_MODEL` | Modellname (z.B. `gpt-4o-mini` oder `gemini-1.5-flash`) |
| `OPENAI_API_KEY` | API‑Key für OpenAI |
| `GEMINI_API_KEY` | API‑Key für Gemini |
| `LOCAL_LLM_BASE_URL` | OpenAI‑kompatible Base URL (z.B. `http://localhost:8000/v1`) |
| `LOCAL_LLM_API_KEY` | optionaler Key |

**Wichtig:** Für echten Betrieb Keys in eine `.env` auslagern (nicht einchecken).

## Beispiel‑Fragen

- „Welche Abos waren im September 2025 am teuersten?“
- „Zeig mir alle Ausgaben am 2025-09-17“
- „Welche Monate habe ich überhaupt hochgeladen?“

**Step 4 (Insights):**

- „Gib mir eine Monatsübersicht für 2025-09“
- „Top Händler im 2025-09“
- „Wie hoch waren meine Fixkosten vs variablen Kosten im 2025-09?“
- „Wo kann ich im 2025-09 sparen?“
- „Zeig mir alle Abos im 2025-09“

**Step 5 (Budgets & Alerts):**

- „Zeig mir meine Budgets“
- „Setze ein Budget für Lebensunterhalt>Einkauf>Supermarkt auf 250“
- „Welche Warnungen gibt es für 2025-09?“
- „Habe ich doppelte Abos im 2025-09?“

**Step 6 (Wizards in der UI):**

Nach dem Import siehst du Buttons:

- „Monatsübersicht“ → Monat auswählen (Buttons) → Tabellen (Top‑Kategorien, Konten)
- „Budgets vorschlagen“ → Monat auswählen → Vorschlagswerte + „Budget setzen …“ Buttons
- „Abos prüfen“ → Monat auswählen → Abo‑Buckets + teure/duplizierte Kandidaten

Optional auch per Chat:

- `intent:budget_wizard`
- `intent:subscriptions_overview`

## Deploy auf Render.com

Dieses Repo ist als Multi‑Service App gedacht. Render startet **kein** `docker-compose.yml` direkt – du legst stattdessen Services an:

- **Postgres** (Render Managed DB)
- **API** (Web Service, Docker)
- **Worker** (Background Worker, Docker)
- **Web** (Static Site, Vite Build)

### Option 1: Blueprint (empfohlen)

Im Repo‑Root liegt eine fertige `render.yaml`. Render Blueprints lesen diese Datei und provisionieren die Ressourcen automatisch.

**Ablauf:**
1. Repo nach GitHub pushen
2. Render Dashboard → **Blueprints** → **New Blueprint Instance** → Repo auswählen
3. Bei Secrets wirst du u.a. nach `OPENAI_API_KEY` / `GEMINI_API_KEY` gefragt (je nach Provider)
4. Deploy starten

**Wichtig (Frontend URL):** `VITE_API_BASE` wird von Vite **zur Build‑Zeit** eingebettet. Nur Variablen mit `VITE_` Prefix sind im Browser sichtbar.  
Wenn du den API‑Service anders nennst oder eine Custom Domain nutzt, setze `VITE_API_BASE` entsprechend und triggere einen Rebuild des Static Sites.

### Option 2: Manuell (ohne Blueprint)

1. Render → New → **PostgreSQL** anlegen
2. Render → New → **Web Service** (Docker) für `apps/api`
   - Dockerfile: `apps/api/Dockerfile`
   - Env: `DATABASE_URL` = Render DB connectionString, `OPENAI_API_KEY` etc.
   - Health Check Path: `/health`
3. Render → New → **Background Worker** (Docker) für `apps/worker`
4. Render → New → **Static Site** für `apps/web`
   - Build: `cd apps/web && npm ci && npm run build`
   - Publish: `apps/web/dist`
   - Env: `VITE_API_BASE=https://<dein-api>.onrender.com`


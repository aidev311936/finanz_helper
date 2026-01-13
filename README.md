# Haushaltmanager (Phase 1 – Step 3: LLM‑Kategorisierung + Chat Q&A)

Minimaler, lauffähiger Prototyp nach deinem Konzept:

- UI = **Chat** (mobil‑first, wenige UI‑Elemente)
- CSV‑Import → **lokale Pseudonymisierung/Maskierung im Browser** (ohne KI)
- Speicherung **anonymisierter Umsätze** in Postgres
- Kategorisierung läuft als **Job** im Worker (ohne Redis) über **austauschbaren LLM‑Provider**
- Chat Q&A: KI nutzt **Tools (SQL)** auf anonymisierte Umsätze, stellt Rückfragen und liefert Buttons/Datepicker

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

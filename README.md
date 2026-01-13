# Haushaltmanager (Phase 1 – Step 3: LLM-Kategorisierung + Chat Q&A)

Dieses Repo ist ein **minimaler, lauffähiger Prototyp** im Stil deines Konzepts:
- UI = **Chat** (mobil-first, wenig UI-Elemente)
- CSV-Import → **lokale Pseudonymisierung/Maskierung im Browser** (ohne KI)
- Speicherung der **anonymisierten Umsätze** in Postgres
- Kategorisierung wird **als Job** angestoßen (Worker) – per **austauschbarem LLM Provider**
- Chat Q&A: KI nutzt **Tools (SQL)** auf anonymisierte Umsätze, stellt Rückfragen und gibt Buttons/Datepicker zurück

## Schnellstart

Voraussetzung: Docker + docker compose

```bash
cd haushaltmanager-chat
docker compose up --build
```

Dann öffnen:
- Frontend: http://localhost:5173
- Backend: http://localhost:8080

## Testen ohne echte Bank

In der DB wird beim ersten Start ein Demo-Mapping `generic_4col` angelegt.
Es erwartet eine CSV **ohne Header** mit 4 Spalten:

1. Datum (dd.MM.yyyy)
2. Text
3. Art
4. Betrag

Beispieldatei liegt hier:
`apps/web/public/sample-generic.csv`

## Unbekannte Bank

Wenn keine Bank erkannt wird, fragt die UI nach dem **Banknamen** und sendet eine Anfrage an:
`POST /api/bank-format-requests`

## Support: Mapping anlegen/updaten (ohne UI)

```bash
curl -X POST http://localhost:8080/api/support/bank-mapping \
  -H 'Content-Type: application/json' \
  -H 'x-support-token: dev-support-token' \
  -d '{
    "bank_name":"mybank",
    "booking_date":["$1"],
    "booking_text":["$2"],
    "booking_type":["$3"],
    "booking_amount":["$4"],
    "booking_date_parse_format":"dd.MM.yyyy",
    "without_header":true,
    "detection": {"without_header": {"column_count":4, "column_markers":["date","text","text","number"]}}
  }'
```

---

## LLM Provider umschalten (OpenAI / Gemini / Local)

In `docker-compose.yml` steuerst du Provider und Modell per Env:

| Variable | Beschreibung |
|---|---|
| `LLM_PROVIDER` | `openai` (Responses API) · `gemini` · `local` (OpenAI-kompatibel) |
| `LLM_MODEL` | Modellname (z.B. `gpt-4o-mini` oder `gemini-1.5-flash`) |
| `OPENAI_API_KEY` | API-Key für OpenAI |
| `GEMINI_API_KEY` | API-Key für Gemini |
| `LOCAL_LLM_BASE_URL` | OpenAI-kompatible Base URL (z.B. `http://localhost:8000/v1`) |
| `LOCAL_LLM_API_KEY` | optionaler Key |

**Wichtig:** Für echten Betrieb Keys in eine `.env` auslagern (nicht einchecken).

## Beispiel-Fragen

- „Welche Abos waren im September 2025 am teuersten?“
- „Zeig mir alle Ausgaben am 2025-09-17“
- „Welche Monate habe ich überhaupt hochgeladen?“

# Finanz Helper Wizard

Dieses Repository implementiert einen neuen Wizard-basierten Finanzberater, der auf der Datenbankstruktur des vorhandenen Umsatz‑Anonymizers aufsetzt. Ziel des Projekts ist es, Anwender schrittweise durch den Import und die erste Analyse von Banktransaktionen zu führen. Die Anonymisierung der Daten und die Bank‑Erkennung laufen im Hintergrund, sodass der Nutzer sich auf die Wizard‑Schritte konzentrieren kann.

## Projektstruktur

```
finanz_helper/
├── backend/      # Express‑API‑Server (Node.js)
│   ├── index.js  # Einstiegspunkt der API
│   ├── package.json
│   └── .env.example
├── frontend/     # Vue‑3‑Anwendung mit Vite
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.js
│       ├── App.vue
│       ├── router.js
│       └── components/
│           ├── Wizard.vue
│           └── Analysis.vue
├── .gitignore
└── README.md     # diese Datei
```

## Voraussetzungen

- Node.js ≥ 18
- Ein laufender PostgreSQL‑Server mit denselben Tabellen wie im Umsatz‑Anonymizer (`user_tokens`, `masked_transactions`, `bank_mapping`).
- Auf Render.com sollten Frontend und Backend als getrennte Services deployed werden.

## Backend

Das Backend basiert auf Express und stellt eine kleine API bereit.

### Starten der API

```
cd backend
npm install
node index.js
```

Die API liest die Umgebungsvariablen `PORT` (Standard 8080) und `DATABASE_URL` für die PostgreSQL‑Verbindung. Eine Vorlage befindet sich in `.env.example`.

### Endpunkte

- `POST /api/import/csv` – akzeptiert eine CSV‑Datei und leitet die Verarbeitung an einen (noch zu implementierenden) Service weiter. Hier soll der Bank‑Import, die Parserkennung und die Anonymisierung stattfinden.
- `GET /api/analysis/summary` – liefert eine Beispiel‑Zusammenfassung über die importierten Transaktionen (noch statisch).

Die eigentliche Logik für Bank‑Mapping, Anonymisierung und das Schreiben in die Datenbank muss in weiteren Dateien ergänzt werden (siehe Kommentar in `backend/index.js`).

## Frontend

Die Frontend‑App basiert auf Vue 3 und wird mit Vite gebündelt. Sie implementiert einen einfachen Zweischritte‑Wizard.

### Entwickeln

```
cd frontend
npm install
npm run dev
```

Die Anwendung ist dann unter http://localhost:5173 erreichbar. Über den Proxy in der `vite.config.js` werden API‑Aufrufe an den Backend‑Server weitergeleitet.

### Build für Production

```
npm run build
```

Das Ergebnis liegt im Verzeichnis `dist/` und kann als statische Site veröffentlicht werden.

## Deployment auf Render.com

Deploye das Backend und das Frontend als separate Web Services:

1. **PostgreSQL‑Datenbank einrichten:** Die gleiche wie im bestehenden Umsatz‑Anonymizer oder eine neue mit den Tabellen aus dem SQL‑Script `001_init.sql` des alten Projekts.
2. **Backend Service:**
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `node index.js`
   - Environment Variables: `DATABASE_URL` und optional `PORT`
3. **Frontend Service (Static Site):**
   - Root Directory: `frontend`
   - Build Command: `npm install && npm run build`
   - Publish Directory: `frontend/dist`
   - Environment Variable: `VITE_BACKEND_BASE_URL` auf die URL des Backend‑Services setzen.

## Hinweis

Dieses Projekt ist ein Ausgangspunkt. Die Endpunkte liefern aktuell noch Beispielwerte; die vollständige Logik für Bank‑Erkennung, Anonymisierung, Import‑Batch‑Verwaltung und Analyse muss basierend auf den Anforderungen des Wizard‑Konzepts ergänzt werden.
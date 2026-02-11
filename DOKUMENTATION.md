# SoR-Quiz – Schule ohne Rassismus – Interaktives Quiz

## Projektstatus (11.02.2026)

### Was ist das?
Ein interaktives Quiz für den Projekttag "Schule ohne Rassismus". Der Presenter steuert das Quiz vom Beamer, Schüler nehmen per Handy teil.

### Links
- **Presenter (Beamer):** https://sor-quiz.maikpickl.de/ (Passwort: `sor2026`)
- **Schüler (Handy):** https://sor-quiz.maikpickl.de/play
- **GitHub Repo:** https://github.com/Maik2501/SoR2026

### Technologie
- **Backend:** Node.js + Express + Socket.io
- **Frontend:** Vanilla JS, Leaflet.js (Karten), QRCode.js
- **Server:** hal-9002, PM2, Caddy (Auto-HTTPS)
- **Port:** 3003

### Quiz-Inhalt (21 Slides)
| Nr | Typ | Inhalt |
|----|-----|--------|
| 1 | Titel | "Teil 1: Historische Wurzeln des Rassismus" |
| 2 | Schätzfrage | Transatlantischer Sklavenhandel – Jahreszahl (1501) |
| 3 | Info | Transatlantischer Sklavenhandel |
| 4 | GeoGuessr | Kongokonferenz – Berlin |
| 5 | Info | Kongokonferenz 1884/85 |
| 6 | GeoGuessr | Völkerschau – Hamburg |
| 7 | Info | Völkerschauen |
| 8 | GeoGuessr | Nürnberger Rassengesetze – Nürnberg |
| 9 | Info | Nürnberger Rassengesetze 1935 |
| 10 | Schätzfrage | Jesse Owens Goldmedaillen (4) |
| 11 | Info | Jesse Owens |
| 12 | GeoGuessr | Mohrenstraße → Amo-Straße – Berlin |
| 13 | Info | Umbenennung 2025 |
| 14 | Titel | "Teil 2: Rassismus im Alltag" |
| 15 | Video | Datteltäter – "Agentur für Reinkultur" (YouTube) |
| 16-20 | Multiple Choice | 5 Pub-Quiz-Fragen zum Video (je 20 Punkte) |
| 21 | Ende | Abschluss-Slide |

### Fragetypen & Punktevergabe
- **GeoGuessr (Karte):** Max 100 Punkte, exponentieller Abfall (halbiert alle 1000 km)
- **Schätzfrage:** Max 100 Punkte, exponentieller Abfall (konfigurierbare Halbwertszeit)
- **Multiple Choice:** 20 Punkte bei richtiger Antwort

### Server-Konfiguration
- **App-Verzeichnis:** `/opt/sor-quiz`
- **PM2 Prozessname:** `sor-quiz`
- **Caddy-Config:** `/etc/caddy/Caddyfile`
- **.env auf Server:** `/opt/sor-quiz/.env` (PORT=3003, ADMIN_PASSWORD=sor2026)

---

## Änderungen live stellen (Deployment)

### Option 1: GitHub + Server-SSH (Standard)
Am einfachsten wenn du Zugang zu einem Terminal hast:

```bash
# 1. Lokal committen & pushen
git add -A
git commit -m "Beschreibung der Änderung"
git push

# 2. Auf dem Server (SSH)
ssh maik@hal-9002
cd /opt/sor-quiz
git pull
pm2 restart sor-quiz
```

### Option 2: Direkt auf GitHub editieren (ohne lokales Git)
Perfekt für die Schule – braucht nur einen Browser!

1. Geh zu https://github.com/Maik2501/SoR2026
2. Navigiere zur Datei (z.B. `data/quiz.json`)
3. Klick den ✏️ Stift-Button → Datei direkt bearbeiten
4. "Commit changes" klicken
5. Dann per SSH auf dem Server:
   ```bash
   ssh maik@hal-9002
   cd /opt/sor-quiz && git pull && pm2 restart sor-quiz
   ```

### Option 3: GitHub + automatisches Deployment (Webhook)
Wenn du magst, kann ein Webhook eingerichtet werden, sodass nach jedem Push automatisch `git pull && pm2 restart` auf dem Server ausgeführt wird. Dann entfällt Schritt 5 aus Option 2 komplett.

### Option 4: VS Code im Browser (github.dev)
1. Gehe zu https://github.dev/Maik2501/SoR2026
2. Vollständiger VS Code Editor im Browser – alle Dateien editierbar
3. Änderungen committen über die Source Control Sidebar
4. Dann nur noch SSH: `cd /opt/sor-quiz && git pull && pm2 restart sor-quiz`

---

## Wichtige Dateien
| Datei | Beschreibung |
|-------|-------------|
| `server.js` | Backend: Express, Socket.io, Spiellogik, Scoring, Auth |
| `data/quiz.json` | Alle Fragen & Slides (hier editieren für neue Fragen!) |
| `public/js/presenter.js` | Beamer-Ansicht Logik |
| `public/js/student.js` | Schüler-Handy Logik |
| `public/presenter.html` | Beamer HTML |
| `public/student.html` | Schüler HTML |
| `public/css/presenter.css` | Beamer Styles |
| `public/css/student.css` | Schüler Styles |
| `public/images/` | Bilder (Logo, Fragebilder) |
| `.env` | Konfiguration (nicht in Git!) |

## Neue Fragen hinzufügen
Einfach in `data/quiz.json` einen neuen Eintrag ergänzen. Beispiele:

**GeoGuessr:**
```json
{
  "type": "map",
  "question": "Wo fand X statt?",
  "image": "/images/bild.jpg",
  "answer": { "lat": 52.52, "lng": 13.405 },
  "answerLabel": "Berlin",
  "time": 30,
  "points": 100
}
```

**Multiple Choice:**
```json
{
  "type": "multi",
  "question": "Frage?",
  "answers": ["A", "B", "C", "D"],
  "correct": 0,
  "time": 20,
  "points": 20
}
```

**Schätzfrage:**
```json
{
  "type": "estimation",
  "question": "Wie viele...?",
  "answer": 42,
  "tolerance": 100,
  "halfLife": 10,
  "unit": "Stück",
  "time": 30,
  "points": 100
}
```

**Info-Slide:**
```json
{
  "type": "info",
  "title": "Titel",
  "content": "<p>HTML-Inhalt</p>"
}
```

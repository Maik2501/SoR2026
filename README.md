# 📚 SoR-Quiz – Schule ohne Rassismus

Interaktive Quiz-Präsentation für Veranstaltungen von "Schule ohne Rassismus – Schule mit Courage".

## Features

- 🖥️ **Presenter-Modus**: Vollbild-Präsentation für den Beamer
- 📱 **Schüler-Modus**: Mobile-optimierte Ansicht zum Mitspielen
- 📍 **GeoGuessr-Karten**: Standortbasierte Fragen mit Leaflet-Karte
- ✅ **Multiple Choice**, Wahr/Falsch, Schätzfragen, Sortierung
- 📹 **Video-Einbettung**: YouTube & lokale Videos
- 🏆 **Echtzeit-Leaderboard** mit Punkte-System
- 📲 **QR-Code** zum einfachen Beitreten
- ⏱️ **Timer** mit automatischer Auswertung

## Schnellstart

### 1. Dependencies installieren

```bash
npm install
```

### 2. Server starten

```bash
npm start
```

### 3. Öffnen

- **Presenter (Beamer)**: [http://localhost:3000](http://localhost:3000)
- **Schüler (Handy)**: Die URL wird im Presenter angezeigt + QR-Code

> Alle Geräte müssen im **gleichen WLAN** sein!

## Quiz anpassen

Die Quiz-Inhalte befinden sich in `data/quiz.json`. Folgende Folien-Typen sind verfügbar:

### Titelfolie

```json
{
  "type": "title",
  "title": "Mein Quiz-Titel",
  "subtitle": "Untertitel"
}
```

### Informationsfolie

```json
{
  "type": "info",
  "title": "Überschrift",
  "content": "Text mit **Markdown-Formatierung**...",
  "image": "/images/meinbild.jpg",
  "imageCaption": "Bildunterschrift"
}
```

### Multiple Choice

```json
{
  "type": "multiple-choice",
  "question": "Die Frage?",
  "options": ["Antwort A", "Antwort B", "Antwort C", "Antwort D"],
  "correct": 1,
  "image": "/images/optional.jpg",
  "timeLimit": 20,
  "points": 500
}
```

`correct` ist der Index der richtigen Antwort (0 = erste Option).

### Wahr/Falsch

```json
{
  "type": "true-false",
  "question": "Aussage, die wahr oder falsch ist.",
  "answer": true,
  "timeLimit": 15,
  "points": 500
}
```

### Schätzfrage

```json
{
  "type": "estimation",
  "question": "Wie viele...?",
  "answer": 42,
  "unit": "Stück",
  "tolerance": 5,
  "hint": "Tipp: ...",
  "timeLimit": 25,
  "points": 500
}
```

### 📍 Kartenfrage (GeoGuessr-Stil)

```json
{
  "type": "map",
  "question": "Wo wurde dieses Bild aufgenommen?",
  "image": "/images/meinfoto.jpg",
  "answer": { "lat": 53.55, "lng": 9.99 },
  "answerLabel": "Hamburg",
  "mapCenter": [50, 10],
  "mapZoom": 4,
  "maxRadius": 3000,
  "timeLimit": 45,
  "points": 1000
}
```

- `answer`: Korrekte Koordinaten (lat/lng)
- `maxRadius`: Maximaler Radius in km für Punkte (weiter weg = 0 Punkte)
- `mapCenter`/`mapZoom`: Anfangsansicht der Karte
- Punkte werden basierend auf der Entfernung berechnet (Haversine-Formel)

### Sortierung

```json
{
  "type": "sort",
  "question": "Bringe in die richtige Reihenfolge:",
  "items": ["C", "A", "B"],
  "correctOrder": ["A", "B", "C"],
  "timeLimit": 60,
  "points": 800
}
```

### Video

```json
{
  "type": "video",
  "title": "Schau dir das Video an",
  "videoUrl": "https://youtube.com/watch?v=VIDEO_ID",
  "videoType": "youtube",
  "question": "Optionale Frage zum Video"
}
```

## Bilder hinzufügen

Lege Bilder in den Ordner `public/images/` und referenziere sie als `/images/dateiname.jpg`.

## Für die Völkerschau-Frage

Lege dein Bild der Hamburger Völkerschau in `public/images/` und aktualisiere den Pfad in `data/quiz.json` (Slides 6 und 7).

## Tipps für die Veranstaltung

1. **Vor der Veranstaltung**: Quiz lokal testen, Bilder einfügen
2. **WLAN**: Stelle sicher, dass ein gemeinsames WLAN verfügbar ist
3. **QR-Code**: Wird automatisch generiert – Schüler scannen ihn mit der Handy-Kamera
4. **Präsentation**: Nutze die Pfeiltasten (← →) oder die Buttons zur Navigation
5. **Timer**: Startet automatisch bei Fragen, kann manuell gestoppt werden

## Schüler-Quizze erstellen

Für die Phase, in der Schüler eigene Quizze erstellen, empfehlen wir:
- **[Kahoot](https://kahoot.com)** – Kostenlos für Schulen
- **[Mentimeter](https://mentimeter.com)** – Interaktive Präsentationen
- **[Quizizz](https://quizizz.com)** – Quiz im eigenen Tempo

## Technologie

- Node.js + Express (Server)
- Socket.io (Echtzeit-Kommunikation)
- Leaflet.js (Karten/GeoGuessr)
- Vanilla JS (kein Framework nötig)

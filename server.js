const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// .env laden (falls vorhanden)
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  envFile.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
} catch (e) { /* keine .env Datei */ }

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,     // Alle 10s ein Ping
  pingTimeout: 30000,      // 30s warten auf Pong bevor Disconnect
  connectTimeout: 60000,   // 60s Timeout beim Verbinden
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sor2026';
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');

// Aktive Admin-Sessions
const adminSessions = new Set();

// Disconnect-Grace-Period: Spieler behalten für Reconnect
const DISCONNECT_GRACE_MS = 5 * 60 * 1000; // 5 Minuten
const disconnectedPlayers = new Map(); // name -> { playerData, timeout, oldSocketId }

// --- Middleware ---
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Cookie-Parser (einfach, ohne dependency)
function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [key, ...val] = c.trim().split('=');
    if (key) cookies[key] = val.join('=');
  });
  return cookies;
}

// Admin-Auth prüfen
function isAdmin(req) {
  const cookies = parseCookies(req);
  return cookies.sor_session && adminSessions.has(cookies.sor_session);
}

// --- Statische Dateien (für /play, CSS, JS, images) ---
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/data', express.static(path.join(__dirname, 'data')));

// --- Quiz-Daten laden ---
function loadQuizData() {
  const raw = fs.readFileSync(path.join(__dirname, 'data', 'quiz.json'), 'utf-8');
  return JSON.parse(raw);
}

// --- Spielstand ---
let gameState = {
  status: 'waiting',       // waiting | active | paused | finished
  currentSlideIndex: 0,
  players: {},              // socketId -> { name, score, answers }
  answers: {},              // socketId -> answer für aktuelle Frage
  timerEnd: null,
  quizData: null,
  questionActive: false,
  revealAnswer: false,
};

function resetGame() {
  gameState = {
    status: 'waiting',
    currentSlideIndex: 0,
    players: {},
    answers: {},
    timerEnd: null,
    quizData: loadQuizData(),
    questionActive: false,
    revealAnswer: false,
  };
}

// --- Hilfsfunktionen ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function getCurrentSlide() {
  if (!gameState.quizData) return null;
  return gameState.quizData.slides[gameState.currentSlideIndex] || null;
}

function isQuestionSlide(slide) {
  return ['multiple-choice', 'true-false', 'estimation', 'map', 'sort'].includes(slide?.type);
}

// Haversine-Formel für Entfernung in km
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Punkte berechnen je nach Fragetyp
function calculatePoints(slide, answer) {
  if (!answer || answer.value === undefined || answer.value === null) return 0;

  const maxPoints = slide.points || 1000;

  switch (slide.type) {
    case 'multiple-choice': {
      return answer.value === slide.correct ? maxPoints : 0;
    }
    case 'true-false': {
      return answer.value === slide.answer ? maxPoints : 0;
    }
    case 'estimation': {
      const diff = Math.abs(answer.value - slide.answer);
      if (diff === 0) return maxPoints;
      const halfLife = slide.halfLife || 50; // Halbierung alle X Einheiten
      const maxDiff = slide.tolerance || (slide.answer * 0.5);
      if (diff >= maxDiff) return 0;
      // Exponentieller Abfall: Halbierung alle halfLife Einheiten
      return Math.round(maxPoints * Math.pow(2, -diff / halfLife));
    }
    case 'map': {
      const maxRadius = slide.maxRadius || 15000; // km
      if (!answer.value || answer.value.lat === undefined || answer.value.lng === undefined) return 0;
      const dist = haversineDistance(
        answer.value.lat, answer.value.lng,
        slide.answer.lat, slide.answer.lng
      );
      if (dist >= maxRadius) return 0;
      // Exponentieller Abfall: Halbierung alle 1000km
      // 0km=100, 500km≈71, 1000km≈50, 2000km≈25, 3000km≈13, 5000km≈3
      const points = Math.round(maxPoints * Math.pow(2, -dist / 1000));
      return Math.max(0, points);
    }
    case 'sort': {
      // Punkte basierend auf korrekt platzierten Items
      const correct = slide.correctOrder;
      let correctCount = 0;
      if (Array.isArray(answer.value)) {
        answer.value.forEach((item, i) => {
          if (item === correct[i]) correctCount++;
        });
      }
      return Math.round(maxPoints * (correctCount / correct.length));
    }
    default:
      return 0;
  }
}

// Zeitbonus: schnellere Antworten bekommen mehr Punkte
function getTimeBonus(answer, timeLimit) {
  if (!answer.timestamp || !timeLimit) return 1;
  const elapsed = answer.timestamp;
  const ratio = Math.max(0, 1 - elapsed / (timeLimit * 1000));
  return 0.5 + 0.5 * ratio; // 50-100% der Punkte je nach Geschwindigkeit
}

function processAnswers() {
  const slide = getCurrentSlide();
  if (!slide || !isQuestionSlide(slide)) return;

  const results = {};

  for (const [socketId, answer] of Object.entries(gameState.answers)) {
    const basePoints = calculatePoints(slide, answer);
    // Kein Zeitbonus bei Karten- und Schätzfragen
    const timeBonus = (slide.type === 'map' || slide.type === 'estimation') ? 1 : getTimeBonus(answer, slide.timeLimit);
    const points = Math.round(basePoints * timeBonus);

    // Entfernung/Abstand berechnen
    let distance = null;
    let diff = null;
    if (slide.type === 'map' && answer.value && answer.value.lat !== undefined) {
      distance = Math.round(haversineDistance(
        answer.value.lat, answer.value.lng,
        slide.answer.lat, slide.answer.lng
      ));
      console.log(`[MAP] Spieler ${socketId}: Tipp=(${answer.value.lat.toFixed(2)}, ${answer.value.lng.toFixed(2)}), Distanz=${distance}km, Punkte=${points}`);
    } else if (slide.type === 'estimation' && answer.value !== undefined) {
      diff = Math.abs(answer.value - slide.answer);
      console.log(`[EST] Spieler ${socketId}: Tipp=${answer.value}, Korrekt=${slide.answer}, Diff=${diff}, Punkte=${points}`);
    }

    results[socketId] = {
      points,
      correct: basePoints > 0,
      answer: answer.value,
      distance,
      diff,
    };

    // Punkte zum Spielerstand addieren
    if (gameState.players[socketId]) {
      gameState.players[socketId].score += points;
    }
  }

  return results;
}

function getLeaderboard() {
  return Object.entries(gameState.players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score, avatar: p.avatar }))
    .sort((a, b) => b.score - a.score);
}

function getPlayerCount() {
  return Object.keys(gameState.players).length;
}

function getAnswerCount() {
  return Object.keys(gameState.answers).length;
}

// Slide-Daten für Schüler aufbereiten (ohne Lösung!)
function getStudentSlideData(slide) {
  if (!slide) return null;

  const base = {
    id: slide.id,
    type: slide.type,
    title: slide.title,
    question: slide.question,
    image: slide.image,
    timeLimit: slide.timeLimit,
    points: slide.points,
  };

  switch (slide.type) {
    case 'multiple-choice':
      base.options = slide.options;
      break;
    case 'true-false':
      break;
    case 'estimation':
      base.unit = slide.unit;
      base.hint = slide.hint;
      break;
    case 'map':
      base.mapCenter = slide.mapCenter || [20, 0];
      base.mapZoom = slide.mapZoom || 2;
      break;
    case 'sort':
      // Items in zufälliger Reihenfolge schicken
      base.items = [...(slide.items || [])].sort(() => Math.random() - 0.5);
      break;
    case 'video':
      base.videoUrl = slide.videoUrl;
      base.videoType = slide.videoType;
      base.followUpQuestions = slide.followUpQuestions?.map(q => {
        const fq = { ...q };
        delete fq.correct;
        delete fq.answer;
        return fq;
      });
      break;
  }

  return base;
}

// --- Timer ---
let timerInterval = null;

function startTimer(seconds) {
  if (timerInterval) clearInterval(timerInterval);

  gameState.timerEnd = Date.now() + seconds * 1000;
  gameState.questionActive = true;
  gameState.revealAnswer = false;

  timerInterval = setInterval(() => {
    const remaining = Math.max(0, gameState.timerEnd - Date.now());
    io.emit('timer-update', { remaining: Math.ceil(remaining / 1000) });

    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      gameState.questionActive = false;

      // Automatisch auswerten
      const results = processAnswers();
      gameState.revealAnswer = true;

      console.log('[TIME-UP] Results:', JSON.stringify(results, null, 2));

      io.emit('time-up', {
        results,
        correctAnswer: getCurrentSlide(),
        leaderboard: getLeaderboard(),
      });
    }
  }, 250);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  gameState.questionActive = false;
}

// --- Socket.io ---
io.on('connection', (socket) => {
  console.log(`Verbindung: ${socket.id}`);

  // Presenter meldet sich an
  socket.on('presenter-connect', () => {
    socket.join('presenter');
    socket.emit('game-state', {
      ...gameState,
      ip: getLocalIP(),
      port: PORT,
    });
    console.log('Presenter verbunden');
  });

  // Schüler tritt bei (mit Reconnect-Support)
  socket.on('player-join', (data) => {
    const name = (data.name || 'Anonym').trim().substring(0, 20);
    const avatar = data.avatar || '🎓';

    // Prüfe ob Spieler reconnected (gleicher Name)
    const disconnected = disconnectedPlayers.get(name);
    if (disconnected) {
      // Reconnect: alten Spielstand wiederherstellen
      clearTimeout(disconnected.timeout);
      disconnectedPlayers.delete(name);

      // Alten Socket-Eintrag entfernen, neuen anlegen
      delete gameState.players[disconnected.oldSocketId];
      delete gameState.answers[disconnected.oldSocketId];

      gameState.players[socket.id] = disconnected.playerData;
      console.log(`Spieler "${name}" reconnected (Score: ${disconnected.playerData.score})`);
    } else {
      gameState.players[socket.id] = {
        name,
        avatar,
        score: 0,
        answers: [],
      };
    }

    socket.join('students');

    const restoredScore = gameState.players[socket.id].score || 0;
    socket.emit('join-success', {
      name,
      avatar: gameState.players[socket.id].avatar || avatar,
      playerCount: getPlayerCount(),
      reconnected: !!disconnected,
      score: restoredScore,
    });

    // Aktuellen Slide senden
    const slide = getCurrentSlide();
    if (slide && gameState.status === 'active') {
      socket.emit('slide-changed', {
        slide: getStudentSlideData(slide),
        slideIndex: gameState.currentSlideIndex,
        totalSlides: gameState.quizData.slides.length,
        questionActive: gameState.questionActive,
        revealAnswer: gameState.revealAnswer,
      });
    }

    io.to('presenter').emit('player-joined', {
      id: socket.id,
      name,
      avatar,
      playerCount: getPlayerCount(),
    });

    console.log(`Spieler "${name}" beigetreten (${getPlayerCount()} Spieler)`);
  });

  // Quiz starten
  socket.on('start-quiz', () => {
    gameState.quizData = loadQuizData();
    gameState.status = 'active';
    gameState.currentSlideIndex = 0;
    gameState.answers = {};

    // Punktestand zurücksetzen
    for (const player of Object.values(gameState.players)) {
      player.score = 0;
      player.answers = [];
    }

    const slide = getCurrentSlide();
    io.emit('quiz-started', {
      totalSlides: gameState.quizData.slides.length,
    });

    emitSlideChange(slide);
    console.log('Quiz gestartet');
  });

  // Nächste Folie
  socket.on('next-slide', () => {
    if (!gameState.quizData) return;

    // Falls Timer noch läuft, stoppen und auswerten
    if (gameState.questionActive) {
      stopTimer();
      const results = processAnswers();
      gameState.revealAnswer = true;
      io.emit('time-up', {
        results,
        correctAnswer: getCurrentSlide(),
        leaderboard: getLeaderboard(),
      });
      return;
    }

    if (gameState.currentSlideIndex < gameState.quizData.slides.length - 1) {
      gameState.currentSlideIndex++;
      gameState.answers = {};
      gameState.revealAnswer = false;
      const slide = getCurrentSlide();
      emitSlideChange(slide);
    } else {
      // Quiz beendet
      gameState.status = 'finished';
      io.emit('quiz-finished', {
        leaderboard: getLeaderboard(),
      });
    }
  });

  // Vorherige Folie
  socket.on('prev-slide', () => {
    if (!gameState.quizData) return;
    if (gameState.questionActive) return; // Nicht zurück während Frage aktiv
    if (gameState.currentSlideIndex > 0) {
      gameState.currentSlideIndex--;
      gameState.answers = {};
      gameState.revealAnswer = false;
      const slide = getCurrentSlide();
      emitSlideChange(slide);
    }
  });

  // Timer manuell starten
  socket.on('start-timer', (data) => {
    const slide = getCurrentSlide();
    if (!slide) return;
    const seconds = data?.seconds || slide.timeLimit || 30;
    gameState.answers = {};
    startTimer(seconds);
    io.emit('question-active', {
      slide: getStudentSlideData(slide),
      timeLimit: seconds,
    });
  });

  // Antwort empfangen
  socket.on('submit-answer', (data) => {
    if (!gameState.questionActive) return;
    if (gameState.answers[socket.id]) return; // Nur eine Antwort

    const elapsed = gameState.timerEnd ? (gameState.timerEnd - Date.now()) : 0;
    const timeLimit = getCurrentSlide()?.timeLimit || 30;
    const timestamp = (timeLimit * 1000) - elapsed;

    gameState.answers[socket.id] = {
      value: data.value,
      timestamp,
    };

    // Presenter über neue Antwort informieren
    io.to('presenter').emit('answer-received', {
      playerId: socket.id,
      playerName: gameState.players[socket.id]?.name || 'Anonym',
      answerCount: getAnswerCount(),
      playerCount: getPlayerCount(),
    });

    socket.emit('answer-confirmed');

    console.log(`Antwort von ${gameState.players[socket.id]?.name}: ${JSON.stringify(data.value)}`);

    // Wenn alle geantwortet haben, Timer vorzeitig beenden
    if (getAnswerCount() >= getPlayerCount() && getPlayerCount() > 0) {
      stopTimer();
      const results = processAnswers();
      gameState.revealAnswer = true;

      console.log('[ALL-ANSWERED] Results:', JSON.stringify(results, null, 2));

      io.emit('time-up', {
        results,
        correctAnswer: getCurrentSlide(),
        leaderboard: getLeaderboard(),
      });
    }
  });

  // Leaderboard anfordern
  socket.on('get-leaderboard', () => {
    socket.emit('leaderboard', { leaderboard: getLeaderboard() });
  });

  // Quiz zurücksetzen
  socket.on('reset-quiz', () => {
    stopTimer();
    const players = { ...gameState.players };
    resetGame();
    gameState.players = players;
    for (const player of Object.values(gameState.players)) {
      player.score = 0;
      player.answers = [];
    }
    io.emit('quiz-reset');
    console.log('Quiz zurückgesetzt');
  });

  // Verbindung getrennt — Grace Period statt sofortigem Löschen
  socket.on('disconnect', () => {
    if (gameState.players[socket.id]) {
      const playerData = { ...gameState.players[socket.id] };
      const name = playerData.name;

      // Spieler in Grace-Period verschieben (nicht sofort löschen)
      const timeout = setTimeout(() => {
        // Nach Grace Period endgültig entfernen
        disconnectedPlayers.delete(name);
        delete gameState.players[socket.id];
        delete gameState.answers[socket.id];
        io.to('presenter').emit('player-left', {
          id: socket.id,
          name,
          playerCount: getPlayerCount(),
        });
        console.log(`Spieler "${name}" endgültig entfernt (Grace Period abgelaufen)`);
      }, DISCONNECT_GRACE_MS);

      disconnectedPlayers.set(name, {
        playerData,
        timeout,
        oldSocketId: socket.id,
      });

      io.to('presenter').emit('player-disconnected', {
        id: socket.id,
        name,
        playerCount: getPlayerCount(),
      });
      console.log(`Spieler "${name}" disconnected — ${DISCONNECT_GRACE_MS / 1000}s Grace Period`);
    }
  });
});

function emitSlideChange(slide) {
  // Presenter bekommt alles
  io.to('presenter').emit('slide-changed', {
    slide,
    slideIndex: gameState.currentSlideIndex,
    totalSlides: gameState.quizData.slides.length,
    questionActive: false,
    leaderboard: getLeaderboard(),
    playerCount: getPlayerCount(),
  });

  // Schüler bekommen aufbereitete Version (ohne Lösung)
  io.to('students').emit('slide-changed', {
    slide: getStudentSlideData(slide),
    slideIndex: gameState.currentSlideIndex,
    totalSlides: gameState.quizData.slides.length,
    questionActive: false,
  });

  // Bei Fragen: Timer automatisch starten
  if (isQuestionSlide(slide) && slide.timeLimit) {
    setTimeout(() => {
      gameState.answers = {};
      startTimer(slide.timeLimit);
      io.emit('question-active', {
        slide: getStudentSlideData(slide),
        timeLimit: slide.timeLimit,
      });
    }, 2000); // 2 Sekunden Verzögerung damit Schüler die Frage lesen können
  }
}

// --- Routen ---

// Login-Seite
app.get('/login', (req, res) => {
  const error = req.query.error ? '<p style="color:#e94560;margin-bottom:1rem;">Falsches Passwort</p>' : '';
  res.send(`<!DOCTYPE html>
<html lang="de"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SoR Quiz — Login</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .login-card{background:#fff;border-radius:16px;padding:2.5rem;max-width:400px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,0.08);text-align:center}
    .login-card img{width:80px;margin-bottom:1rem}
    h1{font-size:1.4rem;margin-bottom:0.5rem;color:#1a1a2e}
    .sub{color:#6b7280;margin-bottom:1.5rem;font-size:0.95rem}
    input{width:100%;padding:0.8rem 1rem;font-size:1rem;border:2px solid #e5e7eb;border-radius:8px;font-family:'Inter',sans-serif;margin-bottom:1rem}
    input:focus{outline:none;border-color:#e94560}
    button{width:100%;padding:0.8rem;font-size:1rem;font-weight:600;background:#e94560;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Inter',sans-serif}
    button:hover{background:#d63851}
  </style>
</head><body>
  <div class="login-card">
    <img src="/images/logo.png" alt="Logo">
    <h1>SoR Quiz — Admin</h1>
    <p class="sub">Presenter-Zugang</p>
    ${error}
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Passwort" autofocus required>
      <button type="submit">Anmelden</button>
    </form>
  </div>
</body></html>`);
});

// Login verarbeiten
app.post('/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const sessionId = crypto.randomBytes(24).toString('hex');
    adminSessions.add(sessionId);
    res.setHeader('Set-Cookie', `sor_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

// Logout
app.get('/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.sor_session) adminSessions.delete(cookies.sor_session);
  res.setHeader('Set-Cookie', 'sor_session=; Path=/; Max-Age=0');
  res.redirect('/login');
});

// Presenter (geschützt)
app.get('/', (req, res) => {
  if (!isAdmin(req)) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'presenter.html'));
});

// Schüler (offen)
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

// Socket.io Client (muss erreichbar sein)
app.get('/socket.io/*', (req, res, next) => next());

app.get('/api/ip', (req, res) => {
  res.json({ ip: getLocalIP(), port: PORT });
});

// --- Server starten ---
resetGame();

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    📚 Schule ohne Rassismus - Quiz gestartet    ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Presenter: http://localhost:${PORT}              ║`);
  console.log(`║  Schüler:   http://${ip}:${PORT}/play        ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});

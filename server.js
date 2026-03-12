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
  pingInterval: 10000,
  pingTimeout: 30000,
  connectTimeout: 60000,
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sor2026';

// Aktive Admin-Sessions
const adminSessions = new Set();

// ========== ROOM-BASED GAME MANAGEMENT ==========
const rooms = new Map(); // roomCode -> RoomState
const ROOM_TIMEOUT_MS = 60 * 60 * 1000; // 60 Min Inaktivität -> Raum löschen
const DISCONNECT_GRACE_MS = 5 * 60 * 1000; // 5 Minuten

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I, O, 0, 1
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = generateRoomCode();
  const room = {
    code,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    status: 'waiting', // waiting | active | finished
    currentSlideIndex: 0,
    players: {},
    answers: {},
    timerEnd: null,
    quizData: loadQuizData(),
    questionActive: false,
    revealAnswer: false,
    timerInterval: null,
    presenterSocketId: null,
    disconnectedPlayers: new Map(),
  };
  rooms.set(code, room);
  console.log(`[ROOM] Raum ${code} erstellt (${rooms.size} aktive Räume)`);
  return room;
}

function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.timerInterval) clearInterval(room.timerInterval);
  for (const [, dp] of room.disconnectedPlayers) {
    clearTimeout(dp.timeout);
  }
  rooms.delete(code);
  console.log(`[ROOM] Raum ${code} gelöscht (${rooms.size} aktive Räume)`);
}

function touchRoom(room) {
  room.lastActivity = Date.now();
}

// Room-Cleanup alle 5 Minuten
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TIMEOUT_MS) {
      console.log(`[CLEANUP] Raum ${code} wird wegen Inaktivität gelöscht`);
      io.to(`room:${code}`).emit('room-expired');
      deleteRoom(code);
    }
  }
}, 5 * 60 * 1000);

// --- Middleware ---
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [key, ...val] = c.trim().split('=');
    if (key) cookies[key] = val.join('=');
  });
  return cookies;
}

function isAdmin(req) {
  const cookies = parseCookies(req);
  return cookies.sor_session && adminSessions.has(cookies.sor_session);
}

// --- Statische Dateien ---
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/data', express.static(path.join(__dirname, 'data')));

// --- Quiz-Daten laden ---
function loadQuizData() {
  const raw = fs.readFileSync(path.join(__dirname, 'data', 'quiz.json'), 'utf-8');
  return JSON.parse(raw);
}

// --- Hilfsfunktionen ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function getCurrentSlide(room) {
  if (!room.quizData) return null;
  return room.quizData.slides[room.currentSlideIndex] || null;
}

function isQuestionSlide(slide) {
  return ['multiple-choice', 'true-false', 'estimation', 'map', 'sort'].includes(slide?.type);
}

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

function calculatePoints(slide, answer) {
  if (!answer || answer.value === undefined || answer.value === null) return 0;
  const maxPoints = slide.points || 1000;

  switch (slide.type) {
    case 'multiple-choice':
      return answer.value === slide.correct ? maxPoints : 0;
    case 'true-false':
      return answer.value === slide.answer ? maxPoints : 0;
    case 'estimation': {
      const diff = Math.abs(answer.value - slide.answer);
      if (diff === 0) return maxPoints;
      const halfLife = slide.halfLife || 50;
      const maxDiff = slide.tolerance || (slide.answer * 0.5);
      if (diff >= maxDiff) return 0;
      return Math.round(maxPoints * Math.pow(2, -diff / halfLife));
    }
    case 'map': {
      const maxRadius = slide.maxRadius || 15000;
      if (!answer.value || answer.value.lat === undefined || answer.value.lng === undefined) return 0;
      const dist = haversineDistance(answer.value.lat, answer.value.lng, slide.answer.lat, slide.answer.lng);
      if (dist >= maxRadius) return 0;
      return Math.max(0, Math.round(maxPoints * Math.pow(2, -dist / 1000)));
    }
    case 'sort': {
      const correct = slide.correctOrder;
      let correctCount = 0;
      if (Array.isArray(answer.value)) {
        answer.value.forEach((item, i) => { if (item === correct[i]) correctCount++; });
      }
      return Math.round(maxPoints * (correctCount / correct.length));
    }
    default: return 0;
  }
}

function getTimeBonus(answer, timeLimit) {
  if (!answer.timestamp || !timeLimit) return 1;
  const ratio = Math.max(0, 1 - answer.timestamp / (timeLimit * 1000));
  return 0.5 + 0.5 * ratio;
}

function processAnswers(room) {
  const slide = getCurrentSlide(room);
  if (!slide || !isQuestionSlide(slide)) return;
  const results = {};

  for (const [socketId, answer] of Object.entries(room.answers)) {
    const basePoints = calculatePoints(slide, answer);
    const timeBonus = (slide.type === 'map' || slide.type === 'estimation') ? 1 : getTimeBonus(answer, slide.timeLimit);
    const points = Math.round(basePoints * timeBonus);

    let distance = null;
    let diff = null;
    if (slide.type === 'map' && answer.value && answer.value.lat !== undefined) {
      distance = Math.round(haversineDistance(answer.value.lat, answer.value.lng, slide.answer.lat, slide.answer.lng));
    } else if (slide.type === 'estimation' && answer.value !== undefined) {
      diff = Math.abs(answer.value - slide.answer);
    }

    results[socketId] = { points, correct: basePoints > 0, answer: answer.value, distance, diff };
    if (room.players[socketId]) room.players[socketId].score += points;
  }
  return results;
}

function getLeaderboard(room) {
  return Object.entries(room.players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score, avatar: p.avatar }))
    .sort((a, b) => b.score - a.score);
}

function getPlayerCount(room) {
  return Object.keys(room.players).length;
}

function getAnswerCount(room) {
  return Object.keys(room.answers).length;
}

function getStudentSlideData(slide) {
  if (!slide) return null;
  const base = {
    id: slide.id, type: slide.type, title: slide.title,
    question: slide.question, image: slide.image,
    timeLimit: slide.timeLimit, points: slide.points,
  };

  switch (slide.type) {
    case 'multiple-choice': base.options = slide.options; break;
    case 'true-false': break;
    case 'estimation': base.unit = slide.unit; base.hint = slide.hint; break;
    case 'map': base.mapCenter = slide.mapCenter || [20, 0]; base.mapZoom = slide.mapZoom || 2; break;
    case 'sort': base.items = [...(slide.items || [])].sort(() => Math.random() - 0.5); break;
    case 'video':
      base.videoUrl = slide.videoUrl; base.videoType = slide.videoType;
      base.followUpQuestions = slide.followUpQuestions?.map(q => { const fq = { ...q }; delete fq.correct; delete fq.answer; return fq; });
      break;
  }
  return base;
}

// --- Timer (per Room) ---
function startTimer(room, seconds) {
  if (room.timerInterval) clearInterval(room.timerInterval);
  room.timerEnd = Date.now() + seconds * 1000;
  room.questionActive = true;
  room.revealAnswer = false;

  room.timerInterval = setInterval(() => {
    const remaining = Math.max(0, room.timerEnd - Date.now());
    io.to(`room:${room.code}`).emit('timer-update', { remaining: Math.ceil(remaining / 1000) });

    if (remaining <= 0) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      room.questionActive = false;

      const results = processAnswers(room);
      room.revealAnswer = true;

      io.to(`room:${room.code}`).emit('time-up', {
        results,
        correctAnswer: getCurrentSlide(room),
        leaderboard: getLeaderboard(room),
      });
    }
  }, 250);
}

function stopTimer(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  room.questionActive = false;
}

function emitSlideChange(room, slide) {
  io.to(`presenter:${room.code}`).emit('slide-changed', {
    slide,
    slideIndex: room.currentSlideIndex,
    totalSlides: room.quizData.slides.length,
    questionActive: false,
    leaderboard: getLeaderboard(room),
    playerCount: getPlayerCount(room),
  });

  io.to(`students:${room.code}`).emit('slide-changed', {
    slide: getStudentSlideData(slide),
    slideIndex: room.currentSlideIndex,
    totalSlides: room.quizData.slides.length,
    questionActive: false,
  });

  if (isQuestionSlide(slide) && slide.timeLimit) {
    setTimeout(() => {
      room.answers = {};
      startTimer(room, slide.timeLimit);
      io.to(`room:${room.code}`).emit('question-active', {
        slide: getStudentSlideData(slide),
        timeLimit: slide.timeLimit,
      });
    }, 2000);
  }
}

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
  let roomCode = null;

  // --- Room erstellen ---
  socket.on('create-room', (callback) => {
    const room = createRoom();
    roomCode = room.code;
    room.presenterSocketId = socket.id;
    socket.join(`room:${roomCode}`);
    socket.join(`presenter:${roomCode}`);
    touchRoom(room);

    callback({
      roomCode: room.code,
      ip: getLocalIP(),
      port: PORT,
    });
    console.log(`[ROOM] Presenter erstellt Raum ${roomCode}`);
  });

  // --- Presenter verbindet sich zu bestehendem Raum ---
  socket.on('presenter-connect', (data) => {
    const code = data?.roomCode;
    const room = getRoom(code);
    if (!room) {
      socket.emit('room-error', { message: 'Raum nicht gefunden' });
      return;
    }
    roomCode = room.code;
    room.presenterSocketId = socket.id;
    socket.join(`room:${roomCode}`);
    socket.join(`presenter:${roomCode}`);
    touchRoom(room);

    socket.emit('game-state', {
      status: room.status,
      currentSlideIndex: room.currentSlideIndex,
      players: room.players,
      answers: room.answers,
      questionActive: room.questionActive,
      revealAnswer: room.revealAnswer,
      roomCode: room.code,
      ip: getLocalIP(),
      port: PORT,
    });
    console.log(`[ROOM] Presenter verbunden mit Raum ${roomCode}`);
  });

  // --- Schüler tritt bei ---
  socket.on('player-join', (data) => {
    const code = data.roomCode;
    const room = getRoom(code);
    if (!room) {
      socket.emit('room-error', { message: 'Raum nicht gefunden. Bitte prüfe den Code.' });
      return;
    }

    roomCode = room.code;
    const name = (data.name || 'Anonym').trim().substring(0, 20);
    const avatar = data.avatar || '🎓';

    // Reconnect-Check
    const disconnected = room.disconnectedPlayers.get(name);
    if (disconnected) {
      clearTimeout(disconnected.timeout);
      room.disconnectedPlayers.delete(name);
      delete room.players[disconnected.oldSocketId];
      delete room.answers[disconnected.oldSocketId];
      room.players[socket.id] = disconnected.playerData;
      console.log(`[ROOM ${roomCode}] Spieler "${name}" reconnected (Score: ${disconnected.playerData.score})`);
    } else {
      room.players[socket.id] = { name, avatar, score: 0, answers: [] };
    }

    socket.join(`room:${roomCode}`);
    socket.join(`students:${roomCode}`);
    touchRoom(room);

    socket.emit('join-success', {
      name,
      avatar: room.players[socket.id].avatar || avatar,
      playerCount: getPlayerCount(room),
      reconnected: !!disconnected,
      score: room.players[socket.id].score || 0,
      roomCode: room.code,
    });

    // Aktuellen Slide senden
    const slide = getCurrentSlide(room);
    if (slide && room.status === 'active') {
      socket.emit('slide-changed', {
        slide: getStudentSlideData(slide),
        slideIndex: room.currentSlideIndex,
        totalSlides: room.quizData.slides.length,
        questionActive: room.questionActive,
        revealAnswer: room.revealAnswer,
      });
    }

    io.to(`presenter:${roomCode}`).emit('player-joined', {
      id: socket.id, name, avatar,
      playerCount: getPlayerCount(room),
    });

    console.log(`[ROOM ${roomCode}] "${name}" beigetreten (${getPlayerCount(room)} Spieler)`);
  });

  // --- Quiz starten ---
  socket.on('start-quiz', () => {
    const room = getRoom(roomCode);
    if (!room) return;
    touchRoom(room);

    room.quizData = loadQuizData();
    room.status = 'active';
    room.currentSlideIndex = 0;
    room.answers = {};

    for (const player of Object.values(room.players)) {
      player.score = 0;
      player.answers = [];
    }

    io.to(`room:${roomCode}`).emit('quiz-started', {
      totalSlides: room.quizData.slides.length,
    });
    emitSlideChange(room, getCurrentSlide(room));
    console.log(`[ROOM ${roomCode}] Quiz gestartet`);
  });

  // --- Nächste Folie ---
  socket.on('next-slide', () => {
    const room = getRoom(roomCode);
    if (!room || !room.quizData) return;
    touchRoom(room);

    if (room.questionActive) {
      stopTimer(room);
      const results = processAnswers(room);
      room.revealAnswer = true;
      io.to(`room:${roomCode}`).emit('time-up', {
        results,
        correctAnswer: getCurrentSlide(room),
        leaderboard: getLeaderboard(room),
      });
      return;
    }

    if (room.currentSlideIndex < room.quizData.slides.length - 1) {
      room.currentSlideIndex++;
      room.answers = {};
      room.revealAnswer = false;
      emitSlideChange(room, getCurrentSlide(room));
    } else {
      room.status = 'finished';
      io.to(`room:${roomCode}`).emit('quiz-finished', {
        leaderboard: getLeaderboard(room),
      });
    }
  });

  // --- Vorherige Folie ---
  socket.on('prev-slide', () => {
    const room = getRoom(roomCode);
    if (!room || !room.quizData || room.questionActive) return;
    touchRoom(room);

    if (room.currentSlideIndex > 0) {
      room.currentSlideIndex--;
      room.answers = {};
      room.revealAnswer = false;
      emitSlideChange(room, getCurrentSlide(room));
    }
  });

  // --- Timer manuell starten ---
  socket.on('start-timer', (data) => {
    const room = getRoom(roomCode);
    if (!room) return;
    const slide = getCurrentSlide(room);
    if (!slide) return;
    touchRoom(room);

    const seconds = data?.seconds || slide.timeLimit || 30;
    room.answers = {};
    startTimer(room, seconds);
    io.to(`room:${roomCode}`).emit('question-active', {
      slide: getStudentSlideData(slide),
      timeLimit: seconds,
    });
  });

  // --- Antwort empfangen ---
  socket.on('submit-answer', (data) => {
    const room = getRoom(roomCode);
    if (!room || !room.questionActive) return;
    if (room.answers[socket.id]) return;
    touchRoom(room);

    const elapsed = room.timerEnd ? (room.timerEnd - Date.now()) : 0;
    const timeLimit = getCurrentSlide(room)?.timeLimit || 30;
    const timestamp = (timeLimit * 1000) - elapsed;

    room.answers[socket.id] = { value: data.value, timestamp };

    io.to(`presenter:${roomCode}`).emit('answer-received', {
      playerId: socket.id,
      playerName: room.players[socket.id]?.name || 'Anonym',
      answerCount: getAnswerCount(room),
      playerCount: getPlayerCount(room),
    });

    socket.emit('answer-confirmed');

    if (getAnswerCount(room) >= getPlayerCount(room) && getPlayerCount(room) > 0) {
      stopTimer(room);
      const results = processAnswers(room);
      room.revealAnswer = true;
      io.to(`room:${roomCode}`).emit('time-up', {
        results,
        correctAnswer: getCurrentSlide(room),
        leaderboard: getLeaderboard(room),
      });
    }
  });

  // --- Leaderboard ---
  socket.on('get-leaderboard', () => {
    const room = getRoom(roomCode);
    if (!room) return;
    socket.emit('leaderboard', { leaderboard: getLeaderboard(room) });
  });

  // --- Quiz zurücksetzen ---
  socket.on('reset-quiz', () => {
    const room = getRoom(roomCode);
    if (!room) return;
    stopTimer(room);
    touchRoom(room);

    room.status = 'waiting';
    room.currentSlideIndex = 0;
    room.answers = {};
    room.quizData = loadQuizData();
    room.questionActive = false;
    room.revealAnswer = false;

    for (const player of Object.values(room.players)) {
      player.score = 0;
      player.answers = [];
    }

    io.to(`room:${roomCode}`).emit('quiz-reset');
    console.log(`[ROOM ${roomCode}] Quiz zurückgesetzt`);
  });

  // --- Heartbeat ---
  socket.on('heartbeat', () => {
    if (roomCode) {
      const room = getRoom(roomCode);
      if (room) touchRoom(room);
    }
  });

  // --- Raum schließen ---
  socket.on('close-room', () => {
    if (!roomCode) return;
    io.to(`room:${roomCode}`).emit('room-closed');
    deleteRoom(roomCode);
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (!room) return;

    if (room.players[socket.id]) {
      const playerData = { ...room.players[socket.id] };
      const name = playerData.name;

      const timeout = setTimeout(() => {
        room.disconnectedPlayers.delete(name);
        delete room.players[socket.id];
        delete room.answers[socket.id];
        io.to(`presenter:${roomCode}`).emit('player-left', {
          id: socket.id, name, playerCount: getPlayerCount(room),
        });
        console.log(`[ROOM ${roomCode}] "${name}" endgültig entfernt`);
      }, DISCONNECT_GRACE_MS);

      room.disconnectedPlayers.set(name, { playerData, timeout, oldSocketId: socket.id });

      io.to(`presenter:${roomCode}`).emit('player-disconnected', {
        id: socket.id, name, playerCount: getPlayerCount(room),
      });
      console.log(`[ROOM ${roomCode}] "${name}" disconnected — Grace Period`);
    }

    if (socket.id === room.presenterSocketId) {
      console.log(`[ROOM ${roomCode}] Presenter disconnected`);
    }
  });
});

// ========== ROUTEN ==========

// Landing Page (öffentlich)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Presenter für einen Raum
app.get('/host/:roomCode', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'presenter.html'));
});

// Schüler mit Code in URL
app.get('/play/:roomCode', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

// Schüler ohne Code (Code-Eingabe)
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

// Admin Login
app.get('/login', (req, res) => {
  const error = req.query.error ? '<p style="color:#e94560;margin-bottom:1rem;">Falsches Passwort</p>' : '';
  res.send(`<!DOCTYPE html>
<html lang="de"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SoR Quiz — Admin Login</title>
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
    <p class="sub">Admin-Dashboard</p>
    ${error}
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Passwort" autofocus required>
      <button type="submit">Anmelden</button>
    </form>
  </div>
</body></html>`);
});

app.post('/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const sessionId = crypto.randomBytes(24).toString('hex');
    adminSessions.add(sessionId);
    res.setHeader('Set-Cookie', `sor_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    res.redirect('/admin');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.sor_session) adminSessions.delete(cookies.sor_session);
  res.setHeader('Set-Cookie', 'sor_session=; Path=/; Max-Age=0');
  res.redirect('/login');
});

// Admin Dashboard (geschützt)
app.get('/admin', (req, res) => {
  if (!isAdmin(req)) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin API: laufende Räume
app.get('/api/rooms', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const roomList = [];
  for (const [code, room] of rooms) {
    roomList.push({
      code,
      status: room.status,
      playerCount: getPlayerCount(room),
      currentSlide: room.currentSlideIndex + 1,
      totalSlides: room.quizData?.slides?.length || 0,
      createdAt: room.createdAt,
      lastActivity: room.lastActivity,
      players: Object.values(room.players).map(p => ({
        name: p.name, avatar: p.avatar, score: p.score,
      })),
    });
  }
  res.json({ rooms: roomList });
});

// Admin API: Raum löschen
app.delete('/api/rooms/:code', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const code = req.params.code.toUpperCase();
  if (!rooms.has(code)) return res.status(404).json({ error: 'Raum nicht gefunden' });
  io.to(`room:${code}`).emit('room-closed');
  deleteRoom(code);
  res.json({ ok: true });
});

// API: Raum prüfen (für Schüler Code-Eingabe)
app.get('/api/room/:code', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ exists: false });
  res.json({ exists: true, code: room.code, status: room.status, playerCount: getPlayerCount(room) });
});

app.get('/api/ip', (req, res) => {
  res.json({ ip: getLocalIP(), port: PORT });
});

// --- Server starten ---
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    📚 Schule ohne Rassismus - Quiz gestartet    ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Landing:   http://localhost:${PORT}              ║`);
  console.log(`║  Schüler:   http://${ip}:${PORT}/play        ║`);
  console.log(`║  Admin:     http://localhost:${PORT}/admin        ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});

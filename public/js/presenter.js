// ========== SOCKET.IO VERBINDUNG ==========
const socket = io();
let currentSlide = null;
let currentSlideIndex = 0;
let totalSlides = 0;
let presenterMap = null;
let mapMarkers = [];
let timerTotal = 30;

// ========== INITIALISIERUNG ==========
socket.emit('presenter-connect');

socket.on('game-state', (state) => {
  updateJoinInfo(state.ip, state.port);
  updatePlayerCount(Object.keys(state.players).length);

  // Spielerliste im Lobby anzeigen
  for (const [id, p] of Object.entries(state.players)) {
    addPlayerToLobby(p.name, p.avatar);
  }
});

// ========== JOIN INFO & QR CODE ==========
function updateJoinInfo(ip, port) {
  // Wenn über Domain aufgerufen, Domain nutzen statt IP:Port
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const url = isLocalhost
    ? `http://${ip}:${port}/play`
    : `${window.location.origin}/play`;
  document.getElementById('join-url').textContent = url;

  // QR Code generieren
  const canvas = document.getElementById('qr-code');
  QRCode.toCanvas(canvas, url, {
    width: 180,
    margin: 1,
    color: { dark: '#1a1a2e', light: '#ffffff' },
  });
}

// ========== SPIELERVERWALTUNG ==========
function updatePlayerCount(count) {
  document.getElementById('player-count').textContent = count;
  document.getElementById('topbar-players').textContent = `👥 ${count}`;
}

function addPlayerToLobby(name, avatar) {
  const list = document.getElementById('players-list');
  const tag = document.createElement('div');
  tag.className = 'player-tag';
  tag.textContent = `${avatar || '🎓'} ${name}`;
  list.appendChild(tag);
}

socket.on('player-joined', (data) => {
  updatePlayerCount(data.playerCount);
  addPlayerToLobby(data.name, data.avatar);
});

socket.on('player-left', (data) => {
  updatePlayerCount(data.playerCount);
});

// ========== QUIZ STARTEN ==========
function startQuiz() {
  socket.emit('start-quiz');
}

socket.on('quiz-started', (data) => {
  totalSlides = data.totalSlides;
  showScreen('presentation-screen');
});

// ========== NAVIGATION ==========
function nextSlide() {
  // Map aufräumen falls vorhanden
  if (presenterMap) {
    presenterMap.remove();
    presenterMap = null;
    mapMarkers = [];
  }
  socket.emit('next-slide');
}

function prevSlide() {
  socket.emit('prev-slide');
}

// Keyboard-Navigation
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') {
    e.preventDefault();
    nextSlide();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prevSlide();
  }
});

// ========== SLIDE ANZEIGE ==========
socket.on('slide-changed', (data) => {
  currentSlide = data.slide;
  currentSlideIndex = data.slideIndex;
  totalSlides = data.totalSlides;

  document.getElementById('slide-counter').textContent =
    `${currentSlideIndex + 1} / ${totalSlides}`;
  document.getElementById('timer-display').style.display = 'none';

  if (data.playerCount !== undefined) {
    updatePlayerCount(data.playerCount);
  }

  renderSlide(data.slide);

  // Navigation-Buttons
  document.getElementById('btn-prev').disabled = currentSlideIndex === 0;
});

function renderSlide(slide) {
  const container = document.getElementById('slide-container');

  if (!slide) {
    container.innerHTML = '<div class="slide"><h2>Keine Folie</h2></div>';
    return;
  }

  switch (slide.type) {
    case 'title':
      renderTitleSlide(container, slide);
      break;
    case 'info':
      renderInfoSlide(container, slide);
      break;
    case 'multiple-choice':
      renderMCSlide(container, slide);
      break;
    case 'true-false':
      renderTFSlide(container, slide);
      break;
    case 'estimation':
      renderEstimationSlide(container, slide);
      break;
    case 'map':
      renderMapSlide(container, slide);
      break;
    case 'sort':
      renderSortSlide(container, slide);
      break;
    case 'video':
      renderVideoSlide(container, slide);
      break;
    default:
      container.innerHTML = `<div class="slide"><h2>${slide.title || 'Unbekannter Folientyp'}</h2></div>`;
  }
}

// --- Title Slide ---
function renderTitleSlide(container, slide) {
  container.innerHTML = `
    <div class="slide slide-title">
      <h1>${escapeHtml(slide.title)}</h1>
      ${slide.subtitle ? `<div class="subtitle">${escapeHtml(slide.subtitle)}</div>` : ''}
    </div>
  `;
}

// --- Info Slide ---
function renderInfoSlide(container, slide) {
  const hasImage = slide.image;
  container.innerHTML = `
    <div class="slide slide-info ${hasImage ? '' : 'no-image'}">
      <div class="info-text">
        <h2>${escapeHtml(slide.title)}</h2>
        <div class="content-text">${formatContent(slide.content)}</div>
      </div>
      ${hasImage ? `
        <div class="info-image">
          <img src="${slide.image}" alt="${escapeHtml(slide.title)}" onerror="this.style.display='none'">
          ${slide.imageCaption ? `<div class="image-caption">${escapeHtml(slide.imageCaption)}</div>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

// --- Multiple Choice ---
function renderMCSlide(container, slide) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const optionsHtml = slide.options.map((opt, i) => `
    <div class="mc-option" id="mc-opt-${i}">
      <span class="option-letter">${letters[i]}</span>
      <span class="option-text">${escapeHtml(opt)}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="slide slide-question">
      <div class="question-type-badge">Multiple Choice</div>
      <h2>${escapeHtml(slide.question)}</h2>
      ${slide.image ? `<div class="question-image"><img src="${slide.image}" alt="Frage"></div>` : ''}
      <div class="mc-options">${optionsHtml}</div>
    </div>
  `;
}

// --- True/False ---
function renderTFSlide(container, slide) {
  container.innerHTML = `
    <div class="slide slide-question">
      <div class="question-type-badge">Wahr oder Falsch?</div>
      <h2>${escapeHtml(slide.question)}</h2>
      ${slide.image ? `<div class="question-image"><img src="${slide.image}" alt="Frage"></div>` : ''}
      <div class="tf-options">
        <div class="tf-option" id="tf-true">✅ Wahr</div>
        <div class="tf-option" id="tf-false">❌ Falsch</div>
      </div>
    </div>
  `;
}

// --- Estimation ---
function renderEstimationSlide(container, slide) {
  container.innerHTML = `
    <div class="slide slide-question">
      <div class="question-type-badge">Schätzfrage</div>
      <h2>${escapeHtml(slide.question)}</h2>
      ${slide.image ? `<div class="question-image"><img src="${slide.image}" alt="Frage"></div>` : ''}
      ${slide.hint ? `<p style="color: var(--text-muted); margin-top: 1rem;">${escapeHtml(slide.hint)}</p>` : ''}
      <div class="estimation-display" style="display:none" id="estimation-reveal">
        <div class="estimation-answer" id="estimation-answer"></div>
        <div class="estimation-unit" id="estimation-unit"></div>
      </div>
    </div>
  `;
}

// --- Map (GeoGuessr) ---
function renderMapSlide(container, slide) {
  container.innerHTML = `
    <div class="slide slide-question">
      <div class="question-type-badge">📍 Wo ist das?</div>
      <h2>${escapeHtml(slide.question)}</h2>
      <div class="map-question-container" style="justify-content: center;">
        ${slide.image ? `
          <div class="map-question-image" style="max-width: 80%; margin: 0 auto;">
            <img src="${slide.image}" alt="Wo ist das?" style="max-height: 60vh; width: auto; display: block; margin: 0 auto; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
          </div>
        ` : ''}
      </div>
      <div id="presenter-map-container" style="display:none;">
        <div id="presenter-map" style="height: 400px; border-radius: 12px; margin-top: 1rem;"></div>
      </div>
    </div>
  `;
}

function initPresenterMap(slide) {
  if (presenterMap) {
    presenterMap.remove();
    presenterMap = null;
  }
  mapMarkers = [];

  const center = slide.mapCenter || [30, 10];
  const zoom = slide.mapZoom || 3;

  presenterMap = L.map('presenter-map', {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView(center, zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 18,
  }).addTo(presenterMap);

  setTimeout(() => presenterMap.invalidateSize(), 200);
}

function showMapResults(results, slide) {
  if (!presenterMap || !slide) return;

  // Korrekte Position anzeigen
  const correctIcon = L.divIcon({
    className: 'correct-marker',
    html: '✓',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

  L.marker([slide.answer.lat, slide.answer.lng], { icon: correctIcon })
    .addTo(presenterMap)
    .bindPopup('<b>Korrekte Position</b>')
    .openPopup();

  // Spieler-Vermutungen anzeigen
  const bounds = L.latLngBounds([[slide.answer.lat, slide.answer.lng]]);

  for (const [socketId, result] of Object.entries(results)) {
    if (!result.answer || !result.answer.lat) continue;

    const guessIcon = L.divIcon({
      className: 'guess-marker',
      html: result.points > 0 ? '●' : '✗',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    const marker = L.marker([result.answer.lat, result.answer.lng], { icon: guessIcon })
      .addTo(presenterMap);

    // Linie vom Tipp zur korrekten Position
    const line = L.polyline(
      [[result.answer.lat, result.answer.lng], [slide.answer.lat, slide.answer.lng]],
      { color: result.points > 0 ? '#4caf50' : '#e94560', weight: 2, dashArray: '5,5', opacity: 0.6 }
    ).addTo(presenterMap);

    const dist = haversineDistance(
      result.answer.lat, result.answer.lng,
      slide.answer.lat, slide.answer.lng
    );

    marker.bindPopup(`<b>${getPlayerName(socketId)}</b><br>${Math.round(dist).toLocaleString('de-DE')} km Entfernung<br>+${result.points} Punkte`);

    bounds.extend([result.answer.lat, result.answer.lng]);
    mapMarkers.push(marker, line);
  }

  presenterMap.fitBounds(bounds, { padding: [50, 50] });
}

// --- Sort ---
function renderSortSlide(container, slide) {
  const itemsHtml = slide.correctOrder.map((item, i) => `
    <div class="sort-item" id="sort-item-${i}" style="opacity: 0; animation: slideIn 0.3s ease ${i * 0.1}s forwards;">
      <span class="sort-number">${i + 1}</span>
      <span>${escapeHtml(item)}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="slide slide-question">
      <div class="question-type-badge">Richtige Reihenfolge</div>
      <h2>${escapeHtml(slide.question)}</h2>
      <div class="sort-display" id="sort-display" style="display:none">${itemsHtml}</div>
      <p style="color: var(--text-muted); margin-top: 1rem;">Die Schüler sortieren auf ihren Geräten...</p>
    </div>
  `;
}

// --- Video ---
function renderVideoSlide(container, slide) {
  let videoHtml = '';
  if (slide.videoType === 'youtube' && slide.videoUrl) {
    // YouTube embed URL extrahieren
    const videoId = extractYoutubeId(slide.videoUrl);
    videoHtml = `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}" 
                  frameborder="0" allowfullscreen allow="autoplay; encrypted-media"></iframe>`;
  } else if (slide.videoUrl) {
    videoHtml = `<video controls src="${slide.videoUrl}"></video>`;
  }

  container.innerHTML = `
    <div class="slide slide-question">
      <div class="question-type-badge">📹 Video</div>
      <h2>${escapeHtml(slide.title || '')}</h2>
      <div class="video-container">${videoHtml}</div>
      ${slide.question ? `<p style="margin-top: 1.5rem; font-size: 1.2rem; color: var(--text-muted);">${escapeHtml(slide.question)}</p>` : ''}
    </div>
  `;
}

// ========== TIMER ==========
socket.on('question-active', (data) => {
  timerTotal = data.timeLimit;
  document.getElementById('timer-display').style.display = 'flex';
  document.getElementById('answer-counter').textContent = `0 / ? Antworten`;
});

socket.on('timer-update', (data) => {
  const remaining = data.remaining;
  const timerText = document.getElementById('timer-text');
  const timerCircle = document.getElementById('timer-circle');

  timerText.textContent = remaining;

  // Timer-Ring aktualisieren
  const circumference = 2 * Math.PI * 26;
  const progress = remaining / timerTotal;
  timerCircle.style.strokeDashoffset = circumference * (1 - progress);

  // Farbe ändern bei wenig Zeit
  if (remaining <= 5) {
    timerText.className = 'timer-text urgent';
    timerCircle.style.stroke = '#f44336';
  } else if (remaining <= 10) {
    timerCircle.style.stroke = '#ff9800';
    timerText.className = 'timer-text';
  } else {
    timerCircle.style.stroke = '#e94560';
    timerText.className = 'timer-text';
  }
});

socket.on('answer-received', (data) => {
  document.getElementById('answer-counter').textContent =
    `${data.answerCount} / ${data.playerCount} Antworten`;
});

// ========== ERGEBNISSE ==========
socket.on('time-up', (data) => {
  document.getElementById('timer-display').style.display = 'none';

  const slide = data.correctAnswer;
  const results = data.results;
  const leaderboard = data.leaderboard;

  // Richtige Antwort auf dem Slide anzeigen
  revealAnswer(slide, results);

  // Ergebnis-Overlay zeigen
  showResultsOverlay(slide, results, leaderboard);
});

function revealAnswer(slide, results) {
  if (!slide) return;

  switch (slide.type) {
    case 'multiple-choice': {
      const options = document.querySelectorAll('.mc-option');
      options.forEach((opt, i) => {
        if (i === slide.correct) {
          opt.classList.add('correct');
        } else {
          opt.classList.add('wrong');
        }
      });
      break;
    }
    case 'true-false': {
      const trueEl = document.getElementById('tf-true');
      const falseEl = document.getElementById('tf-false');
      if (slide.answer === true) {
        trueEl.classList.add('correct');
        falseEl.classList.add('wrong');
      } else {
        falseEl.classList.add('correct');
        trueEl.classList.add('wrong');
      }
      break;
    }
    case 'estimation': {
      const reveal = document.getElementById('estimation-reveal');
      if (reveal) {
        reveal.style.display = 'flex';
        document.getElementById('estimation-answer').textContent = slide.answer.toLocaleString('de-DE');
        document.getElementById('estimation-unit').textContent = slide.unit || '';
      }
      break;
    }
    case 'map': {
      // Map erstellen und Ergebnisse anzeigen (hinter dem Overlay)
      const mapContainer = document.getElementById('presenter-map-container');
      if (mapContainer) {
        mapContainer.style.display = 'block';
        const imgContainer = document.querySelector('.map-question-image');
        if (imgContainer) imgContainer.style.display = 'none';
      }
      setTimeout(() => {
        initPresenterMap(slide);
        setTimeout(() => showMapResults(results, slide), 300);
      }, 100);
      break;
    }
    case 'sort': {
      const display = document.getElementById('sort-display');
      if (display) display.style.display = 'flex';
      break;
    }
  }
}

function showResultsOverlay(slide, results, leaderboard) {
  const overlay = document.getElementById('results-overlay');
  const header = document.getElementById('results-header');
  const body = document.getElementById('results-body');
  const lb = document.getElementById('results-leaderboard');

  // Antwort-Zusammenfassung
  let correctAnswerText = '';
  switch (slide.type) {
    case 'multiple-choice':
      correctAnswerText = slide.options[slide.correct];
      break;
    case 'true-false':
      correctAnswerText = slide.answer ? 'Wahr' : 'Falsch';
      break;
    case 'estimation':
      correctAnswerText = `${slide.answer.toLocaleString('de-DE')} ${slide.unit || ''}`;
      break;
    case 'map':
      correctAnswerText = slide.answerLabel || `${slide.answer.lat.toFixed(2)}, ${slide.answer.lng.toFixed(2)}`;
      break;
    case 'sort':
      correctAnswerText = slide.correctOrder.join(' → ');
      break;
  }

  header.innerHTML = `
    <h3>Ergebnis</h3>
    <div class="correct-answer">✅ ${escapeHtml(correctAnswerText)}</div>
  `;

  // Spieler-Ergebnisse
  const resultEntries = Object.entries(results || {});
  if (resultEntries.length > 0) {
    const isMap = slide.type === 'map';
    const isEstimation = slide.type === 'estimation';
    body.innerHTML = resultEntries
      .sort((a, b) => b[1].points - a[1].points)
      .slice(0, 10)
      .map(([id, r]) => {
        let icon, detail;
        if (isMap) {
          icon = r.points > 0 ? '📍' : '📍';
          detail = r.distance !== null && r.distance !== undefined
            ? `${r.distance.toLocaleString('de-DE')} km entfernt`
            : '';
        } else if (isEstimation) {
          icon = r.points > 50 ? '🎯' : '🤔';
          detail = r.diff !== null && r.diff !== undefined
            ? (r.diff === 0 ? 'Genau richtig!' : `Tipp: ${r.answer} (${r.diff} daneben)`)
            : `Tipp: ${r.answer}`;
        } else {
          icon = r.correct ? '✅' : '❌';
          detail = '';
        }
        return `
          <div class="leaderboard-item" style="animation: scorePopup 0.4s ease">
            <span class="leaderboard-name">${icon} ${escapeHtml(getPlayerName(id))}</span>
            ${detail ? `<span style="font-size:0.85rem;color:var(--text-muted)">${detail}</span>` : ''}
            <span class="leaderboard-score">+${r.points} Pkt.</span>
          </div>
        `;
      }).join('');
  } else {
    body.innerHTML = '<p style="text-align:center; color: var(--text-muted);">Keine Antworten</p>';
  }

  // Mini-Leaderboard
  lb.innerHTML = `
    <h3 style="margin-top: 1.5rem; font-size: 1.2rem;">🏆 Gesamtstand</h3>
    ${renderLeaderboardHTML(leaderboard.slice(0, 5))}
  `;

  overlay.style.display = 'flex';
}

function hideResults() {
  document.getElementById('results-overlay').style.display = 'none';
  // Bei Map-Fragen: Overlay schließen, Karte darunter sichtbar lassen.
  // Navigation über den "Weiter →" Button unten.
  if (presenterMap) {
    return; // Map bleibt sichtbar
  }
  // Für andere Fragetypen: direkt zur nächsten Folie
  nextSlide();
}

// ========== LEADERBOARD ==========
function showLeaderboard() {
  socket.emit('get-leaderboard');
}

socket.on('leaderboard', (data) => {
  const list = document.getElementById('leaderboard-list');
  list.innerHTML = renderLeaderboardHTML(data.leaderboard);
  document.getElementById('leaderboard-overlay').style.display = 'flex';
});

function hideLeaderboard() {
  document.getElementById('leaderboard-overlay').style.display = 'none';
}

function renderLeaderboardHTML(leaderboard) {
  if (!leaderboard || leaderboard.length === 0) {
    return '<p style="text-align:center; color: var(--text-muted);">Noch keine Spieler</p>';
  }

  const medals = ['🥇', '🥈', '🥉'];
  return leaderboard.map((p, i) => `
    <div class="leaderboard-item">
      <span class="leaderboard-rank">${medals[i] || (i + 1)}</span>
      <span class="leaderboard-name">${p.avatar || '🎓'} ${escapeHtml(p.name)}</span>
      <span class="leaderboard-score">${p.score.toLocaleString('de-DE')} Pkt.</span>
    </div>
  `).join('');
}

// ========== QUIZ ENDE ==========
socket.on('quiz-finished', (data) => {
  document.getElementById('final-leaderboard').innerHTML = `
    <div class="leaderboard-list">
      ${renderLeaderboardHTML(data.leaderboard)}
    </div>
  `;
  showScreen('end-screen');
});

// ========== QUIZ RESET ==========
function resetQuiz() {
  socket.emit('reset-quiz');
}

socket.on('quiz-reset', () => {
  showScreen('lobby-screen');
  document.getElementById('players-list').innerHTML = '';
  socket.emit('presenter-connect');
});

// ========== HILFSFUNKTIONEN ==========
let playerNames = {};

socket.on('player-joined', (data) => {
  playerNames[data.id] = data.name;
});

function getPlayerName(socketId) {
  return playerNames[socketId] || 'Anonym';
}

// Store player names from results
socket.on('answer-received', (data) => {
  playerNames[data.playerId] = data.playerName;
});

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatContent(text) {
  if (!text) return '';
  // Einfaches Markdown-like Formatting
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n- (.*)/g, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

function extractYoutubeId(url) {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  return match ? match[1] : '';
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

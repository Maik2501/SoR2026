// ========== SOCKET.IO ==========
const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 30000,
});

let myName = '';
let myAvatar = '🎓';
let myScore = 0;
let selectedAnswer = null;
let studentMap = null;
let studentMarker = null;
let timerTotal = 30;
let currentSlide = null;
let roomCode = null;

// ========== ROOM CODE AUS URL ==========
function getRoomCodeFromURL() {
  const pathParts = window.location.pathname.split('/');
  // /play/XXXX
  if (pathParts.length >= 3 && pathParts[1] === 'play' && pathParts[2]) {
    return pathParts[2].toUpperCase();
  }
  return null;
}

// Beim Laden prüfen ob Room-Code in URL
(function init() {
  const urlCode = getRoomCodeFromURL();
  if (urlCode && urlCode.length === 4) {
    roomCode = urlCode;
    // Code-Eingabe überspringen, direkt Join-Screen zeigen
    document.getElementById('room-code-section').style.display = 'none';
    document.getElementById('room-code-info').textContent = `Raum: ${roomCode}`;
    document.getElementById('room-code-info').style.display = 'block';
  } else {
    // Code-Eingabe anzeigen
    document.getElementById('room-code-section').style.display = 'block';
  }
})();

// ========== BEITRETEN ==========
function selectAvatar(btn) {
  document.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  myAvatar = btn.dataset.avatar;
}

async function joinGame(e) {
  e.preventDefault();
  myName = document.getElementById('player-name').value.trim();
  if (!myName) return;

  // Room-Code aus Feld holen falls nicht aus URL
  if (!roomCode) {
    const codeInput = document.getElementById('room-code-input');
    if (!codeInput || !codeInput.value.trim()) {
      showJoinError('Bitte gib einen Raum-Code ein');
      return;
    }
    roomCode = codeInput.value.trim().toUpperCase();
  }

  // Raum prüfen
  try {
    const res = await fetch(`/api/room/${roomCode}`);
    if (!res.ok) {
      showJoinError('Raum nicht gefunden. Bitte prüfe den Code.');
      roomCode = null;
      return;
    }
  } catch (e) {
    showJoinError('Verbindungsfehler.');
    roomCode = null;
    return;
  }

  socket.emit('player-join', { name: myName, avatar: myAvatar, roomCode });
}

function showJoinError(msg) {
  let el = document.getElementById('join-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'join-error';
    el.style.cssText = 'color:#e94560;font-size:0.9rem;margin-top:0.5rem;text-align:center;';
    document.getElementById('join-form').appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

socket.on('join-success', (data) => {
  myName = data.name;
  myAvatar = data.avatar || myAvatar;
  roomCode = data.roomCode || roomCode;
  if (data.score !== undefined) myScore = data.score;
  document.getElementById('waiting-avatar').textContent = myAvatar;
  document.getElementById('waiting-name').textContent = myName;
  if (data.reconnected) {
    console.log('[STUDENT] Reconnected! Score restored:', myScore);
  }
  showScreen('waiting-screen');
});

socket.on('room-error', (data) => {
  showJoinError(data.message || 'Raum nicht gefunden');
  roomCode = null;
});

socket.on('room-expired', () => {
  alert('Dieser Raum wurde geschlossen.');
  window.location.href = '/';
});

socket.on('room-closed', () => {
  alert('Der Raum wurde vom Presenter geschlossen.');
  window.location.href = '/';
});

// ========== QUIZ GESTARTET ==========
socket.on('quiz-started', () => {
  // Bleibt auf Wartebildschirm bis erste Folie kommt
});

// ========== FOLIEN ==========
socket.on('slide-changed', (data) => {
  currentSlide = data.slide;
  selectedAnswer = null;

  if (!data.slide) { showScreen('waiting-screen'); return; }

  const slide = data.slide;
  if (['title', 'info', 'video'].includes(slide.type)) {
    document.getElementById('info-title').textContent = slide.title || 'Informationsfolie';
    showScreen('info-screen');
    return;
  }

  showScreen('info-screen');
  document.getElementById('info-title').textContent = slide.question || slide.title || 'Nächste Frage...';
});

// ========== FRAGE AKTIV ==========
socket.on('question-active', (data) => {
  currentSlide = data.slide;
  timerTotal = data.timeLimit;
  selectedAnswer = null;
  document.getElementById('student-score').textContent = `${myScore.toLocaleString('de-DE')} Punkte`;
  renderQuestion(data.slide);
  showScreen('question-screen');
});

// ========== FRAGE RENDERN ==========
function renderQuestion(slide) {
  const container = document.getElementById('question-container');
  switch (slide.type) {
    case 'multiple-choice': renderStudentMC(container, slide); break;
    case 'true-false': renderStudentTF(container, slide); break;
    case 'estimation': renderStudentEstimation(container, slide); break;
    case 'map': renderStudentMap(container, slide); break;
    case 'sort': renderStudentSort(container, slide); break;
    default: container.innerHTML = '<p>Unbekannter Fragetyp</p>';
  }
}

// --- Multiple Choice ---
function renderStudentMC(container, slide) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  container.innerHTML = `
    <div class="q-header">
      <div class="q-type">Multiple Choice</div>
      <div class="q-text">${escapeHtml(slide.question)}</div>
    </div>
    ${slide.image ? `<img class="q-image" src="${slide.image}" alt="">` : ''}
    <div class="s-mc-options">
      ${slide.options.map((opt, i) => `
        <div class="s-mc-option" onclick="selectMC(${i}, this)">
          <span class="s-option-letter">${letters[i]}</span>
          <span>${escapeHtml(opt)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function selectMC(index, el) {
  document.querySelectorAll('.s-mc-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedAnswer = index;
  submitAnswer(index);
}

// --- True/False ---
function renderStudentTF(container, slide) {
  container.innerHTML = `
    <div class="q-header">
      <div class="q-type">Wahr oder Falsch?</div>
      <div class="q-text">${escapeHtml(slide.question)}</div>
    </div>
    ${slide.image ? `<img class="q-image" src="${slide.image}" alt="">` : ''}
    <div class="s-tf-options">
      <div class="s-tf-option" onclick="selectTF(true, this)">
        <span class="tf-icon">✅</span>
        <span>Wahr</span>
      </div>
      <div class="s-tf-option" onclick="selectTF(false, this)">
        <span class="tf-icon">❌</span>
        <span>Falsch</span>
      </div>
    </div>
  `;
}

function selectTF(value, el) {
  document.querySelectorAll('.s-tf-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  submitAnswer(value);
}

// --- Estimation ---
function renderStudentEstimation(container, slide) {
  container.innerHTML = `
    <div class="q-header">
      <div class="q-type">Schätzfrage</div>
      <div class="q-text">${escapeHtml(slide.question)}</div>
    </div>
    ${slide.image ? `<img class="q-image" src="${slide.image}" alt="">` : ''}
    <div class="s-estimation">
      <input type="number" id="estimation-input" inputmode="numeric" placeholder="?">
      ${slide.unit ? `<div class="unit-label">${escapeHtml(slide.unit)}</div>` : ''}
      ${slide.hint ? `<div class="unit-label">${escapeHtml(slide.hint)}</div>` : ''}
      <button class="btn-submit" onclick="submitEstimation()">Antworten</button>
    </div>
  `;
  document.getElementById('estimation-input').focus();
}

function submitEstimation() {
  const val = parseFloat(document.getElementById('estimation-input').value);
  if (isNaN(val)) return;
  submitAnswer(val);
}

// --- Map ---
function renderStudentMap(container, slide) {
  container.innerHTML = `
    <div class="q-header">
      <div class="q-type">📍 Wo ist das?</div>
      <div class="q-text">${escapeHtml(slide.question)}</div>
    </div>
    ${slide.image ? `<img class="s-map-image" src="${slide.image}" alt="">` : ''}
    <div class="s-map-container">
      <div class="map-instruction">Tippe auf die Karte um deinen Tipp zu setzen</div>
      <div id="student-map"></div>
      <button class="btn-submit" id="btn-map-submit" onclick="submitMapAnswer()" disabled>
        📍 Tipp bestätigen
      </button>
    </div>
  `;
  setTimeout(() => initStudentMap(slide), 100);
}

function initStudentMap(slide) {
  if (studentMap) { studentMap.remove(); studentMap = null; }
  studentMarker = null;
  const center = slide.mapCenter || [30, 10];
  const zoom = slide.mapZoom || 3;

  studentMap = L.map('student-map', { zoomControl: true, scrollWheelZoom: true, tap: true }).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM', maxZoom: 18 }).addTo(studentMap);

  studentMap.on('click', (e) => {
    const { lat, lng } = e.latlng;
    if (studentMarker) { studentMarker.setLatLng([lat, lng]); }
    else { studentMarker = L.marker([lat, lng], { draggable: true }).addTo(studentMap); }
    document.getElementById('btn-map-submit').disabled = false;
  });

  setTimeout(() => studentMap.invalidateSize(), 200);
}

function submitMapAnswer() {
  if (!studentMarker) return;
  const pos = studentMarker.getLatLng();
  submitAnswer({ lat: pos.lat, lng: pos.lng });
}

// --- Sort ---
function renderStudentSort(container, slide) {
  container.innerHTML = `
    <div class="q-header">
      <div class="q-type">Richtige Reihenfolge</div>
      <div class="q-text">${escapeHtml(slide.question)}</div>
    </div>
    <div class="s-sort-container" id="sort-list">
      ${slide.items.map((item, i) => `
        <div class="s-sort-item" draggable="true" data-value="${escapeHtml(item)}">
          <span class="sort-handle">☰</span>
          <span class="sort-num">${i + 1}</span>
          <span class="sort-text">${escapeHtml(item)}</span>
        </div>
      `).join('')}
    </div>
    <button class="btn-submit" onclick="submitSortAnswer()">Reihenfolge bestätigen</button>
  `;
  initSortDragDrop();
}

function initSortDragDrop() {
  const list = document.getElementById('sort-list');
  if (!list) return;
  let draggedItem = null;

  list.addEventListener('dragstart', (e) => {
    draggedItem = e.target.closest('.s-sort-item');
    if (draggedItem) { draggedItem.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
  });
  list.addEventListener('dragend', () => {
    if (draggedItem) draggedItem.classList.remove('dragging');
    document.querySelectorAll('.s-sort-item').forEach(i => i.classList.remove('drag-over'));
    draggedItem = null;
    updateSortNumbers();
  });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.s-sort-item');
    if (!target || target === draggedItem) return;
    document.querySelectorAll('.s-sort-item').forEach(i => i.classList.remove('drag-over'));
    target.classList.add('drag-over');
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) list.insertBefore(draggedItem, target);
    else list.insertBefore(draggedItem, target.nextSibling);
  });

  let touchItem = null;
  list.addEventListener('touchstart', (e) => { touchItem = e.target.closest('.s-sort-item'); if (touchItem) touchItem.classList.add('dragging'); }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (!touchItem) return;
    e.preventDefault();
    const touch = e.touches[0];
    const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
    const target = elements.find(el => el.classList?.contains('s-sort-item') && el !== touchItem);
    if (target) {
      const rect = target.getBoundingClientRect();
      if (touch.clientY < rect.top + rect.height / 2) list.insertBefore(touchItem, target);
      else list.insertBefore(touchItem, target.nextSibling);
    }
  }, { passive: false });
  list.addEventListener('touchend', () => { if (touchItem) { touchItem.classList.remove('dragging'); touchItem = null; updateSortNumbers(); } }, { passive: true });
}

function updateSortNumbers() {
  document.querySelectorAll('.s-sort-item .sort-num').forEach((num, i) => { num.textContent = i + 1; });
}

function submitSortAnswer() {
  const items = document.querySelectorAll('.s-sort-item');
  const order = Array.from(items).map(item => item.dataset.value);
  submitAnswer(order);
}

// ========== ANTWORT SENDEN ==========
function submitAnswer(value) {
  socket.emit('submit-answer', { value });
}

socket.on('answer-confirmed', () => {
  showScreen('answered-screen');
});

// ========== TIMER ==========
socket.on('timer-update', (data) => {
  const remaining = data.remaining;
  const bar = document.getElementById('student-timer-bar');
  const text = document.getElementById('student-timer-text');
  if (bar && text) {
    bar.style.width = `${(remaining / timerTotal) * 100}%`;
    text.textContent = remaining;
    if (remaining <= 5) { bar.classList.add('urgent'); text.classList.add('urgent'); }
    else { bar.classList.remove('urgent'); text.classList.remove('urgent'); }
  }
});

// ========== ERGEBNIS ==========
socket.on('time-up', (data) => {
  const myResult = data.results?.[socket.id];
  const container = document.getElementById('result-container');

  if (myResult) {
    const gained = myResult.points;
    myScore += gained;
    let icon, pointsText, detailText;
    if (myResult.distance != null) {
      icon = gained > 80 ? '🎯' : gained > 30 ? '📍' : '🗺️';
      pointsText = `+${gained.toLocaleString('de-DE')}`;
      detailText = `${myResult.distance.toLocaleString('de-DE')} km entfernt`;
    } else if (myResult.diff != null) {
      icon = gained > 80 ? '🎯' : gained > 30 ? '👍' : '🤔';
      pointsText = `+${gained.toLocaleString('de-DE')}`;
      detailText = myResult.diff === 0 ? 'Genau richtig!' : `${myResult.diff.toLocaleString('de-DE')} daneben`;
    } else {
      icon = myResult.correct ? '🎉' : '😔';
      pointsText = `${myResult.correct ? '+' : ''}${gained.toLocaleString('de-DE')}`;
      detailText = myResult.correct ? 'Richtig!' : 'Leider falsch';
    }
    container.innerHTML = `
      <div class="result-icon">${icon}</div>
      <div class="result-points">${pointsText}</div>
      <div class="result-detail">${detailText}</div>
      <div class="result-score-total">
        <div class="total-label">Gesamtpunktzahl</div>
        <div class="total-value">${myScore.toLocaleString('de-DE')} Pkt.</div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="result-icon">⏱️</div>
      <div class="result-detail">Keine Antwort abgegeben</div>
      <div class="result-score-total">
        <div class="total-label">Gesamtpunktzahl</div>
        <div class="total-value">${myScore.toLocaleString('de-DE')} Pkt.</div>
      </div>
    `;
  }
  showScreen('result-screen');
});

// ========== QUIZ ENDE ==========
socket.on('quiz-finished', (data) => {
  const leaderboard = data.leaderboard;
  const myRank = leaderboard.findIndex(p => p.id === socket.id) + 1;
  const medals = ['🥇', '🥈', '🥉'];
  document.getElementById('end-rank').textContent = myRank <= 3 ? medals[myRank - 1] : `Platz ${myRank}`;
  document.getElementById('end-score').textContent = `${myScore.toLocaleString('de-DE')} Punkte`;
  showScreen('end-screen');
});

// ========== QUIZ RESET ==========
socket.on('quiz-reset', () => {
  myScore = 0;
  selectedAnswer = null;
  showScreen('waiting-screen');
});

// ========== HILFSFUNKTIONEN ==========
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  if (screenId === 'question-screen' && studentMap) {
    setTimeout(() => studentMap.invalidateSize(), 100);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== VERBINDUNGSSTATUS ==========
socket.on('disconnect', (reason) => {
  console.log('[STUDENT] Disconnected:', reason);
  showConnectionStatus('Verbindung verloren — reconnecting...', 'error');
});

socket.on('reconnect', () => {
  console.log('[STUDENT] Reconnected!');
  showConnectionStatus('Wieder verbunden!', 'success');
  if (myName && roomCode) {
    socket.emit('player-join', { name: myName, avatar: myAvatar, roomCode });
  }
  setTimeout(() => hideConnectionStatus(), 3000);
});

socket.on('reconnect_attempt', (attempt) => {
  showConnectionStatus(`Reconnecting... (Versuch ${attempt})`, 'warning');
});

socket.on('reconnect_failed', () => {
  showConnectionStatus('Verbindung fehlgeschlagen — bitte Seite neu laden', 'error');
});

function showConnectionStatus(message, type) {
  let statusEl = document.getElementById('connection-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'connection-status';
    statusEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;padding:8px 16px;text-align:center;font-size:14px;font-weight:600;font-family:Inter,sans-serif;transition:transform 0.3s ease;';
    document.body.appendChild(statusEl);
  }
  statusEl.textContent = message;
  statusEl.style.transform = 'translateY(0)';
  statusEl.style.background = type === 'error' ? '#e94560' : type === 'warning' ? '#f59e0b' : '#10b981';
  statusEl.style.color = '#fff';
}

function hideConnectionStatus() {
  const el = document.getElementById('connection-status');
  if (el) el.style.transform = 'translateY(-100%)';
}

// Keepalive
setInterval(() => { if (socket.connected) socket.emit('heartbeat'); }, 15000);

// Shared Field — общий экран: каждый вошедший становится светящейся точкой.
//
// Транспорт: WebRTC напрямую между браузерами (Trystero). Ни сервера, ни аккаунтов:
// браузеры находят друг друга через публичные Nostr-релеи, а данные после этого
// идут напрямую между игроками. Каждый клиент — хозяин только своей точки.
//
// Почему не публичный MQTT-брокер: замерено на этой машине — доставка 0–11%,
// паузы до 30 секунд. Для реального времени не годится.

import { joinRoom, selfId } from '../../lib/trystero.bundle.js';

const APP_ID = 'playground-shared-field-v1';

// Публичные Nostr-релеи, через которые браузеры находят друг друга.
// Список проверен на этой машине; мёртвые релеи исключены, чтобы не тормозить поиск.
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://cdn.satellite.earth',
  'wss://relay.nostrmap.net',
  'wss://nostr.chaima.info'
];

const SEND_MS = 90;          // как часто отправляем свою позицию
const HEARTBEAT = 1000;      // «я живой», даже если не двигаюсь
const FORGET_AFTER = 12000;  // страховка, если игрок пропал без сообщения об уходе
const PUSH_COOLDOWN = 260;   // не чаще, чем раз в столько мс в одну цель

const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d', { alpha: false });

const elGate = document.getElementById('gate');
const elName = document.getElementById('nameInput');
const elEnter = document.getElementById('enterBtn');
const elCount = document.getElementById('count');
const elStatusDot = document.getElementById('statusDot');
const elStatusText = document.getElementById('statusText');
const elRoom = document.getElementById('roomName');
const elCopy = document.getElementById('copyBtn');
const elHint = document.getElementById('hint');

// --- состояние ---

let w = 0, h = 0, dpr = 1;

const me = {
  id: selfId,
  name: '',
  x: 0, y: 0, vx: 0, vy: 0,
  tx: 0, ty: 0,
  hasPointer: false
};

const players = new Map();   // peerId -> {name, hue, x, y, rx, ry, seen}
const pushAt = new Map();

let room = null;
let action = null;
let joined = false;
let lastSend = 0;
let lastHeartbeat = 0;
let sentCount = 0;
let recvCount = 0;
let pushSent = 0;
let pushRecv = 0;
let lastErr = '';

const roomName = (function () {
  const raw = (location.hash || '').replace(/^#/, '').trim();
  const clean = raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  return clean || 'lobby';
})();

elRoom.textContent = roomName;

// --- служебное ---

function hueFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function setStatus(kind, text) {
  elStatusDot.className = 'dot ' + kind;
  elStatusText.textContent = text;
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05030f';
  ctx.fillRect(0, 0, w, h);
  if (!me.hasPointer) { me.tx = w / 2; me.ty = h / 2; me.x = w / 2; me.y = h / 2; }
}

function updateCount() {
  elCount.textContent = String(players.size + 1);
}

// --- сеть ---

function connect() {
  setStatus('wait', 'поиск игроков…');

  try {
    room = joinRoom({
      appId: APP_ID,
      relayConfig: { urls: RELAYS, redundancy: 4, warnOnRelayFailure: false }
    }, roomName);
  } catch (e) {
    setStatus('off', 'сеть недоступна');
    return;
  }

  room.onPeerJoin = function (peerId) {
    setStatus('on', 'на связи');
    updateCount();
    // новичку сразу отдаём свою позицию, иначе он увидит нас только после движения
    sendState(true);
  };

  room.onPeerLeave = function (peerId) {
    players.delete(peerId);
    pushAt.delete(peerId);
    updateCount();
    if (players.size === 0) setStatus('wait', 'один в комнате');
  };

  action = room.makeAction('state');

  action.onMessage = function (data, meta) {
    const from = meta && meta.peerId;
    if (!from || from === me.id || !data) return;
    recvCount++;
    setStatus('on', 'на связи');

    if (data.t === 's') {
      let p = players.get(from);
      if (!p) {
        p = { name: '', hue: hueFor(from), x: data.x, y: data.y, rx: data.x, ry: data.y, seen: 0 };
        players.set(from, p);
        updateCount();
      }
      p.name = String(data.n || 'кто-то').slice(0, 14);
      p.x = Number(data.x) || 0;
      p.y = Number(data.y) || 0;
      p.seen = performance.now();
      return;
    }

    // меня толкнули — я хозяин своей точки, значит двигаю её сам
    if (data.t === 'p') {
      me.vx += Number(data.dx) || 0;
      me.vy += Number(data.dy) || 0;
      pushRecv++;
    }
  };

  setStatus('wait', 'один в комнате');
}

function sendState(force) {
  if (!action || !joined) return;
  const now = performance.now();
  if (!force && now - lastSend < SEND_MS) return;
  lastSend = now;
  sentCount++;
  try {
    action.send({
      t: 's',
      n: me.name,
      x: Math.round(me.x),
      y: Math.round(me.y)
    });
  } catch (e) {
    // канал мог закрыться — не роняем игру из-за одного сообщения
  }
}

// Отправка живёт на таймере, а не в анимационном цикле:
// в фоновой вкладке браузер душит requestAnimationFrame, и игрок «пропадал».
function pump() {
  const now = performance.now();
  if (now - lastHeartbeat > HEARTBEAT) {
    lastHeartbeat = now;
    sendState(true);
  } else {
    sendState(false);
  }
}

// --- логика и отрисовка ---

function step() {
  requestAnimationFrame(step);

  if (me.hasPointer) {
    me.vx += (me.tx - me.x) * 0.014;
    me.vy += (me.ty - me.y) * 0.014;
  }
  me.vx *= 0.86;
  me.vy *= 0.86;
  me.x += me.vx;
  me.y += me.vy;

  me.x = Math.max(14, Math.min(w - 14, me.x));
  me.y = Math.max(14, Math.min(h - 14, me.y));

  const now = performance.now();
  players.forEach(function (p, id) {
    p.rx += (p.x - p.rx) * 0.22;
    p.ry += (p.y - p.ry) * 0.22;
    if (now - p.seen > FORGET_AFTER) {
      players.delete(id);
      updateCount();
    }
  });

  // толчки: наехал на чужую точку — сообщаем её хозяину, чтобы он отлетел
  const speed = Math.hypot(me.vx, me.vy);
  if (speed > 1.2 && action) {
    players.forEach(function (p, id) {
      const d = Math.hypot(p.rx - me.x, p.ry - me.y);
      if (d < 34) {
        const last = pushAt.get(id) || 0;
        if (now - last > PUSH_COOLDOWN) {
          pushAt.set(id, now);
          const nx = (p.rx - me.x) / (d || 1);
          const ny = (p.ry - me.y) / (d || 1);
          const k = Math.min(speed, 12) * 0.55;
          try {
            action.send({ t: 'p', dx: +(nx * k).toFixed(2), dy: +(ny * k).toFixed(2) }, { target: id });
            pushSent++;
          } catch (e) { lastErr = 'push: ' + e; }
        }
      }
    });
  }

  draw();
}

function glowCircle(x, y, r, hue, alpha) {
  ctx.beginPath();
  ctx.fillStyle = 'hsla(' + hue + ', 100%, 62%, ' + alpha + ')';
  ctx.shadowColor = 'hsl(' + hue + ', 100%, 60%)';
  ctx.shadowBlur = 26;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function label(text, x, y, color) {
  ctx.font = '600 11px ui-monospace, "Cascadia Mono", Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(5, 3, 15, 0.26)';
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'lighter';

  glowCircle(me.x, me.y, 7, 186, 1);
  ctx.globalCompositeOperation = 'source-over';
  label(me.name ? me.name + ' · ты' : 'ты', me.x, me.y + 24, 'rgba(0, 240, 255, 0.95)');
  ctx.globalCompositeOperation = 'lighter';

  players.forEach(function (p) {
    glowCircle(p.rx, p.ry, 6, p.hue, 0.95);
    ctx.globalCompositeOperation = 'source-over';
    label(p.name, p.rx, p.ry + 23, 'hsla(' + p.hue + ', 100%, 78%, 0.95)');
    ctx.globalCompositeOperation = 'lighter';
  });

  ctx.globalCompositeOperation = 'source-over';
}

// --- вход ---

function enter(name) {
  me.name = String(name || '').trim().slice(0, 14) || 'гость';
  try { localStorage.setItem('pg-name', me.name); } catch (e) {}
  joined = true;
  elGate.classList.add('hidden');
  sendState(true);
  if (elHint) elHint.textContent = 'пошевели мышью · комната ' + roomName;
}

elEnter.addEventListener('click', function () { enter(elName.value); });
elName.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') enter(elName.value);
});

elCopy.addEventListener('click', function () {
  const url = location.origin + location.pathname + '#' + roomName;
  const done = function () {
    const old = elCopy.textContent;
    elCopy.textContent = 'скопировано';
    setTimeout(function () { elCopy.textContent = old; }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(done);
  } else {
    done();
  }
});

// --- события ---

window.addEventListener('resize', resize);
window.addEventListener('pointermove', function (e) {
  me.tx = e.clientX;
  me.ty = e.clientY;
  me.hasPointer = true;
});
window.addEventListener('pointerdown', function (e) {
  me.tx = e.clientX;
  me.ty = e.clientY;
  me.hasPointer = true;
});

document.addEventListener('visibilitychange', function () {
  if (!document.hidden) pump();
});

window.addEventListener('pagehide', function () {
  try { if (room) room.leave(); } catch (e) {}
});

// --- старт ---

resize();
me.x = w / 2;
me.y = h / 2;
me.tx = w / 2;
me.ty = h / 2;

let saved = '';
try { saved = localStorage.getItem('pg-name') || ''; } catch (e) {}
if (saved) elName.value = saved;
elName.focus();

updateCount();
connect();
requestAnimationFrame(step);
setInterval(pump, 120);

// отладочный снимок состояния: нужен автотесту, руками не используется
window.__fieldDebug = function () {
  return {
    me: { name: me.name, x: Math.round(me.x), y: Math.round(me.y),
          tx: Math.round(me.tx), ty: Math.round(me.ty), pointer: me.hasPointer },
    room: roomName,
    inRoom: !!room,
    sent: sentCount,
    recv: recvCount,
    pushSent: pushSent,
    pushRecv: pushRecv,
    lastErr: lastErr,
    count: players.size + 1,
    players: Array.from(players.entries()).map(function (e) {
      return { id: e[0], name: e[1].name, x: Math.round(e[1].x), y: Math.round(e[1].y) };
    })
  };
};

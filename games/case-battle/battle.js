// Case Battle — общий кейс-баттл на двоих-четверых.
//
// Правила: у каждого свой игровой баланс. Вскрываешь кейс — платишь его цену,
// получаешь предмет со случайной ценностью. Когда все закончили, жмём
// «финальный расчёт»: у кого суммарные дропы дороже — забирает весь банк
// (сумму всех ставок в партии).
//
// Деньги исключительно игровые: их нельзя купить, пополнить или вывести.
//
// Транспорт — WebRTC напрямую между браузерами (Trystero), как в Shared Field.
// Каждый клиент — хозяин своих чисел: это вечеринка с друзьями, а не казино,
// защита от подделки состояния здесь не делается сознательно.

import { joinRoom, selfId } from '../../lib/trystero.bundle.js';
import { CASES, caseById, rollItem, RARITIES } from './items.js';

const APP_ID = 'playground-case-battle-v1';

// Публичные Nostr-релеи, через которые браузеры находят друг друга.
// Список проверен на этой машине: из 33 проверенных живыми оказались эти.
// Мёртвые (relay.flashapp.me, relay.nostr.band, nostr.robosats.org и подобные)
// в список не входят — иначе они только тормозят поиск и сорят в консоль.
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://cdn.satellite.earth',
  'wss://relay.nostrmap.net',
  'wss://nostr.chaima.info'
];

const START_BALANCE = 1000;
const SEND_MS = 120;          // не чаще, чем раз в столько мс отправляем своё состояние
const HEARTBEAT = 1200;
const FORGET_AFTER = 15000;

const REEL_ITEMS = 34;        // сколько карточек в ленте прокрутки
const REEL_TARGET = 27;       // на какой по счёту останавливаемся
const REEL_DURATION = 2400;

// --- элементы ---

const elStatusDot = document.getElementById('statusDot');
const elStatusText = document.getElementById('statusText');
const elCount = document.getElementById('count');
const elRound = document.getElementById('roundNum');
const elRoom = document.getElementById('roomName');
const elCopy = document.getElementById('copyBtn');

const elMyName = document.getElementById('myName');
const elMyBalance = document.getElementById('myBalance');
const elCases = document.getElementById('cases');
const elReel = document.getElementById('reel');
const elStrip = document.getElementById('strip');
const elBoard = document.getElementById('board');

const elGate = document.getElementById('gate');
const elNameInput = document.getElementById('nameInput');
const elEnter = document.getElementById('enterBtn');

const elFinish = document.getElementById('finishBtn');
const elReset = document.getElementById('resetBtn');

const elResult = document.getElementById('result');
const elResultTitle = document.getElementById('resultTitle');
const elResultSum = document.getElementById('resultSum');
const elResultTable = document.getElementById('resultTable');
const elResultBtn = document.getElementById('resultBtn');

// --- состояние ---

const me = {
  id: selfId,
  name: '',
  balance: START_BALANCE,
  spent: 0,
  drops: [],
  opens: 0
};

const players = new Map();    // peerId -> {name, balance, spent, drops, opens, seen}

let room = null;
let action = null;
let joined = false;
let round = 1;
let finishedRound = 0;
let busy = false;
let lastSend = 0;
let lastHeartbeat = 0;
let sentCount = 0;
let recvCount = 0;

const roomName = (function () {
  const raw = (location.hash || '').replace(/^#/, '').trim();
  const clean = raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  return clean || 'lobby';
})();

elRoom.textContent = roomName;

// --- утилиты ---

function totalOf(p) {
  return p.drops.reduce(function (s, d) { return s + d.value; }, 0);
}

function setStatus(kind, text) {
  elStatusDot.className = 'dot ' + kind;
  elStatusText.textContent = text;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function money(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function updateCount() {
  elCount.textContent = String(players.size + 1);
}

function updateRoundLabel() {
  elRound.textContent = String(round);
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

  room.onPeerJoin = function () {
    setStatus('on', 'на связи');
    updateCount();
    sendState(true);          // новичок сразу получает наши числа
  };

  room.onPeerLeave = function (peerId) {
    players.delete(peerId);
    updateCount();
    renderAll();
    if (players.size === 0) setStatus('wait', 'один в комнате');
  };

  action = room.makeAction('msg');

  action.onMessage = function (data, meta) {
    const from = meta && meta.peerId;
    if (!from || from === me.id || !data) return;
    recvCount++;
    setStatus('on', 'на связи');

    if (data.t === 'st') {
      let p = players.get(from);
      if (!p) {
        p = { name: 'кто-то', balance: START_BALANCE, spent: 0, drops: [], opens: 0, seen: 0 };
        players.set(from, p);
        updateCount();
      }
      const before = p.drops.length;
      p.name = String(data.n || 'кто-то').slice(0, 14);
      p.balance = Number(data.b) || 0;
      p.spent = Number(data.s) || 0;
      p.opens = Number(data.o) || 0;
      if (Array.isArray(data.d)) {
        p.drops = data.d.slice(-14).map(function (d) {
          return { name: String(d.n).slice(0, 24), value: Number(d.v) || 0, tier: Number(d.t) || 0 };
        });
      }
      p.seen = performance.now();
      renderAll();
      if (p.drops.length > before) flashPlayer(from);
      return;
    }

    if (data.t === 'fin') {
      applyFinish(Number(data.r) || round, Number(data.bank) || 0, String(data.winner || ''));
      return;
    }

    if (data.t === 'rst') {
      applyReset(Number(data.r) || (round + 1));
      return;
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
      t: 'st',
      n: me.name,
      b: me.balance,
      s: me.spent,
      o: me.opens,
      d: me.drops.slice(-14).map(function (d) {
        return { n: d.name, v: d.value, t: d.tier };
      })
    });
  } catch (e) { /* канал мог закрыться — игру из-за этого не роняем */ }
}

function pump() {
  const now = performance.now();
  if (now - lastHeartbeat > HEARTBEAT) {
    lastHeartbeat = now;
    sendState(true);
  } else {
    sendState(false);
  }
}

// --- открытие кейса ---

function openCase(caseDef) {
  if (busy || !joined) return;
  if (me.balance < caseDef.price) return;
  if (finishedRound === round) return;

  busy = true;

  // честный детерминированный бросок: тот же вход — тот же предмет
  const seed = [roomName, round, me.id, me.opens, caseDef.id].join('|');
  const item = rollItem(caseDef, seed);

  me.balance -= caseDef.price;
  me.spent += caseDef.price;
  me.opens += 1;
  me.drops.push(item);

  renderMine();
  sendState(true);
  animateReel(caseDef, item, function () {
    busy = false;
    renderAll();
  });
}

function animateReel(caseDef, item, done) {
  elReel.classList.add('on');
  elStrip.innerHTML = '';
  elStrip.style.transition = 'none';
  elStrip.style.transform = 'translateX(0)';

  const frag = document.createDocumentFragment();
  for (let i = 0; i < REEL_ITEMS; i++) {
    const isTarget = i === REEL_TARGET;
    const it = isTarget ? item : rollItem(caseDef, caseDef.id + '|' + i + '|' + Math.random());
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.style.color = it.color || RARITIES[it.tier].color;
    chip.innerHTML = '<span class="nm">' + esc(it.name) + '</span>' +
                     '<span class="vl">' + money(it.value) + '</span>';
    if (isTarget) chip.dataset.target = '1';
    frag.appendChild(chip);
  }
  elStrip.appendChild(frag);

  // ширину меряем после показа, иначе она нулевая
  const width = elReel.clientWidth;
  const CHIP = 92 + 10;
  const targetCenter = REEL_TARGET * CHIP + 46;
  const jitter = (Math.random() - 0.5) * 40;
  const to = -(targetCenter - width / 2 + jitter);

  requestAnimationFrame(function () {
    elStrip.style.transition = 'transform ' + REEL_DURATION + 'ms cubic-bezier(.08,.86,.08,1)';
    elStrip.style.transform = 'translateX(' + to + 'px)';
  });

  setTimeout(function () {
    elReel.classList.remove('on');
    elStrip.style.transition = 'none';
    elStrip.innerHTML = '';
    if (done) done();
  }, REEL_DURATION + 650);
}

function flashPlayer(peerId) {
  const card = elBoard.querySelector('[data-peer="' + peerId + '"]');
  if (!card) return;
  card.animate(
    [{ boxShadow: '0 0 0 1px rgba(255,212,0,0)' },
     { boxShadow: '0 0 42px -8px rgba(255,212,0,.9)' },
     { boxShadow: '0 0 0 1px rgba(255,212,0,0)' }],
    { duration: 700 }
  );
}

// --- финальный расчёт и новая партия ---

function allParticipants() {
  const list = [{ id: me.id, name: me.name, balance: me.balance, spent: me.spent, drops: me.drops, isMe: true }];
  players.forEach(function (p, id) {
    list.push({ id: id, name: p.name, balance: p.balance, spent: p.spent, drops: p.drops, isMe: false });
  });
  return list;
}

function computeResult() {
  const list = allParticipants();
  const bank = list.reduce(function (s, p) { return s + p.spent; }, 0);

  let winner = null;
  let best = -1;
  list.forEach(function (p) {
    const t = totalOf(p);
    if (t > best) { best = t; winner = p; }
  });

  // если никто ничего не вскрыл, банка нет и победителя нет
  if (bank === 0 || !winner || best === 0) {
    return { bank: 0, winner: null, list: list };
  }
  return { bank: bank, winner: winner, list: list };
}

function doFinish() {
  if (!joined) return;
  if (finishedRound === round) return;

  const res = computeResult();
  const winnerId = res.winner ? res.winner.id : '';

  try {
    action.send({ t: 'fin', r: round, bank: res.bank, winner: winnerId });
  } catch (e) {}

  applyFinish(round, res.bank, winnerId);
}

function applyFinish(r, bank, winnerId) {
  if (r !== round) return;
  if (finishedRound === round) return;
  finishedRound = round;

  const list = allParticipants();
  const winner = list.find(function (p) { return p.id === winnerId; }) || null;

  if (winner && bank > 0 && winner.isMe) {
    me.balance += bank;
  }

  // пересчитываем итог уже с учётом выигрыша
  elResultTitle.textContent = winner
    ? (winner.isMe ? 'ты забрал банк' : 'банк забрал ' + winner.name)
    : 'партия пустая';

  elResultSum.textContent = winner
    ? money(bank) + ' монет уходит победителю'
    : 'никто не вскрыл ни одного кейса';

  let rows = '<tr><th>игрок</th><th>дропы</th><th>потратил</th><th>баланс</th></tr>';
  list.forEach(function (p) {
    const t = totalOf(p);
    const isWin = winner && p.id === winner.id;
    rows += '<tr>' +
      '<td class="' + (isWin ? 'win' : '') + '">' + esc(p.name || 'гость') + (p.isMe ? ' (ты)' : '') + '</td>' +
      '<td class="' + (isWin ? 'win' : '') + '">' + money(t) + '</td>' +
      '<td>' + money(p.spent) + '</td>' +
      '<td>' + money(p.isMe && isWin ? p.balance + bank : p.balance) + '</td>' +
      '</tr>';
  });
  elResultTable.innerHTML = rows;
  elResult.classList.remove('hidden');

  sendState(true);
  renderAll();
}

function doReset() {
  const next = round + 1;
  try {
    action.send({ t: 'rst', r: next });
  } catch (e) {}
  applyReset(next);
}

function applyReset(next) {
  if (next <= round) return;

  round = next;
  finishedRound = 0;
  busy = false;

  me.spent = 0;
  me.drops = [];
  me.opens = 0;
  me.balance = START_BALANCE;

  players.forEach(function (p) {
    p.spent = 0;
    p.drops = [];
    p.opens = 0;
    p.balance = START_BALANCE;
  });

  elResult.classList.add('hidden');
  updateRoundLabel();
  renderAll();
  sendState(true);
}

// --- отрисовка ---

function renderMine() {
  elMyName.textContent = me.name || 'гость';
  elMyBalance.textContent = money(me.balance);
  Array.from(elCases.querySelectorAll('.case-btn')).forEach(function (btn) {
    const def = caseById(btn.dataset.case);
    btn.disabled = !def || me.balance < def.price || busy || finishedRound === round;
  });
}

function renderCases() {
  elCases.innerHTML = CASES.map(function (c) {
    const legendChance = Math.round(c.tiers[c.tiers.length - 1].w / c.tiers.reduce(function (s, t) { return s + t.w; }, 0) * 1000) / 10;
    return '<button class="case-btn" data-case="' + c.id + '" style="--acc:' + c.accent + '">' +
      '<span class="cname" style="color:' + c.accent + '">' + esc(c.name) + '</span>' +
      '<span class="cprice">' + money(c.price) + ' монет</span>' +
      '<span class="chance">легендарка — ' + legendChance + '%</span>' +
      '</button>';
  }).join('');

  elCases.addEventListener('click', function (e) {
    const btn = e.target.closest('.case-btn');
    if (!btn) return;
    const def = caseById(btn.dataset.case);
    if (def) openCase(def);
  });
}

function dropsHtml(drops) {
  const last = drops.slice(-5);
  if (!last.length) return '<span style="font-size:10px;color:var(--muted)">пока пусто</span>';
  return last.map(function (d) {
    const color = (RARITIES[d.tier] || RARITIES[0]).color;
    return '<span class="drop" style="color:' + color + '">' +
      '<span>' + esc(d.name) + '</span><b>' + money(d.value) + '</b></span>';
  }).join('');
}

function renderBoard() {
  const list = allParticipants();
  const best = list.reduce(function (m, p) { return Math.max(m, totalOf(p)); }, 0);

  if (list.length === 1 && players.size === 0) {
    elBoard.innerHTML = '<div class="empty">пока никого — скинь ссылку другу, и он появится здесь</div>';
    return;
  }

  // порядок: сначала лидер
  list.sort(function (a, b) { return totalOf(b) - totalOf(a); });

  elBoard.innerHTML = list.map(function (p) {
    const t = totalOf(p);
    const leader = t > 0 && t === best;
    const cls = 'pcard' + (leader ? ' leader' : '') + (p.isMe ? ' me' : '');
    return '<div class="' + cls + '" data-peer="' + p.id + '">' +
      '<h3>' + (leader ? '<span class="crown">👑</span>' : '') + esc(p.name || 'гость') + (p.isMe ? ' · ты' : '') + '</h3>' +
      '<div class="row"><span>дропы</span><b class="sum">' + money(t) + '</b></div>' +
      '<div class="row"><span>потратил</span><b>' + money(p.spent) + '</b></div>' +
      '<div class="row"><span>баланс</span><b>' + money(p.balance) + '</b></div>' +
      '<div class="drops">' + dropsHtml(p.drops) + '</div>' +
      '</div>';
  }).join('');
}

function renderAll() {
  renderMine();
  renderBoard();
  updateCount();
  updateRoundLabel();
}

// --- вход и кнопки ---

function enter(name) {
  me.name = String(name || '').trim().slice(0, 14) || 'гость';
  try { localStorage.setItem('pg-name', me.name); } catch (e) {}
  joined = true;
  elGate.classList.add('hidden');
  sendState(true);
  renderAll();
}

elEnter.addEventListener('click', function () { enter(elNameInput.value); });
elNameInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') enter(elNameInput.value);
});

elFinish.addEventListener('click', function () { doFinish(); });
elReset.addEventListener('click', function () { doReset(); });
elResultBtn.addEventListener('click', function () { doReset(); });

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

// --- старт ---

let saved = '';
try { saved = localStorage.getItem('pg-name') || ''; } catch (e) {}
if (saved) elNameInput.value = saved;
elNameInput.focus();

renderCases();
renderAll();
connect();
setInterval(pump, 150);

// ушедшие без сообщения об уходе вычищаются по времени
setInterval(function () {
  const now = performance.now();
  let changed = false;
  players.forEach(function (p, id) {
    if (now - p.seen > FORGET_AFTER) { players.delete(id); changed = true; }
  });
  if (changed) renderAll();
}, 2000);

// отладочный снимок: нужен автотесту, руками не используется
window.__battleDebug = function () {
  return {
    me: { id: me.id, name: me.name, balance: me.balance, spent: me.spent, opens: me.opens, drops: me.drops.length, total: totalOf(me) },
    round: round,
    finishedRound: finishedRound,
    sent: sentCount,
    recv: recvCount,
    count: players.size + 1,
    players: Array.from(players.entries()).map(function (e) {
      return { id: e[0], name: e[1].name, balance: e[1].balance, spent: e[1].spent, drops: e[1].drops.length, total: totalOf(e[1]) };
    })
  };
};

// проверка честности броска из консоли: тот же вход — тот же предмет
window.__battleRoll = function (caseId, who, index) {
  const def = caseById(caseId);
  if (!def) return null;
  return rollItem(def, [roomName, round, who || me.id, index === undefined ? me.opens : index, caseId].join('|'));
};

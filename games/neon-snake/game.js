// Neon Snake — змейка на сетке, с плавной интерполяцией и неоновым свечением.
// Без зависимостей: только canvas 2d.

(function () {
  'use strict';

  const COLS = 24;
  const ROWS = 18;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const elScore = document.getElementById('score');
  const elLevel = document.getElementById('level');
  const elBest = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ovTitle');
  const ovText = document.getElementById('ovText');
  const startBtn = document.getElementById('startBtn');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let cssW = 600, cssH = 450, cell = 25;

  // состояние игры
  let snake, prevSnake, dir, dirQueue, food, score, level, eaten;
  let running = false;     // идёт ли партия
  let paused = false;
  let dead = false;
  let acc = 0;             // накопитель времени до следующего шага
  let stepMs = 150;
  let lastTs = 0;
  let best = 0;
  let pulse = 0;

  try {
    best = parseInt(localStorage.getItem('neon-snake-best') || '0', 10) || 0;
  } catch (e) { best = 0; }
  elBest.textContent = best;

  function baseStep() {
    // 150 мс в начале, 62 мс на 8-м уровне и дальше
    return Math.max(62, 150 - (level - 1) * 12);
  }

  function reset() {
    const cx = (COLS / 2) | 0;
    const cy = (ROWS / 2) | 0;
    snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy }
    ];
    prevSnake = snake.map(function (s) { return { x: s.x, y: s.y }; });
    dir = { x: 1, y: 0 };
    dirQueue = [];
    score = 0;
    level = 1;
    eaten = 0;
    stepMs = baseStep();
    acc = 0;
    dead = false;
    paused = false;
    placeFood();
    syncHud();
  }

  function placeFood() {
    const free = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        let busy = false;
        for (let i = 0; i < snake.length; i++) {
          if (snake[i].x === x && snake[i].y === y) { busy = true; break; }
        }
        if (!busy) free.push({ x: x, y: y });
      }
    }
    if (!free.length) { win(); return; }
    food = free[(Math.random() * free.length) | 0];
  }

  function syncHud() {
    elScore.textContent = score;
    elLevel.textContent = level;
  }

  function showOverlay(title, text, btn) {
    ovTitle.textContent = title;
    ovText.textContent = text;
    startBtn.textContent = btn;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function start() {
    reset();
    running = true;
    hideOverlay();
    lastTs = 0;
  }

  function gameOver() {
    dead = true;
    running = false;
    if (score > best) {
      best = score;
      elBest.textContent = best;
      try { localStorage.setItem('neon-snake-best', String(best)); } catch (e) {}
    }
    showOverlay('Конец', 'Счёт: ' + score + '. Рекорд: ' + best + '.', 'ещё раз');
  }

  function win() {
    running = false;
    showOverlay('Поле заполнено', 'Ты занял всё поле. Счёт: ' + score + '.', 'ещё раз');
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      showOverlay('Пауза', 'Пробел — продолжить.', 'продолжить');
    } else {
      hideOverlay();
      lastTs = 0;
    }
  }

  function pushDir(nx, ny) {
    // нельзя развернуться на 180°
    const last = dirQueue.length ? dirQueue[dirQueue.length - 1] : dir;
    if (last.x === -nx && last.y === -ny) return;
    if (last.x === nx && last.y === ny) return;
    if (dirQueue.length < 2) dirQueue.push({ x: nx, y: ny });
  }

  function tick() {
    prevSnake = snake.map(function (s) { return { x: s.x, y: s.y }; });

    if (dirQueue.length) dir = dirQueue.shift();

    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // стены
    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) {
      gameOver();
      return;
    }

    const growing = (head.x === food.x && head.y === food.y);

    // столкновение с собой; клетку хвоста можно занять, если он уползает
    const limit = growing ? snake.length : snake.length - 1;
    for (let i = 0; i < limit; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) {
        gameOver();
        return;
      }
    }

    snake.unshift(head);

    if (growing) {
      score += 10;
      eaten++;
      if (eaten % 5 === 0) {
        level++;
        stepMs = baseStep();
      }
      syncHud();
      placeFood();
    } else {
      snake.pop();
    }
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function hueAt(i, n) {
    // голова — циан, хвост — фиолетово-розовый
    const t = n <= 1 ? 0 : i / (n - 1);
    const h1 = 186, h2 = 300;
    return lerp(h1, h2, t);
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(122, 60, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(x * cell + 0.5, 0);
      ctx.lineTo(x * cell + 0.5, cssH);
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(0, y * cell + 0.5);
      ctx.lineTo(cssW, y * cell + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawFood(now) {
    if (!food) return;
    const p = reduced ? 0 : (Math.sin(now / 260) + 1) / 2;
    const size = cell * (0.52 + p * 0.12);
    const cx = food.x * cell + cell / 2;
    const cy = food.y * cell + cell / 2;

    ctx.save();
    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 22 + p * 12;
    ctx.fillStyle = '#ff2bd6';
    roundRect(cx - size / 2, cy - size / 2, size, size, size * 0.32);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    roundRect(cx - size / 6, cy - size / 6, size / 3, size / 3, size * 0.14);
    ctx.fill();
    ctx.restore();
  }

  function drawSnake(t) {
    const n = snake.length;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = n - 1; i >= 0; i--) {
      const cur = snake[i];
      const prev = prevSnake[Math.min(i, prevSnake.length - 1)] || cur;
      const x = lerp(prev.x, cur.x, t) * cell;
      const y = lerp(prev.y, cur.y, t) * cell;

      const hue = hueAt(i, n);
      const inset = i === 0 ? cell * 0.06 : cell * 0.12;
      const s = cell - inset * 2;

      ctx.shadowColor = 'hsl(' + hue + ', 100%, 60%)';
      ctx.shadowBlur = i === 0 ? 26 : 14;
      ctx.fillStyle = 'hsl(' + hue + ', 100%, ' + (i === 0 ? 68 : 55) + '%)';
      ctx.globalAlpha = i === 0 ? 1 : Math.max(0.35, 0.95 - (i / n) * 0.5);
      roundRect(x + inset, y + inset, s, s, s * 0.3);
      ctx.fill();

      // блик в голове — «глаз»
      if (i === 0) {
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        roundRect(x + s * 0.5, y + cell * 0.3, s * 0.2, s * 0.2, s * 0.1);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    const dt = Math.min(ts - lastTs, 200);
    lastTs = ts;

    if (running && !paused && !dead) {
      acc += dt;
      while (acc >= stepMs) {
        acc -= stepMs;
        tick();
        if (dead || !running) { acc = 0; break; }
      }
    } else if (paused || dead) {
      acc = 0;
    }

    const t = running && !paused && !dead ? Math.min(acc / stepMs, 1) : 1;

    ctx.clearRect(0, 0, cssW, cssH);
    drawGrid();
    drawFood(ts);
    drawSnake(t);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxW = Math.min(window.innerWidth - 56, 780);
    const maxH = window.innerHeight * 0.58;
    let w = maxW;
    let h = (w / COLS) * ROWS;
    if (h > maxH) {
      h = maxH;
      w = (h / ROWS) * COLS;
    }
    cssW = Math.round(w);
    cssH = Math.round(h);
    cell = cssW / COLS;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- управление ---

  const KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
    ц: [0, -1], ы: [0, 1], ф: [-1, 0], в: [1, 0]
  };

  window.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (!running && !paused) { start(); return; }
      togglePause();
      return;
    }
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
      start();
      return;
    }
    const k = KEYS[e.key];
    if (k) {
      e.preventDefault();
      if (running && !paused) pushDir(k[0], k[1]);
    }
  });

  startBtn.addEventListener('click', function () {
    if (paused && running) { togglePause(); return; }
    start();
  });

  // свайпы
  let touchStart = null;
  canvas.addEventListener('pointerdown', function (e) {
    touchStart = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    touchStart = null;
    if (Math.hypot(dx, dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) pushDir(dx > 0 ? 1 : -1, 0);
    else pushDir(0, dy > 0 ? 1 : -1);
  });

  // кнопки-крестовина для телефона
  const pads = document.querySelector('.pads');
  if (pads) {
    pads.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      const map = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      const v = map[b.dataset.dir];
      if (v && running && !paused) pushDir(v[0], v[1]);
    });
  }

  if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
    document.body.classList.add('touch');
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && running && !paused) togglePause();
  });

  window.addEventListener('resize', resize);

  // старт: поле уже нарисовано, ждём кнопку
  resize();
  reset();
  showOverlay('Готов?', 'Стрелки или WASD — движение. Пробел — пауза. Собирай кубики, не врезайся в стены и в себя.', 'начать');
  requestAnimationFrame(frame);
})();

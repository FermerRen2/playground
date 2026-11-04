// Flow Field — частицы, ведомые невидимым векторным полем.
// Поле считается из наложения синусов: быстро, без шума Перлина и без библиотек.
// Следы получаются затиранием предыдущего кадра полупрозрачным фоном.

(function () {
  'use strict';

  const canvas = document.getElementById('flow');
  const ctx = canvas.getContext('2d', { alpha: false });

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const PALETTES = [
    { name: 'неон',  h1: 186, h2: 300, bg: 'rgba(5, 3, 15, 0.055)' },
    { name: 'огонь', h1: 350, h2: 45,  bg: 'rgba(12, 3, 6, 0.06)' },
    { name: 'лёд',   h1: 195, h2: 225, bg: 'rgba(3, 7, 14, 0.055)' }
  ];

  let pal = 0;

  let w = 0, h = 0, dpr = 1;
  let particles = [];
  let t = 0;
  let pointer = { x: 0, y: 0, active: false, force: 0 };

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
    spawnAll();
  }

  function count() {
    const c = Math.round((w * h) / 7000);
    return Math.max(300, Math.min(1400, c));
  }

  function spawn(p) {
    p.x = Math.random() * w;
    p.y = Math.random() * h;
    p.speed = 0.5 + Math.random() * 1.5;
    p.life = 120 + Math.random() * 340;
    p.age = 0;
    p.hueShift = Math.random();
    return p;
  }

  function spawnAll() {
    particles = [];
    const n = count();
    for (let i = 0; i < n; i++) {
      particles.push(spawn({}));
    }
  }

  // вектор поля в точке
  function angleAt(x, y, time) {
    const a =
      Math.sin(x * 0.0031 + time * 0.42) * 1.9 +
      Math.cos(y * 0.0037 - time * 0.30) * 1.9 +
      Math.sin((x + y) * 0.0014 + time * 0.17) * 1.2;
    return a;
  }

  function fieldColor(p) {
    const P = PALETTES[pal];
    // h1 -> h2 по цвету частицы; при переходе через 360 берём длинный путь
    let span = P.h2 - P.h1;
    if (Math.abs(span) > 180) span = span > 0 ? span - 360 : span + 360;
    const hue = (P.h1 + span * p.hueShift + 360) % 360;
    return 'hsla(' + hue.toFixed(1) + ', 100%, 62%, ';
  }

  function frame() {
    requestAnimationFrame(frame);
    t += 0.006;

    const P = PALETTES[pal];
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.15;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      let a = angleAt(p.x, p.y, t);

      // мышь: сначала притяжение к курсору, при клике — разброс
      if (pointer.active) {
        const dx = pointer.x - p.x;
        const dy = pointer.y - p.y;
        const d = Math.hypot(dx, dy);

        // долетела до самого курсора — гаснет и рождается заново.
        // без этого частицы сбиваются в точку и слипаются в белую линию
        if (d < 46) { spawn(p); continue; }

        if (d < 260 && d > 0.001) {
          const pull = (1 - d / 260);
          const ta = Math.atan2(dy, dx);
          if (pointer.force > 0) {
            a = a * 0.25 + (ta + Math.PI) * 0.75;   // расталкивание при клике
          } else {
            // закрутка, а не лобовое притяжение: частицы идут по спирали.
            // лобовое тянет их строго по оси и оставляет яркую линию на экране
            a = a * 0.30 + (ta + 1.15) * 0.70 + (p.hueShift - 0.5) * 0.4;
          }
          p.speed = Math.min(p.speed + pull * 0.35, 4);
        }
      }

      const nx = p.x + Math.cos(a) * p.speed;
      const ny = p.y + Math.sin(a) * p.speed;

      ctx.strokeStyle = fieldColor(p) + '0.75)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();

      p.x = nx;
      p.y = ny;
      p.age++;

      // мягкое затухание скорости
      p.speed *= 0.995;
      if (p.speed < 0.4) p.speed = 0.4;

      const out = p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40;
      if (out || p.age > p.life) spawn(p);
    }

    if (pointer.force > 0) pointer.force *= 0.92;
    ctx.globalCompositeOperation = 'source-over';
  }

  // --- события ---

  window.addEventListener('resize', resize);

  window.addEventListener('pointermove', function (e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  });

  window.addEventListener('pointerdown', function (e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    pointer.force = 1;
  });

  window.addEventListener('pointerleave', function () {
    pointer.active = false;
  });

  document.querySelectorAll('.chip[data-pal]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      pal = parseInt(btn.dataset.pal, 10) || 0;
      document.querySelectorAll('.chip[data-pal]').forEach(function (b) {
        b.classList.toggle('on', b === btn);
      });
      // стираем следы старой палитры, чтобы не смешивалось
      ctx.fillStyle = '#05030f';
      ctx.fillRect(0, 0, w, h);
    });
  });

  document.getElementById('clear').addEventListener('click', function () {
    ctx.fillStyle = '#05030f';
    ctx.fillRect(0, 0, w, h);
    spawnAll();
  });

  resize();

  if (reduced) {
    // статичный кадр: прогоняем немного шагов, но не крутим бесконечно
    for (let i = 0; i < 90; i++) {
      t += 0.02;
      (function one() {
        ctx.globalCompositeOperation = 'lighter';
        for (const p of particles) {
          const a = angleAt(p.x, p.y, t);
          const nx = p.x + Math.cos(a) * p.speed * 2;
          const ny = p.y + Math.sin(a) * p.speed * 2;
          ctx.strokeStyle = fieldColor(p) + '0.5)';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(nx, ny);
          ctx.stroke();
          p.x = nx; p.y = ny;
        }
        ctx.globalCompositeOperation = 'source-over';
      })();
    }
  } else {
    requestAnimationFrame(frame);
  }
})();

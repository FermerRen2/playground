// Фоновое поле частиц для витрины.
// Только визуал: на клики не влияет, pointer-events выключены в CSS.

(function () {
  const canvas = document.getElementById('stars');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let w = 0, h = 0, dpr = 1;
  let particles = [];
  let pointer = { x: 0.5, y: 0.5, active: false };

  const COLORS = ['#00f0ff', '#ff2bd6', '#7a3cff', '#b6ff2b'];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function build() {
    // плотность зависит от площади: на телефоне столько же глаз не нужно
    const count = Math.round(Math.min(180, Math.max(50, (w * h) / 14000)));
    particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        z: 0.25 + Math.random() * 0.75,       // «глубина»: скорость и размер
        r: 0.6 + Math.random() * 1.8,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        vx: 0,
        vy: 0,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  function step(t) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    const px = pointer.x * w;
    const py = pointer.y * h;

    for (const p of particles) {
      p.phase += 0.004;

      // собственный дрейф
      p.vx += Math.cos(p.phase * 1.7 + p.x * 0.004) * 0.012;
      p.vy += Math.sin(p.phase * 1.3 + p.y * 0.004) * 0.012;

      // лёгкое притяжение к курсору
      if (pointer.active) {
        const dx = px - p.x;
        const dy = py - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 90000) {
          const f = (1 - d2 / 90000) * 0.05;
          p.vx += dx * f * 0.02;
          p.vy += dy * f * 0.02;
        }
      }

      // трение и ограничение скорости
      p.vx *= 0.96;
      p.vy *= 0.96;
      const sp = Math.hypot(p.vx, p.vy);
      const max = 1.6 * p.z;
      if (sp > max) {
        p.vx = (p.vx / sp) * max;
        p.vy = (p.vy / sp) * max;
      }

      p.x += p.vx;
      p.y += p.vy;

      // заворачиваем по краям
      if (p.x < -20) p.x = w + 20;
      if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20;
      if (p.y > h + 20) p.y = -20;

      // хвост-след: короткая линия по вектору скорости
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.16 + p.z * 0.30;
      ctx.lineWidth = p.r * p.z;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 6, p.y - p.vy * 6);
      ctx.stroke();

      // ядро
      ctx.globalAlpha = 0.35 + p.z * 0.45;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.z * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (!reduce) requestAnimationFrame(step);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX / window.innerWidth;
    pointer.y = e.clientY / window.innerHeight;
    pointer.active = true;
  });
  window.addEventListener('pointerleave', () => { pointer.active = false; });

  resize();
  if (reduce) {
    // один статичный кадр вместо анимации
    step(0);
  } else {
    requestAnimationFrame(step);
  }
})();

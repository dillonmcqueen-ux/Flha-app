// FORA marketing site: hero animation, "paper chaos to digital precision."
// Pure canvas + rAF, no dependencies. Left side draws a loose cluster of
// wireframe paper forms; a stream of particles peels off that cluster,
// crosses the middle of the hero and assembles onto a glowing device
// outline on the right, then releases and loops. Reacts a little to the
// mouse. Respects prefers-reduced-motion and pauses when the tab is hidden.
(function () {
  var canvas = document.getElementById('heroCanvas');
  var hero = canvas && canvas.closest('.hero');
  if (!canvas || !hero || !canvas.getContext) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var ctx = canvas.getContext('2d');
  var root = getComputedStyle(document.documentElement);
  var COLOR_ORANGE = (root.getPropertyValue('--orange') || '#FF6B00').trim();
  var COLOR_LINE = (root.getPropertyValue('--line') || '#263345').trim();
  var COLOR_MUTED = (root.getPropertyValue('--muted') || '#94A3B8').trim();

  var width = 0, height = 0, dpr = 1;
  var mouse = { x: -9999, y: -9999, active: false };
  var papers = [];
  var particles = [];
  var deviceTargets = [];
  var rafId = null;
  var running = false;
  var startTime = performance.now();

  function rand(a, b) { return a + Math.random() * (b - a); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function resize() {
    var rect = hero.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildScene();
  }

  // Wireframe "paper" forms floating in the left third of the hero.
  function buildPapers() {
    papers = [];
    var count = width < 700 ? 4 : 7;
    for (var i = 0; i < count; i++) {
      var w = rand(70, 120);
      var h = w * rand(1.25, 1.5);
      papers.push({
        baseX: rand(width * 0.03, width * 0.32),
        baseY: rand(height * 0.16, height * 0.86),
        w: w,
        h: h,
        rot: rand(-0.18, 0.18),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.35, 0.6),
        lines: Math.round(rand(3, 5))
      });
    }
  }

  // Target points along a rounded "device" frame on the right: the shape
  // the particle stream assembles into. A phone/dashboard silhouette plus
  // a couple of interior "screen" rows.
  function buildDeviceTargets() {
    deviceTargets = [];
    var w = clamp(width * 0.22, 140, 220);
    var h = w * 1.7;
    var cx = width - clamp(width * 0.16, 90, 170);
    var cy = height * 0.52;
    var x0 = cx - w / 2, y0 = cy - h / 2;
    var r = 18;
    var perim = [];

    function pushArc(cxA, cyA, r, a0, a1, steps) {
      for (var i = 0; i <= steps; i++) {
        var a = lerp(a0, a1, i / steps);
        perim.push({ x: cxA + Math.cos(a) * r, y: cyA + Math.sin(a) * r });
      }
    }
    var topN = Math.round(w / 14), sideN = Math.round(h / 14);
    for (var i = 0; i <= topN; i++) perim.push({ x: lerp(x0 + r, x0 + w - r, i / topN), y: y0 });
    pushArc(x0 + w - r, y0 + r, r, -Math.PI / 2, 0, 6);
    for (i = 0; i <= sideN; i++) perim.push({ x: x0 + w, y: lerp(y0 + r, y0 + h - r, i / sideN) });
    pushArc(x0 + w - r, y0 + h - r, r, 0, Math.PI / 2, 6);
    for (i = 0; i <= topN; i++) perim.push({ x: lerp(x0 + w - r, x0 + r, i / topN), y: y0 + h });
    pushArc(x0 + r, y0 + h - r, r, Math.PI / 2, Math.PI, 6);
    for (i = 0; i <= sideN; i++) perim.push({ x: x0, y: lerp(y0 + h - r, y0 + r, i / sideN) });
    pushArc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, 6);

    // a handful of interior "data row" points so the assembled shape reads
    // as a lit screen, not just an outline
    var rows = 4;
    for (i = 1; i <= rows; i++) {
      var ry = y0 + (h / (rows + 1)) * i;
      var rowPts = Math.round(rand(3, 5));
      for (var j = 0; j < rowPts; j++) {
        perim.push({ x: lerp(x0 + 18, x0 + w - 18, rowPts === 1 ? 0.5 : j / (rowPts - 1)), y: ry });
      }
    }

    deviceTargets = perim;
    deviceFrame = { x0: x0, y0: y0, w: w, h: h, r: r, cx: cx, cy: cy };
  }

  var deviceFrame = null;

  function buildParticles() {
    particles = [];
    if (!deviceTargets.length) return;
    var count = width < 700 ? Math.min(50, deviceTargets.length) : Math.min(110, deviceTargets.length * 2);
    for (var i = 0; i < count; i++) {
      particles.push(makeParticle(i));
    }
  }

  function spawnPoint() {
    var p = papers.length ? papers[Math.floor(Math.random() * papers.length)] : null;
    var sx = p ? p.baseX + rand(-p.w * 0.3, p.w * 0.3) : rand(width * 0.05, width * 0.3);
    var sy = p ? p.baseY + rand(-p.h * 0.3, p.h * 0.3) : rand(height * 0.2, height * 0.8);
    return { x: sx, y: sy };
  }

  function makeParticle(i) {
    var target = deviceTargets[i % deviceTargets.length];
    var spawn = spawnPoint();
    return {
      target: target,
      sx: spawn.x, sy: spawn.y,
      x: spawn.x, y: spawn.y,
      t: rand(-0.4, 0), // negative = staggered start delay before travel begins
      dur: rand(2.6, 4.2),
      arc: rand(-40, 40),
      settled: false,
      settleAt: 0,
      hold: rand(2.5, 5),
      ox: 0, oy: 0 // spring offset from mouse interaction
    };
  }

  function buildScene() {
    buildPapers();
    buildDeviceTargets();
    buildParticles();
  }

  function drawPaper(p, t) {
    var bob = Math.sin(t * p.speed + p.phase) * 8;
    var sway = Math.sin(t * p.speed * 0.6 + p.phase) * p.rot;
    ctx.save();
    ctx.translate(p.baseX, p.baseY + bob);
    ctx.rotate(sway);
    ctx.strokeStyle = COLOR_LINE;
    ctx.lineWidth = 1.25;
    ctx.globalAlpha = 0.55;
    roundRectPath(-p.w / 2, -p.h / 2, p.w, p.h, 6);
    ctx.stroke();
    // folded corner
    ctx.beginPath();
    ctx.moveTo(p.w / 2 - 14, -p.h / 2);
    ctx.lineTo(p.w / 2, -p.h / 2 + 14);
    ctx.lineTo(p.w / 2 - 14, -p.h / 2 + 14);
    ctx.closePath();
    ctx.stroke();
    // ruled lines standing in for form fields
    ctx.globalAlpha = 0.4;
    for (var i = 0; i < p.lines; i++) {
      var ly = -p.h / 2 + 26 + i * ((p.h - 40) / p.lines);
      ctx.beginPath();
      ctx.moveTo(-p.w / 2 + 12, ly);
      ctx.lineTo(p.w / 2 - 12 - (i === 0 ? 0 : rand(0, 16)), ly);
      ctx.stroke();
    }
    // a small "stamped" accent mark, tying it to the brand accent color
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = COLOR_ORANGE;
    ctx.beginPath();
    ctx.arc(-p.w / 2 + 16, p.h / 2 - 16, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawDeviceFrame(t) {
    if (!deviceFrame) return;
    var pulse = 0.6 + Math.sin(t * 1.4) * 0.15;
    ctx.save();
    ctx.strokeStyle = COLOR_ORANGE;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.75;
    ctx.shadowColor = COLOR_ORANGE;
    ctx.shadowBlur = 16 * pulse;
    roundRectPath(deviceFrame.x0, deviceFrame.y0, deviceFrame.w, deviceFrame.h, deviceFrame.r);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = COLOR_MUTED;
    ctx.beginPath();
    ctx.moveTo(deviceFrame.x0 + 14, deviceFrame.y0 + 28);
    ctx.lineTo(deviceFrame.x0 + deviceFrame.w - 14, deviceFrame.y0 + 28);
    ctx.stroke();
    ctx.restore();
  }

  function updateParticle(p, dt, t) {
    if (p.t < 1) {
      p.t += dt / p.dur;
    } else if (!p.settled) {
      p.settled = true;
      p.settleAt = t;
    } else if (t - p.settleAt > p.hold) {
      var spawn = spawnPoint();
      p.sx = spawn.x; p.sy = spawn.y;
      p.t = -rand(0, 0.5);
      p.settled = false;
    }

    var progress = clamp(p.t, 0, 1);
    var eased = progress < 1 ? 1 - Math.pow(1 - progress, 3) : 1;
    var bx = lerp(p.sx, p.target.x, eased);
    var by = lerp(p.sy, p.target.y, eased) - Math.sin(eased * Math.PI) * p.arc;

    // mouse: gently push particles that are still travelling (keeps the
    // assembled device shape crisp once particles arrive)
    var targetOx = 0, targetOy = 0;
    if (mouse.active && progress > 0 && progress < 1) {
      var dx = bx - mouse.x, dy = by - mouse.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var radius = 140;
      if (dist < radius && dist > 0.001) {
        var force = (1 - dist / radius) * 22;
        targetOx = (dx / dist) * force;
        targetOy = (dy / dist) * force;
      }
    }
    p.ox = lerp(p.ox, targetOx, 0.08);
    p.oy = lerp(p.oy, targetOy, 0.08);

    p.x = bx + p.ox;
    p.y = by + p.oy;
    p._progress = progress;
  }

  function drawParticle(p, t) {
    var progress = p._progress;
    // early = dull "scrap of paper" chip, late = glowing brand-color node
    var size = lerp(2, 3.6, progress);
    var glow = progress > 0.55 ? (progress - 0.55) / 0.45 : 0;
    ctx.save();
    if (glow > 0) {
      var pulse = p.settled ? 0.7 + Math.sin(t * 2.2 + p.target.x) * 0.3 : 1;
      ctx.shadowColor = COLOR_ORANGE;
      ctx.shadowBlur = 10 * glow * pulse;
      ctx.fillStyle = COLOR_ORANGE;
      ctx.globalAlpha = clamp(0.5 + glow * 0.5, 0, 1);
    } else {
      ctx.fillStyle = COLOR_MUTED;
      ctx.globalAlpha = 0.5;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function frame(now) {
    if (!running) return;
    var t = (now - startTime) / 1000;
    var dt = Math.min(0.05, t - (frame._last || t));
    frame._last = t;

    ctx.clearRect(0, 0, width, height);

    for (var i = 0; i < papers.length; i++) drawPaper(papers[i], t);
    drawDeviceFrame(t);
    for (i = 0; i < particles.length; i++) {
      updateParticle(particles[i], dt, t);
      drawParticle(particles[i], t);
    }

    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    frame._last = undefined;
    startTime = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function onMouseMove(e) {
    var rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    mouse.active = true;
  }
  function onMouseLeave() { mouse.active = false; }

  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }

  function onVisibility() {
    if (document.hidden) stop(); else start();
  }

  resize();
  start();

  window.addEventListener('resize', onResize);
  hero.addEventListener('mousemove', onMouseMove);
  hero.addEventListener('mouseleave', onMouseLeave);
  document.addEventListener('visibilitychange', onVisibility);

  // Cleanup hook: nothing else on this static, multi-page site tears this
  // module down, but pagehide (bfcache-safe, unlike unload) stops the loop
  // and drops listeners so a cached page doesn't keep animating/leaking.
  window.addEventListener('pagehide', function () {
    stop();
    window.removeEventListener('resize', onResize);
    hero.removeEventListener('mousemove', onMouseMove);
    hero.removeEventListener('mouseleave', onMouseLeave);
    document.removeEventListener('visibilitychange', onVisibility);
  });
})();

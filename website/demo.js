// FORA marketing site: interactive FLHA demo behavior.
// No network requests: renders pre-authored scenarios from demo-data.js
// with a staged "generating" animation to show the pace of a real FLHA.
(function () {
  const chipsEl = document.getElementById('demoChips');
  const panelEl = document.getElementById('demoPanel');
  if (!chipsEl || !panelEl || typeof FLHA_DEMO_SCENARIOS === 'undefined') return;

  const STAGES = ['Reading the task…', 'Identifying hazards…', 'Assigning risk ratings…', 'Finalizing PPE…'];
  const RISK_ORDER = { Extreme: 0, High: 1, Medium: 2, Low: 3 };

  let timers = [];
  let stopwatchInterval = null;

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (stopwatchInterval) clearInterval(stopwatchInterval);
    stopwatchInterval = null;
  }

  chipsEl.querySelectorAll('.demo-chip').forEach((chip) => {
    chip.addEventListener('click', () => runDemo(chip.dataset.id, chip));
  });

  function runDemo(id, chipEl) {
    const scenario = FLHA_DEMO_SCENARIOS.find((s) => s.id === id);
    if (!scenario) return;

    clearTimers();
    chipsEl.querySelectorAll('.demo-chip').forEach((c) => c.classList.toggle('active', c === chipEl));

    const startedAt = Date.now();
    panelEl.hidden = false;
    panelEl.innerHTML =
      '<div class="demo-loading">' +
      '  <div class="demo-stopwatch">0:00</div>' +
      '  <div class="demo-stage" id="demoStage">' + STAGES[0] + '</div>' +
      '  <div class="demo-bar"><div class="demo-bar-fill" id="demoBarFill"></div></div>' +
      '</div>';
    panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const stopwatchEl = panelEl.querySelector('.demo-stopwatch');
    stopwatchInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = String(elapsed % 60).padStart(2, '0');
      if (stopwatchEl) stopwatchEl.textContent = mins + ':' + secs;
    }, 200);

    const stageEl = () => panelEl.querySelector('#demoStage');
    const barFillEl = () => panelEl.querySelector('#demoBarFill');
    const stepDelay = 1400;
    STAGES.forEach((label, i) => {
      timers.push(setTimeout(() => {
        if (stageEl()) stageEl().textContent = label;
        if (barFillEl()) barFillEl().style.width = Math.round(((i + 1) / STAGES.length) * 100) + '%';
      }, i * stepDelay));
    });

    timers.push(setTimeout(() => {
      clearInterval(stopwatchInterval);
      stopwatchInterval = null;
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      renderResult(scenario, elapsedSeconds);
    }, STAGES.length * stepDelay + 400));
  }

  function renderResult(scenario, elapsedSeconds) {
    const hazardRows = scenario.hazards
      .slice()
      .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk])
      .map(
        (h) =>
          '<tr class="risk-' + h.risk.toLowerCase() + '">' +
          '<td class="demo-td-hazard">' + escapeHtml(h.hazard) + '</td>' +
          '<td class="demo-td-control">' + escapeHtml(h.control) + '</td>' +
          '<td class="demo-td-risk"><span class="risk-badge risk-badge-' + h.risk.toLowerCase() + '">' + h.risk + '</span></td>' +
          '</tr>'
      )
      .join('');

    const ppeChips = scenario.ppeRequired.map((p) => '<span class="chip">' + escapeHtml(p) + '</span>').join('');

    panelEl.innerHTML =
      '<div class="demo-result">' +
      '  <div class="demo-result-head">' +
      '    <div class="demo-result-time">Generated in ' + elapsedSeconds + 's</div>' +
      '    <p class="demo-summary">' + escapeHtml(scenario.taskSummary) + '</p>' +
      '  </div>' +
      '  <div class="demo-table-wrap"><table class="demo-table">' +
      '    <thead><tr><th>Hazard</th><th>Control</th><th>Risk</th></tr></thead>' +
      '    <tbody>' + hazardRows + '</tbody>' +
      '  </table></div>' +
      '  <div class="demo-ppe"><span class="demo-ppe-label">PPE required:</span> <div class="chips">' + ppeChips + '</div></div>' +
      '  <p class="demo-disclaimer">This demo shows general hazard identification. On your account, FORA also cross-references your company’s own SOPs. That’s the part that’s different for every company.</p>' +
      '  <div class="demo-cta">' +
      '    <p>That’s what your crew gets in under a minute.</p>' +
      '    <a href="pricing.html" class="cta-btn">See pricing</a>' +
      '  </div>' +
      '</div>';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();

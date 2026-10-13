(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- hero: the name rises from behind the hills, and sets again as the page scrolls ---------- */

  function initHero() {
    const hero = $('.hero'), name = $('.name'), ground = $('.hero__ground');

    // Wait for the hills, or the name would be seen sitting on bare sky before it hides.
    const ready = () => hero.classList.add('is-ready');
    if (ground.complete) ready();
    else {
      ground.addEventListener('load', ready);
      ground.addEventListener('error', ready);
    }

    if (reduceMotion) return;
    let queued = false;
    addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        name.style.translate = `0 ${Math.min(scrollY, hero.offsetHeight) * 0.5}px`;
        queued = false;
      });
    }, { passive: true });
  }

  /* ---------- step response of a PID position loop ---------- */

  function initLoop() {
    const SPAN = 6, STEP_AT = 0.5, LOAD_AT = 3.5, DT = 1 / 500, FLOOR = -0.3, CEIL = 1.5;
    const DAMPING = 2, DRIVE_MAX = 80, WINDUP_MAX = 2, LOAD = 6, INTEGRAL_BAND = 0.1;
    const gains = { kp: 80, ki: 120, kd: 12 };
    const trace = $('#loop-trace'), read = $('#loop-read'), presets = $$('[data-preset]');

    function simulate() {
      const points = [];
      let x = 0, v = 0, integral = 0, peak = 0, unsettledAt = STEP_AT, sagAt = LOAD_AT;
      for (let i = 0, n = SPAN / DT; i <= n; i++) {
        const t = i * DT, target = t >= STEP_AT ? 1 : 0, loaded = t >= LOAD_AT;
        const error = target - x;
        // Integrate only near the target, so the step itself does not wind the integrator up.
        if (Math.abs(error) < INTEGRAL_BAND) integral = clamp(integral + error * DT, -WINDUP_MAX, WINDUP_MAX);
        const drive = clamp(gains.kp * error + gains.ki * integral - gains.kd * v, -DRIVE_MAX, DRIVE_MAX);
        v += (drive - DAMPING * v - (loaded ? LOAD : 0)) * DT;
        x += v * DT;
        if (Math.abs(x - 1) > 0.02) {
          if (loaded) sagAt = t; else if (t >= STEP_AT) unsettledAt = t;
        }
        if (t >= STEP_AT && !loaded) peak = Math.max(peak, x - 1);
        if (i % 5 === 0) points.push(`${t.toFixed(2)},${(CEIL - clamp(x, FLOOR, CEIL)).toFixed(3)}`);
      }
      return {
        points, overshoot: peak * 100, offBy: Math.abs(x - 1) * 100,
        settle: unsettledAt - STEP_AT, settled: unsettledAt < LOAD_AT - 0.05,
        recover: sagAt - LOAD_AT, recovered: sagAt < SPAN - 0.05,
      };
    }

    function render() {
      const result = simulate();
      trace.setAttribute('d', 'M' + result.points.join('L'));
      read.textContent = `Overshoot ${result.overshoot.toFixed(1)}%. `
        + (result.settled ? `Settles within 2% of the target in ${result.settle.toFixed(2)} s. ` : 'Still not settled when the load arrives. ')
        + (result.recovered ? `Recovers from the load in ${result.recover.toFixed(2)} s.` : `Ends ${result.offBy.toFixed(0)}% off target under the load.`);
      const current = `${gains.kp},${gains.ki},${gains.kd}`;
      for (const button of presets) button.setAttribute('aria-pressed', button.dataset.preset === current);
    }

    function setGain(key, value) {
      gains[key] = Number(value);
      $('#' + key).value = value;
      $('#o-' + key).textContent = gains[key];
    }

    for (const key of Object.keys(gains)) {
      $('#' + key).addEventListener('input', (event) => { setGain(key, event.target.value); render(); });
    }
    for (const button of presets) {
      button.addEventListener('click', () => {
        const [kp, ki, kd] = button.dataset.preset.split(',');
        setGain('kp', kp); setGain('ki', ki); setGain('kd', kd);
        render();
      });
    }
    render();
  }

  /* ---------- extrusion run: speed over four hours, with and without the loop ---------- */

  function initRun() {
    const SPAN = 240, DT = 0.05, TAU = 0.4, KP = 6, KI = 3;       // minutes
    const TOP = 1.04, RANGE = 0.16;                               // the plot shows 88% to 104% of target speed
    const WALL = 10, EXAGGERATE = 5;
    const trace = $('#run-trace'), wallTop = $('#run-wall-top'), wallBottom = $('#run-wall-bottom');
    const read = $('#run-read'), buttons = $$('[data-run]');

    // Load on the motor: the paste stiffens over the run, the screw ripples, and two refills shift it.
    const load = (t) => 0.07 * (t / SPAN) + 0.012 * Math.sin(t / 3.7) + (t > 75 ? 0.025 : 0) - (t > 165 ? 0.015 : 0);

    function simulate(closed) {
      const samples = [];
      let v = 1, integral = 0, worst = 0;
      for (let i = 0, n = SPAN / DT; i <= n; i++) {
        const t = i * DT, error = 1 - v;
        integral += error * DT;
        const drive = 1 + (closed ? KP * error + KI * integral : 0);
        v += (drive - load(t) - v) / TAU * DT;
        worst = Math.max(worst, Math.abs(v - 1));
        if (i % 20 === 0) samples.push([t, v]);
      }
      return { samples, worst: worst * 100 };
    }

    function render(mode) {
      const { samples, worst } = simulate(mode === 'closed');
      trace.setAttribute('d', 'M' + samples.map(([t, v]) => `${t},${((TOP - v) / RANGE * 100).toFixed(2)}`).join('L'));
      // The wall follows the speed: a slower screw delivers less paste.
      const inner = samples.map(([t, v]) => [t, WALL * (1 + EXAGGERATE * (v - 1))]);
      wallTop.setAttribute('d', `M0,4H${SPAN}` + [...inner].reverse().map(([t, w]) => `L${t},${(4 + w).toFixed(2)}`).join('') + 'Z');
      wallBottom.setAttribute('d', `M0,36H${SPAN}` + [...inner].reverse().map(([t, w]) => `L${t},${(36 - w).toFixed(2)}`).join('') + 'Z');
      read.textContent = mode === 'closed'
        ? `Closed loop: speed stays within ${worst.toFixed(1)}% of target for the whole run, and the wall stays even.`
        : `Open loop: speed falls ${worst.toFixed(1)}% short as the paste stiffens, and the wall thins with it.`;
      for (const button of buttons) button.setAttribute('aria-pressed', button.dataset.run === mode);
    }

    for (const button of buttons) button.addEventListener('click', () => render(button.dataset.run));
    render('closed');
  }

  /* ---------- fuel cell: voltage and power curves as the layers change ---------- */

  function initCell() {
    const RT_F = 8.314 * 1073 / 96485;                            // volts, at 800 °C
    const E_NERNST = 1.02, SIGMA_ELECTROLYTE = 0.035, SIGMA_ELECTRODE = 0.05;   // V, S/cm
    const I0_MAX = 0.3, REACH = 15;                               // A/cm², and how deep (µm) the electrode stays active
    const I_MAX = 3, Y_MAX = 1.1, STEP = 0.01;
    const layers = { te: 150, tc: 30 };                           // µm
    const voltage = $('#cell-voltage'), power = $('#cell-power'), peak = $('#cell-peak'), read = $('#cell-read');

    function at(i) {
      const i0 = I0_MAX * (1 - Math.exp(-layers.tc / REACH));
      const activation = RT_F * Math.asinh(i / (2 * i0));
      const ohmic = i * (layers.te * 1e-4 / SIGMA_ELECTROLYTE + layers.tc * 1e-4 / SIGMA_ELECTRODE);
      return { v: E_NERNST - activation - ohmic, activation, ohmic };
    }

    function render() {
      const vPoints = [], pPoints = [];
      let best = { i: 0, p: 0 };
      for (let i = 0; i <= I_MAX + 1e-9; i += STEP) {
        const point = at(i);
        if (point.v < 0) break;
        const p = point.v * i;
        vPoints.push(`${i.toFixed(2)},${(Y_MAX - point.v).toFixed(3)}`);
        pPoints.push(`${i.toFixed(2)},${(Y_MAX - p).toFixed(3)}`);
        if (p > best.p) best = { i, p, ...point };
      }
      voltage.setAttribute('d', 'M' + vPoints.join('L'));
      power.setAttribute('d', 'M' + pPoints.join('L'));
      peak.style.left = `${best.i / I_MAX * 100}%`;
      peak.style.top = `${(Y_MAX - best.p) / Y_MAX * 100}%`;
      read.textContent = `Peak power ${best.p.toFixed(2)} W/cm² at ${best.i.toFixed(2)} A/cm² and ${best.v.toFixed(2)} V. `
        + `Ohmic loss costs ${best.ohmic.toFixed(2)} V there, activation ${best.activation.toFixed(2)} V.`;
    }

    for (const key of Object.keys(layers)) {
      $('#' + key).addEventListener('input', (event) => {
        layers[key] = Number(event.target.value);
        $('#o-' + key).textContent = `${layers[key]} µm`;
        render();
      });
    }
    render();
  }

  initHero();
  initLoop();
  initRun();
  initCell();
})();

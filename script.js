 /**
 * Operating Systems Project: Disk Scheduling Simulation
 * Authors: Kanak Desai & Aashka Kariya
 * Algorithms: SCAN & C-SCAN
 */

const $ = (id) => document.getElementById(id);

// Assumed mechanical seek time constant per cylinder for latency estimations
// Referenced from Elnaas & Sullabi (2024) benchmarking model
const SEEK_TIME_PER_CYLINDER_MS = 0.125;

const pageNames = {
  home: "Overview",
  scan: "SCAN Algorithm",
  cscan: "C-SCAN Algorithm",
  compare: "Compare Algorithms",
  research: "Research Papers"
};

// Tab Switching
function showPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === `page-${name}`));
  document.querySelectorAll(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.page === name));
  $("crumb").textContent = pageNames[name] || "Overview";
  $("sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.go)));
$("menuToggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));
document.addEventListener("click", e => {
  if (window.innerWidth <= 800 && $("sidebar").classList.contains("open") &&
      !e.target.closest("#sidebar") && !e.target.closest("#menuToggle")) {
    $("sidebar").classList.remove("open");
  }
});

/* ==========================================================================
   1. INPUT VALIDATION & PARSING
   ========================================================================== */
function parseInput(prefix) {
  const raw = $(`${prefix}Queue`).value.trim();
  const maxVal = $(`${prefix}Max`).value.trim();
  const headVal = $(`${prefix}Head`).value.trim();
  const direction = $(`${prefix}Direction`).value;

  if (!raw) {
    throw new Error("Request queue cannot be empty. Please enter track numbers.");
  }

  // Reject non-numeric characters, letters, negative signs, decimal points
  const tokens = raw.split(",").map(s => s.trim());
  for (let s of tokens) {
    if (s === "") throw new Error("Empty entry detected between commas. Remove trailing/duplicate commas.");
    if (!/^\d+$/.test(s)) throw new Error(`Invalid cylinder value "${s}". Only whole positive numbers (0, 1, 2...) are allowed.`);
  }

  const queue = tokens.map(Number);
  const max = Number(maxVal);
  const head = Number(headVal);

  if (isNaN(max) || !Number.isSafeInteger(max) || max < 1) {
    throw new Error("Maximum cylinder must be a positive integer of at least 1.");
  }
  if (isNaN(head) || !Number.isSafeInteger(head) || head < 0 || head > max) {
    throw new Error(`Initial head position (${headVal}) must be within range 0 to ${max}.`);
  }
  for (let req of queue) {
    if (req < 0 || req > max) {
      throw new Error(`Request track ${req} is outside the disk bounds (0 to ${max}).`);
    }
  }
  if (queue.length > 50) {
    throw new Error("Queue size limit is 50 requests for readable visualization.");
  }

  return { queue, max, head, direction };
}

/* ==========================================================================
   2. CORE ALGORITHM LOGIC: SCAN
   ========================================================================== */
function runScanLogic({ queue, max, head, direction }) {
  // Sort requests relative to initial head position
  // Preserve duplicates as distinct arrivals
  const left = queue.filter(r => r < head).sort((a, b) => b - a); // Descending
  const right = queue.filter(r => r >= head).sort((a, b) => a - b); // Ascending

  const path = [{ pos: head, label: "Start", kind: "start", serviced: false }];

  if (direction === "right") {
    // 1. Service requests towards the right boundary
    right.forEach(pos => path.push({ pos, label: String(pos), kind: "request", serviced: true }));
    // 2. Touch the right boundary track (if not already there and there are remaining requests on the left)
    const lastPos = path[path.length - 1].pos;
    if (lastPos !== max || left.length > 0) {
      if (lastPos !== max) path.push({ pos: max, label: `Boundary ${max}`, kind: "boundary", serviced: false });
    }
    // 3. Reverse and service requests moving left
    left.forEach(pos => path.push({ pos, label: String(pos), kind: "request", serviced: true }));
  } else {
    // 1. Service requests towards the left boundary (0)
    left.forEach(pos => path.push({ pos, label: String(pos), kind: "request", serviced: true }));
    // 2. Touch track 0 boundary (if not already there and there are remaining requests on the right)
    const lastPos = path[path.length - 1].pos;
    if (lastPos !== 0 || right.length > 0) {
      if (lastPos !== 0) path.push({ pos: 0, label: "Boundary 0", kind: "boundary", serviced: false });
    }
    // 3. Reverse and service requests moving right
    right.forEach(pos => path.push({ pos, label: String(pos), kind: "request", serviced: true }));
  }

  return buildSimulationMetrics("SCAN", path, queue, max, head, direction);
}

/* ==========================================================================
   3. CORE ALGORITHM LOGIC: C-SCAN
   ========================================================================== */
function runCScanLogic({ queue, max, head, direction }) {
  const left = queue.filter(r => r < head).sort((a, b) => a - b); // Ascending for return sweep
  const right = queue.filter(r => r >= head).sort((a, b) => a - b); // Ascending

  const path = [{ pos: head, label: "Start", kind: "start", serviced: false }];

  if (direction === "right") {
    // 1. Service rightward requests
    right.forEach(pos => path.push({ pos, label: String(pos), kind: "request", serviced: true }));
    // 2. Move to boundary track max
    if (path[path.length - 1].pos !== max) {
      path.push({ pos: max, label: `Boundary ${max}`, kind: "boundary", serviced: false });
    }
    // 3. Return jump (wrap-around) to opposite boundary 0 without servicing
    path.push({ pos: 0, label: "Wrap to 0", kind: "wrap", serviced: false });
    // 4. Continue in same original rightward direction
    left.forEach(pos => path.push({ pos, label: String(pos), kind: "request", serviced: true }));
  } else {
    // 1. Service leftward requests (descending)
    const leftDesc = queue.filter(r => r < head).sort((a, b) => b - a);
    const rightDesc = queue.filter(r => r >= head).sort((a, b) => b - a);

    leftDesc.forEach(pos => path.push({ pos, label: String(pos), kind: "request", serviced: true }));
    // 2. Move to boundary track 0
    if (path[path.length - 1].pos !== 0) {
      path.push({ pos: 0, label: "Boundary 0", kind: "boundary", serviced: false });
    }
    // 3. Return jump to track max without servicing
    path.push({ pos: max, label: `Wrap to ${max}`, kind: "wrap", serviced: false });
    // 4. Continue in same leftward direction
    rightDesc.forEach(pos => path.push({ pos, label: String(pos), kind: "request", serviced: true }));
  }

  return buildSimulationMetrics("C-SCAN", path, queue, max, head, direction);
}

/* ==========================================================================
   4. METRICS & MOVEMENT CALCULATION ENGINE
   ========================================================================== */
function buildSimulationMetrics(type, rawPath, queue, max, head, direction) {
  // Clean redundant sequential boundary stops if a request lands exactly on a boundary
  const normalized = [];
  for (let item of rawPath) {
    const prev = normalized[normalized.length - 1];
    if (prev && prev.pos === item.pos && item.kind === "boundary" && prev.kind === "request") {
      continue;
    }
    normalized.push({ ...item });
  }

  let totalHeadMovement = 0;
  const moves = [];

  for (let i = 1; i < normalized.length; i++) {
    const from = normalized[i - 1];
    const to = normalized[i];
    const distance = Math.abs(to.pos - from.pos);
    totalHeadMovement += distance;

    let actionLabel = "Service Request";
    if (to.kind === "wrap") actionLabel = "Wrap-around (No Service)";
    else if (to.kind === "boundary") actionLabel = "Travel to Boundary Track";

    moves.push({
      step: i,
      from: from.pos,
      to: to.pos,
      distance,
      accumulated: totalHeadMovement,
      action: actionLabel
    });
  }

  const servicedOrder = normalized.filter(p => p.serviced).map(p => p.pos);
  const avgMovementPerRequest = queue.length > 0 ? (totalHeadMovement / queue.length) : 0;
  const estimatedSeekLatencyMs = (totalHeadMovement * SEEK_TIME_PER_CYLINDER_MS).toFixed(2);

  return {
    type,
    path: normalized,
    moves,
    total: totalHeadMovement,
    average: avgMovementPerRequest,
    estimatedSeekLatencyMs,
    serviceSequence: servicedOrder,
    count: queue.length,
    max,
    head,
    direction
  };
}

/* ==========================================================================
   5. HTML BUILDERS & ANIMATED SVG TRAVERSAL
   ========================================================================== */
function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sequenceHTML(result, idPrefix = "") {
  return `<div class="sequence">${result.path.map((p, i) => {
    let cls = p.kind;
    return `${i ? '<span class="seq-arrow">→</span>' : ""}<span class="seq-node ${cls}" id="${idPrefix}node-${i}" title="${esc(p.label)}">${p.pos}${p.kind === "wrap" ? " ↻" : ""}</span>`;
  }).join("")}</div>`;
}

function movementTableHTML(result, idPrefix = "") {
  return `<div class="movement-table-wrap">
    <table class="movement-table">
      <thead>
        <tr><th>Step</th><th>Movement (From → To)</th><th>Action Performed</th><th>Distance Traversed</th><th>Running Total</th></tr>
      </thead>
      <tbody>
        ${result.moves.map((m, idx) => `
          <tr id="${idPrefix}row-${idx + 1}">
            <td>${m.step}</td>
            <td><strong>${m.from}</strong> → <strong>${m.to}</strong></td>
            <td>${m.action}</td>
            <td>${m.distance} cylinders</td>
            <td>${m.accumulated}</td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr>
          <th colspan="3">Total Head Movement</th>
          <th>${result.total} cylinders</th>
          <th>—</th>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

function svgTrack(result, idPrefix = "") {
  const w = 760, h = 145, left = 35, right = 725, y = 67;
  const scale = n => left + (n / result.max) * (right - left);
  const points = result.path.map(p => ({ x: scale(p.pos), y, kind: p.kind, pos: p.pos, label: p.label }));

  const lines = points.slice(1).map((p, i) => {
    const prev = points[i];
    if (p.kind === "wrap") {
      return `<path id="${idPrefix}path-seg-${i + 1}" class="track-seg" d="M ${prev.x} ${y + 8} Q ${(prev.x + p.x) / 2} ${y + 44} ${p.x} ${y + 8}" fill="none" stroke="#a4394f" stroke-width="2" stroke-dasharray="5 4"/><text x="${(prev.x + p.x) / 2}" y="${y + 42}" text-anchor="middle" fill="#a4394f" font-size="9" font-weight="700">return wrap (no service)</text>`;
    }
    const strokeColor = p.kind === "boundary" ? "#bd8a49" : "#7652a6";
    return `<line id="${idPrefix}path-seg-${i + 1}" class="track-seg" x1="${prev.x}" y1="${y}" x2="${p.x}" y2="${y}" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round"/>`;
  }).join("");

  const dots = points.map((p, i) => {
    let dotColor = "#7652a6";
    if (p.kind === "start") dotColor = "#28557c";
    else if (p.kind === "boundary") dotColor = "#bd8a49";
    else if (p.kind === "wrap") dotColor = "#a4394f";

    return `<circle id="${idPrefix}dot-${i}" class="track-dot" cx="${p.x}" cy="${y}" r="${i === 0 ? 5.5 : 4}" fill="${dotColor}" stroke="#fff" stroke-width="1.5"><title>${esc(p.label)} (${p.pos})</title></circle>`;
  }).join("");

  const labels = points.map((p, i) => {
    if (points.length > 15 && i > 0 && i < points.length - 1 && i % 2) return "";
    const yy = (i % 2 === 0) ? y - 14 : y + 22;
    return `<text x="${p.x}" y="${yy}" text-anchor="middle" fill="#635472" font-size="10" font-weight="600">${p.pos}</text>`;
  }).join("");

  return `<div class="track-panel">
    <div class="track-header">
      <h4>Head Traversal Path (Cylinders 0 to ${result.max})</h4>
      <div class="anim-status" id="${idPrefix}anim-status">Step: <strong>0 / ${result.moves.length}</strong></div>
    </div>
    <div class="anim-controls">
      <button class="btn btn-primary btn-sm" id="${idPrefix}btn-play" type="button">▶ Play</button>
      <button class="btn btn-secondary btn-sm" id="${idPrefix}btn-step" type="button">⏭ Next Step</button>
      <button class="btn btn-quiet btn-sm" id="${idPrefix}btn-reset" type="button">↺ Reset</button>
      <label class="speed-label">Playback Speed:
        <select id="${idPrefix}select-speed" class="anim-speed">
          <option value="1200">0.5x</option>
          <option value="650" selected>1.0x</option>
          <option value="350">2.0x</option>
        </select>
      </label>
    </div>
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${result.type} head traversal chart">
      <line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#e0d6e8" stroke-width="1.5"/>
      ${lines}
      ${dots}
      ${labels}
      <g id="${idPrefix}head-needle" transform="translate(${points[0].x}, ${y})" style="transition: transform 0.35s ease-out;">
        <circle r="8" fill="#e25c80" fill-opacity="0.35"/>
        <circle r="4" fill="#d23762" stroke="#fff" stroke-width="1.5"/>
        <line x1="0" y1="-8" x2="0" y2="-17" stroke="#d23762" stroke-width="2"/>
      </g>
      <text x="${left}" y="119" fill="#907f9e" font-size="10" text-anchor="middle">0</text>
      <text x="${right}" y="119" fill="#907f9e" font-size="10" text-anchor="middle">${result.max}</text>
      <text x="${left}" y="136" fill="#907f9e" font-size="9" font-weight="700">TRACK 0</text>
      <text x="${right}" y="136" fill="#907f9e" font-size="9" font-weight="700" text-anchor="end">MAX BOUNDARY</text>
    </svg>
    <div class="track-legend">
      <span><i class="legend-start"></i> Initial Head</span>
      <span><i class="legend-service"></i> Serviced Request</span>
      <span><i class="legend-bound"></i> Boundary Track</span>
      <span><i class="legend-wrap"></i> C-SCAN Return Wrap</span>
      <span><i class="legend-active"></i> Current Arm Position</span>
    </div>
  </div>`;
}

function resultHTML(result, idPrefix = "") {
  const serviceText = result.serviceSequence.length ? result.serviceSequence.join(" → ") : "None";
  return `
    <div class="result-topline">
      <h3>${result.type} Performance Results</h3>
      <span>${result.count} requests serviced · initial direction: ${result.direction}</span>
    </div>
    <div class="stat-grid">
      <div class="stat">
        <small>Total Head Movement</small>
        <strong id="${idPrefix}stat-total">${result.total}</strong>
        <em>cylinders traversed</em>
      </div>
      <div class="stat">
        <small>Average per Request</small>
        <strong>${result.average.toFixed(2)}</strong>
        <em>cylinders / request</em>
      </div>
      <div class="stat">
        <small>Estimated Seek Latency</small>
        <strong>${result.estimatedSeekLatencyMs} ms</strong>
        <em>at ${SEEK_TIME_PER_CYLINDER_MS} ms/track seek rate</em>
      </div>
      <div class="stat">
        <small>Requests Serviced</small>
        <strong>${result.count}</strong>
        <em>all occurrences serviced</em>
      </div>
    </div>
    <div class="sequence-block">
      <h4>Serviced Request Order</h4>
      <p style="font-size:11px;color:#5c4c70;margin:0 0 8px;font-weight:600;">${esc(serviceText)}</p>
    </div>
    <div class="sequence-block">
      <h4>Complete Head Path (Includes Boundary and Wrap Tracks)</h4>
      ${sequenceHTML(result, idPrefix)}
    </div>
    ${svgTrack(result, idPrefix)}
    <div class="sequence-block">
      <h4>Step-by-Step Traversal Calculation</h4>
      ${movementTableHTML(result, idPrefix)}
    </div>
  `;
}

/* ==========================================================================
   6. ANIMATION PLAYBACK CONTROLLER
   ========================================================================== */
const animControllers = {};

function initAnimator(idPrefix, result) {
  if (animControllers[idPrefix]) {
    clearInterval(animControllers[idPrefix].timer);
  }

  const w = 760, left = 35, right = 725, y = 67;
  const scale = n => left + (n / result.max) * (right - left);
  const totalSteps = result.moves.length;

  const controller = {
    currentStep: 0,
    isPlaying: false,
    timer: null,
    speed: Number($(idPrefix + "select-speed")?.value || 650),

    updateView(step) {
      this.currentStep = step;
      const statusEl = $(idPrefix + "anim-status");
      if (statusEl) statusEl.innerHTML = `Step: <strong>${step} / ${totalSteps}</strong>`;

      // Position needle
      const targetPos = result.path[step].pos;
      const targetX = scale(targetPos);
      const needle = $(idPrefix + "head-needle");
      if (needle) needle.style.transform = `translate(${targetX}px, ${y}px)`;

      // Highlight nodes & SVG elements
      result.path.forEach((_, idx) => {
        const dot = $(idPrefix + `dot-${idx}`);
        const node = $(idPrefix + `node-${idx}`);
        if (dot) dot.classList.toggle("active-visited", idx <= step);
        if (node) node.classList.toggle("active-node", idx === step);
      });

      // Highlight path segments & table rows
      result.moves.forEach((_, idx) => {
        const seg = $(idPrefix + `path-seg-${idx + 1}`);
        const row = $(idPrefix + `row-${idx + 1}`);
        if (seg) seg.classList.toggle("active-seg", idx + 1 <= step);
        if (row) row.classList.toggle("active-row", idx + 1 === step);
      });

      // Cumulative counter update
      const statTotal = $(idPrefix + "stat-total");
      const currentDistance = step === 0 ? 0 : result.moves[step - 1].accumulated;
      if (statTotal) {
        statTotal.textContent = step === 0 ? result.total : `${currentDistance} / ${result.total}`;
      }
    },

    stepNext() {
      if (this.currentStep < totalSteps) {
        this.updateView(this.currentStep + 1);
        return true;
      }
      this.pause();
      return false;
    },

    reset() {
      this.pause();
      this.updateView(0);
    },

    play() {
      if (this.currentStep >= totalSteps) this.reset();
      this.isPlaying = true;
      const playBtn = $(idPrefix + "btn-play");
      if (playBtn) playBtn.textContent = "⏸ Pause";

      this.timer = setInterval(() => {
        if (!this.stepNext()) this.pause();
      }, this.speed);
    },

    pause() {
      this.isPlaying = false;
      clearInterval(this.timer);
      this.timer = null;
      const playBtn = $(idPrefix + "btn-play");
      if (playBtn) playBtn.textContent = "▶ Play";
    }
  };

  animControllers[idPrefix] = controller;

  const playBtn = $(idPrefix + "btn-play");
  const stepBtn = $(idPrefix + "btn-step");
  const resetBtn = $(idPrefix + "btn-reset");
  const speedSel = $(idPrefix + "select-speed");

  if (playBtn) playBtn.addEventListener("click", () => controller.isPlaying ? controller.pause() : controller.play());
  if (stepBtn) stepBtn.addEventListener("click", () => { controller.pause(); controller.stepNext(); });
  if (resetBtn) resetBtn.addEventListener("click", () => controller.reset());
  if (speedSel) speedSel.addEventListener("change", (e) => {
    controller.speed = Number(e.target.value);
    if (controller.isPlaying) { controller.pause(); controller.play(); }
  });

  controller.updateView(0);
}

/* ==========================================================================
   7. FORM RUNNERS & COMPARISON ENGINE
   ========================================================================== */
function runSingle(type) {
  const prefix = type === "SCAN" ? "scan" : "cscan";
  const msg = $(`${prefix}Message`);
  const out = $(`${prefix}Results`);
  try {
    const input = parseInput(prefix);
    const result = type === "SCAN" ? runScanLogic(input) : runCScanLogic(input);
    out.innerHTML = resultHTML(result, `${prefix}-`);
    initAnimator(`${prefix}-`, result);
    msg.textContent = "";
  } catch (err) {
    out.innerHTML = "";
    msg.textContent = err.message;
  }
}

function resetForm(prefix) {
  $(`${prefix}Queue`).value = "176, 79, 34, 60, 92, 11, 41, 114";
  $(`${prefix}Head`).value = "50";
  $(`${prefix}Max`).value = "199";
  $(`${prefix}Direction`).value = "right";
  $(`${prefix}Message`).textContent = "";
  $(`${prefix}Results`).innerHTML = "";
  runSingle(prefix === "scan" ? "SCAN" : "C-SCAN");
}

$("runScan").addEventListener("click", () => runSingle("SCAN"));
$("runCscan").addEventListener("click", () => runSingle("C-SCAN"));
$("resetScan").addEventListener("click", () => resetForm("scan"));
$("resetCscan").addEventListener("click", () => resetForm("cscan"));

// Side-by-side comparison runner
$("runCompare").addEventListener("click", () => {
  const msg = $("compareMessage");
  const out = $("compareResults");
  try {
    const input = parseInput("compare");
    const scan = runScanLogic(input);
    const cscan = runCScanLogic(input);

    const maxTotal = Math.max(scan.total, cscan.total, 1);
    const diff = Math.abs(scan.total - cscan.total);

    let winnerExplanation = "";
    if (scan.total < cscan.total) {
      winnerExplanation = `<strong>SCAN produced lower total head movement by ${diff} cylinders.</strong><br>
        <strong>Why:</strong> SCAN services requests during both the forward and reverse sweeps. In contrast, C-SCAN incurs the full overhead of returning to cylinder 0 (a non-servicing jump of ${cscan.max} cylinders). 
        However, C-SCAN provides significantly more uniform waiting time distribution across all cylinders, preventing requests arriving behind the sweep from experiencing delayed turnaround.`;
    } else if (cscan.total < scan.total) {
      winnerExplanation = `<strong>C-SCAN produced lower total head movement by ${diff} cylinders for this input workload.</strong><br>
        <strong>Why:</strong> Depending on request distribution and boundary locations, the circular return pattern avoided excessive double-reversal overhead.`;
    } else {
      winnerExplanation = `<strong>Both algorithms yielded identical total head movement (${scan.total} cylinders).</strong>`;
    }

    out.innerHTML = `
      <div class="result-topline">
        <h3>Side-by-Side Performance Comparison</h3>
        <span>Queue: ${input.queue.length} requests · Max Track: ${input.max} · Head: ${input.head}</span>
      </div>

      <div class="compare-summary">
        <article class="compare-algo">
          <h4>SCAN (Elevator Policy)</h4>
          <strong>${scan.total} <small style="font-size:10px;">cylinders</small></strong>
          <div class="bar-track"><div class="bar-fill" style="width:${(scan.total / maxTotal) * 100}%"></div></div>
          <p><strong>Average / Request:</strong> ${scan.average.toFixed(2)} cylinders</p>
          <p><strong>Est. Seek Latency:</strong> ${scan.estimatedSeekLatencyMs} ms</p>
          <p><strong>Service Order:</strong> ${scan.serviceSequence.join(" → ")}</p>
        </article>

        <article class="compare-algo">
          <h4>C-SCAN (Circular Policy)</h4>
          <strong>${cscan.total} <small style="font-size:10px;">cylinders</small></strong>
          <div class="bar-track"><div class="bar-fill cscan" style="width:${(cscan.total / maxTotal) * 100}%"></div></div>
          <p><strong>Average / Request:</strong> ${cscan.average.toFixed(2)} cylinders</p>
          <p><strong>Est. Seek Latency:</strong> ${cscan.estimatedSeekLatencyMs} ms</p>
          <p><strong>Service Order:</strong> ${cscan.serviceSequence.join(" → ")}</p>
        </article>
      </div>

      <div class="comparison-verdict">
        ${winnerExplanation}
      </div>

      <div class="sequence-block">
        <h4>SCAN Traversal Path</h4>
        ${sequenceHTML(scan, "comp-scan-")}
      </div>
      ${svgTrack(scan, "comp-scan-")}

      <div class="sequence-block">
        <h4>C-SCAN Traversal Path</h4>
        ${sequenceHTML(cscan, "comp-cscan-")}
      </div>
      ${svgTrack(cscan, "comp-cscan-")}

      <div class="sequence-block">
        <h4>Summary Comparison Table</h4>
        <div class="movement-table-wrap">
          <table class="movement-table">
            <thead>
              <tr><th>Performance Metric</th><th>SCAN</th><th>C-SCAN</th><th>Difference / Variance</th></tr>
            </thead>
            <tbody>
              <tr><td>Total Head Movement</td><td>${scan.total} cylinders</td><td>${cscan.total} cylinders</td><td>${diff} cylinders</td></tr>
              <tr><td>Average Movement per Request</td><td>${scan.average.toFixed(2)}</td><td>${cscan.average.toFixed(2)}</td><td>${Math.abs(scan.average - cscan.average).toFixed(2)}</td></tr>
              <tr><td>Estimated Seek Time (at 0.125 ms/track)</td><td>${scan.estimatedSeekLatencyMs} ms</td><td>${cscan.estimatedSeekLatencyMs} ms</td><td>${Math.abs(scan.estimatedSeekLatencyMs - cscan.estimatedSeekLatencyMs).toFixed(2)} ms</td></tr>
              <tr><td>Requests Serviced</td><td>${scan.count}</td><td>${cscan.count}</td><td>Equal</td></tr>
              <tr><td>Service Directionality</td><td>Bi-directional sweeps</td><td>Uni-directional with return jump</td><td>C-SCAN provides uniform waiting times</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    initAnimator("comp-scan-", scan);
    initAnimator("comp-cscan-", cscan);
    msg.textContent = "";
  } catch (err) {
    out.innerHTML = "";
    msg.textContent = err.message;
  }
});

/* ==========================================================================
   8. QUICK PRESET HANDLERS (EDGE CASES)
   ========================================================================== */
const presets = {
  default:   { queue: "176, 79, 34, 60, 92, 11, 41, 114", head: 50, max: 199, dir: "right" },
  single:    { queue: "85", head: 50, max: 199, dir: "right" },
  duplicates:{ queue: "45, 90, 45, 120, 90, 11", head: 50, max: 199, dir: "right" },
  boundary:  { queue: "10, 80, 150, 199", head: 0, max: 199, dir: "right" },
  oneside:   { queue: "110, 130, 150, 180", head: 50, max: 199, dir: "right" }
};

document.querySelectorAll("[data-preset]").forEach(btn => {
  btn.addEventListener("click", () => {
    const [targetPrefix, presetKey] = btn.dataset.preset.split(":");
    const data = presets[presetKey];
    if (!data) return;

    $(`${targetPrefix}Queue`).value = data.queue;
    $(`${targetPrefix}Head`).value = data.head;
    $(`${targetPrefix}Max`).value = data.max;
    $(`${targetPrefix}Direction`).value = data.dir;

    if (targetPrefix === "scan") runSingle("SCAN");
    else if (targetPrefix === "cscan") runSingle("C-SCAN");
    else if (targetPrefix === "compare") $("runCompare").click();
  });
});

/* ==========================================================================
   9. RESEARCH PAPER SEARCH & FILTER
   ========================================================================== */
const paperSearch = $("paperSearch");
const paperYear = $("paperYear");
const paperCards = Array.from(document.querySelectorAll("#researchList .research-card"));
const paperCount = $("paperCount");
const noPapers = $("noPapers");

function filterPapers() {
  if (!paperSearch || !paperYear) return;
  const term = paperSearch.value.trim().toLowerCase();
  const year = paperYear.value;
  let shown = 0;
  paperCards.forEach(card => {
    const matches = (year === "all" || card.dataset.year === year) && (!term || card.textContent.toLowerCase().includes(term));
    card.hidden = !matches;
    if (matches) shown++;
  });
  paperCount.textContent = `Showing ${shown} of ${paperCards.length} papers`;
  noPapers.hidden = shown !== 0;
}
if (paperSearch) paperSearch.addEventListener("input", filterPapers);
if (paperYear) paperYear.addEventListener("change", filterPapers);
$("expandPapers")?.addEventListener("click", () => paperCards.filter(c => !c.hidden).forEach(c => c.open = true));
$("collapsePapers")?.addEventListener("click", () => paperCards.forEach(c => c.open = false));

// Initialize default executions on load
runSingle("SCAN");
runSingle("C-SCAN");
$("runCompare").click();
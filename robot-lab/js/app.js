"use strict";
// Robot Academy: wires the cell simulation, the 3D view, the program editor and the course together.
(function () {
  const $ = (id) => document.getElementById(id);
  const BRAND_ORDER = ["abb", "fanuc", "kuka", "yaskawa", "ur"];
  const store = {
    get(k, d) { try { const v = localStorage.getItem("robotacademy:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("robotacademy:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let brand = store.get("brand", "abb"); if (!LANGS[brand]) brand = "abb";
  let lessonIdx = Math.max(0, Math.min(LESSONS.length - 1, store.get("lesson", 0) | 0));
  const completed = new Set(store.get("done", []));
  const edits = store.get("edits", {});

  // ---------------------------------------------------------------- cell simulation
  const DOWN_R = Rot.fromFixedXYZ(180, 0, 0);
  const HOME_Q = ikFlange(Pose.mul({ type: "pose", p: [450, 0, 800], R: DOWN_R }, Pose.inv(CELL.tools[1].tcp)), [0, 0, 0, 0, 90, 0]).q;
  const HALF = CELL.boxSize / 2;
  const PICK_Z = CELL.tableZ + HALF;
  const samePose = (A, B) => Vec.len(Vec.sub(A.p, B.p)) < 0.01 && Rot.angleBetween(A.R, B.R) < 0.01;
  const inRect = (s, x, y) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1;

  class World {
    constructor() { this.override = 1; this.autoSensor = true; this.reset(); }
    reset() {
      this.q = HOME_Q.slice();
      this.tool = CELL.tools[1].tcp; this.toolIdx = 1;
      this.frame = CELL.frames[0].pose; this.frameIdx = 0;
      this.dout = [false, false, false, false, false];
      this.din = [false, false, false, false, false];
      this.boxes = [this.makeBox(CELL.pickAt[0], CELL.pickAt[1], PICK_Z, "rest")];
      this.queue = CELL.feedCount - 1; this.feedT = 0; this.beltPhase = 0;
      this.gap = 76; this.held = null; this.pulses = [];
    }
    makeBox(x, y, z, state) { return { p: [x, y, z], R: Mat.I(), state, vz: 0 }; }
    tcpWorld(q = this.q) { return Pose.mul(fkFlange(q), this.tool); }
    // ---- interface used by the VM ----
    toolPose() { return this.tool; }
    speedScale() { return this.override; }
    frameIndex() { return this.frameIdx; }
    currentPose() { return Pose.mul(Pose.inv(this.frame), this.tcpWorld()); }
    toWorld(T) {
      let f = this.frame;
      if (T.frame != null) { if (!CELL.frames[T.frame]) throw new RobotError(`User frame ${T.frame} is not defined in this cell (0 = world, 1 = pallet).`, app.line); f = CELL.frames[T.frame].pose; }
      return Pose.mul(f, T);
    }
    setTool(v, line) {
      if (typeof v === "number") {
        if (!CELL.tools[v]) throw new RobotError(`Tool ${v} is not defined. This cell has tool 0 (flange) and tool 1 (gripper).`, line);
        this.tool = CELL.tools[v].tcp; this.toolIdx = v;
      } else if (v && v.type === "pose") { this.tool = v; this.toolIdx = CELL.tools.findIndex((t) => samePose(t.tcp, v)); }
      else throw new RobotError("Tool must be a tool number or tool data.", line);
    }
    setFrame(v, line) {
      if (typeof v === "number") {
        if (!CELL.frames[v]) throw new RobotError(`User frame ${v} is not defined. This cell has frame 0 (world) and frame 1 (pallet).`, line);
        this.frame = CELL.frames[v].pose; this.frameIdx = v;
      } else if (v && v.type === "pose") { this.frame = v; this.frameIdx = CELL.frames.findIndex((f) => samePose(f.pose, v)); }
      else throw new RobotError("Frame must be a frame number or frame data.", line);
    }
    getDI(n, line) {
      if (n < 1 || n > 4) throw new RobotError(`Input ${n} does not exist. This cell has inputs 1 to 4.`, line);
      if (n === 1 && this.autoSensor) return this.partPresent();
      return this.din[n];
    }
    getDO(n, line) { if (n < 1 || n > 4) throw new RobotError(`Output ${n} does not exist. This cell has outputs 1 to 4.`, line); return this.dout[n]; }
    setDO(n, v, line) {
      if (n < 1 || n > 4) throw new RobotError(`Output ${n} does not exist. This cell has outputs 1 to 4.`, line);
      const was = this.dout[n]; this.dout[n] = !!v;
      if (n === 1 && was !== !!v) this.gripChange(!!v);
    }
    pulseDO(n, line) { this.setDO(n, true, line); this.pulses.push({ n, t: 0.5 }); }
    setOverride(pct) { this.override = Math.max(0.05, Math.min(1, pct / 100)); app.syncOverride(); }
    setJoints(q, kind, line) {
      const tcp = this.tcpWorld(q);
      const s = this.surfaceUnder(tcp.p[0], tcp.p[1]);
      if (tcp.p[2] < s.z - 3) throw new RobotError(`Collision: the tool went ${Math.round(s.z - tcp.p[2])} mm into the ${s.name}. Raise the point or approach from above.`, line);
      const wrist = fkFrames(q)[5].p;
      if (wrist[2] < 80) throw new RobotError("Collision: the wrist would hit the floor.", line);
      this.q = q.slice();
      app.trail(tcp.p, kind);
    }
    log(m, kind) { app.log(m, kind); }
    onLine(l) { app.line = l; }
    onError(e) { app.onFault(e); }
    onDone(t) { app.onDone(t); }

    // ---- physical cell ----
    surfaceUnder(x, y) {
      let best = { z: CELL.floorZ, name: "floor" };
      for (const s of CELL.surfaces) if (inRect(s, x, y) && s.z > best.z) best = s;
      return best;
    }
    supportFor(b) {
      let z = this.surfaceUnder(b.p[0], b.p[1]).z;
      for (const o of this.boxes) if (o !== b && o.state === "rest" && Math.abs(o.p[0] - b.p[0]) < CELL.boxSize && Math.abs(o.p[1] - b.p[1]) < CELL.boxSize && o.p[2] < b.p[2]) z = Math.max(z, o.p[2] + HALF);
      return z;
    }
    partPresent() { return this.boxes.some((b) => b.state === "rest" && Math.hypot(b.p[0] - CELL.pickAt[0], b.p[1] - CELL.pickAt[1]) < 15 && Math.abs(b.p[2] - PICK_Z) < 5); }
    gripChange(closed) {
      if (closed) {
        const tcp = this.tcpWorld();
        const b = this.boxes.find((x) => x.state !== "held" && Math.hypot(x.p[0] - tcp.p[0], x.p[1] - tcp.p[1]) < 25 && Math.abs(x.p[2] - tcp.p[2]) < 25);
        if (b) { b.state = "held"; b.rel = Pose.mul(Pose.inv(tcp), { p: b.p, R: b.R }); this.held = b; app.log("Gripper closed on a part.", "info"); }
        else app.log("Gripper closed on nothing. Is the TCP at the part?", "warn");
      } else if (this.held) {
        this.held.state = "fall"; this.held.vz = 0; this.held = null;
      }
    }
    step(dt) {
      for (const p of this.pulses) { p.t -= dt; if (p.t <= 0) this.setDO(p.n, false, 0); }
      this.pulses = this.pulses.filter((p) => p.t > 0);
      // conveyor feed: bring the next box once the pick spot is clear
      const conv = CELL.surfaces[0];
      const busy = this.boxes.some((b) => b.state === "feed" || (b.state === "rest" && inRect(conv, b.p[0], b.p[1])));
      if (!busy && this.queue > 0) { this.feedT += dt; if (this.feedT > 0.8) { this.boxes.push(this.makeBox(CELL.feedFrom[0], CELL.feedFrom[1], PICK_Z, "feed")); this.queue--; this.feedT = 0; } }
      else this.feedT = 0;
      for (const b of this.boxes) {
        if (b.state === "feed") {
          b.p[1] += 320 * dt; this.beltPhase += 320 * dt;
          if (b.p[1] >= CELL.pickAt[1]) { b.p[1] = CELL.pickAt[1]; b.state = "rest"; }
        } else if (b.state === "fall") {
          b.vz -= 9810 * dt; b.p[2] += b.vz * dt;
          const sup = this.supportFor(b);
          if (b.p[2] - HALF <= sup) {
            b.p[2] = sup + HALF; b.state = "rest"; b.vz = 0;
            const yaw = Math.atan2(b.R[3], b.R[0]); b.R = Mat.rz(yaw);
          }
        } else if (b.state === "held") {
          const P = Pose.mul(this.tcpWorld(), b.rel); b.p = P.p; b.R = P.R;
        }
      }
      const target = this.dout[1] ? (this.held ? CELL.boxSize : 34) : 76;
      const d = target - this.gap; this.gap += Math.sign(d) * Math.min(Math.abs(d), 260 * dt);
    }
  }

  // ---------------------------------------------------------------- app
  const world = new World();
  const ctl = new Controller(world);
  const scene = new Cell3D($("gl"), { sky: css("--sky"), floor: css("--floor"), grid: css("--grid") });
  if (!scene.ok) {
    const d = document.createElement("div"); d.className = "nogl";
    d.textContent = "The 3D view needs three.js from cdnjs.cloudflare.com, which could not load. Programs still run: watch the joint and pose readouts.";
    $("stage").prepend(d);
  }

  const app = {
    line: 0, errLine: null, dirty: false, jog: null, jogMode: "joint",
    trailCols: null, lastTrailKind: null,
    log(m, kind = "info") {
      const c = $("console");
      const div = document.createElement("div"); div.className = "m " + kind; div.textContent = m;
      c.appendChild(div);
      while (c.children.length > 80) c.removeChild(c.children[1]);
      c.scrollTop = c.scrollHeight;
    },
    trail(p, kind) {
      if (!scene.ok) return;
      if (!this.trailCols) this.readTrailCols();
      scene.addTrail(p, kind === "L" ? this.trailCols.L : kind === "C" ? this.trailCols.C : this.trailCols.J);
    },
    readTrailCols() {
      if (!scene.ok) return;
      this.trailCols = { J: new THREE.Color(css("--joint")), L: new THREE.Color(css("--accent")), C: new THREE.Color(css("--circ")) };
    },
    onFault(e) { this.errLine = e.line; this.log(`Line ${e.line}: ${e.msg}`, "error"); updateControls(); renderGutter(); },
    onDone(t) {
      this.log(`Program complete. Cycle time ${t.toFixed(1)} s.`, "msg");
      const L = LESSONS[lessonIdx];
      if (!completed.has(L.id)) { completed.add(L.id); store.set("done", [...completed]); renderProgress(); renderLessonList(); }
      updateControls();
    },
    syncOverride() { const v = Math.round(world.override * 100); $("override").value = v; $("ovrOut").textContent = v + "%"; },
  };

  // ---------------------------------------------------------------- brands and course
  function renderBrands() {
    const host = $("brands"); host.innerHTML = "";
    for (const id of BRAND_ORDER) {
      const L = LANGS[id];
      const b = document.createElement("button");
      b.className = "brand"; b.setAttribute("aria-pressed", String(id === brand)); b.dataset.brand = id;
      b.innerHTML = `<span class="sw" style="background:${L.robot.body}"></span><b>${esc(L.brand)}</b><small>${esc(L.lang)}</small>`;
      b.addEventListener("click", () => setBrand(id));
      host.appendChild(b);
    }
  }
  function renderLessonList() {
    const sel = $("lessonSelect"); sel.innerHTML = "";
    let part = null, group = null;
    LESSONS.forEach((L, i) => {
      if (L.part !== part) { part = L.part; group = document.createElement("optgroup"); group.label = part; sel.appendChild(group); }
      const o = document.createElement("option"); o.value = i;
      o.textContent = `${i + 1}. ${L.title}${completed.has(L.id) ? "  ✓" : ""}`;
      group.appendChild(o);
    });
    sel.value = lessonIdx;
  }
  function renderProgress() {
    const n = LESSONS.filter((L) => completed.has(L.id)).length;
    $("progText").textContent = `${n} of ${LESSONS.length} complete`;
    $("progBar").style.width = (n / LESSONS.length) * 100 + "%";
  }
  function renderLesson() {
    const L = LESSONS[lessonIdx], lang = LANGS[brand];
    const rows = L.concepts.map((c) => `<tr><th>${esc(SYNTAX[c].what)}</th><td><pre>${esc(SYNTAX[c][brand])}</pre></td></tr>`).join("");
    $("lesson").innerHTML = `
      <article class="lesson">
        <div class="eyebrow">${esc(L.part)} · Lesson ${lessonIdx + 1} of ${LESSONS.length}${completed.has(L.id) ? ' · <span class="done-tag">completed</span>' : ""}</div>
        <h2>${esc(L.title)}</h2>
        <p class="lead">${esc(L.lead)}</p>
        ${L.body}
      </article>
      <div class="lesson-actions"><button class="btn primary" id="watch">Watch it run</button><button class="btn" id="stepIt">Step through</button><button class="btn" id="lessonPause" disabled>❚❚ Pause</button></div>
      <div class="box"><h3>Key points</h3><ul class="keypoints">${L.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>
      <div class="box brandnote"><h3>${esc(lang.brand)} · ${esc(lang.lang)}</h3><div>${L.notes[brand]}</div></div>
      <div class="box"><h3>${esc(lang.lang)} syntax in this lesson</h3><table class="syntax">${rows}</table></div>
      <div class="box"><h3>Try this</h3><div>${esc(L.task)}</div></div>
      <div class="lesson-nav"><button class="btn" id="prevL" ${lessonIdx === 0 ? "disabled" : ""}>Previous lesson</button><button class="btn" id="nextL" ${lessonIdx === LESSONS.length - 1 ? "disabled" : ""}>Next lesson</button></div>`;
    $("watch").addEventListener("click", () => { world.override = 1; app.syncOverride(); freshStart(false); });
    $("stepIt").addEventListener("click", () => freshStart(true));
    $("lessonPause").addEventListener("click", togglePause);
    updateControls();
    $("prevL").addEventListener("click", () => setLesson(lessonIdx - 1));
    $("nextL").addEventListener("click", () => setLesson(lessonIdx + 1));
    $("lesson").scrollTop = 0;
  }

  const editKey = () => `${brand}:${LESSONS[lessonIdx].id}`;
  const lessonCode = () => LANGS[brand].gen(LESSONS[lessonIdx].recipe);
  function loadCode() {
    const src = $("src");
    src.value = edits[editKey()] != null ? edits[editKey()] : lessonCode();
    src.scrollTop = 0; src.scrollLeft = 0;
    app.dirty = true; app.errLine = null; app.line = 0;
    renderEditor();
    $("fileName").innerHTML = `${esc(LANGS[brand].file)}<small>${esc(LANGS[brand].brand)} ${esc(LANGS[brand].lang)}</small>`;
    $("resetCode").disabled = edits[editKey()] == null;
  }
  function stopAndReset() {
    ctl.prog = null; ctl.state = "idle"; ctl.motion = null;
    world.reset(); scene.clearTrail && scene.ok && scene.clearTrail();
    app.errLine = null; app.line = 0;
    updateControls(); renderGutter();
  }
  function setBrand(id) {
    brand = id; store.set("brand", id);
    if (scene.ok) scene.buildRobot(LANGS[id].robot);
    renderBrands(); renderLesson(); loadCode(); stopAndReset(); buildIO(); buildJog();
    app.log(`Switched to ${LANGS[id].brand} ${LANGS[id].lang}.`, "info");
  }
  function setLesson(i) {
    lessonIdx = Math.max(0, Math.min(LESSONS.length - 1, i)); store.set("lesson", lessonIdx);
    renderLessonList(); renderLesson(); loadCode(); stopAndReset();
  }

  // ---------------------------------------------------------------- editor
  const src = $("src"), hl = $("hl"), band = $("band");
  const LINE_H = 20, PAD = 8;
  function highlightLine(line, syn) {
    let code = line, com = "";
    const cm = syn.comment.exec(line); syn.comment.lastIndex = 0;
    if (cm) { const q = (line.slice(0, cm.index).match(/"/g) || []).length; if (q % 2 === 0) { code = line.slice(0, cm.index); com = line.slice(cm.index); } }
    const spans = [];
    const cats = [["t-str", /"(?:[^"\\]|\\.)*"/g], ["t-mo", syn.motion], ["t-kw", syn.keywords], ["t-io", syn.io], ["t-bi", syn.builtins], ["t-num", /-?\b\d+(?:\.\d+)?\b/g]];
    cats.forEach(([cls, re], prio) => {
      const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m;
      while ((m = r.exec(code))) { if (!m[0].length) { r.lastIndex++; continue; } spans.push([m.index, m.index + m[0].length, cls, prio]); }
    });
    spans.sort((a, b) => a[0] - b[0] || a[3] - b[3]);
    let out = "", pos = 0;
    for (const [s, e, cls] of spans) {
      if (s < pos) continue;
      out += esc(code.slice(pos, s)) + `<span class="${cls}">${esc(code.slice(s, e))}</span>`;
      pos = e;
    }
    out += esc(code.slice(pos));
    if (com) out += `<span class="t-com">${esc(com)}</span>`;
    return out;
  }
  function renderEditor() {
    const syn = LANGS[brand].syntax;
    hl.innerHTML = src.value.split("\n").map((l) => highlightLine(l, syn)).join("\n") + "\n\n";
    renderGutter(); syncScroll();
  }
  function renderGutter() {
    const n = src.value.split("\n").length;
    let h = "";
    for (let i = 1; i <= n; i++) {
      const cls = i === app.errLine ? "err" : (ctl.prog && ctl.state !== "idle" && i === app.line ? "cur" : "");
      h += `<div class="${cls}">${i}</div>`;
    }
    $("gutterIn").innerHTML = h;
    placeBand();
  }
  function placeBand() {
    const l = app.errLine || (ctl.prog && ctl.state !== "idle" ? app.line : 0);
    if (!l) { band.style.display = "none"; return; }
    band.style.display = "block";
    band.className = "hlband" + (app.errLine ? " err" : "");
    band.style.top = PAD + (l - 1) * LINE_H - src.scrollTop + "px";
  }
  function syncScroll() {
    hl.scrollTop = src.scrollTop; hl.scrollLeft = src.scrollLeft;
    $("gutterIn").style.transform = `translateY(${-src.scrollTop}px)`;
    placeBand();
  }
  function revealLine(l) {
    const top = PAD + (l - 1) * LINE_H, h = src.clientHeight;
    if (top < src.scrollTop + 10 || top > src.scrollTop + h - 50) { src.scrollTop = Math.max(0, top - h / 3); syncScroll(); }
  }
  let saveTimer = null;
  src.addEventListener("input", () => {
    app.dirty = true; app.errLine = null;
    if (ctl.running) { ctl.pause(); app.log("Program edited, so execution paused. Press Run to start again from the top.", "warn"); }
    renderEditor();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (src.value === lessonCode()) delete edits[editKey()]; else edits[editKey()] = src.value;
      store.set("edits", edits); $("resetCode").disabled = edits[editKey()] == null;
    }, 400);
  });
  src.addEventListener("scroll", syncScroll);
  src.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const s = src.selectionStart;
      src.setRangeText("  ", s, src.selectionEnd, "end");
      src.dispatchEvent(new Event("input"));
    }
  });
  $("resetCode").addEventListener("click", () => { delete edits[editKey()]; store.set("edits", edits); loadCode(); stopAndReset(); app.log("Lesson program restored.", "info"); });

  // ---------------------------------------------------------------- run control
  function freshStart(stepMode) {
    const lang = LANGS[brand];
    let prog;
    try { prog = lang.parse(src.value); ctl.load(prog); }
    catch (e) {
      app.errLine = e.line || 1; ctl.prog = null; ctl.state = "idle";
      app.log(`Line ${app.errLine}: ${e.message}`, "error");
      renderGutter(); revealLine(app.errLine); updateControls();
      return false;
    }
    world.reset(); if (scene.ok) scene.clearTrail();
    app.errLine = null; app.dirty = false;
    app.log(`Running ${lang.file}${stepMode ? " one step at a time" : ""}.`, "info");
    if (stepMode) ctl.step(); else ctl.start();
    updateControls();
    return true;
  }
  function updateControls() {
    const st = ctl.prog ? ctl.state : "idle";
    $("run").textContent = st === "paused" && !app.dirty ? "Resume" : "Run";
    $("pause").disabled = !(st === "running" || st === "waiting");
    // separate pause/resume buttons on the 3D view and in the lesson
    const canResume = st === "paused" && !app.dirty, active = st === "running" || st === "waiting";
    for (const id of ["hudPause", "lessonPause"]) {
      const b = $(id); if (!b) continue;
      b.disabled = !(active || canResume);
      b.textContent = canResume ? "▶ Resume" : "❚❚ Pause";
    }
    const chip = $("stateChip");
    const map = { idle: ["Ready", ""], running: ["Running", "run"], waiting: ["Waiting", "wait"], paused: ["Paused", ""], done: ["Done", "done"], error: ["Fault", "err"] };
    const [t, c] = map[st] || map.idle;
    chip.textContent = t; chip.className = "chip " + c;
  }
  $("run").addEventListener("click", () => { if (ctl.prog && ctl.state === "paused" && !app.dirty) { ctl.start(); updateControls(); } else freshStart(false); });
  $("step").addEventListener("click", () => { if (ctl.prog && ctl.state === "paused" && !app.dirty) { ctl.step(); updateControls(); } else freshStart(true); });
  $("pause").addEventListener("click", () => { ctl.pause(); updateControls(); });
  function togglePause() {
    if (ctl.prog && ctl.state === "paused" && !app.dirty) ctl.start();
    else ctl.pause();
    updateControls();
  }
  $("hudPause").addEventListener("click", togglePause);
  $("reset").addEventListener("click", () => { stopAndReset(); app.log("Cell reset: robot at home, parts restocked.", "info"); });
  $("estop").addEventListener("click", () => {
    if (ctl.prog && (ctl.running || ctl.state === "paused")) ctl.fault(new RobotError("Emergency stop pressed. Motion halted. Press Reset cell, then Run.", app.line));
    else app.log("Emergency stop pressed. Nothing was moving.", "warn");
    app.jog = null; updateControls();
  });
  $("override").addEventListener("input", (e) => { world.override = +e.target.value / 100; app.syncOverride(); });

  // ---------------------------------------------------------------- I/O panel
  const OUT_LABEL = ["", "Gripper", "Lamp", "", ""], IN_LABEL = ["", "Part", "Start", "Reject", ""];
  function buildIO() {
    const lang = LANGS[brand];
    const outs = $("outs"), ins = $("ins"); outs.innerHTML = ""; ins.innerHTML = "";
    for (let n = 1; n <= 4; n++) {
      const o = document.createElement("button"); o.className = "lamp out"; o.disabled = true; o.id = "do" + n;
      o.innerHTML = `<i></i>${esc(lang.outName(n))}${OUT_LABEL[n] ? " " + OUT_LABEL[n] : ""}`; outs.appendChild(o);
      const b = document.createElement("button"); b.className = "lamp"; b.id = "di" + n;
      b.innerHTML = `<i></i>${esc(lang.inName(n))}${IN_LABEL[n] ? " " + IN_LABEL[n] : ""}`;
      b.title = n === 1 ? "Part-present sensor. Turn off Auto to toggle it by hand." : "Click to toggle";
      b.addEventListener("click", () => {
        if (n === 1 && world.autoSensor) { app.log("Input 1 follows the part sensor. Untick Auto part sensor to force it.", "warn"); return; }
        world.din[n] = !world.din[n];
        app.log(`${lang.inName(n)} forced ${world.din[n] ? "ON" : "OFF"}.`, "info");
      });
      ins.appendChild(b);
    }
  }
  $("autoSensor").addEventListener("change", (e) => { world.autoSensor = e.target.checked; });

  // ---------------------------------------------------------------- jog pendant
  function buildJog() {
    const host = $("jogAxes"); host.innerHTML = "";
    const lang = LANGS[brand];
    const names = app.jogMode === "joint" ? lang.jointNames : ["X", "Y", "Z", "Rx", "Ry", "Rz"];
    names.forEach((nm, i) => {
      const row = document.createElement("div"); row.className = "axis";
      const mk = (sign) => {
        const b = document.createElement("button"); b.textContent = sign > 0 ? "+" : "−"; b.setAttribute("aria-label", `Jog ${nm} ${sign > 0 ? "plus" : "minus"}`);
        const start = (e) => { e.preventDefault(); if (ctl.running) { app.log("Stop the program before jogging.", "warn"); return; } app.jog = { i, sign }; };
        const stop = () => { app.jog = null; };
        b.addEventListener("pointerdown", start); b.addEventListener("pointerup", stop); b.addEventListener("pointerleave", stop); b.addEventListener("pointercancel", stop);
        return b;
      };
      const label = document.createElement("span"); label.textContent = nm;
      row.append(mk(-1), label, mk(1));
      host.appendChild(row);
    });
  }
  document.querySelectorAll("#jog .modes button").forEach((b) => b.addEventListener("click", () => {
    app.jogMode = b.dataset.mode;
    document.querySelectorAll("#jog .modes button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    buildJog();
  }));
  let jogWarned = 0;
  function doJog(dt) {
    const j = app.jog; if (!j || ctl.running) return;
    const k = world.override * dt * j.sign;
    try {
      if (app.jogMode === "joint") {
        const q = world.q.slice(); q[j.i] += 30 * k;
        const [lo, hi] = ARM.limits[j.i];
        if (q[j.i] < lo || q[j.i] > hi) throw new RobotError(`Axis ${j.i + 1} is at its limit.`, 0);
        world.setJoints(q, "J", 0);
      } else {
        const T = world.tcpWorld();
        const P = { type: "pose", p: T.p.slice(), R: T.R.slice() };
        if (j.i < 3) {
          const d = [0, 0, 0]; d[j.i] = 120 * k;
          P.p = Vec.add(P.p, app.jogMode === "tool" ? Mat.mv(T.R, d) : Mat.mv(world.frame.R, d));
        } else {
          const a = 30 * k * DEG, Rr = [Mat.rx, Mat.ry, Mat.rz][j.i - 3](a);
          P.R = app.jogMode === "tool" ? Mat.mul(T.R, Rr) : Mat.mul(Rr, T.R);
        }
        const r = ikFlange(Pose.mul(P, Pose.inv(world.tool)), world.q);
        if (r.error) throw new RobotError(r.detail, 0);
        if (Math.max(...r.q.map((v, i) => Math.abs(v - world.q[i]))) > 8) throw new RobotError("Near a singularity: jog in joint mode to get clear.", 0);
        world.setJoints(r.q, "L", 0);
      }
    } catch (e) {
      const now = performance.now();
      if (now - jogWarned > 1500) { app.log("Jog stopped: " + e.message, "warn"); jogWarned = now; }
      app.jog = null;
    }
  }
  let teachN = 1;
  $("teach").addEventListener("click", () => {
    const name = `pTeach${teachN++}`;
    const snippet = LANGS[brand].teach(name, world.currentPose(), world.frameIdx);
    const s = src.selectionStart;
    const lineStart = src.value.lastIndexOf("\n", s - 1) + 1;
    src.setRangeText(snippet + "\n", lineStart, lineStart, "end");
    src.dispatchEvent(new Event("input"));
    app.log(`Taught ${name} at the current TCP and inserted it at line ${src.value.slice(0, lineStart).split("\n").length}.`, "msg");
  });

  // ---------------------------------------------------------------- viewport tools
  $("vIso").addEventListener("click", () => scene.ok && scene.view("iso"));
  $("vFront").addEventListener("click", () => scene.ok && scene.view("front"));
  $("vTop").addEventListener("click", () => scene.ok && scene.view("top"));
  $("tTrail").addEventListener("click", () => scene.ok && scene.clearTrail());
  $("tFrames").addEventListener("click", (e) => { const on = e.currentTarget.getAttribute("aria-pressed") !== "true"; e.currentTarget.setAttribute("aria-pressed", String(on)); if (scene.ok) scene.showFrames(on); });
  $("tJog").addEventListener("click", (e) => { const on = e.currentTarget.getAttribute("aria-pressed") !== "true"; e.currentTarget.setAttribute("aria-pressed", String(on)); $("jog").hidden = !on; });
  $("lessonSelect").addEventListener("change", (e) => setLesson(+e.target.value));

  // ---------------------------------------------------------------- HUD
  const LABELS = [["Conveyor", [550, -820, 470]], ["Part sensor", [440, -350, 520]], ["Pallet table", [560, 500, 420]], ["Reject bin", [260, -470, 520]]];
  const labelEls = LABELS.map(([t]) => { const s = document.createElement("span"); s.textContent = t; $("labels").appendChild(s); return s; });
  function updateHUD() {
    const lang = LANGS[brand];
    const P = world.currentPose();
    const frameName = world.frameIdx >= 0 ? CELL.frames[world.frameIdx].name : "user";
    const toolName = world.toolIdx >= 0 ? CELL.tools[world.toolIdx].name : "custom";
    $("pose").innerHTML = `<div class="t">TCP · ${esc(toolName)} in ${esc(frameName)}</div>` + lang.poseFields(P).map(([k, v]) => `<span class="k">${k}</span><span>${v}</span>`).join("");
    const jv = lang.jointValues(world.q);
    $("joints").innerHTML = `<div class="t">Joints · deg</div>` + world.q.map((v, i) => {
      const [lo, hi] = ARM.limits[i], f = (v - lo) / (hi - lo);
      const near = f < 0.04 || f > 0.96;
      return `<div class="jrow"><span>${esc(lang.jointNames[i])}</span><span class="jbar${near ? " near" : ""}"><i style="left:calc(${(f * 100).toFixed(1)}% - 1.5px)"></i></span><span>${fmt(jv[i])}</span></div>`;
    }).join("");
    for (let n = 1; n <= 4; n++) {
      $("do" + n).classList.toggle("on", world.dout[n]);
      const di = $("di" + n);
      const v = n === 1 && world.autoSensor ? world.partPresent() : world.din[n];
      di.classList.toggle("on", v);
      di.classList.toggle("waiting", ctl.state === "waiting" && !!ctl.waitDI && JSON.stringify(ctl.waitDI.cond).includes(`"name":"di","args":[{"k":"num","v":${n}}`));
    }
    const lines = src.value.split("\n");
    const st = ctl.prog ? ctl.state : "idle";
    $("nowLine").textContent = st === "error" && ctl.error ? ctl.error.msg : app.line && st !== "idle" ? `${app.line}: ${(lines[app.line - 1] || "").trim()}` : "Load a lesson and press Run, or write your own program.";
    $("cycle").textContent = ctl.cycle.toFixed(1) + " s";
    updateControls();
    renderVars();
    if (scene.ok) LABELS.forEach(([, p], i) => { const [x, y, vis] = scene.project(p); labelEls[i].style.left = x + "px"; labelEls[i].style.top = y + "px"; labelEls[i].hidden = !vis; });
  }
  function fmtVal(v) {
    if (typeof v === "number") return String(+v.toFixed(3));
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "string") return JSON.stringify(v);
    if (v && v.type === "pose") return `[${v.p.map((x) => +x.toFixed(1)).join(", ")}]`;
    if (v && v.type === "joints") return `[${v.q.map((x) => +x.toFixed(1)).join(", ")}]`;
    if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "number" ? +x.toFixed(3) : x)).join(", ")}]`;
    return String(v);
  }
  let lastVars = "";
  function renderVars() {
    if (!ctl.prog) { if (lastVars !== "-") { $("vars").innerHTML = '<tr><td colspan="2">Run a program to see its variables.</td></tr>'; lastVars = "-"; } return; }
    const rows = Object.entries(ctl.vars).filter(([k]) => !k.includes(":") && k !== "XHOME").slice(0, 60)
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(fmtVal(v))}</td></tr>`).join("");
    if (rows !== lastVars) { $("vars").innerHTML = rows || '<tr><td colspan="2">No variables yet.</td></tr>'; lastVars = rows; }
  }

  // ---------------------------------------------------------------- theme + loop
  function applyTheme() {
    if (!scene.ok) return;
    scene.applyTheme({ sky: css("--sky"), floor: css("--floor"), grid: css("--grid") });
    app.readTrailCols();
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  new ResizeObserver(() => { const r = $("stage").getBoundingClientRect(); scene.resize(Math.max(1, r.width), Math.max(1, r.height)); }).observe($("stage"));

  let last = performance.now(), hudT = 0, lastLine = -1, lastState = "";
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    ctl.tick(dt);
    doJog(dt);
    world.step(dt);
    if (scene.ok) {
      scene.setJoints(world.q);
      scene.setGripper(world.gap);
      scene.syncBoxes(world.boxes);
      scene.setPose(scene.fTool, world.tcpWorld());
      scene.sensorMat.emissive.set(world.partPresent() ? 0x2fbf5f : 0x000000);
      scene.render(world.beltPhase % 10000);
    }
    if (app.line !== lastLine || ctl.state !== lastState) {
      lastLine = app.line; lastState = ctl.state;
      renderGutter();
      if (ctl.running && app.line) revealLine(app.line);
    }
    hudT += dt;
    if (hudT > 0.1) { hudT = 0; updateHUD(); }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- start
  if (scene.ok) scene.buildRobot(LANGS[brand].robot);
  renderBrands(); renderLessonList(); renderProgress(); renderLesson(); loadCode(); buildIO(); buildJog();
  app.syncOverride();
  app.log("Pick a robot maker at the top, then press Watch it run.", "info");
  updateHUD();
  requestAnimationFrame(frame);
  window.__academy = { world, ctl, app, scene, setBrand, setLesson, freshStart };
})();

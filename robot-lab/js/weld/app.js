"use strict";
// Weld Cell trainer: Learn / Practice / Troubleshoot around one simulated FANUC ArcTool cell.
(function () {
  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("weldcell:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("weldcell:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  const world = new WeldWorld();
  const ctl = new Controller(world);
  const scene = new WeldScene($("gl"), { sky: css("--sky"), floor: css("--floor"), grid: css("--grid") });
  if (scene.ok) scene.buildRobot({ body: "#f2c21b", trim: "#2b2b2b" });
  else $("view3d").insertAdjacentHTML("afterbegin", '<div class="nogl">The 3D view needs three.js from cdnjs.cloudflare.com, which could not load. The pendant, PLC and programs still work.</div>');

  const app = {
    w: world, ctl, flags: store.get("flags", {}),
    log(m, kind = "info") {
      const host = $("log");
      const d = document.createElement("div"); d.className = "m " + kind; d.textContent = m;
      host.prepend(d);
      while (host.children.length > 40) host.removeChild(host.lastChild);
    },
    onProgramsChanged() { programDirty = true; },
    onSyntaxError(e) { this.log(`Program error, line ${e.line}: ${e.message}`, "error"); setTab("program"); },
    onRunStart() { runInfo = { prog: tp.selected, mode: world.mode, weld: world.weldEnable, startBeads: world.part.beads.length }; },
    explainKey(k) { const d = TP_KEYS[k]; if (!d) return; $("explain").innerHTML = `<b>${esc(d.label)}</b> <span class="grp">${esc(d.group)}</span><p>${esc(d.text)}</p>`; },
    onKey(k) { /* used by missions */ },
    openLearn(id) { setMode("learn"); const i = CHAPTERS.findIndex((c) => c.id === id); if (i >= 0) setChapter(i); },
    prepareAuto() {
      ctl.state = "idle"; ctl.motion = null; ctl.prog = null; opQueue = [];
      world.faults = {};
      world.newPart(); world.q = WELD.homeQ.slice(); world.e1 = 0;
      world.mode = "AUTO"; world.tpOn = false; world.deadman = false; world.estopTP = false; world.estopPanel = false;
      world.doorClosed = true; world.curtainClear = true; world.weldEnable = true;
      world.dsim.fill(null); world.dout.fill(false); world.arcOff();
      world.plc.M.M1 = false; world.part.clampPos = 0;
      world.alarms = []; world.servoOn = true;
      tp.selected = "CYL_WELD"; tp.step = false; tp.cur = { line: 0, field: -1 };
      tp.ovrIdx = OVR_STEPS.indexOf(100); tp.applyOverride(); // production runs at 100% override
      world.timeLapse = +$("lapse").value || 4;
      syncOps();
    },
    operator(seq) {
      let t = 0.6;
      for (const s of seq) {
        if (typeof s === "number") { t += s; continue; }
        if (s === "curtain") { opQueue.push({ t, cond: () => world.arc.phase === "on" && world.part.beads.length > 60, fn: () => { world.curtainClear = false; app.log("Operator reached through the light curtain.", "warn"); } }); continue; }
        opQueue.push({ t, fn: () => (world.btn[s] = true) }, { t: t + 0.35, fn: () => (world.btn[s] = false) });
        t += 1.5;
      }
      opClock = 0;
    },
    bendTorch(mm) {
      if (!mm) { world.faults.tcpBent = null; return; }
      const R = Rot.fromFixedXYZ(...WELD.pts.start.o);
      world.faults.tcpBent = Mat.mv(Mat.tr(R), [0, mm, 0]);
    },
    damagePoint() { const p = tp.progs.find((x) => x.name === "CYL_WELD"); if (p && p.points[3]) { p.points[3].z -= 25; tp.changed(); } },
    restorePoint() { const p = tp.progs.find((x) => x.name === "CYL_WELD"); const d = TPStore.defaults()[0]; if (p) { p.points[3] = d.points[3]; tp.changed(); } },
  };
  let opQueue = [], opClock = 0, runInfo = null, programDirty = true;

  const view = new PendantView($("tp"), { onKey: (k) => tp.key(k), onKeyUp: (k) => tp.keyUp(k) });
  const tp = new TPController({ world, ctl, view, app });
  app.tp = tp;
  const saved = store.get("programs", null);
  if (saved) tp.loadText(saved);

  // ---------------------------------------------------------------- world events
  world.on("log", (m, k) => app.log(m, k));
  world.on("alarm", (a) => {
    if (!a) return;
    app.log(`${a.code} ${a.text}${a.extra ? " — " + a.extra : ""}${a.line && ctl.prog ? ` (line ${tp.mnLine(a.line)})` : ""}`, a.code === "SRVO-065" ? "warn" : "error");
    tp.say(`${a.code} ${a.text}`);
    if (a.code !== "SRVO-065" && ctl.running) ctl.fault(new RobotError(`${a.code} ${a.text}`, world.line));
  });
  world.on("fault", (e) => { if (e && e.msg && !/^(SRVO|ARC|MOTN)/.test(e.msg)) { app.log(`Line ${tp.mnLine(e.line)}: ${e.msg}`, "error"); tp.say(e.msg); } });
  world.on("done", () => {
    app.log("Program end.", "info");
    if (runInfo && runInfo.prog === "CYL_WELD") {
      if (runInfo.mode !== "AUTO" && !runInfo.weld) { app.flags.dryDone = true; }
      if (runInfo.mode === "AUTO" && runInfo.weld) { const r = world.inspect(); if (r.pass) app.flags.autoPass = true; }
      store.set("flags", app.flags);
    }
  });
  let lastArc = "off";

  // ---------------------------------------------------------------- modes
  let mode = store.get("mode", "learn");
  function setMode(m) {
    mode = m; store.set("mode", m);
    document.body.dataset.mode = m;
    document.querySelectorAll(".modes button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    if (m === "trouble") setTab("scenario");
    else if (m === "practice" && activeTab === "scenario") setTab("missions");
    stopDemo();
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
  document.querySelectorAll(".modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  // ---------------------------------------------------------------- learn
  let chapIdx = Math.min(store.get("chapter", 0), CHAPTERS.length - 1);
  const read = new Set(store.get("read", []));
  let animFn = null, animT0 = 0;
  function chapterList() {
    const sel = $("chapSel"); sel.innerHTML = "";
    let part = null, g = null;
    CHAPTERS.forEach((c, i) => {
      if (c.part !== part) { part = c.part; g = document.createElement("optgroup"); g.label = part; sel.appendChild(g); }
      const o = document.createElement("option"); o.value = i; o.textContent = `${i + 1}. ${c.title}${read.has(c.id) ? "  ✓" : ""}`; g.appendChild(o);
    });
    sel.value = chapIdx;
    $("chapProg").textContent = `${read.size} of ${CHAPTERS.length} chapters checked`;
    $("chapBar").style.width = (read.size / CHAPTERS.length) * 100 + "%";
  }
  function alarmTable() {
    return `<table class="t"><tr><th>Code</th><th>Message</th><th>Cause</th><th>Remedy</th></tr>${Object.entries(ALARMS).filter(([k]) => k.length > 6).map(([k, a]) => `<tr><td><code>${k}</code></td><td>${esc(a.text)}</td><td>${esc(a.cause)}</td><td>${esc(a.fix)}</td></tr>`).join("")}</table><p class="note">Codes follow FANUC's naming. Exact texts vary by controller and software version, so always check your controller's alarm manual.</p>`;
  }
  function keyTable() {
    const groups = {};
    Object.entries(TP_KEYS).forEach(([k, d]) => { if (/^n\d$|dot|minus/.test(k)) return; (groups[d.group] = groups[d.group] || []).push(d); });
    return Object.entries(groups).map(([g, list]) => `<h4>${esc(g)}</h4><table class="t keys">${list.map((d) => `<tr><td><span class="kcap">${esc(d.label)}</span></td><td>${esc(d.text)}</td></tr>`).join("")}</table>`).join("");
  }
  function setChapter(i) {
    chapIdx = Math.max(0, Math.min(CHAPTERS.length - 1, i)); store.set("chapter", chapIdx);
    const c = CHAPTERS[chapIdx];
    stopDemo();
    const cellBtn = c.cell ? `<button class="btn primary" id="cellAct">${c.cell === "tour" ? "Start the tour" : c.cell === "pendant" ? "Open the pendant in Practice" : "Show in the cell"}</button>` : "";
    const weldBtn = ["job", "gmaw", "arcinst", "handshake"].includes(c.id) ? `<button class="btn" id="demoWeld">Watch a full automatic weld</button>` : "";
    $("chapter").innerHTML = `
      <div class="eyebrow">${esc(c.part)} · Chapter ${chapIdx + 1} of ${CHAPTERS.length}${read.has(c.id) ? ' · <span class="ok">checked</span>' : ""}</div>
      <h2>${esc(c.title)}</h2><p class="lead">${esc(c.lead)}</p>
      ${c.anim ? `<div class="animbox"><canvas id="anim" aria-label="Animation: ${esc(c.title)}"></canvas></div>` : ""}
      <div class="actions">${cellBtn}${weldBtn}</div>
      <div class="prose">${c.body === "__ALARMS__" ? alarmTable() : c.body}</div>
      ${c.keys ? `<div class="prose">${keyTable()}</div>` : ""}
      <div class="quiz">${(c.quiz || []).map((q, qi) => `<div class="qz" data-q="${qi}"><h3>Check yourself</h3><p>${esc(q.q)}</p>${q.o.map((o, oi) => `<button class="opt" data-o="${oi}">${esc(o)}</button>`).join("")}<p class="why" hidden></p></div>`).join("")}</div>
      <div class="nav"><button class="btn" id="prevC" ${chapIdx === 0 ? "disabled" : ""}>Previous</button><button class="btn" id="nextC" ${chapIdx === CHAPTERS.length - 1 ? "disabled" : ""}>Next chapter</button></div>`;
    $("chapter").scrollTop = 0;
    animFn = c.anim ? ANIMS[c.anim] : null; animT0 = performance.now();
    if ($("cellAct")) $("cellAct").addEventListener("click", () => cellAction(c.cell));
    if ($("demoWeld")) $("demoWeld").addEventListener("click", demoWeld);
    $("prevC").addEventListener("click", () => setChapter(chapIdx - 1));
    $("nextC").addEventListener("click", () => setChapter(chapIdx + 1));
    document.querySelectorAll(".qz").forEach((el) => {
      const q = c.quiz[+el.dataset.q];
      el.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
        const right = +b.dataset.o === q.a;
        el.querySelectorAll(".opt").forEach((x) => x.classList.toggle("right", +x.dataset.o === q.a && right));
        b.classList.toggle("wrong", !right);
        const why = el.querySelector(".why"); why.hidden = false; why.textContent = (right ? "Correct. " : "Not quite. ") + q.why;
        if (right) { read.add(c.id); store.set("read", [...read]); chapterList(); }
      }));
    });
    chapterList();
    if (c.cell && c.cell !== "pendant" && c.cell !== "tour") cellAction(c.cell, true);
  }
  $("chapSel").addEventListener("change", (e) => setChapter(+e.target.value));

  // ---- 3D demos for chapters ----
  let demo = null;
  function stopDemo() { demo = null; if (scene.ok) scene.highlight(null); $("caption").hidden = true; }
  function caption(t) { $("caption").hidden = !t; $("caption").textContent = t || ""; }
  function cellAction(a, quiet) {
    if (!scene.ok) return;
    if (a === "pendant") { setMode("practice"); $("explainKeys").checked = true; tp.explain = true; app.log("Explain keys is on: click any pendant key to read about it.", "msg"); return; }
    if (a === "tour") {
      const ids = ["controller", "pendant", "modeswitch", "base", "axis2", "axis3", "feeder", "torch", "powersource", "wiredrum", "gas", "positioner", "part", "tailstock", "ground", "reamer", "fume", "fence", "door", "curtain", "panel", "tower", "plc"];
      demo = { kind: "tour", ids, i: -1, t: 99 };
      return;
    }
    if (a === "axes") { demo = { kind: "axes", t: 0, q0: world.q.slice() }; caption("Each axis in turn: J1 waist, J2 shoulder, J3 elbow, J4 roll, J5 bend, J6 flange"); return; }
    if (a === "frames") { demo = { kind: "frames", t: 0 }; scene.showFrames(true); return; }
    if (a === "weldview") { scene.view("weld"); return; }
    if (a === "plc") { scene.focus("plc", 2.2); scene.highlight("plc"); setTimeout(() => { if (mode !== "learn") return; }, 0); return; }
    if (a.startsWith("focus:")) { const id = a.slice(6); scene.focus(id, id === "fence" ? 5 : 2.0); scene.highlight(id); if (!quiet) showComp(id); }
  }
  function runDemo(dt) {
    if (!demo || !scene.ok) return;
    demo.t += dt;
    if (demo.kind === "tour") {
      if (demo.t > 3.6) {
        demo.t = 0; demo.i++;
        if (demo.i >= demo.ids.length) { stopDemo(); scene.view("iso"); return; }
        const id = demo.ids[demo.i];
        scene.focus(id, ["fence", "positioner"].includes(id) ? 4 : 2.0); scene.highlight(id);
        const c = COMPONENTS[id]; caption(`${demo.i + 1}/${demo.ids.length}  ${c[0]}: ${c[1]}`);
      }
    } else if (demo.kind === "axes" && !ctl.running) {
      const k = Math.floor(demo.t / 3) % 6, ph = (demo.t % 3) / 3;
      const q = WELD.homeQ.slice(); q[k] += Math.sin(ph * Math.PI * 2) * [40, 20, 20, 60, 40, 90][k];
      try { world.setJoints(q, "J", 0); } catch (e) { /* demo only */ }
      scene.highlight(["axis1", "axis2", "axis3", "axis4", "axis5", "axis6"][k]);
      caption(`J${k + 1}: ${["waist", "shoulder", "elbow", "forearm roll", "wrist bend", "flange roll"][k]}`);
    } else if (demo.kind === "frames" && !ctl.running) {
      const seg = Math.floor(demo.t / 4) % 3, f = Math.sin((demo.t % 4) / 4 * Math.PI * 2);
      const base = Pose.mul(fkFlange(WELD.homeQ), world.tool);
      const P = { type: "pose", p: base.p.slice(), R: base.R };
      if (seg === 0) { P.p[0] += 150 * f; caption("WORLD +X / −X: straight along the cell's X axis"); }
      if (seg === 1) { P.p = Vec.add(base.p, Vec.scale(Mat.col(base.R, 2), 90 * f)); caption("TOOL +Z / −Z: along the torch axis"); }
      if (seg === 2) { P.p[2] += 120 * f; caption("WORLD +Z: straight up, whatever the torch angle"); }
      const r = ikFlange(Pose.mul(P, Pose.inv(world.tool)), world.q);
      if (!r.error) try { world.setJoints(r.q, "L", 0); } catch (e) { /* demo only */ }
    }
  }
  function demoWeld() {
    setMode("practice");
    app.prepareAuto();
    if (scene.ok) scene.view("weld");
    app.operator(["clamp", "start"]);
    app.log("Demo: AUTO cycle. Operator clamps and presses START. Time-lapse is on.", "msg");
  }

  // ---------------------------------------------------------------- component card
  function showComp(id) {
    const c = COMPONENTS[id]; if (!c) return;
    $("comp").hidden = false;
    $("comp").innerHTML = `<button class="x" aria-label="Close">×</button><b>${esc(c[0])}</b><p>${esc(c[1])}</p>`;
    $("comp").querySelector(".x").addEventListener("click", () => { $("comp").hidden = true; scene.highlight(null); });
  }
  if (scene.ok) scene.onPick = (id) => { if (demo && demo.kind === "tour") return; scene.highlight(id); showComp(id); };

  // ---------------------------------------------------------------- operator strip
  function syncOps() {
    document.querySelectorAll("#modeSw button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === world.mode)));
    $("panelEstop").classList.toggle("on", world.estopPanel);
    $("door").textContent = world.doorClosed ? "Open the door" : "Close the door";
    $("curtain").textContent = world.curtainClear ? "Reach through curtain" : "Clear the curtain";
  }
  document.querySelectorAll("#modeSw button").forEach((b) => b.addEventListener("click", () => {
    if (world.mode === b.dataset.m) return;
    world.mode = b.dataset.m;
    if (ctl.running) { ctl.pause(); app.log("Mode changed: program paused.", "warn"); }
    if (world.mode === "AUTO") tp.step = false;
    app.log(`Mode switch: ${world.mode}.`, "info"); syncOps();
  }));
  $("panelEstop").addEventListener("click", () => { world.estopPanel = !world.estopPanel; syncOps(); });
  $("faultReset").addEventListener("click", () => { const ok = world.resetAlarms(); app.log(ok ? "Fault reset: alarms cleared." : "Fault reset: some causes are still present.", ok ? "info" : "warn"); });
  for (const b of ["start", "stop", "clamp", "unclamp"]) {
    const el = $("b_" + b);
    const dn = (e) => { e.preventDefault(); world.btn[b] = true; el.classList.add("on"); };
    const up = () => { world.btn[b] = false; el.classList.remove("on"); };
    el.addEventListener("pointerdown", dn); el.addEventListener("pointerup", up); el.addEventListener("pointerleave", up); el.addEventListener("pointercancel", up);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { dn(e); setTimeout(up, 250); } });
  }
  $("door").addEventListener("click", () => { world.doorClosed = !world.doorClosed; syncOps(); });
  $("curtain").addEventListener("click", () => { world.curtainClear = !world.curtainClear; syncOps(); });
  $("newPart").addEventListener("click", () => { if (ctl.running) { app.log("Stop the program before changing the part.", "warn"); return; } world.newPart(); world.plc.M.M1 = false; app.log("New part loaded.", "info"); renderReport(); });
  $("lapse").addEventListener("change", (e) => { world.timeLapse = +e.target.value; });
  $("vIso").addEventListener("click", () => scene.ok && scene.view("iso"));
  $("vWeld").addEventListener("click", () => scene.ok && scene.view("weld"));
  $("vFrames").addEventListener("click", (e) => { const on = e.currentTarget.getAttribute("aria-pressed") !== "true"; e.currentTarget.setAttribute("aria-pressed", String(on)); scene.ok && scene.showFrames(on); });
  $("explainKeys").addEventListener("change", (e) => { tp.explain = e.target.checked; $("explain").innerHTML = tp.explain ? "Click any key on the pendant to see what it does." : ""; });
  window.addEventListener("keydown", (e) => { if (e.key === "Shift") tp.shiftKey = true; });
  window.addEventListener("keyup", (e) => { if (e.key === "Shift") tp.shiftKey = false; });

  // ---------------------------------------------------------------- side tabs
  let activeTab = "missions";
  function setTab(t) {
    activeTab = t;
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    document.querySelectorAll(".tabpane").forEach((p) => (p.hidden = p.id !== "tab_" + t));
    if (t === "program") syncProgramText(true);
    if (t === "report") renderReport();
  }
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // missions
  let missionState = {};
  const doneM = new Set(store.get("missions", []));
  function renderMissions() {
    $("tab_missions").innerHTML = `<p class="note">Work through these in order. Each one is checked live in the cell.</p>` + MISSIONS.map((m, i) => {
      const done = doneM.has(m.id), cur = !done && MISSIONS.findIndex((x) => !doneM.has(x.id)) === i;
      return `<div class="mission${done ? " done" : ""}${cur ? " cur" : ""}"><div class="mh"><span class="num">${done ? "✓" : i + 1}</span><b>${esc(m.title)}</b></div>${cur ? `<p>${esc(m.how)}</p>` : ""}</div>`;
    }).join("") + `<button class="btn small" id="resetM">Reset missions</button>`;
    $("resetM").addEventListener("click", () => { doneM.clear(); store.set("missions", []); app.flags = {}; store.set("flags", {}); missionState = {}; renderMissions(); });
  }
  function checkMissions() {
    const i = MISSIONS.findIndex((x) => !doneM.has(x.id));
    if (i < 0) return;
    const m = MISSIONS[i];
    if (!missionState[m.id]) missionState[m.id] = m.init ? m.init(app) : {};
    if (m.check(app, missionState[m.id])) { doneM.add(m.id); store.set("missions", [...doneM]); app.log(`Mission complete: ${m.title}`, "msg"); renderMissions(); }
  }

  // scenarios
  let scen = null;
  function renderScenarios() {
    const s = scen;
    if (!s) {
      $("tab_scenario").innerHTML = `<p class="note">Each scenario puts a real fault into the cell. Investigate with the pendant (ALARM, I/O, POSN), the PLC ladder, the weld report and the 3D cell, then choose the root cause.</p>` +
        SCENARIOS.map((x, i) => `<button class="scen" data-i="${i}"><span class="lvl">${esc(x.level)}</span><b>${esc(x.title)}</b></button>`).join("");
      $("tab_scenario").querySelectorAll(".scen").forEach((b) => b.addEventListener("click", () => startScenario(+b.dataset.i)));
      return;
    }
    $("tab_scenario").innerHTML = `<button class="btn small" id="scenBack">All scenarios</button>
      <h3>${esc(s.title)}</h3><p class="brief">${esc(s.brief)}</p>
      <h4>Investigate</h4><ul>${s.look.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <h4>${esc(s.q)}</h4>${s.o.map((o, i) => `<button class="opt" data-o="${i}">${esc(o)}</button>`).join("")}
      <p class="why" hidden></p><button class="btn primary" id="scenFix" hidden>Apply the fix and run again</button>`;
    $("scenBack").addEventListener("click", () => { scen = null; renderScenarios(); });
    $("tab_scenario").querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
      const right = +b.dataset.o === s.a;
      b.classList.add(right ? "right" : "wrong");
      const why = $("tab_scenario").querySelector(".why"); why.hidden = false;
      why.textContent = right ? "Correct. " + s.why : "Not the root cause. Look again at the evidence: alarm, I/O, ladder, report.";
      if (right) $("scenFix").hidden = false;
    }));
    $("scenFix").addEventListener("click", () => { s.fix(app); app.log("Fix applied. Running the cycle again.", "msg"); app.prepareAuto(); app.operator(["clamp", "start"]); });
  }
  function startScenario(i) {
    scen = SCENARIOS[i];
    app.prepareAuto();
    tp.progs = tp.progs.map((p) => p); // keep user programs
    const d = TPStore.defaults()[0], p = tp.progs.find((x) => x.name === "CYL_WELD");
    if (p) { p.lines = d.lines.slice(); p.points = JSON.parse(JSON.stringify(d.points)); tp.changed(); }
    scen.setup(app);
    renderScenarios();
    app.log(`Scenario: ${scen.title}`, "msg");
    if (scene.ok) scene.view("iso");
  }

  // program text
  function syncProgramText(force) {
    const ta = $("lsText");
    if (document.activeElement === ta && !force) return;
    const { text } = TPStore.serialize(tp.progs);
    if (ta.value !== text) ta.value = text;
    store.set("programs", text);
    programDirty = false;
  }
  let lsTimer = null;
  $("lsText").addEventListener("input", () => {
    clearTimeout(lsTimer);
    lsTimer = setTimeout(() => {
      try { LANGS.fanuc.parse($("lsText").value); $("lsErr").textContent = ""; if (tp.loadText($("lsText").value)) store.set("programs", $("lsText").value); }
      catch (e) { $("lsErr").textContent = `Line ${e.line}: ${e.message}`; }
    }, 500);
  });
  $("lsRestore").addEventListener("click", () => { tp.progs = TPStore.defaults(); tp.selected = "CYL_WELD"; tp.changed(); syncProgramText(true); app.log("Programs restored to the defaults.", "info"); });

  // PLC ladder (SVG)
  const LW = 720, RH = 84;
  function plcVal(w, name) { const neg = name.startsWith("!"), n = neg ? name.slice(1) : name; const P = w.plc; const v = n in P.X ? P.X[n] : n in P.M ? P.M[n] : !!P.Y[n]; return neg ? !v : !!v; }
  function buildLadder() {
    const host = $("tab_plc");
    let y = 56, parts = [];
    const H = LADDER.reduce((h, r) => h + RH + (r.branch ? 54 : 0), 40);
    parts.push(`<div class="ladwrap"><svg viewBox="0 0 ${LW} ${H}" width="${LW}" height="${H}" class="ladder" role="img" aria-label="PLC ladder logic, live">`);
    parts.push(`<line class="rail" x1="10" y1="16" x2="10" y2="${H - 6}"/><line class="rail" x1="${LW - 10}" y1="16" x2="${LW - 10}" y2="${H - 6}"/>`);
    LADDER.forEach((r, ri) => {
      const ser = r.series, aft = r.after || [], br = r.branch || [];
      const coilX = LW - 70, seriesEnd = 30 + ser.length * 80, afterEnd = seriesEnd + aft.length * 80;
      parts.push(`<text class="rt" x="16" y="${y - 38}">${ri + 1}. ${esc(r.title)}</text>`);
      const contact = (x, yy, c, id) => {
        const nc = c[0].startsWith("!");
        return `<g id="${id}"><line class="w" x1="${x - 40}" y1="${yy}" x2="${x - 8}" y2="${yy}"/><line class="c" x1="${x - 8}" y1="${yy - 12}" x2="${x - 8}" y2="${yy + 12}"/><line class="c" x1="${x + 8}" y1="${yy - 12}" x2="${x + 8}" y2="${yy + 12}"/>${nc ? `<line class="c" x1="${x - 10}" y1="${yy + 12}" x2="${x + 10}" y2="${yy - 12}"/>` : ""}<line class="w2" x1="${x + 8}" y1="${yy}" x2="${x + 40}" y2="${yy}"/><text class="cn" x="${x}" y="${yy - 17}">${esc(c[0].replace("!", "/"))}</text><text class="cd" x="${x}" y="${yy + 26}">${esc(c[1])}</text></g>`;
      };
      ser.forEach((c, i) => parts.push(contact(30 + i * 80 + 40, y, c, `r${ri}s${i}`)));
      if (br.length) {
        br.forEach((c, i) => parts.push(contact(30 + i * 80 + 40, y + 54, c, `r${ri}b${i}`)));
        const bx = 30 + br.length * 80;
        parts.push(`<line class="w" id="r${ri}bj" x1="${bx}" y1="${y + 54}" x2="${seriesEnd}" y2="${y + 54}"/><line class="w" id="r${ri}bv" x1="${seriesEnd}" y1="${y + 54}" x2="${seriesEnd}" y2="${y}"/>`);
        parts.push(`<line class="w" id="r${ri}bl" x1="10" y1="${y}" x2="10" y2="${y + 54}"/><line class="w" x1="10" y1="${y + 54}" x2="30" y2="${y + 54}"/>`);
      }
      aft.forEach((c, i) => parts.push(contact(seriesEnd + i * 80 + 40, y, c, `r${ri}a${i}`)));
      parts.push(`<line class="w" id="r${ri}w" x1="${afterEnd}" y1="${y}" x2="${coilX - 16}" y2="${y}"/>`);
      parts.push(`<g id="r${ri}coil"><path class="c" d="M ${coilX - 8} ${y - 13} q -10 13 0 26 M ${coilX + 8} ${y - 13} q 10 13 0 26"/><text class="cn" x="${coilX}" y="${y - 17}">${esc(r.coil[0])}</text><text class="cd" x="${coilX}" y="${y + 27}">${esc(r.coil[1])}</text><line class="w" x1="${coilX + 16}" y1="${y}" x2="${LW - 10}" y2="${y}"/></g>`);
      y += RH + (br.length ? 54 : 0);
    });
    parts.push("</svg></div>");
    host.innerHTML = `<p class="note">Live ladder logic of the cell PLC. Highlighted = power flows / signal ON. Scan <span id="scanNo"></span>.</p>` + parts.join("") +
      `<table class="t io-map"><tr><th>PLC</th><th>Signal</th><th>PLC</th><th>Signal</th></tr><tr><td>X0</td><td>Door closed</td><td>Y0</td><td>Clamp solenoid</td></tr><tr><td>X1</td><td>Light curtain clear</td><td>Y1</td><td>Robot START (UI)</td></tr><tr><td>X2</td><td>CLAMP button</td><td>Y2</td><td>Robot DI[2] CLAMP OK</td></tr><tr><td>X3</td><td>Part present</td><td>Y3/Y4/Y5</td><td>Tower green/amber/red</td></tr><tr><td>X4</td><td>Clamped sensor</td><td>RDY</td><td>Robot ready (UO)</td></tr><tr><td>X5/X6/X7</td><td>START / STOP / UNCLAMP</td><td>RUN / DONE</td><td>Robot DO[1] / DO[2]</td></tr></table>`;
  }
  function updateLadder() {
    const w = world;
    LADDER.forEach((r, ri) => {
      let p = true;
      r.series.forEach((c, i) => { const g = document.getElementById(`r${ri}s${i}`); const on = p && plcVal(w, c[0]); g.querySelector(".w").classList.toggle("hot", p); g.querySelector(".w2").classList.toggle("hot", on); g.classList.toggle("closed", plcVal(w, c[0])); p = on; });
      let q = !!(r.branch && r.branch.length);
      (r.branch || []).forEach((c, i) => { const g = document.getElementById(`r${ri}b${i}`); const on = q && plcVal(w, c[0]); g.querySelector(".w").classList.toggle("hot", q); g.querySelector(".w2").classList.toggle("hot", on); g.classList.toggle("closed", plcVal(w, c[0])); q = on; });
      if (r.branch) { ["bj", "bv"].forEach((s) => document.getElementById(`r${ri}${s}`).classList.toggle("hot", q)); document.getElementById(`r${ri}bl`).classList.toggle("hot", true); }
      let j = p || q;
      (r.after || []).forEach((c, i) => { const g = document.getElementById(`r${ri}a${i}`); const on = j && plcVal(w, c[0]); g.querySelector(".w").classList.toggle("hot", j); g.querySelector(".w2").classList.toggle("hot", on); g.classList.toggle("closed", plcVal(w, c[0])); j = on; });
      document.getElementById(`r${ri}w`).classList.toggle("hot", j);
      document.getElementById(`r${ri}coil`).classList.toggle("hot", plcVal(w, r.coil[0]));
    });
    const s = document.getElementById("scanNo"); if (s) s.textContent = "#" + w.plc.scans;
  }

  // weld report
  function renderReport() {
    const r = world.inspect();
    const bins = new Array(180).fill(null);
    for (const b of world.part.beads) { const i = Math.floor(b.ang / 2) % 180; if (!bins[i] || b.grade !== "good") bins[i] = b.grade; }
    const col = { good: "var(--ok)", undercut: "var(--warn)", fast: "var(--warn)", slow: "var(--warn)", stickout: "var(--warn)", lof: "var(--danger)", porosity: "var(--danger)" };
    const map = bins.map((g, i) => `<rect x="${i * 3}" y="0" width="3" height="24" fill="${g ? col[g] : "var(--line)"}"/>`).join("");
    const names = { missing: "Not welded", porosity: "Porosity", lof: "Lack of fusion (off seam)", undercut: "Undercut (off centre)", fast: "Too fast (narrow, cold)", slow: "Too slow (excess, burn-through risk)", stickout: "Wrong stand-off (unstable arc)" };
    const avg = world.part.beads.length ? world.part.beads.reduce((s, b) => s + b.speed, 0) / world.part.beads.length : 0;
    $("tab_report").innerHTML = world.part.beads.length === 0
      ? `<p class="note">No weld on this part yet. Run CYL_WELD with WELD ENBL on (dry runs leave no bead). After the weld, this report shows coverage and defects by position around the seam.</p>`
      : `<div class="verdict ${r.pass ? "pass" : "fail"}">${r.pass ? "PASS" : "FAIL"}</div>
         <dl class="kv"><dt>Seam coverage</dt><dd>${(r.coverage * 100).toFixed(1)}%</dd><dt>Bead samples</dt><dd>${r.samples}</dd><dt>Mean travel speed</dt><dd>${avg.toFixed(1)} mm/s</dd><dt>Schedule</dt><dd>${esc(WELD.schedules[world.arc.sched].name)}</dd></dl>
         <h4>Seam map, 0° to 360°</h4><svg viewBox="0 0 540 24" class="seam" preserveAspectRatio="none">${map}</svg><div class="seamax"><span>0°</span><span>90°</span><span>180°</span><span>270°</span><span>360°</span></div>
         <h4>Findings</h4>${r.defects.length ? `<table class="t"><tr><th>Position</th><th>Finding</th><th>Detail</th></tr>${r.defects.slice(0, 12).map((d) => `<tr><td>${d.from}°–${d.to}°</td><td>${esc(names[d.grade] || d.grade)}</td><td>${esc(d.note || "")}</td></tr>`).join("")}</table>` : "<p>No defects found. The bead is continuous, centred and overlapped.</p>"}`;
  }

  // ---------------------------------------------------------------- status bar
  function updateStatus() {
    const st = !ctl.prog || ctl.state === "idle" ? "Ready" : { running: "Running", waiting: "Waiting", paused: "Paused", done: "Done", error: "Fault" }[ctl.state];
    const chip = $("stChip"); chip.textContent = st; chip.className = "chip " + ({ Running: "run", Waiting: "wait", Fault: "err", Done: "done" }[st] || "");
    const a = world.arc;
    $("arcInfo").textContent = a.phase === "on" ? `ARC ${a.volts.toFixed(1)} V · ${a.amps.toFixed(0)} A · ${(a.speed || 0).toFixed(1)} mm/s` : a.phase === "dry" ? "DRY RUN (weld disabled)" : a.phase === "off" ? (world.weldEnable ? "Weld enabled" : "Weld disabled") : a.phase.toUpperCase();
    $("arcInfo").className = "arc " + (a.phase === "on" ? "on" : "");
    $("modeInfo").textContent = `${world.mode} · TP ${world.tpOn ? "ON" : "OFF"} · E1 ${world.e1.toFixed(0)}°`;
    const Y = world.plc.Y;
    $("tl").innerHTML = `<i class="r${Y.Y5 ? " on" : ""}"></i><i class="a${Y.Y4 ? " on" : ""}"></i><i class="g${Y.Y3 ? " on" : ""}"></i>`;
    $("almLine").textContent = world.alarms.length ? world.alarms.map((x) => `${x.code} ${x.text}`).join(" · ") : "";
  }

  // ---------------------------------------------------------------- loop
  const animCanvas = () => $("anim");
  function drawAnim(now) {
    const cv = animCanvas(); if (!cv || !animFn || mode !== "learn") return;
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    // animations are drawn in a fixed 680 x 361 space and scaled to the box
    const k = (r.width / 680) * dpr;
    const ctx = cv.getContext("2d"); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.setTransform(k, 0, 0, k, 0, 0);
    const C = { ink: css("--ink"), muted: css("--muted"), line: css("--line"), accent: css("--accent"), accentSoft: css("--accent-soft"), accentInk: css("--accent-ink"), warn: css("--warn"), danger: css("--danger"), ok: css("--ok"), panel: css("--panel-2"), bg: css("--bg") };
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches || !drawAnim.done) { animFn(ctx, (now - animT0) / 1000, 680, 361, C); drawAnim.done = true; }
  }
  let last = performance.now(), slowT = 0, hudT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // scripted operator actions
    if (opQueue.length) { opClock += dt; while (opQueue.length && opQueue[0].t <= opClock && (!opQueue[0].cond || opQueue[0].cond())) opQueue.shift().fn(); }
    tp.tick(dt);
    ctl.tick(dt);
    world.step(dt, ctl);
    if (world.plc.startEdge) {
      world.plc.startEdge = false;
      if (world.mode === "AUTO" && world.robotReady && !ctl.running) { tp.selected = tp.selected || "CYL_WELD"; tp.cur.line = 0; tp.runFrom(0, false); app.log(`PLC START: running ${tp.selected} in AUTO.`, "msg"); }
    }
    if (lastArc === "on" && world.arc.phase !== "on") { renderReport(); const r = world.inspect(); app.log(`Weld finished: ${r.pass ? "PASS" : "FAIL"}, coverage ${(r.coverage * 100).toFixed(0)}%.`, r.pass ? "msg" : "warn"); }
    lastArc = world.arc.phase;
    runDemo(dt);
    if (scene.ok) { scene.update(world, dt, now / 1000); scene.syncBeads(world.part.beads); scene.render(); }
    drawAnim(now);
    hudT += dt;
    if (hudT > 0.1) { hudT = 0; tp.render(); updateStatus(); }
    slowT += dt;
    if (slowT > 0.25) {
      slowT = 0;
      if (activeTab === "plc" && mode !== "learn") updateLadder();
      if (activeTab === "report" && world.arc.phase === "on") renderReport();
      if (programDirty && activeTab === "program") syncProgramText(false);
      else if (programDirty) { store.set("programs", TPStore.serialize(tp.progs).text); programDirty = false; }
      checkMissions();
    }
    requestAnimationFrame(frame);
  }

  // theme + resize
  const applyTheme = () => { if (scene.ok) scene.applyTheme({ sky: css("--sky"), floor: css("--floor"), grid: css("--grid") }); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  new ResizeObserver(() => { const r = $("view3d").getBoundingClientRect(); if (scene.ok) scene.resize(Math.max(1, r.width), Math.max(1, r.height)); }).observe($("view3d"));

  // start
  buildLadder(); renderMissions(); renderScenarios(); renderReport(); chapterList(); setChapter(chapIdx); syncOps();
  setMode(location.hash === "#practice" ? "practice" : location.hash === "#trouble" ? "trouble" : mode);
  setTab(mode === "trouble" ? "scenario" : "missions");
  app.log("Welcome. Learn the cell, practise on the pendant, then troubleshoot real faults.", "msg");
  requestAnimationFrame(frame);
  window.__weld = { world, ctl, tp, app, scene, setMode, setChapter, startScenario, demoWeld };
})();

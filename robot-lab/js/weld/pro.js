"use strict";
// Pro mode: test your own programs with no hints, on one device or two.
// Two devices pair with a 6-digit code: the "robot" device runs the whole simulation; the "pendant" device is a
// remote teach pendant. Keys travel pendant -> robot; the pendant screen picture travels robot -> pendant.
// The link is a WebRTC data channel set up through the public PeerJS broker (https://peerjs.com).
(function () {
  const $ = (id) => document.getElementById(id);
  const W = window.__weld;
  const { world, tp, view } = W;
  const PREFIX = "weldcell-pro-";
  const PEER_URLS = ["https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js", "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"];

  let role = "pick", peer = null, conn = null, code = "", lastSeen = 0, remoteView = null, retry = null;

  // ---------------------------------------------------------------- PeerJS
  function loadPeer() {
    if (window.Peer) return Promise.resolve();
    return PEER_URLS.reduce((p, url) => p.catch(() => new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = url; s.onload = () => (window.Peer ? res() : rej()); s.onerror = rej; document.head.appendChild(s);
    })), Promise.reject()).catch(() => { throw new Error("Could not load the connection library. Check the internet connection."); });
  }
  // ?peer=host:port points at a self-hosted PeerJS server (used for testing); otherwise the public broker
  function peerOpts() {
    const m = new URLSearchParams(location.search).get("peer");
    if (!m) return { debug: 0 };
    const [host, port] = m.split(":");
    return { host, port: +port || 9000, path: "/", secure: false, debug: 0 };
  }
  const newCode = () => String(Math.floor(100000 + Math.random() * 900000));
  const fmtCode = (c) => c.slice(0, 3) + " " + c.slice(3);
  function send(msg) { if (conn && conn.open) try { conn.send(msg); } catch (e) { /* link going down */ } }
  function closeAll() {
    clearInterval(retry); retry = null;
    if (conn) try { conn.close(); } catch (e) { /* already closed */ }
    if (peer) try { peer.destroy(); } catch (e) { /* already gone */ }
    conn = null; peer = null;
  }

  // ---------------------------------------------------------------- roles and layout
  function setRole(r) {
    if (r !== role) closeAll();
    document.body.classList.remove("linked");
    role = r;
    document.body.dataset.role = r;
    $("proPick").hidden = r !== "pick";
    $("proJoin").hidden = true;
    $("proRemote").hidden = r !== "pendant";
    $("proCodeBox").hidden = r !== "robot";
    if (r === "robot") startRobot();
    if (r === "pendant") { $("proPick").hidden = false; $("proRemote").hidden = true; $("proJoin").hidden = false; $("proCode").focus(); }
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
  document.querySelectorAll("#proPick [data-role]").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.role)));
  $("proLeave").addEventListener("click", () => setRole("pick"));
  $("proChange").addEventListener("click", () => setRole("pick"));
  $("proFs").addEventListener("click", () => W.toggleFs());

  // called by the app whenever the mode changes
  function onMode(m) {
    if (m !== "pro") { closeAll(); role = "pick"; delete document.body.dataset.role; document.body.classList.remove("linked"); return; }
    // a link like weld.html#pendant=123456 joins straight away
    const h = location.hash.match(/pendant=(\d{6})/);
    if (h) { setRole("pendant"); $("proCode").value = h[1]; join(); return; }
    setRole("pick");
  }

  // ---------------------------------------------------------------- robot side
  function robotStatus(t) { $("proCodeSt").textContent = t; }
  async function startRobot() {
    code = newCode();
    $("proCodeNum").textContent = fmtCode(code);
    robotStatus("Connecting to the pairing service…");
    try { await loadPeer(); } catch (e) { robotStatus(e.message); return; }
    if (role !== "robot") return;
    peer = new window.Peer(PREFIX + code, peerOpts());
    peer.on("open", () => robotStatus("Waiting for the pendant. On the other device: Pro › Teach pendant, then type this code."));
    peer.on("error", (e) => {
      if (e.type === "unavailable-id") { closeAll(); startRobot(); return; } // code already in use: pick another
      if (e.type === "peer-unavailable" || e.type === "network" && conn === null && $("proCodeSt").textContent.startsWith("Pendant link lost")) return; // the pendant went away: already handled
      robotStatus(`Pairing problem: ${e.type || e.message}. Press "Change role" and try again.`);
    });
    peer.on("disconnected", () => { if (peer && !peer.destroyed) try { peer.reconnect(); } catch (e) { /* retry later */ } });
    peer.on("connection", (c) => {
      if (conn && conn.open) { c.on("open", () => { c.send({ t: "busy" }); setTimeout(() => c.close(), 300); }); return; }
      conn = c;
      c.on("open", () => {
        lastSeen = Date.now(); sentView = ""; sentKeys = {};
        robotStatus("Pendant connected ✓");
        $("proCodeBox").classList.add("ok");
        W.app.log("Pro: teach pendant connected from another device.", "msg");
        pushView(true);
      });
      c.on("data", onRobotData);
      c.on("close", () => linkLost("closed"));
      c.on("error", () => linkLost("error"));
    });
  }
  function onRobotData(m) {
    lastSeen = Date.now();
    if (!m || typeof m !== "object") return;
    if (m.t === "k" && typeof m.k === "string" && TP_KEYS[m.k]) { if (m.down) tp.key(m.k); else tp.keyUp(m.k); pushView(true); }
  }
  // a pendant that stops talking must not leave the robot moving: stop the jog and release the enabling switch
  function linkLost(why) {
    if (role !== "robot") return;
    const was = conn; conn = null;
    if (was) try { was.close(); } catch (e) { /* closed */ }
    if (tp.jog) tp.jog = null;
    if (world.deadman) { world.deadman = false; }
    if (W.ctl.running && world.mode !== "AUTO") W.ctl.pause();
    $("proCodeBox").classList.remove("ok");
    robotStatus("Pendant link lost: motion stopped, enabling switch released. Reconnect with the same code.");
    W.app.log(`Pro: teach pendant link ${why === "timeout" ? "timed out" : "lost"}. Motion stopped.`, "warn");
  }
  setInterval(() => { if (role === "robot" && conn && conn.open && Date.now() - lastSeen > 2000) linkLost("timeout"); }, 200);

  // mirror the local pendant picture to the remote one
  let sentView = "", sentKeys = {}, lastPush = 0, lastVm = null;
  const baseRender = view.render.bind(view), baseKeyState = view.setKeyState.bind(view), baseFlash = view.flash.bind(view);
  view.render = (v) => { baseRender(v); lastVm = v; if (role === "robot") pushView(false); };
  view.setKeyState = (k, on, cls = "on") => {
    baseKeyState(k, on, cls);
    const id = k + "|" + cls;
    if (role === "robot" && sentKeys[id] !== !!on) { sentKeys[id] = !!on; send({ t: "ks", k, on: !!on, cls }); }
  };
  view.flash = (k) => { baseFlash(k); if (role === "robot") send({ t: "fl", k }); };
  function statusLine() {
    const a = world.alarms.filter((x) => x.code !== "SRVO-065")[0];
    return { dm: world.deadman, text: `${world.mode} · TP ${world.tpOn ? "ON" : "OFF"} · Servo ${world.servoOn ? "ON" : "OFF"}${a ? " · " + a.code : ""}` };
  }
  function pushView(force) {
    if (!conn || !conn.open || !lastVm) return;
    const s = JSON.stringify(lastVm), now = Date.now();
    if (!force && s === sentView && now - lastPush < 2000) return;
    sentView = s; lastPush = now;
    send({ t: "v", v: lastVm, st: statusLine() });
    if (force) for (const id of Object.keys(sentKeys)) { const [k, cls] = id.split("|"); send({ t: "ks", k, on: sentKeys[id], cls }); }
  }

  // ---------------------------------------------------------------- pendant side
  $("proConnect").addEventListener("click", join);
  $("proCode").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  function joinMsg(t) { $("proJoinMsg").textContent = t; }
  async function join() {
    const c = $("proCode").value.replace(/\D/g, "");
    if (c.length !== 6) { joinMsg("Type the 6-digit code shown on the robot screen."); return; }
    code = c; joinMsg("Connecting…");
    try { await loadPeer(); } catch (e) { joinMsg(e.message); return; }
    if (role !== "pendant") return;
    if (peer) { try { peer.destroy(); } catch (e) { /* gone */ } peer = null; }
    peer = new window.Peer(undefined, peerOpts());
    peer.on("open", () => connectTo());
    peer.on("error", (e) => {
      if (e.type === "peer-unavailable") { if (!remoteOpen()) joinMsg(`No robot screen with code ${fmtCode(code)}. Check the code, and that the robot screen is open.`); linkStatus("Robot not found", "bad"); return; }
      joinMsg(`Connection problem: ${e.type || e.message}.`); linkStatus("Connection problem", "bad");
    });
  }
  const remoteOpen = () => !$("proRemote").hidden;
  function connectTo() {
    if (!peer || peer.destroyed) return;
    const c = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
    c.on("open", () => {
      conn = c; clearInterval(retry); retry = null;
      $("proPick").hidden = true; $("proRemote").hidden = false; joinMsg("");
      document.body.classList.add("linked");
      if (!remoteView) remoteView = new PendantView($("proTp"), { onKey: (k) => send({ t: "k", k, down: true }), onKeyUp: (k) => send({ t: "k", k, down: false }) });
      linkStatus(`Linked to robot ${fmtCode(code)}`, "ok");
      fitRemote();
    });
    c.on("data", onPendantData);
    c.on("close", () => { if (conn === c) { conn = null; linkStatus("Link lost: reconnecting…", "bad"); if (!retry) retry = setInterval(() => { if (!conn && peer && !peer.destroyed) connectTo(); }, 2000); } });
  }
  function onPendantData(m) {
    if (!m || typeof m !== "object" || !remoteView) return;
    if (m.t === "v") {
      remoteView.render(m.v);
      if (m.st) { $("proRobotSt").textContent = m.st.text; const b = $("proDm"); b.classList.toggle("on", !!m.st.dm); b.textContent = m.st.dm ? "ENABLING SWITCH: HELD · tap to release" : "ENABLING SWITCH: released · tap to hold"; }
    }
    if (m.t === "ks") remoteView.setKeyState(m.k, m.on, m.cls);
    if (m.t === "fl") remoteView.flash(m.k);
    if (m.t === "busy") { linkStatus("That robot already has a pendant connected.", "bad"); }
  }
  function linkStatus(t, cls) { const el = $("proLink"); el.textContent = t; el.className = "link " + (cls || ""); }
  $("proDm").addEventListener("click", () => send({ t: "k", k: "deadman", down: true }));
  setInterval(() => { if (role === "pendant" && conn && conn.open) send({ t: "hb" }); }, 400);

  // the remote pendant fills its screen: scale it to the free height (and never wider than the screen)
  function fitRemote() {
    const host = $("proTp"), box = $("proRemote");
    if (!host || box.hidden) return;
    host.style.zoom = "";
    const used = [...box.children].filter((c) => c !== host && c.offsetParent).reduce((h, c) => h + c.offsetHeight, 0);
    const freeH = box.clientHeight - used - 16, needH = host.scrollHeight;
    const maxW = (box.clientWidth - 4) / Math.max(1, host.offsetWidth); // never wider than the screen
    if (freeH > 0 && needH > 0) host.style.zoom = Math.max(0.55, Math.min(1.7, maxW, freeH / needH)).toFixed(3);
    for (let i = 0; i < 6 && box.scrollHeight > box.clientHeight + 1 && +host.style.zoom > 0.55; i++) host.style.zoom = (+host.style.zoom * 0.96).toFixed(3);
  }
  window.addEventListener("resize", () => requestAnimationFrame(fitRemote));
  new ResizeObserver(() => fitRemote()).observe($("proRemote"));

  window.WeldPro = { onMode, get role() { return role; } };
  onMode(document.body.dataset.mode);
})();

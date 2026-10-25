"use strict";
// Pro mode: test your own programs with no hints, on one device or two.
// Two devices pair with a 6-digit code: the "robot" device runs the whole simulation; the "pendant" device is a
// remote teach pendant. Keys travel pendant -> robot; the pendant screen picture travels robot -> pendant.
// Two routes, so it works on any pair of networks:
//   direct: a WebRTC data channel set up through the public PeerJS broker (peerjs.com, with its TURN relay);
//   relay:  if direct cannot connect, messages go through a public MQTT broker over a secure web socket.
(function () {
  const $ = (id) => document.getElementById(id);
  const W = window.__weld;
  const { world, tp, view } = W;
  const PREFIX = "weldcell-pro-";
  const TOPIC = (c, dir) => `weldcell-pro/v1/${c}/${dir}`; // dir: p2r (pendant to robot) or r2p
  const LIBS = {
    peer: { test: () => window.Peer, urls: ["https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js", "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"] },
    mqtt: { test: () => window.mqtt, urls: ["https://cdn.jsdelivr.net/npm/mqtt@5.16.1/dist/mqtt.min.js", "https://unpkg.com/mqtt@5.16.1/dist/mqtt.min.js"] },
  };
  const params = new URLSearchParams(location.search);
  // ?relay=ws://host:port/mqtt and ?peer=host:port | off point at self-hosted servers (used for testing)
  const BROKERS = params.get("relay") ? [params.get("relay")] : ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"];
  const DIRECT_OFF = params.get("peer") === "off";

  let role = "pick", peer = null, conn = null, code = "", lastSeen = 0, remoteView = null, retry = null;
  let relays = [], attempt = 0, myId = "", robotSeen = 0, directOk = false, relayOk = false;

  function loadLib(name) {
    const L = LIBS[name];
    if (L.test()) return Promise.resolve();
    return L.urls.reduce((p, url) => p.catch(() => new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = url; s.onload = () => (L.test() ? res() : rej()); s.onerror = rej; document.head.appendChild(s);
    })), Promise.reject()).catch(() => { throw new Error("Could not load the connection library. Check the internet connection."); });
  }
  function peerOpts() {
    const m = params.get("peer");
    if (!m || m === "off") return { debug: 0 };
    const [host, port] = m.split(":");
    return { host, port: +port || 9000, path: "/", secure: false, debug: 0 };
  }
  const newCode = () => String(Math.floor(100000 + Math.random() * 900000));
  const fmtCode = (c) => c.slice(0, 3) + " " + c.slice(3);
  const rid = () => Math.random().toString(36).slice(2, 10);
  function send(msg) { if (conn && conn.open) try { conn.send(msg); } catch (e) { /* link going down */ } }

  // ---- the two kinds of link, behind one small interface { kind, open, send, close } ----
  function directLink(c) {
    return { kind: "direct", get open() { return c.open; }, send: (m) => c.send(m), close: () => { try { c.close(); } catch (e) { /* closed */ } } };
  }
  function relayLink(client, outTopic, id) {
    const L = { kind: "relay", id, open: true, send: (m) => { if (L.open) client.publish(outTopic, JSON.stringify(m)); }, close: () => { L.open = false; } };
    return L;
  }
  // connect to the relay brokers (all of them on the robot, the first that answers on the pendant)
  async function startRelays(subTopic, onMsg, all) {
    await loadLib("mqtt");
    const mine = attempt;
    const tryOne = (url) => new Promise((res, rej) => {
      const client = window.mqtt.connect(url, { clientId: "weldcell_" + rid(), keepalive: 20, reconnectPeriod: 3000, connectTimeout: 6000, clean: true });
      let done = false;
      client.on("connect", () => { client.subscribe(subTopic, { qos: 0 }); if (!done) { done = true; res(client); } });
      client.on("message", (t, payload) => { if (mine !== attempt) return; let m; try { m = JSON.parse(typeof payload === "string" ? payload : new TextDecoder().decode(payload)); } catch (e) { return; } onMsg(m, client); });
      client.on("error", () => { if (!done) { done = true; client.end(true); rej(); } });
      setTimeout(() => { if (!done) { done = true; client.end(true); rej(); } }, 7000);
    });
    if (all) {
      const got = await Promise.allSettled(BROKERS.map(tryOne));
      got.forEach((g) => g.status === "fulfilled" && relays.push(g.value));
    } else {
      for (const url of BROKERS) { try { relays.push(await tryOne(url)); break; } catch (e) { /* next broker */ } }
    }
    return relays.length > 0;
  }
  function closeAll() {
    attempt++;
    clearInterval(retry); retry = null;
    if (conn) { try { conn.send({ t: "bye" }); } catch (e) { /* gone */ } conn.close(); }
    if (peer) try { peer.destroy(); } catch (e) { /* already gone */ }
    relays.forEach((c) => { try { c.end(true); } catch (e) { /* gone */ } });
    relays = []; conn = null; peer = null; directOk = relayOk = false;
  }

  // ---------------------------------------------------------------- roles and layout
  function setRole(r) {
    if (r !== role) closeAll();
    if (document.body.classList.contains("cellfs")) W.exitFs();
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
    if (m !== "pro") { if (document.body.classList.contains("cellfs")) W.exitFs(); closeAll(); role = "pick"; delete document.body.dataset.role; document.body.classList.remove("linked"); return; }
    // a link like weld.html#pendant=123456 joins straight away
    const h = location.hash.match(/pendant=(\d{6})/);
    if (h) { setRole("pendant"); $("proCode").value = h[1]; join(); return; }
    setRole("pick");
  }

  // ---------------------------------------------------------------- robot side
  function robotStatus(t) { $("proCodeSt").textContent = t; }
  function waitingText() {
    if (!directOk && !relayOk) return "Opening the link…";
    return "Waiting for the pendant. On the other device open this page, choose Pro › Teach pendant and type this code.";
  }
  async function startRobot() {
    code = newCode();
    const mine = attempt;
    $("proCodeNum").textContent = fmtCode(code);
    robotStatus("Opening the link…");
    // route 1: direct (WebRTC)
    if (!DIRECT_OFF) loadLib("peer").then(() => {
      if (mine !== attempt) return;
      peer = new window.Peer(PREFIX + code, peerOpts());
      peer.on("open", () => { directOk = true; if (!conn) robotStatus(waitingText()); });
      peer.on("error", (e) => {
        if (e.type === "unavailable-id") { closeAll(); startRobot(); return; } // code already in use: pick another
        if (e.type === "peer-unavailable") return; // a pendant went away: handled by the link checks
      });
      peer.on("disconnected", () => { if (peer && !peer.destroyed) try { peer.reconnect(); } catch (e) { /* retry later */ } });
      peer.on("connection", (c) => {
        c.on("open", () => {
          if (conn && conn.open) { c.send({ t: "busy" }); setTimeout(() => c.close(), 300); return; }
          const L = directLink(c);
          c.on("data", (m) => { if (conn === L) onRobotData(m); });
          c.on("close", () => { if (conn === L) linkLost("closed"); });
          accept(L);
        });
      });
    }).catch(() => {});
    // route 2: relay (MQTT over a secure web socket), always listening as well
    startRelays(TOPIC(code, "p2r"), (m, client) => {
      if (role !== "robot") return;
      if (m.t === "hello" && m.id) {
        if (conn && conn.open && conn.id !== m.id) { client.publish(TOPIC(code, "r2p"), JSON.stringify({ t: "busy", id: m.id })); return; }
        if (!conn || !conn.open) accept(relayLink(client, TOPIC(code, "r2p"), m.id));
        client.publish(TOPIC(code, "r2p"), JSON.stringify({ t: "welcome", id: m.id }));
        pushView(true);
        return;
      }
      if (conn && conn.kind === "relay" && m.id === conn.id) onRobotData(m);
    }, true).then((ok) => { relayOk = ok; if (mine === attempt && !conn) robotStatus(waitingText()); }).catch(() => {});
  }
  function accept(L) {
    conn = L; lastSeen = Date.now(); sentView = ""; sentKeys = {};
    robotStatus(`Pendant connected ✓ (${L.kind === "direct" ? "direct link" : "relay"})`);
    $("proCodeBox").classList.add("ok");
    W.app.log(`Pro: teach pendant connected from another device (${L.kind === "direct" ? "direct link" : "relay"}).`, "msg");
    if (!document.body.classList.contains("cellfs")) W.enterCellFs(); // the robot screen becomes the full-screen cell
    pushView(true);
  }
  function onRobotData(m) {
    lastSeen = Date.now();
    if (!m || typeof m !== "object") return;
    if (m.t === "k" && typeof m.k === "string" && TP_KEYS[m.k]) { if (m.down) tp.key(m.k); else tp.keyUp(m.k); pushView(true); }
    if (m.t === "bye") linkLost("closed");
  }
  // a pendant that stops talking must not leave the robot moving: stop the jog and release the enabling switch
  function linkLost(why) {
    if (role !== "robot" || !conn) return;
    const was = conn; conn = null; was.close();
    if (tp.jog) tp.jog = null;
    if (world.deadman) world.deadman = false;
    if (W.ctl.running && world.mode !== "AUTO") W.ctl.pause();
    $("proCodeBox").classList.remove("ok");
    robotStatus("Pendant link lost: motion stopped, enabling switch released. Reconnect with the same code.");
    W.app.log(`Pro: teach pendant link ${why === "timeout" ? "timed out" : "lost"}. Motion stopped.`, "warn");
  }
  setInterval(() => {
    if (role !== "robot" || !conn) return;
    if (Date.now() - lastSeen > (conn.kind === "relay" ? 4000 : 3000)) linkLost("timeout");
    else send({ t: "hb" });
  }, 250);

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
    if (!force && conn.kind === "relay" && now - lastPush < 150) return; // keep the relay traffic modest
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
    closeAll(); code = c; myId = rid();
    const mine = attempt;
    joinMsg("Connecting…");
    let relayStarted = false;
    const goRelay = () => { if (relayStarted || conn || mine !== attempt) return; relayStarted = true; joinMsg("Connecting through the relay…"); startPendantRelay(mine); };
    if (DIRECT_OFF) goRelay();
    else {
      loadLib("peer").then(() => {
        if (mine !== attempt) return;
        peer = new window.Peer(undefined, peerOpts());
        peer.on("open", () => connectDirect(mine));
        peer.on("error", (e) => { if (!conn) goRelay(); }); // robot not found directly, broker blocked, ...: try the relay
      }).catch(goRelay);
      setTimeout(goRelay, 6000); // direct did not come up in time: use the relay
    }
    setTimeout(() => { if (mine === attempt && !conn) joinMsg(`No robot screen answered code ${fmtCode(code)}. Check the code, and that the robot screen is open in Pro › Robot cell.`); }, 20000);
  }
  function connectDirect(mine) {
    if (!peer || peer.destroyed || mine !== attempt) return;
    const c = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
    c.on("open", () => {
      if (mine !== attempt || (conn && conn.open)) { c.close(); return; }
      const L = directLink(c);
      c.on("data", (m) => { if (conn === L) onPendantData(m); });
      c.on("close", () => { if (conn === L) pendantLost(); });
      linked(L);
    });
  }
  async function startPendantRelay(mine) {
    const ok = await startRelays(TOPIC(code, "r2p"), (m, client) => {
      if (m.id && m.id !== myId) return;
      if (m.t === "welcome" && (!conn || !conn.open)) { const L = relayLink(client, TOPIC(code, "p2r"), myId); L.send = ((s) => (msg) => s(Object.assign({ id: myId }, msg)))(L.send); linked(L); return; }
      if (conn && conn.kind === "relay") onPendantData(m);
    }, false).catch(() => false);
    if (!ok) { if (!conn) joinMsg("Could not reach the relay either. Check the internet connection on this device."); return; }
    // say hello until the robot welcomes us
    const hello = () => { if (mine !== attempt || (conn && conn.open)) return; relays[0].publish(TOPIC(code, "p2r"), JSON.stringify({ t: "hello", id: myId })); setTimeout(hello, 1000); };
    hello();
  }
  function linked(L) {
    conn = L; clearInterval(retry); retry = null; robotSeen = Date.now();
    $("proPick").hidden = true; $("proRemote").hidden = false; joinMsg("");
    document.body.classList.add("linked");
    if (!remoteView) remoteView = new PendantView($("proTp"), { onKey: (k) => send({ t: "k", k, down: true }), onKeyUp: (k) => send({ t: "k", k, down: false }) });
    linkStatus(`Linked to robot ${fmtCode(code)} · ${L.kind === "direct" ? "direct" : "relay"}`, "ok");
    fitRemote();
  }
  function pendantLost() {
    if (role !== "pendant") return;
    const was = conn; conn = null; if (was) was.close();
    linkStatus("Link lost: reconnecting…", "bad");
    const mine = attempt;
    // try again with the same code: direct first, the relay after a few seconds
    if (!retry) retry = setInterval(() => {
      if (conn || mine !== attempt) { clearInterval(retry); retry = null; return; }
      if (peer && !peer.destroyed) connectDirect(mine);
      if (relays.length) relays[0].publish(TOPIC(code, "p2r"), JSON.stringify({ t: "hello", id: myId }));
    }, 2000);
  }
  function onPendantData(m) {
    robotSeen = Date.now();
    if (!m || typeof m !== "object" || !remoteView) return;
    if (m.t === "v") {
      remoteView.render(m.v);
      if (m.st) { $("proRobotSt").textContent = m.st.text; const b = $("proDm"); b.classList.toggle("on", !!m.st.dm); b.textContent = m.st.dm ? "ENABLING SWITCH: HELD · tap to release" : "ENABLING SWITCH: released · tap to hold"; }
    }
    if (m.t === "ks") remoteView.setKeyState(m.k, m.on, m.cls);
    if (m.t === "fl") remoteView.flash(m.k);
    if (m.t === "busy") linkStatus("That robot already has a pendant connected.", "bad");
    if (m.t === "bye") pendantLost();
  }
  function linkStatus(t, cls) { const el = $("proLink"); el.textContent = t; el.className = "link " + (cls || ""); }
  $("proDm").addEventListener("click", () => send({ t: "k", k: "deadman", down: true }));
  setInterval(() => {
    if (role !== "pendant" || !conn) return;
    send({ t: "hb" });
    if (Date.now() - robotSeen > 4000) pendantLost(); // the robot screen went quiet
  }, 400);

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

  window.WeldPro = { onMode, get role() { return role; }, get link() { return conn ? conn.kind : null; } };
  onMode(document.body.dataset.mode);
})();

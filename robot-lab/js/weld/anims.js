"use strict";
// Canvas animations for the Learn chapters. Each draws one frame: fn(ctx, t, W, H, C).

const ANIMS = (() => {
  const TAU = Math.PI * 2;
  const font = (px, w = 500) => `${w} ${px}px "IBM Plex Sans", system-ui, sans-serif`;
  const mono = (px) => `500 ${px}px "JetBrains Mono", ui-monospace, monospace`;
  function label(ctx, txt, x, y, C, o = {}) {
    ctx.font = o.mono ? mono(o.size || 12) : font(o.size || 12, o.w || 500);
    ctx.fillStyle = o.color || C.ink; ctx.textAlign = o.align || "center"; ctx.textBaseline = o.base || "middle";
    ctx.fillText(txt, x, y);
  }
  function box(ctx, x, y, w, h, C, o = {}) {
    ctx.fillStyle = o.fill || C.panel; ctx.strokeStyle = o.stroke || C.line; ctx.lineWidth = o.lw || 1.5;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, o.r ?? 6) : ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
    if (o.text) label(ctx, o.text, x + w / 2, y + h / 2 + (o.sub ? -7 : 0), C, { size: o.size || 12.5, w: 600, color: o.tcolor });
    if (o.sub) label(ctx, o.sub, x + w / 2, y + h / 2 + 9, C, { size: 10.5, color: C.muted });
  }
  function arrow(ctx, x1, y1, x2, y2, C, color, lw = 1.6) {
    ctx.strokeStyle = color || C.muted; ctx.fillStyle = color || C.muted; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - 8 * Math.cos(a - 0.4), y2 - 8 * Math.sin(a - 0.4)); ctx.lineTo(x2 - 8 * Math.cos(a + 0.4), y2 - 8 * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
  }
  function pulse(ctx, x1, y1, x2, y2, f, color) {
    const x = x1 + (x2 - x1) * f, y = y1 + (y2 - y1) * f;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
  }
  function gear(ctx, cx, cy, r, teeth, ang, fill, stroke) {
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = ang + (i / (teeth * 2)) * TAU, rr = i % 2 ? r : r * 0.86;
      const a2 = ang + ((i + 1) / (teeth * 2)) * TAU;
      ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); ctx.lineTo(cx + rr * Math.cos(a2), cy + rr * Math.sin(a2));
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.18, 0, TAU); ctx.fillStyle = stroke; ctx.fill();
  }

  const A = {};

  // ---------- servo drivetrain: motor -> reducer -> link, encoder, brake ----------
  A.drivetrain = (ctx, t, W, H, C) => {
    const cyc = t % 9, servo = cyc < 6.5;
    const motorAng = servo ? t * 18 : 6.5 * 18 + Math.floor(t / 9) * 117;
    const y = H * 0.48;
    // motor
    box(ctx, 30, y - 45, 120, 90, C, { text: "Servo motor", sub: servo ? "≈3000 rpm" : "stopped" });
    ctx.save(); ctx.translate(90, y + 52); ctx.rotate(motorAng); ctx.strokeStyle = C.accent; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.stroke(); ctx.restore();
    // encoder on the back
    box(ctx, 30, y - 100, 120, 40, C, { text: "Encoder", sub: "counts every turn", fill: C.bg });
    const counts = Math.floor((servo ? t * 18 : motorAng) / TAU * 4096) % 1000000;
    label(ctx, `${counts} counts`, 90, y - 118, C, { mono: true, size: 11, color: C.accent });
    // brake
    box(ctx, 160, y - 30, 46, 60, C, { fill: servo ? C.panel : C.danger, text: "Brake", tcolor: servo ? C.ink : "#fff", size: 11 });
    label(ctx, servo ? "released" : "CLAMPED", 183, y + 44, C, { size: 10.5, color: servo ? C.muted : C.danger, w: 600 });
    // reducer
    const ratio = 100;
    ctx.strokeStyle = C.line; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(206, y); ctx.lineTo(250, y); ctx.stroke();
    gear(ctx, 270, y, 22, 10, motorAng, C.accentSoft, C.accent);
    gear(ctx, 340, y, 58, 40, -motorAng * 22 / 58 / 2.2, C.panel, C.muted);
    label(ctx, "Reducer (gearbox)", 310, y + 82, C, { w: 600 });
    label(ctx, `1 : ${ratio} — slower, ${ratio}× more torque`, 310, y + 100, C, { size: 11, color: C.muted });
    // arm link turning slowly
    const linkAng = -0.6 + Math.sin((servo ? t : 6.5) * 0.18) * 0.5;
    ctx.save(); ctx.translate(470, y); ctx.rotate(linkAng);
    ctx.fillStyle = C.accent; ctx.globalAlpha = 0.85; ctx.fillRect(-14, -14, 190, 28); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fillStyle = C.ink; ctx.fill(); ctx.restore();
    label(ctx, "Arm link (axis output)", 520, y + 82, C, { w: 600 });
    ctx.strokeStyle = C.line; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(398, y); ctx.lineTo(448, y); ctx.stroke();
    label(ctx, servo ? "Servo ON: the amplifier drives the motor, the encoder reports position back (closed loop)." : "Servo OFF (E-stop or alarm): power is cut and the brake holds the arm so it cannot drop.", W / 2, H - 24, C, { size: 12.5, color: servo ? C.ink : C.danger, w: 500 });
  };

  // ---------- controller block diagram ----------
  A.controller = (ctx, t, W, H, C) => {
    const b = {
      mains: [20, 30, 120, 52, "Mains 400 V", "3-phase supply"], psu: [180, 30, 140, 52, "Power supply", "DC bus"],
      amp: [360, 30, 150, 52, "Servo amplifiers", "one per axis"], mot: [550, 30, 120, 52, "Motors J1–J6", "+ encoders"],
      cpu: [180, 140, 140, 60, "Main CPU", "programs, motion"], tp: [20, 140, 120, 60, "Teach pendant", ""],
      io: [360, 140, 150, 60, "I/O board", "DI / DO / UI / UO"], plc: [550, 140, 120, 60, "Cell PLC", "and sensors"],
      saf: [180, 250, 140, 56, "Safety circuit", "dual channel"], es: [20, 250, 120, 56, "E-stops, fence", "light curtain"],
      bat: [360, 250, 150, 56, "Battery", "keeps encoder counts"], ps2: [550, 250, 120, 56, "Weld power source", "via I/O"],
    };
    const sc = Math.min(1, W / 700);
    ctx.save(); ctx.scale(sc, sc);
    const c = (k) => [b[k][0] + b[k][2] / 2, b[k][1] + b[k][3] / 2];
    const links = [["mains", "psu"], ["psu", "amp"], ["amp", "mot"], ["mot", "amp", 1], ["cpu", "amp"], ["tp", "cpu"], ["cpu", "tp", 1], ["cpu", "io"], ["io", "plc"], ["plc", "io", 1], ["es", "saf"], ["saf", "amp"], ["bat", "mot"], ["io", "ps2"]];
    links.forEach(([a, z, back], i) => {
      const [x1, y1] = c(a), [x2, y2] = c(z);
      ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const f = ((t * 0.5 + i * 0.13) % 1);
      pulse(ctx, x1, y1 + (back ? 6 : 0), x2, y2 + (back ? 6 : 0), f, a === "saf" || a === "es" ? C.danger : a === "mains" || a === "psu" ? C.warn : C.accent);
    });
    for (const k in b) { const [x, y, w, h, tx, sub] = b[k]; box(ctx, x, y, w, h, C, { text: tx, sub }); }
    ctx.restore();
    label(ctx, "Amber = power   Teal = data and signals   Red = safety chain", W / 2, H - 16, C, { size: 11.5, color: C.muted });
  };

  // ---------- 3-position enabling switch ----------
  A.enable3 = (ctx, t, W, H, C) => {
    const ph = Math.floor((t % 9) / 3); // 0 released, 1 middle, 2 squeezed
    const names = ["Released", "Middle: ENABLED", "Squeezed hard: STOP"];
    const cols = [C.danger, C.ok, C.danger];
    const cx = W * 0.28, cy = H * 0.5;
    ctx.fillStyle = C.panel; ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(cx - 50, cy - 90, 100, 180, 20); ctx.fill(); ctx.stroke();
    const travel = [0, 22, 44][ph];
    ctx.fillStyle = cols[ph]; ctx.beginPath(); ctx.roundRect(cx + 46 - travel, cy - 50, 26, 100, 8); ctx.fill();
    label(ctx, "Enabling switch", cx, cy - 110, C, { w: 600 });
    for (let i = 0; i < 3; i++) label(ctx, ["0", "1", "2"][i] + " " + ["released", "middle", "squeezed"][i], cx + 120, cy - 30 + i * 30, C, { align: "left", size: 12, color: i === ph ? cols[i] : C.muted, w: i === ph ? 700 : 400 });
    label(ctx, names[ph], W * 0.28, H - 26, C, { size: 14, w: 700, color: cols[ph] });
    // tiny robot that only moves in the middle position
    const rx = W * 0.72, ry = H * 0.72;
    const a = ph === 1 ? Math.sin(t * 2) * 0.6 : 0;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 8; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx, ry - 70); ctx.lineTo(rx + 70 * Math.cos(-0.5 + a), ry - 70 + 70 * Math.sin(-0.5 + a)); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.fillRect(rx - 30, ry, 60, 10);
    label(ctx, ph === 1 ? "Robot may move" : "Robot stopped (SRVO-003 if TP is ON)", rx, ry + 30, C, { size: 12, color: ph === 1 ? C.ok : C.danger, w: 600 });
  };

  // ---------- I/O signal types ----------
  A.io = (ctx, t, W, H, C) => {
    const rx = W * 0.62, rw = W * 0.3, top = 26;
    box(ctx, 20, top, W * 0.28, H - 60, C, { fill: C.bg });
    label(ctx, "Outside world", 20 + W * 0.14, top + 14, C, { w: 700 });
    box(ctx, rx, top, rw, H - 60, C, { fill: C.bg });
    label(ctx, "Robot controller", rx + rw / 2, top + 14, C, { w: 700 });
    const rows = [
      ["DI", "Digital input", "sensor → robot", 1], ["DO", "Digital output", "robot → valve/lamp", -1], ["UI", "User/system input", "PLC start, hold", 1],
      ["UO", "User/system output", "robot ready, fault", -1], ["RI/RO", "Robot I/O at the wrist", "torch, gripper", 0], ["AI/AO", "Analog", "0–10 V, 4–20 mA", 2], ["GI/GO", "Group", "8 bits = number", 3],
    ];
    const step = (H - 100) / rows.length;
    rows.forEach(([code, name, ex, dir], i) => {
      const y = top + 44 + i * step;
      label(ctx, code, 40, y, C, { align: "left", mono: true, size: 13, color: C.accent });
      label(ctx, ex, 100, y, C, { align: "left", size: 11.5, color: C.muted });
      label(ctx, name, rx + 14, y, C, { align: "left", size: 12 });
      const x1 = 20 + W * 0.28, x2 = rx;
      ctx.strokeStyle = C.line; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      const f = (t * 0.6 + i * 0.17) % 1;
      if (dir === 1) pulse(ctx, x1, y, x2, y, f, C.accent);
      else if (dir === -1) pulse(ctx, x2, y, x1, y, f, C.warn);
      else if (dir === 0) { pulse(ctx, x1, y, x2, y, f, C.accent); pulse(ctx, x2, y, x1, y, (f + 0.5) % 1, C.warn); }
      else if (dir === 2) { ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.beginPath(); for (let x = x1; x < x2; x += 3) ctx.lineTo(x, y + 6 * Math.sin((x - t * 80) / 14)); ctx.stroke(); }
      else { for (let b = 0; b < 8; b++) { const on = ((Math.floor(t * 2) >> b) & 1) === 1; ctx.fillStyle = on ? C.accent : C.panel; ctx.strokeStyle = C.line; ctx.fillRect(x1 + 10 + b * 14, y - 5, 10, 10); ctx.strokeRect(x1 + 10 + b * 14, y - 5, 10, 10); } label(ctx, `= ${Math.floor(t * 2) % 256}`, x1 + 130, y, C, { align: "left", mono: true, size: 11 }); }
    });
    label(ctx, "Teal: into the robot   Amber: out of the robot", W / 2, H - 14, C, { size: 11.5, color: C.muted });
  };

  // ---------- PLC scan cycle + one rung ----------
  A.plcscan = (ctx, t, W, H, C) => {
    const cx = W * 0.33, cy = H * 0.46, r = Math.min(W * 0.11, H * 0.28);
    const steps = ["1. Read inputs", "2. Solve logic", "3. Write outputs", "4. Housekeeping"];
    const k = Math.floor((t * 1.2) % 4);
    steps.forEach((s, i) => {
      const a = -Math.PI / 2 + i * TAU / 4;
      ctx.fillStyle = i === k ? C.accent : C.panel; ctx.strokeStyle = C.line;
      ctx.beginPath(); ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 30, 0, TAU); ctx.fill(); ctx.stroke();
      const lx = cx + r * Math.cos(a), ly = cy + r * Math.sin(a);
      const dx = Math.cos(a) > 0.5 ? 38 : Math.cos(a) < -0.5 ? -38 : 0, dy = Math.sin(a) > 0.5 ? 44 : Math.sin(a) < -0.5 ? -44 : 0;
      label(ctx, s, lx + dx, ly + dy, C, { size: 11.5, w: i === k ? 700 : 500, align: dx > 0 ? "left" : dx < 0 ? "right" : "center" });
    });
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    label(ctx, "Scan ≈ 10–20 ms", cx, cy, C, { size: 12, color: C.muted });
    // rung: start button -> motor coil, with a scan delay
    const x0 = W * 0.6, x1 = W - 20, y = H * 0.4;
    const pressed = (t % 4) > 1.2 && (t % 4) < 3.2;
    const scans = Math.floor(t * 1.2);
    const coil = (t % 4) > 1.2 + 0.8 && (t % 4) < 3.2 + 0.8;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0, y - 50); ctx.lineTo(x0, y + 50); ctx.moveTo(x1, y - 50); ctx.lineTo(x1, y + 50); ctx.stroke();
    const cxA = x0 + (x1 - x0) * 0.3, cxB = x0 + (x1 - x0) * 0.75;
    ctx.strokeStyle = pressed ? C.ok : C.line; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(cxA - 10, y); ctx.moveTo(cxA - 10, y - 14); ctx.lineTo(cxA - 10, y + 14); ctx.moveTo(cxA + 10, y - 14); ctx.lineTo(cxA + 10, y + 14); ctx.stroke();
    ctx.strokeStyle = pressed ? C.ok : C.line; ctx.beginPath(); ctx.moveTo(cxA + 10, y); ctx.lineTo(cxB - 16, y); ctx.stroke();
    ctx.strokeStyle = coil ? C.ok : C.line; ctx.beginPath(); ctx.arc(cxB, y, 16, 0.5, TAU - 0.5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cxB + 16, y); ctx.lineTo(x1, y); ctx.stroke();
    label(ctx, "X5 START PB", cxA, y - 28, C, { size: 11, mono: true });
    label(ctx, "Y1 START", cxB, y - 28, C, { size: 11, mono: true });
    label(ctx, pressed ? "Button pressed" : "Button released", cxA, y + 32, C, { size: 11.5, color: pressed ? C.ok : C.muted });
    label(ctx, coil ? "Output ON" : "Output OFF", cxB, y + 32, C, { size: 11.5, color: coil ? C.ok : C.muted });
    label(ctx, "The output only changes on the next scan after the input changes.", W / 2, H - 30, C, { size: 12 });
    label(ctx, `scan #${scans}`, W / 2, H - 12, C, { size: 11, mono: true, color: C.muted });
  };

  // ---------- handshake timing diagram ----------
  A.handshake = (ctx, t, W, H, C) => {
    const sig = [
      ["PLC → DI[2] CLAMP OK", [[1, 9]]], ["PLC → START (UI)", [[2, 2.6]]], ["Robot DO[1] IN CYCLE", [[2.5, 8.3]]],
      ["Arc detect DI[4]", [[4.2, 7.2]]], ["Robot DO[2] WELD DONE", [[8.3, 9.3]]], ["PLC unclamp", [[9.3, 10]]],
    ];
    const L = 170, R = W - 20, T = 26, rowH = (H - 70) / sig.length, Tmax = 10.5;
    const now = (t * 0.9) % Tmax;
    const X = (s) => L + (s / Tmax) * (R - L);
    sig.forEach(([name, hi], i) => {
      const y0 = T + i * rowH + rowH * 0.75, y1 = T + i * rowH + rowH * 0.25;
      label(ctx, name, 8, (y0 + y1) / 2, C, { align: "left", size: 11.5 });
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(L, y0);
      let x = L;
      for (const [a, b] of hi) { ctx.lineTo(X(a), y0); ctx.lineTo(X(a), y1); ctx.lineTo(X(Math.min(b, now)), y1); if (b <= now) { ctx.lineTo(X(b), y0); } x = X(Math.min(b, now)); if (a > now) break; }
      if (!hi.some(([a, b]) => now > a && now < b)) ctx.lineTo(X(now), y0);
      ctx.stroke();
    });
    ctx.strokeStyle = C.warn; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(now), T); ctx.lineTo(X(now), H - 40); ctx.stroke(); ctx.setLineDash([]);
    const ev = [[1, "Operator presses CLAMP: PLC confirms clamp to the robot"], [2, "Operator presses START: PLC sends start"], [2.5, "Robot answers IN CYCLE, so the PLC drops START"], [4.2, "Arc lit: the power source reports arc detect"], [7.2, "Arc End: crater fill, burnback"], [8.3, "Robot pulses WELD DONE and goes home"], [9.3, "PLC unclamps: unload the part"]];
    const cur = ev.filter((e) => e[0] <= now).pop();
    label(ctx, cur ? cur[1] : "Waiting for the operator", W / 2, H - 18, C, { size: 12.5, w: 600 });
  };

  // ---------- anatomy of a TP line ----------
  A.tpline = (ctx, t, W, H, C) => {
    const parts = [
      ["12:", "Line number. The pendant numbers lines for you."],
      ["L", "Motion type: J joint, L linear, C circular."],
      ["P[3:WELD START]", "Position 3. [ ] holds an index; text after : is a comment."],
      ["150mm/sec", "Speed: mm/sec for L and C, % for J."],
      ["FINE", "Termination: FINE stops exactly; CNT0–100 rounds the corner."],
      [";", "End of the instruction."],
    ];
    const k = Math.floor((t * 0.45) % parts.length);
    ctx.font = mono(Math.min(22, W / 26));
    const gap = 12;
    const widths = parts.map(([s]) => ctx.measureText(s).width);
    let x = (W - widths.reduce((a, b) => a + b + gap, -gap)) / 2;
    const y = H * 0.38;
    parts.forEach(([s], i) => {
      ctx.fillStyle = i === k ? C.accentSoft : "transparent";
      ctx.fillRect(x - 4, y - 18, widths[i] + 8, 36);
      ctx.fillStyle = i === k ? C.accent : C.ink; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(s, x, y);
      if (i === k) { arrow(ctx, x + widths[i] / 2, y + 44, x + widths[i] / 2, y + 22, C, C.accent); }
      x += widths[i] + gap;
    });
    label(ctx, parts[k][1], W / 2, y + 70, C, { size: 14, w: 600 });
    label(ctx, "Brackets: [ ] = which register/point/signal.  ( ) = grouping or time, e.g. WAIT 0.50(sec).", W / 2, H - 40, C, { size: 12, color: C.muted });
    label(ctx, "Colon : inside [ ] starts a comment.   ! starts a comment line.   % = percent of max speed.", W / 2, H - 20, C, { size: 12, color: C.muted });
  };

  // ---------- FINE vs CNT ----------
  A.finecnt = (ctx, t, W, H, C) => {
    const half = W / 2;
    const path = (ox, cnt) => {
      const A0 = [ox + 30, H * 0.65], B = [ox + half * 0.5, H * 0.2], Cc = [ox + half - 30, H * 0.65];
      ctx.strokeStyle = C.line; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(...A0); ctx.lineTo(...B); ctx.lineTo(...Cc); ctx.stroke(); ctx.setLineDash([]);
      const f = (t * 0.35) % 1;
      let p, v;
      if (!cnt) { const u = f < 0.5 ? f * 2 : (f - 0.5) * 2; const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u); const a = f < 0.5 ? A0 : B, b = f < 0.5 ? B : Cc; p = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e]; v = Math.sin(u * Math.PI); }
      else { const s = f; const q = (1 - s) * (1 - s), r = 2 * (1 - s) * s, w = s * s; p = [q * A0[0] + r * B[0] * 0.92 + r * 0.08 * (A0[0] + Cc[0]) / 2 + w * Cc[0], q * A0[1] + r * (B[1] + 50) + w * Cc[1]]; v = 0.9 + 0.1 * Math.sin(s * Math.PI); }
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2.5; ctx.beginPath();
      if (!cnt) { ctx.moveTo(...A0); ctx.lineTo(...B); ctx.lineTo(...Cc); } else { ctx.moveTo(...A0); ctx.quadraticCurveTo(B[0], B[1] + 50, Cc[0], Cc[1]); }
      ctx.stroke();
      ctx.fillStyle = C.warn; ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, TAU); ctx.fill();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(B[0], B[1], 4, 0, TAU); ctx.fill();
      label(ctx, cnt ? "CNT100: corner rounded, speed stays up" : "FINE: stops exactly on the point", ox + half / 2, H * 0.08, C, { w: 700 });
      // speed bar
      ctx.fillStyle = C.panel; ctx.fillRect(ox + 40, H - 34, half - 80, 10);
      ctx.fillStyle = v < 0.15 ? C.danger : C.ok; ctx.fillRect(ox + 40, H - 34, (half - 80) * Math.max(0.02, v), 10);
      label(ctx, "speed", ox + 20, H - 29, C, { size: 10.5, color: C.muted });
    };
    path(0, false); path(half, true);
  };

  // ---------- GMAW process cross-section ----------
  A.gmaw = (ctx, t, W, H, C) => {
    const cx = W * 0.42, base = H * 0.78;
    // base metal moving left (travel)
    ctx.fillStyle = "#8d969e"; ctx.fillRect(0, base, W, H - base);
    const off = (t * 30) % 40;
    ctx.strokeStyle = "rgba(0,0,0,0.15)"; for (let x = -off; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, base + 5); ctx.lineTo(x + 20, H); ctx.stroke(); }
    // solidified bead behind (to the right as metal moves left) and pool
    ctx.fillStyle = "#b9a98d"; ctx.beginPath(); ctx.ellipse(cx + 120, base, 120, 14, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = "#ffb347"; ctx.beginPath(); ctx.ellipse(cx + 6, base, 30, 11, 0, Math.PI, TAU); ctx.fill();
    // gas shield
    for (let i = 0; i < 14; i++) {
      const y = H * 0.32 + ((t * 70 + i * 23) % (base - H * 0.32));
      const spread = (y - H * 0.32) / (base - H * 0.32);
      ctx.fillStyle = "rgba(91,170,255,0.35)";
      ctx.beginPath(); ctx.arc(cx - 26 - spread * 30 + (i % 2) * 52 + spread * 60 * (i % 2), y, 3, 0, TAU); ctx.fill();
    }
    // nozzle + contact tip
    ctx.fillStyle = "#c27a3f"; ctx.beginPath(); ctx.moveTo(cx - 40, H * 0.08); ctx.lineTo(cx + 40, H * 0.08); ctx.lineTo(cx + 26, H * 0.36); ctx.lineTo(cx - 26, H * 0.36); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#e0a96d"; ctx.fillRect(cx - 7, H * 0.12, 14, H * 0.26);
    // wire
    const tipY = H * 0.38, arcTop = base - 34;
    ctx.strokeStyle = "#d8dde2"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, H * 0.02); ctx.lineTo(cx, arcTop); ctx.stroke();
    // arc
    const fl = 0.7 + Math.random() * 0.3;
    const g = ctx.createRadialGradient(cx, arcTop + 14, 2, cx, arcTop + 14, 46 * fl);
    g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.35, "rgba(160,200,255,0.6)"); g.addColorStop(1, "rgba(160,200,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, arcTop + 14, 46 * fl, 0, TAU); ctx.fill();
    // droplets
    for (let i = 0; i < 3; i++) { const f = (t * 3 + i / 3) % 1; ctx.fillStyle = "#ffcf6e"; ctx.beginPath(); ctx.arc(cx, arcTop + f * 34, 4, 0, TAU); ctx.fill(); }
    // labels
    const L = (txt, x, y, tx, ty) => { arrow(ctx, tx, ty, x, y, C, C.muted, 1); label(ctx, txt, tx, ty - 9, C, { size: 11.5, align: tx < cx ? "right" : "left" }); };
    L("Wire (filler + electrode)", cx + 3, H * 0.06, cx + 120, H * 0.07);
    L("Contact tip: current enters the wire", cx + 7, H * 0.25, cx + 150, H * 0.24);
    L("Gas nozzle", cx - 30, H * 0.2, cx - 140, H * 0.18);
    L("Shielding gas (Ar/CO₂)", cx - 50, H * 0.55, cx - 150, H * 0.5);
    L("Arc ≈ 6000 °C", cx + 20, arcTop + 10, cx + 150, arcTop - 30);
    L("Weld pool", cx + 20, base - 6, cx + 160, base - 50);
    L("Bead (solidified)", cx + 150, base - 8, cx + 230, base - 70);
    label(ctx, "← travel", 60, base + 22, C, { size: 12, color: "#fff", w: 600 });
    // stickout bracket
    ctx.strokeStyle = C.warn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx - 60, tipY); ctx.lineTo(cx - 60, base); ctx.stroke();
    label(ctx, "CTWD ~15–20 mm", cx - 66, (tipY + base) / 2, C, { size: 11, align: "right", color: C.warn, w: 600 });
  };

  // ---------- torch angles and lead on a rotating part ----------
  A.angles = (ctx, t, W, H, C) => {
    // left: travel angle on flat plate
    const lx = W * 0.22, ly = H * 0.7;
    ctx.fillStyle = C.panel; ctx.fillRect(lx - 120, ly, 240, 18);
    const tr = 12 * DEG;
    ctx.save(); ctx.translate(lx, ly); ctx.rotate(-tr);
    ctx.fillStyle = "#c27a3f"; ctx.fillRect(-9, -130, 18, 90); ctx.fillStyle = C.ink; ctx.fillRect(-14, -200, 28, 74);
    ctx.restore();
    ctx.strokeStyle = C.muted; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx, ly - 200); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, "Travel (push) angle 5–15°", lx, 22, C, { w: 700 });
    arrow(ctx, lx - 60, ly + 40, lx + 60, ly + 40, C, C.accent);
    label(ctx, "travel", lx, ly + 54, C, { size: 11, color: C.muted });
    // right: rotating cylinder with lead angle
    const cx = W * 0.7, cy = H * 0.66, R = Math.min(W, H) * 0.18;
    const rot = t * 0.8;
    ctx.fillStyle = C.panel; ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 8; i++) { const a = rot + i * TAU / 8; ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(cx + R * 0.8 * Math.cos(a), cy + R * 0.8 * Math.sin(a)); ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a)); ctx.stroke(); }
    // bead growing around
    ctx.strokeStyle = "#c9b9a0"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, R + 3, -Math.PI / 2 - 0.17, -Math.PI / 2 - 0.17 + ((t * 0.8) % TAU)); ctx.stroke();
    const lead = -10 * DEG;
    const tx = cx + (R + 6) * Math.sin(lead), ty = cy - (R + 6) * Math.cos(lead);
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(lead); ctx.fillStyle = "#c27a3f"; ctx.fillRect(-7, -80, 14, 70); ctx.fillStyle = C.ink; ctx.fillRect(-11, -140, 22, 60); ctx.restore();
    const g = ctx.createRadialGradient(tx, ty, 1, tx, ty, 16); g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(1, "rgba(160,200,255,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx, ty, 16, 0, TAU); ctx.fill();
    ctx.strokeStyle = C.muted; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - R - 60); ctx.stroke(); ctx.setLineDash([]);
    arrow(ctx, cx + R + 20, cy + 20, cx + R + 20, cy - 30, C, C.accent);
    label(ctx, "rotation", cx + R + 26, cy + 34, C, { size: 11, color: C.muted, align: "left" });
    label(ctx, "Torch 10° before top dead centre", cx, 22, C, { w: 700 });
    label(ctx, "The pool freezes as it rolls over the top", cx, H - 20, C, { size: 12, color: C.muted });
  };

  // ---------- hydraulic cylinder parts ----------
  A.cylinder = (ctx, t, W, H, C) => {
    const f = Math.min(1, Math.max(0, (Math.sin(t * 0.7) + 1) / 2 * 1.4 - 0.2)); // 0 assembled .. 1 exploded
    const cy = H * 0.34, s = Math.min(W / 760, 1);
    const ex = (k) => k * 40 * f * s;
    const part = (x, w, h, col, name, k, below) => {
      const X = x * s + ex(k), Y = cy - h * s / 2;
      ctx.fillStyle = col; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.fillRect(X, Y, w * s, h * s); ctx.strokeRect(X, Y, w * s, h * s);
      label(ctx, name, X + w * s / 2, below ? cy + h * s / 2 + 16 : cy - h * s / 2 - 12, C, { size: 11.5 });
    };
    part(80, 50, 120, "#8c949b", "Cap end (clevis)", -1.5, false);
    part(130, 40, 130, "#a0a8af", "End cover", -0.8, true);
    part(170, 330, 110, "#b8c0c7", "Barrel (tube)", 0, false);
    part(330, 50, 96, "#6b7a88", "Piston", 0.5, true);
    part(370, 250, 40, "#d8dde2", "Rod (chrome)", 1.3, false);
    part(480, 55, 112, "#a0a8af", "Gland", 0.9, true);
    // weld joint highlight
    const jx = 170 * s + ex(0);
    ctx.strokeStyle = C.danger; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(jx, cy - 60 * s); ctx.lineTo(jx, cy + 60 * s); ctx.stroke();
    label(ctx, "Circumferential weld: end cover to barrel", jx, cy + 92 * s, C, { size: 12, w: 700, color: C.danger });
    // joint prep detail
    const dx = W - 200, dy = H - 52;
    label(ctx, "Joint preparation (section)", dx + 80, dy - 50, C, { size: 11.5, w: 600 });
    ctx.fillStyle = "#a0a8af"; ctx.beginPath(); ctx.moveTo(dx, dy - 30); ctx.lineTo(dx + 70, dy - 30); ctx.lineTo(dx + 80, dy); ctx.lineTo(dx + 76, dy + 20); ctx.lineTo(dx, dy + 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#b8c0c7"; ctx.beginPath(); ctx.moveTo(dx + 170, dy - 30); ctx.lineTo(dx + 100, dy - 30); ctx.lineTo(dx + 88, dy); ctx.lineTo(dx + 84, dy + 20); ctx.lineTo(dx + 170, dy + 20); ctx.closePath(); ctx.fill();
    label(ctx, "J prep on both parts = U-groove, R3, 6.1 wide", dx + 85, dy + 38, C, { size: 10.5, color: C.muted });
  };

  // ---------- CEC to tube joint, Detail A of the drawing ----------
  // Both members carry a J prep; together they form a U-groove centred on the joint line.
  A.cecjoint = (ctx, t, W, H, C) => {
    const D = WELD.drawing, g = D.groove, k = 22, x0 = 340, yb = 336;
    const X = (y) => x0 + y * k, Y = (r) => yb - (r - 22.6) * k;
    const Ro = WELD.R, Rb = WELD.bore, Rc = D.counterbore / 2, cb = D.counterboreDepth;
    const root = Rb + g.land, rc = root + g.rootR, half = g.includedDeg / 2 * Math.PI / 180;
    const jp = (side) => { const p = [[root, 0]]; for (let i = 1; i <= 12; i++) { const a = (i / 12) * Math.PI / 2; p.push([rc - g.rootR * Math.cos(a), side * g.rootR * Math.sin(a)]); } p.push([Ro, side * (g.rootR + (Ro - rc) * Math.tan(half))]); return p; };
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([r, y], i) => (i ? ctx.lineTo(X(y), Y(r)) : ctx.moveTo(X(y), Y(r)))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.3; ctx.stroke(); };
    // section through the upper wall: CEC left, tube right
    poly([[22.6, -13], [Ro, -13], ...jp(-1).reverse(), [Rc - 0.08, 0], [Rc - 0.08, cb], [22.6, cb]], "#98a1a9");
    poly([[Rc, 0], ...jp(1), [Ro, 13], [Rb, 13], [Rb, cb], [Rc, cb]], "#b8c0c7");
    label(ctx, "CEC", X(-9), Y(27.4), C, { size: 13, w: 700 });
    label(ctx, "TUBE", X(9), Y(28.4), C, { size: 13, w: 700 });
    label(ctx, "J prep", X(-6), Y(29.9), C, { size: 10.5, color: C.muted });
    label(ctx, "J prep", X(6), Y(29.9), C, { size: 10.5, color: C.muted });
    // one pass fills the U from the root up and leaves a crown
    const cyc = t % 9, f = Math.min(1, Math.max(0, (cyc - 1) / 5.5));
    const level = root - 0.4 + f * (g.depth + 1.6);
    if (f > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, Y(level), W, H); ctx.clip();
      const fz = [...jp(-1).reverse(), ...jp(1).slice(1)].map(([r, y]) => [r - 0.35, y + Math.sign(y) * 0.4]);
      ctx.beginPath();
      fz.forEach(([r, y], i) => (i ? ctx.lineTo(X(y), Y(r)) : ctx.moveTo(X(y), Y(r))));
      ctx.lineTo(X(g.width / 2 + 0.9), Y(Ro)); ctx.quadraticCurveTo(X(0), Y(Ro + 2.6), X(-g.width / 2 - 0.9), Y(Ro));
      ctx.closePath(); ctx.fillStyle = "#c9a76a"; ctx.fill(); ctx.strokeStyle = "#8a6a35"; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    // torch on the centre line, tipped 5° toward the heavier CEC
    const tipY = Y(Math.min(Ro + 0.6, level) + 0.9), tipX = X(0);
    ctx.save(); ctx.translate(tipX, tipY); ctx.rotate(-5 * Math.PI / 180);
    ctx.fillStyle = "#3b3f44"; ctx.fillRect(-15, -150, 30, 96); ctx.fillStyle = "#c08a3e"; ctx.fillRect(-6, -54, 12, 24);
    ctx.strokeStyle = "#9aa3ab"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(0, -3); ctx.stroke();
    ctx.restore();
    if (f > 0 && f < 1) { const gl = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 26); gl.addColorStop(0, "rgba(255,255,255,0.95)"); gl.addColorStop(0.4, "rgba(160,200,255,0.6)"); gl.addColorStop(1, "rgba(160,200,255,0)"); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(tipX, tipY, 26, 0, TAU); ctx.fill(); }
    // dimensions from Detail A
    const ac = C.accent, dimTxt = (txt, x, y, align = "center") => label(ctx, txt, x, y, C, { size: 12, w: 700, color: ac, align });
    const dimV = (x, r1, r2, txt, side = -1) => { arrow(ctx, x, Y((r1 + r2) / 2), x, Y(r2), C, ac, 1.2); arrow(ctx, x, Y((r1 + r2) / 2), x, Y(r1), C, ac, 1.2); dimTxt(txt, x + side * 8, Y((r1 + r2) / 2), side < 0 ? "right" : "left"); };
    ctx.setLineDash([3, 3]); ctx.strokeStyle = ac; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(-11), Y(root)); ctx.lineTo(X(-g.rootR * 0.3), Y(root)); ctx.moveTo(X(0), Y(root - 1.2)); ctx.lineTo(X(0), Y(Ro + 4.2)); ctx.stroke(); ctx.setLineDash([]);
    dimV(X(-10.5), root, Ro, `${g.depth.toFixed(1)}`);
    dimV(X(-10.5), Rb, root, `land ${g.land}`);
    const ty = Y(Ro) - 30; arrow(ctx, X(0) - 50, ty, X(-g.width / 2), ty, C, ac, 1.2); arrow(ctx, X(0) + 50, ty, X(g.width / 2), ty, C, ac, 1.2);
    ctx.strokeStyle = ac; ctx.beginPath(); ctx.moveTo(X(-g.width / 2), Y(Ro) - 3); ctx.lineTo(X(-g.width / 2), ty - 5); ctx.moveTo(X(g.width / 2), Y(Ro) - 3); ctx.lineTo(X(g.width / 2), ty - 5); ctx.stroke();
    dimTxt(`${g.width}`, X(g.width / 2) + 40, ty - 1, "left");
    ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(X(0), Y(rc), 2.5, 0, TAU); ctx.fill();
    arrow(ctx, X(0), Y(rc), X(g.rootR * 0.7071), Y(rc - g.rootR * 0.7071), C, ac, 1.2); dimTxt(`R${g.rootR}`, X(2.4) + 6, Y(rc - 2.3) + 10, "left");
    dimTxt(`${g.includedDeg}° incl. (2° each wall)`, X(g.width / 2) + 12, Y(Ro - 1), "left");
    label(ctx, `Ø${D.counterbore} counterbore + CEC spigot`, X(7.5), Y(23.1), C, { size: 11, color: C.muted });
    dimV(X(12.2), Rb, Ro, `wall ${(Ro - Rb).toFixed(1)}`, 1);
    label(ctx, `Detail A · U-groove (J prep on tube and CEC)`, 16, 20, C, { size: 13, w: 700, align: "left" });
    label(ctx, `Tube Ø${D.tubeOD} × Ø${D.bore} × ${D.tubeL} · CEC Ø${D.tubeOD}`, 16, 40, C, { size: 11.5, color: C.muted, align: "left" });
    const s1 = WELD.schedules[1];
    label(ctx, "1 pass · Ø1.2 ER70S-6 · 82Ar/18CO2", W - 14, 20, C, { size: 11.5, w: 600, align: "right" });
    label(ctx, `${s1.volts} V · ${s1.amps} A · ${s1.wfs} m/min · ${s1.speed} mm/s`, W - 14, 38, C, { size: 11.5, align: "right", mono: true });
    label(ctx, `Part turns ${WELD.weldTurn}° (${D.overlapDeg}° overlap)`, W - 14, 56, C, { size: 11.5, align: "right", color: C.muted });
  };

  // ---------- weld defects ----------
  A.defects = (ctx, t, W, H, C) => {
    const list = [
      ["Good", "full fusion, smooth toes"], ["Porosity", "gas holes: no/poor gas, draughts, dirt"], ["Undercut", "groove at the toe: too fast, too hot, off angle"],
      ["Lack of fusion", "not melted in: off seam, too fast, cold"], ["Burn-through", "too slow, too hot, gap too big"], ["Excess spatter", "wrong volts/wire speed, long stickout"],
    ];
    const k = Math.floor((t * 0.5) % list.length);
    const cols = 3, cw = W / cols, ch = (H - 30) / 2;
    list.forEach(([n, why], i) => {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      ctx.fillStyle = i === k ? C.accentSoft : "transparent"; ctx.fillRect(x + 4, y + 4, cw - 8, ch - 8);
      const bx = x + cw / 2, by = y + ch * 0.55;
      ctx.fillStyle = "#8d969e"; ctx.fillRect(bx - 70, by, 60, 30); ctx.fillRect(bx + 10, by, 60, 30);
      ctx.fillStyle = "#c9b9a0";
      ctx.beginPath();
      if (i === 4) { ctx.ellipse(bx, by + 30, 14, 26, 0, 0, Math.PI); ctx.fill(); }
      else { ctx.ellipse(bx + (i === 3 ? 18 : 0), by, i === 3 ? 22 : 30, i === 2 ? 8 : 12, 0, Math.PI, TAU); ctx.fill(); ctx.fillRect(bx - 10 + (i === 3 ? 18 : 0), by, 20, 30); }
      if (i === 1) { ctx.fillStyle = "#333"; for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.arc(bx - 14 + j * 7, by - 3 + (j % 2) * 8, 2.4, 0, TAU); ctx.fill(); } }
      if (i === 2) { ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(bx - 30, by, 6, 0, Math.PI); ctx.fill(); }
      if (i === 3) { ctx.strokeStyle = C.danger; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx - 10, by); ctx.lineTo(bx - 10, by + 30); ctx.stroke(); }
      if (i === 5) { ctx.fillStyle = "#c9b9a0"; for (let j = 0; j < 9; j++) { ctx.beginPath(); ctx.arc(bx - 60 + j * 15, by - 4 - (j % 3) * 3, 2.5, 0, TAU); ctx.fill(); } }
      label(ctx, n, bx, y + 22, C, { w: 700, size: 13, color: i === 0 ? C.ok : C.ink });
      label(ctx, why, bx, y + ch - 14, C, { size: 10.5, color: C.muted });
    });
  };

  // ---------- troubleshooting loop ----------
  A.trouble = (ctx, t, W, H, C) => {
    const steps = ["Observe", "Collect data", "Hypothesise", "Test", "Fix", "Verify", "Prevent"];
    const subs = ["What exactly happened? When?", "Alarm code, line, I/O, PLC, history", "List possible causes, likeliest first", "Change one thing, check the result", "Repair the root cause, not the symptom", "Run a full cycle, inspect the part", "Update checks, maintenance, training"];
    const k = Math.floor((t * 0.5) % steps.length);
    const cx = W / 2, cy = H / 2, rx = W * 0.38, ry = H * 0.36;
    steps.forEach((s, i) => {
      const a = -Math.PI / 2 + i * TAU / steps.length;
      const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
      const a2 = -Math.PI / 2 + (i + 1) * TAU / steps.length;
      arrow(ctx, x + 0.25 * (cx + rx * Math.cos(a2) - x), y + 0.25 * (cy + ry * Math.sin(a2) - y), x + 0.7 * (cx + rx * Math.cos(a2) - x), y + 0.7 * (cy + ry * Math.sin(a2) - y), C, C.line);
      box(ctx, x - 58, y - 18, 116, 36, C, { fill: i === k ? C.accent : C.panel, text: s, tcolor: i === k ? C.accentInk : C.ink, size: 12 });
    });
    label(ctx, steps[k], cx, cy - 10, C, { size: 16, w: 700, color: C.accent });
    label(ctx, subs[k], cx, cy + 14, C, { size: 12.5 });
  };

  return A;
})();

"use strict";
// Hydraulic cylinder welding cell: geometry, tools, weld schedules and the default TP programs.
// World frame = robot base, millimetres. The positioner turns the part about a horizontal axis along +Y.

const WELD = (() => {
  const T = (x, y, z) => ({ type: "pose", p: [x, y, z], R: Mat.I() });
  const torch = Pose.mul(Pose.mul(T(0, 0, 180), { type: "pose", p: [0, 0, 0], R: Mat.ry(30 * DEG) }), T(0, 0, 150));
  const axisC = [820, 0, 700];
  const R = 60, seamY = -300;
  const lead = -10; // torch sits 10 deg before top dead centre, so the puddle freezes as it rolls over the top
  const start = [axisC[0] + R * Math.sin(lead * DEG), seamY, axisC[2] + R * Math.cos(lead * DEG)];
  const ori = [-170, 10, 180]; // W, P, R: torch tipped 10 deg toward the thicker cap, 10 deg push angle
  const Rw = Rot.fromFixedXYZ(...ori);
  const zt = Mat.col(Rw, 2);
  const back = (d) => Vec.sub(start, Vec.scale(zt, d));
  return {
    tools: [
      { name: "Flange (UT 0)", tcp: Pose.identity() },
      { name: "Torch (UT 1)", tcp: torch },
    ],
    frames: [
      { name: "World (UF 0)", pose: Pose.identity() },
      { name: "Positioner (UF 1)", pose: T(axisC[0], axisC[1], axisC[2]) },
    ],
    axisC, R, seamY, tubeY1: 300, capT: 45, lugL: 90,
    leadDeg: lead,
    homeQ: [0, -25, -15, 0, 70, 0],
    tLimit: 250, // mm/s in T1
    schedules: [
      null,
      { name: "Root and fill", volts: 21.5, amps: 185, wfs: 8.5, speed: 9.0, gas: 15 },
      { name: "Cap pass", volts: 23.0, amps: 215, wfs: 10.0, speed: 11.0, gas: 15 },
      { name: "Tack weld", volts: 20.0, amps: 160, wfs: 7.0, speed: 8.0, gas: 15 },
    ],
    weaves: [null, { name: "Sine", amp: 2.5, freq: 1.5 }],
    pts: {
      approach: { p: back(80), o: ori },
      start: { p: start, o: ori },
      retract: { p: back(120), o: ori },
    },
  };
})();

// ---------------------------------------------------------------- TP program store
// A program keeps the text of its /MN lines (without numbers or ';') and its /POS data.
const TPStore = (() => {
  const pointText = (n, P) => {
    const out = [`P[${n}${P.comment ? `:"${P.comment}"` : ""}]{`, "   GP1:"];
    if (P.joint) {
      const j = P.joint;
      out.push(`\tUF : ${P.uf || 0}, UT : ${P.ut ?? 1},`);
      out.push(`\tJ1=  ${j[0].toFixed(3)} deg,\tJ2=  ${j[1].toFixed(3)} deg,\tJ3=  ${j[2].toFixed(3)} deg,`);
      out.push(`\tJ4=  ${j[3].toFixed(3)} deg,\tJ5=  ${j[4].toFixed(3)} deg,\tJ6=  ${j[5].toFixed(3)} deg`);
    } else {
      out.push(`\tUF : ${P.uf || 0}, UT : ${P.ut ?? 1},\t\tCONFIG : 'N U T, 0, 0, 0',`);
      out.push(`\tX = ${P.x.toFixed(3).padStart(10)}  mm,\tY = ${P.y.toFixed(3).padStart(10)}  mm,\tZ = ${P.z.toFixed(3).padStart(10)}  mm,`);
      out.push(`\tW = ${P.w.toFixed(3).padStart(10)} deg,\tP = ${P.p.toFixed(3).padStart(10)} deg,\tR = ${P.r.toFixed(3).padStart(10)} deg`);
    }
    if (P.e1 != null) out.push("   GP2:", `\tUF : ${P.uf || 0}, UT : ${P.ut ?? 1},`, `\tJ1=  ${P.e1.toFixed(3)} deg`);
    out.push("};");
    return out;
  };

  function serialize(progs) {
    // returns { text, map: {progName: [sourceLine of each /MN line]} }
    const L = [], map = {};
    for (const pg of progs) {
      L.push(`/PROG  ${pg.name}`, "/ATTR", `COMMENT\t\t= "${pg.comment || ""}";`, "/MN");
      map[pg.name] = [];
      pg.lines.forEach((s, i) => {
        map[pg.name].push(L.length + 1);
        const motion = /^[JLC]\s/.test(s);
        L.push(`${String(i + 1).padStart(4)}:${motion ? "" : "  "}${s}${s.endsWith(";") ? "" : " ;"}`);
      });
      L.push("/POS");
      for (const n of Object.keys(pg.points).map(Number).sort((a, b) => a - b)) L.push(...pointText(n, pg.points[n]));
      L.push("/END", "");
    }
    return { text: L.join("\n"), map };
  }

  function parseLS(text) {
    // light structural parse; full syntax checking is done by LANGS.fanuc.parse when running
    const progs = [];
    let cur = null, sec = null, buf = "";
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.trim();
      let m;
      if ((m = t.match(/^\/PROG\s+(\S+)/i))) { cur = { name: m[1].toUpperCase(), comment: "", lines: [], points: {} }; progs.push(cur); sec = "head"; continue; }
      if (!cur) continue;
      if ((m = t.match(/^COMMENT\s*=\s*"([^"]*)"/i))) { cur.comment = m[1]; continue; }
      if (/^\/MN/i.test(t)) { sec = "mn"; continue; }
      if (/^\/POS/i.test(t)) { sec = "pos"; continue; }
      if (/^\/END/i.test(t)) { sec = null; continue; }
      if (/^\/(ATTR|APPL)/i.test(t)) { sec = "head"; continue; }
      if (sec === "mn" && t) {
        if (t.startsWith(":")) { cur.lines[cur.lines.length - 1] += "\n" + t; continue; }
        cur.lines.push(t.replace(/^\d+\s*:\s?/, "").replace(/\s*;\s*$/, "").replace(/^\s+/, ""));
      }
      if (sec === "pos" && t) {
        buf += " " + t;
        if (/\}\s*;?\s*$/.test(t)) { const p = parsePoint(buf); if (p) cur.points[p.n] = p.P; buf = ""; }
      }
    }
    return progs;
  }
  function parsePoint(text) {
    const h = text.match(/P\[(\d+)(?:\s*:\s*"?([^"\]]*)"?)?\]\s*\{/i);
    if (!h) return null;
    const gp2At = text.search(/GP2\s*:/i);
    const g1 = gp2At >= 0 ? text.slice(0, gp2At) : text, g2 = gp2At >= 0 ? text.slice(gp2At) : "";
    const get = (s, k, u) => { const m = s.match(new RegExp(`\\b${k}\\s*=\\s*(-?[\\d.]+)\\s*${u}`, "i")); return m ? +m[1] : null; };
    const P = { comment: h[2] || "", uf: +((g1.match(/UF\s*:\s*(\d+)/i) || [])[1] || 0), ut: +((g1.match(/UT\s*:\s*(\d+)/i) || [])[1] ?? 1) };
    if (get(g1, "J1", "deg") !== null) P.joint = [1, 2, 3, 4, 5, 6].map((k) => get(g1, "J" + k, "deg") || 0);
    else Object.assign(P, { x: get(g1, "X", "mm") || 0, y: get(g1, "Y", "mm") || 0, z: get(g1, "Z", "mm") || 0, w: get(g1, "W", "deg") || 0, p: get(g1, "P", "deg") || 0, r: get(g1, "R", "deg") || 0 });
    const e = get(g2, "J1", "deg"); if (e !== null) P.e1 = e;
    return { n: +h[1], P };
  }

  const cart = (pt, extra) => Object.assign({ x: pt.p[0], y: pt.p[1], z: pt.p[2], w: pt.o[0], p: pt.o[1], r: pt.o[2], uf: 0, ut: 1 }, extra);
  function defaults() {
    return [
      {
        name: "CYL_WELD", comment: "Cap to tube weld",
        lines: [
          "!Hydraulic cylinder: cap end to tube",
          "UFRAME_NUM=0",
          "UTOOL_NUM=1",
          "DO[1:IN CYCLE]=ON",
          "J P[1:HOME] 40% FINE",
          "!Wait until the PLC confirms the clamp",
          "WAIT DI[2:CLAMP OK]=ON",
          "J P[2:APPROACH] 40% CNT50",
          "L P[3:WELD START] 150mm/sec FINE",
          "Arc Start[1]",
          "!Positioner turns 370 deg under the torch",
          "L P[4:WELD END] WELD_SPEED FINE",
          "Arc End[1]",
          "L P[5:RETRACT] 150mm/sec FINE",
          "J P[1:HOME] 40% FINE",
          "DO[1:IN CYCLE]=OFF",
          "DO[2:WELD DONE]=PULSE,1.0sec",
        ],
        points: {
          1: { comment: "HOME", joint: WELD.homeQ.slice(), uf: 0, ut: 1, e1: 0 },
          2: cart(WELD.pts.approach, { comment: "APPROACH", e1: 0 }),
          3: cart(WELD.pts.start, { comment: "WELD START", e1: 0 }),
          4: cart(WELD.pts.start, { comment: "WELD END", e1: 370 }),
          5: cart(WELD.pts.retract, { comment: "RETRACT", e1: 370 }),
        },
      },
      {
        name: "MY_WELD", comment: "Practice program",
        lines: ["!Your program: jog, then press F1 POINT", "UFRAME_NUM=0", "UTOOL_NUM=1"],
        points: {},
      },
    ];
  }
  return { serialize, parseLS, defaults, pointText };
})();

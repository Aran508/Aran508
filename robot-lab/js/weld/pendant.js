"use strict";
// iPendant-style teach pendant: key layout, explanations and the screen renderer.
// The behaviour behind each key lives in tp.js.

const TP_KEYS = {
  tpswitch: { label: "TP ON/OFF", group: "Switches", text: "Teach pendant enable switch (top left). ON: the pendant controls the robot. You can jog and run programs in T1 or T2, and the enabling switch must be held. OFF: the pendant only displays, and the robot can run in AUTO from the PLC." },
  estop: { label: "E-STOP", group: "Switches", text: "Emergency stop. It cuts power to the servo motors and the brakes clamp every axis (category 0/1 stop). Twist to release, then press RESET. Every person in the cell must know where every E-stop is." },
  deadman: { label: "Enabling switch", group: "Switches", text: "The deadman (enabling) switch on the back of the pendant has 3 positions: released = stop, middle = enabled, squeezed hard = stop (panic grip). In T1/T2 the robot only moves while you hold it in the middle. Releasing it gives SRVO-003." },
  prev: { label: "PREV", group: "Screens", text: "Go back to the previous screen." },
  next: { label: "NEXT", group: "Screens", text: "Show the next page of function-key labels (F1 to F5). On the edit screen, NEXT reveals [INST] and [EDCMD]." },
  f1: { label: "F1", group: "Function keys", text: "Function key 1. Its job is printed on the screen above it. In EDIT it is POINT: record the current robot position as a new motion line. SHIFT+F1 records with the last motion template." },
  f2: { label: "F2", group: "Function keys", text: "Function key 2. In EDIT (ArcTool) it is ARCSTRT, which inserts Arc Start[1]. On page 2 it is [EDCMD] (delete, copy, paste, undo)." },
  f3: { label: "F3", group: "Function keys", text: "Function key 3. In EDIT (ArcTool) it is WELD_PT, which records a point with WELD_SPEED. On the I/O screen it is SIMULATE for inputs." },
  f4: { label: "F4", group: "Function keys", text: "Function key 4. In EDIT it is ARCEND, which inserts Arc End[1]. On page 2 it is [CHOICE] for the selected field (FINE/CNT, ON/OFF, J/L). On I/O it is ON." },
  f5: { label: "F5", group: "Function keys", text: "Function key 5. In EDIT it is TOUCHUP. Hold SHIFT and press F5 to overwrite the point on the cursor line with the robot's current position. On I/O it is OFF." },
  shift: { label: "SHIFT", group: "Motion", text: "SHIFT (two keys, left and right). Hold it with a jog key to move the robot, with FWD/BWD to run a program, with F1/F5 to record or touch up, and with WELD ENBL/WIRE± to change weld state. Releasing SHIFT stops motion in T1/T2." },
  menu: { label: "MENU", group: "Screens", text: "Main menu: utilities, test cycle, manual functions, alarm, I/O, setup (frames), data, status and position. Choose with the arrows or a number, then ENTER." },
  select: { label: "SELECT", group: "Screens", text: "Program list. Choose which program is active, create a new one, or delete one. ENTER opens it in EDIT." },
  edit: { label: "EDIT", group: "Screens", text: "Opens the selected program for editing. The cursor line is where FWD starts and where new instructions are inserted." },
  data: { label: "DATA", group: "Screens", text: "Data screen: numeric registers R[ ] and weld schedules (volts, amps, travel speed). F1 [TYPE] switches between them." },
  fctn: { label: "FCTN", group: "Screens", text: "Function menu: ABORT (ALL) stops the program completely, CHANGE GROUP swaps robot and positioner, RELEASE WAIT skips a WAIT, UNSIM ALL I/O clears simulated inputs." },
  disp: { label: "DISP", group: "Screens", text: "Display: splits the screen so the current position shows under the program." },
  step: { label: "STEP", group: "Program", text: "Toggles step mode (STEP LED). In step mode every FWD press runs one line, which is how you test a new program safely." },
  up: { label: "↑", group: "Cursor", text: "Cursor up: previous line or item." },
  down: { label: "↓", group: "Cursor", text: "Cursor down: next line or item." },
  left: { label: "←", group: "Cursor", text: "Cursor left: previous field on the line (for example from speed to FINE)." },
  right: { label: "→", group: "Cursor", text: "Cursor right: next field on the line." },
  reset: { label: "RESET", group: "Program", text: "Clears alarms whose cause has gone away and turns the servos back on. If the cause is still there (E-stop pressed, deadman released) the alarm comes back immediately." },
  bksp: { label: "BACK SPACE", group: "Entry", text: "Deletes the last typed digit." },
  item: { label: "ITEM", group: "Entry", text: "Type a line number, then press ITEM to jump straight to that line." },
  enter: { label: "ENTER", group: "Entry", text: "Confirms a typed number, a menu choice, or opens the selected program." },
  n0: { label: "0", group: "Entry", text: "Number key." }, n1: { label: "1", group: "Entry", text: "Number key." }, n2: { label: "2", group: "Entry", text: "Number key." }, n3: { label: "3", group: "Entry", text: "Number key." }, n4: { label: "4", group: "Entry", text: "Number key." },
  n5: { label: "5", group: "Entry", text: "Number key." }, n6: { label: "6", group: "Entry", text: "Number key." }, n7: { label: "7", group: "Entry", text: "Number key." }, n8: { label: "8", group: "Entry", text: "Number key." }, n9: { label: "9", group: "Entry", text: "Number key." },
  dot: { label: ".", group: "Entry", text: "Decimal point." }, minus: { label: "−", group: "Entry", text: "Minus sign." },
  weld: { label: "WELD ENBL", group: "Arc welding", text: "Weld enable (ArcTool). SHIFT+WELD ENBL toggles it. When off, Arc Start lines run 'dry': the robot moves but no arc is struck. Always prove a new path dry first." },
  wirep: { label: "WIRE+", group: "Arc welding", text: "SHIFT+WIRE+ inches welding wire forward without gas or arc, for threading new wire or setting stickout." },
  wirem: { label: "WIRE−", group: "Arc welding", text: "SHIFT+WIRE− retracts wire." },
  otf: { label: "OTF", group: "Arc welding", text: "On-The-Fly: while welding, adjusts the active weld schedule (volts, amps, speed) and lets you write the change back. Use it to tune a weld in production." },
  group: { label: "GROUP", group: "Motion", text: "Switches the motion group: G1 is the robot, G2 is the positioner (external axis E1). With G2 selected, the J1 jog keys turn the part." },
  hold: { label: "HOLD", group: "Program", text: "Pauses the running program at once (controlled stop, servos stay on). FWD or Run continues from the same point." },
  fwd: { label: "FWD", group: "Program", text: "SHIFT+FWD runs the program forward from the cursor line (in step mode, one line per press). Only in T1/T2 with the pendant ON and the enabling switch held." },
  bwd: { label: "BWD", group: "Program", text: "SHIFT+BWD steps backward: the robot moves to the previous motion line's point. Handy for re-checking a path." },
  coord: { label: "COORD", group: "Motion", text: "Changes the jog coordinate system: JOINT (one axis at a time), WORLD (X/Y/Z of the cell), TOOL (along the torch), USER (along the positioner frame). Shown at the top of the screen." },
  ovrp: { label: "+%", group: "Motion", text: "Increases speed override: VFINE (0.1 mm or 0.01° per press), FINE (1 mm or 0.1° per press), 1 to 5%, then 5% steps to 100%. SHIFT + % jumps straight to VFINE, FINE, 5%, 50% or 100%. In T1 the TCP never exceeds 250 mm/s anyway." },
  ovrm: { label: "−%", group: "Motion", text: "Decreases speed override, one step per press (SHIFT + −% jumps 100% → 50% → 5% → FINE → VFINE). Slow down whenever you are close to the part." },
  diag: { label: "DIAG / HELP", group: "Screens", text: "Help for the current screen. On the alarm screen it shows the cause and the remedy of the selected alarm." },
  posn: { label: "POSN", group: "Screens", text: "Current position: joint angles (JNT), or X Y Z W P R in the user (USER) or world (WORLD) frame, plus the positioner axis E1." },
  io: { label: "I/O", group: "Screens", text: "Digital inputs and outputs. Watch DI/DO change live, simulate an input (SIM) to test logic, or force an output ON/OFF in T1." },
  status: { label: "STATUS", group: "Screens", text: "Controller status: mode, servo state, program, line, override, frames, weld enable." },
  jx1m: { label: "−X (J1)", group: "Jog", text: "Jog key. JOINT: axis J1 negative. WORLD/USER: −X. TOOL: −X of the torch. Needs SHIFT + enabling switch." },
  jx1p: { label: "+X (J1)", group: "Jog", text: "Jog key. JOINT: J1 positive (waist). WORLD/USER/TOOL: +X." },
  jy2m: { label: "−Y (J2)", group: "Jog", text: "Jog key. JOINT: J2 negative (shoulder back). Cartesian: −Y." },
  jy2p: { label: "+Y (J2)", group: "Jog", text: "Jog key. JOINT: J2 positive (shoulder forward). Cartesian: +Y." },
  jz3m: { label: "−Z (J3)", group: "Jog", text: "Jog key. JOINT: J3 negative. Cartesian: −Z (down in WORLD, along the torch in TOOL)." },
  jz3p: { label: "+Z (J3)", group: "Jog", text: "Jog key. JOINT: J3 positive. Cartesian: +Z." },
  jx4m: { label: "−X (J4)", group: "Jog", text: "Rotation jog. JOINT: J4 negative. Cartesian: rotate about X (W angle)." },
  jx4p: { label: "+X (J4)", group: "Jog", text: "Rotation jog. JOINT: J4 positive. Cartesian: rotate about X." },
  jy5m: { label: "−Y (J5)", group: "Jog", text: "Rotation jog. JOINT: J5 negative. Cartesian: rotate about Y (P angle)." },
  jy5p: { label: "+Y (J5)", group: "Jog", text: "Rotation jog. JOINT: J5 positive." },
  jz6m: { label: "−Z (J6)", group: "Jog", text: "Rotation jog. JOINT: J6 negative. Cartesian: rotate about Z (R angle)." },
  jz6p: { label: "+Z (J6)", group: "Jog", text: "Rotation jog. JOINT: J6 positive." },
};

// grid placement [key, column, row, class]
const TP_LAYOUT = [
  ["prev", 1, 1, "fn"], ["f1", 2, 1, "fn"], ["f2", 3, 1, "fn"], ["f3", 4, 1, "fn"], ["f4", 5, 1, "fn"], ["f5", 6, 1, "fn"], ["next", 7, 1, "fn"],
  ["shift", 1, 2, "blue"], ["menu", 2, 2, "sm"], ["select", 3, 2, "sm"], ["edit", 4, 2, "sm"], ["data", 5, 2, "sm"], ["fctn", 6, 2, "sm"], ["shift", 7, 2, "blue"],
  ["disp", 1, 3, "lb"], ["up", 3, 3, "arrow"], ["group", 5, 3, "lb"],
  ["step", 1, 4, "lb"], ["left", 2, 4, "arrow"], ["right", 4, 4, "arrow"], ["hold", 5, 4, "wh"], ["jx1m", 6, 4, "jog"], ["jx1p", 7, 4, "jog"],
  ["down", 3, 5, "arrow"], ["fwd", 5, 5, "wh"], ["jy2m", 6, 5, "jog"], ["jy2p", 7, 5, "jog"],
  ["reset", 1, 6, "sm"], ["bksp", 2, 6, "sm"], ["item", 3, 6, "dk"], ["enter", 4, 6, "sm"], ["bwd", 5, 6, "wh"], ["jz3m", 6, 6, "jog"], ["jz3p", 7, 6, "jog"],
  ["n7", 1, 7, "dk"], ["n8", 2, 7, "dk"], ["n9", 3, 7, "dk"], ["weld", 4, 7, "lb"], ["coord", 5, 7, "wh"], ["jx4m", 6, 7, "jog"], ["jx4p", 7, 7, "jog"],
  ["n4", 1, 8, "dk"], ["n5", 2, 8, "dk"], ["n6", 3, 8, "dk"], ["wirep", 4, 8, "lb"], ["ovrp", 5, 8, "lb"], ["jy5m", 6, 8, "jog"], ["jy5p", 7, 8, "jog"],
  ["n1", 1, 9, "dk"], ["n2", 2, 9, "dk"], ["n3", 3, 9, "dk"], ["wirem", 4, 9, "lb"], ["ovrm", 5, 9, "lb"], ["jz6m", 6, 9, "jog"], ["jz6p", 7, 9, "jog"],
  ["n0", 1, 10, "dk"], ["dot", 2, 10, "dk"], ["minus", 3, 10, "lb"], ["otf", 4, 10, "lb"],
  ["diag", 1, 11, "sm"], ["posn", 2, 11, "sm"], ["io", 3, 11, "sm"], ["status", 4, 11, "sm"],
];

class PendantView {
  constructor(host, { onKey, onKeyUp, mini } = {}) {
    this.host = host; this.onKey = onKey; this.onKeyUp = onKeyUp; this.mini = !!mini;
    this.keyEls = {};
    host.classList.add("tp");
    if (mini) host.classList.add("tp-mini");
    host.innerHTML = `
      <div class="tp-top">
        <button class="tp-switch" data-k="tpswitch" aria-label="Teach pendant ON/OFF switch"><span class="knob"></span><small>OFF · ON</small></button>
        <div class="tp-brandbar"><span class="tp-power" title="Power LED"></span>iPendant</div>
        <button class="tp-estop" data-k="estop" aria-label="Pendant emergency stop">E-STOP</button>
      </div>
      <div class="tp-body">
        <button class="tp-deadman left" data-k="deadman" aria-label="Enabling switch (left)">ENABLE</button>
        <div class="tp-face">
          <div class="tp-screen" aria-live="polite"><div class="tp-leds"></div><div class="tp-title"></div><div class="tp-content"></div><div class="tp-prompt"></div><div class="tp-fkeys"></div></div>
          <div class="tp-keys"></div>
        </div>
        <button class="tp-deadman right" data-k="deadman" aria-label="Enabling switch (right)">ENABLE</button>
      </div>`;
    const grid = host.querySelector(".tp-keys");
    for (const [k, c, r, cls] of TP_LAYOUT) {
      const def = TP_KEYS[k];
      const b = document.createElement("button");
      b.className = "tpk " + cls; b.dataset.k = k;
      b.style.gridColumn = c; b.style.gridRow = r;
      const lab = def.label.match(/^([−+]?[XYZ]) \((J\d)\)$/);
      b.innerHTML = lab ? `<b>${lab[1]}</b><small>(${lab[2]})</small>` : def.label.replace(" / ", "<br>").replace("BACK SPACE", "BACK<br>SPACE").replace("WELD ENBL", "WELD<br>ENBL");
      b.setAttribute("aria-label", def.label);
      grid.appendChild(b);
      (this.keyEls[k] = this.keyEls[k] || []).push(b);
    }
    const leds = document.createElement("div"); leds.className = "tp-led2";
    leds.innerHTML = `<span><i data-led="power"></i>POWER</span><span><i data-led="fault"></i>FAULT</span>`;
    leds.style.gridColumn = "6 / span 2"; leds.style.gridRow = 3;
    grid.appendChild(leds);
    host.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k;
      if (!this.keyEls[k]) this.keyEls[k] = [];
      if (!this.keyEls[k].includes(el)) this.keyEls[k].push(el);
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); el.setPointerCapture && el.setPointerCapture(e.pointerId); this.onKey && this.onKey(k, e); });
      const up = () => this.onKeyUp && this.onKeyUp(k);
      el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("lostpointercapture", up);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.onKey && this.onKey(k, e); setTimeout(up, 120); } });
    });
    host.addEventListener("contextmenu", (e) => e.preventDefault()); // long-press on a phone must not open a menu
    this.$ = (s) => host.querySelector(s);
  }
  setKeyState(k, on, cls = "on") { (this.keyEls[k] || []).forEach((el) => el.classList.toggle(cls, !!on)); }
  flash(k) { (this.keyEls[k] || []).forEach((el) => { el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 450); }); }
  render(v) {
    // v: { leds:{busy,step,hold,fault,run,io,prod,tcyc}, title:[...], body:html, prompt, fkeys:[5], popup }
    const L = v.leds;
    this.$(".tp-leds").innerHTML = [["Busy", L.busy], ["Step", L.step], ["Hold", L.hold], ["Fault", L.fault], ["Run", L.run], ["I/O", L.io], ["Prod", L.prod], ["TCyc", L.tcyc]]
      .map(([n, on]) => `<span class="${on ? "on" : ""}${n === "Fault" && on ? " red" : ""}">${n}</span>`).join("");
    this.$(".tp-title").innerHTML = v.title;
    this.$(".tp-content").innerHTML = v.body + (v.popup ? `<div class="tp-pop">${v.popup}</div>` : "");
    this.$(".tp-prompt").innerHTML = v.prompt || "&nbsp;";
    this.$(".tp-fkeys").innerHTML = (v.fkeys || ["", "", "", "", ""]).map((f) => `<span>${f || "&nbsp;"}</span>`).join("");
    this.host.querySelector('[data-led="fault"]').classList.toggle("on", !!L.fault);
    this.host.querySelector('[data-led="power"]').classList.add("on");
    const cur = this.$(".tp-content .cur");
    if (cur) { const c = this.$(".tp-content"); const top = cur.offsetTop - c.clientHeight / 2 + 10; if (Math.abs(c.scrollTop - top) > c.clientHeight / 3) c.scrollTop = top; }
  }
}

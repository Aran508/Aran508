"use strict";
// Weld Cell course: from "what is a robot" up to troubleshooting a production welding cell.

const COMPONENTS = {
  base: ["Robot base", "Bolted to the floor or a riser. Holds the J1 motor and the cable connection to the controller. The world frame usually starts here."],
  axis1: ["J1: waist", "Turns the whole arm left and right. Its motor and reducer sit in the base turret."],
  axis2: ["J2: shoulder and lower arm", "Tips the arm forward and back. It carries the most load, so it has the biggest motor and reducer and often a balancer spring."],
  axis3: ["J3: elbow and forearm housing", "Raises and lowers the forearm. The wire feeder rides on top of it on most arc welding robots."],
  axis4: ["J4: forearm roll", "Rolls the forearm tube. On hollow-wrist arc robots the torch cable runs through it."],
  axis5: ["J5: wrist bend", "Bends the wrist. When J5 passes 0° the wrist is singular: J4 and J6 line up."],
  axis6: ["J6: flange", "The tool flange. The torch bolts here through an anti-collision (breakaway) mount."],
  torch: ["Welding torch", "Swan-neck MIG/MAG torch. Contact tip, gas nozzle and wire. The TCP is set at the wire tip (about 15 mm stickout). A breakaway mount protects it in a crash."],
  feeder: ["Wire feeder", "Drive rolls push the filler wire from the drum through the liner to the torch at the commanded wire feed speed (m/min)."],
  controller: ["Robot controller (cabinet)", "Main CPU, servo amplifiers, safety circuit, I/O boards and the encoder backup battery. The mode switch and the panel E-stop are on its door."],
  modeswitch: ["Mode switch and panel E-stop", "Key switch: T1 (teach, max 250 mm/s), T2 (test at full speed), AUTO (production from the PLC). The red mushroom is the controller E-stop."],
  pendant: ["Teach pendant (iPendant)", "The handheld operator interface: jog, teach points, write and test programs. It has its own E-stop and a 3-position enabling switch."],
  powersource: ["Welding power source", "Inverter supply that makes the welding current. The robot sends it the schedule (volts, wire speed) and it reports back arc detect."],
  wiredrum: ["Wire drum", "Bulk pack of welding wire (e.g. 250 kg of 1.2 mm G3Si1). Fewer changeovers than spools."],
  gas: ["Shielding gas", "Ar/CO₂ mix (e.g. 82/18) at 12 to 18 L/min. It keeps air away from the molten pool, so no gas means porosity."],
  positioner: ["Positioner (headstock and bed)", "A servo axis that turns the part so the weld is always on top (flat position). The controller drives it as group 2, axis E1."],
  faceplate: ["Faceplate and chuck", "Grips the cylinder's cap-end clevis and turns with E1. Welding current returns through it."],
  tailstock: ["Tailstock with pneumatic centre", "The clamp. The PLC's clamp valve (Y0) pushes the centre into the tube. A reed sensor (X4) confirms it is clamped."],
  ground: ["Earth (ground) clamp", "Returns the welding current to the power source. Loose or dirty means no arc (ARC-013) or an unstable arc."],
  part: ["Hydraulic cylinder part", "Barrel tube (Ø120) with the cap end cover. The circumferential joint between them is the weld."],
  reamer: ["Torch cleaning station (reamer)", "Between cycles it reams spatter out of the nozzle, sprays anti-spatter and cuts the wire to length. Often the TCP check pin lives here too."],
  fume: ["Fume extraction hood", "Captures welding fumes above the arc. Required for operator health."],
  fence: ["Safety fence", "Keeps people out of the robot's reach during AUTO. Panels are bolted, and entry is only through interlocked doors."],
  door: ["Interlocked door", "The door switch is in the safety circuit. Opening it in AUTO stops the robot at once (SRVO-004 Fence open)."],
  curtain: ["Light curtain", "Infrared beams across the load opening. Breaking a beam in AUTO stops the robot (SRVO-007)."],
  panel: ["Operator panel", "START, STOP, CLAMP and UNCLAMP buttons. They are PLC inputs, not wired to the robot directly."],
  tower: ["Tower (stack) light", "Green = running, amber = ready/waiting, red = fault or not safe. Driven by PLC outputs."],
  plc: ["PLC", "Programmable logic controller. Reads the buttons and sensors, runs the ladder logic every scan, drives the clamp valve and lights, and does the handshake with the robot."],
};

const CHAPTERS = [
  // ---------------- Part 1: the machine
  { id: "cell", part: "1 · The machine", title: "What is in a robot welding cell?", anim: null, cell: "tour",
    lead: "Before touching anything, learn every part of the cell and what it does.",
    body: `<p>A robotic welding cell is a small factory. The <b>robot</b> moves the torch. The <b>positioner</b> turns the part. The <b>power source</b>, <b>wire feeder</b> and <b>gas</b> make the weld. The <b>controller</b> is the robot's brain, and the <b>teach pendant</b> is how you talk to it. The <b>PLC</b> runs the cell around the robot: buttons, clamps and lights. The <b>fence</b>, <b>door switch</b> and <b>light curtain</b> keep people safe.</p>
<p>Press <b>Start the tour</b> and the cell highlights each component in turn. You can also click any part of the 3D cell at any time to see what it is.</p>`,
    quiz: [{ q: "Which device turns the cylinder so the weld stays on top?", o: ["Wire feeder", "Positioner", "Reamer", "Tower light"], a: 1, why: "The positioner is a servo axis (E1). It keeps the joint in the flat position under the torch." }] },
  { id: "drive", part: "1 · The machine", title: "Inside one axis: motor, reducer, encoder, brake", anim: "drivetrain", cell: "axes",
    lead: "Every axis has the same chain: servo motor → reducer → arm, with an encoder and a brake on the motor.",
    body: `<p>The <b>servo motor</b> spins fast (thousands of rpm) but with little torque. The <b>reducer</b>, a precision gearbox such as an RV or harmonic drive, slows it by about 100:1 and multiplies the torque so it can move the heavy arm.</p>
<p>The <b>encoder</b> on the back of the motor counts every fraction of a turn and reports the position back to the controller. That is the <b>closed loop</b>: command, move, measure, correct, thousands of times a second.</p>
<p>The <b>brake</b> clamps the motor shaft whenever servo power is off (E-stop, alarm, power off), so the arm can't fall. The <b>battery</b> in the controller keeps the encoder counts alive when the power is off. If it goes flat, the robot forgets where it is and must be <b>re-mastered</b>.</p>`,
    quiz: [{ q: "Why do the reducers matter so much?", o: ["They cool the motor", "They trade speed for torque and give precision", "They store the program", "They measure position"], a: 1, why: "A reducer multiplies motor torque about 100× and gives a stiff, precise output. Reducer wear shows up as backlash and position error." }] },
  { id: "controller", part: "1 · The machine", title: "The controller cabinet", anim: "controller", cell: "focus:controller",
    lead: "Power, brains, muscles and safety: what lives in the cabinet.",
    body: `<ul><li><b>Power supply</b> turns mains (3-phase) into the DC bus for the amplifiers.</li><li><b>Servo amplifiers</b> drive each motor's current. The CPU tells them where to go.</li><li><b>Main CPU</b> runs your programs, plans the motion and solves the kinematics.</li><li><b>I/O boards</b> connect to the PLC, sensors, valves and the weld power source.</li><li><b>Safety circuit</b> is dual-channel. E-stops, fence and enabling switch can cut servo power regardless of software.</li><li><b>Battery</b> keeps the encoder counts (mastering data) while the power is off.</li></ul>
<p>The <b>mode switch</b> on the door sets T1, T2 or AUTO, and the <b>panel E-stop</b> is next to it. Click them in the cell.</p>`,
    quiz: [{ q: "What happens if the encoder battery dies with the controller switched off?", o: ["Nothing", "The program is deleted", "The robot loses its position and needs re-mastering", "The welding stops"], a: 2, why: "The absolute encoder counts are kept by the battery. Replace batteries with power ON (SRVO-065 BLAL warns you in time)." }] },
  { id: "pendant", part: "1 · The machine", title: "The teach pendant, key by key", anim: null, cell: "pendant",
    lead: "Every key on the pendant, what it does, and when you use it.",
    body: `<p>The pendant is your hands on the robot. Hold it in your left hand. Your fingers rest on the <b>enabling switch</b> at the back, and your right hand presses keys. The table below explains every key. In <b>Practice</b> mode, tick <b>Explain keys</b> and click any key on the live pendant to read about it there.</p>
<p>Three rules: the <b>SHIFT</b> key must be held for anything that moves the robot. The <b>enabling switch</b> must be in the middle position. And the robot only obeys the pendant when its <b>ON/OFF switch</b> is ON.</p>
<p>Other makers use the same ideas with different names: ABB <i>FlexPendant</i> (enabling device and joystick), KUKA <i>smartPAD</i> (enabling switches and a 6D mouse), Yaskawa <i>smart pendant</i>, UR <i>teach pendant</i> with freedrive.</p>`,
    keys: true,
    quiz: [{ q: "You press +X (J1) and nothing moves. The pendant is ON and the enabling switch is held. What is missing?", o: ["ENTER", "SHIFT", "STEP", "NEXT"], a: 1, why: "Jog keys only work together with SHIFT (plus the enabling switch)." }] },
  // ---------------- Part 2: moving safely
  { id: "safety", part: "2 · Moving the robot", title: "Safety: modes, E-stops and the enabling switch", anim: "enable3", cell: "focus:fence",
    lead: "Industrial robots are fast and strong. The safety system lets people work with them.",
    body: `<table class="t"><tr><th>Mode</th><th>Who controls</th><th>Speed</th><th>Use</th></tr>
<tr><td><b>T1</b></td><td>Pendant (ON), enabling switch held</td><td>TCP ≤ 250 mm/s</td><td>Teaching, jogging, first test of every program</td></tr>
<tr><td><b>T2</b></td><td>Pendant, enabling switch held</td><td>Programmed speed</td><td>Checking cycle time and real paths, with care</td></tr>
<tr><td><b>AUTO</b></td><td>PLC / cycle start, pendant OFF</td><td>Full</td><td>Production. Fence closed, nobody inside</td></tr></table>
<p><b>Enabling switch:</b> 3 positions. Released and squeezed hard both stop. Only the middle position allows motion. Panic makes people either let go or squeeze, so both are safe.</p>
<p><b>E-stops</b> (pendant, controller, operator panel) cut servo power. <b>Door switch</b> and <b>light curtain</b> stop the robot in AUTO. After any stop: find the cause, make it safe, release, and press <b>RESET</b>.</p>`,
    quiz: [{ q: "You want to watch the robot weld at real speed from outside the fence. Which mode?", o: ["T1", "T2", "AUTO", "Any"], a: 2, why: "Real production speed with nobody inside the fence is AUTO. T2 is full speed with a person holding the enabling switch, so use it rarely and stay outside the reach." }] },
  { id: "coords", part: "2 · Moving the robot", title: "Coordinate systems: JOINT, WORLD, TOOL, USER", anim: null, cell: "frames",
    lead: "When you press +X, which X? The COORD key decides.",
    body: `<ul><li><b>JOINT</b>: each key turns one axis (J1 to J6). Use it to get out of awkward postures or singularities.</li><li><b>WORLD</b>: X, Y, Z of the cell, with the origin at the robot base. +Z is always up.</li><li><b>TOOL</b>: axes fixed to the torch. +Z pushes along the torch towards the wire tip. Ideal for approaching the joint.</li><li><b>USER</b>: a frame you taught on the fixture or positioner. Points taught in a user frame move with it.</li></ul>
<p>Rotation keys (J4 to J6 rows) turn the torch about the chosen frame's X (W), Y (P) and Z (R) axes <b>around the TCP</b>, so the wire tip stays put. That only works if the TCP is taught correctly.</p>
<p>Press <b>Show in cell</b>: the arm moves along WORLD X, then TOOL Z, so you can compare.</p>`,
    quiz: [{ q: "You want to back the torch straight out of the joint along its own axis. Which COORD?", o: ["JOINT", "WORLD", "TOOL", "USER"], a: 2, why: "In TOOL, −Z moves along the torch axis away from the work, whatever the torch angle." }] },
  { id: "jogging", part: "2 · Moving the robot", title: "Jogging step by step", anim: null, cell: "pendant",
    lead: "The exact sequence to move a robot by hand. Do it in this order every time.",
    body: `<ol><li>Controller mode switch to <b>T1</b>.</li><li>Pendant switch to <b>ON</b>.</li><li>Hold the <b>enabling switch</b> in the middle.</li><li>Press <b>RESET</b> to clear SRVO-003 and other alarms. The FAULT light goes off.</li><li>Choose <b>COORD</b> (JOINT to start) and a low override with <b>−%</b> (start at 10%).</li><li>Hold <b>SHIFT</b> and press a jog key, e.g. <b>+X (J1)</b>. Release SHIFT to stop.</li><li>Near the part, change override to <b>FINE</b>: each press moves 1 mm (or 0.1°).</li></ol>
<p>In this simulator the enabling switch and SHIFT are click-to-latch, because you only have one mouse pointer. Jog keys move while you hold them down.</p>`,
    quiz: [{ q: "After turning the pendant ON, the FAULT light shows SRVO-003. Why?", o: ["Battery", "Enabling switch released", "Fence open", "Bad program"], a: 1, why: "With the pendant ON the enabling switch must be held. Hold it, then RESET." }] },
  { id: "tcp", part: "2 · Moving the robot", title: "TCP and tool frame", anim: null, cell: "focus:torch",
    lead: "The Tool Centre Point is the point the robot actually steers. For welding it is the wire tip.",
    body: `<p>Every Cartesian move, every rotation about the tip, and every taught point depends on the robot knowing exactly where the wire tip is relative to the flange. That is the <b>tool frame</b> (UTOOL 1 here: X 75, Z 310, tipped 30°, from the torch drawing).</p>
<p>It is taught with the <b>6-point method</b>: touch a fixed pin from 3 or more orientations, plus directions for the axes. After any crash the torch neck can bend. The TCP is then wrong and every weld lands off the seam. Production cells run a <b>TCP check</b> at the reamer pin and stop if the tip moved more than about 0.5 mm.</p>
<p>Good test: rotate about the tip (TOOL coordinates, rotation keys). If the wire tip wanders, the TCP is wrong.</p>`,
    quiz: [{ q: "All welds suddenly land 4 mm to one side, with no alarm. Most likely cause?", o: ["Gas empty", "Bent torch neck: TCP is wrong", "Low battery", "PLC fault"], a: 1, why: "A consistent offset on every part after a bump is the classic sign of a changed TCP. Run a TCP check and re-teach or replace the neck." }] },
  // ---------------- Part 3: signals
  { id: "io", part: "3 · Signals and control", title: "I/O: DI, DO, UI, UO, RI, RO, AI, GO…", anim: "io", cell: "focus:plc",
    lead: "Inputs and outputs are how the robot listens and talks.",
    body: `<table class="t"><tr><th>Code</th><th>Meaning</th><th>Example in this cell</th></tr>
<tr><td><code>DI[n]</code></td><td>Digital input (into the robot)</td><td>DI[2] CLAMP OK from the PLC, DI[4] arc detect</td></tr>
<tr><td><code>DO[n]</code></td><td>Digital output (from the robot)</td><td>DO[1] IN CYCLE, DO[2] WELD DONE</td></tr>
<tr><td><code>UI / UO</code></td><td>System (UOP) signals: start, hold, reset, ready, fault</td><td>PLC START → robot, robot READY → PLC</td></tr>
<tr><td><code>RI / RO</code></td><td>Robot I/O at the wrist connector</td><td>Gripper or touch-sensing</td></tr>
<tr><td><code>AI / AO</code></td><td>Analog values (0–10 V)</td><td>Weld volts/wire speed commands on some systems</td></tr>
<tr><td><code>GI / GO</code></td><td>Group: several bits read as one number</td><td>Part type from the PLC</td></tr></table>
<p>The number in square brackets is the <b>index</b>: which input. A comment after a colon names it: <code>DI[2:CLAMP OK]</code>. On the I/O screen you can watch signals live, <b>SIMULATE</b> an input to test logic, or force an output in T1.</p>`,
    quiz: [{ q: "The robot needs to know the part is clamped. Which kind of signal is that, from the robot's point of view?", o: ["DO", "DI", "AO", "RO"], a: 1, why: "Information coming INTO the robot is an input: DI[2] CLAMP OK." }] },
  { id: "plc", part: "3 · Signals and control", title: "What is a PLC?", anim: "plcscan", cell: "plc",
    lead: "A PLC is a rugged industrial computer that runs the cell's logic in an endless scan.",
    body: `<p>A <b>Programmable Logic Controller</b> reads all its inputs (buttons, sensors, robot status), solves its program, then writes all its outputs (valves, lights, robot start), every 10–20 ms, forever. That loop is the <b>scan</b>.</p>
<p>PLC programs are usually <b>ladder logic</b>, drawn like electrical relay diagrams: a <b>contact</b> <code>─┤ ├─</code> passes power when its signal is ON, a <b>normally-closed contact</b> <code>─┤/├─</code> when it is OFF, and a <b>coil</b> <code>─( )─</code> switches an output or memory bit. Contacts in series = AND, branches in parallel = OR. A coil that feeds its own contact back is a <b>seal-in (latch)</b>.</p>
<p>Open the <b>PLC ladder</b> tab in Practice to see this cell's real logic live, rung by rung.</p>`,
    quiz: [{ q: "Two contacts drawn one after the other on the same rung mean…", o: ["OR", "AND", "NOT", "Timer"], a: 1, why: "Series = AND: power only flows if both are closed." }] },
  { id: "handshake", part: "3 · Signals and control", title: "The robot–PLC handshake", anim: "handshake", cell: "focus:panel",
    lead: "The PLC and the robot never assume; they confirm each step with signals.",
    body: `<ol><li>Operator loads a part and presses <b>CLAMP</b>. The PLC drives the clamp valve (Y0), and when the clamp sensor (X4) confirms, it sends <b>CLAMP OK</b> to robot DI[2].</li><li>Operator presses <b>START</b>. If the cell is safe, the clamp is OK and the robot is READY, the PLC sends <b>START</b>.</li><li>The robot answers <b>IN CYCLE</b> (DO[1]). Only then does the PLC drop START. That is a true handshake.</li><li>The robot welds. The power source reports <b>arc detect</b>.</li><li>The robot pulses <b>WELD DONE</b> (DO[2]). The PLC unclamps. The operator unloads.</li></ol>
<p>If any step's signal never comes, the sequence waits there. That is exactly where you look when something "does nothing".</p>`,
    quiz: [{ q: "The operator presses START, the amber light is on, nothing happens. First place to look?", o: ["Weld schedule", "PLC ladder: which condition of the START rung is open", "Gas bottle", "Torch nozzle"], a: 1, why: "START is a PLC rung with several conditions. The open contact tells you exactly what's missing." }] },
  // ---------------- Part 4: programs
  { id: "anatomy", part: "4 · Programs", title: "Reading a TP program: every symbol explained", anim: "tpline", cell: null,
    lead: "J, L, P[ ], ( ), :, ;, %, mm/sec, FINE, CNT: what each one means and why it is there.",
    body: `<table class="t">
<tr><th>Symbol</th><th>Meaning</th></tr>
<tr><td><code>12:</code></td><td>Line number. Execution goes top to bottom unless JMP/CALL changes it.</td></tr>
<tr><td><code>J</code> <code>L</code> <code>C</code></td><td>Motion type: <b>J</b>oint (fastest path for the axes), <b>L</b>inear (straight line for the TCP), <b>C</b>ircular (arc through a via point).</td></tr>
<tr><td><code>P[3]</code></td><td>Position number 3 of this program. Square brackets always hold an <b>index</b>: which point, register or signal.</td></tr>
<tr><td><code>P[3:WELD START]</code></td><td>The text after the colon is a comment (name). It doesn't change the meaning.</td></tr>
<tr><td><code>PR[1]</code> <code>R[1]</code></td><td>Position register and numeric register: global variables shared by all programs.</td></tr>
<tr><td><code>PR[1,3]</code></td><td>Element 3 (Z) of position register 1. Elements 1 to 6 are X, Y, Z, W, P, R.</td></tr>
<tr><td><code>50%</code></td><td>Joint speed as a percentage of maximum.</td></tr>
<tr><td><code>150mm/sec</code></td><td>Linear/circular TCP speed. <code>WELD_SPEED</code> takes it from the weld schedule.</td></tr>
<tr><td><code>FINE</code> / <code>CNT50</code></td><td>Termination: stop exactly, or round the corner (0 to 100).</td></tr>
<tr><td><code>DO[1]=ON</code></td><td>Switch an output. <code>=</code> assigns here. In an IF or WAIT, <code>=</code> compares.</td></tr>
<tr><td><code>WAIT 0.50(sec)</code></td><td>Round brackets give the <b>unit</b> or group an expression: <code>(R[1]+1)*2</code>.</td></tr>
<tr><td><code>!text</code></td><td>Comment line, ignored by the robot.</td></tr>
<tr><td><code>;</code></td><td>End of the instruction.</td></tr>
<tr><td><code>LBL[1]</code> / <code>JMP LBL[1]</code></td><td>A label and a jump to it. Used for loops and branches.</td></tr>
<tr><td><code>IF R[1]&lt;3,JMP LBL[1]</code></td><td>Conditional jump: the comma separates the condition from the action.</td></tr>
<tr><td><code>Arc Start[1]</code></td><td>Strike the arc using weld schedule 1. <code>Arc End[1]</code> fills the crater and stops.</td></tr></table>`,
    quiz: [{ q: "In WAIT DI[2]=ON, what does [2] mean?", o: ["Wait 2 seconds", "Input number 2", "Two inputs", "Priority 2"], a: 1, why: "Square brackets give the index: digital input number 2 (CLAMP OK)." }] },
  { id: "motion", part: "4 · Programs", title: "Motion instructions in depth", anim: "finecnt", cell: "weldview",
    lead: "Choosing J or L, speed, and FINE or CNT changes the path, the cycle time and the weld.",
    body: `<p><b>J</b> moves are for travel through free space. They are fast, and the path curves. <b>L</b> moves are for anything near the part: approach, weld, retract. The torch follows a straight line. <b>C</b> draws arcs (rarely needed when a positioner turns the part).</p>
<p><b>FINE</b> stops exactly on the point. Use it at the weld start, the weld end and pick points. <b>CNT</b> lets the robot round the corner without stopping. Use it on air moves to save cycle time. A CNT on a weld start makes the arc start in the wrong place.</p>
<p>In this cell the weld itself is one line: <code>L P[4:WELD END] WELD_SPEED FINE</code>. P[4] has the same robot position as P[3] but the positioner E1 is at 370°, so the part turns under a still torch at the schedule's travel speed. That is <b>coordinated motion</b>.</p>`,
    quiz: [{ q: "Which termination should the line before Arc Start have?", o: ["CNT100", "FINE", "CNT50", "It doesn't matter"], a: 1, why: "The arc must start exactly on the joint, so the robot must stop on the point: FINE." }] },
  { id: "logic", part: "4 · Programs", title: "Logic: registers, IF, JMP, CALL, WAIT", anim: null, cell: null,
    lead: "Programs make decisions with registers, conditions, jumps and sub-programs.",
    body: `<pre class="code">  1:  R[1:COUNT]=0 ;
  2:  LBL[1] ;
  3:  CALL CYL_WELD ;
  4:  R[1:COUNT]=R[1]+1 ;
  5:  IF R[1]<3,JMP LBL[1] ;
  6:  MESSAGE[3 parts done] ;</pre>
<p>Line 1 clears a counter. Line 2 marks a place. Line 3 runs another program and comes back. Line 4 adds 1. Line 5 jumps back while fewer than 3 parts are done.</p>
<ul><li><code>WAIT DI[2]=ON</code> pauses until a signal. Add <code>TIMEOUT,LBL[9]</code> in production so the robot can raise an alarm instead of waiting forever.</li><li><code>WAIT 1.00(sec)</code> pauses for a time.</li><li><code>IF (...) THEN</code> / <code>ELSE</code> / <code>ENDIF</code> blocks and <code>FOR R[2]=1 TO 3</code> / <code>ENDFOR</code> loops exist on newer controllers.</li><li><code>PR[ ]</code> + <code>Offset,PR[1]</code> shifts a point, e.g. for multi-pass welds.</li></ul>`,
    quiz: [{ q: "A program is stuck forever on WAIT DI[2]=ON. How do you test the rest of the program without the PLC?", o: ["Delete the line", "SIMULATE DI[2] ON in the I/O screen (or FCTN > RELEASE WAIT)", "Press E-stop", "Change UTOOL"], a: 1, why: "Simulating the input is safe and reversible. Remember to UNSIM afterwards." }] },
  // ---------------- Part 5: welding
  { id: "gmaw", part: "5 · Welding", title: "How MIG/MAG welding works", anim: "gmaw", cell: "weldview",
    lead: "The arc melts a continuously fed wire into the joint, under a shield of gas.",
    body: `<p><b>GMAW</b> (MIG/MAG) feeds a wire through the torch. Current enters the wire at the <b>contact tip</b>, an <b>arc</b> forms between wire and work, and the wire melts into the <b>weld pool</b>, which solidifies into the <b>bead</b>. <b>Shielding gas</b> keeps oxygen and nitrogen out.</p>
<table class="t"><tr><th>Parameter</th><th>Effect</th><th>Typical here</th></tr>
<tr><td>Voltage</td><td>Arc length and bead width</td><td>21–23 V</td></tr>
<tr><td>Wire feed speed / amps</td><td>Heat and deposition</td><td>8–10 m/min ≈ 185–215 A</td></tr>
<tr><td>Travel speed</td><td>Bead size. Too fast gives cold, narrow lack of fusion. Too slow gives a big bead and burn-through</td><td>9–11 mm/s</td></tr>
<tr><td>Stickout (CTWD)</td><td>Long = less current and an unstable arc</td><td>15–20 mm</td></tr>
<tr><td>Gas flow</td><td>Too low = porosity, too high = turbulence</td><td>12–18 L/min</td></tr></table>
<p>These are stored as a <b>weld schedule</b> (DATA screen) and called by number: <code>Arc Start[1]</code>.</p>`,
    quiz: [{ q: "The gas bottle runs empty during a weld. What defect appears?", o: ["Undercut", "Porosity", "Burn-through", "Crater crack"], a: 1, why: "Without shielding, gases dissolve in the pool and form holes (porosity)." }] },
  { id: "angles", part: "5 · Welding", title: "Torch angles and positions", anim: "angles", cell: "weldview",
    lead: "Where and how the torch points decides where the heat goes.",
    body: `<ul><li><b>Work angle</b>: tilt across the joint. Point slightly toward the thicker part (here 10° toward the cap end).</li><li><b>Travel angle</b>: tilt along the travel direction. <b>Push</b> 5–15° gives a flatter bead and good visibility. Pull gives deeper penetration.</li><li><b>Stand-off</b>: keep the wire tip on the joint at the right height.</li><li><b>Lead on a rotating part</b>: put the torch about 10° <b>before</b> top dead centre, against the rotation, so the pool solidifies as it passes the top instead of running down the side.</li></ul>
<p>The P[3] WELD START point uses exactly these angles: W −170°, P 10°, R 180° with the torch 10° before the top.</p>`,
    quiz: [{ q: "The part rotates and the pool keeps running down ahead of the arc. What do you adjust?", o: ["More voltage", "Move the torch further before top dead centre", "Faster wire", "Change UFRAME"], a: 1, why: "Increase the lead so the pool freezes as it reaches the top." }] },
  { id: "job", part: "5 · Welding", title: "The job: welding a hydraulic cylinder", anim: "cylinder", cell: "focus:part",
    lead: "Cap end to barrel: the most common robotic weld in cylinder manufacturing.",
    body: `<p>A hydraulic cylinder is a <b>barrel</b> (tube) closed by an <b>end cover / cap end</b> with a clevis at one end and a <b>gland</b> at the other. The piston and rod run inside. The cap-to-barrel weld must hold full system pressure (often 200–300 bar), so it must be <b>leak-tight and fully fused</b> all the way round.</p>
<ol><li>Prepare: bevel the joint (30–35°), clean oil and mill scale.</li><li>Load: cap clevis in the chuck, barrel on the tailstock.</li><li>Clamp: the PLC pushes the tailstock centre in and the sensor confirms.</li><li>Tack (optional): 3 short welds at 120° to hold alignment.</li><li>Weld: the positioner turns 360° plus a 10° overlap while the torch stays still.</li><li>Crater fill and arc end, then the torch retracts.</li><li>Unclamp, cool, inspect (visual, dye penetrant, pressure test).</li></ol>`,
    quiz: [{ q: "Why does the weld go round 370°, not 360°?", o: ["To use more wire", "So the end overlaps the start and closes the seam", "To cool down", "To check the TCP"], a: 1, why: "The start of a weld is cooler and smaller. Overlapping it melts it in, so there is no gap at the tie-in." }] },
  { id: "arcinst", part: "5 · Welding", title: "Arc instructions, weld enable and dry runs", anim: null, cell: "weldview",
    lead: "How the program controls the arc, and how to test it safely.",
    body: `<pre class="code">  9:L P[3:WELD START] 150mm/sec FINE ;
 10:  Arc Start[1] ;
 12:L P[4:WELD END] WELD_SPEED FINE ;
 13:  Arc End[1] ;</pre>
<p><code>Arc Start[1]</code> runs gas pre-flow, inches the wire, strikes the arc with schedule 1, and <b>waits for arc detect</b>. If no arc comes within the start time you get <b>ARC-013 Arc Start failed</b>. <code>Arc End[1]</code> runs crater fill, wire burnback and gas post-flow.</p>
<p><b>WELD ENBL</b> (SHIFT+WELD ENBL on the pendant) decides whether Arc Start really welds. With it OFF the program runs <b>dry</b>: same path, no arc. Always run a new or edited program dry in T1 first, watching the wire tip on the joint, before enabling weld.</p>
<p><code>Weave Sine[1]</code> / <code>Weave End</code> add side-to-side motion for wider beads on bigger joints.</p>`,
    quiz: [{ q: "You touched up P[3]. What do you do before welding production parts?", o: ["Weld straight away in AUTO", "Dry-run in T1 with WELD ENBL off and watch the tip", "Change the schedule", "Reset the PLC"], a: 1, why: "Prove the path dry first. A wrong point costs a scrapped cylinder or a crashed torch." }] },
  // ---------------- Part 6: specialist
  { id: "method", part: "6 · Becoming a specialist", title: "How to troubleshoot like a specialist", anim: "trouble", cell: null,
    lead: "Good technicians don't guess. They follow the evidence.",
    body: `<ol><li><b>Observe</b>: what exactly happened, on which line, in which mode, since when? Ask the operator.</li><li><b>Collect data</b>: alarm code and history (MENU › ALARM, DIAG/HELP), the paused line, I/O states, the PLC ladder, the weld report.</li><li><b>Hypothesise</b>: list the causes that fit all the facts, likeliest and easiest to check first.</li><li><b>Test</b>: change one thing at a time. SIMULATE inputs, step the program in T1, watch a signal.</li><li><b>Fix the root cause</b>: a new door switch, not a jumper wire. Ask "why" five times.</li><li><b>Verify</b>: a full cycle in AUTO and a good part.</li><li><b>Prevent</b>: add a check, a maintenance task, a training note.</li></ol>
<p>Signals are your best friend: every "nothing happens" problem is a signal that should be ON and isn't. Follow it from the button, through the PLC, to the robot.</p>
<p>Try the <b>Troubleshoot</b> mode: real faults are injected and you diagnose them with these tools.</p>`,
    quiz: [{ q: "Arc Start fails. Gas OK is on, wire feeds when inched. Next most likely cause?", o: ["Earth (ground) clamp loose", "Wrong UFRAME", "Low battery", "Light curtain"], a: 0, why: "No current path = no arc. Check the earth clamp and the contact tip next." }] },
  { id: "alarms", part: "6 · Becoming a specialist", title: "Alarm reference", anim: null, cell: null,
    lead: "The codes you will meet most often, what they mean, and what to do.",
    body: "__ALARMS__",
    quiz: [{ q: "SRVO-065 BLAL appears. How do you change the batteries?", o: ["Power off first", "With controller power ON", "Ignore it", "Re-master first"], a: 1, why: "Changing them with power ON keeps the encoder counts. With power off the robot can lose mastering." }] },
  { id: "defects", part: "6 · Becoming a specialist", title: "Weld defects and their causes", anim: "defects", cell: null,
    lead: "Read the bead: each defect points to a cause.",
    body: `<table class="t"><tr><th>Defect</th><th>Likely causes</th><th>What to check first</th></tr>
<tr><td>Porosity</td><td>No or low gas, draughts, leaks, oily part, spatter-blocked nozzle</td><td>Gas flow, DI[5] GAS OK, nozzle, cleaning cycle</td></tr>
<tr><td>Lack of fusion</td><td>Torch off the seam, too fast, too cold, wrong angle</td><td>TCP check, point P[3], travel speed</td></tr>
<tr><td>Undercut</td><td>Too fast, too much voltage, torch angle</td><td>Schedule, travel/work angle</td></tr>
<tr><td>Burn-through</td><td>Too slow, too hot, gap too big</td><td>Travel speed, joint fit-up</td></tr>
<tr><td>Spatter</td><td>Voltage too low/high for the wire speed, long stickout, dirty tip</td><td>Schedule, contact tip, stickout</td></tr>
<tr><td>Start/stop defects</td><td>No overlap, no crater fill</td><td>370° rotation, Arc End schedule</td></tr></table>
<p>The <b>Weld report</b> in Practice maps each defect to its position (angle) on the seam, the way an inspector would mark the part.</p>`,
    quiz: [{ q: "The report shows porosity all the way round but the bead is centred. First check?", o: ["TCP", "Shielding gas", "Weld speed", "PLC"], a: 1, why: "Uniform porosity along the whole seam is a gas problem. A TCP error would put the bead off-centre." }] },
  { id: "maint", part: "6 · Becoming a specialist", title: "Maintenance and good habits", anim: null, cell: "focus:reamer",
    lead: "Most stoppages are prevented by simple routine checks.",
    body: `<table class="t"><tr><th>When</th><th>Task</th></tr>
<tr><td>Every shift</td><td>Check contact tip and nozzle. Check gas flow at the nozzle. Check the reamer works. Run a TCP check. Wipe spatter off the fixture.</td></tr>
<tr><td>Weekly</td><td>Blow out the liner, check the drive rolls and earth connections, check cable dress on the arm.</td></tr>
<tr><td>Every 1–1.5 years</td><td>Replace encoder batteries (power ON). Change reducer grease per the maintenance manual.</td></tr>
<tr><td>Always</td><td>Back up programs and system files before changes. Comment every program line you change. Never bypass a safety device.</td></tr></table>
<p>A specialist also keeps a <b>log</b>: alarm, cause, fix, date. Patterns in the log reveal the next failure before it happens.</p>`,
    quiz: [{ q: "Why run a TCP check every shift?", o: ["To warm up the motors", "To catch a bent torch before it makes bad welds", "It is required by the PLC", "To clean the nozzle"], a: 1, why: "A small knock can bend the neck. Checking each shift catches it before a whole batch is scrapped." }] },
];

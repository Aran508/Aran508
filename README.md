# Engineering playground

Two browser simulators, each a static page with no build step.

| Project | What it is |
|---------|------------|
| [`robot-lab/weld.html`](robot-lab/weld.html) | **Weld Cell Trainer**: FANUC-style arc welding cell with a working teach pendant, PLC, and fault scenarios |
| [`robot-lab/`](robot-lab/) | **Robot Academy**: learn industrial robot programming in ABB RAPID, FANUC TP, KUKA KRL, Yaskawa INFORM or URScript, and run your code on a simulated 6-axis arm |
| [`bridge-lab/`](bridge-lab/) | **Bridge Lab**: design a truss bridge and load-test it with an XPBD solver |

---

# Robot Academy

Open `robot-lab/index.html` in a browser. It loads three.js from cdnjs. Everything else is local.

## What you get

- **15 lessons, from A to Z**: the six axes, coordinate frames, a first program, joint vs linear motion, approach offsets, blending, circles, gripper I/O, sensors, loops, decisions, subroutines, a full pick-and-place cell, palletizing in a user frame, and reading faults.
- **Five real languages.** Each lesson's program is written once as a neutral recipe and generated as idiomatic code for each maker:
  - **ABB RAPID**: `MODULE`, `robtarget`, `MoveJ/MoveL/MoveC/MoveAbsJ`, `Offs`, `RelTool`, `\WObj`
  - **FANUC TP**: `.LS` layout with `/MN` and `/POS`, `J/L/C`, `CNT`, `Offset,PR[]`, `UFRAME_NUM`, `LBL/JMP`
  - **KUKA KRL**: `DEF/END`, `E6POS` aggregates, `PTP/LIN/CIRC`, `C_DIS`, `$BASE`, `$TOOL`, `LIN_REL`, and pendant inline forms
  - **Yaskawa INFORM**: `/JOB`, `//POS` C-points, `MOVJ/MOVL/MOVC`, `PL`, `SFTON`, `SETE`, `IMOV`, `JUMP *L IF`
  - **Universal Robots URScript**: `def`, `p[...]` poses in metres and radians, `movej/movel/movec`, `pose_trans`, `pose_add`
- **A real simulator for your own code.** Each language has a parser, and all five compile to one shared VM. Edit the program, press Run or Step, and the arm executes it with:
  - analytic inverse kinematics for a 6-axis spherical-wrist arm
  - a 3D arm built like the real thing: an anchored base with a connector panel, cast turret and upper arm, reducer covers with bolt circles, a servo motor and encoder cap on every axis, a wrist fork, an ISO 9409 tool flange, and a cable dress pack that follows the arm. UR gets a cobot-style arm.
  - joint, linear and circular interpolation, with blending
  - path checks for reach, joint limits and wrist singularities, reported with the line number
  - a work cell: a conveyor feeding boxes, a part sensor, a gripper that really grasps, a pallet user frame, a reject bin, and collision checks against the tables
  - digital I/O you can force, a speed override, an E-stop, a jog pendant (joint, base or tool), and Teach to capture the current pose as code

## Weld Cell Trainer (`robot-lab/weld.html`)

A FANUC ArcTool-style welding cell that welds the cap end cover (CEC) onto a hydraulic cylinder tube while a servo positioner turns the part. The part follows the customer drawing:

- **Tube:** Ø65 × Ø50 bore × 203 long, with a Ø51 counterbore that takes the CEC spigot.
- **CEC:** clevis with an R19 eye, 31.75 wide, and a Ø19.6 pin hole. The fixture locates on that pin.
- **Joint:** J preps on both the tube and the CEC form a U-groove: R3 bottom on the joint line, 4° included (2° each wall), 6.1 wide at the OD, and a 3.1 root land, so the groove is 4.4 deep and about 22.6 mm² in section. It is filled all round.
- **Weld:** one pass of Ø1.2 ER70S-6 in 82Ar/18CO₂ at 24 V, 220 A, 7 m/min wire and 5 mm/s travel. That lays about 25 mm² per mm, or 111% of the groove. The part turns 380°, which gives a 20° overlap. The weld report grades underfill if schedule 1 lays less than 95% of the groove area.

It has three modes.

**Learn**: 24 chapters from zero to specialist. Each has an animation, a 3D demo in the cell, and a knowledge check.
- *The machine:* cell tour (click any component), servo motor, reducer, encoder and brake, the controller cabinet, and every teach pendant key.
- *Moving the robot:* T1/T2/AUTO, the 3-position enabling switch, E-stops, JOINT/WORLD/TOOL/USER, the jogging procedure, and the TCP.
- *Signals:* DI/DO/UI/UO/RI/RO/AI/GO, what a PLC is (scan cycle, ladder logic), and the robot–PLC handshake.
- *Programs:* every TP symbol (`J L C P[] PR[] R[] : ; () % mm/sec FINE CNT ! LBL JMP`), motion, and logic.
- *Welding:* GMAW physics, weld parameters from zero with a live calculator that can load its values into the robot, torch angles and lead on a rotating part, the cylinder job, reading the drawing (the Detail A U-groove and the WPS), and Arc Start/End with dry runs.
- *Specialist:* troubleshooting method, alarm reference, weld defects, and maintenance.

**Practice**: an iPendant replica that works:
- *Keys:* PREV, F1–F5, NEXT, SHIFT, MENU, SELECT, EDIT, DATA, FCTN, DISP, STEP, HOLD, FWD, BWD, COORD, ±%, GROUP, RESET, ITEM, ENTER, digits, DIAG/HELP, POSN, I/O, STATUS, WELD ENBL, WIRE±, OTF, all 12 jog keys, the TP ON/OFF switch, E-stop and enabling switch.
- *Screens:* EDIT with field editing and [CHOICE], POINT/ARCSTRT/WELD_PT/ARCEND/TOUCHUP, [INST] and [EDCMD], SELECT/CREATE/DELETE, POSN (JNT/USER/WORLD), I/O with SIMULATE and force, DATA registers and weld schedules, ALARM with help, STATUS and SETUP frames.
- *The cell:* a controller with a mode key and E-stop, an operator panel driving a live ladder-logic PLC, a door and light curtain, a real arc process (preflow, strike, arc detect, crater fill), and weld-quality sampling with an inspection report that maps defects around the seam.
- *Missions:* 10 missions, checked live, from "wake the robot" to "weld in AUTO and pass inspection".

**Troubleshoot**: 8 injected faults:
- a bad door switch
- a failed clamp sensor
- a loose earth clamp (ARC-013)
- empty gas (porosity)
- a bent torch (TCP shift)
- a bad touch-up (SRVO-050)
- a low encoder battery (SRVO-065)
- a light-curtain trip (SRVO-007)

You diagnose each one with the pendant screens, I/O, the PLC ladder and the weld report, then choose the root cause and apply the fix.

**Pro**: run and test your own programs with no hints, on one device or two.
- *Both on this device:* pendant, cell and program tools side by side.
- *Two devices:* open the page on both and choose Pro. On the screen that should show the robot, pick **Robot cell** and it shows a 6-digit code. On the other (a phone works well), pick **Teach pendant** and type the code; a link like `weld.html#pendant=123456` joins directly. The phone becomes the full pendant: every key you press drives the robot on the other screen, and the pendant screen mirrors the controller.
- The two devices talk over a WebRTC data channel set up through the public PeerJS broker (peerjs.com); the simulation runs only on the robot screen.
- If the pendant link drops or goes quiet for 2 seconds, the robot stops jogging, pauses any program and releases the enabling switch, like a real pendant cable fault.
- Both screens have full screen (⛶) and Esc.

**Pause:** anything that runs on its own can be frozen with **Pause** on the 3D view or the **P** key, and cancelled with **Stop**. That covers the cell tour, the axis and frame demos, the lesson animations and the automatic weld. Robot Academy has the same Pause/Resume on its 3D view and next to *Watch it run*.

Alarm codes follow FANUC naming. Texts vary by controller version, so use your controller's manuals for real work.

## Honest simplifications

- One kinematic model is shared by every brand so lesson coordinates match. Joint zero conventions are converted for KUKA, and URScript joint lists are read in this model's zero.
- FANUC `CNT` and Yaskawa `PL` are mapped to approximate blend distances. Yaskawa pulse counts use 1000 pulses per degree.
- Supported instructions are a teaching subset of each language. No threads, interrupts or force control.

## Tests

The language layer was checked by generating all 15 lessons in all 5 languages, parsing them back, and running them in the cell. All 75 runs finish at identical positions and place identical box counts. The faults lesson stops with an out-of-reach error by design.

---

# Bridge Lab


A truss bridge simulator in a single HTML file. Design a bridge across a canyon, then drive a car, van or truck over it and watch the force in every member in real time.

Open `bridge-lab/index.html` in a browser. There is no build step and nothing to install.

## What it models

- **Pin-jointed truss.** Every member is an axial bar with stiffness `EA`, a self-weight per metre and a cost per metre. Joints are frictionless pins.
- **XPBD solver.** The solver is Extended Position-Based Dynamics with the "small steps" scheme: 60 substeps per frame and one constraint solve per substep. Member force comes straight from the constraint multiplier, `F = -Δλ / h²`. A two-bar check against hand statics agrees to within 0.1%.
- **Failure modes.** A member fails in tension at its yield load. In compression it fails at the lower of its yield load and the Euler buckling load `π²EI / L²`, so long struts buckle well before they crush. When a member fails it is removed, and the load redistributes or the structure collapses.
- **Moving load.** The vehicle's weight is split equally between two axles. Each axle load is shared between the two ends of the road member it is on, in proportion to its position along that member. If the deck under an axle breaks, the vehicle falls.

## Materials

| Member | Cost  | Tension | Compression (yield / π²EI) | Mass    |
|--------|-------|---------|----------------------------|---------|
| Road   | $180/m | 120 kN | 100 kN / 400 kN·m²          | 120 kg/m |
| Timber | $70/m  | 60 kN  | 45 kN / 200 kN·m²           | 35 kg/m  |
| Steel  | $220/m | 180 kN | 160 kN / 900 kN·m²          | 80 kg/m  |

The maximum member length is 4 m. Only road members carry the vehicle.

## Controls

| Action | Input |
|--------|-------|
| Add a member | Drag from any joint to a grid point or another joint |
| Change a member's material | Draw over it with another material |
| Road / Timber / Steel / Erase | `1` `2` `3` `E` |
| Run or stop the load test | `Space` |
| Undo | `Ctrl/Cmd + Z` |

The example truss is a Pratt truss. It carries the 3.5 t van on every span with about 90% peak utilisation, and the 3.6 m end posts are the critical members. To get the 7.5 t truck across the 14 m and 18 m spans, you have to deal with those end posts.

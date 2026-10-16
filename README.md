# Engineering playground

Two browser simulators, each a static page with no build step.

| Project | What it is |
|---------|------------|
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
  - joint, linear and circular interpolation, with blending
  - path checks for reach, joint limits and wrist singularities, reported with the line number
  - a work cell: a conveyor feeding boxes, a part sensor, a gripper that really grasps, a pallet user frame, a reject bin, and collision checks against the tables
  - digital I/O you can force, a speed override, an E-stop, a jog pendant (joint, base or tool), and Teach to capture the current pose as code

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

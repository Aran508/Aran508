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

"use strict";
// Six-axis articulated arm with a spherical wrist, the layout used by most
// industrial robots. One kinematic model is shared by every brand so lesson
// coordinates mean the same thing whichever language you learn in.
//
// Zero pose: upper arm vertical, forearm horizontal pointing +X, flange pointing +X.
//   J1 waist about world Z      J4 forearm roll about forearm axis
//   J2 shoulder about Y (+ leans forward)   J5 wrist bend (+90 points tool down from zero)
//   J3 elbow about Y (+ tips forearm down)  J6 flange roll

const ARM = {
  d1: 450,  // base to shoulder axis height
  a1: 150,  // shoulder offset forward of J1 axis
  a2: 600,  // upper arm length
  a3: 120,  // elbow offset (forearm axis above elbow axis)
  d4: 640,  // elbow to wrist centre along the forearm
  d6: 100,  // wrist centre to flange face
  limits: [[-170, 170], [-90, 150], [-180, 75], [-190, 190], [-125, 125], [-360, 360]],
  vmax: [150, 150, 160, 320, 320, 420], // deg/s at 100% override
};

const Trans = (x, y, z) => ({ type: "pose", p: [x, y, z], R: Mat.I() });
const RotP = (R) => ({ type: "pose", p: [0, 0, 0], R });

// Returns world frames for every link: [base, J1, J2, J3, J4, J5, flange]
function fkFrames(q) {
  const r = q.map((v) => v * DEG);
  const T0 = Pose.identity();
  const T1 = RotP(Mat.rz(r[0]));
  const T2 = Pose.mul(Pose.mul(T1, Trans(ARM.a1, 0, ARM.d1)), RotP(Mat.ry(r[1])));
  const T3 = Pose.mul(Pose.mul(T2, Trans(0, 0, ARM.a2)), RotP(Mat.ry(r[2])));
  const T4 = Pose.mul(Pose.mul(T3, Trans(0, 0, ARM.a3)), RotP(Mat.mul(Mat.ry(Math.PI / 2), Mat.rz(r[3]))));
  const T5 = Pose.mul(Pose.mul(T4, Trans(0, 0, ARM.d4)), RotP(Mat.ry(r[4])));
  const T6 = Pose.mul(Pose.mul(T5, RotP(Mat.rz(r[5]))), Trans(0, 0, ARM.d6));
  return [T0, T1, T2, T3, T4, T5, T6];
}
const fkFlange = (q) => fkFrames(q)[6];

function wrapNear(a, ref) { // pick a +-360 equivalent of a closest to ref
  while (a - ref > 180) a -= 360;
  while (a - ref < -180) a += 360;
  return a;
}

// Analytic inverse kinematics for the flange pose. Returns the solution
// (elbow up, front) closest to qRef, or { error } describing why none exists.
function ikFlange(F, qRef) {
  const W = Vec.sub(F.p, Vec.scale(Mat.col(F.R, 2), ARM.d6));
  const rxy = Math.hypot(W[0], W[1]);
  if (rxy < 60) return { error: "singular", detail: "The wrist centre is on the J1 axis (shoulder singularity)." };
  let q1 = Math.atan2(W[1], W[0]) / DEG;
  const r = rxy - ARM.a1, s = W[2] - ARM.d1;
  const L3 = Math.hypot(ARM.a3, ARM.d4), beta = Math.atan2(ARM.a3, ARM.d4);
  const D = Math.hypot(r, s);
  const c = (D * D - ARM.a2 * ARM.a2 - L3 * L3) / (2 * ARM.a2 * L3);
  if (c > 1) return { error: "reach", detail: `The point is ${(D - ARM.a2 - L3).toFixed(0)} mm beyond the arm's reach.` };
  if (c < -1) return { error: "reach", detail: "The point is too close to the robot base." };
  const th2 = -Math.acos(c);                         // elbow up
  const th1 = Math.atan2(s, r) - Math.atan2(L3 * Math.sin(th2), ARM.a2 + L3 * Math.cos(th2));
  const q2r = Math.PI / 2 - th1;
  const psi = -(th2 + th1), phi = psi + beta;
  const q2 = q2r / DEG, q3 = (phi - q2r) / DEG;

  // wrist: R36 = R03^T * R06, with R36 = Rz(q4) Ry(q5) Rz(q6)
  const R03 = Mat.mul(Mat.rz(q1 * DEG), Mat.ry(Math.PI / 2 + phi));
  const R = Mat.mul(Mat.tr(R03), F.R);
  const s5 = Math.hypot(R[2], R[5]);
  let sols = [];
  if (s5 < 1e-4) { // wrist singular: J4 and J6 line up; keep J4 where it is
    const q4 = qRef[3];
    const q46 = Math.atan2(R[3], R[0]) / DEG * (R[8] > 0 ? 1 : -1);
    const q5 = R[8] > 0 ? 0 : 180;
    sols.push([q4, q5, q46 - q4]);
  } else {
    const q5 = Math.atan2(s5, R[8]) / DEG;
    const q4 = Math.atan2(R[5], R[2]) / DEG;
    const q6 = Math.atan2(R[7], -R[6]) / DEG;
    sols.push([q4, q5, q6], [q4 + 180, -q5, q6 + 180]);
  }
  q1 = wrapNear(q1, qRef[0]);
  let best = null, bestCost = Infinity;
  for (const [a, b, c6] of sols) {
    const cand = [q1, q2, q3, wrapNear(a, qRef[3]), b, wrapNear(c6, qRef[5])];
    if (!withinLimits(cand)) continue;
    const cost = cand.reduce((acc, v, i) => acc + Math.abs(v - qRef[i]) * (i >= 3 ? 1 : 2), 0);
    if (cost < bestCost) { bestCost = cost; best = cand; }
  }
  if (!best) {
    const cand = [q1, q2, q3, wrapNear(sols[0][0], qRef[3]), sols[0][1], wrapNear(sols[0][2], qRef[5])];
    let j = cand.findIndex((v, i) => v < ARM.limits[i][0] || v > ARM.limits[i][1]);
    if (j < 0) j = 3;
    return { error: "limit", axis: j + 1, detail: `Axis ${j + 1} would need ${cand[j].toFixed(1)}°, outside its limit of ${ARM.limits[j][0]}° to ${ARM.limits[j][1]}°.` };
  }
  return { q: best };
}
function withinLimits(q) { return q.every((v, i) => v >= ARM.limits[i][0] - 1e-6 && v <= ARM.limits[i][1] + 1e-6); }

// ---- The work cell (mm, world frame = robot base) ----
const CELL = {
  floorZ: 0,          // robot stands on the floor; work tables are 400 mm high
  tableZ: 400,
  tools: [
    { name: "Flange", tcp: Pose.identity() },
    { name: "Gripper", tcp: Trans(0, 0, 160) },
  ],
  frames: [
    { name: "World", pose: Pose.identity() },
    { name: "Pallet", pose: Trans(400, 250, 400) },
  ],
  // surfaces the tool must not hit: axis-aligned tops [x0,y0,x1,y1] at height z
  surfaces: [
    { name: "conveyor", x0: 470, y0: -900, x1: 630, y1: -250, z: 400 },
    { name: "pallet table", x0: 360, y0: 210, x1: 760, y1: 520, z: 400 },
    { name: "reject bin", x0: 180, y0: -560, x1: 340, y1: -380, z: 340, wall: 470 },
  ],
  pickAt: [550, -350],
  feedFrom: [550, -860],
  boxSize: 60,
  feedCount: 6,
  rejectAt: [260, -470],
};

if (typeof module !== "undefined") module.exports = { ARM, fkFrames, fkFlange, ikFlange, CELL };

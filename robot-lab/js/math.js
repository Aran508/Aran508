"use strict";
// Rotation and pose maths shared by every module.
// Units: millimetres and degrees at the edges, radians inside trig.
// Rotation matrices are row-major arrays of 9. A pose is { p:[x,y,z], R:[9] }.

const DEG = Math.PI / 180;

const Mat = {
  I: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  rx(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; },
  ry(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; },
  rz(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
  mul(A, B) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return r;
  },
  tr(A) { return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]]; },
  mv(A, v) { return [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]]; },
  col(A, j) { return [A[j], A[3 + j], A[6 + j]]; },
};

const Vec = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

// ---- Orientation conventions used by the five controllers ----
const Rot = {
  // FANUC W,P,R and Yaskawa Rx,Ry,Rz: fixed-axis X then Y then Z  =>  R = Rz(R) * Ry(P) * Rx(W)
  fromFixedXYZ(w, p, r) { return Mat.mul(Mat.rz(r * DEG), Mat.mul(Mat.ry(p * DEG), Mat.rx(w * DEG))); },
  toFixedXYZ(R) {
    const p = Math.asin(Math.max(-1, Math.min(1, -R[6])));
    let w, r;
    if (Math.abs(Math.cos(p)) > 1e-6) { w = Math.atan2(R[7], R[8]); r = Math.atan2(R[3], R[0]); }
    else { w = Math.atan2(-R[5], R[4]); r = 0; }
    return [w / DEG, p / DEG, r / DEG];
  },
  // KUKA A,B,C: Z-Y'-X'' Euler  =>  R = Rz(A) * Ry(B) * Rx(C)
  fromZYX(a, b, c) { return Rot.fromFixedXYZ(c, b, a); },
  toZYX(R) { const [w, p, r] = Rot.toFixedXYZ(R); return [r, p, w]; },
  // ABB quaternion [q1,q2,q3,q4] = [w,x,y,z]
  fromQuat(q) {
    let [w, x, y, z] = q; const n = Math.hypot(w, x, y, z) || 1; w /= n; x /= n; y /= n; z /= n;
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  },
  toQuat(R) {
    const t = R[0] + R[4] + R[8];
    let w, x, y, z;
    if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (R[7] - R[5]) / s; y = (R[2] - R[6]) / s; z = (R[3] - R[1]) / s; }
    else if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; w = (R[7] - R[5]) / s; x = s / 4; y = (R[1] + R[3]) / s; z = (R[2] + R[6]) / s; }
    else if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; w = (R[2] - R[6]) / s; x = (R[1] + R[3]) / s; y = s / 4; z = (R[5] + R[7]) / s; }
    else { const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; w = (R[3] - R[1]) / s; x = (R[2] + R[6]) / s; y = (R[5] + R[7]) / s; z = s / 4; }
    const lead = [w, x, y, z].find((v) => Math.abs(v) > 1e-9) || 1;
    if (lead < 0) { w = -w; x = -x; y = -y; z = -z; }
    [w, x, y, z] = [w, x, y, z].map((v) => (Math.abs(v) < 1e-12 ? 0 : v));
    return [w, x, y, z];
  },
  // Universal Robots rotation vector (axis * angle, radians)
  fromRotVec(v) {
    const th = Math.hypot(v[0], v[1], v[2]);
    if (th < 1e-12) return Mat.I();
    const s = Math.sin(th / 2) / th;
    return Rot.fromQuat([Math.cos(th / 2), v[0] * s, v[1] * s, v[2] * s]);
  },
  toRotVec(R) {
    const [w, x, y, z] = Rot.toQuat(R);
    const th = 2 * Math.acos(Math.max(-1, Math.min(1, w)));
    const s = Math.sqrt(Math.max(0, 1 - w * w));
    if (s < 1e-9) return [0, 0, 0];
    return [x / s * th, y / s * th, z / s * th];
  },
  slerp(Ra, Rb, t) {
    const a = Rot.toQuat(Ra); let b = Rot.toQuat(Rb);
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map((v) => -v); d = -d; }
    let q;
    if (d > 0.9995) q = a.map((v, i) => v + (b[i] - v) * t);
    else {
      const th = Math.acos(d), s = Math.sin(th);
      const k0 = Math.sin((1 - t) * th) / s, k1 = Math.sin(t * th) / s;
      q = a.map((v, i) => v * k0 + b[i] * k1);
    }
    return Rot.fromQuat(q);
  },
  angleBetween(Ra, Rb) {
    const a = Rot.toQuat(Ra), b = Rot.toQuat(Rb);
    const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    return 2 * Math.acos(Math.min(1, d)) / DEG;
  },
};

const Pose = {
  make: (p, R, frame) => ({ type: "pose", p: p.slice(), R: R.slice(), frame }),
  mul: (A, B) => ({ type: "pose", p: Vec.add(A.p, Mat.mv(A.R, B.p)), R: Mat.mul(A.R, B.R) }),
  inv: (A) => { const Rt = Mat.tr(A.R); return { type: "pose", p: Vec.scale(Mat.mv(Rt, A.p), -1), R: Rt }; },
  identity: () => ({ type: "pose", p: [0, 0, 0], R: Mat.I() }),
};

// Joint values are kept internally in degrees, in the simulator's own zero convention.
const Joints = { make: (q) => ({ type: "joints", q: q.slice() }) };

if (typeof module !== "undefined") module.exports = { DEG, Mat, Vec, Rot, Pose, Joints };

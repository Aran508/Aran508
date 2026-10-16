"use strict";
// Curriculum. Each lesson's program is written once as a brand-neutral recipe
// and generated into idiomatic RAPID, TP, KRL, URScript and INFORM.

const DOWN = [180, 0, 0];
const PTS = {
  pHome: { x: 450, y: 0, z: 800 },
  pPick: { x: 550, y: -350, z: 430 },
  pDrop: { x: 460, y: 310, z: 430 },
  pReject: { x: 260, y: -470, z: 560 },
  pA: { x: 550, y: -350, z: 650 },
  pB: { x: 460, y: 310, z: 650 },
};
const pick = (...names) => Object.fromEntries(names.map((n) => [n, PTS[n]]));
const UP100 = { d: [0, 0, 100], mode: "base" };

const PICK_OPS = [
  ["jo", "pPick", 60, 20, UP100],
  ["l", "pPick", 150, 0],
  ["grip", true],
  ["wait", 0.4],
  ["l", "pPick", 300, 20, UP100],
];
const dropOps = (off) => [
  ["jo", "pDrop", 60, 20, off ? { d: [off, 0, 100], mode: "base" } : UP100],
  ["l", "pDrop", 150, 0, off ? { d: [off, 0, 0], mode: "base" } : undefined],
  ["grip", false],
  ["wait", 0.4],
  ["l", "pDrop", 300, 20, off ? { d: [off, 0, 100], mode: "base" } : UP100],
];

const SYNTAX = {
  program:   { what: "Program frame", abb: "MODULE MainModule\n  PROC main()\n  ENDPROC\nENDMODULE", fanuc: "/PROG PICK_PLACE\n/MN\n   1:  ... ;\n/POS\n/END", kuka: "DEF PickPlace( )\n  ...\nEND", ur: "def pick_place():\n  ...\nend", yaskawa: "/JOB\n//NAME PICK_PLACE\n//POS ... //INST\nNOP\n...\nEND" },
  point:     { what: "Cartesian point", abb: "CONST robtarget pPick :=\n  [[550,-350,430],[0,0,1,0],[0,0,0,0],[9E9,...]];", fanuc: "P[2:\"PICK\"]{ GP1: UF:0, UT:1,\n  X=550 mm, Y=-350 mm, Z=430 mm,\n  W=180 deg, P=0 deg, R=0 deg };", kuka: "pPick = {X 550,Y -350,Z 430,A 0,B 90,C 0}", ur: "pick = p[0.55, -0.35, 0.43, 3.1416, 0, 0]", yaskawa: "C00001=550.000,-350.000,430.000,180.00,0.00,0.00" },
  jointpoint:{ what: "Joint position", abb: "CONST jointtarget jHome :=\n  [[0,0,0,0,90,0],[9E9,...]];", fanuc: "P[1]{ GP1: J1= 0 deg, ... J5= 90 deg, J6= 0 deg };", kuka: "jHome = {A1 0,A2 -90,A3 90,A4 0,A5 90,A6 0}", ur: "home_q = [0, 0, 0, 0, 1.5708, 0]", yaskawa: "///PULSE\nC00000=0,0,0,0,90000,0" },
  movej:     { what: "Joint move", abb: "MoveJ pHome, v1500, fine, tGripper;\nMoveAbsJ jHome, v1000, fine, tGripper;", fanuc: "J P[1:HOME] 50% FINE ;", kuka: "PTP pHome", ur: "movej(home, a=1.4, v=1.57)", yaskawa: "MOVJ C00000 VJ=50.00" },
  movel:     { what: "Linear move", abb: "MoveL pPick, v150, fine, tGripper;", fanuc: "L P[2:PICK] 150mm/sec FINE ;", kuka: "LIN pPick", ur: "movel(pick, a=1.2, v=0.15)", yaskawa: "MOVL C00001 V=150.0" },
  movec:     { what: "Circular move", abb: "MoveC pVia, pEnd, v300, z10, tGripper;", fanuc: "C P[3:VIA]\n    :  P[4:END] 300mm/sec FINE ;", kuka: "CIRC pVia, pEnd", ur: "movec(via, end, a=1.2, v=0.3)", yaskawa: "MOVC C00002 V=300.0   (start)\nMOVC C00003 V=300.0   (via)\nMOVC C00004 V=300.0   (end)" },
  speed:     { what: "Speed", abb: "v100 ... v7000  (TCP mm/s)", fanuc: "50%  for J,  500mm/sec  for L and C", kuka: "BAS(#VEL_PTP, 50)   ; PTP %\n$VEL.CP = 0.5       ; LIN m/s", ur: "movej v in rad/s, movel v in m/s", yaskawa: "VJ=50.00 (%)  for MOVJ\nV=500.0 (mm/s) for MOVL" },
  zone:      { what: "Stop or blend", abb: "fine = stop exactly\nz10, z50 = blend radius in mm", fanuc: "FINE = stop exactly\nCNT0 ... CNT100 = round the corner", kuka: "$APO.CDIS = 50\nLIN p1 C_DIS", ur: "movel(p, v=0.5, r=0.05)   # blend 50 mm", yaskawa: "PL=0 stop\nPL=1 ... PL=8 round the corner" },
  offset:    { what: "Offset in base frame", abb: "MoveL Offs(pPick,0,0,100), v300, z20, tGripper;", fanuc: "PR[1,3]=100 ;\nL P[2] 300mm/sec CNT20 Offset,PR[1] ;", kuka: "pTmp = pPick\npTmp.Z = pTmp.Z + 100\nLIN pTmp", ur: "movel(pose_add(pick, p[0,0,0.1,0,0,0]))", yaskawa: "SETE P000 (3) 100000\nSFTON P000\nMOVL C00001 V=300.0\nSFTOF" },
  relmove:   { what: "Relative move", abb: "MoveL Offs(CRobT(),0,0,100), v200, fine, tGripper;\nMoveL RelTool(CRobT(),0,0,100), ...;", fanuc: "PR[6]=LPOS ;\nL PR[6] 200mm/sec FINE Tool_Offset,PR[5] ;", kuka: "LIN_REL {Z 100} #BASE\nLIN_REL {X 100} #TOOL", ur: "movel(pose_trans(get_actual_tcp_pose(), p[0,0,0.1,0,0,0]))", yaskawa: "SETE P011 (3) 100000\nIMOV P011 V=200.0 TF" },
  tool:      { what: "Tool (TCP)", abb: "PERS tooldata tGripper :=\n  [TRUE,[[0,0,160],[1,0,0,0]],...];", fanuc: "UTOOL_NUM=1 ;", kuka: "$TOOL = TOOL_DATA[1]", ur: "set_tcp(p[0, 0, 0.16, 0, 0, 0])", yaskawa: "///TOOL 1   (job header)" },
  frame:     { what: "User / work-object frame", abb: "MoveL pSlot, v200, fine, tGripper\\WObj:=wPallet;", fanuc: "UFRAME_NUM=1 ;", kuka: "$BASE = BASE_DATA[1]", ur: "slot = pose_trans(pallet, p[0.06,0.06,0.03,0,0,0])", yaskawa: "///USER 1\n///POSTYPE USER   (points below are in user frame 1)" },
  setdo:     { what: "Set an output", abb: "SetDO doGripper, 1;\nSet doGripper;  Reset doGripper;", fanuc: "DO[1]=ON ;", kuka: "$OUT[1] = TRUE", ur: "set_digital_out(0, True)", yaskawa: "DOUT OT#(1) ON" },
  waitdi:    { what: "Wait for an input", abb: "WaitDI diPartReady, 1;", fanuc: "WAIT DI[1]=ON ;", kuka: "WAIT FOR $IN[1] == TRUE", ur: "while get_digital_in(0) != True:\n  sync()\nend", yaskawa: "WAIT IN#(1)=ON" },
  wait:      { what: "Wait a time", abb: "WaitTime 0.5;", fanuc: "WAIT 0.50(sec) ;", kuka: "WAIT SEC 0.5", ur: "sleep(0.5)", yaskawa: "TIMER T=0.50" },
  var:       { what: "Number variable", abb: "VAR num count := 0;", fanuc: "R[1:count]", kuka: "DECL INT count\ncount = 0", ur: "count = 0", yaskawa: "I000  (integer)\nD000  (double)\nP000  (position)" },
  assign:    { what: "Change a variable", abb: "count := count + 1;\nIncr count;", fanuc: "R[1]=R[1]+1 ;", kuka: "count = count + 1", ur: "count = count + 1", yaskawa: "INC I000\nADD I000 2\nSET I000 0" },
  for:       { what: "Counted loop", abb: "FOR i FROM 1 TO 3 DO\n  ...\nENDFOR", fanuc: "FOR R[2]=1 TO 3 ;\n  ...\nENDFOR ;", kuka: "FOR i = 1 TO 3\n  ...\nENDFOR", ur: "i = 1\nwhile i <= 3:\n  ...\n  i = i + 1\nend", yaskawa: "SET I001 1\n*L0\n  ...\nINC I001\nJUMP *L0 IF I001<=3" },
  while:     { what: "Conditional loop", abb: "WHILE count < 4 DO\n  ...\nENDWHILE", fanuc: "LBL[1] ;\nIF R[1]>=4,JMP LBL[2] ;\n  ...\nJMP LBL[1] ;\nLBL[2] ;", kuka: "WHILE count < 4\n  ...\nENDWHILE", ur: "while count < 4:\n  ...\nend", yaskawa: "*W0\nJUMP *WE0 IF I000>=4\n  ...\nJUMP *W0\n*WE0" },
  if:        { what: "Decision", abb: "IF diReject = 1 THEN\n  ...\nELSE\n  ...\nENDIF", fanuc: "IF (DI[3]=ON) THEN ;\n  ...\nELSE ;\n  ...\nENDIF ;", kuka: "IF $IN[3] == TRUE THEN\n  ...\nELSE\n  ...\nENDIF", ur: "if get_digital_in(2) == True:\n  ...\nelse:\n  ...\nend", yaskawa: "JUMP *ELSE0 IF IN#(3)=OFF\n  ...\nJUMP *ENDIF0\n*ELSE0\n  ...\n*ENDIF0" },
  call:      { what: "Call a routine", abb: "Pick;", fanuc: "CALL PICK ;", kuka: "Pick( )", ur: "pick()", yaskawa: "CALL JOB:PICK" },
  msg:       { what: "Message / comment", abb: "TPWrite \"Part done\";\n! comment", fanuc: "MESSAGE[Part done] ;\n!comment ;", kuka: "; comment", ur: "textmsg(\"Part done\")\n# comment", yaskawa: "'comment" },
};

const LESSONS = [
  {
    id: "axes", part: "Foundations", title: "The six-axis arm",
    lead: "An industrial arm is a chain of six rotary joints. Learn what each one does before you write a single move.",
    body: `
<p>Axes 1 to 3 are the <b>major axes</b>. They put the wrist somewhere in space. Axis 1 turns the whole arm at the waist. Axis 2 tips the upper arm forward and back at the shoulder. Axis 3 bends the elbow.</p>
<p>Axes 4 to 6 are the <b>wrist axes</b>. They point the tool. Axis 4 rolls the forearm, axis 5 bends the wrist, and axis 6 turns the flange where the gripper is bolted.</p>
<p>Every joint has <b>software limits</b>. Asking for an angle outside them stops the program. The joint bars in the viewport show where each axis sits inside its range.</p>`,
    points: ["Axes 1 to 3 position the wrist. Axes 4 to 6 orient the tool.", "A joint position fully describes the arm. No inverse kinematics is needed.", "Watch the joint bars: an axis near the end of its bar is close to a limit."],
    notes: {
      abb: "ABB calls the axes <code>rax_1</code> to <code>rax_6</code> inside a <code>jointtarget</code>. <code>MoveAbsJ</code> moves straight to joint angles.",
      fanuc: "FANUC stores a joint position as a P[ ] with J1 to J6 values in degrees. On a real controller you switch the pendant's display between JOINT and Cartesian representation.",
      kuka: "KUKA names the axes A1 to A6, and its zero is different: the arm stands upright at A2 = -90° and A3 = +90°. This simulator converts for you.",
      ur: "UR names the joints Base, Shoulder, Elbow, Wrist 1, 2 and 3. URScript joint lists are in <b>radians</b>, so 90° is 1.5708.",
      yaskawa: "Yaskawa names the axes S, L, U, R, B and T. Joint positions are stored as encoder <b>pulses</b>. Real pulse counts depend on the model. This simulator uses 1000 pulses per degree.",
    },
    task: "Change the angle of one move and run the program again. Try an angle past a joint limit and read the error.",
    concepts: ["jointpoint", "movej"],
    recipe: {
      name: "Axes", title: "Lesson 1: meet the six axes",
      points: {},
      joints: { jHome: [0, 0, 0, 0, 90, 0], jAx1: [60, 0, 0, 0, 90, 0], jAx2: [0, 35, 0, 0, 90, 0], jAx3: [0, 0, 45, 0, 45, 0], jAx4: [0, 0, 0, 90, 90, 0], jAx5: [0, 0, 0, 0, 30, 0], jAx6: [0, 0, 0, 0, 90, 180] },
      main: [
        ["c", "Start upright with the tool pointing down"], ["j", "jHome", 40, 0],
        ["c", "Axis 1: waist"], ["j", "jAx1", 40, 0], ["j", "jHome", 40, 0],
        ["c", "Axis 2: shoulder"], ["j", "jAx2", 40, 0], ["j", "jHome", 40, 0],
        ["c", "Axis 3: elbow"], ["j", "jAx3", 40, 0], ["j", "jHome", 40, 0],
        ["c", "Axis 4: forearm roll"], ["j", "jAx4", 40, 0], ["j", "jHome", 40, 0],
        ["c", "Axis 5: wrist bend"], ["j", "jAx5", 40, 0], ["j", "jHome", 40, 0],
        ["c", "Axis 6: flange roll"], ["j", "jAx6", 40, 0], ["j", "jHome", 40, 0],
      ],
    },
  },
  {
    id: "frames", part: "Foundations", title: "Coordinate systems",
    lead: "The same move means different things in different frames. Base, tool and user frames are the robot's three points of view.",
    body: `
<p>The <b>base frame</b> sits at the foot of the robot: X points forward, Y to the left and Z up. Most positions are written in it.</p>
<p>The <b>tool frame</b> rides on the gripper. Its origin is the <b>tool centre point (TCP)</b>, which is the point the robot actually steers. Here Z points out of the gripper. A move of +100 mm in tool Z pushes the gripper along the direction it points, whatever that is.</p>
<p>A <b>user frame</b> (also called a work object or base) is a frame you attach to a fixture, such as a pallet. Teach your points relative to it. If the fixture moves, you re-teach three points and the whole program follows.</p>
<p>The program below makes relative moves in the base frame, then tilts the tool 30° and makes the same push in the tool frame. The trail shows the difference.</p>`,
    points: ["Base frame: fixed to the robot's foot.", "Tool frame: fixed to the TCP and moves with the tool.", "User frame: fixed to the workpiece or fixture.", "Use the viewport's frame toggles and jog buttons to see each one."],
    notes: {
      abb: "ABB calls a user frame a <b>work object</b> (<code>wobjdata</code>). Every move can take <code>\\WObj:=</code>. <code>Offs()</code> offsets in the work object frame and <code>RelTool()</code> offsets in the tool frame.",
      fanuc: "FANUC selects frames by number: <code>UTOOL_NUM</code> for the tool and <code>UFRAME_NUM</code> for the user frame. Each point remembers the UF and UT it was taught in, and the robot refuses to move if they don't match the active numbers.",
      kuka: "KUKA uses <code>$TOOL</code> and <code>$BASE</code>. Note that KUKA tools point along their <b>X</b> axis, not Z, so a tool-frame push is <code>LIN_REL {X 100} #TOOL</code>.",
      ur: "UR has a single active TCP (<code>set_tcp</code>). User frames are ordinary poses that you compose with <code>pose_trans(frame, point)</code>.",
      yaskawa: "Yaskawa sets the tool in the job header (<code>///TOOL</code>). Points can be stored in a user frame (<code>///USER 1</code>), and <code>IMOV</code> takes BF, RF, TF or UF to choose the frame for an increment.",
    },
    task: "Change the tilt of pTilt, or push along tool X instead of Z, and predict the path before you run it.",
    concepts: ["relmove", "tool", "frame"],
    recipe: {
      name: "Frames", title: "Lesson 2: base frame vs tool frame",
      points: { pHome: PTS.pHome, pTilt: { x: 500, y: 0, z: 700, o: [150, 0, 0] } },
      main: [
        ["tool", 1], ["j", "pHome", 50, 0],
        ["c", "Relative moves in the base frame"],
        ["lrel", [150, 0, 0], "base", 200], ["lrel", [-150, 0, 0], "base", 200],
        ["lrel", [0, 150, 0], "base", 200], ["lrel", [0, -150, 0], "base", 200],
        ["lrel", [0, 0, -150], "base", 200], ["lrel", [0, 0, 150], "base", 200],
        ["c", "Tilt the tool 30 degrees, then push along tool Z"],
        ["j", "pTilt", 40, 0],
        ["lrel", [0, 0, 150], "tool", 150], ["lrel", [0, 0, -150], "tool", 150],
        ["c", "The same push in base Z goes straight down"],
        ["lrel", [0, 0, -150], "base", 150], ["lrel", [0, 0, 150], "base", 150],
        ["j", "pHome", 50, 0],
      ],
    },
  },
  {
    id: "first", part: "Foundations", title: "Your first program",
    lead: "Every robot program has the same anatomy: a header, position data, the instructions, and an end.",
    body: `
<p>Look at the program on the right. It has the same parts whatever the brand:</p>
<ol><li><b>Header</b>: the program or module name.</li><li><b>Position data</b>: the points the robot will visit. Here these are home and two points above the work.</li><li><b>Instructions</b>: run from top to bottom, one at a time. The highlighted line is the one executing.</li><li><b>End</b>: the program stops, or returns to whatever called it.</li></ol>
<p>Press <b>Step</b> to run one instruction at a time. That is how a programmer checks a new program on a real robot, at low speed, with a hand on the enable switch.</p>`,
    points: ["Programs run top to bottom, one instruction at a time.", "Positions are data. Instructions refer to them by name.", "Step through new programs before running them continuously."],
    notes: {
      abb: "RAPID code lives in a <code>MODULE</code>. Execution starts at <code>PROC main()</code>. Statements end with a semicolon.",
      fanuc: "A TP program is a list of numbered lines ending in <code>;</code>. Motion lines start with J, L or C. Positions sit in the separate /POS section.",
      kuka: "A KRL program is a <code>DEF</code> ... <code>END</code> block. On a real robot the positions usually live in a matching .dat file. Here they're declared at the top.",
      ur: "A URScript program is a function: <code>def name():</code> ... <code>end</code>. Indentation is for people only. Blocks close with <code>end</code>.",
      yaskawa: "An INFORM job lists its positions under //POS, then its instructions under //INST, starting with NOP and finishing with END.",
    },
    task: "Add a third point and a move to it. Use Teach in the viewport to capture the current position as code.",
    concepts: ["program", "point", "movej"],
    recipe: {
      name: "First", title: "Lesson 3: a first program",
      points: pick("pHome", "pA", "pB"),
      main: [["tool", 1], ["j", "pHome", 50, 0], ["j", "pA", 50, 0], ["j", "pB", 50, 0], ["j", "pHome", 50, 0]],
    },
  },
  {
    id: "jl", part: "Motion", title: "Joint vs linear motion",
    lead: "Two ways to get from A to B: the fastest way for the joints, or a straight line for the tool.",
    body: `
<p>A <b>joint move</b> (MoveJ, J, PTP, movej, MOVJ) interpolates the joint angles. All six axes start and stop together. It is the fastest and safest way to travel through open space, but the tool follows a curve you didn't draw.</p>
<p>A <b>linear move</b> (MoveL, L, LIN, movel, MOVL) drives the TCP along a straight line and keeps the orientation smooth. Use it close to parts and fixtures, where the path matters. The controller solves the inverse kinematics many times along the way, so a linear path can fail where a joint move would not.</p>
<p>Run the program and compare the trails: <span class="tj">joint moves</span> curve, <span class="tl">linear moves</span> are straight.</p>`,
    points: ["Joint moves for travel, linear moves near the work.", "A linear path must be reachable at every point, not just at the ends.", "Joint speed is a percentage. Linear speed is mm/s at the TCP."],
    notes: {
      abb: "<code>MoveJ</code> speed is still written as speeddata (v1500), but the controller limits it by the slowest axis.",
      fanuc: "<code>J</code> takes a percentage, <code>L</code> takes mm/sec. Mixing them up is a common beginner error, and the simulator will tell you.",
      kuka: "<code>PTP</code> uses the axis speeds set by <code>BAS(#VEL_PTP, %)</code>. <code>LIN</code> uses <code>$VEL.CP</code> in metres per second.",
      ur: "<code>movej</code> accepts either a pose or a joint list. <code>movel</code> speed <code>v</code> is in m/s.",
      yaskawa: "<code>MOVJ</code> speed is <code>VJ=</code> (percent). <code>MOVL</code> speed is <code>V=</code> (mm/s).",
    },
    task: "Swap the joint moves and linear moves around and watch the trails change.",
    concepts: ["movej", "movel", "speed"],
    recipe: {
      name: "JointVsLinear", title: "Lesson 4: joint vs linear",
      points: pick("pHome", "pA", "pB"),
      main: [
        ["tool", 1], ["j", "pHome", 50, 0],
        ["c", "Joint moves: curved TCP path"], ["j", "pA", 50, 0], ["j", "pB", 50, 0],
        ["c", "Linear moves: straight TCP path"], ["l", "pA", 400, 0], ["l", "pB", 400, 0],
        ["j", "pHome", 50, 0],
      ],
    },
  },
  {
    id: "offsets", part: "Motion", title: "Approach and retract",
    lead: "Never drive straight at a part. Approach from above, go in slowly in a straight line, and come back out the same way.",
    body: `
<p>A good pick has three moves: a fast <b>joint move to an approach point</b> 100 mm above the part, a slow <b>linear move down</b>, and a <b>linear retract</b> back up.</p>
<p>You don't teach the approach point separately. You compute it from the pick point with an <b>offset</b>. If someone re-teaches the pick point, the approach moves with it automatically.</p>
<p>An offset in the <b>base frame</b> adds to X, Y and Z of the world. An offset in the <b>tool frame</b> moves along the tool's own axes. That is useful when the part is tilted.</p>`,
    points: ["Approach and retract with linear moves at low speed.", "Compute approach points with offsets instead of teaching extra points.", "Blend the approach (zone) but stop exactly (fine) at the part."],
    notes: {
      abb: "<code>Offs(p, x, y, z)</code> offsets in the work-object frame. <code>RelTool(p, x, y, z)</code> offsets in the tool frame.",
      fanuc: "Load the offset into a position register (<code>PR[1,3]=100</code>), then add <code>Offset,PR[1]</code> to the motion line. <code>Tool_Offset</code> uses the tool frame.",
      kuka: "Copy the point into a temporary variable and change one field: <code>pTmp.Z = pTmp.Z + 100</code>.",
      ur: "<code>pose_add(p, p[0,0,0.1,0,0,0])</code> offsets in the base frame. <code>pose_trans(p, ...)</code> offsets in the tool frame.",
      yaskawa: "Put the offset in a P variable with <code>SETE</code> (units of 0.001 mm), then wrap the moves in <code>SFTON P000</code> ... <code>SFTOF</code>.",
    },
    task: "Change the approach height to 50 mm. Then try 0 mm and notice why it matters.",
    concepts: ["offset", "movel", "zone"],
    recipe: {
      name: "Approach", title: "Lesson 5: approach and retract",
      points: pick("pHome", "pPick"),
      main: [
        ["tool", 1], ["j", "pHome", 50, 0],
        ["c", "Fast joint move to 100 mm above the part"], ["jo", "pPick", 60, 0, UP100],
        ["c", "Slow straight-line approach"], ["l", "pPick", 120, 0],
        ["wait", 0.5],
        ["c", "Retract along the same line"], ["l", "pPick", 200, 0, UP100],
        ["j", "pHome", 50, 0],
      ],
    },
  },
  {
    id: "blend", part: "Motion", title: "Speed and blending",
    lead: "Stopping at every point wastes cycle time. Blending lets the robot round the corners.",
    body: `
<p>With a <b>fine</b> point, the robot decelerates to a stop exactly on the point before starting the next move. That is precise but slow.</p>
<p>With a <b>zone</b> (ABB z50, FANUC CNT, KUKA C_DIS, UR r, Yaskawa PL), the robot starts the next move early and cuts the corner. The bigger the zone, the smoother and faster the path, and the further it strays from the taught point.</p>
<p>The program drives a square twice: once with fine points, once blended and faster. Compare the corners in the trail and the cycle time in the status bar.</p>`,
    points: ["Use fine where accuracy matters: picking, placing, welding starts.", "Use zones for travel and approach points.", "Cycle time drops a lot with blending, but corners are cut."],
    notes: {
      abb: "Zones are <code>z0</code> to <code>z200</code> (radius in mm). <code>fine</code> also waits for the robot to settle.",
      fanuc: "<code>CNT0</code> to <code>CNT100</code> sets how much the corner is rounded. It is a percentage of deceleration, not a distance. The simulator treats CNT n as about n mm.",
      kuka: "Set <code>$APO.CDIS</code> (mm), then add <code>C_DIS</code> to each LIN you want blended.",
      ur: "The <code>r</code> argument is the blend radius in metres. <code>r=0</code> stops at the point.",
      yaskawa: "<code>PL=0</code> is a full stop. <code>PL=1</code> to <code>PL=8</code> blend more and more.",
    },
    task: "Increase the blend on the second square until the corners nearly disappear, and watch the cycle time.",
    concepts: ["zone", "speed", "movel"],
    recipe: {
      name: "Blending", title: "Lesson 6: fine points vs blending",
      points: { pHome: PTS.pHome, pSq1: { x: 400, y: -200, z: 650 }, pSq2: { x: 700, y: -200, z: 650 }, pSq3: { x: 700, y: 200, z: 650 }, pSq4: { x: 400, y: 200, z: 650 } },
      main: [
        ["tool", 1], ["j", "pHome", 50, 0], ["j", "pSq1", 50, 0],
        ["c", "Square with fine points: stops at each corner"],
        ["l", "pSq2", 400, 0], ["l", "pSq3", 400, 0], ["l", "pSq4", 400, 0], ["l", "pSq1", 400, 0],
        ["c", "Same square blended with a 60 mm zone, faster"],
        ["l", "pSq2", 800, 60], ["l", "pSq3", 800, 60], ["l", "pSq4", 800, 60], ["l", "pSq1", 800, 0],
        ["j", "pHome", 50, 0],
      ],
    },
  },
  {
    id: "circle", part: "Motion", title: "Circular motion",
    lead: "Arcs are defined by three points: where you are, a point on the way, and where you end.",
    body: `
<p>A <b>circular move</b> drives the TCP along the unique circle through the start point (where the robot is now), a <b>via point</b> (also called an auxiliary or circle point), and an <b>end point</b>.</p>
<p>One circular instruction can't draw a full circle, because the start and end would be the same point. Use two half circles instead. This is common in gluing, sealing and deburring.</p>
<p>If the three points lie on a straight line there is no circle through them, and the controller stops with an error.</p>`,
    points: ["Start + via + end define the arc.", "Use two instructions for a full circle.", "Spread the via point out. Points too close together give an unstable arc."],
    notes: {
      abb: "<code>MoveC pVia, pEnd, v, z, tool;</code> starts from the current position.",
      fanuc: "The C instruction spans two lines: <code>C P[via]</code> then <code>: P[end] speed term</code>.",
      kuka: "<code>CIRC pAux, pEnd</code>. An optional <code>CA</code> angle (not simulated) lets you go further around the circle.",
      ur: "<code>movec(pose_via, pose_to, a, v, r)</code>.",
      yaskawa: "INFORM uses three consecutive <code>MOVC</code> lines: the start, a point on the arc, and the end. Two more MOVC lines continue the circle.",
    },
    task: "Move the via point out by 50 mm and see how the arc changes. Then put it on the straight line and read the error.",
    concepts: ["movec"],
    recipe: {
      name: "Circle", title: "Lesson 7: a full circle from two arcs",
      points: { pHome: PTS.pHome, pC1: { x: 400, y: 0, z: 650 }, pC2: { x: 550, y: 150, z: 650 }, pC3: { x: 700, y: 0, z: 650 }, pC4: { x: 550, y: -150, z: 650 } },
      main: [
        ["tool", 1], ["j", "pHome", 50, 0], ["j", "pC1", 50, 0], ["l", "pC1", 200, 0],
        ["c", "First half circle"], ["circ", "pC2", "pC3", 250, 0],
        ["c", "Second half circle back to the start"], ["circ", "pC4", "pC1", 250, 0],
        ["j", "pHome", 50, 0],
      ],
    },
  },
  {
    id: "gripper", part: "I/O and logic", title: "Gripper outputs",
    lead: "The robot talks to the world through digital I/O. Output 1 closes the gripper.",
    body: `
<p>A <b>digital output</b> is a switch the program turns on or off. Here output 1 drives the gripper's valve: on closes the fingers, off opens them. Watch the I/O lamps in the viewport.</p>
<p>A real gripper takes time to close, so programs <b>wait</b> a short time after switching it before moving. Without that wait the robot can leave before the part is held. That is one of the most common causes of dropped parts.</p>
<p>The program below picks the part off the conveyor and puts it on the table.</p>`,
    points: ["Set the output, then wait for the gripper to act.", "Open the gripper at the start of a program so it is in a known state.", "Pick and place at fine points, never inside a zone."],
    notes: {
      abb: "<code>SetDO doGripper, 1;</code> or the shortcuts <code>Set</code> and <code>Reset</code>. Signal names come from the I/O configuration.",
      fanuc: "<code>DO[1]=ON ;</code>. Robot outputs <code>RO[ ]</code> are wired to the end effector on many FANUC arms.",
      kuka: "<code>$OUT[1] = TRUE</code>.",
      ur: "Digital outputs count from <b>0</b>: <code>set_digital_out(0, True)</code> is the first output.",
      yaskawa: "<code>DOUT OT#(1) ON</code>.",
    },
    task: "Remove the wait after closing the gripper. Does the part still come along? (The simulator is forgiving. A real gripper isn't.)",
    concepts: ["setdo", "wait"],
    recipe: {
      name: "Gripper", title: "Lesson 8: pick a part with the gripper",
      points: pick("pHome", "pPick", "pDrop"),
      main: [
        ["tool", 1], ["grip", false], ["j", "pHome", 50, 0],
        ["c", "Pick from the conveyor"], ...PICK_OPS,
        ["c", "Place on the table"], ...dropOps(0),
        ["j", "pHome", 50, 0],
      ],
    },
  },
  {
    id: "sensors", part: "I/O and logic", title: "Waiting for sensors",
    lead: "A robot must wait for the world. Inputs tell it when a part has arrived or when an operator presses a button.",
    body: `
<p>A <b>digital input</b> is a signal the robot reads: a sensor, a button, or a signal from the cell's PLC. Input 1 is a part-present sensor at the end of the conveyor. It turns on when a box arrives.</p>
<p>A <b>wait for input</b> instruction pauses the program until the signal has the value you asked for. The robot stays still and the lamp blinks while it waits.</p>
<p>After one cycle, the program waits on input 2, the operator's start button. Click the DI 2 lamp in the viewport to press it.</p>`,
    points: ["Always wait for part-present before picking.", "Inputs can be toggled by hand in the I/O panel, just as you would force them on a real pendant.", "A wait with no timeout can wait forever. Production code adds timeouts and alarms."],
    notes: {
      abb: "<code>WaitDI diPartReady, 1;</code>. Add <code>\\MaxTime:=5</code> on a real robot to raise an error instead of waiting forever.",
      fanuc: "<code>WAIT DI[1]=ON ;</code>. Add <code>TIMEOUT,LBL[9]</code> to jump to an error handler.",
      kuka: "<code>WAIT FOR $IN[1] == TRUE</code>.",
      ur: "URScript has no wait-for-input instruction, so you loop: <code>while get_digital_in(0) != True: sync() end</code>.",
      yaskawa: "<code>WAIT IN#(1)=ON</code>. Add <code>T=5.00</code> for a timeout.",
    },
    task: "Turn off Auto sensors, run the program, and feed the part yourself by clicking DI 1.",
    concepts: ["waitdi", "msg"],
    recipe: {
      name: "Sensors", title: "Lesson 9: wait for part and start button",
      points: pick("pHome", "pPick", "pDrop"),
      main: [
        ["tool", 1], ["grip", false], ["j", "pHome", 50, 0],
        ["msg", "Waiting for a part"], ["waitdi", 1, true],
        ...PICK_OPS, ...dropOps(0),
        ["j", "pHome", 50, 0],
        ["msg", "Press DI 2 to place a second part"], ["waitdi", 2, true],
        ["waitdi", 1, true], ...PICK_OPS, ...dropOps(90),
        ["j", "pHome", 50, 0],
      ],
    },
  },
  {
    id: "loops", part: "I/O and logic", title: "Variables and loops",
    lead: "Don't copy and paste the same moves. Loop over them and let a counter shift each place position.",
    body: `
<p>A <b>variable</b> holds a value the program can change, here a counter. A <b>counted loop</b> repeats its body a fixed number of times while the counter steps 1, 2, 3.</p>
<p>The counter also drives the geometry: each part is placed <code>(i - 1) × 90 mm</code> further along X. One taught point plus arithmetic gives you a whole row. This is the first step towards palletizing.</p>`,
    points: ["Loops remove duplicated code.", "Use the loop counter to compute offsets.", "Watch the variable values change in the Variables panel."],
    notes: {
      abb: "<code>FOR i FROM 1 TO 3 DO</code> ... <code>ENDFOR</code>. The loop variable needs no declaration.",
      fanuc: "TP counters are <b>registers</b>: <code>R[1]</code> to <code>R[200]</code>. A comment inside the brackets names them: <code>R[1:count]</code>. Newer controllers support <code>FOR</code>/<code>ENDFOR</code>.",
      kuka: "<code>FOR i = 1 TO 3</code> ... <code>ENDFOR</code>. Declare <code>i</code> with <code>DECL INT i</code>.",
      ur: "URScript has no FOR loop. Use a counter and <code>while</code>.",
      yaskawa: "INFORM has no block loops. You build them from a label, <code>INC</code>, and a conditional <code>JUMP</code>. Integer variables are I000 to I099.",
    },
    task: "Make the loop place four parts. Then change the spacing.",
    concepts: ["var", "for", "assign"],
    recipe: {
      name: "Loops", title: "Lesson 10: a loop places a row of parts",
      points: pick("pHome", "pPick", "pDrop"),
      main: [
        ["tool", 1], ["grip", false], ["j", "pHome", 50, 0],
        ["for", "i", 1, 3, [
          ["waitdi", 1, true],
          ...PICK_OPS,
          ["jo", "pDrop", 60, 20, { d: [{ v: "i", k: 90 }, 0, 100], mode: "base" }],
          ["l", "pDrop", 150, 0, { d: [{ v: "i", k: 90 }, 0, 0], mode: "base" }],
          ["grip", false], ["wait", 0.4],
          ["l", "pDrop", 300, 20, { d: [{ v: "i", k: 90 }, 0, 100], mode: "base" }],
        ]],
        ["j", "pHome", 50, 0],
      ],
    },
  },
  {
    id: "decisions", part: "I/O and logic", title: "Decisions",
    lead: "An IF lets the program react: good parts go on the table, rejected parts go in the bin.",
    body: `
<p>Input 3 is a <b>quality reject</b> signal from a camera. When it is on, the part must go in the red bin instead of on the table.</p>
<p>An <b>IF ... ELSE</b> block runs one branch or the other. Inside the good-part branch a second counter, <code>good</code>, tracks how many parts are on the table, so the next good part goes into the next free place.</p>
<p>Click the DI 3 lamp while the program runs to reject the next part.</p>`,
    points: ["Read the decision as late as possible, just before you need it.", "Keep separate counters for separate places.", "Brands without IF blocks (TP's older style, INFORM) use conditional jumps."],
    notes: {
      abb: "<code>IF diReject = 1 THEN</code> ... <code>ELSE</code> ... <code>ENDIF</code>. <code>ELSEIF</code> chains more cases.",
      fanuc: "Newer controllers support <code>IF (...) THEN</code> blocks. The classic form is a jump: <code>IF DI[3]=ON,JMP LBL[5]</code>.",
      kuka: "<code>IF $IN[3] == TRUE THEN</code>. KRL uses <code>==</code> for comparison and <code>=</code> for assignment.",
      ur: "<code>if</code> / <code>elif</code> / <code>else</code> / <code>end</code>. Inputs are counted from 0, so DI 3 is <code>get_digital_in(2)</code>.",
      yaskawa: "<code>JUMP *ELSE0 IF IN#(3)=OFF</code> skips the reject branch. Labels start with <code>*</code>.",
    },
    task: "Reject the second part by toggling DI 3 at the right moment. Then change the program to reject every third part with a counter.",
    concepts: ["if", "waitdi"],
    recipe: {
      name: "Decisions", title: "Lesson 11: sort good and rejected parts",
      points: pick("pHome", "pPick", "pDrop", "pReject"),
      vars: { good: 0 },
      main: [
        ["tool", 1], ["grip", false], ["j", "pHome", 50, 0], ["set", "good", 0],
        ["for", "i", 1, 3, [
          ["waitdi", 1, true],
          ...PICK_OPS,
          ["if", ["di", 3, true], [
            ["c", "Rejected: drop in the bin"],
            ["j", "pReject", 60, 0], ["grip", false], ["wait", 0.4],
          ], [
            ["c", "Good part: next place on the table"],
            ["inc", "good"],
            ["jo", "pDrop", 60, 20, { d: [{ v: "good", k: 90 }, 0, 100], mode: "base" }],
            ["l", "pDrop", 150, 0, { d: [{ v: "good", k: 90 }, 0, 0], mode: "base" }],
            ["grip", false], ["wait", 0.4],
            ["l", "pDrop", 300, 20, { d: [{ v: "good", k: 90 }, 0, 100], mode: "base" }],
          ]],
        ]],
        ["j", "pHome", 50, 0],
      ],
    },
  },
  {
    id: "subs", part: "I/O and logic", title: "Subroutines",
    lead: "Split the program into routines with names: Pick, Place. The main routine then reads like the job description.",
    body: `
<p>A <b>subroutine</b> (procedure, subprogram, function or job) is a named block of instructions. The main routine <b>calls</b> it, it runs, and execution returns to the line after the call.</p>
<p>Routines make programs shorter and clearer. Fix the pick once and every call benefits. Watch the editor jump into the routine and back.</p>`,
    points: ["Name routines after what they do: Pick, Place, GoHome.", "Keep main short. It should read like a recipe.", "Variables shared by routines (like the counter) live at program level."],
    notes: {
      abb: "<code>PROC Pick()</code> ... <code>ENDPROC</code>, called with just <code>Pick;</code>.",
      fanuc: "Each routine is its own TP program (<code>/PROG PICK</code>), called with <code>CALL PICK ;</code>. In this editor they sit one after another.",
      kuka: "Further <code>DEF</code> blocks in the same .src file are local subprograms, called with <code>Pick( )</code>.",
      ur: "Nested <code>def pick():</code> ... <code>end</code> blocks, called with <code>pick()</code>. Define a function before you call it.",
      yaskawa: "Each routine is a separate job, called with <code>CALL JOB:PICK</code>. Its own //POS section holds its points.",
    },
    task: "Add a routine called GoHome and use it in both places where main returns home.",
    concepts: ["call", "program"],
    recipe: {
      name: "Subroutines", title: "Lesson 12: Pick and Place routines",
      points: pick("pHome", "pPick", "pDrop"),
      subs: {
        Pick: [["waitdi", 1, true], ...PICK_OPS],
        Place: [
          ["jo", "pDrop", 60, 20, { d: [{ v: "i", k: 90 }, 0, 100], mode: "base" }],
          ["l", "pDrop", 150, 0, { d: [{ v: "i", k: 90 }, 0, 0], mode: "base" }],
          ["grip", false], ["wait", 0.4],
          ["l", "pDrop", 300, 20, { d: [{ v: "i", k: 90 }, 0, 100], mode: "base" }],
        ],
      },
      main: [["tool", 1], ["grip", false], ["j", "pHome", 50, 0], ["for", "i", 1, 2, [["call", "Pick"], ["call", "Place"]]], ["j", "pHome", 50, 0]],
    },
  },
  {
    id: "cell", part: "Applications", title: "A complete pick-and-place cell",
    lead: "Put it together: initialise, loop until the batch is done, report progress, park the robot.",
    body: `
<p>A production program follows a fixed shape:</p>
<ol><li><b>Initialise</b>: select the tool, open the gripper, go home.</li><li><b>Cycle</b>: wait for a part, pick it, place it, count it.</li><li><b>Finish</b>: go home and report.</li></ol>
<p>This one runs four parts with a <code>WHILE</code> loop. The batch size is one number, easy to change.</p>`,
    points: ["Initialise every output and the tool at the start.", "Count parts and report progress.", "Finish at home so the next start is safe."],
    notes: {
      abb: "The pendant's production window shows <code>TPWrite</code> messages. Production code would also check that the robot is at home before starting.",
      fanuc: "<code>MESSAGE[ ]</code> shows text on the pendant's user screen. TP has no WHILE, so the loop is built from LBL and JMP.",
      kuka: "On real KUKA robots, <code>BAS(#INITMOV)</code> and a PTP HOME at the start are standard. The message library is beyond this simulator, so messages are comments.",
      ur: "<code>textmsg()</code> writes to the log tab. Many UR programs are built in PolyScope and exported as URScript like this one.",
      yaskawa: "Yaskawa jobs often end by calling a HOME job. The batch counter is an integer variable, I000.",
    },
    task: "Change the batch size to 6. The table only fits four in a row, so what happens? Fix it in the next lesson.",
    concepts: ["while", "call", "msg"],
    recipe: {
      name: "Cell", title: "Lesson 13: complete pick-and-place cell",
      points: pick("pHome", "pPick", "pDrop"),
      vars: { count: 0 },
      subs: {
        Pick: [["waitdi", 1, true], ...PICK_OPS],
        Place: [
          ["jo", "pDrop", 60, 20, { d: [{ v: "count", k: 90 }, 0, 100], mode: "base" }],
          ["l", "pDrop", 150, 0, { d: [{ v: "count", k: 90 }, 0, 0], mode: "base" }],
          ["grip", false], ["wait", 0.4],
          ["l", "pDrop", 300, 20, { d: [{ v: "count", k: 90 }, 0, 100], mode: "base" }],
        ],
      },
      main: [
        ["c", "Initialise"], ["tool", 1], ["grip", false], ["j", "pHome", 50, 0], ["set", "count", 0],
        ["c", "Production loop: four parts"],
        ["while", ["count", "<", 4], [["call", "Pick"], ["inc", "count"], ["call", "Place"], ["msg", "Parts placed:", "count"]]],
        ["c", "Finish"], ["j", "pHome", 50, 0], ["msg", "Batch complete"],
      ],
    },
  },
  {
    id: "pallet", part: "Applications", title: "Palletizing with a user frame",
    lead: "Teach one corner of the pallet in its own frame, then let two nested loops fill a 3 × 2 grid.",
    body: `
<p>The pallet has its own <b>user frame</b>, with its origin at the pallet's corner. The first slot is taught in that frame at (60, 60, 30). Every other slot is an offset from it: <code>(col - 1) × 90</code> along X and <code>(row - 1) × 90</code> along Y.</p>
<p>Two <b>nested loops</b> visit every row and column. Six boxes arrive on the conveyor and the robot builds the pattern.</p>
<p>Because the slots live in the pallet frame, moving the pallet only means re-teaching the frame. Not a single point changes.</p>`,
    points: ["One taught point plus arithmetic fills the pallet.", "Nested loops: the outer loop is rows, the inner loop is columns.", "Points in a user frame survive fixture moves."],
    notes: {
      abb: "The slots use <code>\\WObj:=wPallet</code>. The work object holds the pallet's position in the world.",
      fanuc: "The slot point is stored with <code>UF : 1</code>, and the program switches to <code>UFRAME_NUM=1</code> before using it.",
      kuka: "<code>$BASE = BASE_DATA[1]</code> selects the pallet base before the slot moves.",
      ur: "UR composes the frame by hand: <code>pose_trans(pallet, slot)</code>.",
      yaskawa: "The slot is stored under <code>///USER 1</code>. Offsets use <code>SETE</code> with values in 0.001 mm, computed from the loop counters.",
    },
    task: "Change the grid to 2 rows × 2 columns with 120 mm spacing.",
    concepts: ["frame", "for", "offset"],
    recipe: {
      name: "Pallet", title: "Lesson 14: palletize a 3 x 2 pattern",
      points: { pHome: PTS.pHome, pPick: PTS.pPick, pSlot: { x: 60, y: 60, z: 30, frame: 1 } },
      subs: { Pick: [["waitdi", 1, true], ...PICK_OPS] },
      main: [
        ["tool", 1], ["grip", false], ["j", "pHome", 50, 0],
        ["for", "row", 1, 2, [
          ["for", "col", 1, 3, [
            ["call", "Pick"],
            ["jo", "pSlot", 60, 20, { d: [{ v: "col", k: 90 }, { v: "row", k: 90 }, 100], mode: "base" }],
            ["l", "pSlot", 150, 0, { d: [{ v: "col", k: 90 }, { v: "row", k: 90 }, 0], mode: "base" }],
            ["grip", false], ["wait", 0.4],
            ["l", "pSlot", 300, 20, { d: [{ v: "col", k: 90 }, { v: "row", k: 90 }, 100], mode: "base" }],
          ]],
        ]],
        ["j", "pHome", 50, 0],
      ],
    },
  },
  {
    id: "safety", part: "Applications", title: "Faults and safety",
    lead: "Programs fail. Learn to read the errors and to stay safe while you fix them.",
    body: `
<p>This program asks for a point 1.5 m away, beyond the arm's reach. Run it and read the error: it names the line and the reason. The three faults you'll meet most are:</p>
<ul><li><b>Out of reach</b>: the point is too far away or too close to the base.</li><li><b>Joint limit</b>: the point is reachable, but only with an axis past its stops.</li><li><b>Singularity</b>: axis 5 passes through 0° during a linear move. Axes 4 and 6 line up, and the controller would have to spin them infinitely fast.</li></ul>
<p>Fix the program by changing pFar so it is reachable, then run it again.</p>
<p><b>On a real robot:</b> test new programs at low <b>override</b> speed (the slider), hold the enabling switch, stay outside the robot's reach, and know where the <b>emergency stop</b> is. The E-stop button in the viewport halts the simulated robot immediately.</p>`,
    points: ["Errors name the line and the cause. Read them before you change code.", "Use joint moves to get through a wrist singularity.", "Low override, enabling switch, E-stop: test every new program this way."],
    notes: {
      abb: "ABB reports reach errors as <i>50050 Position outside reach</i> and singularities as <i>50026 Close to singularity</i>.",
      fanuc: "FANUC alarms you'll see: <i>MOTN-017 Limit error</i> and <i>MOTN-023 In singularity</i>.",
      kuka: "KUKA messages: <i>Workspace exceeded</i>, <i>Software limit switch A3</i>, and for singular paths, <i>Command not permissible (singularity)</i>.",
      ur: "UR shows a protective stop: <i>Inverse kinematics failed</i> or <i>Joint limit violation</i>.",
      yaskawa: "Yaskawa alarms include <i>4400 OUT OF RANGE</i> and soft-limit alarms that name the axis.",
    },
    task: "Make pFar reachable. Then try a linear move straight over the robot's base and see the shoulder singularity.",
    concepts: ["movel", "movej"],
    recipe: {
      name: "Safety", title: "Lesson 15: reading faults",
      points: { pHome: PTS.pHome, pFar: { x: 1500, y: 0, z: 600 } },
      main: [["tool", 1], ["j", "pHome", 30, 0], ["c", "This point is beyond reach: read the error"], ["l", "pFar", 200, 0], ["j", "pHome", 30, 0]],
    },
  },
];

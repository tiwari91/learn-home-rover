// The rover model. Geometry, parts and wiring are ported from the rover repo's docs/rover3d.html.
// Units: centimetres. +x is the front of the rover, +z its right side, y is up.
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const WHEEL_R = 3.25;
export const HALF_TRACK = 7.4;          // wheel centres at z = ±7.4 cm
export const SONAR_FRONT = 11.0;        // x of the transducer faces, rover frame

export function buildRover() {
	const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
	const mat = {
		acrylic: new THREE.MeshStandardMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.4, roughness: 0.1 }),
		bracket: new THREE.MeshStandardMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.7, roughness: 0.1 }),
		yellow: M(0xf2c318), tyre: M(0x1c1c1c, { roughness: 0.9 }), hub: M(0xf2c318),
		pcbGreen: M(0x1f7a3a), pcbRed: M(0xc62828), pcbBlue: M(0x1f4fa8), metal: M(0xc9ccd2, { metalness: 0.7, roughness: 0.3 }),
		steel: M(0x9aa0a8, { metalness: 0.75, roughness: 0.35 }), nylon: M(0xe9e4d6, { roughness: 0.7 }),
		black: M(0x202226), white: M(0xf2f2ee), blueTerm: M(0x2b6fd6),
		cell: M(0x5a3fb0, { roughness: 0.35 }), brass: M(0xc8a24a, { metalness: 0.6, roughness: 0.35 }), lens: M(0x0b0d12, { metalness: 0.4, roughness: 0.1 }),
		bank: M(0x34383f, { roughness: 0.5 }), foam: M(0xeeeeea, { roughness: 1 }), velcro: M(0x3b4250, { roughness: 1 }), resistor: M(0xd9c48f),
	};
	function box(w, h, d, m, x = 0, y = 0, z = 0, parent) {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
		mesh.position.set(x, y, z); parent && parent.add(mesh); return mesh;
	}
	function cyl(r, len, m, axis = "y", parent, seg = 20) {
		const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
		if (axis === "x") mesh.rotation.z = Math.PI / 2;
		if (axis === "z") mesh.rotation.x = Math.PI / 2;
		parent && parent.add(mesh); return mesh;
	}
	function post(parent, x, y0, y1, z, r = 0.28, m = mat.brass) { const c = cyl(r, y1 - y0, m, "y", parent, 6); c.position.set(x, (y0 + y1) / 2, z); return c; }
	function screw(parent, x, y, z, dir = -1, r = 0.15, len = 0.6) {
		const h = r * 1.2;
		cyl(r * 1.9, h, mat.steel, "y", parent, 12).position.set(x, y - dir * h / 2, z);
		cyl(r, len, mat.steel, "y", parent, 8).position.set(x, y + dir * len / 2, z);
	}
	function nutY(parent, x, y, z, r = 0.3) { cyl(r, 0.24, mat.steel, "y", parent, 6).position.set(x, y, z); }

	const rover = new THREE.Group();
	const groups = {};          // key -> [THREE.Group]
	const labels = {};          // key -> CSS2DObject
	function part({ key, name = null, at = [0, 0, 0], ly = 2.2 }) {
		const g = new THREE.Group(); g.position.set(...at); rover.add(g);
		(groups[key] ||= []).push(g);
		if (name) {
			const el = document.createElement("div"); el.className = "tag"; el.textContent = name;
			const l = new CSS2DObject(el); l.position.set(0, ly, 0); l.visible = false; g.add(l); labels[key] = l;
		}
		return g;
	}

	const PLATE_Y = 4.5, TOP = PLATE_Y + 0.15, BOT = PLATE_Y - 0.15;
	const MX = 3, MZ = 4.4, BRX = MX - 2.3;
	const L298 = V(4.2, TOP + 1.08, 0), PI = V(-4.8, TOP + 1.18, -3.0);
	const PI_HOLES = [[-3.9, -2.45], [-3.9, 2.45], [1.9, -2.45], [1.9, 2.45]];
	const L_HOLES = [[-1.85, -1.85], [-1.85, 1.85], [1.85, -1.85], [1.85, 1.85]];

	// chassis plate (200 x 130 x 3 mm acrylic)
	const chassis = part({ key: "chassis", at: [0, PLATE_Y, 0] });
	{
		const shape = new THREE.Shape();
		const w = 10, d = 6.5, r = 1.6;
		shape.moveTo(-w + r, -d); shape.lineTo(w - r, -d); shape.quadraticCurveTo(w, -d, w, -d + r);
		shape.lineTo(w, d - r); shape.quadraticCurveTo(w, d, w - r, d); shape.lineTo(-w + r, d);
		shape.quadraticCurveTo(-w, d, -w, d - r); shape.lineTo(-w, -d + r); shape.quadraticCurveTo(-w, -d, -w + r, -d);
		const hole = (x, z, rr) => { const h = new THREE.Path(); h.absarc(x, -z, rr, 0, Math.PI * 2, true); shape.holes.push(h); };
		for (const [hx, hz] of PI_HOLES) hole(PI.x + hx, PI.z + hz, 0.14);
		for (const [hx, hz] of L_HOLES) hole(L298.x + hx, hz, 0.17);
		for (const z of [-2.7, 2.7]) hole(L298.x, z, 0.45);
		hole(1.5, 1.2, 0.45);
		const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false, curveSegments: 8 });
		geo.rotateX(-Math.PI / 2); geo.translate(0, -0.15, 0);
		chassis.add(new THREE.Mesh(geo, mat.acrylic));
		chassis.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x8fb6d8 })));
	}

	// gear motors in T-brackets, wheels on the D-shafts. side -1 = left (OUT1/OUT2), +1 = right.
	const wheels = [], motors = {};
	for (const side of [1, -1]) {
		const key = side < 0 ? "motorL" : "motorR";
		const mz = side * MZ;
		const br = part({ key, at: [BRX, 0, 0] });
		for (const bz of [mz - side * 1.1, mz + side * 1.1]) {
			box(2.0, TOP - 2.3, 0.3, mat.bracket, 0, (TOP + 2.3) / 2, bz, br);
			box(2.6, 0.12, 0.5, mat.bracket, 0, TOP + 0.06, bz, br);
		}
		const motor = part({ key, name: side < 0 ? "Left motor" : "Right motor", at: [MX, WHEEL_R, mz], ly: -1.9 });
		motors[side] = motor;
		box(7.0, 2.2, 1.9, mat.yellow, 0, 0, 0, motor);
		cyl(1.0, 2.4, mat.metal, "x", motor).position.set(-4.6, 0, 0);
		for (const y of [-0.45, 0.45]) box(0.2, 0.15, 0.35, mat.brass, -5.9, y, 0, motor);
		cyl(0.27, 2.4, mat.white, "z", motor, 12).position.set(1.2, 0, side * 2.15);
		const bolts = part({ key, at: [BRX, WHEEL_R, 0] });
		for (const by of [-0.55, 0.55]) {
			cyl(0.15, 2.8, mat.steel, "z", bolts, 8).position.set(0, by, side * 4.25);
			cyl(0.28, 0.2, mat.steel, "z", bolts, 12).position.set(0, by, side * 5.75);
			cyl(0.3, 0.24, mat.steel, "z", bolts, 6).position.set(0, by, side * 3.03);
		}
		const wkey = side < 0 ? "wheelL" : "wheelR";
		const wheel = part({ key: wkey, at: [MX + 1.2, WHEEL_R, side * 7.4] });
		const spin = new THREE.Group(); wheel.add(spin); wheels.push({ spin, side });
		cyl(WHEEL_R - 0.05, 2.5, mat.tyre, "z", spin, 32);
		cyl(WHEEL_R - 0.9, 2.6, mat.hub, "z", spin, 6);
		for (let i = 0; i < 6; i++) { const s = box(0.35, WHEEL_R * 1.6, 0.3, mat.black, 0, 0, side * 1.32, spin); s.rotation.z = i * Math.PI / 3; }
		// a white tick on the tyre so rotation reads clearly
		box(0.5, 0.6, 2.56, mat.white, 0, WHEEL_R - 0.3, 0, spin);
	}

	// rear caster
	{
		const posts = part({ key: "caster", at: [-8.6, 0, 0] });
		for (const x of [-0.6, 0.6]) post(posts, x, 2.8, BOT);
		for (const x of [-0.6, 0.6]) screw(posts, x, TOP, 0, -1);
		const caster = part({ key: "caster", name: "Caster", at: [-8.6, 0, 0], ly: 0.4 });
		const ball = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 12), mat.metal); ball.position.y = 1.0; caster.add(ball);
		cyl(1.2, 1.2, mat.black, "y", caster).position.y = 2.0;
		box(3.4, 0.2, 1.4, mat.black, 0, 2.7, 0, caster);
	}

	// 2x18650 holder under the plate
	const BATT = V(-2.6, 3.25, 0);
	{
		const pad = part({ key: "batt", at: [BATT.x, BOT - 0.075, 0] });
		box(6.8, 0.15, 3.6, mat.foam, 0, 0, 0, pad);
		const batt = part({ key: "batt", name: "2×18650 (7.4 V, motors)", at: [BATT.x, BATT.y, 0], ly: -2.4 });
		box(7.7, 0.2, 4.1, mat.black, 0, 0.85, 0, batt);
		for (const z of [-1.95, 1.95]) box(7.7, 0.9, 0.2, mat.black, 0, 0.3, z, batt);
		for (const x of [-3.75, 3.75]) box(0.2, 1.7, 4.1, mat.black, x, 0, 0, batt);
		for (const z of [-0.95, 0.95]) {
			cyl(0.9, 6.5, mat.cell, "x", batt).position.set(0, -0.15, z);
			cyl(0.35, 0.2, mat.metal, "x", batt).position.set(z > 0 ? 3.35 : -3.35, -0.15, z);
		}
		const tie = part({ key: "batt", at: [BATT.x, 0, 0] });
		box(0.35, 0.08, 4.7, mat.nylon, 0, 2.11, 0, tie);
		box(0.35, 0.08, 4.7, mat.nylon, 0, TOP + 0.04, 0, tie);
		for (const z of [-2.3, 2.3]) box(0.35, TOP - 2.07, 0.08, mat.nylon, 0, (TOP + 2.07) / 2, z, tie);
	}

	// L298N on brass standoffs
	let jumpers;
	const l298 = (() => {
		const posts = part({ key: "l298", at: [L298.x, 0, 0] });
		for (const [x, z] of L_HOLES) post(posts, x, TOP, TOP + 1.0, z);
		const g = part({ key: "l298", name: "L298N", at: [L298.x, L298.y, 0], ly: 3.4 });
		box(4.3, 0.16, 4.3, mat.pcbRed, 0, 0, 0, g);
		box(0.15, 2.4, 2.3, mat.black, 1.0, 1.28, 0, g);
		for (let i = 0; i < 7; i++) box(0.9, 2.4, 0.12, mat.black, 1.5, 1.28, -1.05 + i * 0.35, g);
		for (const z of [-1.75, 1.75]) {
			box(1.5, 0.9, 0.75, mat.blueTerm, 0, 0.53, z, g);
			for (const x of [-0.38, 0.38]) cyl(0.18, 0.06, mat.metal, "y", g, 10).position.set(x, 1.0, z);
		}
		box(0.75, 0.9, 1.5, mat.blueTerm, -1.6, 0.53, 1.35, g);
		for (const z of [0.9, 1.35, 1.8]) cyl(0.16, 0.06, mat.metal, "y", g, 10).position.set(-1.6, 1.0, z);
		box(0.25, 0.25, 1.55, mat.black, -1.95, 0.2, -1.27, g);
		for (let i = 0; i < 6; i++) box(0.064, 0.6, 0.064, mat.brass, -1.95, 0.38, -1.9 + i * 0.254, g);
		for (const z of [-1.9, -0.63]) box(0.064, 0.6, 0.064, mat.brass, -1.7, 0.38, z, g);
		// ENA/ENB jumper caps: shown on until the PWM lesson takes them off
		jumpers = new THREE.Group(); g.add(jumpers);
		for (const z of [-1.9, -0.63]) box(0.5, 0.45, 0.25, mat.black, -1.82, 0.62, z, jumpers);
		for (const [x, z] of L_HOLES) screw(posts, x, L298.y + 0.08, z, -1);
		return g;
	})();
	const L_IN = (i) => V(-1.95, 0.68, -1.9 + i * 0.254);   // ENA IN1 IN2 IN3 IN4 ENB

	// Raspberry Pi 4
	const pi = (() => {
		const posts = part({ key: "pi", at: [PI.x, 0, PI.z] });
		for (const [x, z] of PI_HOLES) post(posts, x, TOP, TOP + 1.1, z, 0.25);
		const g = part({ key: "pi", name: "Raspberry Pi 4", at: [PI.x, PI.y, PI.z], ly: 3.0 });
		box(8.5, 0.16, 5.6, mat.pcbGreen, 0, 0, 0, g);
		box(1.5, 0.15, 1.5, mat.metal, -0.8, 0.15, 0.2, g);
		box(1.0, 0.1, 1.2, mat.black, 0.9, 0.12, 0.2, g);
		box(5.1, 0.85, 0.5, mat.black, -1.0, 0.5, -2.45, g);
		const pinGeo = new THREE.BoxGeometry(0.064, 0.6, 0.064);
		const pins = new THREE.InstancedMesh(pinGeo, mat.brass, 40);
		const m4 = new THREE.Matrix4(); let k = 0;
		for (let c = 0; c < 20; c++) for (const dz of [-0.127, 0.127]) { m4.makeTranslation(-3.413 + c * 0.254, 1.1, -2.45 + dz); pins.setMatrixAt(k++, m4); }
		g.add(pins);
		box(2.15, 1.6, 1.3, mat.metal, 3.35, 0.9, 1.8, g);
		box(1.75, 1.6, 1.33, mat.metal, 3.5, 0.9, -0.1, g);
		box(1.75, 1.6, 1.33, mat.metal, 3.5, 0.9, -1.9, g);
		box(0.4, 0.3, 1.0, mat.blueTerm, 3.5, 0.95, -0.1, g);
		box(0.9, 0.35, 0.75, mat.metal, -3.5, 0.25, 2.5, g);
		box(0.7, 0.3, 0.75, mat.metal, -2.1, 0.22, 2.5, g); box(0.7, 0.3, 0.75, mat.metal, -0.8, 0.22, 2.5, g);
		box(0.3, 0.55, 2.2, mat.white, -1.0, 0.35, 0.9, g);
		for (const [x, z] of PI_HOLES) screw(posts, x, PI.y + 0.08, z, -1, 0.125);
		return g;
	})();
	// Physical pin n: odd pins on the inner row, even on the board edge; pin 1 at the end away from the USB ports.
	const piPin = (n) => V(-3.413 + Math.floor((n - 1) / 2) * 0.254, 1.4, n % 2 ? -2.323 : -2.577);

	// HC-SR04 in a front L-bracket
	const sonar = (() => {
		const br = part({ key: "sonar", at: [9.15, TOP, 0] });
		box(1.5, 0.2, 4.6, mat.black, 0, 0.1, 0, br);
		const s = new THREE.Shape(); s.moveTo(-2.3, 0); s.lineTo(2.3, 0); s.lineTo(2.3, 3.2); s.lineTo(-2.3, 3.2); s.closePath();
		for (const z of [-1.3, 1.3]) { const h = new THREE.Path(); h.absarc(z, 1.5, 0.85, 0, Math.PI * 2, true); s.holes.push(h); }
		const ug = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false }); ug.rotateY(Math.PI / 2);
		const up = new THREE.Mesh(ug, mat.black); up.position.x = 0.75; br.add(up);
		for (const z of [-1.6, 1.6]) { screw(br, -0.15, 0.2, z, -1); nutY(br, -0.15, -0.42, z); }
		const g = part({ key: "sonar", name: "HC-SR04", at: [9.75, TOP + 1.5, 0], ly: 2.6 });
		box(0.16, 2.0, 4.5, mat.pcbBlue, 0, 0, 0, g);
		for (const z of [-1.3, 1.3]) {
			cyl(0.8, 1.2, mat.metal, "x", g).position.set(0.68, 0, z);
			cyl(0.62, 0.05, mat.black, "x", g).position.set(1.29, 0, z);
		}
		box(0.25, 0.25, 1.05, mat.black, -0.2, -0.75, 0, g);
		for (const z of [-0.381, -0.127, 0.127, 0.381]) box(0.5, 0.064, 0.064, mat.brass, -0.45, -0.75, z, g);
		return g;
	})();
	const SONAR_PIN = (i) => V(-0.7, -0.75, -0.381 + i * 0.254);   // VCC TRIG ECHO GND

	// Pi camera on an angled mount
	const camTilt = (() => {
		const m = part({ key: "cam", at: [7.9, TOP, -4.2] });
		box(1.8, 0.2, 2.6, mat.black, 0, 0.1, 0, m);
		const arm = new THREE.Group(); arm.position.y = 0.2; arm.rotation.z = 0.2; m.add(arm);
		for (const z of [-1.0, 1.0]) box(0.25, 3.4, 0.25, mat.black, 0, 1.7, z, arm);
		box(0.25, 0.25, 2.25, mat.black, 0, 3.3, 0, arm);
		const c = part({ key: "cam", name: "Pi camera v1.3", at: [7.9, TOP, -4.2], ly: 4.6 });
		const t = new THREE.Group(); t.position.y = 0.2; t.rotation.z = 0.2; c.add(t);
		box(0.1, 2.4, 2.5, mat.pcbGreen, 0.2, 2.4, 0, t);
		box(0.5, 0.85, 0.85, mat.black, 0.5, 2.6, 0, t);
		cyl(0.3, 0.35, mat.lens, "x", t).position.set(0.9, 2.6, 0);
		box(0.14, 0.3, 1.8, mat.white, 0.2, 1.3, 0, t);
		return t;
	})();

	// mini breadboard with the 1k / 2k echo divider
	const BB = V(8.1, TOP + 0.425, 4.35);
	{
		const cv = document.createElement("canvas"); cv.width = 128; cv.height = 148;
		const x = cv.getContext("2d"); x.fillStyle = "#f4f3ee"; x.fillRect(0, 0, 128, 148);
		x.fillStyle = "#6b6b6b"; for (let i = 0; i < 10; i++) for (let j = 0; j < 14; j++) if (j !== 7) x.fillRect(12 + i * 9, 8 + j * 9.6, 3, 3);
		x.fillStyle = "#c8312b"; x.fillRect(110, 6, 2, 136); x.fillStyle = "#2f6db3"; x.fillRect(121, 6, 2, 136);
		const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
		const w = M(0xf4f3ee), top = M(0xffffff, { map: tex });
		const g = part({ key: "bb", name: "1 kΩ / 2 kΩ divider", at: [BB.x, BB.y, BB.z], ly: 1.6 });
		g.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.85, 3.7), [w, w, top, w, w, w]));
		const legM = M(0xbfc4ca, { metalness: 0.7 });
		const resistor = (a, b, band) => {
			const ya = 0.425, lift = 0.35;
			for (const p of [a, b]) cyl(0.03, lift, legM, "y", g, 6).position.set(p[0], ya + lift / 2, p[1]);
			const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
			const wire = cyl(0.03, len, legM, "x", g, 6); wire.position.set((a[0] + b[0]) / 2, ya + lift, (a[1] + b[1]) / 2); wire.rotation.y = -Math.atan2(dz, dx);
			const body = cyl(0.13, 0.6, mat.resistor, "x", g, 10); body.position.copy(wire.position); body.rotation.copy(wire.rotation);
			const ring = cyl(0.14, 0.08, M(band), "x", g, 10); ring.position.copy(wire.position); ring.rotation.copy(wire.rotation);
		};
		resistor([-0.5, -1.0], [-0.5, 0.2], 0x8d5524);   // 1 kΩ: echo row -> divider row
		resistor([-0.1, 0.2], [1.3, 0.2], 0xc8312b);     // 2 kΩ: divider row -> GND rail
	}

	// power bank under a Velcro strap
	const bank = (() => {
		const g = part({ key: "bank", name: "USB power bank (Pi)", at: [-4.8, TOP + 1.1, 3.5], ly: 2.6 });
		box(9.0, 2.2, 5.0, mat.bank, 0, 0, 0, g);
		box(0.25, 0.35, 1.0, mat.metal, -4.55, -0.3, -1.5, g);
		for (let i = 0; i < 4; i++) cyl(0.12, 0.1, M(0x46d36b, { emissive: 0x2a8a45 }), "y", g, 8).position.set(-2 + i * 0.5, 1.12, 2.0);
		const s = part({ key: "bank", at: [-7.4, 0, 0] });
		box(1.6, 0.1, 5.3, mat.velcro, 0, TOP + 2.25, 3.5, s);
		for (const [z, fold] of [[0.95, 1], [6.05, -1]]) {
			box(1.6, TOP + 2.3 - (BOT - 0.1), 0.1, mat.velcro, 0, (TOP + 2.3 + BOT - 0.1) / 2, z, s);
			box(1.6, 0.1, 0.6, mat.velcro, 0, BOT - 0.05, z + fold * 0.3, s);
		}
		return g;
	})();

	// ---------- wires ----------
	const C = { red: 0xc8312b, black: 0x2b2b2b, yellow: 0xc99a06, orange: 0xd96b1d, blue: 0x2f6db3, green: 0x2e8b57, purple: 0x7b4bb3 };
	const wires = {};   // id -> { obj, tube, mats }
	rover.updateMatrixWorld(true);
	const W = (g, v) => { g.updateWorldMatrix(true, false); return rover.worldToLocal(g.localToWorld(v.clone())); };
	function tubeAlong(pts, r, color) {
		const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
		return new THREE.Mesh(new THREE.TubeGeometry(curve, 56, r, 6), M(color, { roughness: 0.5 }));
	}
	function end(p, kind, dir) {
		const o = { p, kind };
		if (kind === "pin") { o.start = p.clone().add(V(0, 0.15, 0)); o.dir = V(0, 1, 0); o.housing = [p.clone().add(V(0, -0.15, 0)), V(0.25, 0.6, 0.25)]; }
		else if (kind === "pinX") { o.start = p.clone().add(V(-0.15, 0, 0)); o.dir = V(-1, 0, 0); o.housing = [p.clone().add(V(0.15, 0, 0)), V(0.6, 0.25, 0.25)]; }
		else if (kind === "bb") { o.start = p.clone().add(V(0, 0.55, 0)); o.dir = V(0, 1, 0); o.housing = [p.clone().add(V(0, 0.3, 0)), V(0.22, 0.5, 0.22)]; }
		else { o.dir = dir.clone().normalize(); o.start = p.clone().addScaledVector(o.dir, -0.15); }
		return o;
	}
	const housingColor = 0x18191c;
	function wire(id, color, a, b, mids, r = 0.065) {
		const pts = [a.start, a.start.clone().addScaledVector(a.dir, 0.5), ...mids, b.start.clone().addScaledVector(b.dir, 0.5), b.start];
		const g = new THREE.Group(); const tube = tubeAlong(pts, r, color); g.add(tube);
		const hm = M(housingColor, { roughness: 0.7 });
		for (const e of [a, b]) if (e.housing) box(e.housing[1].x, e.housing[1].y, e.housing[1].z, hm, e.housing[0].x, e.housing[0].y, e.housing[0].z, g);
		rover.add(g); wires[id] = { obj: g, tube };
	}
	const over = (a, b, h1, h2 = h1) => [V(a.x + (b.x - a.x) * 0.3, h1, a.z + (b.z - a.z) * 0.3), V(a.x + (b.x - a.x) * 0.7, h2, a.z + (b.z - a.z) * 0.7)];
	[["in1", 11, 1, C.yellow], ["in2", 13, 2, C.orange], ["ena", 12, 0, C.purple], ["in3", 15, 3, C.blue], ["in4", 16, 4, C.green], ["enb", 33, 5, C.purple]].forEach(([id, pin, inp, col], i) => {
		const a = W(pi, piPin(pin)), b = W(l298, L_IN(inp));
		wire(id, col, end(a, "pin"), end(b, "pin"), over(a, b, 8.4 + i * 0.16, 7.6 + i * 0.14));
	});
	{
		const a = W(pi, piPin(6)), b = W(l298, V(-1.98, 0.6, 1.35));
		wire("gnd6", C.black, end(a, "pin"), end(b, "term", V(-1, 0, 0)), over(a, b, 9.4, 7.4));
	}
	for (const [id, col, z, tz, yy] of [["battP", C.red, 0.5, 0.9, 0.45], ["battN", C.black, -0.5, 1.35, 0.3]]) {
		const a = V(BATT.x + 3.9, BATT.y + 0.4, z), b = W(l298, V(-1.98, yy, tz));
		wire(id, col, end(a, "term", V(1, 0, 0)), end(b, "term", V(-1, 0, 0)),
			[V(1.55, 3.7, (z + 1.2) / 2), V(1.5, 4.0, tz + 0.15), V(1.5, 5.0, tz + 0.15)], 0.09);
	}
	for (const side of [-1, 1]) for (const [n, col, dx, ty, ly] of [[1, C.red, -0.38, 0.45, 3.0], [2, C.black, 0.38, -0.45, 3.5]]) {
		const a = W(l298, V(dx, 0.45, side * 2.13)), b = W(motors[side], V(-6.0, ty, 0));
		const hz = side * 2.7, rx = L298.x + dx * 0.4;
		wire((side < 0 ? "outL" : "outR") + n, col, end(a, "term", V(0, 0, side)), end(b, "term", V(-1, 0, 0)),
			[V(rx, 5.3, hz), V(rx, 4.5, hz), V(rx, 3.8, hz), V(1.5, ly, side * 2.6), V(-2.6, ly, side * 2.6), V(-3.5, b.y, side * 3.6)], 0.08);
	}
	const sPin = (i) => end(W(sonar, SONAR_PIN(i)), "pinX");
	const bbHole = (x, z) => V(BB.x + x, BB.y + 0.425, BB.z + z);
	wire("sVcc", C.red, sPin(0), end(W(pi, piPin(2)), "pin"), [V(6.6, 8.6, -2.3), V(0, 10.0, -4.9)]);
	wire("sTrig", C.yellow, sPin(1), end(W(pi, piPin(29)), "pin"), [V(6.6, 8.9, -2.0), V(0, 10.3, -4.7)]);
	wire("sEcho", C.blue, sPin(2), end(bbHole(-1.0, -1.0), "bb"), [V(7.9, 6.4, 1.8)]);
	wire("sGnd", C.black, sPin(3), end(bbHole(1.3, -1.5), "bb"), [V(8.6, 6.2, 1.5)]);
	wire("sDiv", C.blue, end(bbHole(-1.0, 0.2), "bb"), end(W(pi, piPin(31)), "pin"), [V(5.0, 9.8, 2.2), V(0, 10.6, -3.6)]);
	wire("sGnd39", C.black, end(bbHole(1.3, 1.5), "bb"), end(W(pi, piPin(39)), "pin"), [V(5.4, 10.1, 2.8), V(0.4, 10.9, -3.3)]);
	{	// camera ribbon
		const a = W(pi, V(-1.0, 0.62, 0.9)), b = W(camTilt, V(0.2, 1.15, 0));
		const curve = new THREE.CatmullRomCurve3([a, a.clone().setY(a.y + 0.9), V(-1.0, 8.1, -2.4), V(3.5, 8.0, -3.0), V(6.7, 6.4, -4.1), V(7.3, 5.4, -4.2), b], false, "centripetal");
		const N = 60, pos = [], idx = [], wdt = 0.8;
		for (let i = 0; i <= N; i++) { const p = curve.getPoint(i / N); pos.push(p.x, p.y, p.z - wdt, p.x, p.y, p.z + wdt); }
		for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
		const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
		const tube = new THREE.Mesh(geo, M(0xf4f4ef, { side: THREE.DoubleSide }));
		const g = new THREE.Group(); g.add(tube); rover.add(g); wires.ribbon = { obj: g, tube };
	}
	{	// power bank USB lead -> Pi USB-C
		const a = W(bank, V(-4.7, -0.3, -1.5)), b = W(pi, V(-3.5, 0.25, 3.25));
		const g = new THREE.Group();
		box(0.8, 0.5, 0.6, M(housingColor), b.x, b.y, b.z + 0.1, g);
		const tube = tubeAlong([V(a.x - 0.15, a.y, a.z), V(a.x - 0.6, a.y, a.z), V(-9.8, 5.6, 1.6), V(-9.3, 6.5, 0.9), V(b.x, b.y + 0.2, b.z + 0.9), V(b.x, b.y, b.z + 0.4)], 0.16, 0x202020);
		g.add(tube); rover.add(g); wires.usb = { obj: g, tube };
	}

	// ---------- per-part materials, so highlighting one part never lights up another ----------
	const partMats = {};
	for (const [key, gs] of Object.entries(groups)) {
		const cache = new Map(); partMats[key] = [];
		for (const g of gs) g.traverse((o) => {
			if (!o.material) return;
			const swap = (m) => {
				if (!cache.has(m)) { const c = m.clone(); c.userData.base = { opacity: c.opacity, transparent: c.transparent, emissive: c.emissive ? c.emissive.getHex() : 0, color: c.color.getHex() }; cache.set(m, c); partMats[key].push(c); }
				return cache.get(m);
			};
			o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
		});
	}
	const wireMats = {};
	for (const [id, w] of Object.entries(wires)) {
		wireMats[id] = [];
		w.obj.traverse((o) => { if (o.material) { o.material.userData.base = { opacity: o.material.opacity, transparent: o.material.transparent, emissive: 0, color: o.material.color.getHex() }; wireMats[id].push(o.material); } });
	}

	// pin anchors in rover space, for markers
	const anchors = {
		piPin: (n) => W(pi, piPin(n)),
		lIn: (i) => W(l298, L_IN(i)),
		l298Power: W(l298, V(-1.6, 1.0, 1.35)),
		l298Out: (side) => W(l298, V(0, 1.0, side * 1.75)),
		sonarPin: (i) => W(sonar, SONAR_PIN(i)),
		bb: BB.clone().add(V(0, 0.6, 0)),
		csi: W(pi, V(-1.0, 0.7, 0.9)),
		usbc: W(pi, V(-3.5, 0.4, 2.9)),
		jumpers: W(l298, V(-1.82, 0.9, -1.27)),
		camLens: W(camTilt, V(0.9, 2.6, 0)),
		sonarFace: W(sonar, V(1.3, 0, 0)),
	};
	return { rover, groups, labels, wheels, wires, partMats, wireMats, anchors, jumpers };
}

const FOCUS = new THREE.Color(0xff6a3d);
const tmp = new THREE.Color();
// keys: Set of part keys to bring forward (empty = everything normal). Other parts turn into
// flat "clay" in the ghost colour: opaque, so no transparency sorting and no muddy overlaps.
export function applyFocus(model, keys, wireStates, ghost = 0xc9ccc6) {
	const any = keys.size > 0;
	for (const [key, mats] of Object.entries(model.partMats)) {
		const on = keys.has(key);
		for (const m of mats) setLook(m, any && !on, 0, ghost);
		if (model.labels[key]) model.labels[key].visible = on;
	}
	// wireStates: id -> "hidden" | "dim" | "on" | "full"
	for (const [id, w] of Object.entries(model.wires)) {
		const st = wireStates[id] || "hidden";
		w.obj.visible = st !== "hidden";
		for (const m of model.wireMats[id]) setLook(m, st === "dim", st === "on" ? 0.12 : 0, ghost);
	}
}
function setLook(m, ghosted, glow, ghost) {
	const b = m.userData.base;
	m.color.setHex(b.color);
	if (ghosted) m.color.lerp(tmp.setHex(ghost), 0.78);
	if (m.emissive) { if (glow) m.emissive.copy(FOCUS).multiplyScalar(glow); else m.emissive.setHex(ghosted ? 0 : b.emissive); }
}

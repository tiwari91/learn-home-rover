import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { buildRover, applyFocus, WHEEL_R } from "./model.js";
import { World } from "./sim.js";
import { LESSONS, HEADER, ROVER_PINS } from "./lessons.js";
import { SIMS } from "./sims.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function loading(text, pct) { $("loaderText").textContent = text; $("loaderBar").style.width = pct + "%"; }
loading("Building the rover", 45);

// ---------- progress, kept in this browser only ----------
const store = {
	get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
	set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: progress just isn't kept */ } },
	del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
let progress = store.get("lhr-progress", null);
if (!progress || typeof progress !== "object") progress = { done: {}, tasks: {} };
progress.done ||= {}; progress.tasks ||= {};
const save = () => store.set("lhr-progress", progress);

// ---------- 3D stage ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const labels = new CSS2DRenderer();
labels.domElement.style.cssText = "position:absolute;inset:0;pointer-events:none";
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 10; controls.maxDistance = 600;
controls.addEventListener("change", () => invalidate());

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9088, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(30, 60, 20); scene.add(sun);

const floorMat = new THREE.MeshBasicMaterial({ color: 0xdfe2dc });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), floorMat);
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.05; scene.add(floor);
let grid;
const blob = (() => {   // soft contact shadow under the rover, instead of a shadow map
	const c = document.createElement("canvas"); c.width = c.height = 64;
	const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 4, 32, 32, 32);
	r.addColorStop(0, "rgba(0,0,0,.35)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64);
	const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 20), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
	m.rotation.x = -Math.PI / 2; m.position.y = 0.01; scene.add(m); return m;
})();
const obstacleMat = new THREE.MeshStandardMaterial({ color: 0xc4c9c0, roughness: 0.9 });
const obstacles = new THREE.Group(); scene.add(obstacles);
const book = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 11), new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.8 }));
book.position.set(-2.8, 2, 0); book.visible = false; scene.add(book);

const model = buildRover();
scene.add(model.rover);

// sonar beam: a line from the transducers to whatever it hits
const beamMat = new THREE.LineBasicMaterial({ color: 0xff6a3d, transparent: true });
const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
const beam = new THREE.Line(beamGeo, beamMat); beam.visible = false; scene.add(beam);
const hitDot = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff6a3d }));
hitDot.visible = false; scene.add(hitDot);

// marker for "the wire starts here"
const marker = (() => {
	const c = document.createElement("canvas"); c.width = c.height = 64;
	const g = c.getContext("2d"); g.strokeStyle = "#ff6a3d"; g.lineWidth = 7; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();
	const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
	s.scale.set(1.6, 1.6, 1); s.visible = false; s.renderOrder = 10; model.rover.add(s); return s;
})();
function showMarker(p) { marker.visible = !!p; if (p) marker.position.copy(p); invalidate(); }

function applyTheme() {
	const bg = new THREE.Color(css("--stage"));
	scene.background = bg; floorMat.color.copy(bg);
	if (grid) scene.remove(grid);
	grid = new THREE.GridHelper(1200, 60, new THREE.Color(css("--grid-a")), new THREE.Color(css("--grid-b")));
	scene.add(grid);
	const dark = (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
	obstacleMat.color.set(dark ? 0x4a5257 : 0xc4c9c0);
	refreshScene();
}

// ---------- render on demand ----------
let needs = true, raf = 0, last = 0;
const animators = new Set();       // functions (dt) -> true while they still need frames
function invalidate() { needs = true; kick(); }
function kick() { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
function animate(fn) { animators.add(fn); kick(); }
function frame(now) {
	raf = 0;
	const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016; last = now;
	for (const fn of [...animators]) if (!fn(dt)) animators.delete(fn);
	if (needs || animators.size) {
		renderer.render(scene, camera);
		labels.render(scene, camera);
		needs = false;
	}
	if (animators.size) kick(); else last = 0;
}
document.addEventListener("visibilitychange", () => { last = 0; if (!document.hidden) invalidate(); });

let slot = null;
const ro = new ResizeObserver(() => resize());
function mount(target) {
	if (slot === target) return;
	if (slot) ro.unobserve(slot);
	slot = target; target.appendChild(renderer.domElement); target.appendChild(labels.domElement);
	ro.observe(target); resize();
}
function resize() {
	if (!slot) return;
	const w = slot.clientWidth, h = slot.clientHeight;
	if (!w || !h) return;
	renderer.setSize(w, h); labels.setSize(w, h);
	camera.aspect = w / h; camera.updateProjectionMatrix(); invalidate();
}

// ---------- camera presets (rover space; "follow" ones ride along with the rover) ----------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CAMS = {
	overview: { t: V(0, 4.5, 0), p: V(28, 22, 32) },
	header: { t: V(-5, 6.5, -4), p: V(2, 30, -27) },
	power: { t: V(-1, 5, 0.5), p: V(-26, 19, 34) },
	l298: { t: V(1, 6, -1), p: V(22, 30, -26) },
	side: { t: V(1, 5.5, 0), p: V(14, 15, -44) },
	sonar: { t: V(6, 6, 1), p: V(40, 22, 24) },
	camera: { t: V(4, 7, -3), p: V(32, 23, -28) },
	floor: { t: V(0, 5, 0), p: V(-70, 75, 75), follow: true },
	floorSide: { t: V(60, 5, 0), p: V(40, 90, 150), follow: true },
	arena: { t: V(0, 0, 10), p: V(0, 330, 250), fixed: true },
};
let follow = false;
const lastRover = new THREE.Vector3();
function goCam(name, instant) {
	const c = CAMS[name] || CAMS.overview;
	const k = camera.aspect < 0.9 ? (c.follow || c.fixed ? 1.3 : 1.5) : 1;
	const base = c.fixed ? V(0, 0, 0) : model.rover.position.clone().setY(0);
	const t = c.t.clone().add(base);
	const p = c.t.clone().add(c.p.clone().sub(c.t).multiplyScalar(k)).add(base);
	follow = !!c.follow; lastRover.copy(model.rover.position);
	if (instant || reduced) { camera.position.copy(p); controls.target.copy(t); controls.update(); invalidate(); return; }
	const p0 = camera.position.clone(), t0 = controls.target.clone(); let u = 0;
	animate((dt) => {
		u = Math.min(1, u + dt / 0.7); const e = u * u * (3 - 2 * u);
		camera.position.lerpVectors(p0, p, e); controls.target.lerpVectors(t0, t, e); controls.update();
		return u < 1;
	});
}

// ---------- world (the simulated floor) ----------
const world = new World();
function syncRover() {
	const { x, z, yaw } = world.pose, y = world.lifted ? 1.8 : 0;
	model.rover.position.set(x, y, z); model.rover.rotation.y = yaw;
	for (const w of model.wheels) w.spin.rotation.z = -world.wheelAngle[w.side < 0 ? 0 : 1];
	blob.position.set(x, 0.01, z); blob.rotation.z = yaw; blob.visible = !world.lifted;
	book.visible = world.lifted; book.position.set(x - 2.8, 2, z);
	if (follow) {
		const d = model.rover.position.clone().sub(lastRover).setY(0);
		camera.position.add(d); controls.target.add(d); controls.update();
	}
	lastRover.copy(model.rover.position);
	if (beam.visible) {
		const d = world.distance();
		const [fx, fz] = world.forward();
		const sx = x + fx * 11, sz = z + fz * 11, sy = y + 6.15;
		const pts = beamGeo.attributes.position.array;
		pts[0] = sx; pts[1] = sy; pts[2] = sz; pts[3] = sx + fx * d; pts[4] = sy; pts[5] = sz + fz * d;
		beamGeo.attributes.position.needsUpdate = true; beamGeo.computeBoundingSphere();
		hitDot.position.set(pts[3], sy, pts[5]); hitDot.visible = d < 200;
		beamMat.opacity = 0.35 + 0.65 * Math.abs(Math.sin(world.t * 9));
	} else hitDot.visible = false;
	invalidate();
}
function setObstacles(list) {
	obstacles.clear();
	world.obstacles = list;
	for (const b of list) {
		const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h || 14, b.d), obstacleMat);
		m.position.set(b.x, (b.h || 14) / 2, b.z); obstacles.add(m);
	}
	invalidate();
}
const LAYOUTS = {
	none: () => [],
	wall: () => [{ x: 150, z: 0, w: 8, d: 140, h: 18 }],
	arena: () => {
		const S = 170, T = 6;
		return [
			{ x: 0, z: -S, w: 2 * S, d: T, h: 10 }, { x: 0, z: S, w: 2 * S, d: T, h: 10 },
			{ x: -S, z: 0, w: T, d: 2 * S, h: 10 }, { x: S, z: 0, w: T, d: 2 * S, h: 10 },
			{ x: 55, z: -55, w: 34, d: 34, h: 22 }, { x: -60, z: 70, w: 44, d: 22, h: 16 }, { x: 80, z: 90, w: 20, d: 40, h: 26 },
		];
	},
};

// ---------- code panel ----------
const KW = /^(def|class|return|if|elif|else|for|in|while|True|False|None|and|or|not|import|from|async|await|with|try|except|yield|const|let|function|lambda|is|self)$/;
function highlight(src, lang) {
	const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
	const re = /(#.*$|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b([A-Za-z_]\w*)\b|\b(\d+(?:\.\d+)?(?:e-?\d+)?)\b/g;
	return src.split("\n").map((line, i) => {
		let out = "";
		if (lang === "text") out = /^\s*#/.test(line) ? `<span class="tk-c">${esc(line)}</span>` : esc(line);
		else {
			let pos = 0, m; re.lastIndex = 0;
			while ((m = re.exec(line))) {
				out += esc(line.slice(pos, m.index));
				if (m[1]) out += `<span class="tk-c">${esc(m[1])}</span>`;
				else if (m[2]) out += `<span class="tk-s">${esc(m[2])}</span>`;
				else if (m[3]) out += KW.test(m[3]) ? `<span class="tk-k">${m[3]}</span>` : esc(m[3]);
				else out += `<span class="tk-n">${m[4]}</span>`;
				pos = re.lastIndex;
			}
			out += esc(line.slice(pos));
		}
		return `<span class="ln" data-i="${i}">${out || " "}</span>`;
	}).join("");
}
function markLine(text) {
	for (const l of $("codeSrc").querySelectorAll(".ln.hl")) l.classList.remove("hl");
	if (!text) return;
	const hit = [...$("codeSrc").querySelectorAll(".ln")].find((l) => l.textContent.includes(text));
	if (hit) { hit.classList.add("hl"); }
}

// ---------- GPIO header picker ----------
const PIN_KIND = (n) => HEADER[n] === "GND" ? "gnd" : HEADER[n] === "5V" ? "p5v" : HEADER[n] === "3V3" ? "p3v" : "io";
function buildHeader() {
	const g = $("gpio"); g.innerHTML = "";
	for (let row = 0; row < 20; row++) {
		const odd = row * 2 + 1, even = odd + 1;
		const nm = (n, side) => { const s = el("span", "nm " + side); s.innerHTML = (ROVER_PINS[n] && side === "l" ? `<b>${ROVER_PINS[n]}</b> ` : "") + HEADER[n] + (ROVER_PINS[n] && side === "r" ? ` <b>${ROVER_PINS[n]}</b>` : ""); return s; };
		const pin = (n) => { const b = el("button", "pin " + PIN_KIND(n), String(n)); b.type = "button"; b.dataset.pin = n; b.title = `Pin ${n}: ${HEADER[n]}`; b.setAttribute("aria-label", `Pin ${n}, ${HEADER[n]}`); b.onclick = () => pickPin(n, b); return b; };
		g.append(nm(odd, "l"), pin(odd), pin(even), nm(even, "r"));
	}
}
function flashPin(n, cls) {
	const b = $("gpio").querySelector(`[data-pin="${n}"]`); if (!b) return;
	b.classList.remove("wrong", "right"); void b.offsetWidth; b.classList.add(cls);
	setTimeout(() => b.classList.remove(cls), cls === "right" ? 1400 : 600);
}
function refreshUsedPins(L) {
	const used = new Set();
	for (const [i, les] of LESSONS.entries()) les.tasks.forEach((t, j) => {
		if (t.type === "pin" && t.wire && (i < LESSONS.indexOf(L) || j < doneCount(les))) used.add(t.pin);
	});
	for (const b of $("gpio").querySelectorAll(".pin")) b.classList.toggle("used", used.has(+b.dataset.pin));
}

// ---------- lesson state ----------
let L = null, Li = -1, sim = null;
const doneCount = (les) => Math.min(progress.tasks[les.id] || 0, les.tasks.length);
const allWired = (les) => doneCount(les) >= les.tasks.length;
const wireAnim = {};   // id -> 0..1 while drawing

function wireStates() {
	const st = {};
	LESSONS.forEach((les, i) => les.tasks.forEach((t, j) => {
		const ids = t.wire == null ? [] : [].concat(t.wire);
		for (const id of ids) {
			if (i < Li) st[id] = "dim";
			else if (i === Li && j < doneCount(les)) st[id] = "on";
		}
	}));
	return st;
}
const ghostColor = () => new THREE.Color(css("--stage")).lerp(new THREE.Color(css("--ink-3")), 0.25).getHex();
function refreshScene() {
	if (!L) { applyFocus(model, new Set(), Object.fromEntries(Object.keys(model.wires).map((k) => [k, "full"]))); model.jumpers.visible = false; invalidate(); return; }
	applyFocus(model, new Set(L.focus), wireStates(), ghostColor());
	const pwmI = LESSONS.findIndex((l) => l.id === "pwm");
	model.jumpers.visible = Li < pwmI || (Li === pwmI && doneCount(L) === 0);
	invalidate();
}
function drawWire(id) {
	const w = model.wires[id]; if (!w) return;
	const g = w.tube.geometry, n = g.index.count;
	if (reduced) { g.setDrawRange(0, Infinity); return; }
	let u = 0; g.setDrawRange(0, 0);
	animate((dt) => { u = Math.min(1, u + dt / 0.7); g.setDrawRange(0, u >= 1 ? n : Math.floor((n * u) / 6) * 6); return u < 1; });
}

function anchorFor(t) {
	if (!t || !t.src) return null;
	const [k, a] = [].concat(t.src);
	const v = model.anchors[k];
	return typeof v === "function" ? v(a) : v;
}

function feedback(msg, kind) { const f = $("feedback"); f.className = "feedback" + (kind ? " " + kind : ""); f.innerHTML = msg || ""; }

function renderTasks() {
	const list = $("tasks"); list.innerHTML = "";
	const n = doneCount(L);
	let needHeader = false;
	L.tasks.forEach((t, j) => {
		const li = el("li", "task" + (j < n ? " done" : j === n ? " active" : " locked"));
		li.dataset.task = j;
		const lab = el("div", "task-label"); lab.append(el("span", "tick"), el("span", null, t.label)); li.append(lab);
		if (j === n) {
			if (t.type === "pin") {
				needHeader = true;
				li.append(el("p", "hint", t.wire ? "Click the Pi pin this wire goes to, on the header below." : "Click it on the header below."));
			} else {
				const opts = el("div", "options");
				t.options.forEach((o, k) => { const b = el("button", "chip", o.t); b.type = "button"; b.dataset.opt = k; b.onclick = () => pickOption(t, o); opts.append(b); });
				li.append(opts);
			}
		}
		list.append(li);
	});
	$("headerWrap").hidden = !needHeader && !(sim && sim.wantsHeader);
	$("autoWire").hidden = n >= L.tasks.length;
	showMarker(n < L.tasks.length ? anchorFor(L.tasks[n]) : null);
	refreshUsedPins(L);
	updateRun();
}
function completeTask(msg) {
	const t = L.tasks[doneCount(L)];
	progress.tasks[L.id] = doneCount(L) + 1; save();
	for (const id of [].concat(t.wire ?? [])) drawWire(id);
	refreshScene(); renderTasks();
	feedback(msg + (allWired(L) ? " All connected: press Run." : ""), "ok");
}
function pickOption(t, o) {
	if (o.ok) completeTask(`Right: ${o.t.charAt(0).toLowerCase() + o.t.slice(1)}.`);
	else feedback(o.why, "bad");
}
function pickPin(n, btn) {
	const j = doneCount(L), t = L.tasks[j];
	if (!t || t.type !== "pin") {
		const use = ROVER_PINS[n] ? ` The rover uses it for ${ROVER_PINS[n]}.` : " The rover doesn't use it.";
		feedback(`Pin ${n} is ${HEADER[n]}.${use}`); flashPin(n, "right"); return;
	}
	const name = HEADER[n], want = HEADER[t.pin];
	const ok = n === t.pin || (t.alt || []).includes(n) || (t.gnd && name === "GND");
	if (ok) {
		flashPin(n, "right");
		const note = n !== t.pin ? ` That works too; the repo uses pin ${t.pin}.` : "";
		completeTask(t.wire ? `Connected to pin ${n} (${name}).${note}` : `Yes: pin ${n} is ${name}.${note}`);
		return;
	}
	flashPin(n, "wrong");
	feedback(explain(t, n, name, want), "bad");
}
function explain(t, n, name, want) {
	const power = { GND: "a ground pin", "5V": "a 5 V power pin", "3V3": "a 3.3 V power pin" };
	const taken = ROVER_PINS[n] ? ` It's also already used for ${ROVER_PINS[n]}.` : "";
	if (t.gnd) return `Pin ${n} is ${power[name] || name}. This one needs a ground: any of the black GND pins. The repo uses pin ${t.pin}.`;
	if (want === "5V") {
		if (name === "3V3") return `Pin ${n} is 3.3 V. The HC-SR04 runs on 5 V: pin 2 (or 4).`;
		return `Pin ${n} is ${power[name] || name}. VCC needs 5 V power: pin 2 (or 4).${taken}`;
	}
	if (power[name]) return `Pin ${n} is ${power[name]}, not a GPIO, so the code can't switch it. This wire needs ${want}, which is physical pin ${t.pin}.`;
	return `Pin ${n} is ${name}. The code uses ${want} here, which is physical pin ${t.pin}. Physical pin numbers and GPIO numbers are different.${taken}`;
}
$("autoWire").onclick = () => {
	let k = 0;
	const step = () => {
		if (!L || allWired(L)) return;
		const t = L.tasks[doneCount(L)];
		completeTask(t.type === "pin" ? `Pin ${t.pin} (${HEADER[t.pin]}).` : `${t.options.find((o) => o.ok).t}.`);
		if (!allWired(L) && k++ < 20) setTimeout(step, reduced ? 0 : 250);
	};
	step();
};

// ---------- run / sims ----------
const ui = {
	world, invalidate, animate, syncRover, markLine, goCam, setObstacles, LAYOUTS, flashPin, showMarker, model, HEADER,
	bench: $("bench"),
	log(s) { const c = $("console"); c.textContent += (c.textContent ? "\n" : "") + s; c.scrollTop = c.scrollHeight; },
	clearLog() { $("console").textContent = ""; },
	hud(rows) {
		const h = $("hud"); h.innerHTML = "";
		for (const [k, v, cls] of rows) { const r = el("span", "r" + (cls ? " " + cls : "")); r.append(k); const b = el("b", null, v); r.append(b); h.append(r); }
	},
	beam(on) { beam.visible = on; invalidate(); },
	layout(name, pose) { setObstacles(LAYOUTS[name]()); world.reset(pose); syncRover(); },
	lift(on) { world.lifted = on; syncRover(); },
	pinAnchor: (n) => model.anchors.piPin(n),
	anchor: (k, a) => { const v = model.anchors[k]; return typeof v === "function" ? v(a) : v; },
	finished() { if (!L) return; progress.done[L.id] = true; save(); refreshProgress(); $("runNote").textContent = "Lesson done."; setRunning(false); },
	setRunning: (on) => setRunning(on),
};
let running = false;
function setRunning(on) {
	running = on;
	$("runBtn").disabled = on || !allWired(L);
	$("stopBtn").disabled = !on;
}
function updateRun() {
	const ready = allWired(L);
	$("runBtn").disabled = running || !ready;
	$("runNote").textContent = ready ? (progress.done[L.id] ? "Lesson done. Run it again any time." : "") : "Make the connections first.";
}
$("runBtn").onclick = () => { if (!sim || running) return; ui.clearLog(); setRunning(true); sim.run(ui); };
$("stopBtn").onclick = () => { if (sim) sim.stop(ui); setRunning(false); markLine(null); };
$("viewReset").onclick = () => goCam(sim && running && sim.runCam ? sim.runCam : L ? L.cam : "overview");

// ---------- pages ----------
function refreshProgress() {
	const n = LESSONS.filter((l) => progress.done[l.id]).length;
	$("progressPill").textContent = `${n} / ${LESSONS.length}`;
	$("courseCount").textContent = `${n} of ${LESSONS.length} done`;
	const cards = $("cards"); cards.innerHTML = "";
	LESSONS.forEach((les, i) => {
		const li = el("li"); const a = el("a", "card" + (progress.done[les.id] ? " done" : ""));
		a.href = `#/lesson/${i + 1}`; a.dataset.lesson = les.id;
		const body = el("span");
		const title = el("span", "card-title", les.title); if (les.extra) title.append(el("span", "card-tag", "extra"));
		body.append(title, el("span", "card-short", les.short));
		a.append(el("span", "card-num", String(i + 1).padStart(2, "0")), body, el("span", "tick"));
		li.append(a); cards.append(li);
	});
	const next = LESSONS.findIndex((l) => !progress.done[l.id]);
	$("startBtn").textContent = n === 0 ? "Start lesson 1" : next < 0 ? "Review lesson 1" : `Continue: lesson ${next + 1}`;
	$("startBtn").href = `#/lesson/${next < 0 ? 1 : next + 1}`;
}
$("resetBtn").onclick = () => { progress = { done: {}, tasks: {} }; store.del("lhr-progress"); refreshProgress(); };

function leaveLesson() {
	if (sim) { sim.stop(ui); sim.teardown && sim.teardown(ui); }
	sim = null; running = false;
	animators.clear();
	beam.visible = false; showMarker(null);
	world.lifted = false; setObstacles([]); world.reset(); syncRover();
	$("bench").innerHTML = ""; $("hud").innerHTML = ""; $("console").textContent = "";
}

function showHome() {
	leaveLesson(); L = null; Li = -1;
	$("lesson").hidden = true; $("home").hidden = false;
	document.title = "Learn Home Rover";
	mount($("heroSlot")); refreshScene(); goCam("overview", true);
	refreshProgress();
}
function showLesson(i) {
	leaveLesson();
	Li = i; L = LESSONS[i];
	$("home").hidden = true; $("lesson").hidden = false;
	document.title = `${L.title} · Learn Home Rover`;
	$("lessonNum").textContent = `Lesson ${i + 1} of ${LESSONS.length}${L.extra ? " · extra" : ""}`;
	$("lessonTitle").textContent = L.title;
	$("lessonBody").innerHTML = L.body.map((p) => `<p>${p}</p>`).join("");
	$("wireBlock").hidden = L.tasks.length === 0;
	$("codeStep").textContent = L.tasks.length ? "2" : "1";
	$("codeFile").textContent = L.code.file;
	$("codeSrc").innerHTML = highlight(L.code.src, L.code.lang);
	$("runBtn").textContent = L.runLabel || "Run";
	feedback("");
	$("prevLesson").href = i > 0 ? `#/lesson/${i}` : "#/";
	$("prevLesson").textContent = i > 0 ? "Previous" : "All lessons";
	$("nextLesson").href = i < LESSONS.length - 1 ? `#/lesson/${i + 2}` : "#/";
	$("nextLesson").textContent = i < LESSONS.length - 1 ? "Next lesson" : "All lessons";
	mount($("lessonSlot"));
	sim = SIMS[L.sim] ? SIMS[L.sim]() : null;
	world.lifted = !!L.lifted;
	if (sim) sim.setup(ui);
	syncRover();
	refreshScene(); renderTasks(); setRunning(false); updateRun();
	goCam(L.cam, true);
	$("panel").scrollTop = 0; window.scrollTo(0, 0);
	progress.last = i; save();
}
function route() {
	const m = location.hash.match(/^#\/lesson\/(\d+)/);
	const i = m ? +m[1] - 1 : -1;
	if (i >= 0 && i < LESSONS.length) showLesson(i); else showHome();
}
addEventListener("hashchange", route);

$("themeBtn").onclick = () => {
	const dark = matchMedia("(prefers-color-scheme: dark)").matches;
	const cur = document.documentElement.dataset.theme || (dark ? "dark" : "light");
	const next = cur === "dark" ? "light" : "dark";
	document.documentElement.dataset.theme = next;
	try { localStorage.setItem("lhr-theme", next); } catch (e) { /* ignore */ }
	applyTheme();
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

// ---------- start ----------
buildHeader();
applyTheme();
loading("Wiring it up", 80);
route();
requestAnimationFrame(() => {
	renderer.render(scene, camera); labels.render(scene, camera);
	loading("Ready", 100);
	const ld = $("loader"); ld.classList.add("out");
	setTimeout(() => ld.remove(), 400);
	document.body.dataset.ready = "1";
});
window.__rover = { world, LESSONS };

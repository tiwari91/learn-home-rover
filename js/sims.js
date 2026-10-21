// One small simulation per lesson. Each returns { setup(ui), run(ui), stop(ui), teardown?(ui), runCam?, wantsHeader? }.
import { Explorer, FORWARD, BACKOFF, TURN, STOP_CM, MAX_CM } from "./sim.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pct = (v) => `${Math.round(Math.abs(v) * 100)}%`;
const f2 = (v) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// A frame loop that steps the world and stops itself when the sim goes idle (keeps the GPU quiet).
function makeLoop(ui, tick, busy) {
	let on = false;
	return {
		wake() {
			if (on) return; on = true;
			ui.animate((dt) => {
				if (!on) return false;
				ui.world.step(dt); tick(dt); ui.syncRover();
				if (!busy()) on = false;
				return on;
			});
		},
		kill() { on = false; },
	};
}
// Steps: [seconds, fn]. fn runs at the start of its step; done() after the last.
function makeScript(steps, done) {
	let i = 0, t = 0, next = 0, live = true;
	return {
		get live() { return live; },
		tick(dt) {
			if (!live) return;
			t += dt;
			while (live && i < steps.length && t >= next) { steps[i][1](); next += steps[i][0]; i++; }
			if (live && i >= steps.length && t >= next) { live = false; done && done(); }
		},
		cancel() { live = false; },
	};
}
const moving = (w) => w.drive.state[0] !== 0 || w.drive.state[1] !== 0 || (w.direct && (w.direct[0] || w.direct[1]));
function chip(text, onclick, pressed) {
	const b = el("button", "chip", text); b.type = "button";
	if (pressed != null) b.setAttribute("aria-pressed", String(pressed));
	b.onclick = onclick; return b;
}
function slider(label, min, max, step, value, oninput) {
	const l = el("label"); const span = el("span", null, label); const i = el("input"); i.type = "range";
	Object.assign(i, { min, max, step, value }); i.oninput = () => oninput(+i.value, span); l.append(span, i); return { wrap: l, input: i, span };
}
// A button that "holds a key": calls on(true) on press and on(false) on release, touch-safe.
function holdButton(text, on) {
	const b = el("button", "hold", text); b.type = "button";
	let down = false;
	const up = () => { if (!down) return; down = false; b.classList.remove("on"); on(false); };
	b.addEventListener("pointerdown", (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ } down = true; b.classList.add("on"); on(true); });
	for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(t, up);
	b.addEventListener("contextmenu", (e) => e.preventDefault());
	b.release = up;
	return b;
}
function driveHud(ui, extra = []) {
	const [l, r] = ui.world.drive.state;
	ui.hud([["left", f2(l)], ["right", f2(r)], ...extra]);
}
// Feeds Drive.set() at 10 Hz while cmd is set: like a held key, or the phone while a finger is down.
function makeFeeder(ui) {
	let acc = 1;
	return {
		cmd: null,
		tick(dt) { acc += dt; if (this.cmd && acc >= 0.1) { acc = 0; ui.world.drive.set(...this.cmd); } },
		press(cmd) { this.cmd = cmd; acc = 1; },
	};
}

// ---------- 1. pin tour ----------
function pinTour() {
	let script, loop;
	const PINS = [
		[17, 11, "IN1, left motor forward", "forward=17"], [27, 13, "IN2, left motor backward", "backward=27"],
		[18, 12, "ENA, left motor speed", "enable=18"], [22, 15, "IN3, right motor forward", "forward=22"],
		[23, 16, "IN4, right motor backward", "backward=23"], [13, 33, "ENB, right motor speed", "enable=13"],
		[5, 29, "HC-SR04 TRIG", "TRIG_PIN"], [6, 31, "HC-SR04 ECHO (through the divider)", "ECHO_PIN"],
	];
	return {
		wantsHeader: true,
		setup(ui) { ui.hud([["GPIOs used", "8"], ["header", "40 pins"]]); loop = makeLoop(ui, (dt) => script && script.tick(dt), () => script && script.live); },
		run(ui) {
			const steps = PINS.map(([g, p, what, line]) => [0.75, () => {
				ui.log(`GPIO ${String(g).padEnd(2)} -> pin ${String(p).padEnd(2)}  ${what}`);
				ui.flashPin(p, "right"); ui.showMarker(ui.pinAnchor(p)); ui.markLine(line);
				ui.hud([["GPIO", String(g)], ["physical pin", String(p)], ["", what]]);
			}]);
			script = makeScript(steps, () => { ui.log("Physical pin numbers count along the header; the code only ever sees GPIO numbers."); ui.showMarker(null); ui.markLine(null); ui.finished(); });
			loop.wake();
		},
		stop(ui) { script && script.cancel(); ui.showMarker(null); },
	};
}

// ---------- 2. power ----------
function power() {
	let script, loop;
	return {
		setup(ui) { ui.hud([["Pi", "off"], ["motors", "off"]]); loop = makeLoop(ui, (dt) => script && script.tick(dt), () => script && script.live); },
		run(ui) {
			const S = [
				[1.1, () => { ui.showMarker(ui.anchor("usbc")); ui.markLine("Pi USB-C"); ui.log("Power bank -> Pi USB-C: the Pi boots on its own 5 V supply."); ui.hud([["Pi", "5 V from the bank", "good"], ["motors", "off"]]); }],
				[1.1, () => { ui.showMarker(ui.anchor("l298Power")); ui.markLine("12V (VS)"); ui.log("2x 18650 (7.4 V) -> L298N 12V (VS): motor power only."); ui.hud([["Pi", "5 V from the bank", "good"], ["motors", "7.4 V from the cells", "good"]]); }],
				[1.1, () => { ui.markLine("5V        ->"); ui.log("L298N 5V -> nothing. The Pi never takes power from it."); }],
				[1.1, () => { ui.showMarker(ui.pinAnchor(6)); ui.markLine("GND       ->"); ui.log("Pi GND (pin 6) + battery - -> L298N GND: one shared 0 V."); ui.hud([["Pi", "5 V from the bank", "good"], ["motors", "7.4 V from the cells", "good"], ["ground", "shared", "good"]]); }],
			];
			script = makeScript(S, () => { ui.showMarker(null); ui.markLine(null); ui.log("Two supplies, one ground. Motor noise stays on the battery side."); ui.finished(); });
			loop.wake();
		},
		stop(ui) { script && script.cancel(); ui.showMarker(null); },
	};
}

// ---------- 3. H-bridge ----------
function hbridge() {
	let in1 = 0, in2 = 0, script, loop, svgBox, b1, b2;
	const dir = () => (in1 && !in2 ? 1 : !in1 && in2 ? -1 : 0);
	function draw() {
		const d = dir(), on = (x) => (x ? "var(--accent)" : "var(--ink-3)");
		const sw = (x, top, closed) => {
			const y0 = top ? 25 : 75, y1 = top ? 55 : 105;
			return closed ? `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="var(--accent)" stroke-width="3"/>`
				: `<line x1="${x}" y1="${y0}" x2="${x + 13}" y2="${y1 - 6}" stroke="var(--ink-3)" stroke-width="2"/>`;
		};
		const s1 = d === 1, s4 = d === 1, s2 = d === -1, s3 = d === -1;
		svgBox.innerHTML = `<svg viewBox="0 0 240 140" width="100%" style="max-width:360px;display:block" role="img" aria-label="H-bridge: ${d === 1 ? "forward" : d === -1 ? "backward" : "stopped"}">
			<text x="6" y="12" font-size="9" fill="var(--ink-2)" font-family="var(--mono)">+7.4 V</text>
			<text x="6" y="134" font-size="9" fill="var(--ink-2)" font-family="var(--mono)">GND</text>
			<line x1="50" y1="15" x2="190" y2="15" stroke="${on(d)}" stroke-width="2"/>
			<line x1="50" y1="115" x2="190" y2="115" stroke="${on(d)}" stroke-width="2"/>
			${[50, 190].map((x) => `<line x1="${x}" y1="15" x2="${x}" y2="25" stroke="var(--ink-3)" stroke-width="2"/><line x1="${x}" y1="55" x2="${x}" y2="75" stroke="${on(d)}" stroke-width="2"/><line x1="${x}" y1="105" x2="${x}" y2="115" stroke="var(--ink-3)" stroke-width="2"/>`).join("")}
			${sw(50, true, s1)}${sw(190, true, s2)}${sw(50, false, s3)}${sw(190, false, s4)}
			<text x="28" y="44" font-size="10" fill="var(--ink)" font-family="var(--mono)">S1</text><text x="206" y="44" font-size="10" fill="var(--ink)" font-family="var(--mono)">S2</text>
			<text x="28" y="94" font-size="10" fill="var(--ink)" font-family="var(--mono)">S3</text><text x="206" y="94" font-size="10" fill="var(--ink)" font-family="var(--mono)">S4</text>
			<line x1="50" y1="65" x2="102" y2="65" stroke="${on(d)}" stroke-width="2"/><line x1="138" y1="65" x2="190" y2="65" stroke="${on(d)}" stroke-width="2"/>
			<circle cx="120" cy="65" r="18" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/>
			<text x="120" y="70" font-size="13" text-anchor="middle" fill="var(--ink)" font-family="var(--sans)" font-weight="700">M</text>
			${d ? `<path d="M${d > 0 ? "70 58 L88 58 L84 54 M88 58 L84 62" : "170 58 L152 58 L156 54 M152 58 L156 62"}" stroke="var(--accent)" stroke-width="2" fill="none"/>` : ""}
		</svg>
		<p style="margin:4px 0 0;font-size:13px;color:var(--ink-2)">IN1 high closes S1 + S4: current flows left to right. IN2 high closes S2 + S3: right to left.</p>`;
	}
	function apply(ui) {
		b1.setAttribute("aria-pressed", String(!!in1)); b2.setAttribute("aria-pressed", String(!!in2));
		ui.world.direct = [dir(), 0];   // jumper caps still on: full speed
		draw();
		ui.hud([["IN1", in1 ? "high" : "low"], ["IN2", in2 ? "high" : "low"], ["left wheel", ["stop", "forward", "backward"][dir() === -1 ? 2 : dir()]]]);
		loop.wake();
	}
	return {
		setup(ui) {
			ui.lift(true);
			loop = makeLoop(ui, (dt) => script && script.tick(dt), () => (script && script.live) || dir() !== 0);
			b1 = chip("IN1", () => { in1 ^= 1; apply(ui); }, false);
			b2 = chip("IN2", () => { in2 ^= 1; apply(ui); }, false);
			const row = el("div", "bench-row"); row.append(el("span", "run-note", "Toggle the left channel:"), b1, b2);
			svgBox = el("div");
			ui.bench.append(row, svgBox);
			apply(ui);
		},
		run(ui) {
			const set = (a, b, line, msg) => () => { in1 = a; in2 = b; ui.markLine(line); ui.log(msg); apply(ui); };
			script = makeScript([
				[1.6, set(1, 0, "left.forward()", "left.forward()   IN1=1 IN2=0  -> forward")],
				[1.6, set(0, 1, "left.backward()", "left.backward()  IN1=0 IN2=1  -> backward")],
				[0.6, set(0, 0, "left.stop()", "left.stop()      IN1=0 IN2=0  -> stop")],
			], () => { ui.markLine(null); ui.finished(); });
			loop.wake();
		},
		stop(ui) { script && script.cancel(); in1 = in2 = 0; apply(ui); },
	};
}

// ---------- 4. spin one wheel (drive.py --test) ----------
function spinTest() {
	let script, loop, swapped = false;
	return {
		runCam: "side",
		setup(ui) {
			ui.lift(true);
			loop = makeLoop(ui, (dt) => script && script.tick(dt), () => script && script.live);
			const b = chip("Left motor wires swapped", () => { swapped = !swapped; b.setAttribute("aria-pressed", String(swapped)); }, false);
			const row = el("div", "bench-row"); row.append(b, el("span", "run-note", "Try it to see a wrong-way wheel."));
			ui.bench.append(row);
			ui.hud([["asked", "0.60"], ["ENA/ENB", "jumper on: 100%", "alert"]]);
		},
		run(ui) {
			const S = [];
			let wrong = false;
			for (const [i, name] of [[0, "left"], [1, "right"]]) {
				const set = (v) => { const d = [0, 0]; d[i] = v * (i === 0 && swapped ? -1 : 1); ui.world.direct = d; };
				S.push([0.15, () => { ui.markLine('wheel: forward")'); ui.log(`${name} wheel: forward`); }]);
				S.push([1.0, () => { ui.markLine("motor.forward(0.6)"); set(1); if (i === 0 && swapped) wrong = true; }]);
				S.push([0.15, () => { ui.markLine('wheel: backward")'); ui.log(`${name} wheel: backward`); }]);
				S.push([1.0, () => { ui.markLine("motor.backward(0.6)"); set(-1); }]);
				S.push([0.5, () => { ui.markLine("motor.stop()"); ui.world.direct = [0, 0]; }]);
			}
			script = makeScript(S, () => {
				ui.markLine("print(\"Done.");
				ui.log("Done. If a wheel turned the wrong way, swap that motor's two wires.");
				if (wrong) ui.log("The left wheel went backwards on 'forward': swap its two wires on OUT1/OUT2.");
				ui.log("Both wheels ran flat out even though the code asked for 0.6: the jumper caps are still on.");
				ui.finished();
			});
			loop.wake();
		},
		stop(ui) { script && script.cancel(); ui.world.direct = [0, 0]; },
	};
}

// ---------- 5. PWM ----------
function pwm() {
	let script, loop, sl, sr, cv, vals = [0, 0];
	function wave() {
		const W = cv.width = 840, H = cv.height = 220, g = cv.getContext("2d");
		g.fillStyle = css("--code-bg") || "#14181b"; g.fillRect(0, 0, W, H);
		[["ENA (GPIO 18)", vals[0]], ["ENB (GPIO 13)", vals[1]]].forEach(([name, v], row) => {
			const y0 = 30 + row * 100, hi = y0 + 10, lo = y0 + 70, period = 90, duty = Math.abs(v);
			g.font = "500 22px IBM Plex Mono, monospace"; g.fillStyle = "#7d8a87"; g.fillText(`${name}  ${pct(v)} ${v > 0 ? "fwd" : v < 0 ? "back" : ""}`, 16, y0);
			g.strokeStyle = v < 0 ? "#8fc7e8" : "#ff9b73"; g.lineWidth = 3; g.beginPath();
			let x = 16; g.moveTo(x, lo);
			while (x < W - 16) {
				const on = duty * period;
				if (on > 0.5) { g.lineTo(x, hi); g.lineTo(Math.min(x + on, W - 16), hi); g.lineTo(Math.min(x + on, W - 16), lo); }
				g.lineTo(Math.min(x + period, W - 16), lo); x += period;
			}
			g.stroke();
		});
	}
	function apply(ui) {
		ui.world.direct = [...vals];
		sl.input.value = vals[0]; sr.input.value = vals[1];
		sl.span.textContent = `left.value = ${f2(vals[0])}`; sr.span.textContent = `right.value = ${f2(vals[1])}`;
		ui.hud([["ENA duty", pct(vals[0])], ["ENB duty", pct(vals[1])]]);
		wave(); loop.wake();
	}
	return {
		setup(ui) {
			ui.lift(true);
			loop = makeLoop(ui, (dt) => script && script.tick(dt), () => (script && script.live) || vals[0] !== 0 || vals[1] !== 0);
			sl = slider("left.value", -1, 1, 0.05, 0, (v) => { vals[0] = v; apply(ui); });
			sr = slider("right.value", -1, 1, 0.05, 0, (v) => { vals[1] = v; apply(ui); });
			cv = el("canvas"); cv.setAttribute("aria-label", "PWM waveforms on ENA and ENB");
			ui.bench.append(sl.wrap, sr.wrap, cv);
			apply(ui);
		},
		run(ui) {
			let t = 0;
			const ramp = (a, b, dur, line) => [dur, () => { ui.markLine(line); const from = vals[0]; t = 0; rampState = { a: from, b, dur }; }];
			let rampState = null;
			const S = [
				ramp(0, 1, 2.0, "self.left.value = left"),
				ramp(1, 0.6, 1.0, "self.left.value = left"),
				ramp(0.6, -0.3, 1.5, "self.left.value = left"),
				ramp(-0.3, 0, 0.8, "self.right.value = right"),
			];
			let logged = -1;
			script = makeScript(S, () => { vals = [0, 0]; apply(ui); ui.markLine(null); ui.finished(); });
			script.tick = ((orig) => function (dt) {
				orig.call(script, dt);
				if (rampState) {
					t += dt; const u = Math.min(1, t / rampState.dur);
					const v = Math.round((rampState.a + (rampState.b - rampState.a) * u) * 20) / 20;
					vals = [v, v]; apply(ui);
					const k = Math.round(v * 10);
					if (k !== logged) { logged = k; ui.log(`left.value = right.value = ${f2(v)}   duty ${pct(v)} ${v < 0 ? "backwards" : ""}`); }
				}
			})(script.tick);
			loop.wake();
		},
		stop(ui) { script && script.cancel(); vals = [0, 0]; apply(ui); },
	};
}

// ---------- 6. drive and turn ----------
function drive() {
	let script, loop, feeder, speed = 0.6, label = "";
	const MOVES = { Forward: [1, 1, "KEY_UP"], Back: [-1, -1, "KEY_DOWN"], "Spin left": [-0.6, 0.6, "KEY_LEFT"], "Spin right": [0.6, -0.6, "KEY_RIGHT"] };
	function press(ui, name) {
		label = name || "";
		if (!name) { feeder.press(null); ui.world.drive.set(0, 0); return; }
		const [l, r, line] = MOVES[name];
		ui.markLine(line); feeder.press([l * speed, r * speed]); loop.wake();
	}
	return {
		setup(ui) {
			ui.layout("none"); ui.world.sonarOn = false;
			feeder = makeFeeder(ui);
			loop = makeLoop(ui, (dt) => { script && script.tick(dt); feeder.tick(dt); driveHud(ui, label ? [["key", label]] : []); }, () => (script && script.live) || feeder.cmd || moving(ui.world));
			const row = el("div", "bench-row");
			for (const name of Object.keys(MOVES)) row.append(holdButton(name, (down) => press(ui, down ? name : null)));
			const sp = slider("speed = 0.6", 0.3, 1, 0.1, 0.6, (v, span) => { speed = v; span.textContent = `speed = ${v.toFixed(1)}`; });
			ui.bench.append(row, sp.wrap);
			driveHud(ui);
		},
		run(ui) {
			const go = (name, dur) => [dur, () => { press(ui, name); ui.log(name ? `${name.padEnd(10)} DRIVE.set(${f2(MOVES[name][0] * speed)}, ${f2(MOVES[name][1] * speed)})` : "release     DRIVE.set(0, 0)"); }];
			ui.world.reset({ x: 0, z: 0, yaw: 0 });
			script = makeScript([go("Forward", 1.6), go("Spin left", 1.2), go("Forward", 1.4), go("Spin right", 0.8), go("Back", 1.0), go(null, 0.6)], () => { ui.markLine(null); ui.finished(); });
			loop.wake();
		},
		stop(ui) { script && script.cancel(); press(ui, null); },
		teardown(ui) { ui.world.sonarOn = true; },
	};
}

// ---------- 7. dead-man watchdog ----------
function watchdog() {
	let script, loop, feeder, hold, meter, txt, tripped = false;
	function tick(ui) {
		const w = ui.world, age = w.t - w.drive.lastCmd, mv = moving(w);
		meter.style.width = `${Math.min(1, age / 0.5) * 100}%`;
		txt.textContent = feeder.cmd ? "Commands arriving every 0.1 s" : mv ? `Last command ${age.toFixed(2)} s ago` : w.drive.lastStop === "deadman" ? "Stopped by the watchdog" : "Idle";
		if (!mv && w.drive.lastStop === "deadman" && !tripped) {
			tripped = true;
			ui.log(`watchdog: no command for ${age.toFixed(2)} s > 0.5 s -> both motors stopped`);
			ui.markLine("dead-man");
			if (!script || !script.live) ui.finished();
		}
		driveHud(ui, [["last command", `${Math.min(age, 9.99).toFixed(2)} s ago`, age > 0.5 && w.drive.lastStop === "deadman" ? "alert" : ""]]);
	}
	return {
		setup(ui) {
			ui.layout("none"); ui.world.sonarOn = false;
			feeder = makeFeeder(ui);
			loop = makeLoop(ui, (dt) => { script && script.tick(dt); feeder.tick(dt); tick(ui); }, () => (script && script.live) || feeder.cmd || moving(ui.world) || ui.world.t - ui.world.drive.lastCmd < 0.7);
			hold = holdButton("Hold to drive", (down) => {
				if (down) { tripped = false; ui.world.drive.lastStop = ""; ui.markLine("self.last_cmd = self.clock()"); feeder.press([0.6, 0.6]); loop.wake(); }
				else { feeder.press(null); ui.log("finger lifts: no more commands"); }
			});
			meter = el("div", "meter"); meter.append(el("i"));
			meter = meter.firstChild;
			txt = el("span", "run-note", "Idle");
			const row = el("div", "bench-row"); row.append(hold, txt);
			const lab = el("label"); lab.append(el("span", null, "time since last command (0 to 0.5 s)"), meter.parentNode);
			ui.bench.append(row, lab);
			driveHud(ui);
		},
		run(ui) {
			ui.world.reset({ x: 0, z: 0, yaw: 0 }); tripped = false;
			script = makeScript([
				[2.0, () => { hold.classList.add("on"); feeder.press([0.6, 0.6]); ui.markLine("self.last_cmd = self.clock()"); ui.log("holding: DRIVE.set(0.6, 0.6) every 0.1 s"); }],
				[1.4, () => { hold.classList.remove("on"); feeder.press(null); ui.log("finger lifts: no more commands"); }],
			], () => ui.finished());
			loop.wake();
		},
		stop(ui) { script && script.cancel(); hold.classList.remove("on"); feeder.press(null); ui.world.drive.stop(); },
		teardown(ui) { ui.world.sonarOn = true; },
	};
}

// ---------- 8. measure distance ----------
function sonar() {
	let script, loop, wallCm = 60, sl;
	function place(ui) {
		ui.setObstacles([{ x: 11 + wallCm + 4, z: 0, w: 8, d: 90, h: 18 }]);
		ui.syncRover(); readout(ui);
	}
	function readout(ui) {
		const d = ui.world.distance();
		ui.hud([["distance", `${d.toFixed(1)} cm`, d < STOP_CM ? "alert" : ""], ["echo high for", `${Math.round(d * 2 / 0.0343)} µs`], ["ECHO 5 V ->", "3.33 V at GPIO 6", "good"]]);
		sl.span.textContent = `wall at ${wallCm} cm${wallCm > 200 ? " (beyond max_distance)" : ""}`;
		sl.input.value = wallCm;
	}
	return {
		runCam: "floorSide",
		setup(ui) {
			ui.layout("none"); ui.beam(true);
			sl = slider("wall at 60 cm", 3, 260, 1, wallCm, (v) => { wallCm = v; place(ui); });
			ui.bench.append(sl.wrap);
			loop = makeLoop(ui, (dt) => script && script.tick(dt), () => script && script.live);
			place(ui);
		},
		run(ui) {
			ui.goCam("floorSide");
			let t = 0, last = -1;
			const path = (u) => (u < 0.4 ? 150 - (140 * u) / 0.4 : 10 + (230 * (u - 0.4)) / 0.6);
			script = makeScript([[8, () => {}]], () => { ui.markLine(null); ui.finished(); });
			const base = script.tick.bind(script);
			script.tick = (dt) => {
				base(dt); if (!script.live) return;
				t += dt; wallCm = Math.round(path(Math.min(1, t / 8))); place(ui);
				const k = Math.floor(t / 0.5);
				if (k !== last) {
					last = k; const d = ui.world.distance();
					ui.markLine("self.sensor.distance * 100.0");
					ui.log(`sensor.distance = ${(d / 100).toFixed(3)} m  ->  cm = ${d.toFixed(1)}${d >= MAX_CM ? "  (capped at max_distance)" : ""}`);
				}
			};
			loop.wake();
		},
		stop(ui) { script && script.cancel(); },
		teardown(ui) { ui.beam(false); },
	};
}

// ---------- 9. stop before obstacles ----------
function gate() {
	let script, loop, feeder, wasBlocked = false, label = "";
	const CMDS = { Forward: [0.6, 0.6], Reverse: [-0.6, -0.6], Spin: [0.6, -0.6], "Pivot (0.6, 0)": [0.6, 0] };
	function tick(ui) {
		const w = ui.world, d = w.distance();
		if (w.drive.blockedLast && !wasBlocked) {
			const c = feeder.cmd || [0, 0];
			ui.log(`set(${f2(c[0])}, ${f2(c[1])}): left + right = ${f2(c[0] + c[1])} > 0 and ${d.toFixed(1)} cm < 20 -> refused`);
			ui.markLine("left = right = 0.0");
		}
		wasBlocked = w.drive.blockedLast;
		driveHud(ui, [["distance", `${d.toFixed(1)} cm`, d < STOP_CM ? "alert" : ""], ...(w.drive.blockedLast ? [["forward", "refused", "alert"]] : label ? [["command", label]] : [])]);
	}
	function press(ui, name) {
		label = name || "";
		if (!name) { feeder.press(null); ui.world.drive.set(0, 0); ui.world.drive.blockedLast = false; return; }
		feeder.press(CMDS[name]); loop.wake();
		const [l, r] = CMDS[name];
		if (!(l + r > 0)) { ui.markLine("return left + right > 1e-6"); }
	}
	return {
		runCam: "floorSide",
		setup(ui) {
			ui.layout("wall"); ui.beam(true);
			feeder = makeFeeder(ui);
			loop = makeLoop(ui, (dt) => { script && script.tick(dt); feeder.tick(dt); tick(ui); }, () => (script && script.live) || feeder.cmd || moving(ui.world));
			const row = el("div", "bench-row");
			for (const name of Object.keys(CMDS)) row.append(holdButton(name, (down) => press(ui, down ? name : null)));
			ui.bench.append(row, el("span", "run-note", "Hold a button to drive. Get close to the wall, then try each one."));
			tick(ui);
		},
		run(ui) {
			ui.layout("wall"); ui.goCam("floorSide");
			let phase = "approach", t = 0;
			const say = (s) => ui.log(s);
			script = { live: true, cancel() { this.live = false; }, tick(dt) {
				if (!this.live) return; t += dt;
				if (phase === "approach") {
					if (!feeder.cmd) { press(ui, "Forward"); say("Forward at 0.6, ten times a second..."); }
					if (ui.world.drive.blockedLast && t > 0.5) { phase = "hold"; t = 0; press(ui, null); }
					if (t > 12) { phase = "done"; }
				} else if (phase === "hold" && t > 0.8) { phase = "pivot"; t = 0; press(ui, "Pivot (0.6, 0)"); say("Pivot (0.6, 0): left + right = 0.6, still forward"); }
				else if (phase === "pivot" && t > 1.0) { phase = "reverse"; t = 0; press(ui, null); press(ui, "Reverse"); say("Reverse (-0.6, -0.6): left + right < 0, allowed"); ui.markLine("return left + right > 1e-6"); }
				else if (phase === "reverse" && t > 0.9) { phase = "spin"; t = 0; press(ui, "Spin"); say("Spin (0.6, -0.6): left + right = 0, allowed"); }
				else if (phase === "spin" && t > 0.8) { phase = "done"; press(ui, null); }
				if (phase === "done") { this.live = false; ui.markLine(null); ui.finished(); }
			} };
			loop.wake();
		},
		stop(ui) { script && script.cancel(); press(ui, null); },
		teardown(ui) { ui.beam(false); },
	};
}

// ---------- camera view drawing (shared by camera + phone) ----------
function drawView(cv, world, frameNo, night) {
	const W = cv.width, H = cv.height, g = cv.getContext("2d");
	const { x, z, yaw } = world.pose, fx = Math.cos(yaw), fz = -Math.sin(yaw);
	const cx = x + fx * 8, cz = z + fz * 8, camH = 9, F = W / 2 / Math.tan(0.5);
	const sky = g.createLinearGradient(0, 0, 0, H);
	sky.addColorStop(0, night ? "#141718" : "#c9ccc6"); sky.addColorStop(0.5, night ? "#1e2224" : "#e1e3de"); sky.addColorStop(0.5, night ? "#25292b" : "#b9b2a3"); sky.addColorStop(1, night ? "#2c3032" : "#8e8677");
	g.fillStyle = sky; g.fillRect(0, 0, W, H);
	const proj = (X, Y, Z) => { const dx = X - cx, dz = Z - cz; const f = dx * fx + dz * fz, r = dx * -fz + dz * fx; return f < 2 ? null : [W / 2 + (F * r) / f, H / 2 - (F * (Y - camH)) / f, f]; };
	const faces = [];
	for (const b of world.obstacles) {
		const h = b.h || 14, x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
		for (const [a, c, shade] of [[[x0, z0], [x1, z0], 0.85], [[x1, z0], [x1, z1], 0.7], [[x1, z1], [x0, z1], 0.85], [[x0, z1], [x0, z0], 0.7]]) {
			const pts = [proj(a[0], 0, a[1]), proj(c[0], 0, c[1]), proj(c[0], h, c[1]), proj(a[0], h, a[1])];
			if (pts.some((p) => !p)) continue;
			faces.push({ pts, d: pts.reduce((s, p) => s + p[2], 0) / 4, shade });
		}
	}
	faces.sort((a, b) => b.d - a.d);
	for (const f of faces) {
		const v = Math.round((night ? 70 : 215) * f.shade * Math.max(0.55, 1 - f.d / 600));
		g.fillStyle = `rgb(${v},${v + 2},${v - 4})`; g.beginPath(); f.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill();
	}
	g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, H - 26, W, 26);
	g.fillStyle = "#e7e9e5"; g.font = "500 13px IBM Plex Mono, monospace";
	g.fillText(`frame ${String(frameNo).padStart(5, "0")}  640x480 MJPEG  ${night ? "10" : "30"} fps`, 10, H - 9);
}

// ---------- 10. camera stream ----------
function camera() {
	let script, loop, cv, explorer, acc = 0, frame = 0, drawAcc = 0, lastSec = -1;
	return {
		runCam: "floor",
		setup(ui) {
			ui.layout("arena", { x: -110, z: -110, yaw: -Math.PI / 4 });
			cv = el("canvas"); cv.width = 480; cv.height = 360; cv.setAttribute("aria-label", "Simulated camera view");
			ui.bench.append(cv, el("span", "run-note", "What /stream.mjpg would show: each frame is a separate JPEG."));
			drawView(cv, ui.world, 0, false);
			loop = makeLoop(ui, (dt) => {
				script && script.tick(dt);
				acc += dt; drawAcc += dt;
				if (acc >= 0.1 && explorer) { acc = 0; const [l, r] = explorer.step(ui.world.distance(), ui.world.t); ui.world.drive.set(l * 0.8, r * 0.8); }
				frame = Math.floor(ui.world.t * 30);
				if (drawAcc >= 0.1) { drawAcc = 0; drawView(cv, ui.world, frame, false); }
				const s = Math.floor(ui.world.t);
				if (s !== lastSec && explorer) { lastSec = s; ui.log(`--frame  Content-Type: image/jpeg   (frame ${frame})`); }
				ui.hud([["stream", "640×480 MJPEG"], ["frames", String(frame)], ["fps", "30"]]);
			}, () => script && script.live);
		},
		run(ui) {
			ui.goCam("floor");
			explorer = new Explorer(); ui.markLine("start_recording");
			ui.log("GET /stream.mjpg  ->  multipart/x-mixed-replace; boundary=frame");
			script = makeScript([[1, () => ui.markLine("yield b")], [7, () => {}]], () => { explorer = null; ui.world.drive.stop(); ui.markLine(null); ui.finished(); });
			loop.wake();
		},
		stop(ui) { script && script.cancel(); explorer = null; ui.world.drive.stop(); },
	};
}

// ---------- 11. phone ----------
function phone() {
	let script, loop, vec = [0, 0], held = false, wifi = true, speed = 0.6, acc = 0, log, knob, joy, wifiBtn;
	const clamp = (v) => Math.max(-1, Math.min(1, v));
	const lines = [];
	function msg(s) { lines.push(s); if (lines.length > 9) lines.shift(); log.textContent = lines.join("\n"); }
	function send(ui, o) {
		const txt = JSON.stringify(o);
		if (!wifi) { msg(`x ${txt}  (lost: Wi-Fi down)`); return; }
		ui.world.drive.set(o.l, o.r); msg(`> ${txt}`);
	}
	function setJoy(x, y) {
		const R = joy.clientWidth / 2 || 75;
		knob.style.transform = x || y ? `translate(${x * R * 0.6}px, ${-y * R * 0.6}px)` : "";
		vec = [clamp(y + x * 0.7), clamp(y - x * 0.7)];
	}
	return {
		runCam: "floor",
		setup(ui) {
			ui.layout("arena", { x: -110, z: -110, yaw: -Math.PI / 4 }); ui.beam(true);
			const wrap = el("div", "phone");
			joy = el("div", "joy"); knob = el("i"); joy.append(knob); joy.setAttribute("aria-label", "Joystick");
			const side = el("div"); side.style.cssText = "display:grid;gap:8px;min-width:0";
			const sp = slider("speed 0.60", 0.2, 1, 0.05, speed, (v, span) => { speed = v; span.textContent = `speed ${v.toFixed(2)}`; });
			wifiBtn = chip("Wi-Fi off", () => { wifi = !wifi; wifiBtn.setAttribute("aria-pressed", String(!wifi)); msg(wifi ? "(Wi-Fi back)" : "(Wi-Fi dropped)"); }, false);
			const close = chip("Close page", () => { ui.world.drive.stop(); vec = [0, 0]; held = false; setJoy(0, 0); msg("socket closed -> drive.stop()"); ui.markLine("r.drive.set"); });
			const row = el("div", "bench-row"); row.append(wifiBtn, close);
			log = el("pre", "msglog");
			side.append(sp.wrap, row, log);
			wrap.append(joy, side); ui.bench.append(wrap);
			const move = (e) => {
				const r = joy.getBoundingClientRect(), R = r.width / 2;
				let x = (e.clientX - r.left - R) / R, y = -(e.clientY - r.top - R) / R; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
				setJoy(x, y); loop.wake();
			};
			joy.addEventListener("pointerdown", (e) => { try { joy.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } move(e); });
			joy.addEventListener("pointermove", (e) => { if (joy.hasPointerCapture && joy.hasPointerCapture(e.pointerId)) move(e); });
			for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) joy.addEventListener(t, () => setJoy(0, 0));
			loop = makeLoop(ui, (dt) => {
				script && script.tick(dt);
				acc += dt;
				if (acc >= 0.1) {   // the page's setInterval(..., 100)
					acc = 0;
					if (vec[0] || vec[1]) { held = true; send(ui, { l: +(vec[0] * speed).toFixed(2), r: +(vec[1] * speed).toFixed(2) }); }
					else if (held) { held = false; send(ui, { l: 0, r: 0 }); }
				}
				const w = ui.world;
				if (w.drive.lastStop === "deadman" && !moving(w) && !w._logged) { w._logged = true; msg("server: no message for 0.5 s -> dead-man stop"); ui.log("Dead-man: the server heard nothing for 0.5 s and stopped the motors."); }
				if (moving(w)) w._logged = false;
				const d = w.distance();
				driveHud(ui, [["distance", `${d.toFixed(0)} cm`, d < STOP_CM ? "alert" : ""], ["Wi-Fi", wifi ? "up" : "down", wifi ? "" : "alert"]]);
			}, () => (script && script.live) || vec[0] || vec[1] || held || moving(ui.world));
			driveHud(ui);
		},
		run(ui) {
			ui.layout("arena", { x: -110, z: -110, yaw: -Math.PI / 4 });
			wifi = true; wifiBtn.setAttribute("aria-pressed", "false");
			ui.markLine("setInterval");
			script = makeScript([
				[1.6, () => { setJoy(0, 0.9); ui.log("Finger on the joystick: forward. Ten messages a second."); }],
				[1.2, () => { setJoy(0.6, 0.6); ui.log("Push right: left = y + 0.7x, right = y - 0.7x."); }],
				[0.8, () => { setJoy(0, 0); ui.markLine("else if (held)"); ui.log("Finger lifts: one {\"l\": 0, \"r\": 0} and it stops at once."); }],
				[2.0, () => { setJoy(0, 0.9); wifi = false; wifiBtn.setAttribute("aria-pressed", "true"); ui.markLine("r.drive.set"); ui.log("Finger down again, but the Wi-Fi drops: messages stop arriving."); }],
				[0.4, () => { setJoy(0, 0); wifi = true; wifiBtn.setAttribute("aria-pressed", "false"); }],
			], () => { ui.markLine(null); ui.finished(); });
			loop.wake();
		},
		stop(ui) { script && script.cancel(); setJoy(0, 0); held = false; ui.world.drive.stop(); },
		teardown(ui) { ui.beam(false); },
	};
}

// ---------- 12. explore ----------
function explore() {
	let loop, explorer, acc = 0, t = 0, lastState = "", stuck = 0, lastPos = null, live = false;
	const LINE = { [FORWARD]: "if self.state == FORWARD:  return", [BACKOFF]: "if self.state == BACKOFF:  return", [TURN]: "return (s * self.turn_dir" };
	const api = {
		runCam: "arena",
		setup(ui) {
			ui.layout("arena", { x: -100, z: -20, yaw: 0 }); ui.beam(true);
			loop = makeLoop(ui, (dt) => {
				if (!explorer) return;
				t += dt; acc += dt;
				const w = ui.world;
				if (acc >= 0.1) {   // explore_tick every 0.1 s
					acc = 0;
					const d = w.distance();
					const [l, r] = explorer.step(d, w.t);
					w.drive.set(l, r);
					if (explorer.state !== lastState) {
						lastState = explorer.state; ui.markLine(LINE[lastState]);
						ui.log(`t=${t.toFixed(1)}s  ${lastState.padEnd(8)} distance ${d.toFixed(0)} cm  -> (${f2(l)}, ${f2(r)})${lastState === TURN ? ` turn ${explorer.turnDir > 0 ? "right" : "left"}` : ""}`);
					}
					// A corner outside the sonar cone can pin the rover. On the real rover you'd tap Stop.
					if (lastPos && explorer.state === FORWARD && Math.hypot(w.pose.x - lastPos.x, w.pose.z - lastPos.z) < 0.2) stuck += 0.1; else stuck = 0;
					lastPos = { ...w.pose };
					if (stuck > 1.5) { stuck = 0; ui.log("Stuck on something the sonar can't see (it only looks ahead). Nudging it into back-off."); explorer.state = BACKOFF; explorer.until = w.t + explorer.backoffS; }
				}
				ui.hud([["state", lastState.toUpperCase(), lastState === FORWARD ? "good" : "alert"], ["distance", `${w.distance().toFixed(0)} cm`], ["wheels", `${f2(w.drive.state[0])}, ${f2(w.drive.state[1])}`]]);
				if (t > 30) { api.stop(ui); ui.log("30 s of exploring. Tap Run to go again."); ui.finished(); }
			}, () => live);
			ui.hud([["state", "manual"]]);
		},
		run(ui) {
			ui.goCam("arena");
			explorer = new Explorer(); t = 0; acc = 1; lastState = ""; live = true;
			ui.log("POST /api/mode/explore");
			loop.wake();
		},
		stop(ui) { live = false; explorer = null; ui.world.drive.stop(); ui.markLine(null); },
		teardown(ui) { ui.beam(false); },
	};
	return api;
}

// ---------- 13. night mode: motion detection ----------
function night() {
	let loop, cv, live = false, t = 0, acc = 0, bg = null, lastAlert = -1e9, alerted = false;
	const W = 80, H = 60;
	function frameAt(t) {
		const f = new Float32Array(W * H);
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
			let v = 40 + (y > 38 ? 14 : 0) + ((x > 50 && x < 66 && y > 14 && y < 40) ? 22 : 0);   // floor, a door frame
			v += (Math.random() - 0.5) * 16;   // sensor noise at gain 8: under the 25-level threshold
			f[y * W + x] = v;
		}
		if (t > 3) {   // someone walks across
			const px = -14 + (t - 3) * 22;
			for (let y = 18; y < 52; y++) for (let x = Math.max(0, Math.floor(px)); x < Math.min(W, px + 12); x++) f[y * W + x] += 70;
		}
		return f;
	}
	function draw(f, changed) {
		const g = cv.getContext("2d"), img = g.createImageData(W, H);
		for (let i = 0; i < W * H; i++) {
			const v = Math.max(0, Math.min(255, f[i]));
			const c = changed && changed[i];
			img.data[i * 4] = c ? 255 : v; img.data[i * 4 + 1] = c ? 122 : v; img.data[i * 4 + 2] = c ? 80 : v; img.data[i * 4 + 3] = 255;
		}
		const off = document.createElement("canvas"); off.width = W; off.height = H; off.getContext("2d").putImageData(img, 0, 0);
		g.imageSmoothingEnabled = false; g.drawImage(off, 0, 0, cv.width, cv.height);
	}
	return {
		setup(ui) {
			cv = el("canvas"); cv.width = 480; cv.height = 360; cv.setAttribute("aria-label", "Small grey frame used for motion detection");
			ui.bench.append(cv, el("span", "run-note", "80×60 stand-in for the 320×240 grey frame. Orange pixels changed by more than 25 levels."));
			draw(frameAt(0), null);
			ui.hud([["camera", "100 ms, gain 8, 10 fps"], ["changed", "0.0%"], ["alert at", "2%"]]);
			loop = makeLoop(ui, (dt) => {
				if (!live) return;
				t += dt; acc += dt;
				if (acc < 0.5) return;   // motion_tick every 0.5 s
				acc = 0;
				const f = frameAt(t);
				if (!bg) { bg = f; draw(f, null); return; }
				const changed = new Uint8Array(W * H); let n = 0;
				for (let i = 0; i < W * H; i++) if (Math.abs(f[i] - bg[i]) > 25) { changed[i] = 1; n++; }
				const frac = n / (W * H);
				for (let i = 0; i < W * H; i++) bg[i] = 0.8 * bg[i] + 0.2 * f[i];
				draw(f, changed);
				const cool = Math.max(0, 30 - (t - lastAlert));
				ui.hud([["camera", "100 ms, gain 8, 10 fps"], ["changed", `${(frac * 100).toFixed(1)}%`, frac >= 0.02 ? "alert" : ""], ["alert at", "2%"], ["cooldown", cool > 0 ? `${cool.toFixed(0)} s` : "ready"]]);
				if (frac >= 0.02 && t - lastAlert >= 30) {
					lastAlert = t; alerted = true; ui.markLine("return True");
					ui.log(`t=${t.toFixed(1)}s  ${(frac * 100).toFixed(1)}% changed -> snapshot motion-*.jpg`);
					ui.log("ALERT: Motion seen by Home Rover   (send_alert() only logs for now)");
				} else ui.markLine("self.last_fraction = float(changed.mean())");
				if (t > 9) { live = false; ui.markLine(null); if (alerted) ui.log("Cooldown: no new alert for 30 s, however much moves."); ui.finished(); }
			}, () => live);
		},
		run(ui) { t = 0; acc = 1; bg = null; lastAlert = -1e9; alerted = false; live = true; ui.log("Motion on. Comparing a small grey frame twice a second."); loop.wake(); },
		stop() { live = false; },
	};
}

// ---------- 14. ROS 2 ----------
function ros() {
	let loop, script, v = 0, w = 0, acc = 0, publishing = false, sv, sw, pub;
	const SEP = 0.135, VM = 0.35;
	const duties = () => {
		let vv = v; const blocked = vv > 0 && loopUi.world.distance() < STOP_CM;
		if (blocked) vv = 0;
		return [Math.max(-1, Math.min(1, (vv - (w * SEP) / 2) / VM)), Math.max(-1, Math.min(1, (vv + (w * SEP) / 2) / VM))];
	};
	let loopUi;
	function labels() { sv.span.textContent = `linear.x = ${v.toFixed(2)} m/s`; sw.span.textContent = `angular.z = ${w.toFixed(1)} rad/s`; sv.input.value = v; sw.input.value = w; }
	return {
		runCam: "floor",
		setup(ui) {
			loopUi = ui;
			ui.layout("arena", { x: -60, z: 0, yaw: 0 }); ui.beam(true);
			sv = slider("", -0.35, 0.35, 0.01, 0, (x) => { v = x; labels(); });
			sw = slider("", -3, 3, 0.1, 0, (x) => { w = x; labels(); });
			pub = chip("Publish /cmd_vel", () => { publishing = !publishing; pub.setAttribute("aria-pressed", String(publishing)); if (publishing) loop.wake(); }, false);
			const row = el("div", "bench-row"); row.append(pub, el("span", "run-note", "10 Hz while on; stop publishing and the 0.5 s timeout stops it."));
			ui.bench.append(sv.wrap, sw.wrap, row);
			labels();
			loop = makeLoop(ui, (dt) => {
				script && script.tick(dt);
				acc += dt;
				if (publishing && acc >= 0.1) { acc = 0; const [l, r] = duties(); ui.world.drive.set(l, r); }
				const [l, r] = ui.world.drive.state;
				ui.hud([["left duty", f2(l)], ["right duty", f2(r)], ["/range", `${(ui.world.distance() / 100).toFixed(2)} m`]]);
			}, () => (script && script.live) || publishing || moving(ui.world));
			ui.hud([["left duty", "0.00"], ["right duty", "0.00"], ["/range", `${(ui.world.distance() / 100).toFixed(2)} m`]]);
		},
		run(ui) {
			const tw = (vv, ww, dur) => [dur, () => {
				v = vv; w = ww; labels(); publishing = true; pub.setAttribute("aria-pressed", "true");
				const [l, r] = duties(); ui.markLine("left = (v - w");
				ui.log(`/cmd_vel linear.x=${vv.toFixed(2)} angular.z=${ww.toFixed(1)}  -> left ${f2(l)}, right ${f2(r)}`);
			}];
			script = makeScript([tw(0.2, 0, 1.6), tw(0, 2.0, 1.0), tw(0.15, -0.8, 1.8), tw(0, 0, 0.5)], () => {
				publishing = false; pub.setAttribute("aria-pressed", "false"); ui.markLine(null);
				ui.log("Untested on the real rover: expect to tune max_wheel_speed first."); ui.finished();
			});
			loop.wake();
		},
		stop(ui) { script && script.cancel(); publishing = false; pub.setAttribute("aria-pressed", "false"); ui.world.drive.stop(); },
		teardown(ui) { ui.beam(false); },
	};
}

export const SIMS = { pinTour, power, hbridge, spinTest, pwm, drive, watchdog, sonar, gate, camera, phone, explore, night, ros };

// Small JavaScript ports of the rover's Python rules, so "Run" behaves like the code on screen.
// rover/motors.py -> Drive, rover/explore.py -> Explorer, rover/sensors.py -> RangeSensor.
import { HALF_TRACK, SONAR_FRONT } from "./model.js";

export const DEADMAN_S = 0.5;     // motors.py
export const STOP_CM = 20.0;      // sensors.py
export const MAX_CM = 200;        // DistanceSensor(max_distance=2.0)
export const VMAX = 35;           // cm/s at full duty: ros2 config/base.yaml max_wheel_speed 0.35 m/s

const clamp = (v) => Math.max(-1, Math.min(1, Number(v)));
export const isForward = (l, r) => l + r > 1e-6;

export class Drive {
	constructor({ clock, isBlocked, timeout = DEADMAN_S }) {
		this.clock = clock; this.isBlocked = isBlocked || (() => false); this.timeout = timeout;
		this.lastCmd = clock(); this.state = [0, 0]; this.blockedLast = false; this.lastStop = "";
	}
	set(left, right) {
		left = clamp(left); right = clamp(right);
		this.lastCmd = this.clock();
		this.blockedLast = isForward(left, right) && this.isBlocked();
		if (this.blockedLast) { left = right = 0; this.lastStop = "blocked"; }
		this.state = [left, right];
		return this.state;
	}
	stop() { this.state = [0, 0]; }
	check() {
		const [l, r] = this.state;
		if (l === 0 && r === 0) return false;
		if (this.clock() - this.lastCmd > this.timeout) { this.state = [0, 0]; this.lastStop = "deadman"; return true; }
		if (isForward(l, r) && this.isBlocked()) { this.blockedLast = true; this.state = [0, 0]; this.lastStop = "blocked"; return true; }
		return false;
	}
}

export const FORWARD = "forward", BACKOFF = "backoff", TURN = "turn";
export class Explorer {
	constructor({ stopCm = STOP_CM, speed = 0.5, backoffS = 0.6, turnS = [0.5, 1.0], rng = Math.random } = {}) {
		Object.assign(this, { stopCm, speed, backoffS, turnS, rng });
		this.state = FORWARD; this.until = 0; this.turnDir = 1;
	}
	step(distanceCm, now) {
		const blocked = distanceCm != null && distanceCm < this.stopCm;
		if (this.state === FORWARD && blocked) { this.state = BACKOFF; this.until = now + this.backoffS; }
		else if (this.state === BACKOFF && now >= this.until) {
			this.turnDir = this.rng() < 0.5 ? -1 : 1;
			this.state = TURN; this.until = now + this.turnS[0] + this.rng() * (this.turnS[1] - this.turnS[0]);
		} else if (this.state === TURN && now >= this.until) {
			if (blocked) this.until = now + this.turnS[0]; else this.state = FORWARD;
		}
		const s = this.speed;
		if (this.state === FORWARD) return [s, s];
		if (this.state === BACKOFF) return [-s, -s];
		return [s * this.turnDir, -s * this.turnDir];
	}
}

// A flat floor with box obstacles. Pose: x, z in cm, yaw in radians (0 = facing +x, positive turns left).
export class World {
	constructor() {
		this.t = 0;
		this.pose = { x: 0, z: 0, yaw: 0 };
		this.obstacles = [];         // { x, z, w, d } axis-aligned boxes, centre + size
		this.sonarOn = true;
		this.drive = new Drive({ clock: () => this.t, isBlocked: () => this.sonarOn && this.distance() < STOP_CM });
		this.wheelAngle = [0, 0];
		this.nextCheck = 0;
		this.lifted = false;         // on a book: wheels spin, rover stays put
		this.direct = null;          // [l, r] driven straight onto the motors, bypassing Drive (like wiring_test)
	}
	reset(pose = { x: 0, z: 0, yaw: 0 }) {
		this.pose = { ...pose }; this.direct = null; this.drive.state = [0, 0]; this.drive.lastCmd = this.t; this.drive.lastStop = ""; this.drive.blockedLast = false;
	}
	forward() { return [Math.cos(this.pose.yaw), -Math.sin(this.pose.yaw)]; }
	// Distance from the transducer faces to the first obstacle straight ahead, capped like gpiozero.
	// The README gives the HC-SR04 a ~15° cone, so three rays: straight ahead and ±7.5°.
	distance() {
		const [fx, fz] = this.forward();
		const ox = this.pose.x + fx * SONAR_FRONT, oz = this.pose.z + fz * SONAR_FRONT;
		let best = MAX_CM;
		for (const a of [0, 0.13, -0.13]) {
			const dx = Math.cos(this.pose.yaw + a), dz = -Math.sin(this.pose.yaw + a);
			for (const b of this.obstacles) {
				const t = rayBox(ox, oz, dx, dz, b);
				if (t != null && t < best) best = t;
			}
		}
		return Math.round(best * 10) / 10;
	}
	step(dt) {
		this.t += dt;
		if (this.nextCheck < this.t - 1) this.nextCheck = this.t;
		while (this.nextCheck <= this.t) { this.drive.check(); this.nextCheck += 0.05; }   // start_watchdog(period=0.05)
		const [l, r] = this.direct || this.drive.state;
		const vl = l * VMAX, vr = r * VMAX;
		this.wheelAngle[0] += (vl * dt) / 3.25; this.wheelAngle[1] += (vr * dt) / 3.25;
		if (this.lifted) return;
		const v = (vl + vr) / 2, w = (vr - vl) / (2 * HALF_TRACK);
		this.pose.yaw += w * dt;
		const [fx, fz] = this.forward();
		const nx = this.pose.x + fx * v * dt, nz = this.pose.z + fz * v * dt;
		if (!this.hits(nx, nz)) { this.pose.x = nx; this.pose.z = nz; }
	}
	hits(x, z) {
		const R = 10;
		return this.obstacles.some((b) => Math.abs(x - b.x) < b.w / 2 + R && Math.abs(z - b.z) < b.d / 2 + R);
	}
}

function rayBox(ox, oz, dx, dz, b) {
	let tmin = 0, tmax = Infinity;
	for (const [o, d, lo, hi] of [[ox, dx, b.x - b.w / 2, b.x + b.w / 2], [oz, dz, b.z - b.d / 2, b.z + b.d / 2]]) {
		if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
		let t1 = (lo - o) / d, t2 = (hi - o) / d;
		if (t1 > t2) [t1, t2] = [t2, t1];
		tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
		if (tmin > tmax) return null;
	}
	return tmin;
}

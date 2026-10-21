// Lesson content. Facts come from the rover repo: README.md, rover/*.py, drive.py, ros2/.
// Code blocks are the repo's code, trimmed to the lines that matter for the lesson.

// The Raspberry Pi 4's 40-pin header, physical pin -> what it is.
export const HEADER = {
	1: "3V3", 2: "5V", 3: "GPIO 2", 4: "5V", 5: "GPIO 3", 6: "GND", 7: "GPIO 4", 8: "GPIO 14", 9: "GND", 10: "GPIO 15",
	11: "GPIO 17", 12: "GPIO 18", 13: "GPIO 27", 14: "GND", 15: "GPIO 22", 16: "GPIO 23", 17: "3V3", 18: "GPIO 24", 19: "GPIO 10", 20: "GND",
	21: "GPIO 9", 22: "GPIO 25", 23: "GPIO 11", 24: "GPIO 8", 25: "GND", 26: "GPIO 7", 27: "GPIO 0", 28: "GPIO 1", 29: "GPIO 5", 30: "GND",
	31: "GPIO 6", 32: "GPIO 12", 33: "GPIO 13", 34: "GND", 35: "GPIO 19", 36: "GPIO 16", 37: "GPIO 26", 38: "GPIO 20", 39: "GND", 40: "GPIO 21",
};

// What the rover uses each pin for (from the README wiring tables).
export const ROVER_PINS = {
	2: "HC-SR04 VCC", 6: "L298N GND", 11: "IN1", 12: "ENA", 13: "IN2", 15: "IN3", 16: "IN4",
	29: "HC-SR04 TRIG", 31: "HC-SR04 ECHO (via divider)", 33: "ENB", 39: "HC-SR04 GND",
};

const SNIP = {
	pins: `# rover/motors.py  (BCM numbers, not physical pins)
LEFT_PINS = dict(forward=17, backward=27, enable=18)
RIGHT_PINS = dict(forward=22, backward=23, enable=13)

# rover/sensors.py
TRIG_PIN = 5
ECHO_PIN = 6
STOP_CM = 20.0`,
	power: `# README.md: wiring (L298N motor driver)
12V (VS)  -> battery +  (7.4 V, 2x 18650)    motor power only
GND       -> battery -  and a Pi GND (pin 6)  grounds must be shared
5V        -> nothing                         do not power the Pi from it

Pi USB-C  -> USB power bank
# Never take the Pi's power from the L298N's 5V pin;
# motor noise resets the Pi.`,
	motor: `from gpiozero import Motor

# ros2/rover_base/base_node.py
left = Motor(forward=17, backward=27, enable=18, pwm=True)   # IN1, IN2, ENA
right = Motor(forward=22, backward=23, enable=13, pwm=True)  # IN3, IN4, ENB

left.forward()    # IN1 high, IN2 low
left.backward()   # IN1 low,  IN2 high
left.stop()       # both low`,
	spin: `# drive.py --test
def wiring_test():
    for name, motor in (("left", DRIVE.left), ("right", DRIVE.right)):
        print(f"{name} wheel: forward")
        motor.forward(0.6)
        time.sleep(1)
        print(f"{name} wheel: backward")
        motor.backward(0.6)
        time.sleep(1)
        motor.stop()
        time.sleep(0.5)
    print("Done. If a wheel turned the wrong way, swap that motor's two wires.")`,
	pwm: `# rover/motors.py
left = Motor(pwm=True, **LEFT_PINS)    # enable=18 -> ENA
right = Motor(pwm=True, **RIGHT_PINS)  # enable=13 -> ENB

def _apply(self, left, right):
    self.left.value = left     # -1..1: sign = direction, size = duty
    self.right.value = right`,
	drive: `# drive.py: keys -> (left, right), then scaled by speed
speed = 0.6    # + and - change it, 0.3 to 1.0
moves = {
    KEY_UP:    (1, 1),
    KEY_DOWN:  (-1, -1),
    KEY_LEFT:  (-0.6, 0.6),   # spin left
    KEY_RIGHT: (0.6, -0.6),   # spin right
}
left, right = moves[key]
DRIVE.set(left * speed, right * speed)`,
	watchdog: `# rover/motors.py
DEADMAN_S = 0.5

def set(self, left, right):
    self.last_cmd = self.clock()        # every command resets the timer
    self._apply(left, right)

def check(self):                        # runs every 0.05 s
    if self.state == (0.0, 0.0):
        return False
    if self.clock() - self.last_cmd > self.timeout:
        self._apply(0.0, 0.0)           # dead-man: stop both motors
        return True`,
	sonar: `# rover/sensors.py
from gpiozero import DistanceSensor

sensor = DistanceSensor(echo=6, trigger=5,
                        max_distance=2.0, queue_len=5)

@property
def cm(self):
    return round(self.sensor.distance * 100.0, 1)   # metres -> cm`,
	gate: `# rover/motors.py
def is_forward(left, right):
    return left + right > 1e-6

def set(self, left, right):
    self.last_cmd = self.clock()
    self.blocked_last = is_forward(left, right) and self.is_blocked()
    if self.blocked_last:
        left = right = 0.0          # refuse forward under 20 cm
    self._apply(left, right)

# rover/sensors.py
def blocked(self):
    d = self.cm
    return d is not None and d < self.stop_cm   # 20.0`,
	camera: `# rover/camera.py
cam = Picamera2()
cfg = cam.create_video_configuration(
    main={"size": (640, 480)}, lores={"size": (320, 240), "format": "YUV420"})
cam.configure(cfg)
cam.start_recording(MJPEGEncoder(), FileOutput(buffer))  # newest JPEG kept

# rover/server.py: GET /stream.mjpg
async def frames():
    while True:
        frame = await asyncio.to_thread(cam.wait_frame, 1.0)
        yield b"--frame\\r\\nContent-Type: image/jpeg\\r\\n\\r\\n" + frame`,
	phone: `// rover/static/index.html: 10 Hz while a control is held
setInterval(() => {
  if (vec[0] || vec[1]) { held = true; ws.send(JSON.stringify({ l: vec[0] * speed(), r: vec[1] * speed() })); }
  else if (held) { held = false; ws.send(JSON.stringify({ l: 0, r: 0 })); }
}, 100);

# rover/server.py
@app.websocket("/ws")
async def ws(sock):
    while True:
        msg = json.loads(await sock.receive_text())
        if "l" in msg and "r" in msg and r.mode == "manual":
            r.drive.set(msg["l"], msg["r"])`,
	explore: `# rover/explore.py
def step(self, distance_cm, now):
    blocked = distance_cm is not None and distance_cm < self.stop_cm
    if self.state == FORWARD and blocked:
        self.state, self.until = BACKOFF, now + 0.6
    elif self.state == BACKOFF and now >= self.until:
        self.turn_dir = self.rng.choice((-1, 1))
        self.state, self.until = TURN, now + self.rng.uniform(0.5, 1.0)
    elif self.state == TURN and now >= self.until:
        if blocked:
            self.until = now + 0.5      # still blocked: keep turning
        else:
            self.state = FORWARD
    s = 0.5
    if self.state == FORWARD:  return (s, s)
    if self.state == BACKOFF:  return (-s, -s)
    return (s * self.turn_dir, -s * self.turn_dir)`,
	night: `# rover/night.py
def feed(self, gray):
    frame = np.asarray(gray, dtype=np.float32)
    changed = np.abs(frame - self.background) > 25      # pixel_delta
    self.last_fraction = float(changed.mean())
    self.background = 0.8 * self.background + 0.2 * frame
    if self.last_fraction >= 0.02 and now - self.last_alert >= 30.0:
        self.last_alert = now
        return True          # -> snapshot + send_alert() (logs only, for now)
    return False`,
	ros: `# ros2/rover_base/rover_base/base_node.py  (untested on hardware)
def on_cmd(self, msg):                  # /cmd_vel, geometry_msgs/Twist
    v, w = msg.linear.x, msg.angular.z
    if v > 0 and self.distance() < self.stop_dist:
        v = 0.0
    left = (v - w * self.sep / 2) / self.vmax     # sep 0.135 m
    right = (v + w * self.sep / 2) / self.vmax    # vmax 0.35 m/s
    self.left.value = max(-1.0, min(1.0, left))
    self.right.value = max(-1.0, min(1.0, right))`,
};

// task types:
//  pin    : click a pin on the Pi header (wire = model wire id, or null for "find the pin")
//  choice : pick one answer; wrong answers carry their explanation
export const LESSONS = [
	{
		id: "pi", title: "Meet the Pi and its GPIO header", short: "Two numbers for every pin, and which ones the rover uses.",
		focus: ["pi"], cam: "header",
		body: [
			"The Raspberry Pi 4 is the rover's brain. Everything it controls goes through the 40-pin header along one edge of the board.",
			"Each pin has two numbers. The <b>physical</b> number counts along the header: odd pins on the inner row, even pins on the board edge, pin 1 at the end away from the USB ports. The <b>GPIO</b> (BCM) number is the one the code uses. GPIO 17 is physical pin 11. Mixing the two up is the most common wiring mistake.",
			"Some pins are not GPIOs at all: 5 V, 3.3 V and ground (GND). The rover uses eight GPIOs: six for the motor driver and two for the distance sensor.",
		],
		tasks: [
			{ type: "pin", wire: null, label: "Find GPIO 17 (the left motor's IN1)", pin: 11 },
			{ type: "pin", wire: null, label: "Find a ground (GND) pin", pin: 6, gnd: true },
		],
		code: { file: "rover/motors.py, rover/sensors.py", src: SNIP.pins, lang: "py" },
		sim: "pinTour", runLabel: "Run: walk the pin map",
	},
	{
		id: "power", title: "Power: two supplies, one ground", short: "Batteries for the motors, a power bank for the Pi.",
		focus: ["batt", "bank", "l298", "pi"], cam: "power",
		body: [
			"The rover has two supplies. Two 18650 cells in a holder (7.4 V) feed the motors through the L298N. A USB power bank feeds the Pi through its USB-C port.",
			"Why two? Motors are electrically noisy: when they start, stall or reverse, the battery voltage jumps around. The README is blunt about it: never take the Pi's power from the L298N's 5V pin, because motor noise resets the Pi. Leave that terminal empty.",
			"The two supplies must share a ground. The Pi's signals are measured against its own GND, and the L298N can only read them if both boards agree on what 0 V is. One black wire from Pi pin 6 to the L298N's GND terminal does that. The battery's minus lead goes into the same terminal.",
		],
		tasks: [
			{ type: "choice", wire: ["battP"], label: "Battery + (red) goes to the L298N's…", options: [
				{ t: "12V (VS) terminal", ok: true },
				{ t: "5V terminal", why: "The 5V terminal is not the motor supply input. Battery + goes to 12V (VS); 5V stays empty." },
				{ t: "GND terminal", why: "That would join + and − of the battery: a short circuit. GND takes the battery's minus lead." },
			] },
			{ type: "choice", wire: ["battN"], label: "Battery − (black) goes to…", options: [
				{ t: "L298N GND terminal", ok: true },
				{ t: "L298N 12V terminal", why: "12V already has battery +. Minus goes to GND, which the Pi's ground will share." },
			] },
			{ type: "pin", wire: "gnd6", label: "Shared ground: L298N GND to a Pi GND pin", pin: 6, gnd: true, src: "l298Power" },
			{ type: "choice", wire: ["usb"], label: "The Pi gets its power from…", options: [
				{ t: "The power bank, into USB-C", ok: true },
				{ t: "The L298N's 5V terminal", why: "Motor noise on that rail resets the Pi. The README says never do this." },
				{ t: "The 7.4 V battery, straight to a 5V pin", why: "7.4 V is well over the 5 V the Pi expects, and it would share the motors' noisy supply." },
			] },
		],
		code: { file: "README.md", src: SNIP.power, lang: "text" },
		sim: "power", runLabel: "Run: power up",
	},
	{
		id: "driver", title: "The motor driver", short: "An H-bridge per motor. IN pins pick the direction.",
		focus: ["l298", "pi", "motorL", "motorR"], cam: "l298",
		body: [
			"A GPIO pin gives a few milliamps at 3.3 V. A gear motor needs far more current at battery voltage. The L298N sits in between: the Pi tells it what to do, the battery supplies the power.",
			"Inside are two H-bridges, one per motor. An H-bridge is four switches around the motor. Close one diagonal pair and current flows one way through the motor; close the other pair and it flows the other way.",
			"The IN pins choose the pair. Left motor: IN1 high and IN2 low is forward, IN1 low and IN2 high is backward, both low is stop. IN3 and IN4 do the same for the right motor. gpiozero's <code>Motor</code> calls these pins <code>forward</code> and <code>backward</code>.",
		],
		tasks: [
			{ type: "pin", wire: "in1", label: "IN1 (left forward) to GPIO 17", pin: 11, src: ["lIn", 1] },
			{ type: "pin", wire: "in2", label: "IN2 (left backward) to GPIO 27", pin: 13, src: ["lIn", 2] },
			{ type: "pin", wire: "in3", label: "IN3 (right forward) to GPIO 22", pin: 15, src: ["lIn", 3] },
			{ type: "pin", wire: "in4", label: "IN4 (right backward) to GPIO 23", pin: 16, src: ["lIn", 4] },
			{ type: "choice", wire: ["outL1", "outL2"], label: "The left motor's two wires go to…", options: [
				{ t: "OUT1 / OUT2", ok: true },
				{ t: "OUT3 / OUT4", why: "OUT3/OUT4 are the right channel, switched by IN3/IN4. The left motor belongs on OUT1/OUT2, next to IN1/IN2's bridge." },
			] },
			{ type: "choice", wire: ["outR1", "outR2"], label: "And the right motor's…", options: [
				{ t: "OUT3 / OUT4", ok: true },
				{ t: "OUT1 / OUT2", why: "Those are taken by the left motor. Right motor: OUT3/OUT4." },
			] },
		],
		code: { file: "ros2/rover_base/rover_base/base_node.py", src: SNIP.motor, lang: "py" },
		sim: "hbridge", runLabel: "Run: forward, backward, stop",
	},
	{
		id: "spin", title: "Spin one wheel", short: "drive.py --test, with the rover on a book.",
		hot: ["outL1", "outL2", "outR1", "outR2", "in1", "in2", "in3", "in4"],
		focus: ["wheelL", "wheelR", "motorL", "motorR", "l298"], cam: "side",
		body: [
			"Before the rover touches the floor, test each wheel on its own. Put it on a book so the wheels are in the air, then run <code>python3 drive.py --test</code> over SSH.",
			"The test turns the left wheel forward for a second, then backward, then does the same on the right. If a wheel turns the wrong way, swap that motor's two wires on its OUT terminals. No code change needed.",
			"Notice the speed. The test asks for 0.6, but the ENA and ENB jumper caps are still on, which ties the enable pins high: the wheel runs flat out whatever the code asks. The next lesson fixes that.",
		],
		tasks: [],
		code: { file: "drive.py", src: SNIP.spin, lang: "py" },
		sim: "spinTest", runLabel: "Run: drive.py --test", lifted: true,
	},
	{
		id: "pwm", title: "Speed with PWM", short: "Pull the jumper caps; ENA and ENB take the duty cycle.",
		focus: ["l298", "pi", "wheelL", "wheelR"], cam: "l298",
		body: [
			"A GPIO pin is either on or off. To get a slower wheel, the Pi switches the motor's power on and off very quickly. The fraction of time it is on is the <b>duty cycle</b>: the higher it is, the faster the wheel. This is PWM, pulse-width modulation.",
			"On the L298N the speed input is the enable pin: ENA for the left motor, ENB for the right. Out of the box each has a jumper cap that ties it high, which means always on. <b>Pull both caps off first</b>, then wire ENA to GPIO 18 (pin 12) and ENB to GPIO 13 (pin 33).",
			"With <code>pwm=True</code>, gpiozero pulses the enable pin and <code>motor.value</code> sets the duty: 0.6 is 60 % forwards, −0.3 is 30 % backwards, 0 stops.",
		],
		tasks: [
			{ type: "choice", wire: [], jumpers: true, label: "The ENA and ENB jumper caps…", options: [
				{ t: "Come off before wiring", ok: true },
				{ t: "Stay on", why: "With a cap on, the enable pin is tied high and the motor ignores the Pi's PWM: full speed or nothing." },
			] },
			{ type: "pin", wire: "ena", label: "ENA (left speed) to GPIO 18", pin: 12, src: ["lIn", 0] },
			{ type: "pin", wire: "enb", label: "ENB (right speed) to GPIO 13", pin: 33, src: ["lIn", 5] },
		],
		code: { file: "rover/motors.py", src: SNIP.pwm, lang: "py" },
		sim: "pwm", runLabel: "Run: sweep the duty", lifted: true,
	},
	{
		id: "drive", title: "Drive and turn", short: "No steering wheel: two speeds, left and right.",
		hot: ["outL1", "outL2", "outR1", "outR2"],
		focus: ["wheelL", "wheelR"], cam: "floor",
		body: [
			"The rover has no steering. It turns by running its two wheels at different speeds. This is <b>differential drive</b>.",
			"Every mode goes through one call: <code>Drive.set(left, right)</code>, each between −1 and 1. Equal values go straight. Opposite values spin on the spot. Unequal values of the same sign make a curve, bending towards the slower wheel.",
			"The keyboard driver maps keys to pairs and multiplies by a speed that starts at 0.6. Try the buttons below the code, or press Run for a short drive.",
		],
		tasks: [],
		code: { file: "drive.py", src: SNIP.drive, lang: "py" },
		sim: "drive", runLabel: "Run: a short drive",
	},
	{
		id: "watchdog", title: "The dead-man watchdog", short: "Every command expires after 0.5 s.",
		hot: ["in1", "in2", "in3", "in4", "ena", "enb"],
		focus: ["pi", "wheelL", "wheelR"], cam: "floor",
		body: [
			"What if the SSH session freezes while the rover is driving forward, or the phone loses Wi-Fi? Without a rule, the motors keep the last command forever.",
			"So every command expires. <code>Drive.set()</code> notes the time; a watchdog thread checks every 0.05 s. If no new command has arrived for 0.5 s, it stops both motors. It works like the handle on a lawnmower: let go and it stops.",
			"Holding a key repeats it, so commands keep arriving. Press and hold the button below, then let go and watch the timer.",
		],
		tasks: [],
		code: { file: "rover/motors.py", src: SNIP.watchdog, lang: "py" },
		sim: "watchdog", runLabel: "Run: drive, then go silent",
	},
	{
		id: "sonar", title: "Measure distance", short: "The HC-SR04, and why ECHO needs a divider.",
		focus: ["sonar", "bb", "pi"], cam: "sonar",
		body: [
			"The HC-SR04 sends a short burst of ultrasound and listens for the echo. The Pi pulses TRIG; the sensor then holds ECHO high for as long as the sound took to get there and back. Distance is that time × the speed of sound (about 343 m/s) ÷ 2.",
			"ECHO comes back at <b>5 V</b>, and the Pi's GPIO pins are 3.3 V. Two resistors fix that: 1 kΩ from ECHO to GPIO 6, and 2 kΩ from GPIO 6 to ground. The pin sees 5 V × 2 kΩ ÷ (1 kΩ + 2 kΩ) = <b>3.33 V</b>. TRIG needs nothing: a 3.3 V trigger is fine.",
			"gpiozero's <code>DistanceSensor</code> does the timing. With <code>max_distance=2.0</code> readings top out at 200 cm, and <code>queue_len=5</code> smooths over the last five.",
		],
		tasks: [
			{ type: "pin", wire: "sVcc", label: "HC-SR04 VCC to 5 V", pin: 2, alt: [4], src: ["sonarPin", 0] },
			{ type: "pin", wire: "sTrig", label: "TRIG to GPIO 5", pin: 29, src: ["sonarPin", 1] },
			{ type: "choice", wire: ["sEcho", "sGnd"], label: "ECHO reaches GPIO 6 through…", options: [
				{ t: "1 kΩ in series, 2 kΩ from GPIO 6 to GND", ok: true },
				{ t: "A straight wire", why: "ECHO is 5 V. Straight into a 3.3 V GPIO it can damage the Pi. The divider brings it down to 3.33 V." },
				{ t: "2 kΩ in series, 1 kΩ to GND", why: "Swapped: 5 V × 1k ÷ 3k = 1.67 V, which may not read as high. The bigger resistor goes to ground." },
			] },
			{ type: "pin", wire: "sDiv", label: "Divider midpoint to GPIO 6", pin: 31, src: "bb" },
			{ type: "pin", wire: "sGnd39", label: "Breadboard ground rail to a Pi GND", pin: 39, gnd: true, src: "bb" },
		],
		code: { file: "rover/sensors.py", src: SNIP.sonar, lang: "py" },
		sim: "sonar", runLabel: "Run: start pinging",
	},
	{
		id: "stop", title: "Stop before obstacles", short: "The 20 cm rule, and why reversing still works.",
		hot: ["sVcc", "sTrig", "sEcho", "sGnd", "sDiv", "sGnd39"],
		focus: ["sonar", "wheelL", "wheelR"], cam: "floor",
		body: [
			"With a distance reading, <code>Drive</code> gets one more rule: forward motion is refused when the sensor reads under 20 cm.",
			"Forward means <code>left + right &gt; 0</code>. Reversing (−, −) and spinning on the spot (+, −) still work, so the rover can always get itself out. A pivot on one wheel, like (0.6, 0), counts as forward and is refused.",
			"The rule is checked when a command arrives and again by the watchdog, so a rover already rolling forward stops as soon as something appears. One caveat: the HC-SR04 sees a cone of about 15° at bumper height. Chair legs and soft fabric can fool it.",
		],
		tasks: [],
		code: { file: "rover/motors.py, rover/sensors.py", src: SNIP.gate, lang: "py" },
		sim: "gate", runLabel: "Run: drive at the wall",
	},
	{
		id: "camera", title: "Camera stream", short: "Pi Camera v1.3, picamera2 and an MJPEG stream.",
		focus: ["cam", "pi"], cam: "camera",
		body: [
			"The Pi Camera v1.3 plugs into the CAMERA port, between HDMI and audio, with a flat ribbon. It works with picamera2 on Raspberry Pi OS Bookworm and the default <code>camera_auto_detect=1</code>. Check it with <code>rpicam-hello -t 2000</code>.",
			"picamera2 records 640 × 480 and an MJPEG encoder turns every frame into a JPEG. The server keeps only the newest one. A second 320 × 240 low-resolution stream feeds motion detection later.",
			"The phone page shows <code>/stream.mjpg</code>: one HTTP response that never ends, where each part is a complete JPEG. By day the frame duration is 33,333 µs, so 30 frames a second.",
		],
		tasks: [
			{ type: "choice", wire: ["ribbon"], label: "The ribbon goes into the CAMERA port with…", options: [
				{ t: "Blue side towards the audio jack, contacts towards HDMI", ok: true },
				{ t: "Blue side towards HDMI", why: "Backwards: the contacts must face the HDMI side or they don't touch the connector's pins." },
			] },
		],
		code: { file: "rover/camera.py, rover/server.py", src: SNIP.camera, lang: "py" },
		sim: "camera", runLabel: "Run: start the stream",
	},
	{
		id: "phone", title: "Drive from the phone", short: "A WebSocket, ten messages a second.",
		hot: ["ribbon", "usb"],
		focus: ["pi", "cam", "wheelL", "wheelR"], cam: "floor",
		body: [
			"<code>python3 -m rover.server</code> starts a small FastAPI server on port 8000. Open <code>http://&lt;pi-hostname&gt;.local:8000</code> on a phone on the same Wi-Fi: live video, a D-pad, a joystick and a speed slider.",
			"The page keeps a WebSocket open. While a finger is on a control it sends <code>{\"l\": .., \"r\": ..}</code> ten times a second. Lift the finger and it sends one <code>{\"l\": 0, \"r\": 0}</code>. The joystick mixes forward and turn: left = y + 0.7x, right = y − 0.7x.",
			"If the messages just stop (Wi-Fi drop, phone locked), the 0.5 s dead-man stops the motors. Closing the page stops them at once. Try the joystick below, then try it again with the Wi-Fi off.",
		],
		tasks: [],
		code: { file: "rover/static/index.html, rover/server.py", src: SNIP.phone, lang: "py" },
		sim: "phone", runLabel: "Run: connect",
	},
	{
		id: "explore", title: "Explore mode", short: "A three-state machine that drives itself.",
		hot: ["sVcc", "sTrig", "sEcho", "sGnd", "sDiv", "sGnd39"],
		focus: ["sonar", "wheelL", "wheelR"], cam: "floorWide",
		body: [
			"Explore makes the rover drive itself with three states. <b>Forward</b> at half speed. When the distance drops under 20 cm: <b>back off</b> for 0.6 s. Then <b>turn</b> a random way for 0.5 to 1 s. Still blocked after turning? Keep turning another 0.5 s. Then forward again.",
			"<code>step()</code> is a pure function of the distance and the time, which makes it easy to test on a laptop. The server calls it ten times a second and sends the result through <code>Drive.set()</code>, so the dead-man and the 20 cm gate still apply.",
		],
		tasks: [],
		code: { file: "rover/explore.py", src: SNIP.explore, lang: "py" },
		sim: "explore", runLabel: "Run: explore",
	},
	{
		id: "night", extra: true, title: "Night mode", short: "Long exposure, and motion detection by frame differencing.",
		hot: ["ribbon"],
		focus: ["cam"], cam: "camera",
		body: [
			"The Night button switches the camera to a 100 ms exposure and analogue gain 8, which caps it at 10 frames a second. Fine for a parked rover.",
			"Motion detection compares a small grey frame twice a second with a slowly updated background. A pixel counts as changed if it moved by more than 25 grey levels. If 2 % or more of the pixels changed, the rover saves a snapshot and calls <code>send_alert()</code>, then waits 30 s before alerting again. For now the alert only writes to the log.",
			"In real darkness the v1.3 camera sees nothing: it has an IR-cut filter. The plan is a Pi NoIR camera (same ribbon, same code) with 850 nm IR LEDs.",
		],
		tasks: [],
		code: { file: "rover/night.py", src: SNIP.night, lang: "py" },
		sim: "night", runLabel: "Run: watch the room",
	},
	{
		id: "ros", extra: true, title: "Next: ROS 2", short: "/cmd_vel in, /range out. Written, not yet tested.",
		hot: ["outL1", "outL2", "outR1", "outR2", "sTrig", "sDiv"],
		focus: ["pi", "sonar", "wheelL", "wheelR"], cam: "floor",
		body: [
			"The repo has a ROS 2 Jazzy package, <code>rover_base</code>, that does the same job the ROS way. It has <b>not been tested on hardware</b> yet.",
			"It listens on <code>/cmd_vel</code>: a forward speed v in m/s and a turn rate ω in rad/s. With the wheels 0.135 m apart and a top speed of 0.35 m/s, each wheel's duty is (v ∓ ω × 0.135 ÷ 2) ÷ 0.35. It publishes the HC-SR04 on <code>/range</code> at 10 Hz. Same pins, same 0.5 s timeout, same 20 cm rule.",
			"The plan after that: an RPLIDAR A1 on a plate above the chassis, slam_toolbox for a map of the rooms, and Nav2 to drive around it.",
		],
		tasks: [],
		code: { file: "ros2/rover_base/rover_base/base_node.py", src: SNIP.ros, lang: "py" },
		sim: "ros", runLabel: "Run: send /cmd_vel",
	},
];

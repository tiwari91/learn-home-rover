import { test, expect } from "@playwright/test";

const SHOTS = process.env.SHOTS;   // folder for screenshots, optional

function watchErrors(page) {
	const errors = [];
	page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
	page.on("pageerror", (e) => errors.push(String(e)));
	page.on("requestfailed", (r) => errors.push(`failed: ${r.url()}`));
	return errors;
}
async function ready(page) {
	await page.waitForSelector("body[data-ready='1']", { timeout: 30_000 });
	await expect(page.locator("#loader")).toHaveCount(0);
}

test("home loads without errors and lists the lessons", async ({ page }) => {
	const errors = watchErrors(page);
	await page.goto("./");
	await ready(page);
	await expect(page.locator("#cards .card")).toHaveCount(14);
	await expect(page.locator(".hero h1")).toContainText("one wire at a time");
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/home-desktop.png` });
	expect(errors).toEqual([]);
});

test("pin table matches the rover's wiring", async ({ page }) => {
	await page.goto("./");
	await ready(page);
	const ok = await page.evaluate(async () => {
		const { HEADER } = await import("./js/lessons.js");
		const want = { 2: "5V", 6: "GND", 11: "GPIO 17", 12: "GPIO 18", 13: "GPIO 27", 15: "GPIO 22", 16: "GPIO 23", 29: "GPIO 5", 31: "GPIO 6", 33: "GPIO 13", 39: "GND" };
		return Object.entries(want).every(([p, n]) => HEADER[p] === n) && Object.keys(HEADER).length === 40;
	});
	expect(ok).toBe(true);
});

test("every lesson opens and Run starts", async ({ page }) => {
	const errors = watchErrors(page);
	await page.goto("./");
	await ready(page);
	for (let i = 1; i <= 14; i++) {
		await page.goto(`./#/lesson/${i}`);
		await expect(page.locator("#lessonNum")).toContainText(`Lesson ${i} of 14`);
		if (await page.locator("#autoWire").isVisible()) await page.click("#autoWire");
		await expect(page.locator("#runBtn")).toBeEnabled({ timeout: 10_000 });
		await page.click("#runBtn");
		await expect(page.locator("#stopBtn")).toBeEnabled();
		await page.waitForTimeout(700);
		await expect(page.locator("#console")).not.toBeEmpty();
		await page.click("#stopBtn");
	}
	expect(errors).toEqual([]);
});

test("a wrong pin gets an explanation, the right one connects", async ({ page }) => {
	await page.goto("./#/lesson/3");
	await ready(page);
	await page.click('#gpio [data-pin="7"]');
	await expect(page.locator("#feedback")).toContainText("GPIO 4");
	await expect(page.locator("#feedback")).toContainText("physical pin 11");
	await page.click('#gpio [data-pin="11"]');
	await expect(page.locator("#feedback")).toContainText("Connected to pin 11");
	await expect(page.locator(".task.done")).toHaveCount(1);
});

test("the rover stops at 20 cm and the watchdog stops it", async ({ page }) => {
	await page.goto("./#/lesson/9");
	await ready(page);
	await page.click("#runBtn");
	await expect(page.locator("#console")).toContainText("refused", { timeout: 20_000 });
	const d = await page.evaluate(() => window.__rover.world.distance());
	expect(d).toBeGreaterThan(17);
	expect(d).toBeLessThan(20.5);
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/lesson-09-desktop.png` });
	await page.goto("./#/lesson/7");
	await page.click("#runBtn");
	await expect(page.locator("#console")).toContainText("watchdog: no command", { timeout: 10_000 });
	await expect(page.locator("#runNote")).toContainText("Lesson done");
});

test("progress is kept in localStorage", async ({ page }) => {
	await page.goto("./#/lesson/4");
	await ready(page);
	await page.click("#runBtn");
	await expect(page.locator("#runNote")).toContainText("Lesson done", { timeout: 15_000 });
	await page.goto("./#/");
	await expect(page.locator('.card.done[data-lesson="spin"]')).toHaveCount(1);
	await expect(page.locator("#progressPill")).toContainText("1 / 14");
});

test.describe("phone", () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	test("no horizontal scroll on home or lessons", async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto("./");
		await ready(page);
		const wide = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(await wide()).toBeLessThanOrEqual(0);
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/home-phone.png` });
		for (const i of [1, 3, 8, 11, 12]) {
			await page.goto(`./#/lesson/${i}`);
			await page.waitForTimeout(200);
			expect(await wide(), `lesson ${i}`).toBeLessThanOrEqual(0);
		}
		expect(errors).toEqual([]);
	});
});

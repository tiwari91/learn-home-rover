// Screenshots for review: SHOTS=/some/folder npx playwright test shots
import { test, expect } from "@playwright/test";

const SHOTS = process.env.SHOTS;
test.skip(!SHOTS, "set SHOTS to a folder to take screenshots");

for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
	test.describe(name, () => {
		test.use({ viewport, deviceScaleFactor: name === "phone" ? 2 : 1 });
		test(`screens ${name}`, async ({ page }) => {
			await page.goto("./");
			await page.waitForSelector("body[data-ready='1']");
			await page.waitForTimeout(500);
			await page.screenshot({ path: `${SHOTS}/home-${name}.png` });
			await page.goto("./#/lesson/3");
			await page.click('#gpio [data-pin="11"]');
			await page.click('#gpio [data-pin="14"]');
			await page.waitForTimeout(900);
			if (name === "phone") await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: `${SHOTS}/lesson-03-${name}.png` });
			await page.goto("./#/lesson/9");
			await page.click("#runBtn");
			await expect(page.locator("#console")).toContainText("refused", { timeout: 20_000 });
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${SHOTS}/lesson-09-${name}.png` });
		});
	});
}

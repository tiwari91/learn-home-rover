import { defineConfig } from "@playwright/test";

const live = process.env.BASE_URL;
export default defineConfig({
	testDir: "tests",
	workers: 1,
	timeout: 60_000,
	use: {
		baseURL: live || "http://127.0.0.1:8123/learn-home-rover/",
		channel: process.env.PW_CHANNEL || "chrome",   // the installed Chrome; no browser download
		launchOptions: { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
	},
	webServer: live ? undefined : { command: "node tests/serve.mjs", url: "http://127.0.0.1:8123/learn-home-rover/", reuseExistingServer: true },
});

import { _electron } from "playwright";
import path from "node:path";
import { TOOL } from "../config.mjs";
import { waitFor } from "../services.mjs";
import { electronExecutable } from "./executable.mjs";
export class NativeDesktop {
  constructor({ userData } = {}) {
    this.userData = userData;
  }
  async launch() {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    if (this.userData) env.GOA2_LAB_ELECTRON_USER_DATA = this.userData;
    this.app = await _electron.launch({
      executablePath: await electronExecutable(),
      args: [path.join(TOOL, "desktop/main.cjs")],
      env,
    });
    this.root = await this.app.firstWindow();
    await waitFor(
      () => this.app.evaluate(() => !!global.lab),
      "desktop initialization",
      30000,
    );
  }
  async open(url, show = true) {
    await this.app.evaluate(async (_, { url, show }) => lab.open(url, show), {
      url,
      show,
    });
  }
  async newContext(profile) {
    let id, page;
    return {
      get nativeId() {
        return id;
      },
      newPage: async () => {
        // Electron's window event is global: serialize creation only, while
        // navigation and rendering of separate views can proceed concurrently.
        const previous = this.creating || Promise.resolve();
        let release;
        this.creating = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          const created = this.app.waitForEvent("window");
          id = await this.app.evaluate(
            async (_, profile) => lab.create(profile),
            profile,
          );
          page = await created;
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Emulation.setTimezoneOverride", {
            timezoneId: "Europe/Copenhagen",
          });
          await cdp.send("Emulation.setLocaleOverride", { locale: "en-GB" });
          await cdp.send("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-color-scheme", value: "dark" }],
          });
          await cdp.send("Emulation.setTouchEmulationEnabled", {
            enabled: !!profile.isMobile,
            maxTouchPoints: 5,
          });
          // Keep emulation attached for this view's lifetime. Detaching resets touch.
          page.__labNative = true;
          const screenshot = page.screenshot.bind(page);
          let captures = Promise.resolve();
          page.screenshot = (options) => {
            const result = captures.then(async () => {
              await this.app.evaluate((_, id) => lab.beginCapture(id), id);
              try {
                return await screenshot({ timeout: 120_000, ...options });
              } finally {
                await this.app
                  .evaluate((_, id) => lab.endCapture(id), id)
                  .catch(() => {});
              }
            });
            captures = result.catch(() => {});
            return result;
          };
          return page;
        } finally {
          release();
        }
      },
      newCDPSession: (p) => p.context().newCDPSession(p),
      close: async () => {
        if (id)
          await this.app
            .evaluate((_, id) => lab.destroy(id), id)
            .catch(() => {});
      },
    };
  }
  async close() {
    await this.app?.close();
  }
}

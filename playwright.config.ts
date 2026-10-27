import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;

/** Software WebGL so the Three.js scene renders in headless Chromium runs without a GPU. */
const SWIFTSHADER = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // One project per device class: desktop, Android phone (Chromium), iPad and iPhone (WebKit = Safari's engine).
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: SWIFTSHADER },
    },
    {
      name: 'android-pixel-7',
      use: { ...devices['Pixel 7'], launchOptions: SWIFTSHADER },
    },
    {
      name: 'ipad-webkit',
      use: { ...devices['iPad (gen 7)'] },
    },
    {
      name: 'iphone-14-webkit',
      use: { ...devices['iPhone 14'] },
    },
  ],
  // The dev server exposes the window.__sim debug hook the smoke test asserts against.
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

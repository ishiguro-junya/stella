import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { browser } from '@wdio/globals';

import { reserveAvailablePort } from './scripts/available-port.mts';

const execFileAsync = promisify(execFile);

const breakpoint = process.env.STELLA_E2E_BREAKPOINT;
const headless = process.env.STELLA_E2E_HEADLESS !== 'false';

const readmeScreenshotSpec = './app/test/e2e/readme-screenshots.spec.ts';
const visualQaSpec = './app/test/e2e/visual-qa.spec.ts';
const testModes = {
  e2e: {
    appBinaryPath: './target/release/Stella (E2E)',
    portRange: [4445, 4464],
    specs: ['./app/test/e2e/**/*.spec.ts'],
    exclude: [readmeScreenshotSpec, visualQaSpec],
  },
  vrt: {
    appBinaryPath: './target/release/Stella (VRT)',
    portRange: [4465, 4484],
    specs: [visualQaSpec],
    exclude: [],
  },
  scr: {
    appBinaryPath: './target/release/Stella (SCR)',
    portRange: [4485, 4504],
    specs: [readmeScreenshotSpec, visualQaSpec],
    exclude: [],
  },
} as const;

const requestedMode = process.env.STELLA_TEST_MODE ?? 'e2e';
if (requestedMode !== 'e2e' && requestedMode !== 'vrt' && requestedMode !== 'scr') {
  throw new Error(`Unsupported STELLA_TEST_MODE: ${requestedMode}`);
}
const testMode = requestedMode;
const mode = testModes[requestedMode];
const isWorker = process.env.WDIO_WORKER_ID !== undefined;
const isLauncher = process.argv.some((argument) => argument.endsWith('/wdio.js'));
const portReservation =
  !isWorker && isLauncher
    ? await reserveAvailablePort({
        label: `${testMode.toUpperCase()} test`,
        start: mode.portRange[0],
        end: mode.portRange[1],
        explicitPort: process.env.TAURI_WEBDRIVER_PORT,
      })
    : undefined;
const embeddedPort = portReservation?.port ?? mode.portRange[0];
if (!isWorker && isLauncher) {
  console.log(`${testMode.toUpperCase()} test WebDriver port: ${embeddedPort}`);
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  outputDir: resolve('tmp', 'wdio-logs', testMode),
  specs: [...mode.specs],
  exclude: [...mode.exclude],
  maxInstances: 1,
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath: mode.appBinaryPath,
        driverProvider: 'embedded',
        embeddedPort,
        env: {
          TAURI_DATA_DIR: resolve('tmp', 'tauri-data', testMode),
        },
        startTimeout: 60_000,
        statusPollTimeout: 5_000,
      },
    ],
  ],
  capabilities: [
    {
      browserName: 'tauri',
    },
  ],
  logLevel: testMode === 'vrt' ? 'warn' : 'info',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: 'mocha',
  reporters: ['spec'],
  before: async () => {
    const appName = mode.appBinaryPath.split('/').at(-1);
    const { stdout } = await execFileAsync('/usr/bin/lsappinfo', ['-all', 'list']);
    const app = stdout.split('\n---').find((entry) => entry.includes(`/target/release/${appName}`));
    if (!app?.includes(`"LSDisplayName"="${appName}"`)) {
      throw new Error(`${appName} did not launch with its dedicated application name.`);
    }
  },
  beforeSuite: async () => {
    if (headless) return;
    await browser.tauri.execute(
      "window.__TAURI__.core.invoke('plugin:window|show', { label: 'main' })",
    );
    await browser.tauri.execute(
      "window.__TAURI__.core.invoke('plugin:window|set_focus', { label: 'main' })",
    );
  },
  onComplete: async () => {
    await portReservation?.release();
  },
  mochaOpts: {
    ui: 'bdd',
    // WebdriverIO subtracts 3ms, so use one less than Mocha's limit to effectively disable it.
    timeout: breakpoint ? 2_147_483_646 : testMode === 'e2e' ? 60_000 : 180_000,
  },
};

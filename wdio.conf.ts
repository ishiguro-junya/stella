import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { browser } from '@wdio/globals';

const execFileAsync = promisify(execFile);

const breakpoint = process.env.STELLA_E2E_BREAKPOINT;
const headless = process.env.STELLA_E2E_HEADLESS !== 'false';

const readmeScreenshotSpec = './app/test/e2e/readme-screenshots.spec.ts';
const visualQaSpec = './app/test/e2e/visual-qa.spec.ts';
const testModes = {
  e2e: {
    appBinaryPath: './target/release/Stella (E2E)',
    embeddedPort: 4445,
    specs: ['./app/test/e2e/**/*.spec.ts'],
    exclude: [readmeScreenshotSpec, visualQaSpec],
  },
  vrt: {
    appBinaryPath: './target/release/Stella (VRT)',
    embeddedPort: 4446,
    specs: [visualQaSpec],
    exclude: [],
  },
  scr: {
    appBinaryPath: './target/release/Stella (SCR)',
    embeddedPort: 4447,
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

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: [...mode.specs],
  exclude: [...mode.exclude],
  maxInstances: 1,
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath: mode.appBinaryPath,
        driverProvider: 'embedded',
        embeddedPort: mode.embeddedPort,
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
      throw new Error(`${appName}が専用のアプリ名で起動していません。`);
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
  mochaOpts: {
    ui: 'bdd',
    // WebdriverIOが3ms差し引くため、停止時はMochaの上限値より1ms小さくして実質無効化する。
    timeout: breakpoint ? 2_147_483_646 : testMode === 'e2e' ? 60_000 : 180_000,
  },
};

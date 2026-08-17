const screenshotMode = process.env.STELLA_SCREENSHOT === 'true';
const breakpoint = process.env.STELLA_E2E_BREAKPOINT;

const readmeScreenshotSpec = './app/test/e2e/readme-screenshots.spec.ts';
const visualQaSpec = './app/test/e2e/visual-qa.spec.ts';

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: screenshotMode ? [readmeScreenshotSpec] : ['./app/test/e2e/**/*.spec.ts'],
  exclude: screenshotMode ? [] : [readmeScreenshotSpec, visualQaSpec],
  maxInstances: 1,
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath: './target/release/Stella (TEST)',
        driverProvider: 'embedded',
        embeddedPort: 4445,
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
  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    // WebdriverIOが3ms差し引くため、停止時はMochaの上限値より1ms小さくして実質無効化する。
    timeout: breakpoint ? 2_147_483_646 : screenshotMode ? 180_000 : 60_000,
  },
};

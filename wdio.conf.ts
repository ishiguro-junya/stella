const visualQaDirectory = process.env.STELLA_VISUAL_QA_DIR;
if (visualQaDirectory) {
  // 保存先はテスト用ワーカーだけへ渡し、ネイティブアプリの起動環境から分離する。
  delete process.env.STELLA_VISUAL_QA_DIR;
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  ...(visualQaDirectory ? { runnerEnv: { VISUAL_QA_OUTPUT_DIR: visualQaDirectory } } : {}),
  specs: ['./tests/e2e/**/*.spec.ts'],
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
    timeout: 60_000,
  },
};

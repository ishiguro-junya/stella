import {
  resetDevelopmentShowcaseFixture,
  setupShowcaseFixtureBase,
} from '../tests/e2e/support/showcaseRepository.js';

const command = process.argv[2];

if (command === 'setup') {
  const path = await setupShowcaseFixtureBase();
  console.log(`基底フィクスチャを作成しました: ${path}`);
} else if (command === 'reset') {
  const paths = await resetDevelopmentShowcaseFixture();
  console.log(`開発用フィクスチャを初期状態へ戻しました:\n${paths.join('\n')}`);
} else {
  throw new Error('使い方: node --import tsx scripts/showcase-fixture.mts <setup|reset>');
}

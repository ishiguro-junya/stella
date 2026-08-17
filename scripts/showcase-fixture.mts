import {
  resetDevelopmentShowcaseFixture,
  setupShowcaseFixtureBase,
} from '../app/test/e2e/support/showcaseRepository.js';

const command = process.argv[2];

if (command === 'setup') {
  const path = await setupShowcaseFixtureBase();
  console.log(`Created the base fixture: ${path}`);
} else if (command === 'reset') {
  const paths = await resetDevelopmentShowcaseFixture();
  console.log(`Reset the development fixtures to their initial state:\n${paths.join('\n')}`);
} else {
  throw new Error('Usage: node --import tsx scripts/showcase-fixture.mts <setup|reset>');
}

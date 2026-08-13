import { execFile } from 'node:child_process';
import { access, cp, mkdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { configureRepository, runGit, writeRepositoryFile } from './fixtures.js';

const run = promisify(execFile);
const fixtureBaseRoot = join(process.cwd(), '.tmp', 'fixtures', 'base');
const fixtureBaseRepository = join(fixtureBaseRoot, 'ohtani-shohei');
const developmentFixtureRoot = join(process.cwd(), '.tmp', 'dev');
const developmentRepository = join(developmentFixtureRoot, 'ohtani-shohei');
const CONTRIBUTORS = [
  ['大谷翔平', 'shohei.ohtani@example.invalid'],
  ['山本由伸', 'yoshinobu.yamamoto@example.invalid'],
  ['鈴木誠也', 'seiya.suzuki@example.invalid'],
  ['岡本和真', 'kazuma.okamoto@example.invalid'],
  ['佐々木朗希', 'roki.sasaki@example.invalid'],
  ['鈴木一郎', 'ichiro.suzuki@example.invalid'],
  ['今永昇太', 'shota.imanaga@example.invalid'],
] as const;
const ACHIEVEMENTS = [
  ['2018-03-29T13:10:00-07:00', 'feat: MLBデビュー戦で初安打を記録'],
  ['2018-04-03T19:10:00-07:00', 'feat: MLB初本塁打を記録'],
  ['2018-11-12T15:00:00-08:00', 'feat: ア・リーグ新人王を受賞'],
  ['2021-07-13T17:30:00-06:00', 'feat: オールスターに二刀流で出場'],
  ['2021-11-18T15:00:00-08:00', 'feat: 満票でア・リーグMVPを受賞'],
  ['2022-08-31T18:38:00-04:00', 'feat: 10勝・30本塁打を達成'],
  ['2023-03-21T22:43:00-04:00', 'feat: WBC優勝と大会MVPを達成'],
  ['2023-11-16T15:00:00-08:00', 'feat: 2度目の満票MVPを受賞'],
  ['2024-04-03T19:10:00-07:00', 'feat: ドジャース移籍後初本塁打を記録'],
  ['2024-07-13T13:10:00-07:00', 'feat: 20本塁打・20盗塁 (20-20) を達成'],
  ['2024-08-03T18:07:00-07:00', 'feat: 30本塁打・30盗塁 (30-30) を達成'],
  ['2024-08-17T16:15:00-07:00', 'feat: 35本塁打・35盗塁 (35-35) を達成'],
  ['2024-08-23T19:10:00-07:00', 'feat: 40本塁打・40盗塁 (40-40) を達成'],
  ['2024-09-06T19:10:00-07:00', 'feat: 45本塁打・45盗塁 (45-45) を達成'],
  ['2024-09-19T19:10:00+09:00', 'feat: 50本塁打・50盗塁 (50-50) を達成'],
] as const;
const ACTIVITY_COMMITS_BY_MONTH = [8, 10, 13, 17, 23, 31, 42, 56, 73, 93, 116, 140, 168] as const;
const FIFTY_FIFTY_SOURCE = `

export const fiftyFiftyGame = {
  date: '2024-09-19',
  opponent: 'Miami Marlins',
  venue: 'loanDepot park',
  result: 'Dodgers 20 - 4 Marlins',
  batting: {
    plateAppearances: 6,
    atBats: 6,
    hits: 6,
    doubles: 2,
    homeRuns: 3,
    runs: 4,
    runsBattedIn: 10,
    stolenBases: 2,
    totalBases: 17,
  },
  season: {
    homeRunsBeforeGame: 48,
    homeRunsAfterGame: 51,
    stolenBasesBeforeGame: 49,
    stolenBasesAfterGame: 51,
  },
  milestones: [
    'MLB史上初の50本塁打・50盗塁',
    'ドジャース球団初のシーズン50本塁打',
    '1試合6安打・3本塁打・10打点・2盗塁',
    '自身初のポストシーズン進出決定',
  ],
} as const;

export const fiftyFiftySummary = [
  fiftyFiftyGame.season.homeRunsAfterGame,
  fiftyFiftyGame.season.stolenBasesAfterGame,
  fiftyFiftyGame.batting.homeRuns,
  fiftyFiftyGame.batting.stolenBases,
].join('-');
`;
const ANGELS_ROSTER_SOURCE = `export const shoheiOhtani = {
  name: '大谷翔平',
  team: 'Los Angeles Angels',
  uniformNumber: 17,
  joined: 2018,
  role: ['pitcher', 'designated-hitter'],
} as const;
`;
const DODGERS_ROSTER_SOURCE = `export const shoheiOhtani = {
  name: '大谷翔平',
  previousTeam: 'Los Angeles Angels',
  team: 'Los Angeles Dodgers',
  transaction: 'free-agent',
  uniformNumber: 17,
  league: 'National League',
  roles: ['pitcher', 'designated-hitter'],
  goals: {
    worldSeriesChampionship: true,
    postseasonDebut: true,
    continueTwoWayCareer: true,
  },
  careerHighlights: [
    '2018 AL Rookie of the Year',
    '2021 unanimous AL MVP',
    '2023 World Baseball Classic champion',
    '2023 unanimous AL MVP',
  ],
  message: [
    'Thank you, Angels fans.',
    'Ready for the next chapter in Los Angeles.',
    'Committed to winning with the Dodgers.',
  ],
} as const;

export const transfer = {
  player: shoheiOhtani.name,
  from: shoheiOhtani.previousTeam,
  via: shoheiOhtani.transaction,
  to: shoheiOhtani.team,
  status: 'signed',
} as const;
`;

export const SHOWCASE_STAGED_PATHS = [
  'data/2024-season.json',
  'docs/50-50.md',
  'assets/number-17.svg',
  'src/teams/angels/shohei-ohtani.ts',
  'src/teams/dodgers/shohei-ohtani.ts',
  'src/styles.css',
] as const;

function committerDate(index: number): string {
  const date = new Date();
  date.setHours(8 + (index % 12), index, 0, 0);
  return date.toISOString();
}

function activityMonthDates(): Date[] {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364, 12);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12);
  return ACTIVITY_COMMITS_BY_MONTH.map((_, index) => {
    const month = new Date(firstDay.getFullYear(), firstDay.getMonth() + index, 1, 12);
    const isFirstMonth = index === 0;
    const isCurrentMonth = month.getTime() === currentMonth.getTime();
    return isFirstMonth
      ? new Date(firstDay)
      : new Date(
          month.getFullYear(),
          month.getMonth(),
          isCurrentMonth ? Math.min(5, now.getDate()) : 5,
          12,
        );
  });
}

async function runDatedGit(
  repositoryPath: string,
  args: readonly string[],
  contributor: (typeof CONTRIBUTORS)[number],
  authoredAt: string,
  committedAt: string,
): Promise<void> {
  await run('/usr/bin/git', ['-C', repositoryPath, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: contributor[0],
      GIT_AUTHOR_EMAIL: contributor[1],
      GIT_COMMITTER_NAME: contributor[0],
      GIT_COMMITTER_EMAIL: contributor[1],
      GIT_AUTHOR_DATE: authoredAt,
      GIT_COMMITTER_DATE: committedAt,
    },
  });
}

async function commitFile(
  repositoryPath: string,
  path: string,
  content: string,
  message: string,
  contributor: (typeof CONTRIBUTORS)[number],
  authoredAt: string,
  committedAt: string,
): Promise<void> {
  await mkdir(dirname(join(repositoryPath, path)), { recursive: true });
  await writeRepositoryFile(repositoryPath, path, content);
  await runGit(repositoryPath, ['add', path]);
  await runDatedGit(
    repositoryPath,
    ['commit', '-m', message],
    contributor,
    authoredAt,
    committedAt,
  );
}

async function commitAchievements(
  repositoryPath: string,
  index = 0,
  source = 'export const achievements = [\n',
): Promise<void> {
  const achievement = ACHIEVEMENTS[index];
  if (!achievement) return;
  const isFiftyFifty = index === ACHIEVEMENTS.length - 1;
  const nextSource = `${source}  { date: '${achievement[0].slice(0, 10)}', title: '${achievement[1].slice(6)}' },\n${
    isFiftyFifty ? `] as const;${FIFTY_FIFTY_SOURCE}` : ''
  }`;
  await commitFile(
    repositoryPath,
    'src/records.ts',
    nextSource,
    achievement[1],
    CONTRIBUTORS[index % CONTRIBUTORS.length]!,
    achievement[0],
    committerDate(index),
  );
  await commitAchievements(repositoryPath, index + 1, nextSource);
}

async function commitActivity(repositoryPath: string): Promise<void> {
  const dates = activityMonthDates();
  let total = 0;
  for (const [monthIndex, commitCount] of ACTIVITY_COMMITS_BY_MONTH.entries()) {
    const month = dates[monthIndex]!;
    for (let index = 0; index < commitCount; index += 1) {
      const committedAt = new Date(month);
      committedAt.setHours(9 + Math.floor(index / 60), index % 60, 0, 0);
      // Commitは親子関係を保つため、月ごとに順番に作成します。
      // eslint-disable-next-line no-await-in-loop
      await runDatedGit(
        repositoryPath,
        ['commit', '--allow-empty', '-m', `chore: 月間活動を記録 ${monthIndex + 1}-${index + 1}`],
        CONTRIBUTORS[total % CONTRIBUTORS.length]!,
        committedAt.toISOString(),
        committedAt.toISOString(),
      );
      total += 1;
    }
  }
}

async function createShowcaseRepository(root: string): Promise<string> {
  const repositoryPath = join(root, 'ohtani-shohei');
  await mkdir(repositoryPath, { recursive: true });
  await runGit(repositoryPath, ['init', '-b', 'main']);
  await configureRepository(repositoryPath);
  await commitActivity(repositoryPath);
  await mkdir(join(repositoryPath, 'src/teams/angels'), { recursive: true });
  await writeRepositoryFile(
    repositoryPath,
    'src/teams/angels/shohei-ohtani.ts',
    ANGELS_ROSTER_SOURCE,
  );
  await runGit(repositoryPath, ['add', 'src/teams/angels/shohei-ohtani.ts']);
  await commitAchievements(repositoryPath);
  await runGit(repositoryPath, ['tag', '50-50']);
  return realpath(repositoryPath);
}

async function requireFixtureBase(): Promise<void> {
  try {
    await access(join(fixtureBaseRepository, '.git'));
  } catch (cause) {
    throw new Error('基底fixtureがありません。先に `mise run setup` を実行してください。', {
      cause,
    });
  }
}

export async function setupShowcaseFixtureBase(): Promise<string> {
  await rm(fixtureBaseRoot, { recursive: true, force: true });
  const repositoryPath = await createShowcaseRepository(fixtureBaseRoot);
  await prepareShowcaseChanges(repositoryPath);
  await stageShowcaseChanges(repositoryPath);
  return repositoryPath;
}

export async function resetDevelopmentShowcaseFixture(): Promise<string> {
  await requireFixtureBase();
  await rm(developmentRepository, { recursive: true, force: true });
  await rm(join(developmentFixtureRoot, '.showcase-ready'), { force: true });
  await mkdir(developmentFixtureRoot, { recursive: true });
  await cp(fixtureBaseRepository, developmentRepository, { recursive: true });
  return realpath(developmentRepository);
}

export async function copyE2EShowcaseRepository(
  root: string,
  name = basename(root),
  options: { preserveChanges?: boolean } = {},
): Promise<string> {
  await requireFixtureBase();
  const destination = join(root, name);
  await cp(fixtureBaseRepository, destination, { recursive: true });
  if (!options.preserveChanges) {
    await runGit(destination, ['reset', '--hard', 'HEAD']);
    await runGit(destination, ['clean', '-fd']);
  }
  return realpath(destination);
}

async function prepareShowcaseChanges(repositoryPath: string): Promise<void> {
  await Promise.all(
    ['data', 'docs', 'tests', 'assets', 'src/teams/dodgers', '.github/workflows'].map((path) =>
      mkdir(join(repositoryPath, path), { recursive: true }),
    ),
  );
  await rm(join(repositoryPath, 'src/teams/angels/shohei-ohtani.ts'));
  await writeRepositoryFile(
    repositoryPath,
    'src/teams/dodgers/shohei-ohtani.ts',
    DODGERS_ROSTER_SOURCE,
  );
  await writeRepositoryFile(
    repositoryPath,
    'README.md',
    '# Shohei Ohtani Records\n\n大谷翔平の記録をタイムラインで振り返ります。\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'src/records.ts',
    `${FIFTY_FIFTY_SOURCE.trim()}\n\nexport const nextMilestone = '60-60';\n`,
  );
  await writeRepositoryFile(
    repositoryPath,
    'data/2024-season.json',
    '{\n  "homeRuns": 54,\n  "stolenBases": 59,\n  "runs": 134,\n  "rbi": 130\n}\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'docs/50-50.md',
    '# 50-50\n\n2024年9月19日、MLB史上初の50本塁打・50盗塁を達成。\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'tests/records.test.ts',
    'export const expectedRecord = { homeRuns: 50, stolenBases: 50 };\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'tests/fifty-fifty.test.ts',
    'export const historicLine = { hits: 6, homeRuns: 3, rbi: 10, stolenBases: 2 };\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'src/career.ts',
    "export const awards = ['2018 AL Rookie of the Year', '2021 AL MVP', '2023 AL MVP'];\n",
  );
  await writeRepositoryFile(
    repositoryPath,
    'data/milestones.json',
    '[\n  "MLB debut",\n  "Rookie of the Year",\n  "Unanimous MVP",\n  "WBC champion",\n  "50-50"\n]\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'docs/timeline.md',
    '# 大谷翔平 実績タイムライン\n\n2018年のMLBデビューから2024年の50-50達成まで。\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'src/styles.css',
    '.record-card { display: grid; gap: 12px; }\n.timeline { color: dodgerblue; }\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'assets/number-17.svg',
    '<svg xmlns="http://www.w3.org/2000/svg"><text x="4" y="20">17</text></svg>\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    '.github/workflows/check.yml',
    'name: Records Check\non: pull_request\njobs: {}\n',
  );
}

async function stageShowcaseChanges(repositoryPath: string): Promise<void> {
  await runGit(repositoryPath, ['add', '--', ...SHOWCASE_STAGED_PATHS]);
}

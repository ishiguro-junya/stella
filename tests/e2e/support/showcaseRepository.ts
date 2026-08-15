import { execFile } from 'node:child_process';
import { access, cp, mkdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

import {
  configureRepository,
  ensureLocalBareRemote,
  runGit,
  writeRepositoryFile,
} from './fixtures.js';

const run = promisify(execFile);
const fixtureBaseRoot = join(process.cwd(), '.tmp', 'fixtures', 'base');
const fixtureBaseRepository = join(fixtureBaseRoot, 'major-league-baseball');
const developmentFixtureRoot = join(process.cwd(), '.tmp', 'dev');
const developmentRepository = join(developmentFixtureRoot, 'major-league-baseball');
const developmentRemote = join(developmentFixtureRoot, 'major-league-baseball-remote.git');
type Contributor = readonly [name: string, email: string];
const CONTRIBUTORS = {
  ichiro: ['鈴木一朗', 'ichiro.suzuki@example.invalid'],
  darvish: ['ダルビッシュ有', 'yu.darvish@example.invalid'],
  ohtani: ['大谷翔平', 'shohei.ohtani@example.invalid'],
  seiya: ['鈴木誠也', 'seiya.suzuki@example.invalid'],
  senga: ['千賀滉大', 'kodai.senga@example.invalid'],
  imanaga: ['今永昇太', 'shota.imanaga@example.invalid'],
  yamamoto: ['山本由伸', 'yoshinobu.yamamoto@example.invalid'],
} as const satisfies Record<string, Contributor>;
const ACTIVITY_CONTRIBUTOR = ['MLBデータ', 'mlb.data@example.invalid'] as const;
// 日本語画面でMLB公式記録の日付のまま表示するため、表示用日時は日本時間で保持する。
const ACHIEVEMENTS = [
  ['2001-04-02T19:05:00+09:00', 'feat: MLBデビュー戦で初安打を記録', CONTRIBUTORS.ichiro],
  ['2004-10-01T19:05:00+09:00', 'feat: シーズン最多安打記録を更新', CONTRIBUTORS.ichiro],
  ['2012-04-09T19:05:00+09:00', 'feat: MLBデビュー戦で初勝利を記録', CONTRIBUTORS.darvish],
  [
    '2013-04-02T19:10:00+09:00',
    'feat: 8回2/3まで完全試合を継続し14奪三振を記録',
    CONTRIBUTORS.darvish,
  ],
  ['2018-03-29T13:10:00+09:00', 'feat: MLBデビュー戦で初安打を記録', CONTRIBUTORS.ohtani],
  ['2022-04-10T13:20:00+09:00', 'feat: MLB初本塁打を記録', CONTRIBUTORS.seiya],
  ['2023-04-02T13:40:00+09:00', 'feat: MLBデビュー戦で8奪三振と初勝利を記録', CONTRIBUTORS.senga],
  ['2023-04-14T19:10:00+09:00', 'feat: シーズン初出場で本塁打を記録', CONTRIBUTORS.seiya],
  ['2023-07-27T13:10:00+09:00', 'feat: 完封勝利と1日2本塁打を達成', CONTRIBUTORS.ohtani],
  ['2023-09-27T19:10:00+09:00', 'feat: MLB新人年にシーズン200奪三振を達成', CONTRIBUTORS.senga],
  [
    '2024-04-01T13:20:00+09:00',
    'feat: MLBデビュー戦で6回無失点・9奪三振を記録',
    CONTRIBUTORS.imanaga,
  ],
  ['2024-04-06T13:20:00+09:00', 'feat: 5回無失点8奪三振でMLB初勝利を記録', CONTRIBUTORS.yamamoto],
  [
    '2024-06-07T19:05:00+09:00',
    'feat: ヤンキース戦で7回無失点7奪三振を記録',
    CONTRIBUTORS.yamamoto,
  ],
  ['2024-07-07T17:00:00+09:00', 'feat: 新人年にオールスターへ初選出', CONTRIBUTORS.imanaga],
  ['2024-09-19T19:10:00+09:00', 'feat: 50本塁打・50盗塁 (50-50) を達成', CONTRIBUTORS.ohtani],
] as const;
const ACTIVITY_COMMITS_BY_MONTH = [8, 10, 13, 17, 23, 31, 42, 56, 73, 93, 116, 140, 168] as const;
const FIRST_CHILD_DATE = '2025-04-19T12:00:00+09:00';
const FIRST_CHILD_MESSAGE = 'feat: 第一子誕生を発表';
const ACHIEVEMENT_BRANCHES = [
  {
    achievementIndex: 2,
    mergeAtIndex: undefined,
    name: 'darvish-mlb-debut',
    path: 'docs/darvish-mlb-debut.md',
    content: '# MLB初勝利\n\n2012年4月9日、MLBデビュー戦で初勝利を記録。\n',
  },
  {
    achievementIndex: 4,
    mergeAtIndex: undefined,
    name: 'ohtani-mlb-debut',
    path: 'docs/ohtani-mlb-debut.md',
    content: '# MLB初安打\n\n2018年3月29日、MLBデビュー戦で初安打を記録。\n',
  },
  {
    achievementIndex: 6,
    mergeAtIndex: undefined,
    name: 'senga-mlb-debut',
    path: 'docs/senga-mlb-debut.md',
    content: '# MLB初勝利\n\n2023年4月2日、MLBデビュー戦で8奪三振と初勝利を記録。\n',
  },
  {
    achievementIndex: 7,
    mergeAtIndex: 10,
    name: 'seiya-season-debut',
    path: 'docs/seiya-2023-season-debut.md',
    content: '# 2023年シーズン初出場\n\n2023年4月14日、シーズン初出場で本塁打を記録。\n',
  },
  {
    achievementIndex: 9,
    mergeAtIndex: 11,
    name: 'senga-200-strikeouts',
    path: 'docs/senga-200-strikeouts.md',
    content: '# 新人年200奪三振\n\n2023年9月27日、MLB新人年にシーズン200奪三振を達成。\n',
  },
  {
    achievementIndex: 12,
    mergeAtIndex: 13,
    name: 'yamamoto-yankees',
    path: 'docs/yamamoto-yankees.md',
    content: '# ヤンキース戦\n\n2024年6月7日、ヤンキース戦で7回無失点・7奪三振を記録。\n',
  },
] as const;
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
  date.setHours(8, index, 0, 0);
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
  contributor: Contributor,
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
  contributor: Contributor,
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
  const achievementBranch = ACHIEVEMENT_BRANCHES.find(
    (branch) => branch.achievementIndex === index,
  );
  if (achievementBranch) {
    await runGit(repositoryPath, ['switch', '--create', achievementBranch.name]);
    await commitFile(
      repositoryPath,
      achievementBranch.path,
      achievementBranch.content,
      achievement[1],
      achievement[2],
      achievement[0],
      committerDate(index),
    );
    await runGit(repositoryPath, ['switch', 'main']);
  } else {
    const branchToMerge = isFiftyFifty
      ? 'family-news'
      : ACHIEVEMENT_BRANCHES.find((branch) => branch.mergeAtIndex === index)?.name;
    if (isFiftyFifty) await createFirstChildBranch(repositoryPath);
    if (branchToMerge)
      await runGit(repositoryPath, ['merge', '--no-ff', '--no-commit', branchToMerge]);
    await commitFile(
      repositoryPath,
      'src/records.ts',
      nextSource,
      achievement[1],
      achievement[2],
      achievement[0],
      committerDate(index),
    );
  }
  await commitAchievements(repositoryPath, index + 1, nextSource);
}

async function commitActivity(repositoryPath: string): Promise<void> {
  const dates = activityMonthDates();
  for (const [monthIndex, commitCount] of ACTIVITY_COMMITS_BY_MONTH.entries()) {
    const month = dates[monthIndex]!;
    for (let index = 0; index < commitCount; index += 1) {
      const committedAt = new Date(month);
      committedAt.setHours(9 + Math.floor(index / 60), index % 60, 0, 0);
      // コミットは親子関係を保つため、月ごとに順番に作成する。
      // eslint-disable-next-line no-await-in-loop
      await runDatedGit(
        repositoryPath,
        [
          'commit',
          '--allow-empty',
          '-m',
          `chore: 月間集計データを更新 ${monthIndex + 1}-${index + 1}`,
        ],
        ACTIVITY_CONTRIBUTOR,
        committedAt.toISOString(),
        committedAt.toISOString(),
      );
    }
  }
}

async function createFirstChildBranch(repositoryPath: string): Promise<void> {
  await runGit(repositoryPath, ['switch', '--create', 'family-news']);
  await commitFile(
    repositoryPath,
    'docs/first-child.md',
    '# 第一子誕生\n\n2025年4月19日、第一子の誕生を発表。\n',
    FIRST_CHILD_MESSAGE,
    CONTRIBUTORS.ohtani,
    FIRST_CHILD_DATE,
    committerDate(ACHIEVEMENTS.length - 2),
  );
  await runGit(repositoryPath, ['switch', 'main']);
}

async function createShowcaseRepository(root: string): Promise<string> {
  const repositoryPath = join(root, 'major-league-baseball');
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
    throw new Error('基底フィクスチャがありません。先に`mise run setup`を実行してください。', {
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
  await rm(developmentRemote, { recursive: true, force: true });
  await rm(join(developmentFixtureRoot, '.showcase-ready'), { force: true });
  await mkdir(developmentFixtureRoot, { recursive: true });
  await cp(fixtureBaseRepository, developmentRepository, { recursive: true });
  await ensureLocalBareRemote(developmentRepository, developmentRemote);
  return realpath(developmentRepository);
}

export async function ensureDevelopmentShowcaseRemote(): Promise<string> {
  await ensureLocalBareRemote(developmentRepository, developmentRemote);
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
    '# Major League Baseball Records\n\n日本人メジャーリーガーの記録をタイムラインで振り返ります。\n',
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

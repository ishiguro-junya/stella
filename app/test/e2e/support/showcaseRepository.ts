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
const fixtureBaseRoot = join(process.cwd(), 'tmp', 'fixtures', 'base');
const fixtureBaseRepository = join(fixtureBaseRoot, 'major-league-baseball');
const developmentFixtureRoot = join(process.cwd(), 'tmp', 'dev');
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
  sasaki: ['佐々木朗希', 'roki.sasaki@example.invalid'],
  freeman: ['フレディ・フリーマン', 'freddie.freeman@example.invalid'],
  pages: ['アンディ・パヘス', 'andy.pages@example.invalid'],
  betts: ['ムーキー・ベッツ', 'mookie.betts@example.invalid'],
  muncy: ['マックス・マンシー', 'max.muncy@example.invalid'],
  edman: ['トミー・エドマン', 'tommy.edman@example.invalid'],
  rojas: ['ミゲル・ロハス', 'miguel.rojas@example.invalid'],
  enriqueHernandez: ['キケ・ヘルナンデス', 'enrique.hernandez@example.invalid'],
  teoscarHernandez: ['テオスカー・ヘルナンデス', 'teoscar.hernandez@example.invalid'],
  scott: ['タナー・スコット', 'tanner.scott@example.invalid'],
  wrobleski: ['ジャスティン・ロブレスキー', 'justin.wrobleski@example.invalid'],
  vesia: ['アレックス・ベシア', 'alex.vesia@example.invalid'],
} as const satisfies Record<string, Contributor>;
const PLAYER_REPOSITORIES = [
  { slug: 'suzuki-ichiro', contributor: CONTRIBUTORS.ichiro },
  { slug: 'darvish-yu', contributor: CONTRIBUTORS.darvish },
  { slug: 'ohtani-shohei', contributor: CONTRIBUTORS.ohtani },
  { slug: 'suzuki-seiya', contributor: CONTRIBUTORS.seiya },
  { slug: 'senga-kodai', contributor: CONTRIBUTORS.senga },
  { slug: 'imanaga-shota', contributor: CONTRIBUTORS.imanaga },
  { slug: 'yamamoto-yoshinobu', contributor: CONTRIBUTORS.yamamoto },
  { slug: 'sasaki-roki', contributor: CONTRIBUTORS.sasaki },
  { slug: 'freeman-freddie', contributor: CONTRIBUTORS.freeman },
  { slug: 'pages-andy', contributor: CONTRIBUTORS.pages },
  { slug: 'betts-mookie', contributor: CONTRIBUTORS.betts },
  { slug: 'muncy-max', contributor: CONTRIBUTORS.muncy },
  { slug: 'edman-tommy', contributor: CONTRIBUTORS.edman },
  { slug: 'rojas-miguel', contributor: CONTRIBUTORS.rojas },
  { slug: 'hernandez-enrique', contributor: CONTRIBUTORS.enriqueHernandez },
  { slug: 'hernandez-teoscar', contributor: CONTRIBUTORS.teoscarHernandez },
  { slug: 'scott-tanner', contributor: CONTRIBUTORS.scott },
  { slug: 'wrobleski-justin', contributor: CONTRIBUTORS.wrobleski },
  { slug: 'vesia-alex', contributor: CONTRIBUTORS.vesia },
] as const;
const fixtureBasePlayerRepositories = PLAYER_REPOSITORIES.map(({ slug }) =>
  join(fixtureBaseRoot, slug),
);
const developmentPlayerRepositories = PLAYER_REPOSITORIES.map(({ slug }) =>
  join(developmentFixtureRoot, slug),
);
const ACTIVITY_CONTRIBUTOR = ['MLBデータ', 'mlb.data@example.invalid'] as const;
const MLB_RECORD_BOOK_PATH = 'docs/mlb-record-book.md';
const MLB_RECORD_BOOK_BASE_CONTENT =
  '# MLB Record Book\n\n## 2024 Season\n\n- Los Angeles Dodgers\n- New York Yankees\n';
const MLB_RECORD_BOOK_CHANGED_CONTENT =
  '# MLB Record Book\n\n## 2024 Season\n\n- Los Angeles Dodgers\n- New York Yankees\n- San Diego Padres\n- Boston Red Sox\n- Chicago Cubs\n\n## Long diff line\n\nThis intentionally long MLB record-book entry verifies that the hunk line range and the edit, stage, and discard actions remain visible with a stable right margin when the window is resized or the diff is scrolled horizontally.\n\n## Checks\n\n1. The hunk line range is fully visible.\n2. Every hunk action remains inside the viewport.\n3. The right margin stays unchanged after resizing.\n';
const FIFTY_FIFTY_MESSAGE = 'feat: 50本塁打・50盗塁 (50-50) を達成';
const WORLD_SERIES_2024_MESSAGE = 'feat: ドジャースがワールドシリーズ制覇';
const WORLD_SERIES_2025_MESSAGE = 'feat: ドジャースがワールドシリーズ2連覇';
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
  ['2024-09-19T19:10:00+09:00', FIFTY_FIFTY_MESSAGE, CONTRIBUTORS.ohtani],
  ['2024-10-30T20:08:00+09:00', WORLD_SERIES_2024_MESSAGE, CONTRIBUTORS.ohtani],
  ['2025-03-19T19:10:00+09:00', 'feat: 佐々木朗希が東京ドームでMLBデビュー', CONTRIBUTORS.sasaki],
  ['2025-06-17T11:10:00+09:00', 'feat: 大谷翔平が投手として663日ぶりに復帰', CONTRIBUTORS.ohtani],
  ['2025-09-17T11:10:00+09:00', 'feat: 5回無安打投球と2年連続50本塁打を達成', CONTRIBUTORS.ohtani],
  ['2025-09-26T07:40:00+09:00', 'feat: ドジャースがナ・リーグ西地区4連覇', CONTRIBUTORS.ohtani],
  [
    '2025-10-05T10:38:00+09:00',
    'feat: 大谷が勝利、佐々木がセーブでPS史を更新',
    CONTRIBUTORS.sasaki,
  ],
  ['2025-10-15T12:08:00+09:00', 'feat: 山本由伸がポストシーズンで完投勝利', CONTRIBUTORS.yamamoto],
  ['2025-10-18T12:08:00+09:00', 'feat: 大谷が3本塁打・6回無失点でリーグ優勝', CONTRIBUTORS.ohtani],
  [
    '2025-10-26T12:08:00+09:00',
    'feat: 山本由伸がワールドシリーズ第2戦で完投勝利',
    CONTRIBUTORS.yamamoto,
  ],
  ['2025-10-28T15:39:00+09:00', 'feat: フリーマンが18回にサヨナラ本塁打', CONTRIBUTORS.freeman],
  [
    '2025-11-01T12:08:00+09:00',
    'feat: 山本由伸がワールドシリーズ第6戦で勝利',
    CONTRIBUTORS.yamamoto,
  ],
  ['2025-11-02T13:08:00+09:00', WORLD_SERIES_2025_MESSAGE, CONTRIBUTORS.yamamoto],
] as const;
const FIFTY_FIFTY_INDEX = ACHIEVEMENTS.findIndex(([, message]) => message === FIFTY_FIFTY_MESSAGE);
const WORLD_SERIES_2025_INDEX = ACHIEVEMENTS.findIndex(
  ([, message]) => message === WORLD_SERIES_2025_MESSAGE,
);
const POSTSEASON_START_INDEX = 20;
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
const POSTSEASON_MILESTONES = [
  {
    achievementIndex: 16,
    path: 'docs/2025-roki-mlb-debut.md',
    content: '# MLBデビュー\n\n2025年3月19日、佐々木朗希が東京ドームでMLBデビュー。\n',
  },
  {
    achievementIndex: 17,
    path: 'docs/2025-ohtani-pitching-return.md',
    content: '# 投手復帰\n\n2025年6月16日、大谷翔平が663日ぶりに投手として復帰。\n',
  },
  {
    achievementIndex: 18,
    path: 'docs/2025-ohtani-50-homers.md',
    content: '# 2年連続50本塁打\n\n2025年9月16日、5回無安打投球とシーズン50号本塁打を記録。\n',
  },
  {
    achievementIndex: 19,
    path: 'docs/2025-nl-west-title.md',
    content: '# ナ・リーグ西地区優勝\n\n2025年9月25日、ドジャースが地区4連覇を達成。\n',
  },
  {
    achievementIndex: 20,
    path: 'docs/2025-japanese-postseason-win-save.md',
    content:
      '# 日本人投手で勝利とセーブ\n\n2025年10月4日、大谷翔平が勝利、佐々木朗希がセーブを記録。\n',
  },
  {
    achievementIndex: 21,
    path: 'docs/2025-yamamoto-nlcs-complete-game.md',
    content: '# リーグ優勝決定シリーズ完投\n\n2025年10月14日、山本由伸が9回1失点で完投勝利。\n',
  },
  {
    achievementIndex: 22,
    path: 'docs/2025-ohtani-nlcs-mvp.md',
    content:
      '# リーグ優勝決定シリーズMVP\n\n2025年10月17日、大谷翔平が3本塁打・6回無失点を記録。\n',
  },
  {
    achievementIndex: 23,
    path: 'docs/2025-yamamoto-world-series-complete-game.md',
    content: '# ワールドシリーズ完投\n\n2025年10月25日、山本由伸が第2戦で9回1失点の完投勝利。\n',
  },
  {
    achievementIndex: 24,
    path: 'docs/2025-freeman-world-series-walk-off.md',
    content:
      '# 18回サヨナラ本塁打\n\n2025年10月27日、フレディ・フリーマンが第3戦をサヨナラ本塁打で決着。\n',
  },
  {
    achievementIndex: 25,
    path: 'docs/2025-yamamoto-world-series-game-6.md',
    content: '# ワールドシリーズ第6戦勝利\n\n2025年10月31日、山本由伸が第6戦で6回1失点の勝利。\n',
  },
] as const;
const POSTSEASON_TEAMS = [
  { id: 'dodgers', name: 'ドジャース' },
  { id: 'reds', name: 'レッズ' },
  { id: 'cubs', name: 'カブス' },
  { id: 'padres', name: 'パドレス' },
  { id: 'brewers', name: 'ブルワーズ' },
  { id: 'phillies', name: 'フィリーズ' },
  { id: 'tigers', name: 'タイガース' },
  { id: 'guardians', name: 'ガーディアンズ' },
  { id: 'yankees', name: 'ヤンキース' },
  { id: 'red-sox', name: 'レッドソックス' },
  { id: 'blue-jays', name: 'ブルージェイズ' },
  { id: 'mariners', name: 'マリナーズ' },
] as const;
type PostseasonTeamId = (typeof POSTSEASON_TEAMS)[number]['id'];
const POSTSEASON_EVENTS: ReadonlyArray<
  | {
      kind: 'series';
      round: 'WCS' | 'DS' | 'LCS';
      league: 'アメリカン・リーグ' | 'ナショナル・リーグ';
      winner: PostseasonTeamId;
      loser: PostseasonTeamId;
      winnerWins: number;
      loserWins: number;
      authoredAt: string;
    }
  | { kind: 'milestone'; achievementIndex: number }
> = [
  {
    kind: 'series',
    round: 'WCS',
    league: 'ナショナル・リーグ',
    winner: 'dodgers',
    loser: 'reds',
    winnerWins: 2,
    loserWins: 0,
    authoredAt: '2025-10-02T12:08:00+09:00',
  },
  {
    kind: 'series',
    round: 'WCS',
    league: 'ナショナル・リーグ',
    winner: 'cubs',
    loser: 'padres',
    winnerWins: 2,
    loserWins: 1,
    authoredAt: '2025-10-03T10:08:00+09:00',
  },
  {
    kind: 'series',
    round: 'WCS',
    league: 'アメリカン・リーグ',
    winner: 'tigers',
    loser: 'guardians',
    winnerWins: 2,
    loserWins: 1,
    authoredAt: '2025-10-03T10:08:00+09:00',
  },
  {
    kind: 'series',
    round: 'WCS',
    league: 'アメリカン・リーグ',
    winner: 'yankees',
    loser: 'red-sox',
    winnerWins: 2,
    loserWins: 1,
    authoredAt: '2025-10-03T10:08:00+09:00',
  },
  { kind: 'milestone', achievementIndex: 20 },
  {
    kind: 'series',
    round: 'DS',
    league: 'アメリカン・リーグ',
    winner: 'blue-jays',
    loser: 'yankees',
    winnerWins: 3,
    loserWins: 1,
    authoredAt: '2025-10-09T12:08:00+09:00',
  },
  {
    kind: 'series',
    round: 'DS',
    league: 'ナショナル・リーグ',
    winner: 'dodgers',
    loser: 'phillies',
    winnerWins: 3,
    loserWins: 1,
    authoredAt: '2025-10-10T12:08:00+09:00',
  },
  {
    kind: 'series',
    round: 'DS',
    league: 'アメリカン・リーグ',
    winner: 'mariners',
    loser: 'tigers',
    winnerWins: 3,
    loserWins: 2,
    authoredAt: '2025-10-11T12:08:00+09:00',
  },
  {
    kind: 'series',
    round: 'DS',
    league: 'ナショナル・リーグ',
    winner: 'brewers',
    loser: 'cubs',
    winnerWins: 3,
    loserWins: 2,
    authoredAt: '2025-10-12T12:08:00+09:00',
  },
  { kind: 'milestone', achievementIndex: 21 },
  { kind: 'milestone', achievementIndex: 22 },
  {
    kind: 'series',
    round: 'LCS',
    league: 'ナショナル・リーグ',
    winner: 'dodgers',
    loser: 'brewers',
    winnerWins: 4,
    loserWins: 0,
    authoredAt: '2025-10-18T12:08:00+09:00',
  },
  {
    kind: 'series',
    round: 'LCS',
    league: 'アメリカン・リーグ',
    winner: 'blue-jays',
    loser: 'mariners',
    winnerWins: 4,
    loserWins: 3,
    authoredAt: '2025-10-21T12:08:00+09:00',
  },
  { kind: 'milestone', achievementIndex: 23 },
  { kind: 'milestone', achievementIndex: 24 },
  { kind: 'milestone', achievementIndex: 25 },
];
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
const ANGELS_UNIFORM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240" role="img">
  <title>Los Angeles Angels uniform</title>
  <rect width="320" height="240" rx="24" fill="#f7f7f7"/>
  <path d="M86 42 126 24h68l40 18 42 58-40 24-18-28v120H102V96l-18 28-40-24 42-58Z" fill="#ba0021"/>
  <text x="160" y="88" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="24" font-weight="700">ANGELS</text>
  <text x="160" y="158" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="64" font-weight="700">17</text>
</svg>
`;
const DODGERS_UNIFORM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240" role="img">
  <title>Los Angeles Dodgers uniform</title>
  <rect width="320" height="240" rx="24" fill="#f7f7f7"/>
  <path d="M86 42 126 24h68l40 18 42 58-40 24-18-28v120H102V96l-18 28-40-24 42-58Z" fill="#005a9c"/>
  <text x="160" y="88" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="24" font-weight="700">DODGERS</text>
  <text x="160" y="158" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="64" font-weight="700">17</text>
</svg>
`;

const SHOWCASE_STAGED_PATHS = [
  'data/2024-season.json',
  'docs/50-50.md',
  'assets/number-17.svg',
  'assets/uniform.svg',
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

async function createPlayerRepository(
  root: string,
  player: (typeof PLAYER_REPOSITORIES)[number],
  index: number,
): Promise<void> {
  const repositoryPath = join(root, player.slug);
  await mkdir(repositoryPath, { recursive: true });
  await runGit(repositoryPath, ['init', '-b', 'main']);
  await configureRepository(repositoryPath, player.contributor[0], player.contributor[1]);
  const committedAt = `2025-01-01T12:${String(index).padStart(2, '0')}:00+09:00`;
  await runDatedGit(
    repositoryPath,
    ['commit', '--allow-empty', '-m', 'chore: initial commit'],
    player.contributor,
    committedAt,
    committedAt,
  );
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

function postseasonTeam(id: PostseasonTeamId): (typeof POSTSEASON_TEAMS)[number] {
  return POSTSEASON_TEAMS.find((team) => team.id === id)!;
}

function postseasonBranch(id: PostseasonTeamId): string {
  return `postseason-${id}`;
}

function appendAchievementSource(
  source: string,
  index: number,
): { nextSource: string; recordsSource: string } {
  const achievement = ACHIEVEMENTS[index];
  if (!achievement) throw new Error(`実績データがありません: ${index}`);
  const nextSource = `${source}  { date: '${achievement[0].slice(0, 10)}', title: '${achievement[1].slice(6)}' },\n`;
  return {
    nextSource,
    recordsSource: `${nextSource}] as const;${index >= FIFTY_FIFTY_INDEX ? FIFTY_FIFTY_SOURCE : ''}`,
  };
}

async function stageAchievementFile(repositoryPath: string, index: number): Promise<void> {
  const milestone = POSTSEASON_MILESTONES.find((item) => item.achievementIndex === index);
  if (!milestone) return;
  await writeRepositoryFile(repositoryPath, milestone.path, milestone.content);
  await runGit(repositoryPath, ['add', milestone.path]);
}

async function createPostseasonTeamBranches(repositoryPath: string, index = 0): Promise<void> {
  const team = POSTSEASON_TEAMS[index];
  if (!team) return;
  await runGit(repositoryPath, ['switch', '--create', postseasonBranch(team.id), 'main']);
  await commitFile(
    repositoryPath,
    `docs/2025-postseason/teams/${team.id}.md`,
    `# ${team.name}\n\n2025年ポストシーズン出場。\n`,
    `feat: ${team.name}が2025年ポストシーズンに進出`,
    ACTIVITY_CONTRIBUTOR,
    `2025-09-29T12:${String(index).padStart(2, '0')}:00+09:00`,
    committerDate(40 + index),
  );
  await createPostseasonTeamBranches(repositoryPath, index + 1);
}

async function commitPostseasonSeries(
  repositoryPath: string,
  event: Extract<(typeof POSTSEASON_EVENTS)[number], { kind: 'series' }>,
  index: number,
): Promise<void> {
  const winner = postseasonTeam(event.winner);
  const loser = postseasonTeam(event.loser);
  await runGit(repositoryPath, ['switch', postseasonBranch(event.winner)]);
  await runGit(repositoryPath, ['merge', '--no-ff', '--no-commit', postseasonBranch(event.loser)]);
  const path = `docs/2025-postseason/${event.round.toLowerCase()}/${event.winner}-${event.loser}.md`;
  await mkdir(dirname(join(repositoryPath, path)), { recursive: true });
  await writeRepositoryFile(
    repositoryPath,
    path,
    `# ${event.round} ${winner.name}対${loser.name}\n\n${event.league}\n\n- ${winner.name}: ${event.winnerWins}勝${event.loserWins}敗\n- ${loser.name}: ${event.loserWins}勝${event.winnerWins}敗\n`,
  );
  await runGit(repositoryPath, ['add', path]);
  await runDatedGit(
    repositoryPath,
    [
      'commit',
      '-m',
      `feat: ${event.round} ${winner.name}${event.winnerWins}勝${event.loserWins}敗・${loser.name}${event.loserWins}勝${event.winnerWins}敗`,
    ],
    ACTIVITY_CONTRIBUTOR,
    event.authoredAt,
    committerDate(60 + index),
  );
}

async function commitPostseasonEvents(
  repositoryPath: string,
  source: string,
  index = 0,
): Promise<string> {
  const event = POSTSEASON_EVENTS[index];
  if (!event) return source;
  let nextSource = source;
  if (event.kind === 'series') {
    await commitPostseasonSeries(repositoryPath, event, index);
  } else {
    const achievement = ACHIEVEMENTS[event.achievementIndex];
    if (!achievement) throw new Error(`実績データがありません: ${event.achievementIndex}`);
    const sources = appendAchievementSource(source, event.achievementIndex);
    await runGit(repositoryPath, ['switch', postseasonBranch('dodgers')]);
    await stageAchievementFile(repositoryPath, event.achievementIndex);
    await commitFile(
      repositoryPath,
      'src/records.ts',
      sources.recordsSource,
      achievement[1],
      achievement[2],
      achievement[0],
      committerDate(80 + index),
    );
    nextSource = sources.nextSource;
  }
  return commitPostseasonEvents(repositoryPath, nextSource, index + 1);
}

async function commitPostseasonBracket(repositoryPath: string, source: string): Promise<void> {
  await createPostseasonTeamBranches(repositoryPath);
  const nextSource = await commitPostseasonEvents(repositoryPath, source);
  const finalAchievement = ACHIEVEMENTS[WORLD_SERIES_2025_INDEX];
  if (!finalAchievement) throw new Error('ワールドシリーズの実績データがありません。');
  const finalSources = appendAchievementSource(nextSource, WORLD_SERIES_2025_INDEX);

  await runGit(repositoryPath, ['switch', 'main']);
  await runGit(repositoryPath, ['merge', '--ff-only', postseasonBranch('dodgers')]);
  await runGit(repositoryPath, ['merge', '--no-ff', '--no-commit', postseasonBranch('blue-jays')]);
  await writeRepositoryFile(
    repositoryPath,
    'docs/2025-world-series.md',
    '# ワールドシリーズ2連覇\n\n2025年11月1日、ドジャースがブルージェイズを4勝3敗で破り2連覇を達成。\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'data/current-champion.json',
    '{\n  "year": 2025,\n  "champion": "Los Angeles Dodgers",\n  "opponent": "Toronto Blue Jays",\n  "series": "4-3",\n  "consecutiveTitles": 2\n}\n',
  );
  await runGit(repositoryPath, ['add', 'docs/2025-world-series.md', 'data/current-champion.json']);
  await commitFile(
    repositoryPath,
    'src/records.ts',
    finalSources.recordsSource,
    finalAchievement[1],
    finalAchievement[2],
    finalAchievement[0],
    committerDate(100),
  );
}

async function commitAchievements(
  repositoryPath: string,
  index = 0,
  source = 'export const achievements = [\n',
): Promise<void> {
  if (index === POSTSEASON_START_INDEX) {
    await commitPostseasonBracket(repositoryPath, source);
    return;
  }
  const achievement = ACHIEVEMENTS[index];
  if (!achievement) return;
  const isFiftyFifty = index === FIFTY_FIFTY_INDEX;
  const { nextSource, recordsSource } = appendAchievementSource(source, index);
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
    const branchesToMerge = ACHIEVEMENT_BRANCHES.filter(
      (branch) => branch.mergeAtIndex === index,
    ).map((branch) => branch.name);
    if (branchesToMerge.length > 0)
      await runGit(repositoryPath, ['merge', '--no-ff', '--no-commit', ...branchesToMerge]);
    if (achievement[1] === WORLD_SERIES_2024_MESSAGE) {
      await Promise.all([
        mkdir(join(repositoryPath, 'assets'), { recursive: true }),
        mkdir(join(repositoryPath, 'data'), { recursive: true }),
      ]);
      await writeRepositoryFile(
        repositoryPath,
        'docs/2024-world-series.md',
        '# ワールドシリーズ制覇\n\n2024年10月30日、ドジャースがワールドシリーズを制覇。\n',
      );
      await writeRepositoryFile(repositoryPath, 'assets/uniform.svg', ANGELS_UNIFORM_SVG);
      await writeRepositoryFile(
        repositoryPath,
        'data/current-champion.json',
        '{\n  "year": 2024,\n  "champion": "Los Angeles Dodgers",\n  "opponent": "New York Yankees",\n  "series": "4-1",\n  "consecutiveTitles": 1\n}\n',
      );
      await runGit(repositoryPath, [
        'add',
        'docs/2024-world-series.md',
        'assets/uniform.svg',
        'data/current-champion.json',
      ]);
    }
    await stageAchievementFile(repositoryPath, index);
    await commitFile(
      repositoryPath,
      'src/records.ts',
      recordsSource,
      achievement[1],
      achievement[2],
      achievement[0],
      committerDate(index),
    );
  }
  if (isFiftyFifty) {
    await runGit(repositoryPath, ['tag', '50-50']);
    await createFirstChildBranch(repositoryPath);
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
    committerDate(FIFTY_FIFTY_INDEX),
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
  await commitFile(
    repositoryPath,
    MLB_RECORD_BOOK_PATH,
    MLB_RECORD_BOOK_BASE_CONTENT,
    'test: MLB記録集を追加',
    ACTIVITY_CONTRIBUTOR,
    '2025-11-03T12:00:00+09:00',
    '2025-11-03T12:00:00+09:00',
  );
  return realpath(repositoryPath);
}

async function ensureMlbRecordBookFixture(): Promise<void> {
  try {
    await access(join(fixtureBaseRepository, MLB_RECORD_BOOK_PATH));
  } catch {
    await commitFile(
      fixtureBaseRepository,
      MLB_RECORD_BOOK_PATH,
      MLB_RECORD_BOOK_BASE_CONTENT,
      'test: MLB記録集を追加',
      ACTIVITY_CONTRIBUTOR,
      '2025-11-03T12:00:00+09:00',
      '2025-11-03T12:00:00+09:00',
    );
  }
}

async function requireFixtureBase(): Promise<void> {
  try {
    await Promise.all(
      [fixtureBaseRepository, ...fixtureBasePlayerRepositories].map((path) =>
        access(join(path, '.git')),
      ),
    );
  } catch (cause) {
    throw new Error('基底フィクスチャがありません。先に`mise run setup`を実行してください。', {
      cause,
    });
  }
}

export async function setupShowcaseFixtureBase(): Promise<string> {
  await rm(fixtureBaseRoot, { recursive: true, force: true });
  const repositoryPath = await createShowcaseRepository(fixtureBaseRoot);
  await Promise.all(
    PLAYER_REPOSITORIES.map((player, index) =>
      createPlayerRepository(fixtureBaseRoot, player, index),
    ),
  );
  await prepareShowcaseChanges(repositoryPath);
  await stageShowcaseChanges(repositoryPath);
  return repositoryPath;
}

export async function resetDevelopmentShowcaseFixture(): Promise<string[]> {
  await requireFixtureBase();
  await ensureMlbRecordBookFixture();
  await Promise.all(
    [developmentRepository, developmentRemote, ...developmentPlayerRepositories].map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
  await mkdir(developmentFixtureRoot, { recursive: true });
  await Promise.all([
    cp(fixtureBaseRepository, developmentRepository, { recursive: true }),
    ...fixtureBasePlayerRepositories.map((source, index) =>
      cp(source, developmentPlayerRepositories[index]!, { recursive: true }),
    ),
  ]);
  await writeRepositoryFile(
    developmentRepository,
    MLB_RECORD_BOOK_PATH,
    MLB_RECORD_BOOK_CHANGED_CONTENT,
  );
  await ensureLocalBareRemote(developmentRepository, developmentRemote);
  return Promise.all(
    [developmentRepository, ...developmentPlayerRepositories].map((path) => realpath(path)),
  );
}

export async function ensureDevelopmentShowcaseFixtures(): Promise<string[]> {
  await requireFixtureBase();
  try {
    await access(join(developmentRepository, '.git'));
  } catch {
    return resetDevelopmentShowcaseFixture();
  }
  await Promise.all(
    fixtureBasePlayerRepositories.map(async (source, index) => {
      const destination = developmentPlayerRepositories[index]!;
      try {
        await access(join(destination, '.git'));
      } catch {
        await cp(source, destination, { recursive: true });
      }
    }),
  );
  await ensureLocalBareRemote(developmentRepository, developmentRemote);
  return Promise.all(
    [developmentRepository, ...developmentPlayerRepositories].map((path) => realpath(path)),
  );
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
    '# ドジャース 実績タイムライン\n\n2018年の大谷翔平のMLBデビューから2025年のワールドシリーズ2連覇まで。\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'src/styles.css',
    '.record-card { display: grid; gap: 12px; }\n.timeline { color: dodgerblue; }\n',
  );
  await writeRepositoryFile(
    repositoryPath,
    'assets/number-17.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" rx="24" fill="#f7f7f7"/><text x="160" y="105" text-anchor="middle" dominant-baseline="middle" fill="#005a9c" font-family="Arial, sans-serif" font-size="120" font-weight="700">17</text></svg>\n',
  );
  await writeRepositoryFile(repositoryPath, 'assets/uniform.svg', DODGERS_UNIFORM_SVG);
  await writeRepositoryFile(
    repositoryPath,
    '.github/workflows/check.yml',
    'name: Records Check\non: pull_request\njobs: {}\n',
  );
}

async function stageShowcaseChanges(repositoryPath: string): Promise<void> {
  await runGit(repositoryPath, ['add', '--', ...SHOWCASE_STAGED_PATHS]);
}

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_TYPES = new Set([
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
]);
const HEADER = /^(?<type>[a-z]+)(?:\([^()\r\n]+\))?!?: .+$/u;

function configuredTypes(messages) {
  const customTypes = new Set();
  for (const message of messages) {
    const header = message.split(/\r?\n/u, 1)[0] ?? '';
    const type = HEADER.exec(header)?.groups?.type;
    if (type && !DEFAULT_TYPES.has(type)) customTypes.add(type);
  }
  return Array.from(customTypes).toSorted((left, right) => left.localeCompare(right));
}

async function temporaryConfig(messages) {
  const customTypes = configuredTypes(messages);
  if (customTypes.length === 0) return undefined;

  const directory = await mkdtemp(join(tmpdir(), 'stella-cog-'));
  const path = join(directory, 'cog.toml');
  const commitTypes = customTypes
    .map((type) => `${JSON.stringify(type)} = { changelog_title = ${JSON.stringify(type)} }`)
    .join('\n');
  await writeFile(
    path,
    [
      'from_latest_tag = false',
      'ignore_merge_commits = false',
      'ignore_fixup_commits = false',
      '',
      '[commit_types]',
      commitTypes,
      '',
    ].join('\n'),
    'utf8',
  );
  return { directory, path };
}

async function runCog(args, messages, stdio) {
  const temporary = await temporaryConfig(messages);
  try {
    const configArgs = temporary ? ['--config', temporary.path] : [];
    return spawnSync('cog', [...configArgs, ...args], { encoding: 'utf8', stdio });
  } finally {
    if (temporary) await rm(temporary.directory, { recursive: true, force: true });
  }
}

export async function verifyCommitFile(file, stdio = 'inherit') {
  const message = await readFile(file, 'utf8');
  return runCog(['verify', '--file', file], [message], stdio);
}

export async function checkCommitHistory(stdio = 'inherit') {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { stdio: 'ignore' });
  if (head.status !== 0) return { status: 0 };

  const log = spawnSync('git', ['log', '--format=%B%x00'], { encoding: 'utf8', stdio: 'pipe' });
  if (log.status !== 0) return log;
  const messages = (log.stdout ?? '').split('\0').filter(Boolean);
  return runCog(['check'], messages, stdio);
}

import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const fixtureRoot = join(process.cwd(), '.tmp', 'e2e');

export async function createFixtureDirectory(prefix: string): Promise<string> {
  await mkdir(fixtureRoot, { recursive: true });
  return realpath(await mkdtemp(join(fixtureRoot, `${prefix}-`)));
}

export async function createEmptyRepository(prefix: string): Promise<string> {
  const path = await createFixtureDirectory(prefix);
  await runGit(path, ['init', '-b', 'main']);
  return path;
}

export async function removeFixture(path: string): Promise<void> {
  if (path) await rm(path, { recursive: true, force: true });
}

export async function runGit(path: string, args: readonly string[]): Promise<string> {
  const result = await run('/usr/bin/git', ['-C', path, ...args]);
  return result.stdout;
}

export async function configureRepository(
  path: string,
  userName = 'Stella E2E',
  userEmail = 'stella-e2e@example.invalid',
): Promise<void> {
  await runGit(path, ['config', 'user.name', userName]);
  await runGit(path, ['config', 'user.email', userEmail]);
  await runGit(path, ['config', 'commit.gpgsign', 'false']);
}

export async function writeRepositoryFile(
  path: string,
  relativePath: string,
  content: string,
): Promise<void> {
  await writeFile(join(path, relativePath), content, 'utf8');
}

export async function writeExecutableRepositoryFile(
  path: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = join(path, relativePath);
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
}

export async function createCommittedRepository(
  root: string,
  name: string,
  options: { dirty?: boolean; message?: string } = {},
): Promise<string> {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  await runGit(path, ['init', '-b', 'main']);
  await configureRepository(path);
  await writeRepositoryFile(path, 'README.md', `# ${name}\n`);
  await runGit(path, ['add', 'README.md']);
  await runGit(path, ['commit', '-m', options.message ?? 'Initial commit']);
  if (options.dirty) {
    await writeRepositoryFile(path, 'README.md', `# ${name}\n\nModified for visual QA.\n`);
  }
  return realpath(path);
}

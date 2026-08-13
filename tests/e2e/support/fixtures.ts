import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

export async function ensureLocalBareRemote(
  repositoryPath: string,
  remotePath: string,
  remoteName = 'origin',
): Promise<string> {
  const remotes = (await runGit(repositoryPath, ['remote'])).trim().split('\n');
  const configured = remotes.includes(remoteName);
  if (configured) {
    const configuredPath = (await runGit(repositoryPath, ['remote', 'get-url', remoteName])).trim();
    if (configuredPath !== remotePath)
      throw new Error(`${remoteName} is already configured with a different URL.`);
    if (await exists(join(remotePath, 'HEAD'))) return realpath(remotePath);
  }

  await mkdir(dirname(remotePath), { recursive: true });
  if (!(await exists(join(remotePath, 'HEAD'))))
    await runGit(repositoryPath, ['init', '--bare', '-b', 'main', remotePath]);
  if (!configured) await runGit(repositoryPath, ['remote', 'add', remoteName, remotePath]);
  const remoteMain = await runGit(repositoryPath, [
    'ls-remote',
    '--heads',
    remoteName,
    'refs/heads/main',
  ]);
  if (remoteMain.trim()) {
    await runGit(repositoryPath, ['fetch', remoteName]);
    await runGit(repositoryPath, ['branch', '--set-upstream-to', `${remoteName}/main`, 'main']);
  } else {
    await runGit(repositoryPath, ['push', '--set-upstream', remoteName, 'main']);
  }
  return realpath(remotePath);
}

export async function cloneLocalRemote(
  root: string,
  remotePath: string,
  name: string,
): Promise<string> {
  const destination = join(root, name);
  await runGit(root, ['clone', '--branch', 'main', remotePath, destination]);
  await configureRepository(destination);
  return realpath(destination);
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

import { createHash } from 'node:crypto';
import {
  chmodSync,
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { arch, cpus, platform } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(repositoryRoot, 'toolchain.lock.json');
const temporaryRoot = join(repositoryRoot, 'tmp', 'toolchain');
const downloadsDirectory = join(temporaryRoot, 'downloads');
const sourcesDirectory = join(temporaryRoot, 'sources');
const buildDirectory = join(temporaryRoot, 'build');
const bundleDirectory = join(temporaryRoot, 'bundle', 'toolchain');
const markerPath = join(bundleDirectory, '.stella-toolchain.json');
const systemPath = '/usr/bin:/bin:/usr/sbin:/sbin';

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  capture?: boolean;
};

type DownloadSource = {
  archive: string;
  url: string;
  sha256: string;
};

type ToolchainComponent = DownloadSource & {
  version: string;
  license: string;
  licenseUrl?: string;
  licenseFile?: string;
  licenseSha256?: string;
};

type LicensedComponent = ToolchainComponent & {
  licenseUrl: string;
  licenseFile: string;
  licenseSha256: string;
};

type ComponentName = 'git' | 'gitLfs' | 'gitFlow';
type ArchiveKind = Exclude<ComponentName, 'git'>;

type ToolchainManifest = {
  schemaVersion: number;
  platform: string;
  components: {
    git: ToolchainComponent;
    gitLfs: LicensedComponent;
    gitFlow: LicensedComponent;
  };
};

type ToolchainMarker = {
  manifestSha256: string;
  files: Record<string, string>;
};

function executableDirectory(name: string) {
  for (const directory of (process.env.PATH ?? '').split(':')) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return directory;
  }
  return undefined;
}

function fail(message: string): never {
  throw new Error(message);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!isJsonObject(value)) {
    fail(`${label} is not an object.`);
  }
  return value;
}

function jsonString(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} is not a string.`);
  return value;
}

function jsonNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') fail(`${label} is not a number.`);
  return value;
}

function toolchainComponent(value: unknown, label: string): ToolchainComponent {
  const component = jsonObject(value, label);
  return {
    version: jsonString(component.version, `${label}.version`),
    url: jsonString(component.url, `${label}.url`),
    archive: jsonString(component.archive, `${label}.archive`),
    sha256: jsonString(component.sha256, `${label}.sha256`),
    license: jsonString(component.license, `${label}.license`),
  };
}

function licensedComponent(value: unknown, label: string): LicensedComponent {
  const component = jsonObject(value, label);
  return {
    ...toolchainComponent(component, label),
    licenseUrl: jsonString(component.licenseUrl, `${label}.licenseUrl`),
    licenseFile: jsonString(component.licenseFile, `${label}.licenseFile`),
    licenseSha256: jsonString(component.licenseSha256, `${label}.licenseSha256`),
  };
}

function run(command: string, args: string[], options: RunOptions = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) fail(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ''}${result.stderr ?? ''}` : '';
    fail(`${command} failed with exit code ${String(result.status)}.${detail}`);
  }
  return options.capture ? (result.stdout ?? '').trim() : '';
}

function runExpectFailure(command: string, args: string[], options: RunOptions = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) fail(`Could not start ${command}: ${result.error.message}`);
  if (result.status === 0) fail(`${command} unexpectedly succeeded in a failure test.`);
}

function safeReset(path: string) {
  const relativePath = relative(temporaryRoot, path);
  if (relativePath.startsWith('..') || relativePath === '') fail(`Invalid reset target: ${path}`);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function manifest(): ToolchainManifest {
  const value: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const lock = jsonObject(value, 'toolchain.lock.json');
  const components = jsonObject(lock.components, 'toolchain.lock.json.components');
  return {
    schemaVersion: jsonNumber(lock.schemaVersion, 'toolchain.lock.json.schemaVersion'),
    platform: jsonString(lock.platform, 'toolchain.lock.json.platform'),
    components: {
      git: toolchainComponent(components.git, 'toolchain.lock.json.components.git'),
      gitLfs: licensedComponent(components.gitLfs, 'toolchain.lock.json.components.gitLfs'),
      gitFlow: licensedComponent(components.gitFlow, 'toolchain.lock.json.components.gitFlow'),
    },
  };
}

function manifestDigest() {
  return sha256(manifestPath);
}

function assertPlatform() {
  if (platform() !== 'darwin' || arch() !== 'arm64') {
    fail(
      `The bundled toolchain supports only darwin-arm64. Current platform: ${platform()}-${arch()}`,
    );
  }
}

function download(component: DownloadSource) {
  mkdirSync(downloadsDirectory, { recursive: true });
  const destination = join(downloadsDirectory, component.archive);
  if (existsSync(destination) && sha256(destination) === component.sha256) return destination;
  const partial = `${destination}.part`;
  rmSync(partial, { force: true });
  run('/usr/bin/curl', [
    '--fail',
    '--location',
    '--retry',
    '3',
    '--output',
    partial,
    component.url,
  ]);
  const actual = sha256(partial);
  if (actual !== component.sha256) {
    rmSync(partial, { force: true });
    fail(`${component.archive} SHA-256 mismatch. Expected=${component.sha256} Actual=${actual}`);
  }
  renameSync(partial, destination);
  return destination;
}

function downloadLicense(component: LicensedComponent) {
  return download({
    archive: component.licenseFile,
    url: component.licenseUrl,
    sha256: component.licenseSha256,
  });
}

function extractTar(archive: string, destination: string) {
  mkdirSync(destination, { recursive: true });
  run('/usr/bin/tar', ['-xf', archive, '-C', destination]);
}

function extractZip(archive: string, destination: string) {
  mkdirSync(destination, { recursive: true });
  run('/usr/bin/ditto', ['-x', '-k', archive, destination]);
}

function findFile(root: string, names: string[]) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (names.includes(entry.name)) return path;
    }
  }
  return undefined;
}

function copyExecutable(source: string, destination: string) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
}

function buildGit(component: ToolchainComponent, archive: string) {
  const sourceRoot = join(sourcesDirectory, `git-${component.version}`);
  extractTar(archive, sourcesDirectory);
  if (!existsSync(join(sourceRoot, 'configure'))) fail('Failed to extract the Git source.');
  // リポジトリ配下の一時ソースをStella自身のCargoワークスペースから分離する。
  appendFileSync(join(sourceRoot, 'Cargo.toml'), '\n[workspace]\n');
  const stage = join(buildDirectory, 'git-stage');
  mkdirSync(stage, { recursive: true });
  const cargoDirectory = executableDirectory('cargo');
  if (!cargoDirectory) fail('Cargo is required to build Git but was not found.');
  const environment = {
    ...process.env,
    PATH: `${cargoDirectory}:${systemPath}`,
    LC_ALL: 'C',
    LANG: 'C',
  };
  run(
    join(sourceRoot, 'configure'),
    ['--prefix=/usr/local', '--without-tcltk', '--with-curl', '--with-shell=/bin/sh'],
    { cwd: sourceRoot, env: environment },
  );
  const makeFlags = [
    `-j${String(Math.max(1, cpus().length))}`,
    'RUNTIME_PREFIX=YesPlease',
    'NO_GETTEXT=YesPlease',
    'NO_TCLTK=YesPlease',
    'NO_PERL=YesPlease',
  ];
  run('/usr/bin/make', makeFlags, { cwd: sourceRoot, env: environment });
  run(
    '/usr/bin/make',
    [...makeFlags, `DESTDIR=${stage}`, 'install', 'install-git-credential-osxkeychain'],
    { cwd: sourceRoot, env: environment },
  );
  const stagedPrefix = join(stage, 'usr', 'local');
  for (const entry of readdirSync(stagedPrefix)) {
    cpSync(join(stagedPrefix, entry), join(bundleDirectory, entry), { recursive: true });
  }
  mkdirSync(join(bundleDirectory, 'licenses'), { recursive: true });
  copyFileSync(join(sourceRoot, 'COPYING'), join(bundleDirectory, 'licenses', 'git-COPYING'));
}

function installArchiveComponent(
  component: LicensedComponent,
  archive: string,
  license: string,
  kind: ArchiveKind,
) {
  const destination = join(buildDirectory, kind);
  if (component.archive.endsWith('.zip')) extractZip(archive, destination);
  else extractTar(archive, destination);
  const executableName = kind === 'gitLfs' ? 'git-lfs' : 'git-flow';
  const archiveExecutableName =
    kind === 'gitFlow' ? `git-flow-v${component.version}-darwin-arm64` : executableName;
  const executable = findFile(destination, [executableName, archiveExecutableName]);
  if (!executable) fail(`${executableName} was not found in ${component.archive}.`);
  copyExecutable(executable, join(bundleDirectory, 'bin', executableName));
  copyFileSync(license, join(bundleDirectory, 'licenses', `${kind}-LICENSE`));
}

function writeBuildInformation(lock: ToolchainManifest, archives: Record<ComponentName, string>) {
  const lines = [
    '# Stella Bundled Git Toolchain Build Information',
    '',
    `- Platform: ${lock.platform}`,
    '- Git build options: `RUNTIME_PREFIX=YesPlease NO_GETTEXT=YesPlease NO_TCLTK=YesPlease NO_PERL=YesPlease`',
    '- Git install prefix: `/usr/local` (relocated to match its runtime location in the application)',
    '- Git source adjustment: added only `[workspace]` to isolate its Cargo packages from the Stella workspace',
    '',
    '## Sources and Distribution Artifacts',
    '',
  ];
  const components: [ComponentName, ToolchainComponent][] = [
    ['git', lock.components.git],
    ['gitLfs', lock.components.gitLfs],
    ['gitFlow', lock.components.gitFlow],
  ];
  for (const [name, component] of components) {
    lines.push(`- ${name} ${component.version}: ${component.url}`);
    lines.push(`  - SHA-256: \`${component.sha256}\``);
    lines.push(`  - Local archive: \`${relative(repositoryRoot, archives[name])}\``);
    if (component.licenseUrl) {
      lines.push(`  - License: ${component.licenseUrl}`);
      lines.push(`  - License SHA-256: \`${component.licenseSha256}\``);
    }
  }
  lines.push('');
  writeFileSync(join(bundleDirectory, 'BUILD.md'), `${lines.join('\n')}\n`);
}

function requiredBundleFiles() {
  return [
    'bin/git',
    'bin/git-lfs',
    'bin/git-flow',
    'libexec/git-core/git-remote-https',
    'libexec/git-core/git-credential-osxkeychain',
    'share/git-core/templates',
    'licenses/git-COPYING',
    'licenses/gitLfs-LICENSE',
    'licenses/gitFlow-LICENSE',
    'BUILD.md',
  ];
}

function prepare() {
  assertPlatform();
  const lock = manifest();
  if (lock.schemaVersion !== 1 || lock.platform !== 'darwin-arm64') {
    fail('toolchain.lock.json has an invalid schema or target platform.');
  }
  safeReset(sourcesDirectory);
  safeReset(buildDirectory);
  safeReset(join(temporaryRoot, 'bundle'));
  mkdirSync(bundleDirectory, { recursive: true });
  const archives: Record<ComponentName, string> = {
    git: download(lock.components.git),
    gitLfs: download(lock.components.gitLfs),
    gitFlow: download(lock.components.gitFlow),
  };
  const licenses = {
    gitLfs: downloadLicense(lock.components.gitLfs),
    gitFlow: downloadLicense(lock.components.gitFlow),
  };
  buildGit(lock.components.git, archives.git);
  installArchiveComponent(lock.components.gitLfs, archives.gitLfs, licenses.gitLfs, 'gitLfs');
  installArchiveComponent(lock.components.gitFlow, archives.gitFlow, licenses.gitFlow, 'gitFlow');
  writeBuildInformation(lock, archives);
  const files = Object.fromEntries(
    requiredBundleFiles()
      .filter((path) => statSync(join(bundleDirectory, path)).isFile())
      .map((path) => [path, sha256(join(bundleDirectory, path))]),
  );
  writeFileSync(
    markerPath,
    `${JSON.stringify({ manifestSha256: manifestDigest(), files }, null, 2)}\n`,
  );
  verify();
  process.stdout.write('Prepared the bundled Git toolchain.\n');
}

function verifyBundle(root: string, missingHint: string) {
  const bundleMarkerPath = join(root, '.stella-toolchain.json');
  if (!existsSync(bundleMarkerPath)) fail(missingHint);
  const value: unknown = JSON.parse(readFileSync(bundleMarkerPath, 'utf8'));
  const markerValue = jsonObject(value, bundleMarkerPath);
  const fileValues = jsonObject(markerValue.files, `${bundleMarkerPath}.files`);
  const files: Record<string, string> = {};
  for (const [path, checksum] of Object.entries(fileValues)) {
    files[path] = jsonString(checksum, `${bundleMarkerPath}.files.${path}`);
  }
  const marker: ToolchainMarker = {
    manifestSha256: jsonString(markerValue.manifestSha256, `${bundleMarkerPath}.manifestSha256`),
    files,
  };
  if (marker.manifestSha256 !== manifestDigest()) {
    fail('The bundled Git toolchain lock manifest does not match.');
  }
  for (const path of requiredBundleFiles()) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) fail(`${path} is missing.`);
    if (statSync(absolute).isFile()) {
      if (!marker.files[path]) fail(`No checksum is recorded for ${path}.`);
      if (marker.files[path] !== sha256(absolute)) {
        fail(`Checksum mismatch for ${path}.`);
      }
    }
  }
}

function verify() {
  verifyBundle(bundleDirectory, 'The bundled Git toolchain is missing. Run `mise run setup`.');
}

function toolchainEnvironment(root: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${join(root, 'bin')}:${systemPath}`,
    GIT_EXEC_PATH: join(root, 'libexec', 'git-core'),
    GIT_TEMPLATE_DIR: join(root, 'share', 'git-core', 'templates'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_COUNT: '4',
    GIT_CONFIG_KEY_0: 'filter.lfs.clean',
    GIT_CONFIG_VALUE_0: 'git-lfs clean -- %f',
    GIT_CONFIG_KEY_1: 'filter.lfs.smudge',
    GIT_CONFIG_VALUE_1: 'git-lfs smudge -- %f',
    GIT_CONFIG_KEY_2: 'filter.lfs.process',
    GIT_CONFIG_VALUE_2: 'git-lfs filter-process',
    GIT_CONFIG_KEY_3: 'filter.lfs.required',
    GIT_CONFIG_VALUE_3: 'true',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
    LANG: 'C',
  };
}

function runReleaseSmoke(root: string) {
  const smokeRoot = join(temporaryRoot, 'release-smoke');
  safeReset(smokeRoot);
  const remote = join(smokeRoot, 'remote.git');
  const source = join(smokeRoot, 'source');
  const clone = join(smokeRoot, 'clone');
  const git = join(root, 'bin', 'git');
  const gitLfs = join(root, 'bin', 'git-lfs');
  const gitFlow = join(root, 'bin', 'git-flow');
  const environment = toolchainEnvironment(root);
  const options = { env: environment };

  run(git, ['init', '--bare', '--initial-branch=main', remote], options);
  run(git, ['init', '--initial-branch=main', source], options);
  run(git, ['-C', source, 'config', 'user.name', 'Stella Release Gate'], options);
  run(git, ['-C', source, 'config', 'user.email', 'release-gate@stella.invalid'], options);
  writeFileSync(join(source, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
  const lfsPayload = Buffer.from('Stella bundled Git LFS release gate\n'.repeat(4096));
  writeFileSync(join(source, 'payload.bin'), lfsPayload);
  run(git, ['-C', source, 'add', '.gitattributes', 'payload.bin'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: verify bundled toolchain'], options);
  run(git, ['-C', source, 'remote', 'add', 'origin', `file://${remote}`], options);
  run(gitLfs, ['push', 'origin', 'refs/heads/main'], { cwd: source, env: environment });
  run(git, ['-C', source, 'push', '-u', 'origin', 'main'], options);
  run(git, ['clone', `file://${remote}`, clone], options);
  if (!readFileSync(join(clone, 'payload.bin')).equals(lfsPayload)) {
    fail('The cloned Git LFS object was not materialized.');
  }

  run(gitFlow, ['init', '--defaults', '--preset=classic', '--local'], {
    cwd: source,
    env: environment,
  });
  run(gitFlow, ['feature', 'start', 'release-gate', '--no-fetch'], {
    cwd: source,
    env: environment,
  });
  writeFileSync(join(source, 'flow.txt'), 'Git Flow release gate\n');
  run(git, ['-C', source, 'add', 'flow.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: verify Git Flow'], options);
  run(gitFlow, ['feature', 'publish', 'release-gate'], {
    cwd: source,
    env: environment,
  });
  run(gitFlow, ['feature', 'finish', 'release-gate', '--no-fetch', '--no-push', '--keep'], {
    cwd: source,
    env: environment,
  });
  const currentBranch = run(git, ['-C', source, 'branch', '--show-current'], {
    ...options,
    capture: true,
  });
  if (currentBranch !== 'develop') fail('The current branch is not develop after Git Flow finish.');

  writeFileSync(join(source, 'conflict.txt'), 'base\n');
  run(git, ['-C', source, 'add', 'conflict.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: add conflict fixture'], options);
  run(gitFlow, ['feature', 'start', 'conflict', '--no-fetch'], {
    cwd: source,
    env: environment,
  });
  writeFileSync(join(source, 'conflict.txt'), 'feature\n');
  run(git, ['-C', source, 'add', 'conflict.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: update feature side'], options);
  run(git, ['-C', source, 'switch', 'develop'], options);
  writeFileSync(join(source, 'conflict.txt'), 'develop\n');
  run(git, ['-C', source, 'add', 'conflict.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: update develop side'], options);
  run(git, ['-C', source, 'switch', 'feature/conflict'], options);
  runExpectFailure(
    gitFlow,
    ['feature', 'finish', 'conflict', '--no-fetch', '--no-push', '--keep'],
    { cwd: source, env: environment },
  );
  const statePath = join(source, '.git', 'gitflow', 'state', 'merge.json');
  const stateValue: unknown = JSON.parse(readFileSync(statePath, 'utf8'));
  const state = jsonObject(stateValue, statePath);
  if (state.action !== 'finish') fail('Git Flow did not save recovery state for finish.');
  writeFileSync(join(source, 'conflict.txt'), 'resolved\n');
  run(git, ['-C', source, 'add', 'conflict.txt'], options);
  run(gitFlow, ['feature', 'finish', '--continue', 'conflict'], {
    cwd: source,
    env: environment,
  });
  if (existsSync(statePath)) fail('Git Flow recovery state remains after continue.');

  writeFileSync(join(source, 'abort.txt'), 'base\n');
  run(git, ['-C', source, 'add', 'abort.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: add abort fixture'], options);
  run(gitFlow, ['feature', 'start', 'abort-case', '--no-fetch'], {
    cwd: source,
    env: environment,
  });
  writeFileSync(join(source, 'abort.txt'), 'feature\n');
  run(git, ['-C', source, 'add', 'abort.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: update feature side for abort'], options);
  run(git, ['-C', source, 'switch', 'develop'], options);
  writeFileSync(join(source, 'abort.txt'), 'develop\n');
  run(git, ['-C', source, 'add', 'abort.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: update develop side for abort'], options);
  run(git, ['-C', source, 'switch', 'feature/abort-case'], options);
  runExpectFailure(
    gitFlow,
    ['feature', 'finish', 'abort-case', '--no-fetch', '--no-push', '--keep'],
    { cwd: source, env: environment },
  );
  run(gitFlow, ['feature', 'finish', '--abort', 'abort-case'], {
    cwd: source,
    env: environment,
  });
  if (existsSync(statePath)) fail('Git Flow recovery state remains after abort.');

  run(git, ['-C', source, 'switch', 'develop'], options);
  run(gitFlow, ['feature', 'start', 'command-family', '--no-fetch'], {
    cwd: source,
    env: environment,
  });
  const listed = run(gitFlow, ['feature', 'list'], {
    cwd: source,
    env: environment,
    capture: true,
  });
  if (!listed.includes('command-family'))
    fail('The created branch is missing from the Git Flow list.');
  run(git, ['-C', source, 'switch', 'develop'], options);
  run(gitFlow, ['feature', 'checkout', 'command-family'], {
    cwd: source,
    env: environment,
  });
  run(gitFlow, ['feature', 'rename', 'command-family', 'command-family-renamed'], {
    cwd: source,
    env: environment,
  });
  writeFileSync(join(source, 'command-family.txt'), 'topic\n');
  run(git, ['-C', source, 'add', 'command-family.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: verify Git Flow command family'], options);
  run(git, ['-C', source, 'switch', 'develop'], options);
  writeFileSync(join(source, 'parent-update.txt'), 'parent\n');
  run(git, ['-C', source, 'add', 'parent-update.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: advance parent branch'], options);
  run(gitFlow, ['feature', 'checkout', 'command-family-renamed'], {
    cwd: source,
    env: environment,
  });
  run(gitFlow, ['feature', 'update', 'command-family-renamed', '--rebase'], {
    cwd: source,
    env: environment,
  });
  run(
    gitFlow,
    [
      'feature',
      'finish',
      'command-family-renamed',
      '--no-fetch',
      '--no-push',
      '--keep',
      '--no-force-delete',
      '--notag',
      '--no-sign',
    ],
    { cwd: source, env: environment },
  );
  run(gitFlow, ['feature', 'delete', 'release-gate', '--no-force', '--remote', '--no-fetch'], {
    cwd: source,
    env: environment,
  });
  run(git, ['-C', source, 'push', 'origin', 'develop:refs/heads/feature/tracked'], options);
  run(gitFlow, ['feature', 'track', 'tracked'], { cwd: source, env: environment });
  run(git, ['-C', source, 'switch', 'develop'], options);
  run(gitFlow, ['feature', 'delete', 'tracked', '--no-force', '--no-remote', '--no-fetch'], {
    cwd: source,
    env: environment,
  });

  run(
    gitFlow,
    [
      'config',
      'add',
      'topic',
      'experiment',
      'develop',
      '--prefix=exp/',
      '--starting-point=develop',
      '--upstream-strategy=merge',
      '--downstream-strategy=rebase',
      '--tag=false',
    ],
    { cwd: source, env: environment },
  );
  run(
    gitFlow,
    [
      'config',
      'edit',
      'topic',
      'experiment',
      '--prefix=experiments/',
      '--starting-point=develop',
      '--upstream-strategy=squash',
      '--downstream-strategy=merge',
      '--tag=false',
    ],
    { cwd: source, env: environment },
  );
  run(gitFlow, ['config', 'rename', 'topic', 'experiment', 'lab'], {
    cwd: source,
    env: environment,
  });
  run(gitFlow, ['config', 'delete', 'topic', 'lab'], { cwd: source, env: environment });
  run(
    gitFlow,
    [
      'config',
      'add',
      'base',
      'staging',
      'develop',
      '--upstream-strategy=merge',
      '--downstream-strategy=merge',
      '--auto-update=false',
    ],
    { cwd: source, env: environment },
  );
  run(
    gitFlow,
    [
      'config',
      'edit',
      'base',
      'staging',
      '--upstream-strategy=merge',
      '--downstream-strategy=merge',
      '--auto-update=true',
    ],
    { cwd: source, env: environment },
  );
  run(git, ['-C', source, 'switch', 'staging'], options);
  writeFileSync(join(source, 'integrate.txt'), 'integrate\n');
  run(git, ['-C', source, 'add', 'integrate.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: verify integrate'], options);
  run(gitFlow, ['integrate', 'staging', '--no-fetch', '--notag', '--no-sign', '--no-rebase'], {
    cwd: source,
    env: environment,
  });
  run(gitFlow, ['config', 'rename', 'base', 'staging', 'qa'], {
    cwd: source,
    env: environment,
  });
  run(gitFlow, ['config', 'delete', 'base', 'qa'], { cwd: source, env: environment });
  run(gitFlow, ['config', 'list'], { cwd: source, env: environment });
}

function releaseGate(applicationPath: string) {
  assertPlatform();
  const lock = manifest();
  const root = join(resolve(applicationPath), 'Contents', 'Resources', 'toolchain');
  const commands: [name: string, args: string[], version: string][] = [
    ['git', ['--version'], lock.components.git.version],
    ['git-lfs', ['version'], lock.components.gitLfs.version],
    ['git-flow', ['version'], lock.components.gitFlow.version],
  ];
  for (const [name, args, version] of commands) {
    const executable = join(root, 'bin', name);
    const fileOutput = run('/usr/bin/file', [executable], { capture: true });
    if (!fileOutput.includes('arm64')) fail(`${name} is not an arm64 binary.`);
    const versionOutput = run(executable, args, { capture: true });
    if (!versionOutput.includes(version)) fail(`${name} version is not ${version}.`);
    const links = run('/usr/bin/otool', ['-L', executable], { capture: true });
    if (/(?:\/tmp\/|\/opt\/homebrew|\/usr\/local\/opt)/u.test(links)) {
      fail(`${name} dynamic links retain a build environment path.\n${links}`);
    }
  }
  for (const helper of [
    'libexec/git-core/git-remote-https',
    'libexec/git-core/git-credential-osxkeychain',
  ]) {
    const executable = join(root, helper);
    const fileOutput = run('/usr/bin/file', [executable], { capture: true });
    if (!fileOutput.includes('arm64')) fail(`${helper} is not an arm64 binary.`);
    const links = run('/usr/bin/otool', ['-L', executable], { capture: true });
    if (/(?:\/tmp\/|\/opt\/homebrew|\/usr\/local\/opt)/u.test(links)) {
      fail(`${helper} dynamic links retain a build environment path.\n${links}`);
    }
  }
  verifyBundle(root, 'The application does not contain the bundled Git toolchain.');
  runReleaseSmoke(root);
  process.stdout.write('The bundled Git toolchain passed the release checks.\n');
}

const [mode, ...arguments_] = process.argv.slice(2);
try {
  if (mode === 'prepare') prepare();
  else if (mode === 'verify') verify();
  else if (mode === 'release-gate') {
    releaseGate(arguments_[0] ?? join(repositoryRoot, 'target/release/bundle/macos/Stella.app'));
  } else {
    fail(
      'usage: node --import tsx scripts/toolchain.mts <prepare|verify|release-gate> [Stella.app]',
    );
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

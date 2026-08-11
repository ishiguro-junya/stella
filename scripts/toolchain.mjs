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
const temporaryRoot = join(repositoryRoot, '.tmp', 'toolchain');
const downloadsDirectory = join(temporaryRoot, 'downloads');
const sourcesDirectory = join(temporaryRoot, 'sources');
const buildDirectory = join(temporaryRoot, 'build');
const bundleDirectory = join(temporaryRoot, 'bundle', 'toolchain');
const markerPath = join(bundleDirectory, '.stella-toolchain.json');
const systemPath = '/usr/bin:/bin:/usr/sbin:/sbin';

function executableDirectory(name) {
  for (const directory of String(process.env.PATH ?? '').split(':')) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return directory;
  }
  return undefined;
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) fail(`${command}を起動できませんでした: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ''}${result.stderr ?? ''}` : '';
    fail(`${command}が終了code ${String(result.status)}で失敗しました。${detail}`);
  }
  return options.capture ? String(result.stdout ?? '').trim() : '';
}

function runExpectFailure(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) fail(`${command}を起動できませんでした: ${result.error.message}`);
  if (result.status === 0) fail(`${command}が失敗すべき検証で成功しました。`);
}

function safeReset(path) {
  const relativePath = relative(temporaryRoot, path);
  if (relativePath.startsWith('..') || relativePath === '') fail(`削除対象が不正です: ${path}`);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function manifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function manifestDigest() {
  return sha256(manifestPath);
}

function assertPlatform() {
  if (platform() !== 'darwin' || arch() !== 'arm64') {
    fail(`内蔵toolchainはdarwin-arm64専用です。現在は${platform()}-${arch()}です。`);
  }
}

function download(component) {
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
    fail(
      `${component.archive}のSHA-256が一致しません。expected=${component.sha256} actual=${actual}`,
    );
  }
  renameSync(partial, destination);
  return destination;
}

function downloadLicense(component) {
  return download({
    archive: component.licenseFile,
    url: component.licenseUrl,
    sha256: component.licenseSha256,
  });
}

function extractTar(archive, destination) {
  mkdirSync(destination, { recursive: true });
  run('/usr/bin/tar', ['-xf', archive, '-C', destination]);
}

function extractZip(archive, destination) {
  mkdirSync(destination, { recursive: true });
  run('/usr/bin/ditto', ['-x', '-k', archive, destination]);
}

function findFile(root, names) {
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

function copyExecutable(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
}

function buildGit(component, archive) {
  const sourceRoot = join(sourcesDirectory, `git-${component.version}`);
  extractTar(archive, sourcesDirectory);
  if (!existsSync(join(sourceRoot, 'configure'))) fail('Git sourceを展開できませんでした。');
  // Repository配下の一時sourceをStella自身のCargo workspaceから分離する。
  appendFileSync(join(sourceRoot, 'Cargo.toml'), '\n[workspace]\n');
  const stage = join(buildDirectory, 'git-stage');
  mkdirSync(stage, { recursive: true });
  const cargoDirectory = executableDirectory('cargo');
  if (!cargoDirectory) fail('Git 2.55.0のbuildに必要なCargoが見つかりません。');
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

function installArchiveComponent(component, archive, license, kind) {
  const destination = join(buildDirectory, kind);
  if (component.archive.endsWith('.zip')) extractZip(archive, destination);
  else extractTar(archive, destination);
  const executableName = kind === 'gitLfs' ? 'git-lfs' : 'git-flow';
  const archiveExecutableName =
    kind === 'gitFlow' ? `git-flow-v${component.version}-darwin-arm64` : executableName;
  const executable = findFile(destination, [executableName, archiveExecutableName]);
  if (!executable) fail(`${component.archive}に${executableName}が見つかりません。`);
  copyExecutable(executable, join(bundleDirectory, 'bin', executableName));
  copyFileSync(license, join(bundleDirectory, 'licenses', `${kind}-LICENSE`));
}

function writeBuildInformation(lock, archives) {
  const lines = [
    '# Stella内蔵Git toolchain build情報',
    '',
    `- Platform: ${lock.platform}`,
    '- Git build: `RUNTIME_PREFIX=YesPlease NO_GETTEXT=YesPlease NO_TCLTK=YesPlease NO_PERL=YesPlease`',
    '- Git install prefix: `/usr/local`（Application resource内へstaging後、runtime prefixで再配置）',
    '- Git source adjustment: Cargo packageをStellaのworkspaceから分離する`[workspace]`のみ追記',
    '',
    '## Sourceと配布asset',
    '',
  ];
  for (const [name, component] of Object.entries(lock.components)) {
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
    fail('toolchain.lock.jsonのschemaまたはplatformが不正です。');
  }
  safeReset(sourcesDirectory);
  safeReset(buildDirectory);
  safeReset(join(temporaryRoot, 'bundle'));
  mkdirSync(bundleDirectory, { recursive: true });
  const archives = Object.fromEntries(
    Object.entries(lock.components).map(([name, component]) => [name, download(component)]),
  );
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
  process.stdout.write('内蔵Git toolchainを準備しました。\n');
}

function verifyBundle(root, missingHint) {
  const bundleMarkerPath = join(root, '.stella-toolchain.json');
  if (!existsSync(bundleMarkerPath)) fail(missingHint);
  const marker = JSON.parse(readFileSync(bundleMarkerPath, 'utf8'));
  if (marker.manifestSha256 !== manifestDigest()) {
    fail('内蔵Git toolchainのlock manifestが一致しません。');
  }
  for (const path of requiredBundleFiles()) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) fail(`${path}がありません。`);
    if (statSync(absolute).isFile()) {
      if (!marker.files[path]) fail(`${path}のchecksumが記録されていません。`);
      if (marker.files[path] !== sha256(absolute)) {
        fail(`${path}のchecksumが一致しません。`);
      }
    }
  }
}

function verify() {
  verifyBundle(
    bundleDirectory,
    '内蔵Git toolchainがありません。`mise run setup`を実行してください。',
  );
}

function toolchainEnvironment(root) {
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

function runReleaseSmoke(root) {
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
  run(git, ['-C', source, 'commit', '-m', 'test: 内蔵toolchainを検証'], options);
  run(git, ['-C', source, 'remote', 'add', 'origin', `file://${remote}`], options);
  run(gitLfs, ['push', 'origin', 'refs/heads/main'], { cwd: source, env: environment });
  run(git, ['-C', source, 'push', '-u', 'origin', 'main'], options);
  run(git, ['clone', `file://${remote}`, clone], options);
  if (!readFileSync(join(clone, 'payload.bin')).equals(lfsPayload)) {
    fail('CloneしたGit LFS objectがmaterializeされていません。');
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
  run(git, ['-C', source, 'commit', '-m', 'test: Git Flowを検証'], options);
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
  if (currentBranch !== 'develop') fail('Git Flow finish後のBranchがdevelopではありません。');

  writeFileSync(join(source, 'conflict.txt'), 'base\n');
  run(git, ['-C', source, 'add', 'conflict.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: 競合fixtureを追加'], options);
  run(gitFlow, ['feature', 'start', 'conflict', '--no-fetch'], {
    cwd: source,
    env: environment,
  });
  writeFileSync(join(source, 'conflict.txt'), 'feature\n');
  run(git, ['-C', source, 'add', 'conflict.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: Feature側を変更'], options);
  run(git, ['-C', source, 'switch', 'develop'], options);
  writeFileSync(join(source, 'conflict.txt'), 'develop\n');
  run(git, ['-C', source, 'add', 'conflict.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: Develop側を変更'], options);
  run(git, ['-C', source, 'switch', 'feature/conflict'], options);
  runExpectFailure(
    gitFlow,
    ['feature', 'finish', 'conflict', '--no-fetch', '--no-push', '--keep'],
    { cwd: source, env: environment },
  );
  const statePath = join(source, '.git', 'gitflow', 'state', 'merge.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (state.action !== 'finish') fail('Git Flow finishの復旧stateが保存されていません。');
  writeFileSync(join(source, 'conflict.txt'), 'resolved\n');
  run(git, ['-C', source, 'add', 'conflict.txt'], options);
  run(gitFlow, ['feature', 'finish', '--continue', 'conflict'], {
    cwd: source,
    env: environment,
  });
  if (existsSync(statePath)) fail('Git Flow continue後も復旧stateが残っています。');

  writeFileSync(join(source, 'abort.txt'), 'base\n');
  run(git, ['-C', source, 'add', 'abort.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: Abort fixtureを追加'], options);
  run(gitFlow, ['feature', 'start', 'abort-case', '--no-fetch'], {
    cwd: source,
    env: environment,
  });
  writeFileSync(join(source, 'abort.txt'), 'feature\n');
  run(git, ['-C', source, 'add', 'abort.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: Abort Feature側を変更'], options);
  run(git, ['-C', source, 'switch', 'develop'], options);
  writeFileSync(join(source, 'abort.txt'), 'develop\n');
  run(git, ['-C', source, 'add', 'abort.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: Abort Develop側を変更'], options);
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
  if (existsSync(statePath)) fail('Git Flow abort後も復旧stateが残っています。');

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
  if (!listed.includes('command-family')) fail('Git Flow listで作成したBranchを取得できません。');
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
  run(git, ['-C', source, 'commit', '-m', 'test: Git Flow command familyを検証'], options);
  run(git, ['-C', source, 'switch', 'develop'], options);
  writeFileSync(join(source, 'parent-update.txt'), 'parent\n');
  run(git, ['-C', source, 'add', 'parent-update.txt'], options);
  run(git, ['-C', source, 'commit', '-m', 'test: Update元を進める'], options);
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
  run(git, ['-C', source, 'commit', '-m', 'test: Integrateを検証'], options);
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

function releaseGate(applicationPath) {
  assertPlatform();
  const lock = manifest();
  const root = join(resolve(applicationPath), 'Contents', 'Resources', 'toolchain');
  const commands = [
    ['git', ['--version'], lock.components.git.version],
    ['git-lfs', ['version'], lock.components.gitLfs.version],
    ['git-flow', ['version'], lock.components.gitFlow.version],
  ];
  for (const [name, args, version] of commands) {
    const executable = join(root, 'bin', name);
    const fileOutput = run('/usr/bin/file', [executable], { capture: true });
    if (!fileOutput.includes('arm64')) fail(`${name}がarm64 binaryではありません。`);
    const versionOutput = run(executable, args, { capture: true });
    if (!versionOutput.includes(version)) fail(`${name}のversionが${version}ではありません。`);
    const links = run('/usr/bin/otool', ['-L', executable], { capture: true });
    if (/(?:\.tmp|\/opt\/homebrew|\/usr\/local\/opt)/u.test(links)) {
      fail(`${name}の動的link先にbuild環境pathが残っています。\n${links}`);
    }
  }
  for (const helper of [
    'libexec/git-core/git-remote-https',
    'libexec/git-core/git-credential-osxkeychain',
  ]) {
    const executable = join(root, helper);
    const fileOutput = run('/usr/bin/file', [executable], { capture: true });
    if (!fileOutput.includes('arm64')) fail(`${helper}がarm64 binaryではありません。`);
    const links = run('/usr/bin/otool', ['-L', executable], { capture: true });
    if (/(?:\.tmp|\/opt\/homebrew|\/usr\/local\/opt)/u.test(links)) {
      fail(`${helper}の動的link先にbuild環境pathが残っています。\n${links}`);
    }
  }
  verifyBundle(root, 'Applicationに内蔵Git toolchainがありません。');
  runReleaseSmoke(root);
  process.stdout.write('内蔵Git toolchainのrelease gateを通過しました。\n');
}

const [mode, ...arguments_] = process.argv.slice(2);
try {
  if (mode === 'prepare') prepare();
  else if (mode === 'verify') verify();
  else if (mode === 'release-gate') {
    releaseGate(arguments_[0] ?? join(repositoryRoot, 'target/release/bundle/macos/Stella.app'));
  } else fail('usage: node scripts/toolchain.mjs <prepare|verify|release-gate> [Stella.app]');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

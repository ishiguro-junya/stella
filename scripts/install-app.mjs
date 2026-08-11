import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { platform } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceApplication = join(
  repositoryRoot,
  'target',
  'release',
  'bundle',
  'macos',
  'Stella.app',
);
const destinationApplication = '/Applications/Stella.app';
const destinationExecutable = join(destinationApplication, 'Contents', 'MacOS', 'stella');
const temporaryRoot = join(repositoryRoot, '.tmp');
const installDirectory = join(temporaryRoot, 'install-app');
const stagedApplication = join(installDirectory, 'Stella.app');
const previousApplication = join(installDirectory, 'Stella.previous.app');
const failedApplication = join(installDirectory, 'Stella.failed.app');
const plistBuddy = '/usr/libexec/PlistBuddy';

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
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

function resetInstallDirectory() {
  const relativePath = relative(temporaryRoot, installDirectory);
  if (relativePath.startsWith('..') || relativePath === '') {
    fail(`一時directoryのpathが不正です: ${installDirectory}`);
  }
  rmSync(installDirectory, { recursive: true, force: true });
  mkdirSync(installDirectory, { recursive: true });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function bundleValue(application, key) {
  return run(plistBuddy, ['-c', `Print :${key}`, join(application, 'Contents', 'Info.plist')], {
    capture: true,
  });
}

function inspectBundle(application) {
  if (!existsSync(application) || !statSync(application).isDirectory()) {
    fail(`Application bundleがありません: ${application}`);
  }
  const executable = bundleValue(application, 'CFBundleExecutable');
  const executablePath = join(application, 'Contents', 'MacOS', executable);
  if (!existsSync(executablePath) || !statSync(executablePath).isFile()) {
    fail(`Applicationの実行fileがありません: ${executablePath}`);
  }
  return {
    identifier: bundleValue(application, 'CFBundleIdentifier'),
    version: bundleValue(application, 'CFBundleShortVersionString'),
    executable,
    executableSha256: sha256(executablePath),
  };
}

function assertExpectedBundle(bundle, expected, application) {
  for (const key of ['identifier', 'version', 'executable', 'executableSha256']) {
    if (bundle[key] !== expected[key]) {
      fail(`${application}の${key}がbuild成果物と一致しません。`);
    }
  }
}

function installedApplicationPids() {
  const output = run('/bin/ps', ['-axo', 'pid=,command='], { capture: true });
  return output
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(
      (match) =>
        match !== null &&
        (match[2] === destinationExecutable || match[2].startsWith(`${destinationExecutable} `)),
    )
    .map((match) => Number(match[1]));
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForInstalledApplicationToExit(deadline) {
  if (installedApplicationPids().length === 0) return;
  if (Date.now() >= deadline) {
    fail('Stellaを10秒以内に終了できませんでした。Applicationは置き換えていません。');
  }
  await delay(100);
  await waitForInstalledApplicationToExit(deadline);
}

async function terminateInstalledApplication() {
  const pids = installedApplicationPids();
  if (pids.length === 0) return;

  console.log('起動中のStellaを終了します。');
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }

  await waitForInstalledApplicationToExit(Date.now() + 10_000);
}

function recoverInterruptedInstall() {
  if (existsSync(previousApplication) && !existsSync(destinationApplication)) {
    renameSync(previousApplication, destinationApplication);
  }
}

function rollback(previousMoved, installedMoved) {
  const errors = [];
  if (installedMoved && existsSync(destinationApplication)) {
    try {
      renameSync(destinationApplication, failedApplication);
    } catch (error) {
      errors.push(`新しいApplicationを退避できませんでした: ${error.message}`);
    }
  }
  if (previousMoved && existsSync(previousApplication) && !existsSync(destinationApplication)) {
    try {
      renameSync(previousApplication, destinationApplication);
    } catch (error) {
      errors.push(`以前のApplicationを復元できませんでした: ${error.message}`);
    }
  }
  return errors;
}

async function install() {
  if (platform() !== 'darwin') fail('ApplicationのinstallはmacOS専用です。');
  try {
    accessSync('/Applications', constants.W_OK);
  } catch {
    fail('/Applicationsへ書き込めません。書き込み権限を確認してください。');
  }
  mkdirSync(temporaryRoot, { recursive: true });
  recoverInterruptedInstall();
  resetInstallDirectory();

  const sourceBundle = inspectBundle(sourceApplication);
  if (sourceBundle.identifier !== 'com.emuni.stella') {
    fail(`Bundle IDがcom.emuni.stellaではありません: ${sourceBundle.identifier}`);
  }

  run('/usr/bin/ditto', [sourceApplication, stagedApplication]);
  assertExpectedBundle(inspectBundle(stagedApplication), sourceBundle, stagedApplication);
  await terminateInstalledApplication();

  let previousMoved = false;
  let installedMoved = false;
  try {
    if (existsSync(destinationApplication)) {
      renameSync(destinationApplication, previousApplication);
      previousMoved = true;
    }
    renameSync(stagedApplication, destinationApplication);
    installedMoved = true;
    assertExpectedBundle(
      inspectBundle(destinationApplication),
      sourceBundle,
      destinationApplication,
    );
  } catch (error) {
    const rollbackErrors = rollback(previousMoved, installedMoved);
    const rollbackDetail = rollbackErrors.length > 0 ? `\n${rollbackErrors.join('\n')}` : '';
    fail(`Applicationの置き換えに失敗しました: ${error.message}${rollbackDetail}`);
  }

  rmSync(installDirectory, { recursive: true, force: true });
  console.log(`Stella ${sourceBundle.version}を${destinationApplication}へインストールしました。`);
}

try {
  await install();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';

const [version, notesPath, archivePath, signaturePath, outputPath] = process.argv.slice(2);
if (!version || !notesPath || !archivePath || !signaturePath || !outputPath) {
  throw new Error(
    'Usage: create-updater-manifest <version> <notes> <archive.app.tar.gz> <signature> <output>',
  );
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Version is not valid SemVer: ${version}`);
}

const archiveName = basename(archivePath);
if (!archiveName.endsWith('.app.tar.gz')) {
  throw new Error(`Updater archive must end with .app.tar.gz: ${archiveName}`);
}
const outputRelative = relative(resolve('.tmp'), resolve(outputPath));
if (outputRelative.startsWith('..') || isAbsolute(outputRelative)) {
  throw new Error('Updater manifest must be written below .tmp/.');
}

const signature = readFileSync(signaturePath, 'utf8').trim();
if (!signature) throw new Error('Updater signature is empty.');

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      version,
      notes: readFileSync(notesPath, 'utf8').trim(),
      pub_date: new Date().toISOString(),
      platforms: {
        'darwin-aarch64': {
          url: `https://github.com/ishiguro-junya/stella/releases/download/v${version}/${archiveName}`,
          signature,
        },
      },
    },
    null,
    2,
  )}\n`,
);

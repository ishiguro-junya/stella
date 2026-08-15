import { describe, expect, it } from 'vitest';

import {
  editorLineForDiffSelection,
  imageDiffCandidates,
  patchContainsMultipleFiles,
  profileDiffPatch,
} from './diffProfile';

describe('diff patch profile', () => {
  it.each(['GIT binary patch\n', 'Binary files a/image.png and b/image.png differ\n'])(
    'detects binary patch',
    (patch) => {
      expect(profileDiffPatch(patch).binary).toBe(true);
    },
  );

  it('keeps a mixed text and binary commit displayable', () => {
    const patch = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1 +1 @@
-old
+new
diff --git a/image.png b/image.png
GIT binary patch
literal 1
abc
`;

    expect(profileDiffPatch(patch).binary).toBe(false);
    expect(imageDiffCandidates(patch, 'mixed')).toEqual([
      {
        path: 'image.png',
        changeKind: 'modified',
        format: 'binary',
      },
    ]);
  });

  it('finds SVG renames separately from binary images', () => {
    const patch = `diff --git a/old.svg b/new.SVG
similarity index 100%
rename from old.svg
rename to new.SVG
`;

    expect(imageDiffCandidates(patch, 'svg-rename')).toEqual([
      {
        path: 'new.SVG',
        previousPath: 'old.svg',
        changeKind: 'renamed',
        format: 'svg',
      },
    ]);
  });

  it('probes a pure raster rename whose patch has no binary marker', () => {
    const patch = `diff --git a/old.png b/new.png
similarity index 100%
rename from old.png
rename to new.png
`;

    expect(imageDiffCandidates(patch, 'raster-rename')).toEqual([
      {
        path: 'new.png',
        previousPath: 'old.png',
        changeKind: 'renamed',
        format: 'probe',
      },
    ]);
  });

  it.each([
    [
      'added',
      `diff --git a/new.png b/new.png
new file mode 100644
index 0000000..1111111
GIT binary patch
literal 1
abc
`,
      { path: 'new.png', changeKind: 'added', format: 'binary' },
    ],
    [
      'deleted',
      `diff --git a/old.png b/old.png
deleted file mode 100644
index 1111111..0000000
GIT binary patch
literal 0

literal 1
abc
`,
      { path: 'old.png', changeKind: 'deleted', format: 'binary' },
    ],
  ] as const)('recognizes the existing side of an %s image', (_kind, patch, expected) => {
    expect(imageDiffCandidates(patch, `binary-${_kind}`)).toEqual([expected]);
  });

  it('keeps a binary candidate from the available prefix of a truncated patch', () => {
    const patch = `diff --git a/image b/image
index 1111111..2222222 100644
GIT binary patch
literal 100
abc`;

    expect(imageDiffCandidates(patch, 'truncated')).toEqual([
      {
        path: 'image',
        changeKind: 'modified',
        format: 'binary',
      },
    ]);
  });

  it('enables performance mode above the ordinary line limit', () => {
    expect(profileDiffPatch('+x\n'.repeat(20_001)).performanceMode).toBe(true);
  });

  it('recognizes a patch containing multiple files', () => {
    expect(
      patchContainsMultipleFiles(
        'diff --git a/a b/a\n--- a/a\n+++ b/a\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n',
      ),
    ).toBe(true);
  });

  it('maps a deleted line to the next line remaining in the edited file', () => {
    const patch = `diff --git a/example.txt b/example.txt
--- a/example.txt
+++ b/example.txt
@@ -1,4 +1,2 @@
 keep-1
-delete-2
-delete-3
 keep-4
`;

    expect(
      editorLineForDiffSelection(patch, 'deleted-line', {
        side: 'deletions',
        startLine: 3,
      }),
    ).toBe(2);
  });
});

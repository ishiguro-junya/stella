import { describe, expect, it } from 'vitest';

import {
  editorLineForDiffSelection,
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

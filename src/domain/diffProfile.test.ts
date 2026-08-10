import { describe, expect, it } from 'vitest';

import { patchContainsMultipleFiles, profileDiffPatch } from './diffProfile';

describe('diff patch profile', () => {
  it.each(['GIT binary patch\n', 'Binary files a/image.png and b/image.png differ\n'])(
    'detects binary patch',
    (patch) => {
      expect(profileDiffPatch(patch).binary).toBe(true);
    },
  );

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
});

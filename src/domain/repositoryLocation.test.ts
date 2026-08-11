import { describe, expect, it } from 'vitest';

import {
  isAbsoluteLocalPath,
  joinRepositoryPath,
  repositoryNameFromPath,
  repositoryNameFromRemoteUrl,
} from './repositoryLocation';

describe('repository location', () => {
  it.each([
    ['https://github.com/emuni-kyoto/stella.git', 'stella'],
    ['ssh://git@github.com/emuni-kyoto/stella.git', 'stella'],
    ['git@github.com:emuni-kyoto/stella.git', 'stella'],
    ['git://github.com/emuni-kyoto/stella/', 'stella'],
  ])('derives %s as %s', (remote, expected) => {
    expect(repositoryNameFromRemoteUrl(remote)).toBe(expected);
  });

  it.each([
    '',
    'github.com/emuni-kyoto/stella',
    'https://github.com',
    'file:///tmp/stella.git',
    'git@github.com:',
  ])('rejects an unsupported remote: %s', (remote) => {
    expect(repositoryNameFromRemoteUrl(remote)).toBeUndefined();
  });

  it('recognizes absolute macOS paths and joins clone destinations', () => {
    expect(isAbsoluteLocalPath('/Users/example/project/stella')).toBe(true);
    expect(isAbsoluteLocalPath('project/stella')).toBe(false);
    expect(joinRepositoryPath('/Users/example/project/', 'stella')).toBe(
      '/Users/example/project/stella',
    );
    expect(joinRepositoryPath('/', 'stella')).toBe('/stella');
  });

  it('derives a repository name from a local path', () => {
    expect(repositoryNameFromPath('/Users/example/project/stella/')).toBe('stella');
  });
});

const REMOTE_PROTOCOLS = new Set(['git:', 'http:', 'https:', 'ssh:']);

export function repositoryNameFromPath(path: string): string | undefined {
  const trimmed = path.replace(/\/+$/u, '');
  const segment = trimmed.split('/').findLast((candidate) => candidate.length > 0);
  const name = segment?.replace(/\.git$/iu, '');
  if (!name || name === '.' || name === '..' || name.includes('\\')) return undefined;
  return name;
}

export function repositoryNameFromRemoteUrl(value: string): string | undefined {
  const remote = value.trim();
  if (!remote) return undefined;

  try {
    const url = new URL(remote);
    if (!REMOTE_PROTOCOLS.has(url.protocol) || !url.hostname) return undefined;
    return repositoryNameFromPath(url.pathname);
  } catch {
    const scpLike = /^[^@\s/]+@[^:\s/]+:(?<path>[^\s]+)$/u.exec(remote);
    return scpLike?.groups?.path ? repositoryNameFromPath(scpLike.groups.path) : undefined;
  }
}

export function isAbsoluteLocalPath(value: string): boolean {
  return value.trim().startsWith('/');
}

export function isRepositoryDirectoryName(value: string): boolean {
  const name = value.trim();
  return Boolean(
    name &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0'),
  );
}

export function joinRepositoryPath(parent: string, repositoryName: string): string {
  const trimmedParent = parent.replace(/\/+$/u, '');
  return `${trimmedParent || ''}/${repositoryName}`;
}

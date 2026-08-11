import { FolderGit2 } from 'lucide-react';
import { useState } from 'react';

export interface RepositoryListItem {
  path: string;
  name: string;
  logoUrl?: string;
}

export interface RepositoryLogoProps {
  logoUrl?: string | undefined;
}

export function RepositoryLogo({ logoUrl }: RepositoryLogoProps) {
  const [failedUrl, setFailedUrl] = useState<string>();

  return logoUrl && failedUrl !== logoUrl ? (
    <img
      className="repository-logo"
      src={logoUrl}
      alt=""
      aria-hidden="true"
      onError={() => setFailedUrl(logoUrl)}
    />
  ) : (
    <FolderGit2 className="repository-logo-fallback" aria-hidden="true" focusable="false" />
  );
}

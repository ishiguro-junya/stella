import {
  ArrowRight,
  Binary,
  FilePenLine,
  FilePlus2,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import type { ChangeEntry } from '../domain/workspace';

export type FileStatus = ChangeEntry['status'];

const STATUS_ICONS: Record<FileStatus, LucideIcon> = {
  added: FilePlus2,
  modified: FilePenLine,
  deleted: Trash2,
  renamed: ArrowRight,
  binary: Binary,
  conflicted: TriangleAlert,
};

export function FileStatusIcon({ status }: { status: FileStatus }) {
  const StatusIcon = STATUS_ICONS[status];
  return (
    <span className={`file-status ${status}`} aria-hidden="true">
      <StatusIcon />
    </span>
  );
}

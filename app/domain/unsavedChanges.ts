export type UnsavedRelocationDraft =
  | { kind: 'file'; path: string; baseHash: string; text: string }
  | { kind: 'conflict'; path: string; baseHash: string; text: string };

export interface UnsavedChangesHandle {
  save: () => Promise<boolean>;
  relocationDraft?: () => UnsavedRelocationDraft;
}

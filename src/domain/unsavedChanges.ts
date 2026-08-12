export interface UnsavedChangesHandle {
  save: () => Promise<boolean>;
}

import type { ConventionalCommitInput } from './workspace';
import type { MessageKey } from '../i18n/messages';

export const DEFAULT_COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

export type CommitFieldErrors = Partial<
  Record<'type' | 'scope' | 'description' | 'body' | 'footer', MessageKey>
>;

const TYPE_PATTERN = /^[a-z]+$/u;
const SCOPE_PATTERN = /^[^()\r\n]+$/u;
const HEADER_PATTERN = /^[a-z]+(?:\([^()\r\n]+\))?!?: .+$/u;

export function validateCommitInput(input: ConventionalCommitInput): CommitFieldErrors {
  const errors: CommitFieldErrors = {};
  const type = input.type.trim();
  const scope = input.scope?.trim() ?? '';
  const description = input.description.trim();

  if (!TYPE_PATTERN.test(type)) {
    errors.type = 'commitTypeLowercase';
  }
  if (scope && !SCOPE_PATTERN.test(scope)) {
    errors.scope = 'commitScopeInvalid';
  }
  if (!description) {
    errors.description = 'commitDescriptionRequired';
  }
  if (/\r/u.test(input.body ?? '')) {
    errors.body = 'commitBodyLf';
  }
  if (/\r/u.test(input.footer ?? '')) {
    errors.footer = 'commitFooterLf';
  } else if (
    input.footer?.trim() &&
    !/^([^:\r\n]+):\s*.+(?:\n[\s\S]*)?$/u.test(input.footer.trim())
  ) {
    errors.footer = 'commitFooterFormat';
  }

  return errors;
}

export function hasCommitErrors(errors: CommitFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function composeCommitMessage(input: ConventionalCommitInput): string {
  const type = input.type.trim();
  const scope = input.scope?.trim();
  const suffix = input.breaking ? '!' : '';
  const header = `${type}${scope ? `(${scope})` : ''}${suffix}: ${input.description.trim()}`;
  const sections = [header];
  const body = input.body?.trim();
  const footer = input.footer?.trim();

  if (body) sections.push(body);
  if (footer) sections.push(footer);

  return sections.join('\n\n');
}

export function isValidConventionalCommitMessage(message: string): boolean {
  const [header = ''] = message.split('\n', 1);
  return HEADER_PATTERN.test(header);
}

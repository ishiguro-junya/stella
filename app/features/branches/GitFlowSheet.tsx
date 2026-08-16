import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import type {
  GitFlowCommand,
  GitFlowOverview,
  GitFlowRequest,
  GitFlowStrategy,
} from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { SelectControl } from '../../ui/SelectControl';

/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通ダイアログがフォームへ`role="dialog"`を渡してフォーカスを管理する。 */

const COMMANDS: readonly GitFlowCommand[] = [
  'init',
  'start',
  'list',
  'checkout',
  'update',
  'publish',
  'track',
  'rename',
  'delete',
  'finish',
  'integrate',
  'configList',
  'configAddBase',
  'configAddTopic',
  'configEditBase',
  'configEditTopic',
  'configRenameBase',
  'configRenameTopic',
  'configDeleteBase',
  'configDeleteTopic',
  'configStatus',
  'configSync',
  'continue',
  'abort',
];

const TOPIC_COMMANDS = new Set<GitFlowCommand>([
  'start',
  'list',
  'checkout',
  'update',
  'publish',
  'track',
  'rename',
  'delete',
  'finish',
]);
const NAME_COMMANDS = new Set<GitFlowCommand>([
  'start',
  'checkout',
  'update',
  'publish',
  'track',
  'rename',
  'delete',
  'finish',
  'integrate',
  'configAddBase',
  'configAddTopic',
  'configEditBase',
  'configEditTopic',
  'configRenameBase',
  'configRenameTopic',
  'configDeleteBase',
  'configDeleteTopic',
]);
const SECONDARY_NAME_COMMANDS = new Set<GitFlowCommand>([
  'rename',
  'configRenameBase',
  'configRenameTopic',
]);
const CONFIG_MUTATIONS = new Set<GitFlowCommand>([
  'configAddBase',
  'configAddTopic',
  'configEditBase',
  'configEditTopic',
]);
const FINISH_COMMANDS = new Set<GitFlowCommand>(['finish', 'integrate']);
const FETCH_COMMANDS = new Set<GitFlowCommand>([
  'start',
  'update',
  'delete',
  'finish',
  'integrate',
]);

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function isGitFlowCommand(value: string): value is GitFlowCommand {
  return COMMANDS.some((command) => command === value);
}

function overviewValue(value: unknown, aliases: readonly string[]): string | undefined {
  const target = new Set(aliases.map((alias) => alias.replaceAll(/[-_]/gu, '').toLowerCase()));
  const queue: unknown[] = [value];
  while (queue.length) {
    const current = queue.shift();
    const object = record(current);
    if (!object) continue;
    for (const [key, child] of Object.entries(object)) {
      if (target.has(key.replaceAll(/[-_]/gu, '').toLowerCase())) {
        if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean')
          return String(child);
      }
      if (record(child)) queue.push(child);
    }
  }
  return undefined;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function commandLabel(command: GitFlowCommand): string {
  const config = /^config([A-Z].*)$/u.exec(command);
  if (!config?.[1]) return command;
  return `config ${config[1]
    .replaceAll(/([A-Z])/gu, ' $1')
    .trim()
    .toLowerCase()}`;
}

interface GitFlowFormState {
  command: GitFlowCommand;
  topicType: string;
  name: string;
  secondaryName: string;
  parent: string;
  base: string;
  preset: NonNullable<GitFlowRequest['preset']>;
  shared: boolean;
  fetch: boolean;
  remote: boolean;
  tagName: string;
  tagMessage: string;
  sign: boolean;
  signingKey: string;
  keep: boolean;
  push: boolean;
  strategy: GitFlowStrategy;
  downstreamStrategy: Exclude<GitFlowStrategy, 'squash'>;
  prefix: string;
  startingPoint: string;
  autoUpdate: '' | 'true' | 'false';
  tag: '' | 'true' | 'false';
}

const INITIAL_FORM: GitFlowFormState = {
  command: 'init',
  topicType: 'feature',
  name: '',
  secondaryName: '',
  parent: '',
  base: '',
  preset: 'classic',
  shared: false,
  fetch: true,
  remote: false,
  tagName: '',
  tagMessage: '',
  sign: false,
  signingKey: '',
  keep: false,
  push: false,
  strategy: 'merge',
  downstreamStrategy: 'merge',
  prefix: '',
  startingPoint: '',
  autoUpdate: '',
  tag: '',
};

export interface GitFlowSheetProps {
  overview?: GitFlowOverview;
  loading?: boolean;
  busy?: boolean;
  error?: string;
  gpgAvailable?: boolean;
  onDismiss: () => void;
  onRun: (request: GitFlowRequest) => void;
  onReload: () => void;
}

export function GitFlowSheet({
  overview,
  loading = false,
  busy = false,
  error,
  gpgAvailable = false,
  onDismiss,
  onRun,
  onReload,
}: GitFlowSheetProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<GitFlowFormState>(INITIAL_FORM);
  const overviewFields = useMemo(
    () => ({
      health: overviewValue(overview?.raw, ['health', 'status']),
      base: overviewValue(overview?.raw, ['baseBranch', 'base', 'parent']),
      topic: overviewValue(overview?.raw, ['topicType', 'type']),
      active: overviewValue(overview?.raw, ['activeBranch', 'currentBranch', 'branch']),
    }),
    [overview],
  );
  const command = form.command;
  const resumable = command === 'continue' || command === 'abort';
  const configMutation = CONFIG_MUTATIONS.has(command);
  const topicConfig = command.endsWith('Topic');

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const request: GitFlowRequest = {
      command,
      shared: form.shared,
      fetch: form.fetch,
      remote: form.remote,
      sign: form.sign && gpgAvailable,
      keep: form.keep,
      push: form.push,
      ...(command === 'init' ? { preset: form.preset } : {}),
      ...(FINISH_COMMANDS.has(command) || command === 'update' || configMutation
        ? { strategy: form.strategy }
        : {}),
      ...(configMutation ? { downstreamStrategy: form.downstreamStrategy } : {}),
      ...(form.autoUpdate ? { autoUpdate: form.autoUpdate === 'true' } : {}),
      ...(form.tag ? { tag: form.tag === 'true' } : {}),
    };
    const optionalFields: Array<[keyof GitFlowRequest, string | undefined]> = [
      ['topicType', TOPIC_COMMANDS.has(command) ? optional(form.topicType) : undefined],
      ['name', resumable ? undefined : optional(form.name)],
      ['secondaryName', optional(form.secondaryName)],
      ['parent', optional(form.parent)],
      ['base', optional(form.base)],
      ['tagName', optional(form.tagName)],
      ['tagMessage', optional(form.tagMessage)],
      ['signingKey', form.sign ? optional(form.signingKey) : undefined],
      ['prefix', optional(form.prefix)],
      ['startingPoint', optional(form.startingPoint)],
    ];
    for (const [key, value] of optionalFields) {
      if (value) Object.assign(request, { [key]: value });
    }
    onRun(request);
  };

  const field = (name: keyof GitFlowFormState, value: string | boolean): void =>
    setForm((current) => ({ ...current, [name]: value }));

  return (
    <Dialog
      labelledBy="git-flow-sheet-title"
      describedBy="git-flow-sheet-description"
      role="dialog"
      dismissible={!busy}
      onDismiss={onDismiss}
      onSubmit={submit}
    >
      <DialogHeader
        titleId="git-flow-sheet-title"
        title={t('gitFlowTitle')}
        descriptionId="git-flow-sheet-description"
        description={t('gitFlowDescription')}
      />
      <DialogBody>
        <section
          className="git-flow-overview"
          aria-labelledby="git-flow-overview-title"
          aria-busy={loading}
        >
          <div className="git-flow-section-header">
            <h3 id="git-flow-overview-title">{t('gitFlowOverview')}</h3>
            <Button type="button" onClick={onReload} disabled={loading || busy}>
              {t('reload')}
            </Button>
          </div>
          {loading ? (
            <LoadingIndicator className="git-flow-overview-loading" />
          ) : overview?.available ? (
            <dl>
              <div>
                <dt>{t('gitFlowHealth')}</dt>
                <dd>
                  {overview.initialized
                    ? (overviewFields.health ?? t('available'))
                    : t('notInitialized')}
                </dd>
              </div>
              <div>
                <dt>{t('gitFlowBaseBranch')}</dt>
                <dd>{overviewFields.base ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('gitFlowTopicType')}</dt>
                <dd>{overviewFields.topic ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('gitFlowActiveBranch')}</dt>
                <dd>{overviewFields.active ?? '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="settings-error">{overview?.output || error || t('gitFlowUnavailable')}</p>
          )}
          {error ? <p className="settings-error">{error}</p> : null}
        </section>

        <section className="git-flow-operation" aria-labelledby="git-flow-operation-title">
          <h3 id="git-flow-operation-title">{t('gitFlowOperation')}</h3>
          <div className="git-flow-fields">
            <label>
              <span>{t('gitFlowCommand')}</span>
              <SelectControl
                data-dialog-initial-focus
                value={command}
                onChange={(event) => {
                  if (isGitFlowCommand(event.target.value)) field('command', event.target.value);
                }}
              >
                {COMMANDS.map((value) => (
                  <option key={value} value={value}>
                    {commandLabel(value)}
                  </option>
                ))}
              </SelectControl>
            </label>

            {command === 'init' ? (
              <>
                <label>
                  <span>{t('gitFlowPreset')}</span>
                  <SelectControl
                    value={form.preset}
                    onChange={(event) => field('preset', event.target.value)}
                  >
                    <option value="classic">Classic</option>
                    <option value="github">GitHub</option>
                    <option value="gitlab">GitLab</option>
                    <option value="custom">Custom (defaults + config)</option>
                  </SelectControl>
                </label>
                <label className="checkbox-field git-flow-check">
                  <Input
                    type="checkbox"
                    checked={form.shared}
                    onChange={(event) => field('shared', event.target.checked)}
                  />
                  <span>{t('gitFlowSharedConfig')}</span>
                </label>
              </>
            ) : null}

            {TOPIC_COMMANDS.has(command) ? (
              <label>
                <span>{t('gitFlowTopicType')}</span>
                <Input
                  value={form.topicType}
                  onChange={(event) => field('topicType', event.target.value)}
                  required
                />
              </label>
            ) : null}

            {!resumable && NAME_COMMANDS.has(command) ? (
              <label>
                <span>{t('gitFlowName')}</span>
                <Input
                  value={form.name}
                  onChange={(event) => field('name', event.target.value)}
                  required={!['list', 'update', 'publish', 'finish', 'integrate'].includes(command)}
                />
              </label>
            ) : null}

            {SECONDARY_NAME_COMMANDS.has(command) ? (
              <label>
                <span>{t('gitFlowNewName')}</span>
                <Input
                  value={form.secondaryName}
                  onChange={(event) => field('secondaryName', event.target.value)}
                  required
                />
              </label>
            ) : null}

            {command === 'start' ? (
              <label>
                <span>{t('gitFlowBaseBranch')}</span>
                <Input value={form.base} onChange={(event) => field('base', event.target.value)} />
              </label>
            ) : null}

            {CONFIG_MUTATIONS.has(command) ? (
              <>
                {command === 'configAddBase' || command === 'configAddTopic' ? (
                  <label>
                    <span>{t('gitFlowParent')}</span>
                    <Input
                      value={form.parent}
                      onChange={(event) => field('parent', event.target.value)}
                      required={command === 'configAddTopic'}
                    />
                  </label>
                ) : null}
                {topicConfig ? (
                  <>
                    <label>
                      <span>{t('gitFlowPrefix')}</span>
                      <Input
                        value={form.prefix}
                        onChange={(event) => field('prefix', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>{t('gitFlowStartingPoint')}</span>
                      <Input
                        value={form.startingPoint}
                        onChange={(event) => field('startingPoint', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>{t('tag')}</span>
                      <SelectControl
                        value={form.tag}
                        onChange={(event) => field('tag', event.target.value)}
                      >
                        <option value="">{t('gitFlowUseDefault')}</option>
                        <option value="true">{t('enabled')}</option>
                        <option value="false">{t('disabled')}</option>
                      </SelectControl>
                    </label>
                  </>
                ) : (
                  <label>
                    <span>{t('gitFlowAutoUpdate')}</span>
                    <SelectControl
                      value={form.autoUpdate}
                      onChange={(event) => field('autoUpdate', event.target.value)}
                    >
                      <option value="">{t('gitFlowUseDefault')}</option>
                      <option value="true">{t('enabled')}</option>
                      <option value="false">{t('disabled')}</option>
                    </SelectControl>
                  </label>
                )}
                <label>
                  <span>{t('gitFlowDownstreamStrategy')}</span>
                  <SelectControl
                    value={form.downstreamStrategy}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === 'merge' || value === 'rebase') {
                        field('downstreamStrategy', value);
                      }
                    }}
                  >
                    <option value="merge">{t('merge')}</option>
                    <option value="rebase">{t('rebase')}</option>
                  </SelectControl>
                </label>
                <label className="checkbox-field git-flow-check">
                  <Input
                    type="checkbox"
                    checked={form.shared}
                    onChange={(event) => field('shared', event.target.checked)}
                  />
                  <span>{t('gitFlowSharedConfig')}</span>
                </label>
              </>
            ) : null}

            {FETCH_COMMANDS.has(command) ? (
              <label className="checkbox-field git-flow-check">
                <Input
                  type="checkbox"
                  checked={form.fetch}
                  onChange={(event) => field('fetch', event.target.checked)}
                />
                <span>{t('fetch')}</span>
              </label>
            ) : null}

            {command === 'delete' ? (
              <label className="checkbox-field git-flow-check">
                <Input
                  type="checkbox"
                  checked={form.remote}
                  onChange={(event) => field('remote', event.target.checked)}
                />
                <span>{t('gitFlowDeleteRemote')}</span>
              </label>
            ) : null}

            {FINISH_COMMANDS.has(command) || command === 'update' || configMutation ? (
              <label>
                <span>{t(command === 'update' ? 'gitFlowUpdateStrategy' : 'gitFlowStrategy')}</span>
                <SelectControl
                  value={form.strategy}
                  onChange={(event) => field('strategy', event.target.value)}
                >
                  <option value="merge">
                    {command === 'update' ? t('gitFlowConfiguredStrategy') : t('merge')}
                  </option>
                  <option value="rebase">{t('rebase')}</option>
                  {command === 'update' ? null : <option value="squash">{t('squash')}</option>}
                </SelectControl>
              </label>
            ) : null}

            {FINISH_COMMANDS.has(command) ? (
              <>
                <label>
                  <span>{t('gitFlowTagName')}</span>
                  <Input
                    value={form.tagName}
                    onChange={(event) => field('tagName', event.target.value)}
                  />
                </label>
                <label>
                  <span>{t('gitFlowTagMessage')}</span>
                  <Input
                    value={form.tagMessage}
                    onChange={(event) => field('tagMessage', event.target.value)}
                  />
                </label>
                <label className="checkbox-field git-flow-check">
                  <Input
                    type="checkbox"
                    checked={form.sign}
                    disabled={!gpgAvailable || !form.tagName}
                    onChange={(event) => field('sign', event.target.checked)}
                  />
                  <span>{t('gitFlowSignTag')}</span>
                </label>
                {form.sign ? (
                  <label>
                    <span>{t('gitFlowSigningKey')}</span>
                    <Input
                      value={form.signingKey}
                      onChange={(event) => field('signingKey', event.target.value)}
                    />
                  </label>
                ) : null}
                {command === 'finish' ? (
                  <>
                    <label className="checkbox-field git-flow-check">
                      <Input
                        type="checkbox"
                        checked={form.keep}
                        onChange={(event) => field('keep', event.target.checked)}
                      />
                      <span>{t('gitFlowKeepBranch')}</span>
                    </label>
                    <label className="checkbox-field git-flow-check">
                      <Input
                        type="checkbox"
                        checked={form.push}
                        onChange={(event) => field('push', event.target.checked)}
                      />
                      <span>{t('gitFlowPushAfterFinish')}</span>
                    </label>
                  </>
                ) : null}
                {!gpgAvailable ? <p className="field-hint">{t('gitFlowGpgUnavailable')}</p> : null}
              </>
            ) : null}
          </div>
        </section>
      </DialogBody>

      <DialogFooter>
        <Button type="button" onClick={onDismiss} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={busy || !overview?.available}
        >
          {t('run')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

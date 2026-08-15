import { Image as ImageIcon, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ImageBytesTarget, ImageChangeKind, ImageDiffCandidate } from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import { Button } from '../../ui/Button';

interface ImagePreviewToggleProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

export function ImagePreviewToggle({ pressed, onPressedChange }: ImagePreviewToggleProps) {
  const { t } = useI18n();
  return (
    <Button
      type="button"
      variant="quiet"
      className="image-preview-toggle"
      aria-label={t('imagePreview')}
      tooltip={t('imagePreview')}
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
    >
      <ImageIcon aria-hidden="true" focusable="false" size={14} />
    </Button>
  );
}

interface ImageDiffPreviewProps {
  adapter: WorkspaceAdapter;
  repoId: string;
  target: ImageBytesTarget;
  candidate: ImageDiffCandidate;
  binaryFallback?: string;
  hidden?: boolean;
  onProbeResult?: (previewable: boolean) => void;
}

type ImageSide = 'before' | 'after';
type SideState = { status: 'loading' } | { status: 'loaded'; url: string } | { status: 'error' };

function hasSide(changeKind: ImageChangeKind, side: ImageSide): boolean {
  return side === 'before' ? changeKind !== 'added' : changeKind !== 'deleted';
}

function sidePath(path: string, previousPath: string | undefined, side: ImageSide): string {
  return side === 'before' ? (previousPath ?? path) : path;
}

function imageMimeType(path: string): string {
  return path.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : '';
}

export function ImageDiffPreview({
  adapter,
  repoId,
  target,
  candidate,
  binaryFallback,
  hidden = false,
  onProbeResult,
}: ImageDiffPreviewProps) {
  const { t } = useI18n();
  const [sides, setSides] = useState<Partial<Record<ImageSide, SideState>>>({});
  const targetKind = target.kind;
  const targetPath = target.path;
  const targetPreviousPath = target.previousPath;
  const targetDiffId = target.diffId;
  const targetArea = target.kind === 'changes' ? target.area : undefined;
  const targetGeneration = target.kind === 'changes' ? target.generation : undefined;
  const targetOid = target.kind === 'commit' ? target.oid : undefined;

  useEffect(() => {
    let cancelled = false;
    const objectUrls = new Set<string>();
    const availableSides = (['before', 'after'] as const).filter((side) =>
      hasSide(candidate.changeKind, side),
    );
    setSides(Object.fromEntries(availableSides.map((side) => [side, { status: 'loading' }])));

    const load = async (side: ImageSide): Promise<void> => {
      let objectUrl: string | undefined;
      try {
        const queryTarget: ImageBytesTarget =
          targetKind === 'changes'
            ? {
                kind: 'changes',
                path: targetPath,
                ...(targetPreviousPath ? { previousPath: targetPreviousPath } : {}),
                area: targetArea!,
                generation: targetGeneration!,
                diffId: targetDiffId,
              }
            : {
                kind: 'commit',
                oid: targetOid!,
                path: targetPath,
                ...(targetPreviousPath ? { previousPath: targetPreviousPath } : {}),
                diffId: targetDiffId,
              };
        const result = await adapter.query({
          kind: 'imageBytes',
          repoId,
          target: queryTarget,
          side,
        });
        if (cancelled) return;
        if (result.kind !== 'imageBytes') throw new Error('Invalid image response.');
        const bytes = Uint8Array.from(result.bytes);
        objectUrl = URL.createObjectURL(
          new Blob([bytes.buffer], {
            type: imageMimeType(sidePath(candidate.path, candidate.previousPath, side)),
          }),
        );
        objectUrls.add(objectUrl);
        const image = new window.Image();
        image.src = objectUrl;
        await image.decode();
        if (cancelled) return;
        setSides((current) => ({ ...current, [side]: { status: 'loaded', url: objectUrl! } }));
      } catch {
        if (objectUrl && objectUrls.delete(objectUrl)) URL.revokeObjectURL(objectUrl);
        if (cancelled) return;
        setSides((current) => ({ ...current, [side]: { status: 'error' } }));
      }
    };

    for (const side of availableSides) void load(side);
    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [
    adapter,
    candidate.changeKind,
    candidate.path,
    candidate.previousPath,
    repoId,
    targetArea,
    targetDiffId,
    targetGeneration,
    targetKind,
    targetOid,
    targetPath,
    targetPreviousPath,
  ]);

  const availableStates = (['before', 'after'] as const)
    .filter((side) => hasSide(candidate.changeKind, side))
    .map((side) => sides[side]);
  const beforeStatus = sides.before?.status;
  const afterStatus = sides.after?.status;
  const probeComplete =
    availableStates.length > 0 &&
    availableStates.every((state) => state && state.status !== 'loading');
  const probePreviewable = availableStates.some((state) => state?.status === 'loaded');

  useEffect(() => {
    if (candidate.format === 'probe' && onProbeResult && probeComplete)
      onProbeResult(probePreviewable);
  }, [afterStatus, beforeStatus, candidate.format, onProbeResult, probeComplete, probePreviewable]);

  if (hidden) return null;
  if (
    (candidate.format === 'binary' || candidate.format === 'probe') &&
    availableStates.length > 0 &&
    availableStates.every((state) => state?.status === 'error')
  ) {
    if (candidate.format === 'probe') return null;
    return <p className="empty-state-small">{binaryFallback ?? t('binaryWholeFileOnly')}</p>;
  }

  return (
    <div className="image-diff-preview" aria-label={t('imagePreview')}>
      {(['before', 'after'] as const).map((side) => {
        const state = sides[side];
        if (!state) return null;
        const path = sidePath(candidate.path, candidate.previousPath, side);
        const label = t(side === 'before' ? 'imageBefore' : 'imageAfter');
        return (
          <figure key={side} className="image-diff-side">
            <figcaption>
              <span>{label}</span>
              {candidate.previousPath ? <code>{path}</code> : null}
            </figcaption>
            <div className="image-diff-canvas">
              {state.status === 'loading' ? (
                <output className="image-preview-status">
                  <LoaderCircle className="spin" aria-hidden="true" />
                  {t('imagePreviewLoading')}
                </output>
              ) : state.status === 'error' ? (
                <p className="image-preview-status">{t('imagePreviewUnavailable')}</p>
              ) : (
                <img
                  src={state.url}
                  alt={t('imagePreviewAlt', { label, path })}
                  draggable={false}
                />
              )}
            </div>
          </figure>
        );
      })}
    </div>
  );
}

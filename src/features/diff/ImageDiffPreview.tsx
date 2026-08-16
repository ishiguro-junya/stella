import { Image as ImageIcon, ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import type {
  DiffStyle,
  ImageBytesTarget,
  ImageChangeKind,
  ImageDiffCandidate,
} from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import { ToggleButton } from '../../ui/ToggleButton';

interface ImagePreviewToggleProps {
  pressed: boolean;
  disabled?: boolean | undefined;
  onPressedChange: (pressed: boolean) => void;
}

export function ImagePreviewToggle({
  pressed,
  disabled = false,
  onPressedChange,
}: ImagePreviewToggleProps) {
  const { t } = useI18n();
  return (
    <ToggleButton
      className="image-preview-toggle"
      aria-label={t('imagePreview')}
      tooltip={t('imagePreviewToggle')}
      pressed={pressed}
      disabled={disabled}
      offIcon={ImageOff}
      onIcon={ImageIcon}
      reverseIcons
      onPressedChange={onPressedChange}
    />
  );
}

interface ImageDiffPreviewProps {
  adapter: WorkspaceAdapter;
  repoId: string;
  target: ImageBytesTarget;
  candidate: ImageDiffCandidate;
  binaryFallback?: string;
  hidden?: boolean;
  layout?: DiffStyle;
  onProbeResult?: (previewable: boolean) => void;
}

type ImageSide = 'before' | 'after';
type ImagePreviewBackground = 'light' | 'dark';
type SideState =
  | { status: 'loading' }
  | { status: 'loaded'; url: string; background?: ImagePreviewBackground }
  | { status: 'error' };

const IMAGE_SAMPLE_EDGE = 32;

function hasSide(changeKind: ImageChangeKind, side: ImageSide): boolean {
  return side === 'before' ? changeKind !== 'added' : changeKind !== 'deleted';
}

function sidePath(path: string, previousPath: string | undefined, side: ImageSide): string {
  return side === 'before' ? (previousPath ?? path) : path;
}

function imageMimeType(path: string): string {
  return path.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : '';
}

function linearColorChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function imagePreviewBackgroundForPixels(
  pixels: Uint8ClampedArray,
): ImagePreviewBackground | undefined {
  let luminanceTotal = 0;
  let alphaTotal = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = (pixels[index + 3] ?? 0) / 255;
    if (alpha === 0) continue;
    const luminance =
      0.2126 * linearColorChannel(pixels[index] ?? 0) +
      0.7152 * linearColorChannel(pixels[index + 1] ?? 0) +
      0.0722 * linearColorChannel(pixels[index + 2] ?? 0);
    luminanceTotal += luminance * alpha;
    alphaTotal += alpha;
  }

  if (alphaTotal === 0) return undefined;
  return luminanceTotal / alphaTotal < 0.5 ? 'light' : 'dark';
}

function imagePreviewBackground(image: HTMLImageElement): ImagePreviewBackground | undefined {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  if (!naturalWidth || !naturalHeight) return undefined;

  try {
    const scale = Math.min(1, IMAGE_SAMPLE_EDGE / naturalWidth, IMAGE_SAMPLE_EDGE / naturalHeight);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    return imagePreviewBackgroundForPixels(pixels);
  } catch {
    return undefined;
  }
}

export function ImageDiffPreview({
  adapter,
  repoId,
  target,
  candidate,
  binaryFallback,
  hidden = false,
  layout = 'split',
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
        const background = imagePreviewBackground(image);
        setSides((current) => ({
          ...current,
          [side]: {
            status: 'loaded',
            url: objectUrl!,
            ...(background ? { background } : {}),
          },
        }));
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
  const singleSide = availableStates.length === 1;

  useEffect(() => {
    if (onProbeResult && probeComplete) onProbeResult(probePreviewable);
  }, [afterStatus, beforeStatus, onProbeResult, probeComplete, probePreviewable]);

  if (hidden || !probeComplete) return null;
  if (
    (candidate.format === 'binary' || candidate.format === 'probe') &&
    availableStates.length > 0 &&
    availableStates.every((state) => state?.status === 'error')
  ) {
    if (candidate.format === 'probe') return null;
    return <p className="empty-state-small">{binaryFallback ?? t('binaryWholeFileOnly')}</p>;
  }

  return (
    <div
      className="image-diff-preview"
      data-layout={layout}
      data-single-side={singleSide || undefined}
      aria-label={t('imagePreview')}
    >
      {(['before', 'after'] as const).map((side) => {
        const state = sides[side];
        if (!state || state.status === 'loading') return null;
        const path = sidePath(candidate.path, candidate.previousPath, side);
        const label = t(side === 'before' ? 'imageBefore' : 'imageAfter');
        return (
          <figure key={side} className="image-diff-side" data-side={side}>
            {!singleSide ? (
              <figcaption>
                <span>{label}</span>
                {candidate.previousPath ? <code>{path}</code> : null}
              </figcaption>
            ) : null}
            <div
              className="image-diff-canvas"
              data-image-background={state.status === 'loaded' ? state.background : undefined}
            >
              {state.status === 'error' ? (
                <p className="image-preview-status">{t('imagePreviewUnavailable')}</p>
              ) : (
                <span className="image-diff-image-surface">
                  <img
                    src={state.url}
                    alt={t(singleSide ? 'imageSinglePreviewAlt' : 'imagePreviewAlt', {
                      label,
                      path,
                    })}
                    draggable={false}
                  />
                </span>
              )}
            </div>
          </figure>
        );
      })}
    </div>
  );
}

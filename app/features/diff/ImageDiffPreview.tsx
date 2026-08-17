import { Image as ImageIcon, ImageOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
  const [displayedCandidate, setDisplayedCandidate] = useState(candidate);
  const targetKind = target.kind;
  const targetPath = target.path;
  const targetPreviousPath = target.previousPath;
  const targetDiffId = target.diffId;
  const targetArea = target.kind === 'workingTree' ? target.area : undefined;
  const targetGeneration = target.kind === 'workingTree' ? target.generation : undefined;
  const targetOid = target.kind === 'commit' ? target.oid : undefined;
  const targetKey = `${targetKind}:${targetDiffId}:${targetPath}`;
  const candidatePath = candidate.path;
  const candidatePreviousPath = candidate.previousPath;
  const candidateChangeKind = candidate.changeKind;
  const candidateFormat = candidate.format;
  const [displayedTargetKey, setDisplayedTargetKey] = useState(targetKey);
  const displayedUrlsRef = useRef<Set<string>>(new Set());
  const onProbeResultRef = useRef(onProbeResult);
  onProbeResultRef.current = onProbeResult;

  useEffect(() => {
    let cancelled = false;
    let committed = false;
    const objectUrls = new Set<string>();
    const availableSides = (['before', 'after'] as const).filter((side) =>
      hasSide(candidateChangeKind, side),
    );

    const load = async (side: ImageSide): Promise<[ImageSide, SideState]> => {
      let objectUrl: string | undefined;
      try {
        const queryTarget: ImageBytesTarget =
          targetKind === 'workingTree'
            ? {
                kind: 'workingTree',
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
        if (cancelled) return [side, { status: 'error' }];
        if (result.kind !== 'imageBytes') throw new Error('Invalid image response.');
        const bytes = Uint8Array.from(result.bytes);
        objectUrl = URL.createObjectURL(
          new Blob([bytes.buffer], {
            type: imageMimeType(sidePath(candidatePath, candidatePreviousPath, side)),
          }),
        );
        objectUrls.add(objectUrl);
        const image = new window.Image();
        image.src = objectUrl;
        await image.decode();
        if (cancelled) return [side, { status: 'error' }];
        const background = imagePreviewBackground(image);
        return [
          side,
          {
            status: 'loaded',
            url: objectUrl,
            ...(background ? { background } : {}),
          },
        ];
      } catch {
        if (objectUrl && objectUrls.delete(objectUrl)) URL.revokeObjectURL(objectUrl);
        return [side, { status: 'error' }];
      }
    };

    void Promise.all(availableSides.map(load)).then((entries) => {
      if (cancelled) return;
      committed = true;
      const nextSides: Partial<Record<ImageSide, SideState>> = Object.fromEntries(entries);
      const previousUrls = displayedUrlsRef.current;
      displayedUrlsRef.current = objectUrls;
      setDisplayedCandidate({
        path: candidatePath,
        ...(candidatePreviousPath ? { previousPath: candidatePreviousPath } : {}),
        changeKind: candidateChangeKind,
        format: candidateFormat,
      });
      setDisplayedTargetKey(targetKey);
      setSides(nextSides);
      onProbeResultRef.current?.(
        Object.values(nextSides).some((state) => state.status === 'loaded'),
      );
      for (const url of previousUrls) URL.revokeObjectURL(url);
    });
    return () => {
      cancelled = true;
      if (!committed) for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [
    adapter,
    candidateChangeKind,
    candidateFormat,
    candidatePath,
    candidatePreviousPath,
    repoId,
    targetArea,
    targetDiffId,
    targetGeneration,
    targetKey,
    targetKind,
    targetOid,
    targetPath,
    targetPreviousPath,
  ]);

  useEffect(
    () => () => {
      for (const url of displayedUrlsRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const availableStates = (['before', 'after'] as const)
    .filter((side) => hasSide(displayedCandidate.changeKind, side))
    .map((side) => sides[side]);
  const probeComplete =
    availableStates.length > 0 &&
    availableStates.every((state) => state && state.status !== 'loading');
  const singleSide = availableStates.length === 1;

  if ((hidden && displayedTargetKey === targetKey) || !probeComplete) return null;
  if (
    (displayedCandidate.format === 'binary' || displayedCandidate.format === 'probe') &&
    availableStates.length > 0 &&
    availableStates.every((state) => state?.status === 'error')
  ) {
    if (displayedCandidate.format === 'probe') return null;
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
        const path = sidePath(displayedCandidate.path, displayedCandidate.previousPath, side);
        const label = t(side === 'before' ? 'imageBefore' : 'imageAfter');
        return (
          <figure key={side} className="image-diff-side" data-side={side}>
            {!singleSide ? (
              <figcaption>
                <span>{label}</span>
                {displayedCandidate.previousPath ? <code>{path}</code> : null}
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

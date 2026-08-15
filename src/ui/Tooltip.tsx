import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';

interface TooltipTriggerProps {
  'aria-describedby'?: string | undefined;
  title?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLElement> | undefined;
  onClick?: MouseEventHandler<HTMLElement> | undefined;
}

export interface TooltipProps {
  content: string;
  children: ReactElement<TooltipTriggerProps>;
}

type TooltipSide = 'top' | 'bottom';

interface TooltipPosition {
  left: number;
  top: number;
  arrowLeft: number;
  side: TooltipSide;
}

type TooltipStyle = CSSProperties & { '--tooltip-arrow-left': string };

const HOVER_DELAY = 300;
const VIEWPORT_MARGIN = 8;
const TOOLTIP_GAP = 8;
const ARROW_MARGIN = 10;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function Tooltip({ content, children }: TooltipProps) {
  const tooltipId = useId();
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);
  const [anchor, setAnchor] = useState<HTMLElement>();
  const [tooltipNode, setTooltipNode] = useState<HTMLSpanElement | null>(null);
  const [position, setPosition] = useState<TooltipPosition>();

  const clearHoverTimer = useCallback((): void => {
    if (hoverTimerRef.current === undefined) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = undefined;
  }, []);

  const close = useCallback((): void => {
    clearHoverTimer();
    setAnchor(undefined);
    setPosition(undefined);
  }, [clearHoverTimer]);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  useLayoutEffect(() => {
    if (!anchor || !tooltipNode) return undefined;

    const positionTooltip = (): void => {
      if (!anchor.isConnected) {
        close();
        return;
      }
      const anchorRect = anchor.getBoundingClientRect();
      const tooltipRect = tooltipNode.getBoundingClientRect();
      const spaceAbove = anchorRect.top - TOOLTIP_GAP - VIEWPORT_MARGIN;
      const spaceBelow = window.innerHeight - anchorRect.bottom - TOOLTIP_GAP - VIEWPORT_MARGIN;
      const side: TooltipSide =
        spaceAbove >= tooltipRect.height || spaceAbove >= spaceBelow ? 'top' : 'bottom';
      const maximumLeft = Math.max(
        VIEWPORT_MARGIN,
        window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN,
      );
      const left = clamp(
        anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2,
        VIEWPORT_MARGIN,
        maximumLeft,
      );
      const unclampedTop =
        side === 'top'
          ? anchorRect.top - TOOLTIP_GAP - tooltipRect.height
          : anchorRect.bottom + TOOLTIP_GAP;
      const top = clamp(
        unclampedTop,
        VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, window.innerHeight - tooltipRect.height - VIEWPORT_MARGIN),
      );
      setPosition({
        left,
        top,
        side,
        arrowLeft: clamp(
          anchorRect.left + anchorRect.width / 2 - left,
          ARROW_MARGIN,
          Math.max(ARROW_MARGIN, tooltipRect.width - ARROW_MARGIN),
        ),
      });
    };

    positionTooltip();
    document.addEventListener('scroll', positionTooltip, true);
    window.addEventListener('resize', positionTooltip);
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(positionTooltip);
    resizeObserver?.observe(document.documentElement);
    resizeObserver?.observe(anchor);
    return () => {
      document.removeEventListener('scroll', positionTooltip, true);
      window.removeEventListener('resize', positionTooltip);
      resizeObserver?.disconnect();
    };
  }, [anchor, close, content, tooltipNode]);

  const childProps = children.props;
  const describedBy = [childProps['aria-describedby'], anchor ? tooltipId : undefined]
    .filter(Boolean)
    .join(' ');
  const trigger = cloneElement(children, {
    title: undefined,
    'aria-describedby': describedBy || undefined,
    onPointerEnter: (event) => {
      childProps.onPointerEnter?.(event);
      const triggerElement = event.currentTarget;
      pointerInsideRef.current = true;
      clearHoverTimer();
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = undefined;
        if (pointerInsideRef.current) setAnchor(triggerElement);
      }, HOVER_DELAY);
    },
    onPointerLeave: (event) => {
      childProps.onPointerLeave?.(event);
      pointerInsideRef.current = false;
      clearHoverTimer();
      if (!focusInsideRef.current) close();
    },
    onPointerDown: (event) => {
      close();
      childProps.onPointerDown?.(event);
    },
    onFocus: (event) => {
      childProps.onFocus?.(event);
      focusInsideRef.current = true;
      clearHoverTimer();
      setAnchor(event.currentTarget);
    },
    onBlur: (event) => {
      childProps.onBlur?.(event);
      focusInsideRef.current = false;
      if (!pointerInsideRef.current) close();
    },
    onKeyDown: (event) => {
      if (event.key === 'Escape') close();
      childProps.onKeyDown?.(event);
    },
    onClick: (event) => {
      close();
      childProps.onClick?.(event);
    },
  });
  const tooltipStyle: TooltipStyle = {
    left: position?.left ?? 0,
    top: position?.top ?? 0,
    visibility: position ? 'visible' : 'hidden',
    '--tooltip-arrow-left': `${position?.arrowLeft ?? ARROW_MARGIN}px`,
  };

  return (
    <>
      {trigger}
      {anchor
        ? createPortal(
            <span
              ref={setTooltipNode}
              id={tooltipId}
              className="app-tooltip"
              role="tooltip"
              data-side={position?.side}
              style={tooltipStyle}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

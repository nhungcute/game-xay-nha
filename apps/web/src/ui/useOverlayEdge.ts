import { useCallback, useEffect, useRef } from 'react';

/** HUD zoom factor (hud3.css `--hud-zoom`, D034); 1 when unset. */
export function hudZoom(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-zoom')) || 1;
}

/**
 * Publish measured overlay edges so panels fit between the HUD and the actual tool dock. The value is in HUD-zoomed
 * CSS px (screen px ÷ --hud-zoom): its consumers are zoomed HUD blocks, whose own lengths the zoom multiplies again.
 */
export function useOverlayEdge(property: '--hud-bottom' | '--dock-top', edge: 'top' | 'bottom') {
  const observer = useRef<ResizeObserver | null>(null), element = useRef<HTMLElement | null>(null);
  const publish = useCallback(() => {
    if (element.current) document.documentElement.style.setProperty(property, `${Math.ceil(element.current.getBoundingClientRect()[edge] / hudZoom())}px`);
  }, [property, edge]);
  useEffect(() => {
    window.addEventListener('resize', publish);
    return () => { observer.current?.disconnect(); window.removeEventListener('resize', publish); document.documentElement.style.removeProperty(property); };
  }, [property, publish]);
  return useCallback((target: HTMLElement | null) => {
    observer.current?.disconnect(); element.current = target;
    if (!target) return;
    observer.current = new ResizeObserver(publish); observer.current.observe(target); publish();
  }, [publish]);
}

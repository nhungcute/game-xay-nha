import { useCallback, useEffect, useRef } from 'react';

/** Publish measured overlay edges so panels fit between the HUD and the actual tool dock. */
export function useOverlayEdge(property: '--hud-bottom' | '--dock-top', edge: 'top' | 'bottom') {
  const observer = useRef<ResizeObserver | null>(null), element = useRef<HTMLElement | null>(null);
  const publish = useCallback(() => {
    if (element.current) document.documentElement.style.setProperty(property, `${Math.ceil(element.current.getBoundingClientRect()[edge])}px`);
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

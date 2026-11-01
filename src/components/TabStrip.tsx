import { useCallback, useEffect, useRef } from 'react';

/**
 * Makes a `.tabs` row behave when its tabs don't fit: no scrollbar, the edge that has more tabs
 * fades out (`fade-l` / `fade-r`), the mouse wheel scrolls it sideways, and the selected tab
 * (`.on`) is scrolled into view. Use as `<div className="tabs" ref={useTabStrip()}>`.
 */
export function useTabStrip<T extends HTMLElement = HTMLDivElement>() {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;

    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.classList.toggle('fade-l', el.scrollLeft > 1);
      el.classList.toggle('fade-r', max > 1 && el.scrollLeft < max - 1);
    };
    const showSelected = () => {
      const on = el.querySelector<HTMLElement>('.on, [aria-selected="true"]');
      if (!on) return;
      const pad = 40; // keep it clear of the fade
      const left = on.offsetLeft - el.offsetLeft;
      const right = left + on.offsetWidth;
      if (left < el.scrollLeft + pad) el.scrollTo({ left: Math.max(0, left - pad), behavior: 'smooth' });
      else if (right > el.scrollLeft + el.clientWidth - pad) el.scrollTo({ left: right - el.clientWidth + pad, behavior: 'smooth' });
    };
    // a plain mouse wheel only scrolls up and down; turn that into sideways while there's room to go
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };

    el.addEventListener('scroll', update, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    // tabs come and go (admin-only ones) and the selection moves
    // (ignoring our own fade classes on the strip itself, or a manual scroll would snap back)
    const mutations = new MutationObserver((records) => {
      if (records.every((r) => r.target === el)) return;
      update();
      showSelected();
    });
    mutations.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
    update();
    showSelected();

    cleanup.current = () => {
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', onWheel);
      resize.disconnect();
      mutations.disconnect();
    };
  }, []);
}

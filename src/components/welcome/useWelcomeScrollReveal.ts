import { useCallback, useEffect, useRef } from 'react';

type RevealPosition = 'below' | 'above' | 'visible';

/**
 * Welcome-page-only bidirectional scroll reveal hook using a single IntersectionObserver
 * and DOM data attributes so scrolling never triggers React re-renders.
 */
export function useWelcomeScrollReveal() {
  const elementsRef = useRef<Set<HTMLElement>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const stateMapRef = useRef<WeakMap<Element, RevealPosition>>(new WeakMap());

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') {
      elementsRef.current.forEach((el) => {
        el.dataset.welcomeReveal = 'visible-static';
        stateMapRef.current.set(el, 'visible');
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const prevState = stateMapRef.current.get(target);

          if (entry.isIntersecting) {
            if (prevState === 'visible') continue;
            target.dataset.welcomeReveal =
              prevState === 'above' ? 'visible-from-above' : 'visible-from-below';
            stateMapRef.current.set(target, 'visible');
          } else {
            const rootTop = entry.rootBounds ? entry.rootBounds.top : 0;
            const exitedAbove = entry.boundingClientRect.top < rootTop + 4;
            const nextPos: RevealPosition = exitedAbove ? 'above' : 'below';
            stateMapRef.current.set(target, nextPos);
            target.dataset.welcomeReveal = exitedAbove ? 'hidden-above' : 'hidden-below';
          }
        }
      },
      {
        threshold: 0.04,
        rootMargin: '0px'
      }
    );

    observerRef.current = observer;

    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    elementsRef.current.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top >= viewportH) {
        stateMapRef.current.set(el, 'below');
        el.dataset.welcomeReveal = 'hidden-below';
      } else if (rect.bottom <= 0) {
        stateMapRef.current.set(el, 'above');
        el.dataset.welcomeReveal = 'hidden-above';
      } else {
        stateMapRef.current.set(el, 'visible');
        el.dataset.welcomeReveal = 'visible-from-below';
      }
      observer.observe(el);
    });

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  const registerReveal = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    if (!elementsRef.current.has(el)) {
      elementsRef.current.add(el);
      if (observerRef.current) {
        observerRef.current.observe(el);
      }
    }
  }, []);

  return registerReveal;
}

/** Keep the canvas and HUD inside the visible area after folding or rotating. */
export function trackViewport(): () => void {
  const viewport = window.visualViewport;
  const style = document.documentElement.style;
  let frame = 0;
  const update = () => {
    frame = 0;
    // Browser chrome can leave dvh/layout dimensions larger than the visible area.
    const top = viewport?.offsetTop ?? 0;
    const left = viewport?.offsetLeft ?? 0;
    style.setProperty('--viewport-height', `${Math.max(1, Math.min(window.innerHeight, viewport?.height ?? window.innerHeight))}px`);
    style.setProperty('--viewport-width', `${Math.max(1, Math.min(window.innerWidth, viewport?.width ?? window.innerWidth))}px`);
    style.setProperty('--viewport-top', `${top}px`);
    style.setProperty('--viewport-left', `${left}px`);
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };
  update();
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('pageshow', schedule);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    for (const name of ['height', 'width', 'top', 'left']) style.removeProperty(`--viewport-${name}`);
  };
}

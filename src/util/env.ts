export function isMobile(): boolean {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS reports as Macintosh but is touch-capable
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

export function hasGetUserMedia(): boolean {
  return !!navigator.mediaDevices?.getUserMedia;
}

export function hasDisplayMedia(): boolean {
  return !!navigator.mediaDevices?.getDisplayMedia && !isMobile();
}

export function hasFullscreen(): boolean {
  return !!document.documentElement.requestFullscreen;
}

export function hasWakeLock(): boolean {
  return 'wakeLock' in navigator;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

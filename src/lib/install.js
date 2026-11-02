// Tracks whether Crate can be installed to the home screen.
// Android/Chrome fires `beforeinstallprompt`; iPhone needs manual Share → Add to Home Screen.
import { useEffect, useState } from 'react';

let deferred = null;
const subs = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; subs.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; subs.forEach((f) => f()); });
}

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isMobile = () => isIOS() || /android/i.test(navigator.userAgent);

export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => subs.delete(f); }, []);
  return {
    installed: isStandalone(),
    canPrompt: !!deferred,
    ios: isIOS(),
    async prompt() {
      if (!deferred) return false;
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      return outcome === 'accepted';
    },
  };
}

export const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

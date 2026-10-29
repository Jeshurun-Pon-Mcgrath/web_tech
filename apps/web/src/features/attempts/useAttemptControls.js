import { useEffect, useRef, useState } from 'react';
import { attemptControls } from '@examledger/contracts';

export function useAttemptControls(attempt) {
  const controls = attemptControls(attempt?.attemptControls);
  const active = attempt?.status === 'active';
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [error, setError] = useState('');
  const entered = useRef(false);
  const blocked = active && controls.requireFullscreen && !fullscreen;
  useEffect(() => {
    if (blocked) document.getElementById('enter-fullscreen')?.focus();
    if (active && controls.requireFullscreen && fullscreen)
      document.getElementById('question')?.focus();
  }, [active, controls.requireFullscreen, fullscreen, blocked]);
  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (!active) return;
    // Restrict only the attempt surface; authentication and other tabs remain unaffected.
    const prevent = (event) => {
      if (event.target instanceof Element && event.target.closest('.attempt-shell'))
        event.preventDefault();
    };
    const events = [
      ...(controls.disableCopyPaste ? ['copy', 'cut', 'paste'] : []),
      ...(controls.disableContextMenu ? ['contextmenu'] : []),
    ];
    events.forEach((type) => document.addEventListener(type, prevent, true));
    return () => events.forEach((type) => document.removeEventListener(type, prevent, true));
  }, [active, controls.disableCopyPaste, controls.disableContextMenu]);
  useEffect(
    () => () => {
      if (entered.current && document.fullscreenElement) document.exitFullscreen().catch(() => {});
      entered.current = false;
    },
    [active],
  );
  async function enterFullscreen() {
    setError('');
    try {
      if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen)
        throw new Error(
          'Fullscreen is unavailable on this browser. Use a supported desktop browser or contact your administrator for an accommodated exam.',
        );
      await document.documentElement.requestFullscreen();
      entered.current = true;
      setFullscreen(Boolean(document.fullscreenElement));
    } catch (err) {
      setError(err.message || 'Fullscreen permission was denied. Allow fullscreen and try again.');
    }
  }
  return { controls, blocked, enterFullscreen, error };
}

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => { loading = null; reject(new Error('Couldn’t load the “I’m human” check. Check your connection or ad blocker.')); };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Cloudflare Turnstile ("I'm human" check) for the sign-up form; the server
 * verifies the token (api/_botGuard.js). Usually passes without a click.
 * Tokens are single-use: call ref.reset() after a failed submit.
 */
const TurnstileWidget = forwardRef(function TurnstileWidget({ siteKey, onToken, onError }, ref) {
  const box = useRef(null);
  const widgetId = useRef(null);
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError };

  useImperativeHandle(ref, () => ({
    reset() {
      handlers.current.onToken?.(null);
      if (widgetId.current != null) window.turnstile?.reset(widgetId.current);
    },
  }), []);

  useEffect(() => {
    if (!siteKey) return undefined;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !box.current) return;
        widgetId.current = turnstile.render(box.current, {
          sitekey: siteKey,
          theme: document.body.classList.contains('dark-mode') ? 'dark' : 'light',
          callback: (token) => handlers.current.onToken?.(token),
          'expired-callback': () => handlers.current.onToken?.(null),
          'error-callback': () => handlers.current.onToken?.(null),
        });
      })
      .catch((err) => { if (!cancelled) handlers.current.onError?.(err); });
    return () => {
      cancelled = true;
      if (widgetId.current != null) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={box} className="auth-turnstile" data-testid="turnstile" />;
});

export default TurnstileWidget;

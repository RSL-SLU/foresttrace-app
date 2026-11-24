import { useEffect, useRef, useState } from 'react';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiLoading = null;

// Google Identity Services, loaded once on first use.
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  gsiLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => { gsiLoading = null; reject(new Error('Couldn’t load Google sign-in. Check your connection or ad blocker.')); };
    document.head.appendChild(script);
  });
  return gsiLoading;
}

/**
 * Google's own "Sign in with Google" button (its branding rules require the
 * rendered one). Hands the ID token to onCredential; the server verifies it
 * (api/_google.js). Renders nothing without a client ID.
 */
function GoogleSignInButton({ clientId, onCredential, onError, text = 'continue_with', disabled = false }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(null);
  // Latest handlers without re-initialising Google on every render
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    loadGsi()
      .then((google) => {
        if (cancelled || !ref.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => handlers.current.onCredential?.(credential),
          ux_mode: 'popup',
          context: text === 'signup_with' ? 'signup' : 'signin',
        });
        const dark = document.body.classList.contains('dark-mode');
        google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'rectangular',
          text,
          logo_alignment: 'center',
          width: Math.min(400, Math.max(200, ref.current.offsetWidth || 320)),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setFailed(err.message);
        handlers.current.onError?.(err);
      });
    return () => { cancelled = true; };
  }, [clientId, text]);

  if (!clientId) return null;
  return (
    <div className={`auth-google${disabled ? ' auth-google--disabled' : ''}`}>
      <div ref={ref} className="auth-google-button" data-testid="google-signin" />
      {failed && <p className="auth-hint">{failed}</p>}
    </div>
  );
}

export default GoogleSignInButton;

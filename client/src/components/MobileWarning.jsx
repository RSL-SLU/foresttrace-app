import { useState, useEffect } from 'react';

const MIN_WIDTH = 1024; // px — below this the app is not usable

function MobileWarning() {
  const [isMobile, setIsMobile] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MIN_WIDTH);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (!isMobile || dismissed) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.icon}>💻</div>
        <h2 style={styles.title}>Desktop Required</h2>
        <p style={styles.body}>
          ForestTrace is designed for desktop use. The map, layer controls, and
          analysis panels require a larger screen to work properly.
        </p>
        <p style={styles.body}>
          Please open this application on a laptop or desktop computer for the
          best experience.
        </p>
        <button style={styles.button} onClick={() => setDismissed(true)}>
          Continue anyway
        </button>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '24px',
  },
  card: {
    background: '#fff',
    borderRadius: '12px',
    padding: '32px 24px',
    maxWidth: '360px',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  },
  icon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  title: {
    margin: '0 0 12px',
    fontSize: '22px',
    fontWeight: 700,
    color: '#1a1a1a',
  },
  body: {
    margin: '0 0 12px',
    fontSize: '14px',
    color: '#555',
    lineHeight: 1.6,
  },
  button: {
    marginTop: '8px',
    padding: '10px 20px',
    background: 'transparent',
    border: '1px solid #ccc',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#777',
    cursor: 'pointer',
  },
};

export default MobileWarning;

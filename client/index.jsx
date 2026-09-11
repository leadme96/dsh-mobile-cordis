// dsh-mobile-cordis client: Settings UI for mobile access
import { createElement as h, useEffect, useState } from 'react';

export const name = 'dsh-mobile';
export const inject = ['slots', 'connection'];

const MOBILE_RPC_CHANNEL = '/dsh-mobile';

// Styles following DSH design system
const styles = {
  card: {
    background: 'var(--dsw-alias-bg-layer-1, #fff)',
    border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    borderRadius: 12,
    padding: '16px 20px',
    maxWidth: 480,
  },
  qr: {
    width: 220,
    height: 220,
    borderRadius: 10,
    border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    margin: '8px 0',
  },
  code: {
    fontFamily: 'ui-monospace, Menlo, monospace',
    fontSize: 12,
    wordBreak: 'break-all',
    margin: '6px 0 10px',
    color: 'var(--dsw-alias-label-primary, inherit)',
  },
  muted: {
    color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
    fontSize: 12,
    lineHeight: 1.5,
  },
};

function MobileSettingsPanel({ rpcCall }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const call = async (method, payload) => {
    const res = await rpcCall(MOBILE_RPC_CHANNEL, { method, payload });
    if (!res?.ok) throw new Error(res?.error?.message ?? 'RPC failed');
    return res.value;
  };

  const loadStatus = async () => {
    try {
      const s = await call('status', {});
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return h('div', { style: styles.card }, [
      h('div', { style: { color: 'var(--dsw-alias-state-error, #dc2626)' } }, `Error: ${error}`),
    ]);
  }

  if (!status) {
    return h('div', { style: styles.card }, 'Loading...');
  }

  const { enabled, lanIp, port, pinEnabled, pin, accessUrl, qrDataUrl } = status;

  return h('div', { style: styles.card }, [
    // Status indicator
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } }, [
      h('span', { style: { fontSize: 16 } }, enabled ? '🟢' : '🔴'),
      h('span', { style: { fontWeight: 500 } }, enabled ? 'Mobile access enabled' : 'Mobile access disabled'),
    ]),

    // QR code section
    enabled && qrDataUrl && h('div', { style: { textAlign: 'center', margin: '16px 0' } }, [
      h('img', { src: qrDataUrl, alt: 'QR Code', style: styles.qr }),
      h('div', { style: { marginTop: 8 } }, [
        h('div', { style: styles.muted }, 'Scan with your phone to access DSH'),
      ]),
    ]),

    // Access info
    enabled && h('div', { style: { marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)' } }, [
      h('div', { style: { marginBottom: 8 } }, [
        h('strong', null, 'LAN IP: '),
        h('code', { style: styles.code }, lanIp || 'Not detected'),
      ]),
      h('div', { style: { marginBottom: 8 } }, [
        h('strong', null, 'Port: '),
        h('code', { style: styles.code }, String(port)),
      ]),
      pinEnabled && h('div', { style: { marginBottom: 8 } }, [
        h('strong', null, 'PIN: '),
        h('code', { style: styles.code }, pin),
      ]),
      h('div', { style: { marginTop: 12 } }, [
        h('strong', null, 'Access URL:'),
        h('div', { style: styles.code }, accessUrl),
      ]),
    ]),

    // Instructions
    h('div', { style: { ...styles.muted, marginTop: 16 } }, [
      h('div', null, '• Make sure your phone is on the same WiFi network'),
      h('div', null, '• Scan the QR code or enter the URL manually'),
      pinEnabled && h('div', null, '• Enter the PIN when prompted on your phone'),
    ]),
  ]);
}

export function apply(ctx) {
  const rpcCall = async (channel, request) => {
    return ctx.connection.rpc.call(channel, request);
  };

  ctx.slots.inject('settings.section', 'dsh-mobile', {
    title: 'Mobile Access',
    order: 100,
    render: () => h(MobileSettingsPanel, { rpcCall }),
  });
}

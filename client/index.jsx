/**
 * dsh-mobile client UI
 * Injects a "Mobile Access" settings section into DSH's settings page.
 */

export function apply(ctx) {
  // Inject settings section
  ctx.slots.inject('settings.section', 'dsh-mobile', {
    title: 'Mobile Access',
    render: () => {
      const [status, setStatus] = ctx.useState(null);
      const [qrDataUrl, setQrDataUrl] = ctx.useState(null);

      ctx.useEffect(() => {
        // Poll status every 3 seconds
        const interval = setInterval(async () => {
          try {
            const result = await ctx.connection.rpc.call('dsh-mobile', 'status', {});
            setStatus(result);

            // Generate QR code
            if (result?.accessUrl) {
              const qr = await ctx.connection.rpc.call('dsh-mobile', 'generateQr', { url: result.accessUrl });
              setQrDataUrl(qr);
            }
          } catch (err) {
            console.error('[dsh-mobile] Failed to fetch status:', err);
          }
        }, 3000);

        // Initial fetch
        (async () => {
          try {
            const result = await ctx.connection.rpc.call('dsh-mobile', 'status', {});
            setStatus(result);
            if (result?.accessUrl) {
              const qr = await ctx.connection.rpc.call('dsh-mobile', 'generateQr', { url: result.accessUrl });
              setQrDataUrl(qr);
            }
          } catch (err) {
            console.error('[dsh-mobile] Failed to fetch initial status:', err);
          }
        })();

        return () => clearInterval(interval);
      }, []);

      if (!status) {
        return ctx.h('div', { className: 'dsh-mobile-loading' }, 'Loading...');
      }

      return ctx.h('div', { className: 'dsh-mobile-settings' }, [
        ctx.h('div', { className: 'dsh-mobile-status', key: 'status' }, [
          ctx.h('span', { className: 'status-indicator', key: 'indicator' }, status.enabled ? '🟢' : '🔴'),
          ctx.h('span', { key: 'text' }, status.enabled ? 'Mobile access enabled' : 'Mobile access disabled'),
        ]),

        status.enabled && qrDataUrl && ctx.h('div', { className: 'dsh-mobile-qr', key: 'qr' }, [
          ctx.h('img', { src: qrDataUrl, alt: 'QR Code', className: 'qr-image' }),
          ctx.h('div', { className: 'access-url' }, [
            ctx.h('label', { key: 'label' }, 'Access URL:'),
            ctx.h('code', { key: 'url' }, status.accessUrl),
          ]),
        ]),

        status.enabled && ctx.h('div', { className: 'dsh-mobile-info', key: 'info' }, [
          ctx.h('p', { key: 'lan' }, [
            ctx.h('strong', null, 'LAN IP: '),
            ctx.h('code', null, status.lanIp || 'Not detected'),
          ]),
          ctx.h('p', { key: 'port' }, [
            ctx.h('strong', null, 'Proxy Port: '),
            ctx.h('code', null, status.port),
          ]),
          status.pinEnabled && ctx.h('p', { key: 'pin' }, [
            ctx.h('strong', null, 'PIN: '),
            ctx.h('code', null, status.pin),
          ]),
        ]),

        ctx.h('style', { key: 'style' }, `
          .dsh-mobile-settings {
            padding: 1rem;
            max-width: 600px;
          }
          .dsh-mobile-status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 1rem;
            font-size: 1.1rem;
          }
          .dsh-mobile-qr {
            text-align: center;
            margin: 1.5rem 0;
          }
          .qr-image {
            width: 200px;
            height: 200px;
            border: 1px solid var(--border-color, #ccc);
            border-radius: 8px;
          }
          .access-url {
            margin-top: 0.5rem;
          }
          .access-url label {
            display: block;
            margin-bottom: 0.25rem;
            font-weight: 500;
          }
          .access-url code {
            display: block;
            padding: 0.5rem;
            background: var(--bg-secondary, #f5f5f5);
            border-radius: 4px;
            font-size: 0.9rem;
            word-break: break-all;
          }
          .dsh-mobile-info {
            margin-top: 1rem;
            padding: 1rem;
            background: var(--bg-secondary, #f5f5f5);
            border-radius: 8px;
          }
          .dsh-mobile-info p {
            margin: 0.5rem 0;
          }
          .dsh-mobile-info code {
            padding: 0.125rem 0.375rem;
            background: var(--bg-primary, #fff);
            border-radius: 3px;
            font-size: 0.9rem;
          }
          .dsh-mobile-loading {
            padding: 1rem;
            color: var(--text-secondary, #666);
          }
          /* Safe area handling for mobile devices */
          @supports (padding: env(safe-area-inset-bottom)) {
            .dsh-mobile-settings {
              padding-bottom: calc(1rem + env(safe-area-inset-bottom));
            }
          }
        `),
      ]);
    },
  });
}

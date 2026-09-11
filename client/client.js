window.__ModuleLoader__.load({
  id: "dsh-mobile-cordis",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useEffect = React.useEffect;
    var useState = React.useState;

    var name = 'dsh-mobile-cordis';
    var inject = ['slots', 'connection'];

    var MOBILE_RPC_CHANNEL = '/dsh-mobile';

    var styles = {
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

    function MobileSettingsPanel(props) {
      var rpcCall = props.rpcCall;
      var statusState = useState(null);
      var status = statusState[0];
      var setStatus = statusState[1];
      var errorState = useState(null);
      var error = errorState[0];
      var setError = errorState[1];

      var call = async function(endpoint, payload) {
        var res = await rpcCall(endpoint, payload);
        if (!res || !res.ok) throw new Error((res && res.error && res.error.message) || 'RPC failed');
        return res.value;
      };

      var loadStatus = async function() {
        try {
          var s = await call('status', {});
          setStatus(s);
          setError(null);
        } catch (err) {
          setError(err.message);
        }
      };

      useEffect(function() {
        loadStatus();
        var interval = setInterval(loadStatus, 3000);
        return function() { clearInterval(interval); };
      }, []);

      if (error) {
        return h('div', { style: styles.card }, [
          h('div', { style: { color: 'var(--dsw-alias-state-error, #dc2626)' }, key: 'error' }, 'Error: ' + error),
        ]);
      }

      if (!status) {
        return h('div', { style: styles.card }, 'Loading...');
      }

      var enabled = status.enabled;
      var lanIp = status.lanIp;
      var port = status.port;
      var pinEnabled = status.pinEnabled;
      var pin = status.pin;
      var accessUrl = status.accessUrl;
      var qrDataUrl = status.qrDataUrl;

      return h('div', { style: styles.card }, [
        // Status indicator
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }, key: 'status' }, [
          h('span', { style: { fontSize: 16 }, key: 'icon' }, enabled ? '🟢' : '🔴'),
          h('span', { style: { fontWeight: 500 }, key: 'text' }, enabled ? 'Mobile access enabled' : 'Mobile access disabled'),
        ]),

        // QR code section
        enabled && qrDataUrl && h('div', { style: { textAlign: 'center', margin: '16px 0' }, key: 'qr' }, [
          h('img', { src: qrDataUrl, alt: 'QR Code', style: styles.qr }),
          h('div', { style: { marginTop: 8 } }, [
            h('div', { style: styles.muted }, 'Scan with your phone to access DSH'),
          ]),
        ]),

        // Access info
        enabled && h('div', { style: { marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)' }, key: 'info' }, [
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
        h('div', { style: Object.assign({}, styles.muted, { marginTop: 16 }), key: 'instructions' }, [
          h('div', null, '• Make sure your phone is on the same WiFi network'),
          h('div', null, '• Scan the QR code or enter the URL manually'),
          pinEnabled && h('div', null, '• Enter the PIN when prompted on your phone'),
        ]),
      ]);
    }

    function apply(ctx) {
      var rpcCall = function(endpoint, payload) {
        return ctx.connection.rpc.call(MOBILE_RPC_CHANNEL, endpoint, payload);
      };

      ctx.slots.inject(
        "settings.section",
        function() {
          return ctx.slots.register(
            {
              name: "settings.section",
              id: "dsh-mobile",
              order: 100,
              label: function() { return "Mobile Access"; },
              inject: function() { return { rpcCall: rpcCall }; }
            },
            MobileSettingsPanel
          );
        }
      );
    }

    module.exports = { name: name, inject: inject, apply: apply };
    return module.exports;
  }
});

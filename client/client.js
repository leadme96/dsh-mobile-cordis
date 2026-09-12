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
          h('div', { style: { color: 'var(--dsw-alias-state-error, #dc2626)' }, key: 'error' }, '错误: ' + error),
        ]);
      }

      if (!status) {
        return h('div', { style: styles.card }, '加载中...');
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
          h('span', { style: { fontWeight: 500 }, key: 'text' }, enabled ? '移动端访问已启用' : '移动端访问已禁用'),
        ]),

        // QR code section
        enabled && qrDataUrl && h('div', { style: { textAlign: 'center', margin: '16px 0' }, key: 'qr' }, [
          h('img', { src: qrDataUrl, alt: '二维码', style: styles.qr }),
          h('div', { style: { marginTop: 8 } }, [
            h('div', { style: styles.muted }, '使用手机扫描二维码访问 DSH'),
          ]),
        ]),

        // Access info
        enabled && h('div', { style: { marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)' }, key: 'info' }, [
          h('div', { style: { marginBottom: 8 } }, [
            h('strong', null, '局域网 IP: '),
            h('code', { style: styles.code }, lanIp || '未检测到'),
          ]),
          h('div', { style: { marginBottom: 8 } }, [
            h('strong', null, '端口: '),
            h('code', { style: styles.code }, String(port)),
          ]),
          pinEnabled && h('div', { style: { marginBottom: 8 } }, [
            h('strong', null, 'PIN 码: '),
            h('code', { style: styles.code }, pin),
          ]),
          h('div', { style: { marginTop: 12 } }, [
            h('strong', null, '访问地址:'),
            h('div', { style: styles.code }, accessUrl),
          ]),
        ]),

        // Instructions
        h('div', { style: Object.assign({}, styles.muted, { marginTop: 16 }), key: 'instructions' }, [
          h('div', null, '• 确保手机与电脑在同一 WiFi 网络'),
          h('div', null, '• 扫描二维码或手动输入访问地址'),
          pinEnabled && h('div', null, '• 在手机上输入 PIN 码完成验证'),
        ]),

        // GitHub star button
        h('div', { style: { marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)', textAlign: 'center' }, key: 'github' }, [
          h('a', {
            href: 'https://github.com/leadme96/dsh-mobile-cordis',
            target: '_blank',
            rel: 'noopener noreferrer',
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 8,
              background: 'var(--dsw-alias-bg-layer-2, #f5f5f5)',
              color: 'var(--dsw-alias-label-primary, #000)',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 500,
              border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
            }
          }, [
            h('svg', {
              key: 'icon',
              width: 16,
              height: 16,
              viewBox: '0 0 16 16',
              fill: 'currentColor'
            }, [
              h('path', {
                d: 'M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z'
              })
            ]),
            h('span', { key: 'text' }, 'Star on GitHub'),
          ]),
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
              label: function() { return "移动端访问"; },
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

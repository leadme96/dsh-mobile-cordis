# dsh-mobile-cordis

> 手机扫码即同步访问 DSH Desktop（局域网实时同屏）

DeepSeek Harness Cordis plugin that enables mobile phone access to the DSH desktop web interface via QR code scanning over LAN.

## Features

- 📱 **QR Code Access**: Scan QR code to access DSH from your phone on the same WiFi
- 🔄 **Real-time Sync**: WebSocket transparent proxy for live streaming output
- 🔒 **Optional PIN**: Enable PIN authentication for secure access
- 🖥️ **DSH Desktop Compatible**: Works seamlessly with DSH Desktop app
- 📡 **LAN IP Auto-Detection**: Automatically detects your LAN IP (with manual override)
- 💉 **Mobile Shims**: Injects compatibility fixes for mobile browsers

## Installation

```bash
dsh plugin add dsh-mobile-cordis
```

Or from GitHub:

```bash
dsh plugin add github:your-username/dsh-mobile-cordis
```

## Usage

1. **Start DSH web server**:
   ```bash
   dsh web
   ```

2. **Scan QR code**: The plugin prints a QR code in the terminal. Scan it with your phone.

3. **Access DSH**: Your phone will open the DSH web interface, synced in real-time with your desktop.

## Configuration

Edit your `cordis.yml` or use the settings UI:

```yaml
- name: dsh-mobile-cordis
  config:
    enabled: true              # Enable/disable the plugin
    port: 3081                 # Proxy port (listens on 0.0.0.0)
    upstreamPort: 3080         # DSH web upstream port (127.0.0.1)
    lanIpOverride: ""          # Manually override detected LAN IP
    pinEnabled: false          # Require PIN for access
    customPin: ""              # Custom 8-digit PIN (auto-generated if empty)
    heartbeatInterval: 30      # WebSocket heartbeat in seconds (0 to disable)
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable or disable the mobile access proxy |
| `port` | number | `3081` | Port for the proxy to listen on (0.0.0.0) |
| `upstreamPort` | number | `3080` | DSH web server port (127.0.0.1) |
| `lanIpOverride` | string | `""` | Override auto-detected LAN IP (empty for auto) |
| `pinEnabled` | boolean | `false` | Require PIN authentication |
| `customPin` | string | `""` | Custom 8-digit PIN (auto-generated if empty) |
| `heartbeatInterval` | number | `30` | WebSocket heartbeat interval in seconds (0 to disable) |

## How It Works

1. **Reverse Proxy**: The plugin runs a reverse proxy on `0.0.0.0:<port>` that forwards requests to `127.0.0.1:<upstreamPort>`.

2. **Header Rewriting**: All `Host` and `Origin` headers are rewritten to `127.0.0.1:<upstreamPort>`, making DSH's trust boundary accept the requests.

3. **WebSocket Transparency**: WebSocket connections are bidirectionally piped at the TCP socket level, enabling real-time streaming.

4. **Mobile Shims**: The proxy injects `__DSH_TRANSPORT__` shim into HTML responses to fix compatibility issues with non-localhost origins.

5. **QR Code Generation**: Generates QR codes containing the LAN URL (with optional PIN token) for easy mobile access.

## Security

- **LAN-only by default**: The proxy listens on all interfaces but is intended for LAN use
- **Optional PIN**: Enable `pinEnabled: true` to require an 8-digit PIN for access
- **Session binding**: PIN cookies are bound to the DSH session (restart invalidates sessions)
- **No public exposure**: This plugin does not expose DSH to the public internet (use Cloudflare tunnels for that)

## DSH Desktop Integration

When running in DSH Desktop:
- The plugin detects the Desktop environment via `desktopProfiles` context
- Update/restart controls are disabled (Desktop manages lifecycle)
- All other features work normally

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Typecheck
pnpm typecheck

# Lint
pnpm lint
```

## Architecture

```
dsh-mobile-cordis/
├── src/
│   ├── index.ts        # Plugin entry point
│   ├── proxy.ts        # Reverse proxy (HTTP + WebSocket)
│   ├── service.ts      # LAN IP detection + QR code
│   └── settings.ts     # PIN persistence
├── client/
│   └── index.jsx       # Settings UI
├── test/               # Test suite
└── cordis.patch.yml    # Cordis bundle manifest
```

## License

MIT

## Credits

Inspired by [dsh-pocket](https://github.com/shaobeichen/dsh-pocket) — a standalone implementation of the same concept.

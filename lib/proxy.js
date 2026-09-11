import { createServer, request as httpRequest, } from 'node:http';
/**
 * Reverse proxy that forwards HTTP and WebSocket requests to upstream,
 * rewriting Host/Origin headers to make upstream trust the requests.
 */
export class ReverseProxy {
    config;
    server;
    port;
    /** Live client sockets, tracked so `stop()` can tear down upgraded tunnels. */
    sockets = new Set();
    constructor(config) {
        this.config = config;
    }
    /**
     * Start the proxy server.
     */
    async start() {
        this.server = createServer((req, res) => this.handleHttp(req, res));
        this.server.on('connection', (socket) => {
            this.sockets.add(socket);
            socket.on('close', () => this.sockets.delete(socket));
        });
        // Handle WebSocket upgrades
        this.server.on('upgrade', (req, socket, head) => {
            this.handleWebSocket(req, socket, head);
        });
        return new Promise((resolve, reject) => {
            this.server.listen(this.config.port, '0.0.0.0', () => {
                this.port = this.server.address().port;
                resolve();
            });
            this.server.on('error', reject);
        });
    }
    /**
     * Stop the proxy server. Upgraded sockets outlive a plain `close()`, so they
     * are destroyed first — otherwise stopping hangs until every tunnel ends.
     */
    async stop() {
        if (!this.server)
            return;
        for (const socket of this.sockets)
            socket.destroy();
        this.sockets.clear();
        return new Promise((resolve) => {
            this.server.close(() => resolve());
        });
    }
    /**
     * Get the port the proxy is listening on.
     */
    getPort() {
        return this.port;
    }
    /**
     * Handle HTTP requests.
     */
    async handleHttp(req, res) {
        try {
            // Check PIN authentication if enabled. The PIN rides as `pin`: `token` is
            // DSH's own launch-token query key and must pass through untouched.
            if (this.config.pinEnabled && this.config.pin) {
                const url = new URL(req.url || '/', `http://${req.headers.host}`);
                const token = url.searchParams.get('pin');
                if (token !== this.config.pin) {
                    res.writeHead(401, { 'Content-Type': 'text/plain' });
                    res.end('Unauthorized: Invalid or missing PIN');
                    return;
                }
            }
            // Rewrite headers
            const headers = { ...req.headers };
            headers.host = `${this.config.upstreamHost}:${this.config.upstreamPort}`;
            headers.origin = `http://${this.config.upstreamHost}:${this.config.upstreamPort}`;
            // Forward request to upstream
            const proxyReq = httpRequest({
                hostname: this.config.upstreamHost,
                port: this.config.upstreamPort,
                path: req.url,
                method: req.method,
                headers,
            }, (proxyRes) => {
                // Check if response is HTML and needs shim injection
                const contentType = proxyRes.headers['content-type'] || '';
                if (contentType.includes('text/html')) {
                    // Buffer response and inject shim
                    const chunks = [];
                    proxyRes.on('data', (chunk) => chunks.push(chunk));
                    proxyRes.on('end', () => {
                        let body = Buffer.concat(chunks).toString('utf-8');
                        body = this.injectTransportShim(body);
                        // Remove transfer-encoding since we're buffering
                        const headers = { ...proxyRes.headers };
                        delete headers['transfer-encoding'];
                        headers['content-length'] = Buffer.byteLength(body).toString();
                        res.writeHead(proxyRes.statusCode || 200, headers);
                        res.end(body);
                    });
                }
                else {
                    // Forward response as-is
                    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                    proxyRes.pipe(res);
                }
            });
            proxyReq.on('error', (err) => {
                console.error('[dsh-mobile] Proxy request error:', err);
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                    res.end('Bad Gateway');
                }
            });
            req.pipe(proxyReq);
        }
        catch (err) {
            console.error('[dsh-mobile] HTTP handler error:', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            }
        }
    }
    /**
     * Handle WebSocket upgrades.
     */
    handleWebSocket(req, socket, head) {
        // Rewrite headers
        const headers = { ...req.headers };
        headers.host = `${this.config.upstreamHost}:${this.config.upstreamPort}`;
        headers.origin = `http://${this.config.upstreamHost}:${this.config.upstreamPort}`;
        // Connect to upstream WebSocket
        const proxyReq = httpRequest({
            hostname: this.config.upstreamHost,
            port: this.config.upstreamPort,
            path: req.url,
            method: 'GET',
            headers: {
                ...headers,
                connection: 'Upgrade',
                upgrade: 'websocket',
            },
        });
        proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
            // Node's HTTP client has already consumed the upstream `101 Switching
            // Protocols` status line and headers, so piping the raw sockets alone
            // leaves the browser waiting for a handshake that never arrives and every
            // WebSocket dies. Replay the response onto the client socket first.
            const responseHeaders = Object.entries(proxyRes.headers)
                .filter(([, value]) => value !== undefined)
                .map(([headerName, value]) => `${headerName}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
                .join('\r\n');
            socket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n${responseHeaders}\r\n\r\n`);
            // Frames read past the handshake by either side must not be dropped.
            if (proxyHead.length > 0)
                socket.write(proxyHead);
            if (head.length > 0)
                proxySocket.write(head);
            // Bidirectionally pipe the sockets
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
            // Either half closing ends the tunnel; without this the peer socket leaks
            // and keeps the server from shutting down.
            socket.on('close', () => proxySocket.destroy());
            proxySocket.on('close', () => socket.destroy());
            // Setup heartbeat if configured
            if (this.config.heartbeatInterval && this.config.heartbeatInterval > 0) {
                const interval = setInterval(() => {
                    try {
                        // Send ping frame (opcode 0x9)
                        socket.write(Buffer.from([0x89, 0x00]));
                    }
                    catch {
                        // Ignore errors, connection will be cleaned up
                    }
                }, this.config.heartbeatInterval * 1000);
                socket.on('close', () => clearInterval(interval));
            }
            proxySocket.on('error', (err) => {
                console.error('[dsh-mobile] WebSocket proxy error:', err);
                socket.destroy();
            });
        });
        proxyReq.on('error', (err) => {
            console.error('[dsh-mobile] WebSocket upgrade error:', err);
            socket.destroy();
        });
        socket.on('error', (err) => {
            console.error('[dsh-mobile] Client socket error:', err);
            proxyReq.destroy();
        });
        proxyReq.end();
    }
    /**
     * Inject __DSH_TRANSPORT__ shim and mobile UI adaptation into HTML.
     */
    injectTransportShim(html) {
        // Check if already injected
        if (html.includes('data-dsh-mobile-shim')) {
            return html;
        }
        const shim = `
<script data-dsh-mobile-shim>
// dsh-mobile: __DSH_TRANSPORT__ shim for non-localhost origins
if (!globalThis.__DSH_TRANSPORT__?.createApiClient) {
  globalThis.__DSH_TRANSPORT__ = globalThis.__DSH_TRANSPORT__ || {};
  globalThis.__DSH_TRANSPORT__.createApiClient = () => null;
}

// dsh-mobile: Mobile detection and UI adaptation
(function() {
  var ua = navigator.userAgent || '';
  var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
    || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)); // iPadOS
  if (!isMobile) return;

  // Mark as mobile for CSS targeting
  document.documentElement.setAttribute('data-dsh-mobile', 'true');

  // Mobile CSS adaptation
  var style = document.createElement('style');
  style.textContent = ${JSON.stringify(MOBILE_CSS)};
  document.head.appendChild(style);

  // Hide desktop-only navigation items
  function hideDesktopOnlyNav() {
    // Selectors for desktop-only items in the sidebar
    var desktopOnlySelectors = [
      // Settings gear icon / link
      '[data-nav="settings"]',
      '[aria-label*="settings" i]',
      '[aria-label*="Settings" i]',
      '[title*="settings" i]',
      '[title*="Settings" i]',
      // Plugin management
      '[data-nav="plugins"]',
      '[aria-label*="plugin" i]',
      '[aria-label*="Plugin" i]',
      // Market / store
      '[data-nav="market"]',
      '[data-nav="store"]',
      '[aria-label*="market" i]',
      '[aria-label*="Market" i]',
      '[aria-label*="store" i]',
      // Terminal
      '[data-nav="terminal"]',
      '[aria-label*="terminal" i]',
      '[aria-label*="Terminal" i]',
      // Developer tools
      '[data-nav="developer"]',
      '[aria-label*="developer" i]',
      '[aria-label*="Developer" i]',
      '[aria-label*="devtools" i]',
      // Diagnostics
      '[data-nav="diagnostics"]',
      '[aria-label*="diagnostic" i]',
      '[aria-label*="Diagnostic" i]',
      // Update check
      '[data-nav="update"]',
      '[aria-label*="update" i]',
      '[aria-label*="Update" i]',
      // Restart / recovery
      '[data-nav="restart"]',
      '[aria-label*="restart" i]',
      '[aria-label*="Restart" i]',
      // Profile management (desktop-only feature)
      '[data-nav="profile"]',
      '[data-nav="profiles"]',
      '[aria-label*="profile" i]',
      '[aria-label*="Profile" i]',
    ];

    // Also hide by text content
    var desktopOnlyTexts = [
      'Settings', '设置',
      'Plugins', '插件',
      'Market', '市场',
      'Terminal', '终端',
      'Developer', '开发者',
      'Diagnostics', '诊断',
      'Check for Updates', '检查更新',
      'Restart', '重启',
      'Profiles', '配置',
    ];

    // Hide elements matching selectors
    desktopOnlySelectors.forEach(function(sel) {
      try {
        document.querySelectorAll(sel).forEach(function(el) {
          el.style.display = 'none';
          el.setAttribute('data-dsh-mobile-hidden', 'true');
        });
      } catch(e) {}
    });

    // Hide elements by text content (for nav items without data attributes)
    document.querySelectorAll('nav a, nav button, [role="navigation"] a, [role="navigation"] button, [data-slot="sidebar"] a, [data-slot="sidebar"] button').forEach(function(el) {
      var text = (el.textContent || '').trim();
      var ariaLabel = el.getAttribute('aria-label') || '';
      var title = el.getAttribute('title') || '';
      var combined = (text + ' ' + ariaLabel + ' ' + title).toLowerCase();

      for (var i = 0; i < desktopOnlyTexts.length; i++) {
        if (combined.indexOf(desktopOnlyTexts[i].toLowerCase()) !== -1) {
          el.style.display = 'none';
          el.setAttribute('data-dsh-mobile-hidden', 'true');
          break;
        }
      }
    });
  }

  // Run immediately and observe DOM changes
  hideDesktopOnlyNav();

  // Use MutationObserver to catch dynamically added nav items
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function() {
      hideDesktopOnlyNav();
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    // Stop observing after 10 seconds to avoid performance impact
    setTimeout(function() { observer.disconnect(); }, 10000);
  }

  // Also run on DOMContentLoaded and load events
  document.addEventListener('DOMContentLoaded', hideDesktopOnlyNav);
  window.addEventListener('load', hideDesktopOnlyNav);

  // ===== Mobile hamburger menu for sidebar toggle =====
  function createMobileMenuButton() {
    if (document.getElementById('dsh-mobile-menu-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'dsh-mobile-menu-btn';
    btn.setAttribute('aria-label', 'Toggle sidebar');
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>';
    btn.style.cssText = 'position:fixed;top:8px;left:8px;z-index:10000;width:40px;height:40px;border:none;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,0.05));color:var(--dsw-alias-label-primary,inherit);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;min-height:40px;min-width:40px;';
    btn.addEventListener('click', function() {
      var html = document.documentElement;
      var isOpen = html.getAttribute('data-dsh-mobile-sidebar-open') === 'true';
      html.setAttribute('data-dsh-mobile-sidebar-open', isOpen ? 'false' : 'true');
    });
    document.body.appendChild(btn);
  }

  // Create backdrop click handler to close sidebar
  function setupBackdropClose() {
    document.addEventListener('click', function(e) {
      var html = document.documentElement;
      if (html.getAttribute('data-dsh-mobile-sidebar-open') !== 'true') return;
      // If click is outside sidebar, close it
      var sidebar = document.querySelector('.dshDesktopSidebarSurface');
      if (sidebar && !sidebar.contains(e.target) && e.target.id !== 'dsh-mobile-menu-btn') {
        html.setAttribute('data-dsh-mobile-sidebar-open', 'false');
      }
    });
  }

  // Initialize mobile menu after DOM is ready
  function initMobileMenu() {
    createMobileMenuButton();
    setupBackdropClose();
  }

  document.addEventListener('DOMContentLoaded', initMobileMenu);
  window.addEventListener('load', initMobileMenu);
  // Also try immediately in case DOM is already ready
  if (document.readyState !== 'loading') {
    setTimeout(initMobileMenu, 100);
  }
})();
</script>
`;
        // Insert after <head>
        return html.replace(/<head([^>]*)>/, `<head$1>${shim}`);
    }
}
/**
 * Mobile-specific CSS for adapting the DSH Desktop UI to small screens.
 * - Collapses the 3-column grid into a single column
 * - Hides the sidebar by default (can be toggled)
 * - Optimizes touch targets (min 44px)
 * - Adjusts font sizes and spacing
 * - Hides desktop-only features
 */
const MOBILE_CSS = `
/* ===== Mobile viewport and base layout ===== */
html[data-dsh-mobile] {
  --dsh-mobile-sidebar-width: 280px;
  --dsh-mobile-touch-target: 44px;
  --dsh-mobile-font-scale: 1.05;
}

/* Force single-column layout on mobile */
html[data-dsh-mobile] .dshDesktopFrame {
  grid-template-columns: 1fr !important;
  grid-template-rows: auto 1fr !important;
  width: 100vw !important;
  max-width: 100vw !important;
  overflow-x: hidden !important;
}

/* Hide the details panel on mobile */
html[data-dsh-mobile] .dshDesktopFrame > *:nth-child(3),
html[data-dsh-mobile] [data-slot="details"] {
  display: none !important;
}

/* ===== Sidebar as a slide-out drawer ===== */
html[data-dsh-mobile] .dshDesktopSidebarSurface {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  width: var(--dsh-mobile-sidebar-width) !important;
  height: 100vh !important;
  height: 100dvh !important;
  z-index: 9999 !important;
  transform: translateX(-100%) !important;
  transition: transform 0.25s ease-out !important;
  box-shadow: none !important;
  border-right: 1px solid var(--dsw-alias-border-l1, #e5e7eb) !important;
  background: var(--dsw-alias-bg-layer-1, #fff) !important;
}

html[data-dsh-mobile][data-dsh-mobile-sidebar-open] .dshDesktopSidebarSurface {
  transform: translateX(0) !important;
  box-shadow: 4px 0 24px rgba(0,0,0,0.15) !important;
}

/* Backdrop when sidebar is open */
html[data-dsh-mobile][data-dsh-mobile-sidebar-open]::after {
  content: '' !important;
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  background: rgba(0,0,0,0.3) !important;
  z-index: 9998 !important;
}

/* ===== Mobile header bar ===== */
html[data-dsh-mobile]::before {
  content: '' !important;
  display: block !important;
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  height: 48px !important;
  background: var(--dsw-alias-bg-layer-1, #fff) !important;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e7eb) !important;
  z-index: 9997 !important;
}

/* ===== Touch target optimization ===== */
html[data-dsh-mobile] button,
html[data-dsh-mobile] a,
html[data-dsh-mobile] [role="button"],
html[data-dsh-mobile] [role="tab"],
html[data-dsh-mobile] [role="menuitem"] {
  min-height: var(--dsh-mobile-touch-target) !important;
  min-width: var(--dsh-mobile-touch-target) !important;
  padding: 8px 12px !important;
}

/* ===== Font size adjustments ===== */
html[data-dsh-mobile] body {
  font-size: calc(100% * var(--dsh-mobile-font-scale)) !important;
  -webkit-text-size-adjust: 100% !important;
  -webkit-tap-highlight-color: transparent !important;
  overscroll-behavior: none !important;
}

/* ===== Hide resize handles on mobile ===== */
html[data-dsh-mobile] [data-resize-handle],
html[data-dsh-mobile] .dshDesktopResizeHandle {
  display: none !important;
}

/* ===== Adjust center content for mobile ===== */
html[data-dsh-mobile] .dshDesktopFrame > *:nth-child(2),
html[data-dsh-mobile] [data-slot="conversation"] {
  padding-top: 48px !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow-x: hidden !important;
}

/* ===== Compact message bubbles ===== */
html[data-dsh-mobile] [data-message],
html[data-dsh-mobile] .message {
  max-width: 100% !important;
  padding: 8px 12px !important;
  margin: 4px 8px !important;
}

/* ===== Hide desktop-only status bar items ===== */
html[data-dsh-mobile] [data-slot="statusbar"] > *:not(:first-child):not(:last-child) {
  display: none !important;
}

/* ===== Input area optimization ===== */
html[data-dsh-mobile] textarea,
html[data-dsh-mobile] [contenteditable] {
  font-size: 16px !important; /* Prevents iOS zoom on focus */
  min-height: 44px !important;
}

/* ===== Scrollable areas ===== */
html[data-dsh-mobile] [data-slot="sidebar"] {
  overflow-y: auto !important;
  -webkit-overflow-scrolling: touch !important;
  padding-bottom: 48px !important;
}

/* ===== Hide desktop-specific title bar drag region ===== */
html[data-dsh-mobile] [data-dsh-desktop-titlebar-inset],
html[data-dsh-mobile] .dshDesktopTitlebar {
  display: none !important;
}

/* ===== Mobile-friendly modals ===== */
html[data-dsh-mobile] [role="dialog"],
html[data-dsh-mobile] [data-modal] {
  max-width: calc(100vw - 32px) !important;
  max-height: calc(100dvh - 64px) !important;
  margin: 32px auto !important;
  border-radius: 12px !important;
}

/* ===== Hide desktop-only settings sections ===== */
html[data-dsh-mobile] [data-settings-section="desktop"],
html[data-dsh-mobile] [data-settings-section="plugins"],
html[data-dsh-mobile] [data-settings-section="market"],
html[data-dsh-mobile] [data-settings-section="developer"],
html[data-dsh-mobile] [data-settings-section="diagnostics"] {
  display: none !important;
}

/* ===== Safe area insets for notched devices ===== */
@supports (padding: env(safe-area-inset-top)) {
  html[data-dsh-mobile]::before {
    top: env(safe-area-inset-top) !important;
    height: calc(48px + env(safe-area-inset-top)) !important;
  }
  html[data-dsh-mobile] .dshDesktopFrame > *:nth-child(2),
  html[data-dsh-mobile] [data-slot="conversation"] {
    padding-top: calc(48px + env(safe-area-inset-top)) !important;
  }
  html[data-dsh-mobile] .dshDesktopSidebarSurface {
    top: env(safe-area-inset-top) !important;
    height: calc(100vh - env(safe-area-inset-top)) !important;
    padding-bottom: env(safe-area-inset-bottom) !important;
  }
}

/* ===== Dark mode support ===== */
@media (prefers-color-scheme: dark) {
  html[data-dsh-mobile]::before {
    background: var(--dsw-alias-bg-layer-1, #1a1a1a) !important;
  }
  html[data-dsh-mobile] .dshDesktopSidebarSurface {
    background: var(--dsw-alias-bg-layer-1, #1a1a1a) !important;
  }
}
`;

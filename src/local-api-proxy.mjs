// The lab uses an isolated local backend. Production Worker credentials and
// deployment emulation are unnecessary; retain same-origin HTTP and WebSockets.
export function localAPIProxy(port) {
  const target = `http://127.0.0.1:${port}`;
  return {
    target,
    ws: true,
    changeOrigin: true,
    rewrite: (url) => url.replace(/^\/api(?=\/|$)/, "") || "/",
    configure(proxy) {
      proxy.on("proxyRes", (response) => {
        delete response.headers["set-cookie"];
        const location = response.headers.location;
        if (!location) return;
        const url = new URL(location, target);
        if (url.origin === target)
          response.headers.location = `/api${url.pathname}${url.search}${url.hash}`;
      });
    },
  };
}

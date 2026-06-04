// Tiny local HTTP server that serves the broker-PDF library so the
// dashboard's "open report in new tab" clicks work even when the page
// itself is loaded over HTTPS (GitHub Pages).
//
// Browsers block `file://` navigation from any http(s):// origin, so a
// `target="_blank"` click on a file:// link silently no-ops. They DO
// allow navigation to `http://localhost` / `http://127.0.0.1` from any
// origin (it's treated as a "potentially trustworthy" origin), so a
// localhost HTTP server is the fix.
//
// Listens on 127.0.0.1:8788 only (loopback — never exposed to the LAN).
// No auth: anyone with access to this machine can read the PDFs, but
// the same is true of the file system itself.
//
// Run manually for testing:
//   node scripts/pdf-server.js
//
// Register to auto-start at login:
//   powershell -ExecutionPolicy Bypass -File scripts\install-pdf-server-task.ps1

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = "C:\\Users\\admin\\Desktop\\India Related Reports";
const PORT = 8788;
const HOST = "127.0.0.1";

const MIME = {
  ".pdf":  "application/pdf",
  ".txt":  "text/plain; charset=utf-8",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
};

function send(res, status, body, headers){
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
    ...headers
  });
  if (body && typeof body.pipe === "function") body.pipe(res);
  else res.end(body || "");
}

function log(msg){
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${msg}\n`);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method not allowed");
  }
  // Decode + normalise the URL path; reject any attempt to escape ROOT.
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split("?")[0]); }
  catch { return send(res, 400, "Bad request"); }
  if (urlPath === "/" || urlPath === "/healthz") {
    return send(res, 200,
      "India Research PDF Server\nRoot: " + ROOT + "\nUptime: " +
      Math.round(process.uptime()) + "s\n",
      { "Content-Type": "text/plain; charset=utf-8" });
  }
  // Strip leading slash, resolve under ROOT, then verify the result
  // stays inside ROOT (defence-in-depth against "../" tricks even
  // though we never call shell here).
  const rel = urlPath.replace(/^\/+/, "");
  const abs = path.resolve(ROOT, rel);
  if (!abs.toLowerCase().startsWith(ROOT.toLowerCase() + path.sep.toLowerCase()) &&
      abs.toLowerCase() !== ROOT.toLowerCase()) {
    log("REJECT (escape): " + req.url);
    return send(res, 403, "Forbidden");
  }
  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      log("404 " + req.url);
      return send(res, 404, "Not found");
    }
    const ext = path.extname(abs).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      // PDF viewer should render inline, not prompt to download.
      "Content-Disposition": "inline; filename=\"" +
        path.basename(abs).replace(/"/g, "") + "\"",
    };
    log("200 " + (stat.size / 1024 | 0) + "k " + req.url);
    if (req.method === "HEAD") return send(res, 200, "", headers);
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      ...headers
    });
    fs.createReadStream(abs).pipe(res);
  });
});

server.on("error", e => {
  if (e.code === "EADDRINUSE") {
    log("Port " + PORT + " already in use — another instance is probably running. Exiting.");
    process.exit(0);
  }
  log("Server error: " + e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log("PDF server listening on http://" + HOST + ":" + PORT + "/");
  log("Serving from: " + ROOT);
});

// Graceful shutdown on Ctrl-C / Task Scheduler stop.
function shutdown(){ log("Shutting down."); server.close(() => process.exit(0)); }
process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);

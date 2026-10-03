// Guess Market web client host.
// Serves the static web client from ./public and forwards every /GuessMarket/... request to the existing
// Guess Market server (Tomcat), so the browser talks to one origin and the server needs no change at all.
// Uses only Node's built-in modules - no npm packages are needed.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.GM_WEB_PORT || 3000);
const TARGET = new URL(process.env.GM_SERVER || 'http://localhost:8080');
const CONTEXT = '/GuessMarket';
const PUBLIC_DIR = path.join(__dirname, 'public');

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png'
};

function sendJsonError(res, status, message) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: message }));
}

function proxy(req, res) {
    const headers = { ...req.headers, host: TARGET.host };
    delete headers.origin;
    delete headers.referer;
    const upstream = http.request({
        protocol: TARGET.protocol,
        hostname: TARGET.hostname,
        port: TARGET.port || 80,
        method: req.method,
        path: req.url,
        headers
    }, (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);
    });
    upstream.setTimeout(15000, () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
        if (!res.headersSent) {
            sendJsonError(res, 502, 'Cannot reach the Guess Market server at ' + TARGET.origin + CONTEXT
                + '. Make sure Tomcat is running with GuessMarket.war deployed.');
        } else {
            res.destroy();
        }
    });
    req.pipe(upstream);
}

function serveStatic(req, res) {
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        res.writeHead(400);
        res.end('Bad request');
        return;
    }
    if (urlPath === '/') {
        urlPath = '/index.html';
    }
    const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    if (req.url === CONTEXT || req.url.startsWith(CONTEXT + '/')) {
        proxy(req, res);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res);
    } else {
        res.writeHead(405);
        res.end('Method not allowed');
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error('Port ' + PORT + ' is already in use. Close the program that uses it, or run with another port:');
        console.error('  set GM_WEB_PORT=3001 && run.bat');
    } else {
        console.error(err.message);
    }
    process.exit(1);
});

server.listen(PORT, () => {
    const url = 'http://localhost:' + PORT;
    console.log('Guess Market web client is running.');
    console.log('  Open in the browser:  ' + url);
    console.log('  Guess Market server:  ' + TARGET.origin + CONTEXT);
    console.log('Keep this window open while using the web client. Press Ctrl+C to stop.');
    if (process.env.GM_OPEN_BROWSER === '1' && process.platform === 'win32') {
        require('child_process').exec('start "" "' + url + '"');
    }
});

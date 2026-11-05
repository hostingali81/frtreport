const http = require('http');
const fs = require('fs');

const file = 'D:\\Call-Recording-Server\\quick-update.zip';
const server = http.createServer((req, res) => {
  if (req.url === '/download' || req.url === '/quick-update.zip') {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=quick-update.zip');
    fs.createReadStream(file).pipe(res);
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(`
      <html>
      <body style="font-family:sans-serif;text-align:center;padding:50px;">
        <h2>FRT Office Server - Quick Update (14 KB)</h2>
        <p>Contains: server.js, index.html, app.js with Delete buttons, Month Filter, Substation Filter, and Excel Export.</p>
        <p><a href="/download" style="display:inline-block;background:#2563eb;color:white;padding:14px 28px;border-radius:8px;font-size:18px;text-decoration:none;font-weight:bold;">⬇ Download quick-update.zip</a></p>
      </body>
      </html>
    `);
  }
});

server.listen(5555, '0.0.0.0', () => {
  console.log('Update server running on http://192.168.31.249:5555');
});

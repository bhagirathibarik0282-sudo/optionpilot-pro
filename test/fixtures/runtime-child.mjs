import http from 'node:http';
const streams = new Set();
const server = http.createServer(async (request, response) => {
  if (request.url === '/stream') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: ready\n\n'); streams.add(response); response.on('close', () => streams.delete(response)); return;
  }
  if (request.url === '/slow') await new Promise(resolve => setTimeout(resolve, 200));
  let body = ''; for await (const chunk of request) body += chunk;
  response.setHeader('Set-Cookie', ['fixture=a; HttpOnly', 'fixture2=b']);
  response.end(JSON.stringify({ ok: true, body, method: request.method, host: request.headers.host }));
});
server.listen(Number(process.env.PORT));
process.on('message', message => {
  if (message?.type !== 'DRAIN') return;
  for (const response of streams) response.end();
  server.close(() => process.exit(0));
});

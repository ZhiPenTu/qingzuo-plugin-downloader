import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function stream(bytes, { signal, delayMs, chunkSize, onChange } = {}) {
  let active = true;
  const finish = () => {
    if (!active) return;
    active = false;
    onChange?.(-1);
  };
  return new ReadableStream({
    async start(controller) {
      onChange?.(1);
      let offset = 0;
      try {
        while (offset < bytes.length) {
          if (signal?.aborted) throw signal.reason || new Error('aborted');
          if (delayMs) await delay(delayMs);
          const end = Math.min(bytes.length, offset + chunkSize);
          controller.enqueue(bytes.subarray(offset, end));
          offset = end;
        }
        finish();
        controller.close();
      } catch (error) {
        finish();
        try { controller.error(error); } catch {}
      }
    },
    cancel() { finish(); },
  });
}

async function writeStream(response, body) {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) await new Promise(resolve => response.once('drain', resolve));
    }
    response.end();
  } catch {
    response.destroy();
  } finally {
    reader.releaseLock();
  }
}

export async function startRangeServer(payloads, { delayMs = 12, chunkSize = 32 * 1024 } = {}) {
  const stats = { active: 0, maxActive: 0, gets: 0, ranges: [] };
  const change = amount => {
    stats.active = Math.max(0, stats.active + amount);
    stats.maxActive = Math.max(stats.maxActive, stats.active);
  };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const fixture = payloads[pathname];
    if (!fixture) {
      response.writeHead(404);
      response.end();
      return;
    }
    const bytes = fixture.bytes;
    const etag = '"' + createHash('sha256').update(bytes).digest('hex').slice(0, 16) + '"';
    const headers = {
      'content-type': fixture.mime || 'application/octet-stream',
      'content-disposition': 'attachment; filename="' + pathname.slice(1) + '"',
      etag,
    };
    if (request.method === 'HEAD') {
      response.writeHead(200, { ...headers, 'content-length': String(bytes.length) });
      response.end();
      return;
    }
    stats.gets++;
    const range = request.headers.range;
    if (!range || fixture.single) {
      response.writeHead(200, { ...headers, 'content-length': String(bytes.length) });
      response.end(bytes);
      return;
    }
    stats.ranges.push(range);
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416);
      response.end();
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(bytes.length - 1, match[2] ? Number(match[2]) : bytes.length - 1);
    if (start >= bytes.length || end < start) {
      response.writeHead(416, { 'content-range': 'bytes */' + bytes.length });
      response.end();
      return;
    }
    const selected = bytes.subarray(start, end + 1);
    response.writeHead(206, {
      ...headers,
      'content-length': String(selected.length),
      'content-range': `bytes ${start}-${end}/${bytes.length}`,
    });
    const controller = new AbortController();
    request.on('close', () => controller.abort(new Error('request closed')));
    void writeStream(response, stream(selected, {
      signal: controller.signal,
      delayMs: range === 'bytes=0-0' ? 0 : delayMs,
      chunkSize,
      onChange: range === 'bytes=0-0' ? undefined : change,
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    stats,
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

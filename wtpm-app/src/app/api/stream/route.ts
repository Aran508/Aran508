import type { Client } from 'pg';
import { newClient } from '@/lib/db';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Server-Sent Events: every open dashboard / report / records page listens here.
 * Saves anywhere (any tablet, any PC, any server instance) are broadcast with PostgreSQL
 * LISTEN/NOTIFY, so all screens refresh within about a second.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const enc = new TextEncoder();
  let client: Client;
  try {
    client = await newClient();
  } catch {
    return new Response('Database unavailable', { status: 503 });
  }
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => {
        if (!closed) controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
      };
      try {
        await client.connect();
        client.on('notification', (n) => send('change', n.payload ?? '{}'));
        client.on('error', () => cleanup());
        await client.query('LISTEN wtpm_changes');
        send('ready', JSON.stringify({ user: user.username }));
      } catch {
        send('error', '{}');
        cleanup();
      }
      const ping = setInterval(() => send('ping', String(Date.now())), 25000);
      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        client.end().catch(() => undefined);
        try { controller.close(); } catch { /* already closed */ }
      }
      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      closed = true;
      client.end().catch(() => undefined);
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}

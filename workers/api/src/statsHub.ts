export class StatsHub {
  private clients = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  private revision = 0;

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/stream")) {
      const stream = new TransformStream();
      const writer = stream.writable.getWriter();
      this.clients.add(writer);

      const encoder = new TextEncoder();
      await writer.write(encoder.encode(`event: connected\ndata: {"ok":true}\n\n`));

      request.signal.addEventListener("abort", () => {
        this.clients.delete(writer);
        writer.close().catch(() => undefined);
      });

      return new Response(stream.readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        }
      });
    }

    if (url.pathname.endsWith("/broadcast")) {
      const payload = await request.text();
      this.revision += 1;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        obj = {};
      }
      obj.revision = this.revision;
      await this.broadcast(JSON.stringify(obj));
      return new Response("ok");
    }

    if (request.method === "GET" && url.pathname.endsWith("/revision")) {
      return new Response(JSON.stringify({ revision: this.revision }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("not found", { status: 404 });
  }

  private async broadcast(payload: string) {
    const encoder = new TextEncoder();
    const message = encoder.encode(`event: stats_update\ndata: ${payload}\n\n`);
    const dead: Array<WritableStreamDefaultWriter<Uint8Array>> = [];
    for (const client of this.clients) {
      try {
        await client.write(message);
      } catch {
        dead.push(client);
      }
    }
    for (const d of dead) {
      this.clients.delete(d);
      d.close().catch(() => undefined);
    }
  }
}

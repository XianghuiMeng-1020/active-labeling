/**
 * Durable Object: drives ED-AL v1 execution via alarm()-based chunking.
 * Each alarm fires one batch step by calling the Worker's internal endpoint,
 * avoiding Cloudflare's Worker self-fetch recursion depth limit.
 */
import type { Env } from "./types";

export class AlRunner {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/start") {
      const { runId, origin } = (await request.json()) as {
        runId: string;
        origin: string;
      };
      await this.state.storage.put("runId", runId);
      await this.state.storage.put("origin", origin);
      await this.state.storage.put("retries", 0);
      await this.state.storage.setAlarm(Date.now() + 200);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/cancel") {
      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  }

  async alarm() {
    const runId = await this.state.storage.get<string>("runId");
    const origin = await this.state.storage.get<string>("origin");
    if (!runId || !origin) return;

    const stepUrl =
      `${origin}/api/internal/al/step` +
      `?run_id=${encodeURIComponent(runId)}` +
      `&secret=${encodeURIComponent(this.env.ADMIN_TOKEN)}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 28_000);
      const resp = await fetch(stepUrl, {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        console.error(
          `[AlRunner] step returned ${resp.status} for ${runId.slice(0, 8)}: ${body.slice(0, 200)}`
        );
        const retries = (await this.state.storage.get<number>("retries")) ?? 0;
        if (retries < 3) {
          await this.state.storage.put("retries", retries + 1);
          await this.state.storage.setAlarm(Date.now() + 3000 * (retries + 1));
        } else {
          await this.markError(runId, `Step failed after retries: HTTP ${resp.status}`);
        }
        return;
      }

      const data = (await resp.json()) as {
        ok?: boolean;
        done?: boolean;
        error?: string;
      };

      await this.state.storage.put("retries", 0);

      if (data.done) {
        console.log(`[AlRunner] Run ${runId.slice(0, 8)} completed`);
        await this.state.storage.deleteAll();
      } else if (data.error) {
        console.error(`[AlRunner] Run ${runId.slice(0, 8)} step error: ${data.error}`);
        await this.state.storage.deleteAll();
      } else {
        await this.state.storage.setAlarm(Date.now() + 300);
      }
    } catch (err: any) {
      console.error(`[AlRunner] alarm error for ${runId.slice(0, 8)}:`, err);
      const retries = (await this.state.storage.get<number>("retries")) ?? 0;
      if (retries < 5) {
        await this.state.storage.put("retries", retries + 1);
        await this.state.storage.setAlarm(Date.now() + 3000 * (retries + 1));
      } else {
        await this.markError(runId, `DO alarm failed: ${err?.message}`);
      }
    }
  }

  private async markError(runId: string, msg: string) {
    try {
      await this.env.DB.prepare(
        "UPDATE al_runs SET status='error', detail_json=? WHERE run_id=? AND status='running'"
      )
        .bind(JSON.stringify({ error: msg }), runId)
        .run();
    } catch { /* best effort */ }
    await this.state.storage.deleteAll();
  }
}

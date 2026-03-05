/**
 * Durable Object: global rate limiter for Qwen API calls.
 * - Limits concurrent in-flight calls to maxConcurrent (env QWEN_MAX_CONCURRENT, default 2).
 * - Records: qwen_calls_total, qwen_429_total, retries_total, latency sum/count for avg.
 */
import type { Env } from "./types";

const DEFAULT_MAX_CONCURRENT = 2;

type Metrics = {
  calls_total: number;
  status_429_total: number;
  retries_total: number;
  latency_sum_ms: number;
  latency_n: number;
};

export class QwenRateLimiter {
  private inFlight = 0;
  private queue: Array<() => void> = [];
  private readonly maxConcurrent: number;
  private metrics: Metrics = {
    calls_total: 0,
    status_429_total: 0,
    retries_total: 0,
    latency_sum_ms: 0,
    latency_n: 0
  };

  constructor(_state: DurableObjectState, env: Env) {
    const n = parseInt(env.QWEN_MAX_CONCURRENT ?? "", 10);
    this.maxConcurrent = Number.isFinite(n) && n >= 1 && n <= 20 ? n : DEFAULT_MAX_CONCURRENT;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/acquire")) {
      await this.acquire();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (request.method === "POST" && url.pathname.endsWith("/release")) {
      const body = (await request.json()) as {
        status?: number;
        latency_ms?: number;
        retries?: number;
      };
      this.release(body.status, body.latency_ms, body.retries);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (request.method === "GET" && url.pathname.endsWith("/metrics")) {
      const avg =
        this.metrics.latency_n > 0
          ? Math.round(this.metrics.latency_sum_ms / this.metrics.latency_n)
          : 0;
      return new Response(
        JSON.stringify({
          qwen_calls_total: this.metrics.calls_total,
          qwen_429_total: this.metrics.status_429_total,
          retries_total: this.metrics.retries_total,
          avg_latency_ms: avg
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }

  private async acquire(): Promise<void> {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
    this.inFlight += 1;
  }

  private release(status?: number, latencyMs?: number, retries?: number): void {
    this.metrics.calls_total += 1;
    if (status === 429) this.metrics.status_429_total += 1;
    if (typeof retries === "number") this.metrics.retries_total += retries;
    if (typeof latencyMs === "number") {
      this.metrics.latency_sum_ms += latencyMs;
      this.metrics.latency_n += 1;
    }
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

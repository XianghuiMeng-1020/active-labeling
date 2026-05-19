const WORKER_ORIGIN = "https://sentence-labeling-api.xmeng19.workers.dev";

export const onRequest: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url);
  const target = new URL(`${url.pathname}${url.search}`, WORKER_ORIGIN);

  const headers = new Headers(ctx.request.headers);
  headers.set("Host", new URL(WORKER_ORIGIN).host);

  const init: RequestInit = {
    method: ctx.request.method,
    headers,
    redirect: "manual",
  };
  if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") {
    init.body = ctx.request.body;
    // @ts-expect-error duplex needed for streaming body
    init.duplex = "half";
  }

  return fetch(target.toString(), init);
};

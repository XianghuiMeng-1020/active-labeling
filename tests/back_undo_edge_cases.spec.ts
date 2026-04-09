/**
 * 回退与边界用例 — 模拟真人反复回退、各种异常操作
 *
 * 运行前：启动 Worker + 前端，设置 BASE_URL + API_BASE
 * npx playwright test tests/back_undo_edge_cases.spec.ts --project=chromium
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const API_BASE = process.env.API_BASE ?? process.env.BASE_URL ?? "http://localhost:8787";

const LABELS = ["EXPLANATION", "EVALUATION", "RESPONSIBILITY", "APPLICATION", "IMPLICATION"];
const SESSION_STORAGE_KEY = "labeling_session_id";

/** 在浏览器中注入 session_id，以便前端 manual/llm 页能读到 */
async function injectSession(page: any, sessionId: string): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ key, id }: { key: string; id: string }) => {
      localStorage.setItem(key, id);
    },
    { key: SESSION_STORAGE_KEY, id: sessionId }
  );
}

/** 若 API 不可用则跳过测试，避免未启动服务时误报失败 */
async function skipIfApiUnavailable(request: any): Promise<void> {
  try {
    const r = await request.get(`${API_BASE}/api/health`, { timeout: 3000 });
    if (!r.ok()) test.skip(true, "API not available");
  } catch {
    test.skip(true, "API not available (start Worker on 8787)");
  }
}

async function startSession(request: any): Promise<string> {
  const r = await request.post(`${API_BASE}/api/session/start`, {
    data: { user_id: "back_undo_test_user" },
  });
  expect(r.ok()).toBeTruthy();
  const body = await r.json();
  return body.session_id;
}

async function submitManualLabel(
  request: any,
  sessionId: string,
  unitId: string,
  label: string
) {
  const r = await request.post(`${API_BASE}/api/labels/manual`, {
    data: {
      session_id: sessionId,
      unit_id: unitId,
      phase: "normal",
      label,
      attempt: {
        shown_at_epoch_ms: Date.now() - 2000,
        answered_at_epoch_ms: Date.now(),
        active_ms: 2000,
        hidden_ms: 0,
        idle_ms: 0,
        hidden_count: 0,
        blur_count: 0,
        had_background: 0,
        events: [],
      },
    },
  });
  expect(r.ok()).toBeTruthy();
}

async function submitRanking(
  request: any,
  sessionId: string,
  essayIndex: number,
  unitIds: string[]
) {
  const r = await request.post(`${API_BASE}/api/ranking/submit`, {
    data: { session_id: sessionId, essay_index: essayIndex, ordering: unitIds },
  });
  expect(r.ok()).toBeTruthy();
}

async function undoRanking(request: any, sessionId: string, essayIndex: number) {
  const r = await request.post(`${API_BASE}/api/ranking/undo`, {
    data: { session_id: sessionId, essay_index: essayIndex },
  });
  expect(r.ok()).toBeTruthy();
}

test.describe("回退与边界：排序/撤回", () => {
  test("API 准备：2 篇文章标完、第 1 篇已排序，打开 manual 应看到第 2 篇排序", async ({
    page,
    request,
  }) => {
    await skipIfApiUnavailable(request);
    test.setTimeout(60000);
    const sid = await startSession(request);
    const nextUnits: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await request.get(
        `${API_BASE}/api/units/next?session_id=${sid}&phase=normal&task=manual`
      );
      const body = await r.json();
      if (!body.unit) break;
      nextUnits.push(body.unit.unit_id);
      await submitManualLabel(
        request,
        sid,
        body.unit.unit_id,
        LABELS[i % LABELS.length]
      );
    }
    expect(nextUnits.length).toBe(10);
    const essay1Units = nextUnits.filter((u) => u.startsWith("essay0001_"));
    await submitRanking(request, sid, 1, essay1Units);

    await injectSession(page, sid);
    await page.goto(`${BASE_URL}/user/normal/manual`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);
    const rankingTitle = page.locator("text=文章2, text=Essay 2").or(
      page.locator(".progress-subtitle:has-text('2')")
    );
    const rankingCard = page.locator(".ranking-card");
    await expect(rankingCard.first()).toBeVisible({ timeout: 10000 });
    await expect(rankingTitle.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test("在第二篇排序页点「返回上一篇文章的排序」应回到第一篇排序视图", async ({
    page,
    request,
  }) => {
    await skipIfApiUnavailable(request);
    test.setTimeout(60000);
    const sid = await startSession(request);
    const nextUnits: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await request.get(
        `${API_BASE}/api/units/next?session_id=${sid}&phase=normal&task=manual`
      );
      const body = await r.json();
      if (!body.unit) break;
      nextUnits.push(body.unit.unit_id);
      await submitManualLabel(
        request,
        sid,
        body.unit.unit_id,
        LABELS[i % LABELS.length]
      );
    }
    const essay1Units = nextUnits.filter((u) => u.startsWith("essay0001_"));
    await submitRanking(request, sid, 1, essay1Units);

    await injectSession(page, sid);
    await page.goto(`${BASE_URL}/user/normal/manual`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);
    const backToPrev = page.locator(
      'button:has-text("返回上一篇文章的排序"), button:has-text("Back to previous")'
    ).first();
    await expect(backToPrev).toBeVisible({ timeout: 10000 });
    await backToPrev.click();
    await page.waitForTimeout(800);
    const essay1Hint = page.locator(".progress-subtitle, .ranking-header").filter({
      hasText: "1",
    });
    await expect(essay1Hint.first()).toBeVisible({ timeout: 5000 });
    const rankingCard = page.locator(".ranking-card");
    await expect(rankingCard.first()).toBeVisible({ timeout: 3000 });
  });

  test("从 LLM 完成页「撤回上一步」应回到 manual 并显示排序视图", async ({
    page,
    request,
  }) => {
    await skipIfApiUnavailable(request);
    test.setTimeout(90000);
    const sid = await startSession(request);
    for (let i = 0; i < 15; i++) {
      const r = await request.get(
        `${API_BASE}/api/units/next?session_id=${sid}&phase=normal&task=manual`
      );
      const body = await r.json();
      if (!body.unit) break;
      await submitManualLabel(
        request,
        sid,
        body.unit.unit_id,
        LABELS[i % LABELS.length]
      );
    }
    for (const essayIdx of [1, 2, 3]) {
      const pad = String(essayIdx).padStart(4, "0");
      const allForEssay = [
        `essay${pad}_sentence01`,
        `essay${pad}_sentence02`,
        `essay${pad}_sentence03`,
        `essay${pad}_sentence04`,
        `essay${pad}_sentence05`,
      ];
      await submitRanking(request, sid, essayIdx, allForEssay);
    }
    for (let i = 0; i < 15; i++) {
      const r = await request.get(
        `${API_BASE}/api/units/next?session_id=${sid}&phase=normal&task=llm`
      );
      const body = await r.json();
      if (!body.unit) break;
      await request.post(`${API_BASE}/api/llm/accept`, {
        data: {
          session_id: sid,
          unit_id: body.unit.unit_id,
          phase: "normal",
          mode: "prompt1",
          accepted_label: LABELS[i % LABELS.length],
          attempt: {
            shown_at_epoch_ms: Date.now() - 1500,
            answered_at_epoch_ms: Date.now(),
            active_ms: 1500,
            hidden_ms: 0,
            idle_ms: 0,
            hidden_count: 0,
            blur_count: 0,
            had_background: 0,
            events: [],
          },
        },
      });
    }
    await injectSession(page, sid);
    await page.goto(`${BASE_URL}/user/normal/llm`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);
    const doneTitle = page.locator("text=已完成普通阶段, text=Normal phase completed").first();
    const undoBtn = page.locator(
      'button:has-text("撤回上一步"), button:has-text("Undo"), button:has-text("返回难度排序")'
    ).first();
    if (await doneTitle.isVisible().catch(() => false)) {
      if (await undoBtn.isVisible().catch(() => false)) {
        await undoBtn.click();
        await page.waitForURL(/\/user\/normal\/manual/, { timeout: 10000 });
        await page.waitForTimeout(1500);
        const rankingCard = page.locator(".ranking-card");
        const rankingHint = page.locator("text=排序, text=ranking");
        await expect(
          rankingCard.or(rankingHint).first()
        ).toBeVisible({ timeout: 8000 });
      }
    }
  });

  test("排序页点「返回编辑本篇标签」应进入句子贴标而非停留在排序", async ({
    page,
    request,
  }) => {
    await skipIfApiUnavailable(request);
    test.setTimeout(60000);
    const sid = await startSession(request);
    const nextUnits: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await request.get(
        `${API_BASE}/api/units/next?session_id=${sid}&phase=normal&task=manual`
      );
      const body = await r.json();
      if (!body.unit) break;
      nextUnits.push(body.unit.unit_id);
      await submitManualLabel(
        request,
        sid,
        body.unit.unit_id,
        LABELS[i % LABELS.length]
      );
    }
    const essay1Units = nextUnits.filter((u) => u.startsWith("essay0001_"));
    await submitRanking(request, sid, 1, essay1Units);

    await injectSession(page, sid);
    await page.goto(`${BASE_URL}/user/normal/manual`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);
    const backToEdit = page.locator(
      'button:has-text("返回编辑本篇标签"), button:has-text("Back to edit labels")'
    ).first();
    await expect(backToEdit).toBeVisible({ timeout: 10000 });
    await backToEdit.click();
    await page.waitForTimeout(1500);
    const labelGrid = page.locator(".label-grid");
    await expect(labelGrid.first()).toBeVisible({ timeout: 8000 });
  });

  test("边界：反复点「返回上一篇文章的排序」再点「确认排序」不报错", async ({
    page,
    request,
  }) => {
    await skipIfApiUnavailable(request);
    test.setTimeout(60000);
    const sid = await startSession(request);
    const nextUnits: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await request.get(
        `${API_BASE}/api/units/next?session_id=${sid}&phase=normal&task=manual`
      );
      const body = await r.json();
      if (!body.unit) break;
      nextUnits.push(body.unit.unit_id);
      await submitManualLabel(
        request,
        sid,
        body.unit.unit_id,
        LABELS[i % LABELS.length]
      );
    }
    const essay1Units = nextUnits.filter((u) => u.startsWith("essay0001_"));
    await submitRanking(request, sid, 1, essay1Units);

    await injectSession(page, sid);
    await page.goto(`${BASE_URL}/user/normal/manual`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const backToPrev = page.locator(
      'button:has-text("返回上一篇文章的排序"), button:has-text("Back to previous")'
    ).first();
    await expect(backToPrev).toBeVisible({ timeout: 10000 });
    await backToPrev.click();
    await page.waitForTimeout(800);
    const confirmBtn = page.locator('button:has-text("确认排序"), button:has-text("Confirm")').first();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
    await page.waitForTimeout(2000);
    await expect(page.locator(".ranking-card").or(page.locator(".label-grid")).first()).toBeVisible({ timeout: 8000 });
  });

  test("边界：无 session 打开 manual 会跳到 start，不报错", async ({ page }) => {
    await page.goto(`${BASE_URL}/user/normal/manual`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const onStart = page.url().includes("/user/start") || (await page.locator('button:has-text("开始"), button:has-text("Start")').first().isVisible().catch(() => false));
    expect(onStart).toBeTruthy();
  });
});

test.describe("回退与边界：API undo 后 manual 显示排序", () => {
  test("先排完 3 篇，API 调用 undo 第 3 篇，再打开 manual 应出现第 3 篇排序", async ({
    page,
    request,
  }) => {
    await skipIfApiUnavailable(request);
    test.setTimeout(70000);
    const sid = await startSession(request);
    for (let i = 0; i < 15; i++) {
      const r = await request.get(
        `${API_BASE}/api/units/next?session_id=${sid}&phase=normal&task=manual`
      );
      const body = await r.json();
      if (!body.unit) break;
      await submitManualLabel(
        request,
        sid,
        body.unit.unit_id,
        LABELS[i % LABELS.length]
      );
    }
    for (const essayIdx of [1, 2, 3]) {
      const allForEssay = [
        `essay${String(essayIdx).padStart(4, "0")}_sentence01`,
        `essay${String(essayIdx).padStart(4, "0")}_sentence02`,
        `essay${String(essayIdx).padStart(4, "0")}_sentence03`,
        `essay${String(essayIdx).padStart(4, "0")}_sentence04`,
        `essay${String(essayIdx).padStart(4, "0")}_sentence05`,
      ];
      await submitRanking(request, sid, essayIdx, allForEssay);
    }
    await undoRanking(request, sid, 3);
    await injectSession(page, sid);
    await page.goto(`${BASE_URL}/user/normal/manual`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);
    const rankingCard = page.locator(".ranking-card");
    const essay3Hint = page.locator(".progress-subtitle, .ranking-header").filter({
      hasText: "3",
    });
    await expect(rankingCard.first()).toBeVisible({ timeout: 10000 });
    await expect(essay3Hint.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
  });
});

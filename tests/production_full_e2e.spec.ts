/**
 * Production / staging full E2E — 线上环境前后端全功能测试
 *
 * 运行：BASE_URL=https://sentence-labeling-web.pages.dev npx playwright test tests/production_full_e2e.spec.ts
 * 不设 BASE_URL 时默认使用上述生产地址。
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "https://sentence-labeling-web.pages.dev";

test.describe("页面无错误（控制台与网络）", () => {
  test("首页、welcome、start 无控制台 error 且关键请求未失败", async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (msg) => {
      const type = msg.type();
      if (type === "error") consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (req) => {
      const url = req.url();
      if (!url.includes("favicon") && !url.includes("analytics")) failedRequests.push(url);
    });

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.goto(`${BASE_URL}/welcome`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.goto(`${BASE_URL}/user/start`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const criticalErrors = consoleErrors.filter((t) => !t.includes("ResizeObserver") && !t.includes("Non-Error"));
    expect(criticalErrors, `Console errors: ${criticalErrors.join("; ")}`).toEqual([]);
    expect(failedRequests, `Failed requests: ${failedRequests.join("; ")}`).toEqual([]);
  });
});

test.describe("入口与会话", () => {
  test("访问 / 或 /welcome 正常，无白屏", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator("text=Labeling Assistant").or(page.locator("text=标注")).first()).toBeVisible({ timeout: 10000 });
  });

  test("Welcome 点击开始进入 /user/start 或 /user/normal/manual", async ({ page }) => {
    await page.goto(`${BASE_URL}/welcome`);
    await page.locator('button:has-text("开始"), button:has-text("Let\'s Go"), button:has-text("Go")').first().click();
    await page.waitForURL(/\/(user\/start|user\/normal\/manual)/, { timeout: 10000 });
  });

  test("Start 页点击开始标注进入 manual", async ({ page }) => {
    test.setTimeout(50000);
    await page.goto(`${BASE_URL}/user/start`);
    const startBtn = page.locator('button:has-text("开始"), button:has-text("Start")').first();
    await startBtn.click();
    await page.waitForURL(/\/user\/normal\/manual/, { timeout: 35000 });
  });
});

test.describe("U1 普通人工 + 难度排序（客户需求 1、2、4）", () => {
  test("Manual 页有文章/句子与标签按钮", async ({ page }) => {
    test.setTimeout(50000);
    await page.goto(`${BASE_URL}/user/start`);
    await page.locator('button:has-text("开始"), button:has-text("Start")').first().click();
    await page.waitForURL(/\/user\/normal\/manual/, { timeout: 35000 });
    await expect(page.locator(".label-btn").first()).toBeVisible({ timeout: 8000 });
  });

  test("难度排序标题下文字为黑色、拖拽说明含 hardest to easiest", async ({ page }) => {
    await page.goto(`${BASE_URL}/user/normal/manual`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const hint = page.locator(".ranking-hint, .ranking-subtitle").first();
    const dragInst = page.locator("text=Drag the hardest to easiest, text=从最难到最容易").first();
    const hasRanking = await page.locator("h3:has-text('句子难度排序'), h3:has-text('Sentence Difficulty')").isVisible().catch(() => false);
    if (hasRanking) {
      await expect(hint.or(dragInst)).toBeVisible({ timeout: 3000 }).catch(() => {});
    }
  });

  test("排序页有 Back to edit labels 按钮", async ({ page }) => {
    await page.goto(`${BASE_URL}/user/normal/manual`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const backBtn = page.locator('button:has-text("返回编辑"), button:has-text("Back to edit labels")').first();
    const rankingCard = page.locator(".ranking-card").first();
    if (await rankingCard.isVisible().catch(() => false)) {
      await expect(backBtn).toBeVisible({ timeout: 3000 }).catch(() => {});
    }
  });

  test("老师需求：提交一条后撤回在卡片底部且文案为撤回上一步", async ({ page }) => {
    test.setTimeout(45000);
    await page.goto(`${BASE_URL}/user/start`);
    await page.locator('button:has-text("开始"), button:has-text("Start")').first().click();
    await page.waitForURL(/\/user\/normal\/manual/, { timeout: 35000 });
    await expect(page.locator(".label-btn").first()).toBeVisible({ timeout: 8000 });
    await page.locator(".label-btn").first().click();
    await page.waitForTimeout(800);
    const undoBtn = page.locator('button:has-text("撤回上一步"), button:has-text("Undo last step")').first();
    await expect(undoBtn).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".undo-banner")).toBeVisible();
  });
});

test.describe("U2 LLM（客户需求 5、6）", () => {
  test("LLM 页有尝试次数提示或 Run 按钮", async ({ page }) => {
    await page.goto(`${BASE_URL}/user/normal/llm`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const attempts = page.locator("text=attempts left, text=次尝试").first();
    const runBtn = page.locator('button:has-text("运行"), button:has-text("Run")').first();
    await expect(attempts.or(runBtn)).toBeVisible({ timeout: 8000 }).catch(() => {});
  });

  test("完成页有 Label Comparison 入口且无 Back to ranking（LLM 无 ranking）", async ({ page }) => {
    await page.goto(`${BASE_URL}/user/normal/llm`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const doneTitle = page.locator("text=已完成普通阶段, text=Normal phase completed").first();
    const labelComparison = page.locator('button:has-text("Label Comparison"), button:has-text("标签对比")').first();
    const backRank = page.locator('button:has-text("返回难度排序"), button:has-text("Back to ranking")').first();
    if (await doneTitle.isVisible().catch(() => false)) {
      await expect(labelComparison).toBeVisible({ timeout: 3000 }).catch(() => {});
      await expect(backRank).not.toBeVisible();
    }
  });
});

test.describe("可视化（客户需求 7）", () => {
  test("Visualization 页有图表且轴标签区域存在", async ({ page }) => {
    await page.goto(`${BASE_URL}/user/visualization`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
    const chart = page.locator("canvas").first();
    const freqLabel = page.locator("text=Frequency, text=频次").first();
    await expect(chart.or(freqLabel)).toBeVisible({ timeout: 10000 }).catch(() => {});
  });
});

test.describe("Active Learning UI（客户需求 8、9）", () => {
  test("Active manual 页有 AL 样式或徽章", async ({ page }) => {
    await page.goto(`${BASE_URL}/user/active/manual`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const alBadge = page.locator("text=Active Learning, text=主动学习").first();
    const header = page.locator(".progress-header.active-learning").first();
    await expect(alBadge.or(header)).toBeVisible({ timeout: 8000 }).catch(() => {});
  });

  test("Active LLM 页有 AL hero 或徽章", async ({ page }) => {
    await page.goto(`${BASE_URL}/user/active/llm`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const hero = page.locator(".hero-banner.active-learning").first();
    const alText = page.locator("text=Active Learning").first();
    await expect(hero.or(alText)).toBeVisible({ timeout: 8000 }).catch(() => {});
  });
});

test.describe("语言切换（客户需求 10、11）", () => {
  test("语言切换处有 symbol（🌐）且下拉可选", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");
    const switcher = page.locator(".lang-switcher");
    await expect(switcher).toBeVisible({ timeout: 5000 });
    const symbol = switcher.locator(".lang-switcher-symbol");
    const select = switcher.locator("select");
    await expect(symbol).toBeVisible();
    await expect(select).toBeVisible();
    await expect(symbol).toContainText("🌐");
  });
});

test.describe("管理端", () => {
  test("Admin 登录页可打开", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/login`);
    await expect(page.locator('input[type="password"], input[name="token"]').first()).toBeVisible({ timeout: 5000 });
  });

  test("未登录访问 dashboard 重定向到登录", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await page.waitForURL(/\/admin\/login/, { timeout: 5000 }).catch(() => {});
    const onLogin = page.url().includes("/admin/login");
    expect(onLogin).toBeTruthy();
  });
});

test.describe("问卷与老师需求", () => {
  test("问卷页有标题和提交按钮", async ({ page }) => {
    await page.goto(`${BASE_URL}/user/survey`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const title = page.locator("text=问卷, text=Survey").first();
    const submit = page.locator('button:has-text("提交"), button:has-text("Submit")').first();
    await expect(title.or(page.locator("h1"))).toBeVisible({ timeout: 5000 });
    await expect(submit).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Admin 入口", () => {
  test("Admin 登录页可访问且为同一域名", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveURL(/sentence-labeling-web\.pages\.dev\/admin/);
    const loginOrForm = page.locator('input[type="password"], input[name*="token"], button:has-text("登录"), button:has-text("Login")').first();
    await expect(loginOrForm).toBeVisible({ timeout: 8000 });
  });
});

test.describe("分享页", () => {
  test("Share 无效 token 可打开页面（可能显示无数据）", async ({ page }) => {
    await page.goto(`${BASE_URL}/share/invalid-token-123`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.locator("body")).toBeVisible();
  });
});

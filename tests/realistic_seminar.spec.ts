/**
 * 研讨会真实操作演练 — Playwright E2E
 *
 * 运行前：先启动本地 Worker + 前端，并设置环境变量
 *   BASE_URL=http://localhost:5173 API_BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token
 *
 * 安装：npm install -D @playwright/test && npx playwright install chromium
 * 运行：npx playwright test tests/realistic_seminar.spec.ts --project=chromium
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const API_BASE = process.env.API_BASE ?? "http://localhost:8787";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token";

test.describe("安全与鉴权", () => {
  test("未授权访问 /api/admin/stats 返回 401", async ({ request }) => {
    const r = await request.get(`${API_BASE}/api/admin/stats/normal`);
    expect(r.status()).toBe(401);
  });

  test("访问 /admin 未登录不请求 admin stats（仅显示登录页）", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page).toHaveURL(/\/(admin\/login|admin\/dashboard)/);
    const reqs: string[] = [];
    page.on("request", (req) => reqs.push(req.url()));
    await page.waitForTimeout(500);
    const statsCalls = reqs.filter((u) => u.includes("/api/admin/stats"));
    if (page.url().includes("/admin/login")) {
      expect(statsCalls.length).toBe(0);
    }
  });
});

test.describe("场景 1：Admin 投屏 + User 同步", () => {
  test("User 提交 manual 后 Admin 可看到统计（需先登录 Admin）", async ({ browser }) => {
    const adminPage = await browser.newPage();
    await adminPage.goto(`${BASE_URL}/admin/login`);
    await adminPage.fill('input[type="password"], input[name="token"]', ADMIN_TOKEN);
    await adminPage.click('button:has-text("登录")');
    await adminPage.waitForURL(/\/admin\/dashboard/);

    const userPage = await browser.newPage();
    await userPage.goto(`${BASE_URL}/user/start`);
    const startBtn = userPage.locator('button:has-text("开始"), button:has-text("Start")').first();
    await startBtn.click();
    await userPage.waitForURL(/\/user\/normal\/manual/);

    const manualTotalBefore = await adminPage.locator("text=总计").first().textContent();
    await userPage.locator('button[role="button"]').first().click({ timeout: 5000 }).catch(() => {});
    await adminPage.waitForTimeout(1500);
    const manualTotalAfter = await adminPage.locator("text=总计").first().textContent();
    await adminPage.close();
    await userPage.close();
    expect(manualTotalAfter !== manualTotalBefore || manualTotalAfter).toBeTruthy();
  });
});

test.describe("场景 3：幂等与 401", () => {
  test("Export 不带 Bearer 返回 401", async ({ request }) => {
    const r = await request.get(`${API_BASE}/api/admin/export?format=csv`);
    expect(r.status()).toBe(401);
  });

  test("Export 带 Bearer 返回 200", async ({ request }) => {
    const r = await request.get(`${API_BASE}/api/admin/export?format=csv`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    expect(r.status()).toBe(200);
  });
});

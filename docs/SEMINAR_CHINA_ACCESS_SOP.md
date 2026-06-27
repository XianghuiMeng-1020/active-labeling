# MNotation Seminar 大陆访问 SOP

> 适用场景：清华（北京）用户无法直接访问 `mnotation.pages.dev` 的一次性研讨会
> 方案：腾讯云香港 VPS + Caddy 反向代理

---

## 一、你需要手动完成的 3 步（需要你本人操作）

### 步骤 A：购买腾讯云香港 VPS（需付款，约 ¥24/月）

1. 打开：https://cloud.tencent.com/product/lighthouse
2. 点击"立即选购"
3. 配置选择：
   - **地域**：香港
   - **镜像**：Ubuntu 22.04 LTS
   - **套餐**：2核2G / 100Mbps 带宽（约 ¥24/月，或按量计费约 ¥0.1/小时）
   - **购买时长**：1个月（够用了，seminar 后可销毁）
4. 付款后记录下 **公网 IP 地址**（形如 `43.xxx.xxx.xxx`）

> 替代方案：阿里云轻量·香港（同规格，但带宽只有 30Mbps，建议腾讯云）

### 步骤 B：购买域名（如已有域名则跳过）

你需要一个**任意域名**（不需要备案，因为指向香港 IP）：

- Cloudflare Registrar：https://dash.cloudflare.com（`.com` 约 $9/年，支持支付宝）
- 或 Namesilo：https://www.namesilo.com（`.com` 约 $10/年）
- 如果你已有 `.com/.net/.xyz` 等域名可直接使用，跳过这步

准备一个**二级域名**，例如：`mn.你的域名.com`

### 步骤 C：DNS 配置（5 分钟）

在你的 DNS 服务商后台添加一条 A 记录：

| 类型 | 名称 | 值 | TTL |
|------|------|----|-----|
| A | `mn`（或你想要的前缀） | `购买到的 VPS 公网 IP` | 60 |

> 推荐用 Cloudflare DNS 管理（免费，TTL 生效快）：
> 1. 将域名的 nameserver 改到 Cloudflare
> 2. 在 Cloudflare DNS 添加 A 记录
> 3. **关闭橙色云朵（代理）**，选灰色 DNS only

---

## 二、我（或你）执行的部分（复制粘贴即可）

### 2.1 SSH 登录 VPS

```bash
# 替换为你的 VPS 公网 IP
ssh root@<VPS_IP>
```

### 2.2 一键安装反向代理（在 VPS 上运行）

```bash
# 下载并执行安装脚本（替换 mn.example.com 为你的域名）
curl -fsSL https://raw.githubusercontent.com/your-repo/setup_hk_proxy.sh | bash -s mn.example.com

# 或者直接粘贴完整命令（如果 GitHub 访问有问题）：
bash <(cat <<'SCRIPT_EOF'
# 将 scripts/setup_hk_proxy.sh 的内容粘贴到这里
SCRIPT_EOF
) mn.example.com
```

> **最简单的方法**：把 `scripts/setup_hk_proxy.sh` 文件用 `scp` 传到 VPS 再运行：
> ```bash
> # 在你的 Mac 上运行
> scp scripts/setup_hk_proxy.sh root@<VPS_IP>:/root/
> ssh root@<VPS_IP> "bash /root/setup_hk_proxy.sh mn.你的域名.com"
> ```

### 2.3 验证代理正常（在你的 Mac 上运行）

```bash
# 等 DNS 生效后（通常 1~5 分钟），在本机运行：
bash scripts/verify_hk_proxy.sh https://mn.你的域名.com

# 安装压测工具（如果没有）
brew install hey
```

预期输出：`🎉 代理完全就绪，可以发布给清华同学！`

### 2.4 生成用户二维码

```bash
# 安装 qrencode（如果没有）
brew install qrencode

# 生成二维码图片
qrencode -o seminar_qr.png "https://mn.你的域名.com/user/start"
open seminar_qr.png
```

---

## 三、Seminar 当天操作流程

### T-24小时：清华同学提前测试

发送以下内容给 1-2 名清华同学：

```
测试链接（清华内网/手机均可访问）：
https://mn.你的域名.com/user/start

请帮忙确认：
1. 页面是否能正常打开？
2. 顶部绿色条显示"连接正常 xxms"了吗？
3. 填写昵称后能否进入标注页面？
```

### T-2小时：监控准备

```bash
# SSH 到 VPS 开启实时日志监控
ssh root@<VPS_IP>
tail -f /var/log/caddy/mnotation_access.log | grep -v "healthz"
```

### T-30分钟：最终检查清单

- [ ] 打开 `https://mn.你的域名.com/user/start` 确认正常
- [ ] 打开 `https://mn.你的域名.com/admin` 用 ADMIN_TOKEN 登录确认 Dashboard
- [ ] 准备好二维码大图（用于投屏）
- [ ] 在群里准备好备用链接文字（Plan B）

### T-0：发布二维码

**主链接（大陆用）**：
```
https://mn.你的域名.com/user/start
```

**Plan B（如果 VPS 出问题）**：
```
https://mnotation.pages.dev/user/start
（有 VPN 的同学用这个）
```

### 异常处理

| 现象 | 操作 |
|------|------|
| 二维码扫不开 | 立刻发群消息：手动输入链接 `mn.你的域名.com/user/start` |
| 页面打开但 API 报错 | SSH 到 VPS：`sudo systemctl restart caddy` |
| Caddy 挂了 | `sudo systemctl status caddy` 查看原因，`journalctl -u caddy -n 50` |
| VPS 完全挂了 | 在群里发 Plan B 链接，让有 VPN 的同学帮忙 |
| 50人同时提交卡顿 | 这是 Cloudflare D1 的正常限流，2-3 秒后重试，不影响数据 |

---

## 四、Seminar 结束后清理

```bash
# 数据导出（在你的 Mac 运行，Admin Token 从 .dev.vars 获取）
curl "https://mn.你的域名.com/api/admin/export?format=csv" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -o seminar_data_$(date +%Y%m%d).csv

# 验证导出成功后，销毁 VPS（腾讯云控制台 → 实例 → 销毁）
# 域名可以保留，以备下次使用
```

---

## 五、技术参数参考

| 指标 | 预期值 |
|------|--------|
| HK→北京 RTT | 50~100ms |
| 50 并发首屏加载时间 | < 3s |
| SSE 连接延迟（Admin Dashboard 更新） | < 200ms |
| VPS 出口带宽 | 100 Mbps |
| 50 并发 SSE 连接实际占用带宽 | < 1 Mbps（SSE 小包流） |
| 预期 CPU 使用率 | < 10%（Nginx/Caddy 几乎不消耗 CPU） |

---

*生成于 2026-05-20 | 如有问题参考 docs/TROUBLESHOOTING.md*

# 交接文档

> 给接手本项目的 AI / 开发者。配合 `CLAUDE.md`（架构说明）一起看。

---

## 一、项目路径

| 项目 | 路径 |
|------|------|
| **本机项目根目录** | `D:\ai_code\project\rental-system` |
| GitHub 仓库 | https://github.com/111221212q-ux/rental-system （**public**） |

> ⚠️ 仓库是公开的，**任何密钥/密码都不能写进代码或文档**。

---

## 二、当前部署状态 ⚠️ 有阻塞问题

| 平台 | 地址 | 状态 |
|------|------|------|
| **Sealos**（国内，在用） | https://nbbhlsyclkdc.sealosbja.site | ⚠️ 应用能跑，但**数据库没连上** |
| Railway（海外，已废弃） | rental.gggffxu.xyz | ❌ 试用到期，服务已暂停 |

### 阻塞问题根因

Sealos 服务器在国内，**解析不了 MongoDB Atlas 的 SRV 记录**：

```
mongoError: "querySrv ETIMEOUT _mongodb._tcp.cluster0.jqph8ma.mongodb.net"
```

导致应用自动回退到 **JSON 文件模式**，页面上看到的是代码里的 5 个测试用户（假数据）。

> ✅ **真实数据完好无损**，全部在 MongoDB Atlas 里。

### 解决方案（进行中）

在 **Sealos 上自建 MongoDB**（同机房内网连接，绕开跨境 DNS 问题），再把 Atlas 数据迁过去。

- 迁移脚本已就绪：`migrate-db.js`（用法见文件头部注释）
- 目标 MongoDB 应用的部署参数见下方「五、Sealos 自建 MongoDB 方案」

---

## 三、关键文件

### 真正在用的（改动只需动这些）

| 文件 | 说明 |
|------|------|
| `backend/server.js` | **后端全部代码**（单文件，所有路由都在这） |
| `frontend/public/app.html` | **前端全部代码**（HTML+CSS+JS 单文件 SPA） |
| `backend/models/*.js` | Mongoose 模型（User / Item / Rental / Comment） |
| `backend/services/sms.js` | 邮件发送（Resend API + QQ SMTP 双通道） |
| `docs/devlog.md` | 开发日志，记录每次改动 |
| `Dockerfile` | Sealos 部署用 |
| `.github/workflows/docker.yml` | 自动构建镜像推到 ghcr.io |
| `migrate-db.js` | **数据库迁移工具**（未提交到 git） |

### 部署流程

```
本地改代码 → git push → GitHub Actions 自动构建镜像
          → ghcr.io/111221212q-ux/rental-system:latest
          → Sealos 手动重启应用拉取新镜像
```

---

## 四、账号与密钥位置

> 文档和代码里**都不含密码**，请从以下位置获取：

| 内容 | 存放位置 |
|------|---------|
| 超级管理员账号 | 用户名 `sa_882f4ca6`（密码由用户本人掌握） |
| 所有密钥（MongoDB / JWT / 邮件 / Railway / GitHub） | Claude 记忆文件 `rental-system-secrets.md` |
| 本地开发环境变量 | `backend/.env`（已在 .gitignore 中，不进 git） |
| 生产环境变量 | Sealos 应用面板 → 环境变量 |

**已知管理员账号**（仅用户名）：
- `sa_882f4ca6` — 超级管理员
- `202332960128` — 管理员（张博涛）

---

## 五、Sealos 自建 MongoDB 方案（待执行）

### 目标架构

```
Sealos 集群（国内）
├── mongo 应用（MongoDB 7，内网 27017，5G 存储卷挂 /data/db）
└── 网站应用（连接 mongo 内网服务名）
```

### 步骤

**1. 部署 mongo 应用**

| 字段 | 值 |
|------|-----|
| 应用名 | `mongo` |
| 镜像仓库地址 | `docker.io` |
| 镜像名 | `mongo:7` |
| 端口 | `27017` |
| CPU / 内存 | 0.5 Core / 1 GB（512M 容易 OOM） |
| 存储卷 | 挂载路径 `/data/db`，容量 `5 Gi` |
| 环境变量 | `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD` |

**2. 临时开放公网端口 27017** → 从本机跑迁移脚本

```powershell
cd D:\ai_code\project\rental-system
$env:SRC='<Atlas 连接串>'
$env:DST='<Sealos 公网连接串>'
node migrate-db.js
```

**3. 迁移完成后立即关闭公网端口**

**4. 改网站应用的 `MONGODB_URI` 为内网地址**

```
mongodb://admin:<密码>@mongo:27017/rental-system?authSource=admin
```

> 内网服务名以 Sealos 应用详情页显示的为准。

**5. 重启网站应用，访问 `/api/health` 确认 `mongoError` 消失、数据条数正确**

---

## 六、健康检查

```
GET https://<域名>/api/health
```

返回示例（正常时应无 `mongoError` 字段）：

```json
{
  "status": "ok",
  "users": 12,
  "items": 6,
  "rentals": 22,
  "emailConfigured": true,
  "canReachInternet": true
}
```

> ⚠️ 如果 `users` 显示 `5` 且带 `mongoError`，说明仍在 JSON 回退模式，数据是假的。

---

## 七、开发注意事项

1. **`app.html` 是 CRLF 换行** — 用 Edit 工具改多行容易失败，建议用 Node 脚本批量改
2. **不要用 `mongoose.set('sanitizeFilter', true)`** — 与 Mongoose 9 不兼容，会导致日期查询报错
3. **前端用户数据必须 `esc()` 转义** — 防 XSS
4. **改完代码要验证语法**：
   ```bash
   node --check backend/server.js
   node -e "const s=require('fs').readFileSync('frontend/public/app.html','utf8');const m=s.match(/<script>([\s\S]*?)<\/script>/);new Function(m[1]);console.log('OK')"
   ```
5. **每次重大改动写 `docs/devlog.md`**
6. **push 需要代理**（国内直连 GitHub 常失败）

---

## 八、遗留的无关文件

以下文件是早期脚手架残留，**不影响运行，可忽略或清理**：

```
backend/config/db.js          ← 未使用
backend/mockUsers.js          ← 未使用
backend/models/Reservation.js ← 未使用
backend/test-api.js           ← 测试脚本
backend/test_accounts.md      ← 测试文档
frontend/dist/                ← 旧构建产物（实际用的是 frontend/public/）
frontend/index.html           ← Vite 脚手架残留
frontend/vite.config*.js      ← Vite 配置残留
frontend/simple-server.js     ← 未使用
```

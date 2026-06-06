# CLAUDE.md — 校园物品租借系统

## 项目概览

一个轻量级的校园物品租借管理平台。单页应用（原生 HTML/CSS/JS）+ Node.js/Express 5 后端 + MongoDB Atlas 数据库。

- **生产地址**：https://rental.gggffxu.xyz
- **GitHub**：https://github.com/111221212q-ux/rental-system (public)
- **部署**：Railway 自动部署，push master 即上线

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 前端 | 原生 HTML/CSS/JS (SPA) | — |
| 后端 | Express | 5.x |
| 数据库 | MongoDB via Mongoose | 9.x |
| 认证 | JWT + bcryptjs | — |
| 邮件 | Resend HTTP API | — |
| 部署 | Railway | — |

## 目录结构

```
rental-system/
├── backend/
│   ├── server.js          # 主入口，所有路由都在这里（单文件）
│   ├── models/            # Mongoose 模型
│   │   ├── User.js
│   │   ├── Item.js
│   │   ├── Rental.js
│   │   └── Comment.js
│   ├── services/
│   │   └── sms.js         # 邮件发送（Resend API）
│   ├── .env               # 本地环境变量（git ignored）
│   ├── .env.example       # 环境变量模板（已脱敏）
│   └── data.json          # JSON 回退存储（git ignored）
├── frontend/
│   └── public/
│       ├── app.html       # 全部前端代码（HTML+CSS+JS）
│       └── favicon.svg
├── docs/
│   └── devlog.md          # 开发日志
├── README.md
├── CLAUDE.md              # 本文件
└── package.json           # 依赖 + 启动脚本
```

## 架构要点

### 双模式存储
- **MongoDB 模式**（生产环境）：通过 `MONGODB_URI` 环境变量连接
- **JSON 文件模式**（本地回退）：不配置 MONGODB_URI 时自动使用 `backend/data.json`
- 所有路由都有 `if (useMongo) { ... } else { ... }` 双分支

### 用户角色
```
user → 普通用户（浏览、租借、看自己记录）
admin → 管理员（审批、领取、归还、管理物品）
superadmin → 超级管理员（用户管理、升降角色、测试数据生成）
```

### API 权限中间件
```js
auth        → 需要登录
admin       → 需要 admin 或 superadmin
superadmin  → 仅 superadmin
```

### 租借状态流转
```
pending → approved → active → returned
       → rejected
                → cancelled（自动：approved 过期未领取）
```

### 前端路由
- `#仪表板` `#物品列表` `#我的租借` `#个人设置` `#管理后台`
- 管理后台 6 个 Tab：待审核 / 待领取 / 租借中 / 物品管理 / 用户管理 / 数据统计
- 每个 Tab 有独立搜索框，实时筛选

### 关键全局变量（前端）
```js
currentUser   // 当前用户对象
allItems      // 所有物品
allRentals    // 所有租借记录（admin 可见）
myRentals     // 当前用户的租借
allUsers      // 所有用户（admin 可见）
adminContact  // 管理员联系方式
```

## 重要注意事项

### 文件编码
- `app.html` 使用 CRLF (`\r\n`) 换行，编辑时必须保持一致
- 使用 node 脚本批量修改比 Edit 工具更可靠

### MongoDB
- **不要使用 `mongoose.set('sanitizeFilter', true)`** — 与 Mongoose 9 不兼容
- 所有 `findById` 前应调用 `isValidObjectId()` 校验

### 前端渲染
- 用户可控数据必须用 `esc()` 函数转义防 XSS
- 图片 URL 用 `escUrl()` 校验
- 所有管理按钮加了 `_busy` 防重复提交

### 安全
- `.env` 不在 git 中，敏感信息通过环境变量注入
- JWT_SECRET 在 Railway 环境变量中
- GitHub 仓库是 public 的，不要把密码/密钥写在代码里

## 环境变量

```
PORT=5000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=...
RESEND_API_KEY=...
```

## 常用命令

```bash
npm start          # 启动服务 (localhost:5000)
node server.js     # 同上

# Git（需要 VPN/代理）
git pull
git push

# Railway 触发布署（需 token）
curl -x http://127.0.0.1:7892 \
  -H "Authorization: Bearer RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST https://backboard.railway.app/graphql/v2 \
  -d '{"query":"mutation { serviceInstanceRedeploy(environmentId: \"ENV_ID\", serviceId: \"SVC_ID\") }"}'

# 语法检查
node -e "const s=require('fs').readFileSync('frontend/public/app.html','utf8'); \
  const m=s.match(/<script>([\s\S]*?)<\/script>/); new Function(m[1]); console.log('OK')"
```

## 当前状态

- 生产环境正常，使用 MongoDB Atlas
- `sa_882f4ca6` 是唯一超级管理员（密码不在此文件中）
- README 不含任何默认账号信息
- 管理后台有测试数据生成/清理按钮（仅 superadmin 可见）

## 上次开发内容

- 管理后台 5 个 Tab 搜索功能 ✅
- 使用指南双标签页（用户/管理员）✅
- 管理员指南仅 admin 可见 ✅
- 待领取过期自动取消 ✅
- 应急改密（直接 API 调用）✅
- 安全修复：移除 git 历史中的密码 ✅
- README 完整文档 ✅
- 仓库已开源 ✅

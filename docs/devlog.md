# 校园物品租借系统 · 开发日志

## 2026-05-23 — 修复注册 & 移除测试账号

### 修复
- **注册报错 `next is not a function`**：Mongoose 9 的 `pre('save')` 中间件不再支持回调参数，改为无参函数
  - 修改 `User.js` 和 `Item.js` 的 `pre('save')` 钩子
- **登录页移除测试账号**：生产环境不再显示 `superadmin/super123` 等测试凭据

---

## 2026-05-23 — Railway 部署 & MongoDB 迁移

### 完成事项
- **数据持久化**：从内存数组 + JSON 文件 → MongoDB Atlas（云端）+ JSON 文件（本地自动回退）
- **密码安全**：所有密码改用 bcryptjs 加密存储
- **双模式存储**：server.js 启动时先尝试 MongoDB，不可用时自动回退 JSON 文件
- **Railway 部署**：代码推送到 GitHub，Railway 自动拉取并运行

### 遇到并解决的问题
| 问题 | 解决 |
|---|---|
| MongoDB Atlas DNS 无法解析（GFW） | 本地用 JSON 文件，Railway 用硬编码 URI |
| Railway 环境变量不生效 | 放弃变量方式，URI 直接写代码 |
| `dotenv` 找不到（Railway 未安装依赖） | 根 package.json 添加全部依赖 |
| MongoDB Atlas 认证失败 | 重置密码 + URL 编码特殊字符 |
| Item 分类中文 `enum` 不符 | Model 添加中文分类值 |
| Node 18 缺少 `crypto` | 升级至 Node 20 |

### 技术栈
- **后端**: Express 5, Mongoose 9, Node 20, bcryptjs
- **数据库**: MongoDB Atlas (M0 Free, Singapore)
- **部署**: Railway.app
- **代码托管**: GitHub (Private)

### 当前环境
- **本地**: `localhost:5000`（JSON 文件模式）
- **生产**: `https://rental-system-production-f530.up.railway.app`（MongoDB 模式）
- **数据库**: `cluster0.jqph8ma.mongodb.net/rental-system`

### 账户信息摘要
- **生产地址**: `https://rental-system-production-f530.up.railway.app`
- **GitHub**: 111221212q-ux/rental-system (Private)
- **Atlas**: Project 0 / Cluster0, 用户 111221212q_db_user
- **Railway**: Project (service 名见 Railway Dashboard)

### 测试结果
- `/api/health` ✅ — 5 users, 6 items, 2 rentals
- `/api/auth/login` ✅ — bcrypt 认证正常
- MongoDB 模式已启用

---

## 历史记录

### 2026-05-20~21 — 初始开发
- Express 后端 + 内存存储
- 登录/注册/物品管理/租借审批
- 简约清爽 UI 设计（3 轮迭代）
- JSON 文件持久化
- 管理员后台、统计报表

# 校园物品租借系统 · 开发日志

## 2026-05-24 — CSP安全头 & 防重复提交 & 租期校验 & 记住我

### 新增
- **CSP安全头**：添加 Content-Security-Policy、X-Content-Type-Options、X-Frame-Options 响应头，防范 XSS/点击劫持
- **dotenv 加载**：添加 `require('dotenv').config()`，本地开发环境变量自动加载
- **防重复提交**：登录/注册/评论/租借/添加物品等表单按钮点击后自动禁用并显示"处理中..."，防止双击重复提交
- **租期天数校验**：后端 POST /api/rentals 新增租借天数不超过物品 maxRentalDays 的校验
- **记住我功能**：勾选"记住我"使用 localStorage（持久），不勾选使用 sessionStorage（关闭浏览器即失效）

### 修复
- **登录按钮选择器**：修复 `.login-card-body .btn` 可能匹配到注册按钮的问题，改用独立 ID `#login-btn`

---

## 2026-05-24 — 邮件修复 & 数据恢复 & 配置迁移

### 修复
- **JSON 回退模式密码占位符**：`data.json` 中的 `$2a$10$placeholder` 密码无法通过 bcrypt 验证，新增 `fixPlaceholderPasswords()` 在启动时自动替换为真实 bcrypt 哈希
- **MongoDB 连接丢失**：MONGODB_URI 环境变量被清空，应用回退 JSON 存储（5 users/6 items/2 rentals）。重新添加 URI 后数据恢复（9 users/6 items/20 rentals）
- **MongoDB 密码更新**：从 `REDACTED` 改为 `REDACTED`（用户重置）
- **Resend 邮件测试通过**：`api/sms/test` 发送到 `111221212q@gmail.com` 成功
- **Gmail SMTP 尝试失败**：Railway 海外服务器无法连接 Gmail SMTP（587/465均超时），转回 Resend HTTP API
- **调试辅助**：健康端点 `/api/health` 新增 `mongoError` 字段，快速定位连库失败原因

### 环境变量调整
- 删除 `RESEND_API_KEY` → 新增 `EMAIL_HOST/EMAIL_PORT/EMAIL_USER/EMAIL_PASS`（Gmail）→ 删除 Gmail 凭据 → 重新添加 `RESEND_API_KEY`
- 最终使用中转：**Resend HTTP API**（因 Railway 封锁 SMTP 端口）

### 待办
- 域名 `gggffxu.xyz` 实名审核中，通过后配置 Resend 域名验证 → 可向任意邮箱发信
- 可选：`rental.gggffxu.xyz` 自定义域名

---

## 2026-05-23 — 超级管理员权限区分

- 新增 `superadmin` 中间件，`PUT /api/admin/users/:id/role` 和 `/status` 两个端点仅 superadmin 可调用
- admin 可看用户列表，但不能修改角色或状态
- superadmin 不能修改自己，也不能修改其他 superadmin
- 前端用户管理表格增加操作列（升降级、启用/禁用），仅 superadmin 可见
- 修复 seed 逻辑：仅在数据库完全为空时初始化，防止重启误删数据

---

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

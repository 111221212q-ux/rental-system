# 校园物品租借系统 · 开发日志

## 2026-05-28 — 注册流程重构 & 错误提示优化

### 变更
- **手机号字段移除**：注册表单删除手机号输入
- **验证码流程重构**：从「注册后验证」改为「先验证再注册」
  - 新增 `POST /api/auth/send-reg-code`（无需登录，凭邮箱发送验证码）
  - 后端 `regVerificationCodes` Map 存储预注册验证码（10分钟有效）
  - 注册接口接受 `verificationCode` 参数，与预注册验证码匹配后才创建用户
  - 新增 `emailVerified` 字段，仅在邮件服务可用时设为 true
- **发送验证码按钮修复**：移除 `disabled` 属性，改为调用 `/api/auth/send-reg-code`（原调用 `/auth/send-verification` 需要登录态，导致按钮不可点击）
- **简化注册 UI**：移除独立的「验证」按钮，验证码在注册时一并提交
- **错误提示优化**：区分"邮箱已注册""邮件服务未配置"等场景
  - 邮箱已注册时显示红色提示 + 可点击的"登录"链接引导用户切换
  - 切换注册/登录表单时自动重置提示状态
  - 成功发送后提示检查垃圾邮件
- **验证码输入布局优化**：改为独立的 form-group 样式，验证码输入框单独一行，发送按钮移到 label 右侧，输入框更大更醒目

## 2026-05-25 — 推广前准备：赔偿条款、使用说明、联系方式、编辑物品库存

### 新增
- **赔偿条款勾选**：两个租借入口（物品列表弹窗、详情页）均加入赔偿条款 checkbox，须勾选同意后才能提交
- **使用说明页**：侧边栏新增「使用说明」入口，弹窗展示浏览、申请、审批、归还全流程指引
- **联系方式展示**：侧边栏底部和帮助弹窗内自动加载管理员联系方式（微信/电话/地点）
- **编辑物品增加总库存**：编辑物品弹窗新增「总库存」字段，修改后自动调整可用库存
- **用户管理表格加入邮箱列**
- **注册流程增加邮箱验证**：注册后弹出验证码输入弹窗，验证通过后才进入系统
- **联系信息优化**：侧边栏显示超级管理员邮箱/微信，使用说明弹窗显示指定用户联系方式
- **新增 `/api/contact/user/:username` 接口**：可根据学号查询用户联系方式

### 修复
- 物品图片统一为 4:3 比例，卡片缩略图和详情弹窗改用 CSS 类 `item-card-image`

## 2026-05-24 — 修复中文邮件编码（Resend API）

### 修复
- **中文邮件乱码**：Resend API 发送中文时缺少 charset 声明，QQ 邮箱/Gmail 均显示乱码
- **解决方案**：
  - 邮件正文改用 HTML 实体编码（将非 ASCII 字符转为 `&#NNNN;`）
  - 邮件标题改用 RFC 2047 编码（`=?UTF-8?B?base64?=`）
  - 发件人名称改为英文 `Rental`（避免中文在邮件头编码问题）
- **测试结果**：QQ 邮箱中文正文 + 标题均显示正常

## 2026-05-24 — DNS 传播完成 && 自定义域名生效

### 完成事项
- **DNS 传播完成**：`gggffxu.xyz` NS 委派已生效，Resend 自动验证域名通过
- **自定义域名访问正常**：`https://rental.gggffxu.xyz` 返回 HTTP 200
- **邮件发送成功**：通过 Resend API 使用 `noreply@gggffxu.xyz` 发信测试通过
- **系统配置更新**：
  - Railway 环境变量 `EMAIL_FROM_EMAIL` → `noreply@gggffxu.xyz`
  - `ALLOWED_ORIGINS` 加入 `https://rental.gggffxu.xyz`
  - CSP 头 `connect-src` 加入自定义域名
- **所有功能正常**：生产 API 健康检查通过，emailConfigured: true

---

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

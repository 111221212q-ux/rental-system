# 校园物品租借系统 🎒

一个轻量级的校园物品租借管理平台，支持物品浏览、在线申请、管理员审批、线下领取/归还全流程。

## 功能特性

### 用户端
- **物品浏览**：分类/状态筛选、关键词搜索、图片/描述/数据手册查看
- **在线租借**：选择租期和数量、用途说明、赔偿条款确认
- **我的租借**：实时查看状态（待审核/已通过/租借中/逾期/已归还/已拒绝/已取消）
- **邮箱验证**：注册邮箱验证、个人资料修改
- **仪表盘**：逾期提醒（严重逾期深红高亮，可收起）

### 管理端
- **待审核**：审批/拒绝租借申请（搜索、备注）
- **待领取**：确认线下领取（过期自动取消）
- **租借中**：确认归还、催还通知、逾期高亮
- **物品管理**：新增/编辑/删除物品、图片 URL 和手册 URL
- **用户管理**：查看/升降角色、禁用/删除用户（仅超级管理员）
- **数据统计**：统计卡片、状态分布、CSV 导出、测试数据生成/清理（仅超级管理员）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 HTML/CSS/JS（单页应用） |
| 后端 | Node.js + Express 5 |
| 数据库 | SQLite（Node 内置 node:sqlite） |
| 认证 | JWT + bcryptjs |
| 部署 | Sealos，北京区域，单实例 + 持久卷 |
| 邮件 | Resend API / SMTP |

## 快速开始

### 环境要求
- Node.js 20+
- MongoDB Atlas 账号（可选，支持 JSON 文件模式）

### 安装

```bash
git clone https://github.com/111221212q-ux/rental-system.git
cd rental-system
npm install
```

### 配置

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`：

```env
PORT=5000
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/rental-system
JWT_SECRET=your-random-secret-here
```

> 使用全新的 SQLite 数据，不自动导入旧 JSON 或 MongoDB。Sealos 必须挂载持久卷 `/data`，设置 `SQLITE_PATH=/data/rental.sqlite`。

### 启动

```bash
npm start
```

访问 `http://localhost:5000`

> 首次只创建超级管理员，不创建演示数据。设置 `INITIAL_ADMIN_PASSWORD`，或从数据库同目录的 `initial-admin.txt` 获取生成的随机密码；密码不会出现在日志中。`JWT_SECRET` 至少24字符。

## 项目结构

```
rental-system/
├── backend/
│   ├── server.js          # Express 主入口
│   ├── storage.js         # SQLite 表结构、事务和备份
│   ├── backup.js          # 手动备份入口
│   ├── services/          # 邮件服务
│   └── .env.example       # 环境变量模板
├── frontend/
│   └── public/
│       ├── app.html       # 单页应用
│       └── favicon.svg    # 网站图标
└── docs/
    └── devlog.md          # 开发日志
```

## API 概览

| 端点 | 权限 | 说明 |
|------|------|------|
| `POST /api/auth/register` | 公开 | 注册（需验证码） |
| `POST /api/auth/login` | 公开 | 登录 |
| `GET /api/items` | 公开 | 物品列表 |
| `POST /api/rentals` | 登录用户 | 提交租借 |
| `GET /api/rentals/my` | 登录用户 | 我的租借 |
| `PUT /api/rentals/:id/approve` | 管理员 | 审批通过 |
| `PUT /api/rentals/:id/reject` | 管理员 | 拒绝 |
| `PUT /api/rentals/:id/pickup` | 管理员 | 确认领取 |
| `PUT /api/rentals/:id/return` | 管理员 | 确认归还 |
| `POST /api/rentals/:id/urge` | 管理员 | 催还通知 |
| `POST /api/items` | 管理员 | 新增物品 |
| `PUT /api/items/:id` | 管理员 | 编辑物品 |
| `DELETE /api/items/:id` | 管理员 | 删除物品 |
| `GET /api/admin/users` | 管理员 | 用户列表 |
| `PUT /api/admin/users/:id/role` | 超级管理员 | 修改角色 |
| `PUT /api/admin/users/:id/status` | 超级管理员 | 启用/禁用 |

## 部署与备份

GitHub Actions 在测试通过后构建镜像，Sealos 应用挂载 `/data` 持久卷并固定1个实例。完整步骤见 [HANDOFF.md](HANDOFF.md)。

启动时和每24小时自动备份，保留7份；也可执行 `npm run backup`。数据与备份不进镜像或仓库。

## 验证

执行 `npm test`，测试使用临时数据库，不访问生产。线上健康接口 `/api/health` 应返回 `storage: "sqlite"`。

## 开源协议

MIT

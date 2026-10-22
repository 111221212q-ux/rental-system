# 交接文档

> 当前方案：SQLite 文件数据库。2026-10-22 用户明确放弃旧库迁移，从新数据开始。

## 项目与运行入口

- 项目：`D:\ai_code\project\rental-system`
- 公开仓库：https://github.com/111221212q-ux/rental-system
- 网站：https://nbbhlsyclkdc.sealosbja.site
- 后端：`backend/server.js`，全部 API，Node.js 24 + Express 5。
- 数据层：`backend/storage.js`，Node 内置 `node:sqlite`，带外键、约束和事务。
- 前端：`frontend/public/app.html`，原生单页应用。
- 邮件：`backend/services/sms.js`，Resend / SMTP；环境变量在加载该模块前读取。
- 备份：`backend/backup.js`，可手动执行 `npm run backup`。

## 当前进度

已于2026-10-22发布到 Sealos 北京区域。线上健康接口确认 `storage: "sqlite"`，新库1管理员、0物品、0租借、0评论，邮件已配置，自动备份成功。
已实测生产管理员登录、各主要读取接口，并在应用重启后再次登录；管理员ID和创建时间保持一致，证明持久卷内数据保留。
1Gi持久卷挂载 `/data`；新增存储预估0.01元/天，总价预估0.14元/天，用户已确认并发布。
原 Atlas 和 JSON 文件未删除，也未导入。
`migrate-db.js` 和 `tests/migrate-db.test.js` 是之前准备的可选历史工具，不参与网站启动。

## SQLite 数据与初始化

- 本地默认：`backend/data/rental.sqlite`。
- Sealos：`SQLITE_PATH=/data/rental.sqlite`，持久卷挂载 `/data`。
- 启动失败会退出，不会回退到 JSON 或创建测试数据。
- 新库仅创建一名超级管理员，用户名默认 `sa_882f4ca6`。物品、租借、评论和普通用户均为空。
- 首次密码可通过 `INITIAL_ADMIN_PASSWORD` 注入；不配置时生成随机密码，保存在数据目录的 `initial-admin.txt`，不打印到日志、不提交仓库。登录后修改密码，妥善保管或移除初始密码文件。
- `INITIAL_ADMIN_USERNAME`、`INITIAL_ADMIN_EMAIL` 仅用于空库首次初始化；后续启动不会重置管理员。
- `JWT_SECRET` 至少24字符。密码修改会撤销旧令牌，并返回新的登录令牌。

## 一致性与日期规则

- 审批通过不扣库存；线下确认领取时，在同一事务内检查库存、扣减并改为 `active`。
- 归还仅允许 `active`，在同一事务内归还库存并改为 `returned`。
- 重复审批、重复领取和重复归还会拒绝；不能删除尚有借出物品的用户或租借记录。
- 日期按北京时间的自然日处理，归还截止当天结束前有效；前端接口返回带 `+08:00` 的日期时间。
- 过期待领取记录在读取管理/个人记录、提醒或确认领取时自动取消，不扣库存。
- 已完成租借保留物品名称/编码快照，删除物品不会删除历史租借。
- 评论、邮件验证码、验证码到期时间和错误次数均持久保存在 SQLite。

## Sealos 发布步骤

1. 确认配置：北京区域、应用 `rental`、固定 **1个实例**。
2. 新增持久卷：起步 **1 Gi**，挂载 `/data`。先查看新增存储每日费用，再确认部署。
3. 镜像：GitHub Actions 构建 `ghcr.io/111221212q-ux/rental-system:latest`。工作流先运行全部测试再构建，镜像使用 Node 24。
4. 环境变量保留现有强 `JWT_SECRET`、邮件配置和 `PORT=5000`；设置 `SQLITE_PATH=/data/rental.sqlite`、`BACKUP_DIR=/data/backups`。旧 `MONGODB_URI` 已无作用，可移除。
5. 镜像入口会为新挂载目录设置 node 用户的写权限，再降权运行网站。确认平台所提供的卷支持 SQLite 文件锁；不要同时运行多个网站实例或弹性扩容。
6. 发布并等待应用就绪。首次无配置密码时，从容器 `/data/initial-admin.txt` 安全获取初始化密码；不要把它贴入公开日志或仓库。
7. 健康检查必须返回 `storage: "sqlite"`，无 `mongoError`；新库为1管理员、0物品、0租借、0评论，`backup.lastSuccess` 非空。
8. 测试管理员登录、注册、添加物品、申请、审批、领取、归还、评论，再重启应用验证数据保留。

## 备份与恢复

启动时做一次一致备份，此后每24小时备份一次，保留最近7份。使用 SQLite backup API，不直接复制正在写入的主数据库文件。

- 默认目录：数据库同目录下的 `backups/`，生产为 `/data/backups`。
- 备份先写 `.partial`，通过完整性和外键校验后才发布为 `.sqlite`，然后轮换旧备份。
- 手动备份：`npm run backup`（读取 `SQLITE_PATH` / `BACKUP_DIR`）。
- 健康接口 `backup.lastError` 提示最近一次自动备份错误。
- 恢复前先停止网站，保留当前数据库副本；将选定的完整备份恢复为 `/data/rental.sqlite`，再启动并验证。不能在应用运行时覆盖数据库。
- 同一持久卷的备份可恢复误操作，但不防卷整体丢失；需要时另行配置异地副本。

## 本地开发与验证

复制 `backend/.env.example` 为 `backend/.env`，设置随机 `JWT_SECRET`，使用 Node 24：

```text
npm ci
npm start
npm test
npm run backup
```

`tests/sqlite.test.js` 使用真实临时 SQLite 和 HTTP 服务，不连接生产库，覆盖注册、验证码、库存并发、事务回滚、权限、评论、重启、备份恢复及前端日期/登录存储。

## 敏感信息与遗留目录

密钥只放运行环境或本地忽略文件。SQLite、备份、初始密码文件均被 Git 和 Docker 构建排除。仓库公开，提交前检查差异。

`backend/models/`、`backend/config/db.js`、旧 React/Vite 文件及 Railway 配置是历史遗留，不是当前运行入口。

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

- 当前类别：电子模块、电机电池、固定设备。旧“电子产品”在SQLite v2升级时自动更名为“电子模块”，保留物品ID/库存/图片；其他非标准旧分类保留原值，编辑时需重新选择新类别。
- 电子模块、电机电池按天租借；固定设备按北京时间同一天内的开始/结束时刻预约，例如12:00–14:00。不支持跨天时段，结束时刻不计入占用，因此14:00可接续下一单。
- 时段预约的待审核、已批准、使用中记录占用预约容量；拒绝/取消/结束使用释放。多台同类设备按同时重叠的数量峰值检查，申请及审批在SQLite事务内核对，避免并发超约。不同机器需要单独排程时，应各建一条物品。
- 固定设备当前正在使用也可以预约未来时段；实际开始使用只能在预约开始后、结束前确认，并检查实际剩余库存。已超时的使用中记录不会自动归还，必须由管理员确认结束；未开始使用的过期申请自动取消。
- 有未结束租借时不能切换按天/按时段类别；减少库存不能使已预约的时段容量不足。管理员出库暂不可用设备也会从时段容量中扣除。
- `GET /api/items/:id/availability?date=YYYY-MM-DD` 需登录，只提供时段和占用数量，不提供预约人信息。
- 租借记录保存自身 `bookingMode/startTime/endTime`，旧记录默认daily，不随物品后来改类别而变更。Schema v2是加列升级，升级前会在数据库同目录留下 `.pre-v2-<uuid>.sqlite` 原库副本；常规带图备份仍按下述规则执行。

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
- 备份先写 `.partial`，通过完整性和外键校验，并将快照引用的本地图片独立复制到同名 `.sqlite.images/` 目录后，才发布为 `.sqlite`，然后轮换旧备份及配套图片。没有图片的快照也有空图片目录。
- 手动备份：`npm run backup`（读取 `SQLITE_PATH` / `BACKUP_DIR`）。
- 健康接口 `backup.lastError` 提示最近一次自动备份错误。
- 恢复前先停止网站，保留当前数据库和 uploads 副本；将选定的完整备份恢复为 `/data/rental.sqlite`，并把该备份配套 `.sqlite.images/` 中的图片复制到 `/data/uploads/`，设置 node 用户可读写，再启动并验证。旧版本没有图片目录的备份不含本地图片。不能在应用运行时覆盖数据库。
- 同一持久卷的备份可恢复误操作，但不防卷整体丢失；需要时另行配置异地副本。

## 物品图片上传

- 管理后台的新增/编辑物品表单可直接选择照片、预览、替换或移除；需点击保存物品才更新关联。已有 HTTP/HTTPS 图片链接继续兼容，折叠选项中可填写。
- 仅管理员能调用 `POST /api/uploads/images`，multipart 字段为 `image`。接受 JPG/PNG/WebP，原图最多8MiB、1600万像素；服务器验证并重新编码为最长边1600px的 WebP，去除 EXIF 等元数据；不支持动画或 SVG。
- 文件位于数据库同级 `uploads/`，生产 `/data/uploads/`，文件名为内容 SHA256，网站路径 `/uploads/<hash>.webp`。SQLite只保存路径，不保存图片二进制。图片目录在持久卷中，不需新增付费服务。
- 同时只处理一张照片以控制256MiB实例内存，忙时提示重试。图片源文件总量上限100MiB（为现有1Gi卷的7份图片备份预留空间），满额或磁盘不足时拒绝新图，已有图继续显示。
- 替换/移除只改变物品关联，不自动销毁源图片；同一图片去重保存，避免备份和编辑并发时误删历史图片。取消表单的已上传文件也计入配额，后续有需要再做管理员明确操作的清理工具。
- 每份备份独立复制其数据库快照所引用的图片，恢复不依赖现存 uploads。下载/转移备份时必须保留 `.sqlite` 和同名 `.sqlite.images/` 目录。

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

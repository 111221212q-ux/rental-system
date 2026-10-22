# CLAUDE.md — 校园物品租借系统

接手先读 HANDOFF.md。用户于2026-10-22选择 SQLite、新数据初始化，不再迁移 Atlas。

## 当前架构

- Node24 + Express5；入口 backend/server.js。
- Node内置 node:sqlite；结构化数据、约束、外键、事务在 backend/storage.js。
- 前端全部在 frontend/public/app.html；保持 CRLF。
- 邮件 backend/services/sms.js；先加载环境变量再加载邮件模块。
- Sealos 北京区域，应用 rental，固定一个实例，持久卷挂载 /data。
- SQLite /data/rental.sqlite，备份 /data/backups；不再使用 MongoDB/JSON 回退。

## 规则

- 前端继续使用原 API 字段和状态：pending → approved → active → returned；pending 可 rejected；approved 过期 cancelled。
- 库存只在线下领取时扣减，审批不预占；所有领取/归还操作同步事务，不能跨异步等待。
- 日期按北京时间；截止日当天23:59:59.999有效。
- 新库仅创建超级管理员，无演示物品/用户/租借；不自动导入旧库。
- 密码bcrypt，JWT版本在改密后撤销；用户输出排除密码和内部版本。
- 评论内容和所有用户输入进入HTML时必须转义；数据库访问必须参数绑定。
- backup API生成一致快照，完整性校验后发布，保留7份。不得直接复制在线主库作为备份。
- SQLite、备份、初始密码、.env均不进Git或镜像。仓库公开。
- 密钥保存在本地忽略文件/Sealos环境变量，禁止写进交接文档或提交。

## 验证

npm test；Node语法检查；前端脚本语法检查；浏览器正常/错误路径。
部署后检查 /api/health 的 storage=sqlite 与 backup.lastSuccess，并实测重启保留数据。

## 历史

backend/models、Mongo配置、迁移工具、React/Vite残留不参与当前网站启动。Railway不再使用。

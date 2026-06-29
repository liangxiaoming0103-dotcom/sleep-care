# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

智能睡眠环境调控设备 — 微信小程序 + Node.js 云后台混合项目（实训）。当前阶段**不依赖真实硬件**，所有设备数据由后台模拟数据生成器按生理规则自动生成。硬件就绪后仅需替换数据源和控制指令下发模块。

---

## 技术栈约束

| 层级 | 技术 | 约束说明 |
|------|------|----------|
| 用户端 | 微信小程序（原生框架 / UniApp） | — |
| 云后台 API | **Express (Node.js)** | 唯一后端框架，不得引入 Koa、Fastify 等替代品 |
| 数据库 | **SQLite（sql.js）** | 纯 JS 实现，无需编译原生模块；禁止使用 better-sqlite3（需原生编译，实训环境兼容性差） |
| 医生端 Web | 响应式 HTML/CSS/JS | PC/Pad 适配，独立于小程序的纯静态/模板页面 |
| 定时任务 | node-cron | 每日凌晨2点触发模拟数据生成 |
| 未来扩展 | MQTT Broker | 预留真实硬件数据接入通道 |

> **核心原则**：Express + sql.js 是强制技术栈，所有 API 和数据库操作必须在此统一框架内完成，不得引入其他后端框架或数据库驱动。

---

## 目录结构规划

```
sleep-care/
├── miniprogram/          # 微信小程序源码
│   ├── pages/            # 页面
│   ├── components/       # 公共组件
│   ├── utils/            # 工具函数、API 请求封装
│   └── app.js / app.json / app.wxss
├── backend/              # Express 云后台
│   ├── routes/           # 路由（auth, device, report, setting, doctor, eCBTi, ota, message）
│   ├── middleware/        # JWT 验证、错误处理中间件
│   ├── models/           # 数据库操作（基于 sql.js）
│   ├── simulator/        # 模拟数据生成器（node-cron 定时任务）
│   ├── db/               # 数据库文件（.sqlite）+ 初始化脚本（DDL）+ schema.js
│   ├── app.js            # Express 入口
│   └── config.js         # 配置（端口、JWT密钥、DB路径）
├── doctor-web/           # 医生端 Web 后台（响应式静态/模板页面）
├── docs/                 # 项目文档（需求、架构、数据库设计、MVP清单）
└── .gitignore
```

---

## 数据库规范

### 5 张核心表

严格按照 `docs/数据库设计.md` 中的 DDL 建表，不得增删字段：

| 表名 | 用途 | 关键约束 |
|------|------|----------|
| `users` | 用户账户 | phone UNIQUE, role 区分普通用户/医生/管理员 |
| `devices` | 设备绑定 | device_id PK（虚拟格式 VIR+16位随机字符）, is_virtual 标记 |
| `sleep_reports` | 睡眠报告 | UNIQUE(user_id, report_date)，每用户每天仅一份 |
| `user_settings` | 个性化设置 | user_id PK+FK，与 users 一一对应 |
| `doctor_authorizations` | 医生授权 | status CHECK(pending/active/expired/revoked) |

### sql.js 持久化机制（关键）

sql.js 是纯内存数据库，**必须通过 `saveDb()` 将数据写入磁盘**，否则进程退出后数据全部丢失：

```javascript
const initSqlJs = require('sql.js');
const fs = require('fs');

// 启动时加载已有数据库文件
const db = new SQL.Database(fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null);

// ⚠️ 每次写操作后必须调用此函数持久化
function saveDb() {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}
```

**强制规则**：
- 所有涉及 INSERT / UPDATE / DELETE 的操作，执行后**必须调用 `saveDb()`** 落盘
- 初始化建表后必须 `saveDb()`
- 模拟数据生成器写入报告后必须 `saveDb()`
- 未调用 `saveDb()` = 数据未持久化，进程重启即丢失

### SQLite 适配要点

- 无 ENUM → 使用 TEXT + CHECK 约束
- 无 BOOLEAN → 使用 INTEGER (0/1)
- 外键默认关闭 → 连接时执行 `db.run('PRAGMA foreign_keys = ON;')`
- datetime → TEXT 存储 ISO-8601 字符串

---

## API 设计规范

### 统一响应格式

所有 API 接口必须返回以下 JSON 结构：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

| code | 含义 |
|------|------|
| `0` | 成功 |
| `1001` | 参数错误 |
| `1002` | 未登录 / Token 无效 |
| `1003` | 无权限（如非医生角色访问患者数据） |
| `2001` | 数据不存在（如查询不存在的报告） |
| `3001` | 业务逻辑错误（如重复授权、设备已绑定等） |

**规则**：
- 成功时 `data` 包含业务数据（对象/数组）；失败时 `data` 为 `null`
- `message` 必须为中文，可直接展示给前端用户
- 前端统一判断 `code === 0` 作为成功依据，不要判断 `code !== 0`

### JWT 认证

- 登录成功后颁发 Token，存储在 `data.token`
- 所有业务接口（除 `/auth/register`、`/auth/login` 外）必须在请求头携带 `Authorization: Bearer <token>`
- 中间件统一校验，未登录返回 `{code: 1002, message: "请先登录", data: null}`
- Token 过期时间默认 7 天，在 `config.js` 中配置

### 路由模块清单

| 模块 | 路由前缀 | 涉及核心表 |
|------|---------|-----------|
| 账号认证 | `/auth/*` | users |
| 设备管理 | `/device/*` | devices |
| 睡眠报告 | `/report/*` | sleep_reports |
| 个性化设置 | `/setting/*` | user_settings |
| e-CBTi | `/diary/*`, `/questionnaire/*`, `/restriction/*` | —（非 MVP） |
| 医生授权 | `/doctor/*` | doctor_authorizations |
| 消息通知 | `/message/*` | —（非 MVP） |
| OTA 固件 | `/device/firmware/*` | —（模拟，非 MVP） |

---

## 注释规范

### 所有代码必须带中文注释

AI 生成或修改的任何代码文件（`.js`、`.json`、`.wxml`、`.wxss`、`.html` 等）必须包含中文注释：

- **文件顶部**：用 1-2 行说明该文件的功能和职责
- **函数/方法**：说明参数、返回值、业务逻辑要点
- **关键逻辑**：对非显而易见的算法、边界条件、业务规则加行内注释
- **路由定义**：注明请求方法、路径、认证要求、对应功能

示例：
```javascript
/**
 * 用户注册
 * POST /auth/register
 * @param {string} phone - 11位手机号
 * @param {string} password - 密码（6-20位）
 * @param {string} code - 短信验证码（实训阶段可固定为 0000）
 * @returns {{code: number, message: string, data: object|null}}
 */
router.post('/register', async (req, res) => {
  // ...实现
});
```

> 此规范旨在提升代码可维护性，降低实训团队成员之间的沟通成本。

---

## AI 行为约束

### 1. 代码走读优先

在编写或修改任何代码前，需先通过 Agent 或直接读取相关文件，完成代码走读：
- 涉及 API 模块时，先通读该模块下已有路由文件
- 涉及数据库操作时，先确认 `docs/数据库设计.md` 中的表结构
- 涉及工具函数时，先检查是否存在可复用的已有实现

### 2. 优先使用 sql.js

所有数据库操作**强制使用 sql.js 而非 better-sqlite3**：
- better-sqlite3 需原生编译，实训环境（Windows/macOS/CI）兼容性不可控
- sql.js 是纯 WebAssembly 实现，`npm install` 后即可使用，零环境依赖
- 引入方式：`const initSqlJs = require('sql.js');`
- 必须搭配 `saveDb()` 持久化数据（见「数据库规范」章节）

### 3. 不在代码中硬编码配置

- 数据库文件路径、JWT 密钥、服务端口等敏感或可变参数统一在 `config.js` / `.env` 中管理
- `.env` 已加入 `.gitignore`，不要提交

### 4. 遵循现有文档

- 需求理解：优先参考 `docs/` 目录下的 4 份文档（需求 docx、架构图、数据库设计、MVP 清单），不得凭空编造需求
- 表结构：严格按 `docs/数据库设计.md` 的 DDL，不得擅自增删字段

---

## 核心架构

系统分层：
- **上层（小程序）**：用户直接交互，HTTPS/JSON + JWT Token 调用 API
- **下层（云后台 Express）**：8 个 API 模块（auth / device / report / setting / eCBTi / doctor / message / ota）+ 模拟数据生成器
- **数据层（SQLite via sql.js）**：5 张核心表

关键设计决策：
- 虚拟设备序列号格式：`VIR` + 16 位随机字符，`is_virtual=1`
- API 统一响应 `{code, message, data}`，code=0 表示成功
- `sleep_reports` 表有 `UNIQUE(user_id, report_date)` 约束，同一用户每天仅一份报告
- 模拟数据生成器的生理规则见需求文档第 4.2 节

---

## 常用命令

```bash
# 初始化后端项目（首次）
cd backend && npm init -y && npm install express sql.js jsonwebtoken bcryptjs node-cron cors dotenv

# 启动后端（开发模式）
cd backend && node app.js
# 或使用 nodemon 热重载
cd backend && npx nodemon app.js

# 初始化数据库（首次运行，建表并写入空库文件）
cd backend && node db/init.js

# 手动触发某用户的模拟数据生成（调试用）
curl -X POST http://localhost:3000/admin/simulate -H "Content-Type: application/json" -d '{"user_id": 1, "date": "2026-06-29"}'
```

---

## 数据结构（5 张核心表）

详见 `docs/数据库设计.md`，包含完整 SQLite DDL、ER 图、字段注释、SQLite 适配说明。建表 SQL 在该文档第二章可直接执行。

---

## MVP 功能范围

详见 `docs/MVP功能清单.md`。当前实训交付 7 个功能：
1. 用户登录（手机号/微信授权）
2. 虚拟设备管理
3. 睡眠报告分期图表（阶段曲线、心率、呼吸）
4. 噪音曲线
5. 日/周/月趋势
6. 个性化作息设置
7. 医生授权基础

OTA 固件升级、e-CBTi 训练专区、消息通知等属于完整版，不在 MVP 内。

# 智能睡眠健康管理软件

基于 Node.js + 微信小程序的智能睡眠环境调控系统，支持睡眠数据监测、医生远程干预、个性化作息管理。

---

## 项目简介

智能睡眠健康管理软件是一套完整的 **「患者-医生」双端睡眠健康管理平台**。患者通过微信小程序查看每日睡眠报告、管理设备、设置作息；医生通过 Web 后台查看授权患者的睡眠数据并填写干预建议。后台模拟数据生成器可按生理规律自动生成睡眠数据，无需真实硬件即可完整体验全流程。

### 核心功能

| 模块 | 说明 |
|------|------|
| 用户系统 | 手机号注册/登录，JWT 认证，个人信息管理 |
| 设备管理 | 虚拟设备自动生成，支持绑定/解绑/在线状态 |
| 睡眠报告 | 睡眠分期曲线、噪音曲线、心率/呼吸趋势、日周月趋势 |
| 个性化作息 | 就寝/起床时间、日出模拟时长、助眠偏好 |
| 医生授权 | 患者授权医生 → 医生确认 → 查看报告 → 填写干预建议 |
| 医患通知 | 医生更新建议后，患者首页红点提醒，报告页查看建议 |

---

## 技术架构

```
┌─────────────────────────────────────────┐
│              微信小程序（患者端）         │
│  WXML / WXSS / JS / ECharts            │
│  pages: home / report / devices /       │
│         settings / doctors / login      │
└──────────────┬──────────────────────────┘
               │ HTTPS + JWT Token
┌──────────────▼──────────────────────────┐
│         Express 云后台（Node.js）        │
│  routes: auth / device / report /       │
│          setting / doctor / user        │
│  middleware: JWT / CORS / error-handler │
└──────────────┬──────────────────────────┘
               │ sql.js (WebAssembly)
┌──────────────▼──────────────────────────┐
│         SQLite 数据库（纯 JS）           │
│  users / devices / sleep_reports /      │
│  user_settings / doctor_authorizations  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         医生端 Web（纯静态）              │
│  HTML / CSS / JS / ECharts             │
│  登录 → 患者列表 → 报告 → 干预建议       │
└─────────────────────────────────────────┘
```

**技术选型**：

| 层级 | 技术 | 说明 |
|------|------|------|
| 患者端 | 微信小程序（原生） | WXML + WXSS + JS |
| 后端 | Express (Node.js) | RESTful API，JWT 认证 |
| 数据库 | SQLite via sql.js | 纯 JS 实现，无需编译原生模块 |
| 医生端 | 原生 HTML/CSS/JS | 响应式设计，ECharts 图表 |
| 定时任务 | node-cron | 每日凌晨模拟数据生成 |
| 模拟数据 | seededRandom LCG | 确定性随机，保证同用户同日期数据一致 |

---

## 快速开始

### 环境要求

- Node.js >= 18
- 微信开发者工具

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 初始化数据库

```bash
node db/init.js
```

首次运行自动创建 5 张核心表和 5 个索引。

### 3. 启动后端

```bash
node app.js
```

服务默认运行在 `http://localhost:3000`。

### 4. 启动小程序

1. 打开微信开发者工具
2. 导入项目 → 选择 `miniprogram/` 目录
3. 填写 AppID（测试号即可）
4. 详情 → 本地设置 → 勾选 **不校验合法域名**

### 5. 启动医生端 Web

浏览器访问 `http://localhost:3000/doctor.html`，或直接打开 `backend/public/doctor.html`。

---

## API 文档索引

### 用户认证

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 用户注册 | 否 |
| POST | `/api/auth/login` | 用户登录 | 否 |
| GET | `/api/user/profile` | 获取个人信息 | 是 |
| PUT | `/api/user/profile` | 修改个人信息 | 是 |

### 设备管理

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/device/list` | 设备列表 | 是 |
| POST | `/api/device/add` | 添加设备 | 是 |
| PUT | `/api/devices/:id` | 修改设备昵称 | 是 |
| DELETE | `/api/devices/:id` | 删除设备 | 是 |

### 睡眠报告

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/sleep/report/daily` | 每日报告 `?date=YYYY-MM-DD` | 是 |
| GET | `/api/sleep/stages` | 睡眠分期数据 | 是 |
| GET | `/api/sleep/noise` | 噪音曲线 | 是 |
| GET | `/api/sleep/heart` | 心率趋势 | 是 |
| GET | `/api/sleep/breath` | 呼吸频率趋势 | 是 |
| GET | `/api/sleep/summary` | 日/周/月趋势 `?period=day\|week\|month` | 是 |

### 个性化设置

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/setting/plan` | 获取作息设置 | 是 |
| PUT | `/api/setting/plan` | 更新作息设置 | 是 |

### 医生授权

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/users/doctors` | 获取医生列表 | 否 |
| POST | `/api/doctor/grant` | 患者授权医生 | 是 |
| GET | `/api/doctor/patients` | 医生查看患者列表 | 是 |
| PUT | `/api/doctor/confirm` | 医生确认授权 | 是 |
| DELETE | `/api/doctor/revoke` | 撤销授权 | 是 |
| GET | `/api/doctor/patient/data` | 医生查看患者报告 | 是 |
| PUT | `/api/doctor/note` | 医生填写干预建议 | 是 |
| GET | `/api/doctor/note` | 医生获取干预建议 | 是 |
| GET | `/api/patient/note/check` | 患者检查医生建议 | 是 |

### 统一响应格式

```json
{ "code": 0, "message": "success", "data": {} }
```

| code | 含义 |
|------|------|
| 0 | 成功 |
| 1001 | 参数错误 |
| 1002 | 未登录 |
| 1003 | 无权限 |
| 2001 | 数据不存在 |
| 3001 | 业务逻辑错误 |
| 500 | 服务器内部错误 |

---

## 目录结构

```
sleep-care/
├── backend/                  # Express 云后台
│   ├── app.js                # 服务入口 + 所有路由
│   ├── db/                   # 数据库
│   │   ├── connection.js     # sql.js 连接管理
│   │   ├── schema.js         # DDL 建表 + 索引
│   │   ├── init.js           # 初始化入口
│   │   └── migrate-role.js   # 角色字段迁移脚本
│   ├── public/               # 静态文件
│   │   └── doctor.html       # 医生端 Web 页面
│   ├── test/                 # 测试
│   │   └── integration.test.js  # 集成测试
│   └── package.json
├── miniprogram/              # 微信小程序
│   ├── app.js / app.json / app.wxss
│   ├── pages/
│   │   ├── home/             # 首页：睡眠概览 + 快捷入口
│   │   ├── report/           # 报告：分期/噪音/趋势 + 医生建议
│   │   ├── devices/          # 设备管理
│   │   ├── settings/         # 个人信息 + 作息设置
│   │   ├── doctors/          # 医生授权
│   │   ├── login/            # 登录
│   │   └── register/         # 注册
│   └── components/           # ECharts 组件
├── docs/                     # 文档
│   ├── 数据库设计.md
│   ├── MVP功能清单.md
│   ├── 医患通知方案设计.md
│   ├── MVP优化讨论.md
│   └── 优化记录.md
├── CLAUDE.md                 # AI 开发指南
└── README.md
```

---

## 开发团队

本项目为实训课程项目，由开发团队分工协作完成。

| 角色 | 负责模块 |
|------|---------|
| 后端开发 | Express API、数据库设计、JWT 认证 |
| 小程序开发 | 患者端页面、ECharts 可视化 |
| 前端开发 | 医生端 Web、响应式布局 |
| UI/UX | 医疗健康风格设计、交互优化 |
| 测试 | 集成测试、接口联调 |

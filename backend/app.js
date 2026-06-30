/**
 * 智能睡眠环境调控设备 — Express 云后台 API 入口
 * 负责：加载环境变量、配置中间件、初始化数据库、挂载路由、启动 HTTP 服务。
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// JWT 密钥（实训阶段硬编码，生产环境应使用环境变量）
const JWT_SECRET = 'sleep-care-secret-key-2026';

// 加载 .env 环境变量（若存在）
dotenv.config();

const { getDb, saveDb } = require('./db/connection');
const { initDatabase } = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// sql.js 数据库查询辅助函数
// =====================================================

/**
 * 查询单条记录
 * 使用 sql.js 的 prepare + bind + step + getAsObject 方式执行查询，返回第一条匹配行。
 * @param {import('sql.js').Database} db - 数据库连接实例
 * @param {string} sql - SQL 查询语句（使用 ? 占位符）
 * @param {Array} params - 参数数组
 * @returns {Object|null} 查询结果对象，无匹配时返回 null
 */
function dbGetOne(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

/**
 * 查询多条记录
 * 使用 sql.js 的 prepare + bind + step 循环方式查询所有匹配行。
 * @param {import('sql.js').Database} db - 数据库连接实例
 * @param {string} sql - SQL 查询语句（使用 ? 占位符）
 * @param {Array} params - 参数数组
 * @returns {Object[]} 查询结果对象数组，无匹配时返回空数组 []
 */
function dbGetAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// =====================================================
// 中间件配置
// =====================================================
app.use(cors());                        // 允许跨域请求（小程序 / 医生端 Web）
app.use(express.json());                // 解析 JSON 请求体

// =====================================================
// JWT 认证中间件
// =====================================================
/**
 * 验证请求中的 JWT Token，并将解析后的用户信息挂载到 req.user
 * 用于保护需要登录才能访问的接口（如 /report/*、/setting/* 等）
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @param {Function} next - 下一个中间件
 */
function authenticateToken(req, res, next) {
  // 1. 从请求头获取 Authorization（格式：Bearer <token>）
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // 2. 如果没有 Token，返回 401
  if (!token) {
    return res.status(401).json({
      code: 401,
      message: '未提供认证令牌',
      data: null
    });
  }

  // 3. 验证 Token
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      // Token 无效或已过期，返回 403
      return res.status(403).json({
        code: 403,
        message: '令牌无效或已过期',
        data: null
      });
    }

    // 4. 验证通过，将解码后的用户信息挂载到 req.user
    req.user = decoded;
    next();
  });
}

// =====================================================
// 健康检查接口
// =====================================================
app.get('/', (req, res) => {
  res.json({
    code: 0,
    message: 'success',
    data: {
      service: 'sleep-care-api',
      status: 'running',
      timestamp: new Date().toISOString()
    }
  });
});

// =====================================================
// 用户注册 POST /api/auth/register
// =====================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, password, nickname } = req.body;

    // ---- 参数验证 ----
    if (!phone || !password) {
      return res.json({ code: 1001, message: '手机号和密码不能为空', data: null });
    }
    if (!/^\d{11}$/.test(phone)) {
      return res.json({ code: 1001, message: '手机号必须为11位数字', data: null });
    }
    if (password.length < 6) {
      return res.json({ code: 1001, message: '密码长度不能少于6位', data: null });
    }

    // ---- 获取数据库连接 ----
    const db = await getDb();

    // ---- 检查手机号是否已注册 ----
    const existUser = dbGetOne(db, 'SELECT id FROM users WHERE phone = ?', [phone]);
    if (existUser) {
      return res.json({ code: 3001, message: '该手机号已注册', data: null });
    }

    // ---- 生成密码哈希 ----
    const passwordHash = bcrypt.hashSync(password, 10);

    // ---- 插入新用户 ----
    const now = new Date().toISOString();
    const finalNickname = nickname || '用户';

    db.run(
      'INSERT INTO users (phone, password_hash, nickname, role, status, created_at) VALUES (?, ?, ?, 0, 1, ?)',
      [phone, passwordHash, finalNickname, now]
    );

    // ---- 持久化到磁盘 ----
    saveDb();

    // ---- 查询刚插入的用户信息 ----
    const newUser = dbGetOne(
      db,
      'SELECT id, phone, nickname, role FROM users WHERE phone = ?',
      [phone]
    );

    // ---- 返回成功响应 ----
    res.json({
      code: 0,
      message: '注册成功',
      data: newUser
    });
  } catch (err) {
    // 捕获 UNIQUE 约束异常（手机号重复等并发场景）
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.json({ code: 3001, message: '该手机号已注册', data: null });
    }
    console.error('[注册] 服务器错误：', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误', data: null });
  }
});

// =====================================================
// 用户登录 POST /api/auth/login
// =====================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    // ---- 1. 参数验证：手机号和密码不能为空 ----
    if (!phone || !password) {
      return res.json({ code: 1001, message: '手机号和密码不能为空', data: null });
    }

    // ---- 2. 获取数据库连接 ----
    const db = await getDb();

    // ---- 3. 按手机号查询用户 ----
    const user = dbGetOne(
      db,
      'SELECT id, phone, password_hash, nickname, role, status FROM users WHERE phone = ?',
      [phone]
    );

    // ---- 4. 用户不存在 ----
    if (!user) {
      return res.json({ code: 2001, message: '用户不存在，请先注册', data: null });
    }

    // ---- 5. 密码验证 ----
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.json({ code: 1001, message: '密码错误', data: null });
    }

    // ---- 6. 账号状态检查：status=1 为正常 ----
    if (user.status !== 1) {
      return res.json({ code: 3001, message: '账号已被禁用', data: null });
    }

    // ---- 7. 生成 JWT Token，payload 包含 id、phone、role，有效期 7 天 ----
    const token = jwt.sign(
      { id: user.id, phone: user.phone, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // ---- 8. 更新最近登录时间 ----
    const now = new Date().toISOString();
    db.run('UPDATE users SET updated_at = ? WHERE id = ?', [now, user.id]);

    // ---- 9. 持久化到磁盘 ----
    saveDb();

    // ---- 10. 返回登录成功响应 ----
    res.json({
      code: 0,
      message: '登录成功',
      data: {
        token,
        id: user.id,
        phone: user.phone,
        nickname: user.nickname,
        role: user.role
      }
    });
  } catch (err) {
    console.error('[登录] 服务器错误：', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误', data: null });
  }
});

// =====================================================
// 设备管理接口（均需登录）
// =====================================================

/**
 * 生成指定长度的随机字母数字字符串
 * @param {number} length - 字符串长度
 * @returns {string} 随机字符串
 */
function randomAlphanumeric(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// =====================================================
// a) 获取设备列表 GET /api/device/list
// =====================================================
app.get('/api/device/list', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;

    // 查询当前用户的所有设备，按创建时间倒序
    const devices = dbGetAll(
      db,
      'SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    res.json({ code: 0, message: 'success', data: devices });
  } catch (err) {
    console.error('[设备列表] 服务器错误：', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误', data: null });
  }
});

// =====================================================
// b) 添加设备 POST /api/device/add
// =====================================================
app.post('/api/device/add', authenticateToken, async (req, res) => {
  try {
    const { device_serial, is_virtual } = req.body;
    const userId = req.user.id;

    let serialNo;

    // ---- 判断设备类型，生成或校验序列号 ----
    if (is_virtual) {
      // 虚拟设备：自动生成 VIR + 16位随机字符
      serialNo = 'VIR' + randomAlphanumeric(16);
    } else if (device_serial) {
      // 真实设备：校验序列号格式（16位字母数字）
      if (!/^[A-Za-z0-9]{16}$/.test(device_serial)) {
        return res.json({ code: 1001, message: '设备序列号必须为16位字母数字', data: null });
      }
      serialNo = device_serial;
    } else {
      return res.json({ code: 1001, message: '请提供 device_serial 或设置 is_virtual 为 true', data: null });
    }

    const db = await getDb();
    const now = new Date().toISOString();

    // ---- 插入设备 ----
    db.run(
      'INSERT INTO devices (user_id, serial_no, nickname, is_virtual, online_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, serialNo, '我的设备', is_virtual ? 1 : 0, 1, now, now]
    );

    // ---- 持久化到磁盘 ----
    saveDb();

    // ---- 查询新插入的设备 ----
    const device = dbGetOne(
      db,
      'SELECT * FROM devices WHERE serial_no = ?',
      [serialNo]
    );

    res.json({ code: 0, message: '设备添加成功', data: device });
  } catch (err) {
    // 捕获 UNIQUE 约束异常（序列号重复）
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.json({ code: 3001, message: '设备序列号已存在', data: null });
    }
    console.error('[添加设备] 服务器错误：', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误', data: null });
  }
});

// =====================================================
// c) 修改设备昵称 PUT /api/devices/:id
// =====================================================
app.put('/api/devices/:id', authenticateToken, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const { nickname } = req.body;
    const userId = req.user.id;

    // ---- 参数校验 ----
    if (!nickname) {
      return res.json({ code: 1001, message: '昵称不能为空', data: null });
    }

    const db = await getDb();

    // ---- 验证设备归属：设备必须属于当前用户 ----
    const device = dbGetOne(
      db,
      'SELECT * FROM devices WHERE id = ? AND user_id = ?',
      [deviceId, userId]
    );

    if (!device) {
      return res.json({ code: 2001, message: '设备不存在或无权操作', data: null });
    }

    // ---- 更新设备昵称 ----
    const now = new Date().toISOString();
    db.run('UPDATE devices SET nickname = ?, updated_at = ? WHERE id = ?', [nickname, now, deviceId]);

    // ---- 持久化到磁盘 ----
    saveDb();

    // ---- 查询更新后的设备 ----
    const updatedDevice = dbGetOne(db, 'SELECT * FROM devices WHERE id = ?', [deviceId]);

    res.json({ code: 0, message: '设备更新成功', data: updatedDevice });
  } catch (err) {
    console.error('[更新设备] 服务器错误：', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误', data: null });
  }
});

// =====================================================
// d) 删除设备 DELETE /api/devices/:id
// =====================================================
app.delete('/api/devices/:id', authenticateToken, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user.id;

    const db = await getDb();

    // ---- 验证设备归属：设备必须属于当前用户 ----
    const device = dbGetOne(
      db,
      'SELECT * FROM devices WHERE id = ? AND user_id = ?',
      [deviceId, userId]
    );

    if (!device) {
      return res.json({ code: 2001, message: '设备不存在或无权操作', data: null });
    }

    // ---- 删除设备 ----
    db.run('DELETE FROM devices WHERE id = ?', [deviceId]);

    // ---- 持久化到磁盘 ----
    saveDb();

    res.json({ code: 0, message: '设备删除成功', data: null });
  } catch (err) {
    console.error('[删除设备] 服务器错误：', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误', data: null });
  }
});

// =====================================================
// 睡眠报告接口（均需登录）
// =====================================================

/**
 * 确定性伪随机数生成器（LCG 算法）
 * 给定相同 seed 字符串，始终生成相同的随机序列，保证同用户同日期数据一致。
 * @param {string} seed - 种子字符串
 * @returns {Function} 返回 0-1 之间随机数的函数
 */
function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) {
    s = (s * 31 + seed.charCodeAt(i)) & 0x7fffffff;
  }
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >>> 0) / 2147483647;
  };
}

/**
 * 生成基础睡眠指标（复用逻辑）
 * 基于确定性随机数生成器产生每日睡眠的核心数值指标。
 * @param {Function} rand - seededRandom 返回的随机数函数
 * @returns {{totalSleep, deepSleep, remSleep, lightSleep, sleepScore, awakeCount, awakeMinutes}}
 */
function generateBaseMetrics(rand) {
  const totalSleep  = Math.floor(300 + rand() * 180);              // 300-480 分钟
  const deepRatio   = 0.15 + rand() * 0.20;                         // 0.15-0.35
  const remRatio    = 0.20 + rand() * 0.05;                          // 0.20-0.25
  const deepSleep   = Math.floor(totalSleep * deepRatio);
  const remSleep    = Math.floor(totalSleep * remRatio);
  const lightSleep  = totalSleep - deepSleep - remSleep;
  const sleepScore  = Math.floor(60 + rand() * 40);                // 60-100
  const awakeCount  = Math.floor(rand() * 6);                      // 0-5 次
  const awakeMinutes = Math.floor(rand() * 30);                   // 0-29 分钟
  return { totalSleep, deepSleep, remSleep, lightSleep, sleepScore, awakeCount, awakeMinutes };
}

// =====================================================
// 获取每日睡眠报告 GET /api/sleep/report/daily
// =====================================================
app.get('/api/sleep/report/daily', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = await getDb();

    // ---- 1. 解析日期参数，默认昨天 ----
    let reportDate;
    if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
      reportDate = req.query.date;
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      reportDate = yesterday.toISOString().slice(0, 10);
    }

    // ---- 2. 获取用户第一台设备 ----
    const firstDevice = dbGetOne(
      db,
      'SELECT id FROM devices WHERE user_id = ? LIMIT 1',
      [userId]
    );
    const deviceId = firstDevice ? firstDevice.id : 0;

    // ---- 3. 查询是否已有今日报告 ----
    const existReport = dbGetOne(
      db,
      'SELECT * FROM sleep_reports WHERE user_id = ? AND device_id = ? AND report_date = ?',
      [userId, deviceId, reportDate]
    );

    // ---- 4. 已有报告直接返回 ----
    if (existReport) {
      return res.json({ code: 0, message: 'success', data: existReport });
    }

    // ---- 5. 生成模拟睡眠数据 ----
    const seedKey = `${userId}_${deviceId}_${reportDate}`;
    const rand = seededRandom(seedKey);
    const metrics = generateBaseMetrics(rand);
    const { totalSleep, deepSleep, remSleep, lightSleep, sleepScore, awakeCount, awakeMinutes } = metrics;

    // ---- 6. 插入新报告 ----
    try {
      db.run(
        `INSERT INTO sleep_reports
          (user_id, device_id, report_date, sleep_score, total_sleep_minutes,
           deep_sleep_minutes, light_sleep_minutes, rem_sleep_minutes,
           awake_minutes, awake_count, heart_rate_json, sleep_stages_json, noise_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, deviceId, reportDate, sleepScore, totalSleep,
         deepSleep, lightSleep, remSleep,
         awakeMinutes, awakeCount, '[]', '[]', '[]']
      );

      // ---- 7. 持久化到磁盘 ----
      saveDb();

      // ---- 8. 查询并返回新记录 ----
      const newReport = dbGetOne(
        db,
        'SELECT * FROM sleep_reports WHERE user_id = ? AND device_id = ? AND report_date = ?',
        [userId, deviceId, reportDate]
      );

      return res.json({ code: 0, message: 'success', data: newReport });
    } catch (err) {
      // 捕获 UNIQUE 约束异常（并发插入）→ 重新查询已有记录返回
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        const exist = dbGetOne(
          db,
          'SELECT * FROM sleep_reports WHERE user_id = ? AND device_id = ? AND report_date = ?',
          [userId, deviceId, reportDate]
        );
        if (exist) {
          return res.json({ code: 0, message: 'success', data: exist });
        }
      }
      console.error('[DB] sleep report error:', err);
      return res.json({ code: 1001, message: '生成报告失败', data: null });
    }
  } catch (err) {
    console.error('[睡眠报告] 服务器错误：', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误', data: null });
  }
});

// =====================================================
// 获取睡眠分期数据 GET /api/sleep/stages
// =====================================================
app.get('/api/sleep/stages', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  let dateStr = req.query.date;
  if (!dateStr) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateStr = yesterday.toISOString().split('T')[0];
  }
  const db = await getDb();
  let deviceId = 0;
  const deviceRow = dbGetOne(db, 'SELECT id FROM devices WHERE user_id = ? LIMIT 1', [userId]);
  if (deviceRow) deviceId = deviceRow.id;

  // 1. 查询记录
  let report = dbGetOne(
    db,
    'SELECT * FROM sleep_reports WHERE user_id = ? AND device_id = ? AND report_date = ?',
    [userId, deviceId, dateStr]
  );

  // 2. 如果记录不存在，先插入基础数据（复用第4节逻辑）
  if (!report) {
    const seedKey = `${userId}_${deviceId}_${dateStr}`;
    const rand = seededRandom(seedKey);
    const metrics = generateBaseMetrics(rand);
    const { totalSleep, deepSleep, remSleep, lightSleep, sleepScore, awakeCount, awakeMinutes } = metrics;

    db.run(
      `INSERT INTO sleep_reports
        (user_id, device_id, report_date, sleep_score, total_sleep_minutes,
         deep_sleep_minutes, light_sleep_minutes, rem_sleep_minutes,
         awake_minutes, awake_count, heart_rate_json, sleep_stages_json, noise_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, deviceId, dateStr, sleepScore, totalSleep,
       deepSleep, lightSleep, remSleep,
       awakeMinutes, awakeCount, '[]', '[]', '[]']
    );
    saveDb();
    report = dbGetOne(
      db,
      'SELECT * FROM sleep_reports WHERE user_id = ? AND device_id = ? AND report_date = ?',
      [userId, deviceId, dateStr]
    );
  }

  // 3. 检查 sleep_stages_json 字段
  let stages = [];
  let labels = [];
  if (report.sleep_stages_json) {
    try {
      stages = JSON.parse(report.sleep_stages_json);
      if (Array.isArray(stages) && stages.length === 48) {
        // 已有有效分期数据，生成标签并返回
        for (let i = 0; i < 48; i++) {
          const hours = Math.floor(i * 0.5 / 60);
          const minutes = (i * 0.5) % 60;
          labels.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
        }
        return res.json({ code: 0, message: 'success', data: { date: dateStr, stages, labels } });
      }
    } catch (e) { /* JSON 解析失败，继续生成 */ }
  }

  // 4. 生成分期数据（确定性随机）
  const seedKey = `${userId}_${deviceId}_${dateStr}`;
  const rand = seededRandom(seedKey);
  const TOTAL_POINTS = 48;
  const newStages = [];
  for (let i = 0; i < TOTAL_POINTS; i++) {
    const position = i / TOTAL_POINTS;
    let deepProb = Math.max(0.1, 0.6 - position * 0.8);
    let remProb = Math.min(0.6, 0.1 + position * 0.5);
    let lightProb = 0.25 + rand() * 0.2;
    const r = rand();
    let stage;
    if (r < deepProb) stage = 2;
    else if (r < deepProb + lightProb) stage = 1;
    else if (r < deepProb + lightProb + remProb) stage = 3;
    else stage = 0;
    if (rand() < 0.05 && i > 5 && i < TOTAL_POINTS - 5) stage = 0;
    newStages.push(stage);
  }

  // 5. 更新数据库
  db.run('UPDATE sleep_reports SET sleep_stages_json = ? WHERE id = ?', [JSON.stringify(newStages), report.id]);
  saveDb();

  // 6. 生成标签
  for (let i = 0; i < TOTAL_POINTS; i++) {
    const hours = Math.floor(i * 0.5 / 60);
    const minutes = (i * 0.5) % 60;
    labels.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
  }
  res.json({ code: 0, message: 'success', data: { date: dateStr, stages: newStages, labels } });
});

// =====================================================
// 异步启动服务
// =====================================================
async function start() {
  try {
    // 1. 初始化数据库（建表 + 索引）
    console.log('[App] 正在初始化数据库...');
    await initDatabase();

    // 2. 启动 HTTP 服务
    app.listen(PORT, () => {
      console.log(`[App] 服务已启动：http://localhost:${PORT}`);
      console.log(`[App] 健康检查：http://localhost:${PORT}/`);
    });
  } catch (err) {
    console.error('[App] 启动失败：', err);
    process.exit(1);
  }
}

start();

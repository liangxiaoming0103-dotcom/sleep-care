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

// =====================================================
// 角色映射：INTEGER ↔ TEXT
// DB 中 role 为 INTEGER（0/1/2），API/JWT 中使用 TEXT（patient/doctor/admin）
// =====================================================
const ROLE_MAP = {
  intToText: { 0: 'patient', 1: 'doctor', 2: 'admin' },
  textToInt: { 'patient': 0, 'doctor': 1, 'admin': 2 }
};

const { getDb, saveDb, dbGetOne, dbGetAll, DB_TYPE } = require('./db/connection');
const { initDatabase } = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// 中间件配置
// =====================================================
app.use(cors());                        // 允许跨域请求（小程序 / 医生端 Web）
app.use(express.json());                // 解析 JSON 请求体

// 配置静态文件服务（医生端 Web 页面）
app.use(express.static('public'));

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

    // 小程序端强制患者，Web端强制医生
    const isWeb = req.body.client === 'web';
    const userRole = isWeb ? 'doctor' : 'patient';

    // ---- 获取数据库连接 ----
    const db = await getDb();

    // ---- 检查手机号是否已注册 ----
    const existUser = await dbGetOne(db, 'SELECT id FROM users WHERE phone = ?', [phone]);
    if (existUser) {
      return res.json({ code: 3001, message: '该手机号已注册', data: null });
    }

    // ---- 生成密码哈希 ----
    const passwordHash = bcrypt.hashSync(password, 10);

    // ---- 插入新用户 ----
    const now = new Date().toISOString();
    const displayName = nickname || '用户';

    await db.run(
      `INSERT INTO users (phone, password_hash, nickname, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [phone, passwordHash, displayName, userRole, now, now]
    );

    // ---- 持久化到磁盘 ----
    saveDb();

    // ---- 查询刚插入的用户信息 ----
    const newUser = await dbGetOne(
      db,
      'SELECT id, phone, nickname, role FROM users WHERE phone = ?',
      [phone]
    );

    // ---- 将整数 role 转换为文本返回给前端 ----
    if (newUser) {
      // role 字段存储为文本，兼容旧整数数据
      newUser.role = (typeof newUser.role === 'number')
        ? (ROLE_MAP.intToText[newUser.role] || 'patient')
        : (newUser.role || 'patient');
    }

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
    const user = await dbGetOne(
      db,
      'SELECT id, phone, password_hash, nickname, role, status FROM users WHERE phone = ?',
      [phone]
    );

    // ---- 4. 用户不存在 ----
    if (!user) {
      return res.json({ code: 2001, message: '用户不存在，请先注册', data: null });
    }

    // ---- 4.5 角色校验：小程序仅限患者，Web端仅限医生 ----
    const roleText = (typeof user.role === 'number')
      ? (ROLE_MAP.intToText[user.role] || 'patient')
      : (user.role || 'patient');
    const isWeb = req.body.client === 'web';
    if (isWeb && roleText !== 'doctor') {
      return res.json({ code: 1003, message: '患者请使用小程序登录', data: null });
    }
    if (!isWeb && roleText !== 'patient') {
      return res.json({ code: 1003, message: '医生/管理员请使用Web端登录', data: null });
    }

    // ---- 5. 密码验证 ----
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.json({ code: 1001, message: '密码错误', data: null });
    }

    // ---- 6. 账号状态检查：status=1 为正常 ----
    if (user.status !== 1) {
      return res.json({ code: 3001, message: '账号已被禁用', data: null });
    }

    // ---- 7. 生成 JWT Token，有效期 7 天（roleText 已在步骤 4.5 计算，此处复用） ----
    const token = jwt.sign(
      { id: user.id, phone: user.phone, role: roleText },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // ---- 8. 更新最近登录时间 ----
    const now = new Date().toISOString();
    await db.run('UPDATE users SET updated_at = ? WHERE id = ?', [now, user.id]);

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
        role: roleText
      }
    });
  } catch (err) {
    console.error('[登录] 服务器错误：', err.message, err.stack);
    return res.status(500).json({ code: 5001, message: '服务器内部错误: ' + err.message, data: null });
  }
});

// GET /api/user/profile —— 获取个人信息
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  const db = await getDb();
  const user = await dbGetOne(db,
    'SELECT id, phone, nickname, gender, birth_year, role FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.json({ code: 2001, message: '用户不存在', data: null });
  // 兼容旧整数 role 数据
  if (user) {
    user.role = (typeof user.role === 'number')
      ? (ROLE_MAP.intToText[user.role] || 'patient')
      : (user.role || 'patient');
  }
  return res.json({ code: 0, message: 'success', data: user });
});

// PUT /api/user/profile —— 更新个人信息（昵称、性别、出生年份）
app.put('/api/user/profile', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { nickname, gender, birth_year } = req.body;
  const db = await getDb();

  // 构建动态 SET 子句
  const sets = [];
  const params = [];
  if (nickname !== undefined)  { sets.push('nickname = ?'); params.push(nickname); }
  if (gender !== undefined)   { sets.push('gender = ?');   params.push(parseInt(gender) || 0); }
  if (birth_year !== undefined) { sets.push('birth_year = ?'); params.push(parseInt(birth_year) || null); }

  if (sets.length === 0) {
    return res.json({ code: 1001, message: '请提供要修改的字段', data: null });
  }

  const now = new Date().toISOString();
  sets.push('updated_at = ?');
  params.push(now);
  params.push(userId);

  await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  saveDb();

  // 返回更新后的信息
  const user = await dbGetOne(db,
    'SELECT id, phone, nickname, gender, birth_year, role FROM users WHERE id = ?',
    [userId]
  );
  if (user) {
    user.role = (typeof user.role === 'number')
      ? (ROLE_MAP.intToText[user.role] || 'patient')
      : (user.role || 'patient');
  }

  return res.json({ code: 0, message: '保存成功', data: user });
});

// GET /api/users/doctors —— 获取所有已注册的医生列表（公开接口）
app.get('/api/users/doctors', async (req, res) => {
  const db = await getDb();
  const doctors = await dbGetAll(db,
    `SELECT id, phone, nickname FROM users
     WHERE role = 'doctor' AND status = 1
     ORDER BY id ASC`,
    []
  );
  return res.json({ code: 0, message: 'success', data: doctors });
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
    const devices = await dbGetAll(
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
    await db.run(
      'INSERT INTO devices (user_id, serial_no, nickname, is_virtual, online_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, serialNo, '我的设备', is_virtual ? 1 : 0, 1, now, now]
    );

    // ---- 持久化到磁盘 ----
    saveDb();

    // ---- 查询新插入的设备 ----
    const device = await dbGetOne(
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
    const device = await dbGetOne(
      db,
      'SELECT * FROM devices WHERE id = ? AND user_id = ?',
      [deviceId, userId]
    );

    if (!device) {
      return res.json({ code: 2001, message: '设备不存在或无权操作', data: null });
    }

    // ---- 更新设备昵称 ----
    const now = new Date().toISOString();
    await db.run('UPDATE devices SET nickname = ?, updated_at = ? WHERE id = ?', [nickname, now, deviceId]);

    // ---- 持久化到磁盘 ----
    saveDb();

    // ---- 查询更新后的设备 ----
    const updatedDevice = await dbGetOne(db, 'SELECT * FROM devices WHERE id = ?', [deviceId]);

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
    const device = await dbGetOne(
      db,
      'SELECT * FROM devices WHERE id = ? AND user_id = ?',
      [deviceId, userId]
    );

    if (!device) {
      return res.json({ code: 2001, message: '设备不存在或无权操作', data: null });
    }

    // ---- 删除设备 ----
    await db.run('DELETE FROM devices WHERE id = ?', [deviceId]);

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
    const firstDevice = await dbGetOne(
      db,
      'SELECT id FROM devices WHERE user_id = ? LIMIT 1',
      [userId]
    );
    const deviceId = firstDevice ? firstDevice.id : 0;

    // ---- 3. 查询是否已有今日报告（只用 user_id+report_date，避免 device_id 不匹配） ----
    const existReport = await dbGetOne(
      db,
      'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
      [userId, reportDate]
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
      await db.run(
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
      const newReport = await dbGetOne(
        db,
        'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
        [userId, reportDate]
      );

      return res.json({ code: 0, message: 'success', data: newReport });
    } catch (err) {
      // 捕获 UNIQUE 约束异常（并发插入）→ 重新查询已有记录返回
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        const exist = await dbGetOne(
          db,
          'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
          [userId, reportDate]
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
  const deviceRow = await dbGetOne(db, 'SELECT id FROM devices WHERE user_id = ? LIMIT 1', [userId]);
  if (deviceRow) deviceId = deviceRow.id;

  // 1. 查询记录
  let report = await dbGetOne(
    db,
    'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
    [userId, dateStr]
  );

  // 2. 若不存在，生成基础指标并插入（复用第4节逻辑）
  if (!report) {
    const seedKey = `${userId}_${deviceId}_${dateStr}`;
    const rand = seededRandom(seedKey);
    const total = Math.floor(300 + rand() * 180);
    const deepR = 0.15 + rand() * 0.20;
    const remR = 0.20 + rand() * 0.05;
    const deep = Math.floor(total * deepR);
    const rem = Math.floor(total * remR);
    const light = total - deep - rem;
    const score = Math.floor(60 + rand() * 40);
    const awake = Math.floor(rand() * 6);
    const awakeMin = Math.floor(rand() * 30);
    try {
      await db.run(
        `INSERT INTO sleep_reports
          (user_id, device_id, report_date, sleep_score, total_sleep_minutes,
           deep_sleep_minutes, light_sleep_minutes, rem_sleep_minutes,
           awake_minutes, awake_count, heart_rate_json, sleep_stages_json, noise_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, deviceId, dateStr, score, total,
         deep, light, rem,
         awakeMin, awake, '[]', '[]', '[]']
      );
      saveDb();
      report = await dbGetOne(
        db,
        'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
        [userId, dateStr]
      );
    } catch (err) {
      // 处理重复
      report = await dbGetOne(db,
        'SELECT * FROM sleep_reports WHERE user_id=? AND report_date=?',
        [userId, dateStr]);
      if (!report) return res.json({ code: 1001, message: '生成报告失败' });
    }
  }

  // 3. 检查 sleep_stages_json 字段
  let stages = [];
  let labels = [];
  if (report.sleep_stages_json) {
    try {
      stages = JSON.parse(report.sleep_stages_json);
      if (Array.isArray(stages) && stages.length === 48) {
        // 48 个采样点，跨 8 小时（22:00-06:00），每点 10 分钟
        for (let i = 0; i < 48; i++) {
          const totalMin = 22 * 60 + i * 10;
          const hours = Math.floor(totalMin / 60) % 24;
          const minutes = totalMin % 60;
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
    const pos = i / TOTAL_POINTS;
    let deepProb = Math.max(0.1, 0.6 - pos * 0.8);
    let remProb = Math.min(0.6, 0.1 + pos * 0.5);
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
  await db.run('UPDATE sleep_reports SET sleep_stages_json = ? WHERE id = ?', [JSON.stringify(newStages), report.id]);
  saveDb();

  // 6. 生成标签（48 个采样点，22:00-06:00，每点 10 分钟）
  for (let i = 0; i < TOTAL_POINTS; i++) {
    const totalMin = 22 * 60 + i * 10;
    const hours = Math.floor(totalMin / 60) % 24;
    const minutes = totalMin % 60;
    labels.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
  }
  res.json({ code: 0, message: 'success', data: { date: dateStr, stages: newStages, labels } });
});

// =====================================================
// 获取噪音数据 GET /api/sleep/noise
// =====================================================
app.get('/api/sleep/noise', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  let dateStr = req.query.date;
  if (!dateStr) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateStr = yesterday.toISOString().split('T')[0];
  }
  const db = await getDb();
  let deviceId = 0;
  const deviceRow = await dbGetOne(db, 'SELECT id FROM devices WHERE user_id = ? LIMIT 1', [userId]);
  if (deviceRow) deviceId = deviceRow.id;

  // 1. 查询记录
  let report = await dbGetOne(
    db,
    'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
    [userId, dateStr]
  );

  // 2. 若不存在，生成基础指标并插入（复用第4节逻辑）
  if (!report) {
    const seedKey = `${userId}_${deviceId}_${dateStr}`;
    const rand = seededRandom(seedKey);
    const total = Math.floor(300 + rand() * 180);
    const deepR = 0.15 + rand() * 0.20;
    const remR = 0.20 + rand() * 0.05;
    const deep = Math.floor(total * deepR);
    const rem = Math.floor(total * remR);
    const light = total - deep - rem;
    const score = Math.floor(60 + rand() * 40);
    const awake = Math.floor(rand() * 6);
    const awakeMin = Math.floor(rand() * 30);
    try {
      await db.run(
        `INSERT INTO sleep_reports
          (user_id, device_id, report_date, sleep_score, total_sleep_minutes,
           deep_sleep_minutes, light_sleep_minutes, rem_sleep_minutes,
           awake_minutes, awake_count, heart_rate_json, sleep_stages_json, noise_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, deviceId, dateStr, score, total,
         deep, light, rem,
         awakeMin, awake, '[]', '[]', '[]']
      );
      saveDb();
      report = await dbGetOne(
        db,
        'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
        [userId, dateStr]
      );
    } catch (err) {
      report = await dbGetOne(db,
        'SELECT * FROM sleep_reports WHERE user_id=? AND report_date=?',
        [userId, dateStr]);
      if (!report) return res.json({ code: 1001, message: '生成报告失败' });
    }
  }

  // 3. 检查 noise_json
  let noise = [];
  let labels = [];
  if (report.noise_json) {
    try {
      const parsed = JSON.parse(report.noise_json);
      if (Array.isArray(parsed) && parsed.length === 144) {
        noise = parsed;
        // 生成标签
        for (let i = 0; i < 144; i++) {
          const hour = i / 6;
          const hours = String(Math.floor(hour)).padStart(2, '0');
          const minutes = String(Math.floor((hour % 1) * 60)).padStart(2, '0');
          labels.push(`${hours}:${minutes}`);
        }
        return res.json({ code: 0, message: 'success', data: { date: dateStr, noise, labels } });
      }
    } catch (e) { /* 忽略，重新生成 */ }
  }

  // 4. 生成噪音数据（确定性随机）
  const seedKey = `${userId}_${deviceId}_${dateStr}`;
  const rand = seededRandom(seedKey);
  const TOTAL_POINTS = 144;
  const newNoise = [];

  for (let i = 0; i < TOTAL_POINTS; i++) {
    const hour = i / 6;
    const hourFloor = Math.floor(hour);
    const isNight = (hourFloor >= 22 || hourFloor < 6);

    let baseValue;
    if (isNight) {
      baseValue = 30 + rand() * 10;
    } else {
      baseValue = 45 + rand() * 20;
    }

    // 平滑过渡
    if (hourFloor === 6) {
      const progress = (hour - 6) / 1;
      const nightValue = 30 + rand() * 10;
      const dayValue = 45 + rand() * 20;
      baseValue = nightValue + (dayValue - nightValue) * progress;
    }
    if (hourFloor === 21) {
      const progress = (hour - 21) / 1;
      const dayValue = 45 + rand() * 20;
      const nightValue = 30 + rand() * 10;
      baseValue = dayValue + (nightValue - dayValue) * progress;
    }

    newNoise.push(parseFloat(baseValue.toFixed(1)));
  }

  // 5. 更新数据库
  await db.run('UPDATE sleep_reports SET noise_json = ? WHERE id = ?', [JSON.stringify(newNoise), report.id]);
  saveDb();

  // 6. 生成标签
  for (let i = 0; i < TOTAL_POINTS; i++) {
    const hour = i / 6;
    const hours = String(Math.floor(hour)).padStart(2, '0');
    const minutes = String(Math.floor((hour % 1) * 60)).padStart(2, '0');
    labels.push(`${hours}:${minutes}`);
  }

  res.json({ code: 0, message: 'success', data: { date: dateStr, noise: newNoise, labels } });
});

// =====================================================
// 获取心率数据 GET /api/sleep/heart
// =====================================================
app.get('/api/sleep/heart', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  let dateStr = req.query.date;
  if (!dateStr) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateStr = yesterday.toISOString().split('T')[0];
  }
  const db = await getDb();
  let deviceId = 0;
  const deviceRow = await dbGetOne(db, 'SELECT id FROM devices WHERE user_id = ? LIMIT 1', [userId]);
  if (deviceRow) deviceId = deviceRow.id;

  // 1. 查询或创建报告
  let report = await dbGetOne(db,
    'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
    [userId, dateStr]
  );
  if (!report) {
    const seedKey = `${userId}_${deviceId}_${dateStr}`;
    const rand = seededRandom(seedKey);
    const { totalSleep, deepSleep, remSleep, lightSleep, sleepScore, awakeCount, awakeMinutes } = generateBaseMetrics(rand);
    try {
      await db.run(
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
      report = await dbGetOne(db,
        'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
        [userId, dateStr]
      );
    } catch (err) {
      report = await dbGetOne(db,
        'SELECT * FROM sleep_reports WHERE user_id=? AND report_date=?',
        [userId, dateStr]);
      if (!report) return res.json({ code: 1001, message: '生成报告失败' });
    }
  }

  // 2. 检查 heart_rate_json，若无则懒加载生成
  let heartData = [];
  let labels = [];
  if (report.heart_rate_json) {
    try {
      const parsed = JSON.parse(report.heart_rate_json);
      if (Array.isArray(parsed) && parsed.length === 96) {
        heartData = parsed;
        for (let i = 0; i < 96; i++) {
          const hour = Math.floor(i / 12) + 22;
          const displayHour = hour >= 24 ? hour - 24 : hour;
          const minute = (i % 12) * 5;
          labels.push(`${String(displayHour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`);
        }
        return res.json({ code: 0, message: 'success', data: { date: dateStr, heartRate: heartData, labels } });
      }
    } catch (e) { /* 重新生成 */ }
  }

  // 3. 生成心率数据（96 个点，22:00-06:00，每5分钟）
  const seedKey = `${userId}_${deviceId}_${dateStr}`;
  const rand = seededRandom(seedKey);
  const POINTS = 96;
  const newHeart = [];
  for (let i = 0; i < POINTS; i++) {
    // 睡眠阶段调整心率：深睡偏低(55-65)，浅睡/REM偏高(65-75)
    const pos = i / POINTS;
    let baseBpm;
    if (pos < 0.3) { baseBpm = 62 + rand() * 12; }       // 前半段：入睡期，逐渐降低
    else if (pos < 0.6) { baseBpm = 56 + rand() * 8; }   // 中段：深睡，心率最低
    else { baseBpm = 60 + rand() * 14; }                   // 后段：REM为主，心率波动大
    newHeart.push(parseFloat(baseBpm.toFixed(1)));
  }

  // 4. 更新数据库
  await db.run('UPDATE sleep_reports SET heart_rate_json = ? WHERE id = ?',
    [JSON.stringify(newHeart), report.id]);
  saveDb();

  // 5. 生成标签
  for (let i = 0; i < POINTS; i++) {
    const hour = Math.floor(i / 12) + 22;
    const displayHour = hour >= 24 ? hour - 24 : hour;
    const minute = (i % 12) * 5;
    labels.push(`${String(displayHour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`);
  }

  res.json({ code: 0, message: 'success', data: { date: dateStr, heartRate: newHeart, labels } });
});

// =====================================================
// 获取呼吸频率数据 GET /api/sleep/breath
// =====================================================
app.get('/api/sleep/breath', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  let dateStr = req.query.date;
  if (!dateStr) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateStr = yesterday.toISOString().split('T')[0];
  }
  const db = await getDb();
  let deviceId = 0;
  const deviceRow = await dbGetOne(db, 'SELECT id FROM devices WHERE user_id = ? LIMIT 1', [userId]);
  if (deviceRow) deviceId = deviceRow.id;

  // 1. 查询或创建报告
  let report = await dbGetOne(db,
    'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
    [userId, dateStr]
  );
  if (!report) {
    const seedKey = `${userId}_${deviceId}_${dateStr}`;
    const rand = seededRandom(seedKey);
    const { totalSleep, deepSleep, remSleep, lightSleep, sleepScore, awakeCount, awakeMinutes } = generateBaseMetrics(rand);
    try {
      await db.run(
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
      report = await dbGetOne(db,
        'SELECT * FROM sleep_reports WHERE user_id = ? AND report_date = ?',
        [userId, dateStr]
      );
    } catch (err) {
      report = await dbGetOne(db,
        'SELECT * FROM sleep_reports WHERE user_id=? AND report_date=?',
        [userId, dateStr]);
      if (!report) return res.json({ code: 1001, message: '生成报告失败' });
    }
  }

  // 2. 检查 breath_rate_json，若无则懒加载生成
  let breathData = [];
  let labels = [];
  if (report.breath_rate_json) {
    try {
      const parsed = JSON.parse(report.breath_rate_json);
      if (Array.isArray(parsed) && parsed.length === 96) {
        breathData = parsed;
        for (let i = 0; i < 96; i++) {
          const hour = Math.floor(i / 12) + 22;
          const displayHour = hour >= 24 ? hour - 24 : hour;
          const minute = (i % 12) * 5;
          labels.push(`${String(displayHour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`);
        }
        return res.json({ code: 0, message: 'success', data: { date: dateStr, breathRate: breathData, labels } });
      }
    } catch (e) { /* 重新生成 */ }
  }

  // 3. 生成呼吸频率数据（96 个点，22:00-06:00，每5分钟）
  const seedKey = `${userId}_${deviceId}_${dateStr}_breath`;
  const rand = seededRandom(seedKey);
  const POINTS = 96;
  const newBreath = [];
  for (let i = 0; i < POINTS; i++) {
    const pos = i / POINTS;
    let baseBr;
    if (pos < 0.3) { baseBr = 14 + rand() * 4; }        // 入睡期
    else if (pos < 0.6) { baseBr = 12 + rand() * 3; }   // 深睡期：呼吸最慢
    else { baseBr = 13 + rand() * 5; }                    // REM期：波动大
    newBreath.push(parseFloat(baseBr.toFixed(1)));
  }

  // 4. 更新数据库（复用 breath_rate_json 字段，若不存在则动态添加）
  // 注意：schema 中未定义该列，使用 ALTER TABLE 兼容
  try {
    await db.run('ALTER TABLE sleep_reports ADD COLUMN breath_rate_json TEXT');
  } catch (_) { /* 列已存在 */ }
  await db.run('UPDATE sleep_reports SET breath_rate_json = ? WHERE id = ?',
    [JSON.stringify(newBreath), report.id]);
  saveDb();

  // 5. 生成标签
  for (let i = 0; i < POINTS; i++) {
    const hour = Math.floor(i / 12) + 22;
    const displayHour = hour >= 24 ? hour - 24 : hour;
    const minute = (i % 12) * 5;
    labels.push(`${String(displayHour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`);
  }

  res.json({ code: 0, message: 'success', data: { date: dateStr, breathRate: newBreath, labels } });
});

// =====================================================
// 睡眠评分汇总 GET /api/sleep/summary
// =====================================================

/**
 * 获取或创建某一天的睡眠评分
 * 若 sleep_reports 中已有记录则直接返回 sleep_score；
 * 否则生成完整基础指标 + 空 JSON 字段并 INSERT，返回新评分。
 */
async function getOrCreateDailyScore(userId, deviceId, dateStr) {
  const db = await getDb();

  const row = await dbGetOne(db,
    'SELECT sleep_score FROM sleep_reports WHERE user_id = ? AND report_date = ?',
    [userId, dateStr]
  );
  if (row) return row.sleep_score;

  // 生成完整报告（复用第4节）
  const rand = seededRandom(`${userId}_${deviceId}_${dateStr}`);
  const total = Math.floor(300 + rand() * 180);
  const deepR = 0.15 + rand() * 0.20;
  const remR = 0.20 + rand() * 0.05;
  const deep = Math.floor(total * deepR);
  const rem = Math.floor(total * remR);
  const light = total - deep - rem;
  const score = Math.floor(60 + rand() * 40);
  const awake = Math.floor(rand() * 6);
  const awakeMin = Math.floor(rand() * 30);

  try {
    await db.run(
      `INSERT INTO sleep_reports
        (user_id, device_id, report_date, sleep_score, total_sleep_minutes,
         deep_sleep_minutes, light_sleep_minutes, rem_sleep_minutes,
         awake_minutes, awake_count, heart_rate_json, sleep_stages_json, noise_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, deviceId, dateStr, score, total,
       deep, light, rem,
       awakeMin, awake, '[]', '[]', '[]']
    );
    saveDb();
    return score;
  } catch (err) {
    const retry = await dbGetOne(db,
      'SELECT sleep_score FROM sleep_reports WHERE user_id=? AND report_date=?',
      [userId, dateStr]
    );
    if (retry) return retry.sleep_score;
    throw err;
  }
}

/** 获取 ISO 周数 */
function getWeekNumber(d) {
  const temp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  temp.setDate(temp.getDate() + 3 - (temp.getDay() + 6) % 7);
  const week1 = new Date(temp.getFullYear(), 0, 4);
  return 1 + Math.round(((temp - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

app.get('/api/sleep/summary', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const period = req.query.period || 'day';
  let baseDate = new Date();
  if (req.query.date) baseDate = new Date(req.query.date);
  baseDate.setDate(baseDate.getDate() - 1);

  const db = await getDb();
  let deviceId = 0;
  const devRow = await dbGetOne(db, 'SELECT id FROM devices WHERE user_id = ? LIMIT 1', [userId]);
  if (devRow) deviceId = devRow.id;

  let labels = [], scores = [];
  let totalSum = 0, totalCount = 0;

  if (period === 'day') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const score = await getOrCreateDailyScore(userId, deviceId, dateStr);
      labels.push(`${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`);
      scores.push(score);
      totalSum += score; totalCount++;
    }
  } else if (period === 'week') {
    const startOfWeek = new Date(baseDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    for (let w = 5; w >= 0; w--) {
      const weekStart = new Date(startOfWeek);
      weekStart.setDate(weekStart.getDate() - w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      let weekSum = 0, weekCount = 0;
      for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        weekSum += await getOrCreateDailyScore(userId, deviceId, dateStr);
        weekCount++;
      }
      const avg = parseFloat((weekSum / weekCount).toFixed(1));
      labels.push(`第${getWeekNumber(weekStart)}周`);
      scores.push(avg);
      totalSum += avg; totalCount++;
    }
  } else if (period === 'month') {
    const startOfMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    for (let m = 5; m >= 0; m--) {
      const monthStart = new Date(startOfMonth);
      monthStart.setMonth(monthStart.getMonth() - m);
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      let monthSum = 0, monthCount = 0;
      for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        monthSum += await getOrCreateDailyScore(userId, deviceId, dateStr);
        monthCount++;
      }
      const avg = parseFloat((monthSum / monthCount).toFixed(1));
      labels.push(`${monthStart.getFullYear()}-${String(monthStart.getMonth()+1).padStart(2,'0')}`);
      scores.push(avg);
      totalSum += avg; totalCount++;
    }
  }

  const avgScore = parseFloat((totalSum / totalCount).toFixed(1));
  res.json({ code: 0, message: 'success', data: { period, labels, scores, avg_score: avgScore } });
});

// =====================================================
// 异步启动服务
// =====================================================
async function start() {
  try {
    // 1. 初始化数据库（建表 + 索引）
    console.log('[App] 正在初始化数据库...');
    await initDatabase();

    // 1.5 自动迁移：将 role 字段 INTEGER → TEXT（仅 SQLite，MySQL 建表时已是 TEXT）
    if (DB_TYPE === 'sqlite') {
      const db = await getDb();
      const roleMap = { 0: 'patient', 1: 'doctor', 2: 'admin' };
      const stmt = db.prepare("SELECT id, role FROM users WHERE typeof(role) = 'integer'");
      const legacyRows = [];
      while (stmt.step()) legacyRows.push(stmt.getAsObject());
      stmt.free();
      if (legacyRows.length > 0) {
        console.log(`[App] 检测到 ${legacyRows.length} 条旧格式 role，正在迁移…`);
        for (const row of legacyRows) {
          const newRole = roleMap[row.role] || 'patient';
          await db.run('UPDATE users SET role = ? WHERE id = ?', [newRole, row.id]);
        }
        saveDb();
        console.log('[App] role 迁移完成');
      }
    }

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

// =====================================================
// 作息设置 GET/PUT /api/setting/plan
// =====================================================

// 获取设置
app.get('/api/setting/plan', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const db = await getDb();

  let row = await dbGetOne(db,
    'SELECT * FROM user_settings WHERE user_id = ?',
    [userId]
  );

  // 不存在则创建默认设置
  if (!row) {
    await db.run(
      'INSERT INTO user_settings (user_id) VALUES (?)',
      [userId]
    );
    saveDb();
    row = await dbGetOne(db,
      'SELECT * FROM user_settings WHERE user_id = ?',
      [userId]
    );
  }

  res.json({
    code: 0,
    message: 'success',
    data: {
      bed_time: row.bedtime || '23:00',
      wake_time: row.wakeup_time || '07:00',
      sunrise_duration_minutes: row.sunrise_duration || 10
    }
  });
});

// 更新设置
app.put('/api/setting/plan', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { bed_time, wake_time, sunrise_duration_minutes } = req.body;
  const db = await getDb();

  // 确保记录存在
  const exists = await dbGetOne(db, 'SELECT user_id FROM user_settings WHERE user_id = ?', [userId]);
  if (!exists) {
    await db.run('INSERT INTO user_settings (user_id) VALUES (?)', [userId]);
  }

  await db.run(
    'UPDATE user_settings SET bedtime = ?, wakeup_time = ?, sunrise_duration = ? WHERE user_id = ?',
    [bed_time || '23:00', wake_time || '07:00', sunrise_duration_minutes || 10, userId]
  );
  saveDb();

  res.json({ code: 0, message: '保存成功', data: null });
});

// =====================================================
// 医生授权接口（均需登录）
// =====================================================

/**
 * 患者授权医生
 * POST /api/doctor/grant
 * 支持两种传参：优先 doctor_id（数字），其次 doctor_phone（字符串）
 * @param {number} [doctor_id]  - 医生ID
 * @param {string} [doctor_phone] - 医生手机号
 * @returns {{code: number, message: string, data: object|null}}
 */
app.post('/api/doctor/grant', authenticateToken, async (req, res) => {
  // ---- 0. 仅患者角色可发起授权 ----
  if (req.user.role !== 'patient') {
    return res.json({ code: 1003, message: '仅患者可发起医生授权', data: null });
  }

  const patientId = req.user.id;
  const doctorId = parseInt(req.body.doctor_id, 10);
  const doctorPhone = req.body.doctor_phone;

  const db = await getDb();
  let doctor = null;

  // ---- 1. 优先按 doctor_id 查，其次按 doctor_phone 查 ----
  if (doctorId && !isNaN(doctorId)) {
    doctor = await dbGetOne(
      db,
      "SELECT id, nickname FROM users WHERE id = ? AND role = 'doctor'",
      [doctorId]
    );
  } else if (doctorPhone) {
    doctor = await dbGetOne(
      db,
      "SELECT id, nickname FROM users WHERE phone = ? AND role = 'doctor'",
      [doctorPhone]
    );
  } else {
    return res.json({ code: 1001, message: '请指定医生', data: null });
  }

  if (!doctor) {
    return res.json({ code: 1001, message: '该医生不存在', data: null });
  }

  // ---- 1.5 禁止医生给自己授权（自己挂自己的号） ----
  if (patientId === doctor.id) {
    return res.json({ code: 3001, message: '不能授权给自己', data: null });
  }

  // ---- 2. 检查是否已授权（pending 或 active） ----
  const existing = await dbGetOne(
    db,
    'SELECT id FROM doctor_authorizations WHERE patient_id = ? AND doctor_id = ? AND status IN (\'pending\', \'active\')',
    [patientId, doctor.id]
  );
  if (existing) {
    return res.json({ code: 1001, message: '已授权该医生', data: null });
  }

  // ---- 3. 计算过期时间（30天后） ----
  const expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + 30);
  const expireStr = expireDate.toISOString().split('T')[0];

  // ---- 4. 插入授权记录 ----
  const now = new Date().toISOString();
  await db.run(
    'INSERT INTO doctor_authorizations (patient_id, doctor_id, status, expire_date, requested_at, created_at, updated_at) VALUES (?, ?, \'pending\', ?, ?, ?, ?)',
    [patientId, doctor.id, expireStr, now, now, now]
  );
  saveDb();

  // ---- 5. 返回结果 ----
  const newAuth = await dbGetOne(
    db,
    'SELECT * FROM doctor_authorizations WHERE patient_id = ? AND doctor_id = ?',
    [patientId, doctor.id]
  );
  return res.json({ code: 0, message: '授权成功', data: newAuth });
});

/**
 * 患者撤销医生授权
 * DELETE /api/doctor/revoke
 * @param {number} doctor_id - 医生ID
 * @returns {{code: number, message: string, data: null}}
 */
app.delete('/api/doctor/revoke', authenticateToken, async (req, res) => {
  try {
    // 仅患者可撤销授权
    if (req.user.role !== 'patient') {
      return res.json({ code: 1003, message: '仅患者可撤销授权', data: null });
    }
    const patientId = req.user.id;
    const doctorId = parseInt(req.body.doctor_id, 10);

    // ---- 1. 参数校验 ----
    if (!doctorId || isNaN(doctorId)) {
      return res.json({ code: 1001, message: '请指定医生', data: null });
    }

    const db = await getDb();

    // ---- 2. 查询有效授权记录 ----
    const auth = await dbGetOne(
      db,
      `SELECT id FROM doctor_authorizations
       WHERE patient_id = ? AND doctor_id = ? AND status IN ('pending', 'active')`,
      [patientId, doctorId]
    );

    if (!auth) {
      return res.json({ code: 2001, message: '未找到该授权', data: null });
    }

    // ---- 3. 更新状态为 revoked ----
    const now = new Date().toISOString();
    await db.run(
      'UPDATE doctor_authorizations SET status = ?, updated_at = ? WHERE id = ?',
      ['revoked', now, auth.id]
    );

    // ---- 4. 持久化到磁盘 ----
    saveDb();

    res.json({ code: 0, message: '已撤销授权', data: null });
  } catch (err) {
    console.error('[撤销授权] 服务器错误：', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误', data: null });
  }
});

/**
 * 获取已授权的医生列表
 * GET /api/doctor/granted
 * @returns {{code: number, message: string, data: object[]}}
 */
app.get('/api/doctor/granted', authenticateToken, async (req, res) => {
  try {
    const patientId = req.user.id;
    const db = await getDb();

    // ---- 跨表查询：JOIN users 获取医生信息，过滤有效授权和过期时间 ----
    const doctors = await dbGetAll(
      db,
      `SELECT a.id, a.doctor_id, u.nickname as doctor_name, u.phone as doctor_phone,
              a.status, a.expire_date, a.requested_at
       FROM doctor_authorizations a
       JOIN users u ON a.doctor_id = u.id
       WHERE a.patient_id = ?
         AND a.status IN ('pending', 'active')
         AND a.expire_date >= date('now')
       ORDER BY a.requested_at DESC`,
      [patientId]
    );

    res.json({ code: 0, message: 'success', data: doctors });
  } catch (err) {
    console.error('[已授权列表] 服务器错误：', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误', data: null });
  }
});

/**
 * 医生确认患者授权请求
 * PUT /api/doctor/confirm
 * @param {number} patient_id - 患者ID
 * @returns {{code: number, message: string, data: object|null}}
 */
app.put('/api/doctor/confirm', authenticateToken, async (req, res) => {
  const doctorId = req.user.id;

  // 1. 验证角色
  if (req.user.role !== 'doctor') {
    return res.json({ code: 1001, message: '仅限医生操作', data: null });
  }

  const patientId = parseInt(req.body.patient_id, 10);
  if (!patientId || isNaN(patientId)) {
    return res.json({ code: 1001, message: '请指定患者', data: null });
  }

  const db = await getDb();

  // 2. 查找待确认的授权记录
  const auth = await dbGetOne(db, `
    SELECT id FROM doctor_authorizations
    WHERE doctor_id = ? AND patient_id = ?
      AND status = 'pending' AND expire_date >= date('now')
  `, [doctorId, patientId]);

  if (!auth) {
    return res.json({ code: 1001, message: '未找到待确认的授权请求', data: null });
  }

  // 3. 更新状态为 active
  const now = new Date().toISOString();
  await db.run(`
    UPDATE doctor_authorizations
    SET status = 'active', responded_at = ?, updated_at = ?
    WHERE id = ?
  `, [now, now, auth.id]);

  saveDb();

  // 4. 返回更新后的记录
  const updated = await dbGetOne(db,
    'SELECT * FROM doctor_authorizations WHERE id = ?',
    [auth.id]
  );

  return res.json({ code: 0, message: '确认授权成功', data: updated });
});

// GET /api/doctor/patients —— 医生获取已授权患者列表
app.get('/api/doctor/patients', authenticateToken, async (req, res) => {
  const doctorId = req.user.id;
  if (req.user.role !== 'doctor') {
    return res.json({ code: 1001, message: '仅限医生访问', data: null });
  }
  const db = await getDb();
  const sql = `
    SELECT u.id as patient_id, u.nickname, u.phone,
           a.status, a.expire_date, a.requested_at,
           a.doctor_note,
           (SELECT sleep_score FROM sleep_reports
            WHERE user_id = u.id
            ORDER BY report_date DESC LIMIT 1) as latest_score
    FROM doctor_authorizations a
    JOIN users u ON a.patient_id = u.id
    WHERE a.doctor_id = ?
      AND a.status IN ('pending', 'active')
      AND a.expire_date >= date('now')
    ORDER BY a.requested_at DESC
  `;
  const patients = await dbGetAll(db, sql, [doctorId]);
  return res.json({ code: 0, message: 'success', data: patients });
});

// GET /api/doctor/patient/data —— 获取指定患者的睡眠报告
app.get('/api/doctor/patient/data', authenticateToken, async (req, res) => {
  const doctorId = req.user.id;
  if (req.user.role !== 'doctor') {
    return res.json({ code: 1001, message: '仅限医生访问', data: null });
  }

  const patientId = parseInt(req.query.patient_id, 10);
  if (!patientId || isNaN(patientId)) {
    return res.json({ code: 1001, message: '请指定患者', data: null });
  }

  // 日期参数，默认昨天
  let dateStr = req.query.date;
  if (!dateStr) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateStr = yesterday.toISOString().split('T')[0];
  }

  const db = await getDb();

  // ⚠️ 必须 status = 'active'（不能用 pending）
  const auth = await dbGetOne(db, `
    SELECT id FROM doctor_authorizations
    WHERE doctor_id = ? AND patient_id = ?
      AND status = 'active' AND expire_date >= date('now')
  `, [doctorId, patientId]);

  if (!auth) {
    return res.json({ code: 1001, message: '无权查看该患者数据（需先确认授权）', data: null });
  }

  // 查询睡眠报告
  const report = await dbGetOne(db, `
    SELECT * FROM sleep_reports
    WHERE user_id = ? AND report_date = ?
  `, [patientId, dateStr]);

  if (!report) {
    return res.json({ code: 1001, message: '暂无数据', data: null });
  }

  // 计算深睡比例
  const deepRatio = parseFloat((report.deep_sleep_minutes / report.total_sleep_minutes * 100).toFixed(1));

  return res.json({ code: 0, message: 'success', data: {
    patient_id:        patientId,
    report_date:       report.report_date,
    sleep_score:       report.sleep_score,
    total_sleep_minutes: report.total_sleep_minutes,
    deep_sleep_minutes:  report.deep_sleep_minutes,
    rem_sleep_minutes:   report.rem_sleep_minutes,
    light_sleep_minutes: report.light_sleep_minutes,
    awake_count:       report.awake_count,
    deep_ratio:        deepRatio,
  }});
});

// PUT /api/doctor/note —— 医生填写/更新干预建议
app.put('/api/doctor/note', authenticateToken, async (req, res) => {
  const doctorId = req.user.id;
  if (req.user.role !== 'doctor') {
    return res.json({ code: 1001, message: '仅限医生操作', data: null });
  }

  const patientId = parseInt(req.body.patient_id, 10);
  const note = (req.body.note || '').trim();

  if (!patientId || isNaN(patientId)) {
    return res.json({ code: 1001, message: '请指定患者', data: null });
  }

  const db = await getDb();

  // 验证授权关系：必须 status = 'active'
  const auth = await dbGetOne(db, `
    SELECT id FROM doctor_authorizations
    WHERE doctor_id = ? AND patient_id = ?
      AND status = 'active' AND expire_date >= date('now')
  `, [doctorId, patientId]);

  if (!auth) {
    return res.json({ code: 1001, message: '无权操作该患者', data: null });
  }

  // 更新干预建议
  const now = new Date().toISOString();
  await db.run(`
    UPDATE doctor_authorizations
    SET doctor_note = ?, updated_at = ?
    WHERE id = ?
  `, [note, now, auth.id]);

  saveDb();

  return res.json({ code: 0, message: '保存成功', data: { doctor_note: note } });
});

// GET /api/doctor/note —— 获取医生对某患者的干预建议
app.get('/api/doctor/note', authenticateToken, async (req, res) => {
  const doctorId = req.user.id;
  if (req.user.role !== 'doctor') {
    return res.json({ code: 1001, message: '仅限医生访问', data: null });
  }

  const patientId = parseInt(req.query.patient_id, 10);
  if (!patientId || isNaN(patientId)) {
    return res.json({ code: 1001, message: '请指定患者', data: null });
  }

  const db = await getDb();

  const row = await dbGetOne(db, `
    SELECT doctor_note FROM doctor_authorizations
    WHERE doctor_id = ? AND patient_id = ?
      AND status = 'active' AND expire_date >= date('now')
  `, [doctorId, patientId]);

  if (!row) {
    return res.json({ code: 1001, message: '未找到有效授权', data: null });
  }

  return res.json({ code: 0, message: 'success', data: { doctor_note: row.doctor_note || '' } });
});

// GET /api/patient/note/check —— 患者检查医生干预建议
app.get('/api/patient/note/check', authenticateToken, async (req, res) => {
  const patientId = req.user.id;
  const db = await getDb();

  const row = await dbGetOne(db, `
    SELECT a.doctor_note, a.updated_at, u.nickname AS doctor_name
    FROM doctor_authorizations a
    JOIN users u ON a.doctor_id = u.id
    WHERE a.patient_id = ?
      AND a.status = 'active'
      AND a.expire_date >= date('now')
      AND a.doctor_note IS NOT NULL
      AND a.doctor_note != ''
    ORDER BY a.updated_at DESC
    LIMIT 1
  `, [patientId]);

  if (!row) {
    return res.json({ code: 0, message: 'success', data: {
      has_note: false, doctor_name: null, doctor_note: null, updated_at: null
    }});
  }

  return res.json({ code: 0, message: 'success', data: {
    has_note: true,
    doctor_name: row.doctor_name,
    doctor_note: row.doctor_note,
    updated_at: row.updated_at
  }});
});

// =====================================================
// 统一错误处理中间件（必须放在所有路由之后）
// =====================================================
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack || err.message || err);
  res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    data: null
  });
});

// 启动服务
start();

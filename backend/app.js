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
    const existUser = dbGetOne(db, 'SELECT user_id FROM users WHERE phone = ?', [phone]);
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
      'SELECT user_id AS id, phone, nickname, role FROM users WHERE phone = ?',
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
      'SELECT user_id, phone, password_hash, nickname, role, status FROM users WHERE phone = ?',
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
      { id: user.user_id, phone: user.phone, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // ---- 8. 更新最近登录时间 ----
    const now = new Date().toISOString();
    db.run('UPDATE users SET updated_at = ? WHERE user_id = ?', [now, user.user_id]);

    // ---- 9. 持久化到磁盘 ----
    saveDb();

    // ---- 10. 返回登录成功响应 ----
    res.json({
      code: 0,
      message: '登录成功',
      data: {
        token,
        id: user.user_id,
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

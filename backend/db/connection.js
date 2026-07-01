/**
 * 数据库连接模块（支持 SQLite / MySQL 双驱动）
 *
 * 通过环境变量 DATABASE_TYPE 切换：
 *   - sqlite（默认）：使用 sql.js（纯 JS，无需原生编译）
 *   - mysql：使用 mysql2（需 npm install mysql2）
 *
 * 提供统一的 getDb() / saveDb() / dbGetOne() / dbGetAll() 接口，
 * 现有代码无需改动。
 */

const fs = require('fs');
const path = require('path');

// ---- 配置 ----
const DB_TYPE = process.env.DATABASE_TYPE || 'sqlite';
const DB_PATH = path.resolve(__dirname, '../../sleep_care.db');
const MYSQL_CONFIG = {
  host:     process.env.MYSQL_HOST || 'localhost',
  port:     process.env.MYSQL_PORT || 3306,
  user:     process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'root',
  database: process.env.MYSQL_DATABASE || 'sleep_care'
};

// ---- 单例 ----
let db = null;
let pool = null;       // MySQL 连接池
let _SQL = null;       // sql.js 实例

// ============================================================
// 统一入口
// ============================================================
async function getDb() {
  if (DB_TYPE === 'mysql') return await getMySQL();
  return await getSQLite();
}

function saveDb() {
  if (DB_TYPE === 'mysql') return; // MySQL 自动持久化
  saveSQLite();
}

// ============================================================
// SQLite 实现
// ============================================================
async function getSQLite() {
  if (db) return db;

  const initSqlJs = require('sql.js');
  _SQL = await initSqlJs();

  let buffer = null;
  if (fs.existsSync(DB_PATH)) buffer = fs.readFileSync(DB_PATH);

  db = new _SQL.Database(buffer);
  db.run('PRAGMA foreign_keys = ON;');
  console.log(`[数据库] SQLite 已连接：${DB_PATH}`);
  return db;
}

function saveSQLite() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  console.log(`[数据库] SQLite 已持久化：${DB_PATH}`);
}

// ============================================================
// MySQL 实现
// ============================================================
async function getMySQL() {
  if (pool) return pool;
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({
    ...MYSQL_CONFIG,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4'
  });
  // 测试连接
  const conn = await pool.getConnection();
  console.log(`[数据库] MySQL 已连接：${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database}`);
  conn.release();

  // 包装 pool，添加 .run() 兼容 SQLite 语法
  // 注意：MySQL 下 db.run() 返回 Promise（需 await），
  // 若不 await，查询会异步执行但错误会被静默忽略。
  // 推荐在 MySQL 模式下全局替换 `db.run(` → `await db.run(`
  const wrapper = {
    run: (sql, params = []) => {
      const p = pool.execute(sql, params);
      p.catch(err => console.error('[MySQL] run() error:', err.message));
      return p;
    },
    execute: (sql, params) => pool.execute(sql, params),
    getConnection: () => pool.getConnection(),
    pool
  };
  return wrapper;
}

// ============================================================
// 统一查询工具（兼容两种驱动）
// ============================================================

/**
 * 查询单条记录
 * 注意：SQLite 路径同步返回结果对象；MySQL 路径返回 Promise。
 * 当前项目默认使用 SQLite，因此调用方无需 await（加了也不影响）。
 * @param {*} conn - getDb() 返回的连接
 * @param {string} sql - SQL 语句
 * @param {Array} params - 参数数组
 * @returns {Object|null|Promise<Object|null>} 查询结果（单行对象或 null）
 */
function dbGetOne(conn, sql, params = []) {
  if (DB_TYPE === 'mysql') {
    // MySQL：返回 Promise，调用方需 await
    return conn.execute(sql, params).then(([rows]) => rows.length > 0 ? rows[0] : null);
  }
  // SQLite（sql.js）：同步返回，兼容现有代码
  const stmt = conn.prepare(sql);
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
 * 注意：SQLite 路径同步返回数组；MySQL 路径返回 Promise。
 * 当前项目默认使用 SQLite，因此调用方无需 await（加了也不影响）。
 * @param {*} conn - getDb() 返回的连接
 * @param {string} sql - SQL 语句
 * @param {Array} params - 参数数组
 * @returns {Array|Promise<Array>} 查询结果数组
 */
function dbGetAll(conn, sql, params = []) {
  if (DB_TYPE === 'mysql') {
    // MySQL：返回 Promise，调用方需 await
    return conn.execute(sql, params).then(([rows]) => rows);
  }
  // SQLite（sql.js）：同步返回，兼容现有代码
  const stmt = conn.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

module.exports = { getDb, saveDb, dbGetOne, dbGetAll, DB_PATH, DB_TYPE };

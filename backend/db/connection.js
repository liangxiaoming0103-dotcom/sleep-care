/**
 * 数据库连接模块
 * 基于 sql.js（纯 WebAssembly 实现，无需原生编译），提供数据库连接单例和持久化能力。
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// 数据库文件路径：位于项目根目录 sleep_care.db
const DB_PATH = path.resolve(__dirname, '../../sleep_care.db');

let db = null;    // 数据库连接单例
let _SQL = null;  // sql.js 初始化后的 SQL 实例，用于后续创建连接

/**
 * 异步获取数据库连接单例
 * 首次调用时初始化 sql.js 并加载已有数据库文件（若存在），后续调用直接返回已有连接。
 * @returns {Promise<import('sql.js').Database>} 数据库连接实例
 */
async function getDb() {
  if (db) return db;

  // 初始化 sql.js（加载 WASM）
  _SQL = await initSqlJs();

  // 如果数据库文件已存在则读取，否则创建空数据库
  let buffer = null;
  if (fs.existsSync(DB_PATH)) {
    buffer = fs.readFileSync(DB_PATH);
  }

  db = new _SQL.Database(buffer);

  // 开启外键约束（SQLite 默认关闭）
  db.run('PRAGMA foreign_keys = ON;');

  console.log(`[数据库] 已连接：${DB_PATH}`);

  return db;
}

/**
 * 将内存中的数据库持久化到磁盘文件
 * 所有 INSERT/UPDATE/DELETE 操作后必须调用此函数，否则数据将在进程退出后丢失。
 */
function saveDb() {
  if (!db) {
    console.warn('[数据库] saveDb() 调用时数据库尚未初始化，跳过');
    return;
  }
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
  console.log(`[数据库] 已持久化：${DB_PATH}`);
}

module.exports = { getDb, saveDb, DB_PATH };

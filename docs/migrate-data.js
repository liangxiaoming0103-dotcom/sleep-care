/**
 * SQLite → MySQL 数据迁移脚本
 *
 * 用法：
 *   1. npm install better-sqlite3 mysql2
 *   2. 修改下方 MySQL_CONFIG
 *   3. node docs/migrate-data.js
 */

const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
const path = require('path');

// ============================================================
// 配置
// ============================================================
const SQLITE_PATH = path.join(__dirname, '..', 'sleep_care.db');

const MYSQL_CONFIG = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'root',
  database: 'sleep_care',
  charset: 'utf8mb4'
};

// ============================================================
// 表映射：SQLite 表名 → MySQL 表名
// ============================================================
const TABLES = [
  'users',
  'devices',
  'sleep_reports',
  'user_settings',
  'doctor_authorizations'
];

// 需要转换的字段（JSON 字段在 SQLite 中以 TEXT 存储）
const JSON_COLUMNS = {
  sleep_reports: ['heart_rate_json', 'sleep_stages_json', 'noise_json', 'breath_rate_json']
};

// ============================================================
// 主流程
// ============================================================
(async () => {
  console.log('\n📦 SQLite → MySQL 数据迁移\n');

  // 1. 打开 SQLite
  console.log(`[SQLite] ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  // 2. 连接 MySQL
  console.log(`[MySQL]  ${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database}`);
  const conn = await mysql.createConnection(MYSQL_CONFIG);

  // 3. 禁用外键检查（加快导入）
  await conn.execute('SET FOREIGN_KEY_CHECKS = 0');

  let totalRows = 0;

  for (const table of TABLES) {
    // 读取 SQLite 数据
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length === 0) {
      console.log(`  ${table}: 0 行，跳过`);
      continue;
    }

    // 转换 JSON 字段
    const jsonCols = JSON_COLUMNS[table] || [];
    for (const row of rows) {
      for (const col of jsonCols) {
        if (row[col] && typeof row[col] === 'string') {
          try { row[col] = JSON.parse(row[col]); } catch (_) {}
        }
      }
    }

    // 清空 MySQL 目标表
    await conn.execute(`TRUNCATE TABLE ${table}`);

    // 批量插入
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

    let inserted = 0;
    for (const row of rows) {
      try {
        await conn.execute(sql, Object.values(row));
        inserted++;
      } catch (err) {
        console.error(`  ⚠ ${table} row error: ${err.message}`);
      }
    }

    console.log(`  ✓ ${table}: ${inserted}/${rows.length} 行`);
    totalRows += inserted;
  }

  // 4. 恢复外键检查
  await conn.execute('SET FOREIGN_KEY_CHECKS = 1');

  // 5. 关闭连接
  sqlite.close();
  await conn.end();

  console.log(`\n✅ 迁移完成！共 ${totalRows} 行\n`);
})().catch(err => {
  console.error('\n❌ 迁移失败：', err.message);
  process.exit(1);
});

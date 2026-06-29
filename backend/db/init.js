/**
 * 数据库初始化入口
 * 导出 initDatabase() 函数，调用 schema.js 完成建表。
 *
 * 使用方式：
 *   const { initDatabase } = require('./db/init');
 *   initDatabase().then(() => { console.log('数据库就绪'); });
 *
 * 或作为独立脚本运行：
 *   node db/init.js
 */

const { initSchema } = require('./schema');

/**
 * 初始化数据库：创建所有表和索引
 * @returns {Promise<void>}
 */
async function initDatabase() {
  console.log('[Init] 正在初始化数据库...');

  await initSchema();

  console.log('[Init] 数据库初始化完毕');
}

// 作为脚本直接运行时的入口
if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Init] 数据库初始化失败：', err);
      process.exit(1);
    });
}

module.exports = { initDatabase };

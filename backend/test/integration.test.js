/**
 * 医患互动集成测试
 *
 * 用法：node backend/test/integration.test.js
 * 前提：后端已启动（node backend/app.js）
 */

const BASE = 'http://localhost:3000';

let doctorToken = '';
let patientToken = '';
let doctorId = null;
let step = 0;

function log(msg) {
  console.log(`  [${String(++step).padStart(2, '0')}] ${msg}`);
}

function fail(msg) {
  console.error(`\n❌ 测试失败（步骤 ${step}）：${msg}`);
  process.exit(1);
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}

async function get(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  return res.json();
}

async function put(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  return res.json();
}

async function check(json, label) {
  if (json.code !== 0) fail(`${label} — code=${json.code} message="${json.message}"`);
  console.log(`      ✓ ${label}`);
  return json.data;
}

(async () => {
  console.log('\n🧪 医患互动集成测试\n');
  console.log(`   API: ${BASE}\n`);

  // ──── a. 注册医生 ────
  log('注册医生 (18800000001 / 张医生 / role=doctor)');
  const regDoc = await post('/api/auth/register', {
    phone: '18800000001', password: '123456', nickname: '张医生', role: 'doctor'
  });
  // 注册可能因已存在而失败，忽略（幂等测试）
  if (regDoc.code === 3001 || regDoc.code === 0) {
    console.log(`      ✓ 医生账号就绪`);
  } else {
    fail(`注册医生 — ${regDoc.message}`);
  }

  // ──── b. 注册患者 ────
  log('注册患者 (18800000002 / 李患者 / role=patient)');
  const regPat = await post('/api/auth/register', {
    phone: '18800000002', password: '123456', nickname: '李患者', role: 'patient'
  });
  if (regPat.code === 3001 || regPat.code === 0) {
    console.log(`      ✓ 患者账号就绪`);
  } else {
    fail(`注册患者 — ${regPat.message}`);
  }

  // ──── c. 患者登录 ────
  log('患者登录');
  const patLogin = await post('/api/auth/login', { phone: '18800000002', password: '123456' });
  const patData = await check(patLogin, '患者登录');
  patientToken = patData.token;
  if (patData.role !== 'patient') fail(`患者角色错误：${patData.role}`);

  // ──── d. 获取医生列表 ────
  log('获取医生列表 → 找到张医生');
  const docList = await get('/api/users/doctors');
  const docs = await check(docList, '获取医生列表');
  const targetDoc = docs.find(d => d.phone === '18800000001');
  if (!targetDoc) fail('未找到张医生（phone=18800000001）');
  doctorId = targetDoc.id;
  console.log(`      ✓ 医生 ID = ${doctorId}`);

  // ──── e. 患者授权医生 ────
  log(`患者授权医生 (doctor_id=${doctorId})`);
  const grant = await post('/api/doctor/grant', { doctor_id: doctorId }, patientToken);
  // 已授权视为成功
  if (grant.code === 1001 && grant.message.includes('已授权')) {
    console.log(`      ✓ 已授权（跳过）`);
  } else {
    await check(grant, '授权医生');
  }

  // ──── f. 医生登录 ────
  log('医生登录');
  const docLogin = await post('/api/auth/login', { phone: '18800000001', password: '123456' });
  const docData = await check(docLogin, '医生登录');
  doctorToken = docData.token;
  if (docData.role !== 'doctor') fail(`医生角色错误：${docData.role}`);

  // ──── g. 医生查看患者列表 ────
  log('医生查看患者列表 → 检查 status');
  const patList = await get('/api/doctor/patients', doctorToken);
  const patients = await check(patList, '获取患者列表');
  const targetPat = patients.find(p => p.patient_id === patData.id);
  if (!targetPat) fail('患者列表中未找到李患者');
  if (targetPat.status !== 'active' && targetPat.status !== 'pending') {
    fail(`患者状态异常：${targetPat.status}`);
  }
  console.log(`      ✓ status = ${targetPat.status}`);

  // ──── h. 医生确认授权（如果状态为 pending）
  if (targetPat.status === 'pending') {
    log(`医生确认授权 (patient_id=${patData.id})`);
    const confirm = await put('/api/doctor/confirm', { patient_id: patData.id }, doctorToken);
    await check(confirm, '确认授权');
  } else {
    log('授权已为 active，跳过确认步骤');
    console.log(`      ✓ 已确认`);
  }

  // ──── i. 患者触发报告生成（必须先有报告，医生才能查）────
  log('患者查看自己的睡眠报告（触发生成）');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  const selfReport = await get(`/api/sleep/report/daily?date=${dateStr}`, patientToken);
  await check(selfReport, '患者报告生成');
  console.log(`      ✓ 评分 = ${selfReport.data.sleep_score}`);

  // ──── j. 医生查看患者报告 ────
  log('医生查看患者报告');
  const report = await get(`/api/doctor/patient/data?patient_id=${patData.id}&date=${dateStr}`, doctorToken);
  const repData = await check(report, '获取患者报告');
  if (repData.sleep_score == null) fail('报告中无 sleep_score');
  console.log(`      ✓ 评分 = ${repData.sleep_score}, 深睡比例 = ${repData.deep_ratio}%`);

  // ──── j. 医生填写干预建议 ────
  log('医生填写干预建议');
  const noteText = `[自动化测试] 建议增加日间运动，保持规律作息。时间戳：${Date.now()}`;
  const saveNote = await put('/api/doctor/note', { patient_id: patData.id, note: noteText }, doctorToken);
  await check(saveNote, '保存干预建议');

  // ──── k. 医生获取干预建议 ────
  log('医生获取干预建议 → 验证内容一致');
  const getNote = await get(`/api/doctor/note?patient_id=${patData.id}`, doctorToken);
  const noteData = await check(getNote, '获取干预建议');
  if (noteData.doctor_note !== noteText) fail(`建议内容不一致！\n  写入: ${noteText}\n  读取: ${noteData.doctor_note}`);
  console.log(`      ✓ 内容一致`);

  // ──── 完成 ────
  console.log('\n✅ 所有集成测试通过！\n');
})();

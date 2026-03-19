// ====================== 1. 核心依赖引入 ======================
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

// ====================== 2. 基础配置（适配容器/本地） ======================
const app = express();
// 动态端口：优先用环境变量（Railway），兜底8080（本地）
const PORT = process.env.PORT || 8080;
// 数据库路径：容器用/tmp（有写权限），本地用当前目录
const DB_DIR = process.env.NODE_ENV === 'production' ? '/tmp/campusmove' : './campusmove';
const DB_PATH = path.join(DB_DIR, 'campusmove.db');

// 跨域配置（生产建议限定前端域名，此处兼容开发）
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// 请求体解析（限制大小，防止恶意请求）
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

// 静态文件托管（前端页面）
app.use(express.static(__dirname));

// ====================== 3. 邮箱配置（环境变量注入，安全无硬编码） ======================
const emailTransporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail', // 邮箱服务商（gmail/qq/163等）
  auth: {
    user: process.env.EMAIL_USER, // 你的邮箱账号（Railway配置）
    pass: process.env.EMAIL_PASS  // 邮箱授权码（不是登录密码，Railway配置）
  }
});

// ====================== 4. 数据库初始化（健壮性处理） ======================
let db;

// 创建数据库目录（防止不存在）
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// 连接数据库（错误兜底，数据库失败则退出服务）
db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
    process.exit(1);
  } else {
    console.log(`✅ 数据库连接成功（路径：${DB_PATH}）`);
    initDatabaseTables();
  }
});

// 初始化数据表（带字段约束和外键）
function initDatabaseTables() {
  // 用户表（核心：email唯一，phone仅存储）
  const userTableSql = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL,
      given_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      gender TEXT NOT NULL,
      anonymous_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // 搬家请求表（外键关联用户）
  const requestTableSql = `
    CREATE TABLE IF NOT EXISTS moving_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      move_date TEXT NOT NULL,
      location TEXT NOT NULL,
      helpers_needed TEXT NOT NULL,
      items TEXT NOT NULL,
      compensation TEXT NOT NULL,
      helper_assigned TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(student_id)
    )
  `;

  // 执行表初始化
  db.run(userTableSql, (err) => {
    if (err) console.error('❌ 用户表初始化失败:', err.message);
    else console.log('✅ 用户表初始化完成');
  });

  db.run(requestTableSql, (err) => {
    if (err) console.error('❌ 搬家请求表初始化失败:', err.message);
    else console.log('✅ 搬家请求表初始化完成');
  });
}

// ====================== 5. 工具函数（复用+校验） ======================
/**
 * 格式化新西兰手机号（仅格式处理，不验证）
 * @param {string} phone - 原始手机号
 * @returns {string} 格式化后的手机号（+64开头）
 */
function normalizeNZPhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('02')) return `+64${digits.slice(1)}`;
  if (digits.startsWith('64')) return `+${digits}`;
  return phone;
}

/**
 * 校验新西兰手机号格式
 * @param {string} phone - 格式化后的手机号
 * @returns {boolean} 是否有效
 */
function isValidNZPhone(phone) {
  if (!phone) return false;
  return /^\+642\d{7,9}$/.test(phone);
}

/**
 * 校验邮箱格式
 * @param {string} email - 邮箱地址
 * @returns {boolean} 是否有效
 */
function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ====================== 6. 核心业务接口（纯邮箱验证，手机号仅联系） ======================
// 健康检查接口（Railway/容器探针用）
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    port: PORT,
    db_connected: !!db,
    timestamp: new Date().toISOString()
  });
});

// 根路由返回前端页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * 发送邮箱验证码接口
 * 核心：仅给邮箱发验证码，手机号仅格式校验和存储
 */
app.post('/api/send-verification-code', async (req, res) => {
  try {
    const { email, phone } = req.body;

    // 1. 基础校验
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format! (e.g. your@email.com)' });
    }
    const normalizedPhone = normalizeNZPhone(phone);
    if (!isValidNZPhone(normalizedPhone)) {
      return res.status(400).json({ success: false, message: 'Invalid NZ mobile number! (must start with 02/+642)' });
    }

    // 2. 生成6位验证码
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. 存储验证码（按邮箱关联，不是手机号！）
    global.verificationCodes = global.verificationCodes || {};
    global.verificationCodes[email] = {
      code: verifyCode,
      expireTime: Date.now() + 5 * 60 * 1000 // 5分钟过期
    };

    // 4. 发送验证码到邮箱（核心：仅邮箱，不碰手机号）
    await emailTransporter.sendMail({
      from: `CampusMove <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'CampusMove - Your Verification Code',
      text: `Your verification code is: ${verifyCode}\nValid for 5 minutes.`,
      html: `<h3>CampusMove Verification Code</h3>
             <p>Your 6-digit code: <strong>${verifyCode}</strong></p>
             <p>This code is valid for 5 minutes.</p>
             <p>If you didn't request this, please ignore this email.</p>`
    });

    console.log(`📧 验证码已发送到邮箱: ${email}`);
    res.json({ success: true, message: 'Verification code sent to your email successfully!' });
  } catch (error) {
    console.error('❌ 发送验证码失败:', error.message);
    res.status(500).json({ success: false, message: `Failed to send code: ${error.message}` });
  }
});

/**
 * 注册接口
 * 核心：验证邮箱验证码，手机号仅存储
 */
app.post('/api/register', (req, res) => {
  const { givenName, firstName, studentId, gender, email, phone, verifyCode, anonymousName, password } = req.body;

  // 1. 全量入参校验
  if (!givenName || !firstName || !studentId || !gender || !email || !phone || !verifyCode || !anonymousName || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required!' });
  }

  // 2. 格式校验
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format!' });
  }
  const normalizedPhone = normalizeNZPhone(phone);
  if (!isValidNZPhone(normalizedPhone)) {
    return res.status(400).json({ success: false, message: 'Invalid NZ mobile number!' });
  }
  if (verifyCode.length !== 6) {
    return res.status(400).json({ success: false, message: 'Verification code must be 6 digits!' });
  }

  // 3. 验证邮箱验证码（核心：按邮箱查，不是手机号）
  const storedCode = (global.verificationCodes || {})[email];
  if (!storedCode) {
    return res.status(400).json({ success: false, message: 'No verification code sent to this email! Please get a code first.' });
  }
  if (storedCode.code !== verifyCode) {
    return res.status(400).json({ success: false, message: 'Incorrect verification code!' });
  }
  if (Date.now() > storedCode.expireTime) {
    return res.status(400).json({ success: false, message: 'Verification code expired! Please get a new one.' });
  }

  // 4. 查重（学号/邮箱/手机号）
  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, studentRow) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    if (studentRow) return res.status(409).json({ success: false, message: 'Student ID already registered!' });

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, emailRow) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      if (emailRow) return res.status(409).json({ success: false, message: 'Email already registered!' });

      db.get('SELECT * FROM users WHERE phone = ?', [normalizedPhone], (err, phoneRow) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        if (phoneRow) return res.status(409).json({ success: false, message: 'Phone number already registered!' });

        // 5. 插入用户数据（注册成功）
        db.run(`INSERT INTO users (
          student_id, given_name, first_name, gender, anonymous_name, phone, email, password
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [studentId, givenName, firstName, gender, anonymousName, normalizedPhone, email, password],
        (err) => {
          if (err) return res.status(500).json({ success: false, message: 'Registration failed: ' + err.message });
          
          // 清除已使用的验证码
          delete global.verificationCodes[email];
          console.log(`✅ 用户注册成功: ${studentId} (邮箱: ${email})`);
          res.json({ success: true, message: 'Registration successful! Please login.' });
        });
      });
    });
  });
});

/**
 * 登录接口
 */
app.post('/api/login', (req, res) => {
  const { studentId, password } = req.body;

  // 入参校验
  if (!studentId || !password) {
    return res.status(400).json({ success: false, message: 'Student ID and password are required!' });
  }

  // 验证用户
  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.status(404).json({ success: false, message: 'Student ID not found!' });
    if (row.password !== password) return res.status(401).json({ success: false, message: 'Incorrect password!' });

    console.log(`✅ 用户登录成功: ${studentId}`);
    res.json({
      success: true,
      message: 'Login successful!',
      anonymousName: row.anonymous_name
    });
  });
});

/**
 * 发布搬家请求接口
 */
app.post('/api/post-request', (req, res) => {
  const { studentId, moveDate, location, helpersNeeded, items, compensation } = req.body;

  // 入参校验
  if (!studentId || !moveDate || !location || !helpersNeeded || !items || !compensation) {
    return res.status(400).json({ success: false, message: 'All fields are required!' });
  }

  // 发布请求
  db.run(`INSERT INTO moving_requests (
    student_id, move_date, location, helpers_needed, items, compensation
  ) VALUES (?, ?, ?, ?, ?, ?)`,
  [studentId, moveDate, location, helpersNeeded, items, compensation],
  (err) => {
    if (err) return res.status(500).json({ success: false, message: 'Post failed: ' + err.message });
    console.log(`✅ 搬家请求发布成功: ${studentId} - ${location}`);
    res.json({ success: true, message: 'Moving request posted successfully!' });
  });
});

/**
 * 获取所有可用任务（未被接受的）
 */
app.get('/api/get-tasks', (req, res) => {
  db.all('SELECT * FROM moving_requests WHERE helper_assigned IS NULL', (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

/**
 * 接受任务接口
 */
app.post('/api/accept-task', (req, res) => {
  const { taskId, helperId } = req.body;

  // 入参校验
  if (!taskId || !helperId) {
    return res.status(400).json({ success: false, message: 'Task ID and Helper ID are required!' });
  }

  // 接受任务（仅更新未被分配的任务）
  db.run('UPDATE moving_requests SET helper_assigned = ? WHERE id = ? AND helper_assigned IS NULL',
  [helperId, taskId],
  function (err) {
    if (err) return res.status(500).json({ success: false, message: 'Accept failed: ' + err.message });
    if (this.changes === 0) return res.status(409).json({ success: false, message: 'Task already assigned to someone else!' });
    
    console.log(`✅ 任务被接受: ID-${taskId} (helper: ${helperId})`);
    res.json({ success: true, message: 'Task accepted successfully!' });
  });
});

/**
 * 获取我的发布任务
 */
app.post('/api/my-posted-tasks', (req, res) => {
  const { studentId } = req.body;

  if (!studentId) {
    return res.status(400).json({ success: false, message: 'Student ID is required!' });
  }

  db.all('SELECT * FROM moving_requests WHERE student_id = ?', [studentId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

/**
 * 获取我的接受任务
 */
app.post('/api/my-accepted-tasks', (req, res) => {
  const { helperId } = req.body;

  if (!helperId) {
    return res.status(400).json({ success: false, message: 'Helper ID is required!' });
  }

  db.all('SELECT * FROM moving_requests WHERE helper_assigned = ?', [helperId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

/**
 * 获取个人信息
 */
app.post('/api/get-profile', (req, res) => {
  const { studentId } = req.body;

  if (!studentId) {
    return res.status(400).json({ success: false, message: 'Student ID is required!' });
  }

  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.status(404).json({ success: false, message: 'User not found!' });

    res.json({
      success: true,
      user: {
        given_name: row.given_name,
        first_name: row.first_name,
        student_id: row.student_id,
        gender: row.gender,
        anonymous_name: row.anonymous_name,
        phone: row.phone,
        email: row.email
      }
    });
  });
});

/**
 * 删除我的发布任务
 */
app.post('/api/delete-task', (req, res) => {
  const { taskId, studentId } = req.body;

  if (!taskId || !studentId) {
    return res.status(400).json({ success: false, message: 'Task ID and Student ID are required!' });
  }

  db.run('DELETE FROM moving_requests WHERE id = ? AND student_id = ?', [taskId, studentId], function (err) {
    if (err) return res.status(500).json({ success: false, message: 'Delete failed: ' + err.message });
    if (this.changes === 0) return res.status(404).json({ success: false, message: 'Task not found or not yours!' });
    
    console.log(`❌ 任务被删除: ID-${taskId} (poster: ${studentId})`);
    res.json({ success: true, message: 'Task deleted successfully!' });
  });
});

/**
 * 取消我的接受任务
 */
app.post('/api/cancel-task', (req, res) => {
  const { taskId, helperId } = req.body;

  if (!taskId || !helperId) {
    return res.status(400).json({ success: false, message: 'Task ID and Helper ID are required!' });
  }

  db.run('UPDATE moving_requests SET helper_assigned = NULL WHERE id = ? AND helper_assigned = ?', [taskId, helperId], function (err) {
    if (err) return res.status(500).json({ success: false, message: 'Cancel failed: ' + err.message });
    if (this.changes === 0) return res.status(404).json({ success: false, message: 'Task not found or not accepted by you!' });
    
    console.log(`✅ 任务被取消: ID-${taskId} (helper: ${helperId})`);
    res.json({ success: true, message: 'Task cancelled successfully!' });
  });
});

// ====================== 7. 服务器启动 + 优雅退出（核心稳定保障） ======================
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 服务器已启动：http://0.0.0.0:${PORT}`);
  if (process.env.RAILWAY_STATIC_URL) {
    console.log(`🌐 公网访问地址：https://${process.env.RAILWAY_STATIC_URL}`);
  }
});

// 处理容器终止信号（SIGTERM）- 避免Railway报SIGTERM错误
process.on('SIGTERM', () => {
  console.log('\n📤 接收到容器终止信号（SIGTERM），开始优雅退出...');
  server.close(() => {
    console.log('✅ HTTP服务器已关闭');
    db.close((err) => {
      if (err) console.error('❌ 数据库关闭失败:', err.message);
      else console.log('✅ 数据库连接已关闭');
      process.exit(0);
    });
  });
});

// 处理本地退出信号（Ctrl+C）
process.on('SIGINT', () => {
  console.log('\n📤 接收到手动退出信号（SIGINT），开始优雅退出...');
  server.close(() => {
    db.close((err) => {
      if (err) console.error('❌ 数据库关闭失败:', err.message);
      else console.log('✅ 数据库连接已关闭');
      process.exit(0);
    });
  });
});

// 全局未捕获异常处理（防止服务崩溃）
process.on('uncaughtException', (err) => {
  console.error('❌ 未捕获异常:', err.message);
  db.close(() => process.exit(1));
});

process.on('unhandledRejection', (err) => {
  console.error('❌ 未处理的Promise拒绝:', err.message);
  db.close(() => process.exit(1));
});

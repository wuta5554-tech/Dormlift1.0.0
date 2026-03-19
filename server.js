// 核心依赖引入
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

// ========== 1. 环境配置（适配容器/本地） ==========
const app = express();
// 优先使用环境变量端口（Railway/容器），兜底8080（本地）
const PORT = process.env.PORT || 8080;
// 数据库路径：容器用/tmp（有写权限），本地用当前目录
const DB_DIR = process.env.NODE_ENV === 'production' ? '/tmp/campusmove' : './campusmove';
const DB_PATH = path.join(DB_DIR, 'campusmove.db');

// ========== 2. 中间件配置（安全+兼容） ==========
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
// 静态文件（前端页面）
app.use(express.static(__dirname));

// ========== 3. 邮箱配置（环境变量注入，避免硬编码） ==========
const emailTransporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ========== 4. 数据库初始化（健壮性处理） ==========
let db;
// 创建数据库目录（防止不存在）
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
// 连接数据库（错误兜底）
db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
    process.exit(1); // 数据库失败则退出服务
  } else {
    console.log(`✅ 数据库连接成功（路径：${DB_PATH}）`);
    initDatabaseTables(); // 初始化表
  }
});

// 初始化数据表（带错误处理）
function initDatabaseTables() {
  // 用户表（含邮箱+手机号，字段约束）
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

// ========== 5. 工具函数（复用+校验） ==========
// 新西兰手机号格式化（仅校验，不发送）
function normalizeNZPhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('02')) return `+64${digits.slice(1)}`;
  if (digits.startsWith('64')) return `+${digits}`;
  return phone;
}

// 新西兰手机号校验
function isValidNZPhone(phone) {
  if (!phone) return false;
  return /^\+642\d{7,9}$/.test(phone);
}

// ========== 6. 核心业务接口（带完整错误处理） ==========
// 健康检查（Railway/容器探针用）
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

// 发送邮箱验证码
app.post('/api/send-verification-code', async (req, res) => {
  try {
    const { email, phone } = req.body;
    // 入参校验
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!phone) return res.status(400).json({ success: false, message: 'Phone number is required' });
    
    // 手机号格式校验
    const normalizedPhone = normalizeNZPhone(phone);
    if (!isValidNZPhone(normalizedPhone)) {
      return res.status(400).json({ success: false, message: 'Invalid New Zealand mobile number' });
    }

    // 生成6位验证码
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    // 存储验证码（生产建议用Redis，此处内存存储仅适配小型项目）
    global.storedCode = {
      email,
      code: verifyCode,
      expireTime: Date.now() + 5 * 60 * 1000 // 5分钟过期
    };

    // 发送验证码邮件
    await emailTransporter.sendMail({
      from: `CampusMove <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'CampusMove Verification Code',
      text: `Your verification code: ${verifyCode} (valid for 5 minutes)`,
      html: `<h3>CampusMove Verification Code</h3>
             <p>Code: <strong>${verifyCode}</strong></p>
             <p>Valid for 5 minutes</p>`
    });

    res.json({ success: true, message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('❌ 发送验证码失败:', error.message);
    res.status(500).json({ success: false, message: `Failed to send code: ${error.message}` });
  }
});

// 用户注册
app.post('/api/register', (req, res) => {
  const { givenName, firstName, studentId, gender, phone, email, verifyCode, anonymousName, password } = req.body;
  // 入参全量校验
  if (!givenName || !firstName || !studentId || !gender || !phone || !email || !verifyCode || !anonymousName || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  // 手机号校验
  const normalizedPhone = normalizeNZPhone(phone);
  if (!isValidNZPhone(normalizedPhone)) {
    return res.status(400).json({ success: false, message: 'Invalid New Zealand mobile number' });
  }

  // 验证码校验
  const storedCode = global.storedCode;
  if (!storedCode || storedCode.email !== email || storedCode.code !== verifyCode || Date.now() > storedCode.expireTime) {
    return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
  }

  // 查重+注册（串行执行，避免并发问题）
  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    if (row) return res.status(409).json({ success: false, message: 'Student ID already registered' });

    db.get('SELECT * FROM users WHERE phone = ?', [normalizedPhone], (err, row) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      if (row) return res.status(409).json({ success: false, message: 'Phone number already registered' });

      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        if (row) return res.status(409).json({ success: false, message: 'Email already registered' });

        // 插入用户
        db.run(`INSERT INTO users (
          student_id, given_name, first_name, gender, anonymous_name, phone, email, password
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [studentId, givenName, firstName, gender, anonymousName, normalizedPhone, email, password],
        (err) => {
          if (err) return res.status(500).json({ success: false, message: 'Registration failed: ' + err.message });
          global.storedCode = null; // 清空验证码
          res.json({ success: true, message: 'Registration successful! Please login' });
        });
      });
    });
  });
});

// 用户登录
app.post('/api/login', (req, res) => {
  const { studentId, password } = req.body;
  if (!studentId || !password) {
    return res.status(400).json({ success: false, message: 'Student ID and password are required' });
  }

  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.status(404).json({ success: false, message: 'Student ID not found' });
    if (row.password !== password) return res.status(401).json({ success: false, message: 'Incorrect password' });

    res.json({
      success: true,
      message: 'Login successful',
      anonymousName: row.anonymous_name
    });
  });
});

// 发布搬家请求
app.post('/api/post-request', (req, res) => {
  const { studentId, moveDate, location, helpersNeeded, items, compensation } = req.body;
  if (!studentId || !moveDate || !location || !helpersNeeded || !items || !compensation) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  db.run(`INSERT INTO moving_requests (
    student_id, move_date, location, helpers_needed, items, compensation
  ) VALUES (?, ?, ?, ?, ?, ?)`,
  [studentId, moveDate, location, helpersNeeded, items, compensation],
  (err) => {
    if (err) return res.status(500).json({ success: false, message: 'Post failed: ' + err.message });
    res.json({ success: true, message: 'Moving request posted successfully' });
  });
});

// 获取所有可用任务
app.get('/api/get-tasks', (req, res) => {
  db.all('SELECT * FROM moving_requests WHERE helper_assigned IS NULL', (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

// 接受任务
app.post('/api/accept-task', (req, res) => {
  const { taskId, helperId } = req.body;
  if (!taskId || !helperId) {
    return res.status(400).json({ success: false, message: 'Task ID and Helper ID are required' });
  }

  db.run('UPDATE moving_requests SET helper_assigned = ? WHERE id = ? AND helper_assigned IS NULL',
  [helperId, taskId],
  function (err) {
    if (err) return res.status(500).json({ success: false, message: 'Accept failed: ' + err.message });
    if (this.changes === 0) return res.status(409).json({ success: false, message: 'Task already assigned' });
    res.json({ success: true, message: 'Task accepted successfully' });
  });
});

// 其他核心接口（我的发布/接受任务、个人信息、删除/取消任务）
app.post('/api/my-posted-tasks', (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ success: false, message: 'Student ID is required' });
  
  db.all('SELECT * FROM moving_requests WHERE student_id = ?', [studentId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

app.post('/api/my-accepted-tasks', (req, res) => {
  const { helperId } = req.body;
  if (!helperId) return res.status(400).json({ success: false, message: 'Helper ID is required' });
  
  db.all('SELECT * FROM moving_requests WHERE helper_assigned = ?', [helperId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

app.post('/api/get-profile', (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ success: false, message: 'Student ID is required' });
  
  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.status(404).json({ success: false, message: 'User not found' });
    
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

app.post('/api/delete-task', (req, res) => {
  const { taskId, studentId } = req.body;
  if (!taskId || !studentId) return res.status(400).json({ success: false, message: 'Task ID and Student ID are required' });
  
  db.run('DELETE FROM moving_requests WHERE id = ? AND student_id = ?', [taskId, studentId], function (err) {
    if (err) return res.status(500).json({ success: false, message: 'Delete failed: ' + err.message });
    if (this.changes === 0) return res.status(404).json({ success: false, message: 'Task not found or not yours' });
    res.json({ success: true, message: 'Task deleted successfully' });
  });
});

app.post('/api/cancel-task', (req, res) => {
  const { taskId, helperId } = req.body;
  if (!taskId || !helperId) return res.status(400).json({ success: false, message: 'Task ID and Helper ID are required' });
  
  db.run('UPDATE moving_requests SET helper_assigned = NULL WHERE id = ? AND helper_assigned = ?', [taskId, helperId], function (err) {
    if (err) return res.status(500).json({ success: false, message: 'Cancel failed: ' + err.message });
    if (this.changes === 0) return res.status(404).json({ success: false, message: 'Task not found or not accepted by you' });
    res.json({ success: true, message: 'Task cancelled successfully' });
  });
});

// ========== 7. 服务器启动 + 优雅退出（核心稳定保障） ==========
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 服务器已启动：http://0.0.0.0:${PORT}`);
  if (process.env.RAILWAY_STATIC_URL) {
    console.log(`🌐 公网访问地址：https://${process.env.RAILWAY_STATIC_URL}`);
  }
});

// 处理容器终止信号（SIGTERM）
process.on('SIGTERM', () => {
  console.log('\n📤 接收到容器终止信号（SIGTERM），开始优雅退出...');
  server.close(() => {
    console.log('✅ HTTP服务器已关闭');
    db.close((err) => {
      if (err) console.error('❌ 数据库关闭失败:', err.message);
      else console.log('✅ 数据库连接已关闭');
      process.exit(0); // 正常退出
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

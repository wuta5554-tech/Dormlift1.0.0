const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
// 新增：引入邮箱发送库
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 1. 邮箱配置（核心新增）=====
// 从环境变量读取邮箱配置（避免硬编码）
const EMAIL_USER = process.env.EMAIL_USER; // 你的邮箱账号（如xxx@gmail.com）
const EMAIL_PASS = process.env.EMAIL_PASS; // 邮箱授权码（不是登录密码）
const EMAIL_SERVICE = process.env.EMAIL_SERVICE || 'gmail'; // 邮箱服务商（gmail/qq/163）

// 初始化邮箱发送器
const transporter = nodemailer.createTransport({
  service: EMAIL_SERVICE,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

// ===== 2. 保留新西兰手机号格式校验（仅校验，不发送）=====
function normalizeNZPhone(phone) {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('02')) {
    return '+64' + digits.slice(1);
  }
  if (digits.startsWith('64')) {
    return '+' + digits;
  }
  return phone;
}

function isValidNZPhone(normalizedPhone) {
  if (!normalizedPhone) return false;
  const pattern = /^\+642\d{7,9}$/;
  return pattern.test(normalizedPhone);
}

// ===== 3. 全局变量（验证码关联邮箱）=====
let storedCode = null; // 结构改为：{ email, code, expireTime }
let db = null;

// ===== 原有中间件/数据库配置不变 =====
app.use(cors({ origin: '*', credentials: true }));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(__dirname));

// 健康检查接口
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', port: PORT });
});

// 根路由返回前端页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== 4. 数据库连接/表初始化（不变）=====
const DB_DIR = '/tmp/dormlift';
const DB_PATH = path.join(DB_DIR, 'dormlift.db');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
    process.exit(1);
  } else {
    console.log(`✅ 数据库连接成功（路径：${DB_PATH}）`);
    initTables();
  }
});

function initTables() {
  // 用户表：保留phone字段，新增email字段（唯一）
  const userTableSql = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL,
      given_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      gender TEXT NOT NULL,
      anonymous_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL, // 新增邮箱字段
      password TEXT NOT NULL
    )
  `;

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

  db.run(userTableSql, (err) => {
    if (err) console.error('❌ 用户表初始化失败:', err.message);
    else console.log('✅ 用户表初始化完成');
  });

  db.run(requestTableSql, (err) => {
    if (err) console.error('❌ 搬家请求表初始化失败:', err.message);
    else console.log('✅ 搬家请求表初始化完成');
  });
}

// ===== 5. 核心修改：发送邮箱验证码接口 =====
app.post('/api/send-verification-code', async (req, res) => {
  try {
    const { email, phone } = req.body; // 接收邮箱+手机号

    // 1. 校验邮箱和手机号
    if (!email) {
      return res.json({ success: false, message: 'Email is required' });
    }
    if (!phone) {
      return res.json({ success: false, message: 'Phone number is required' });
    }

    // 2. 校验新西兰手机号格式（仅格式，不发送）
    const normalizedPhone = normalizeNZPhone(phone);
    if (!isValidNZPhone(normalizedPhone)) {
      return res.json({ success: false, message: 'Invalid New Zealand mobile number' });
    }

    // 3. 生成6位验证码
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    // 4. 存储验证码（关联邮箱，5分钟过期）
    storedCode = {
      email: email,
      code: verifyCode,
      expireTime: Date.now() + 5 * 60 * 1000
    };

    // 5. 发送邮箱验证码（核心）
    await transporter.sendMail({
      from: `CampusMove <${EMAIL_USER}>`, // 发件人
      to: email, // 收件人邮箱
      subject: 'CampusMove Verification Code', // 邮件标题
      text: `Your CampusMove verification code is: ${verifyCode} (valid for 5 minutes)`, // 纯文本内容
      html: `<h3>Your CampusMove Verification Code</h3>
             <p>Code: <strong>${verifyCode}</strong></p>
             <p>Valid for 5 minutes</p>` // HTML内容
    });

    // 6. 返回成功（不泄露验证码）
    res.json({
      success: true,
      message: 'Verification code sent to your email (check inbox/spam folder)'
    });

  } catch (error) {
    console.error('❌ 邮箱发送失败:', error.message);
    res.json({
      success: false,
      message: `Failed to send code: ${error.message}. Check your email configuration.`
    });
  }
});

// ===== 6. 修改注册接口：验证邮箱验证码 + 保留手机号 =====
app.post('/api/register', async (req, res) => {
  const { 
    givenName, firstName, studentId, gender, 
    phone, email, verifyCode, anonymousName, password 
  } = req.body;

  // 1. 校验所有字段
  if (!givenName || !firstName || !studentId || !gender || !phone || !email || !verifyCode || !anonymousName || !password) {
    return res.json({ success: false, message: 'All fields are required' });
  }

  // 2. 校验手机号格式
  const normalizedPhone = normalizeNZPhone(phone);
  if (!isValidNZPhone(normalizedPhone)) {
    return res.json({ success: false, message: 'Invalid New Zealand mobile number' });
  }

  // 3. 校验邮箱验证码
  if (!storedCode || storedCode.email !== email || storedCode.code !== verifyCode || Date.now() > storedCode.expireTime) {
    return res.json({ success: false, message: 'Invalid or expired verification code' });
  }

  // 4. 检查学号/手机号/邮箱是否已注册
  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (row) return res.json({ success: false, message: 'Student ID already registered' });

    db.get('SELECT * FROM users WHERE phone = ?', [normalizedPhone], (err, row) => {
      if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
      if (row) return res.json({ success: false, message: 'Phone number already registered' });

      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
        if (row) return res.json({ success: false, message: 'Email already registered' });

        // 5. 插入新用户（包含邮箱和手机号）
        db.run(`INSERT INTO users (
          student_id, given_name, first_name, gender, 
          anonymous_name, phone, email, password
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
        [studentId, givenName, firstName, gender, anonymousName, normalizedPhone, email, password], 
        (err) => {
          if (err) return res.json({ success: false, message: 'Registration failed: ' + err.message });
          storedCode = null; // 清空验证码
          res.json({ success: true, message: 'Registration successful! Please login' });
        });
      });
    });
  });
});

// ===== 7. 其他接口（登录/任务/个人信息）：保留手机号展示 =====
app.post('/api/login', (req, res) => {
  const { studentId, password } = req.body;
  if (!studentId || !password) return res.json({ success: false, message: 'Student ID and password are required' });

  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.json({ success: false, message: 'Student ID not found' });
    if (row.password !== password) return res.json({ success: false, message: 'Incorrect password' });

    res.json({ 
      success: true, 
      message: 'Login successful',
      anonymousName: row.anonymous_name 
    });
  });
});

// 个人信息接口：返回手机号和邮箱
app.post('/api/get-profile', (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.json({ success: false, message: 'Student ID is required' });

  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.json({ success: false, message: 'User not found' });

    res.json({ 
      success: true, 
      user: {
        given_name: row.given_name,
        first_name: row.first_name,
        student_id: row.student_id,
        gender: row.gender,
        anonymous_name: row.anonymous_name,
        phone: row.phone, // 展示手机号
        email: row.email  // 展示邮箱
      }
    });
  });
});

// 其他业务接口（post-request/get-tasks等）保持不变...

// ===== 8. 启动服务器 =====
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 服务器已启动：http://0.0.0.0:${PORT}`);
  console.log(`🌐 访问地址：https://${process.env.RAILWAY_STATIC_URL || 'localhost:' + PORT}`);
});

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 125 * 1000;

// PM2 优雅退出
process.on('SIGINT', () => {
  console.log('📤 接收到退出信号，关闭数据库连接');
  db.close((err) => {
    if (err) console.error('❌ 数据库关闭失败:', err.message);
    else console.log('✅ 数据库已关闭');
    server.close(() => {
      console.log('✅ 服务器已关闭');
      process.exit(0);
    });
  });
});

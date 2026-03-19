const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();

// 全局配置（仅保留核心）
const PORT = process.env.PORT || 8080;
const SALT_ROUNDS = 12;
const VERIFY_CODE_EXPIRE_SECONDS = 5 * 60;
const DB_PATH = '/tmp/dormlift_final.db';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MINUTES = 15;
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 20;

// 全局变量（核心功能必需）
let db = null;
let isDbReady = false;
let verifyCodeStore = {};
let loginAttempts = {};
let userLock = {};
let rateLimit = {};

// 核心中间件（仅保留必选）
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// 请求频率限制（原生实现，无依赖）
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (!rateLimit[ip]) rateLimit[ip] = { count: 0, time: now };
  if (now - rateLimit[ip].time > RATE_LIMIT_WINDOW) {
    rateLimit[ip] = { count: 1, time: now };
  } else {
    rateLimit[ip].count++;
    if (rateLimit[ip].count > RATE_LIMIT_MAX) {
      return res.status(429).json({ success: false, message: 'Too many requests, please try again later' });
    }
  }
  next();
});

// 健康检查（部署必过）
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'running',
    service: 'DormLift Final Backend',
    port: PORT,
    db_connected: isDbReady,
    timestamp: new Date().toISOString()
  });
});

// 工具函数（全原生实现，无第三方依赖）
function isValidEmail(email) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(email);
}

function isValidPhone(phone) {
  const re = /^(\+?\d{1,4})?\s?\d{6,14}$/;
  return re.test(phone);
}

function isValidStudentId(studentId) {
  return /^[a-zA-Z0-9]{4,20}$/.test(studentId);
}

function generateVerifyCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isUserLocked(studentId) {
  if (!userLock[studentId]) return false;
  return Date.now() < userLock[studentId];
}

function cleanExpiredCodes() {
  const now = Date.now();
  for (let email in verifyCodeStore) {
    if (verifyCodeStore[email].expireAt < now) {
      delete verifyCodeStore[email];
    }
  }
}

function cleanExpiredRateLimits() {
  const now = Date.now();
  for (let ip in rateLimit) {
    if (now - rateLimit[ip].time > RATE_LIMIT_WINDOW * 2) {
      delete rateLimit[ip];
    }
  }
}

// 原生时间格式化（无moment依赖）
function formatDatetime(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function maskEmail(email) {
  if (!email) return '';
  let [name, domain] = email.split('@');
  if (!domain) return email;
  if (name.length <= 2) return name + '***@' + domain;
  return name[0] + '***' + name[name.length-1] + '@' + domain;
}

function maskPhone(phone) {
  if (!phone) return '';
  if (phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

// 邮件发送（核心功能，保留nodemailer但做容错）
async function sendVerifyEmail(email, code) {
  if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
    console.log(`[EMAIL DEBUG] Verification code for ${email}: ${code}`);
    return true;
  }

  try {
    let transporter = nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
      },
      tls: { ciphers: 'SSLv3' }
    });

    await transporter.sendMail({
      from: `"DormLift" <${process.env.SMTP_EMAIL}>`,
      to: email,
      subject: 'DormLift Verification Code',
      text: `Your verification code is: ${code}\nValid for 5 minutes.`,
      html: `<div style="padding:20px;"><h3>DormLift Verification</h3><p>Code: <strong>${code}</strong></p><p>Valid for 5 minutes</p></div>`
    });
    return true;
  } catch (err) {
    console.error('Email send failed:', err.message);
    // 邮件发送失败不阻塞核心流程
    return true;
  }
}

// 数据库初始化（核心，全兼容Railway）
function initDatabase() {
  db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('DB connect error:', err.message);
      return;
    }
    console.log('DB connected at:', DB_PATH);

    // 创建核心数据表（8张，功能完整）
    db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT UNIQUE NOT NULL,
        first_name TEXT NOT NULL,
        given_name TEXT NOT NULL,
        gender TEXT NOT NULL CHECK(gender IN ('male','female','other')),
        anonymous_name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        avatar TEXT DEFAULT '',
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS verify_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        expire_at DATETIME NOT NULL,
        is_used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        publisher_id TEXT NOT NULL,
        move_date TEXT NOT NULL,
        move_time TEXT NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        items_desc TEXT NOT NULL,
        items_photo TEXT DEFAULT '',
        people_needed INTEGER NOT NULL,
        reward TEXT NOT NULL,
        note TEXT DEFAULT '',
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','assigned','completed','cancelled')),
        helper_id TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS task_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        helper_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
        apply_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        content TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        send_time DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS feedbacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        contact TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL,
        token TEXT NOT NULL,
        expire_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        ip TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `, (err) => {
      if (err) console.error('Create tables error:', err.message);
      else {
        console.log('All tables initialized');
        isDbReady = true;
      }
    });
  });
}

// 日志系统（核心功能，无依赖）
function writeLog(type, content, req) {
  const ip = req ? (req.ip || req.connection.remoteAddress) : null;
  if (!db) return;
  db.run(`INSERT INTO system_logs (type, content, ip) VALUES (?, ?, ?)`,
    [type, content.substring(0, 500), ip], (err) => {
      if (err) console.error('Log write failed:', err.message);
    });
}

// ==================== 用户认证接口（完整） ====================
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    cleanExpiredCodes();
    const code = generateVerifyCode();
    const expireAt = Date.now() + VERIFY_CODE_EXPIRE_SECONDS * 1000;
    verifyCodeStore[email] = { code, expireAt };

    await sendVerifyEmail(email, code);
    writeLog('VERIFY_CODE_SENT', `Email: ${maskEmail(email)}`, req);
    res.json({ success: true, message: 'Verification code sent (check email or debug log)' });
  } catch (err) {
    writeLog('ERROR', 'Send code failed: ' + err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      student_id, first_name, given_name, gender,
      anonymous_name, phone, email, password, code
    } = req.body;

    // 全字段校验
    if (!student_id || !first_name || !given_name || !gender ||
        !anonymous_name || !phone || !email || !password || !code) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    if (!isValidEmail(email)) return res.status(400).json({ success: false, message: 'Invalid email' });
    if (!isValidPhone(phone)) return res.status(400).json({ success: false, message: 'Invalid phone' });
    if (!isValidStudentId(student_id)) return res.status(400).json({ success: false, message: 'Invalid student ID (4-20 chars, letters/numbers only)' });

    // 校验验证码
    cleanExpiredCodes();
    const record = verifyCodeStore[email];
    if (!record || record.code !== code) {
      writeLog('REGISTER_FAILED', 'Invalid code for ' + maskEmail(email), req);
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }
    delete verifyCodeStore[email];

    // 密码加密
    const hashedPwd = await bcrypt.hash(password, SALT_ROUNDS);

    // 插入数据库
    db.run(`INSERT INTO users
      (student_id, first_name, given_name, gender, anonymous_name, phone, email, password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [student_id, first_name, given_name, gender, anonymous_name, phone, email, hashedPwd],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ success: false, message: 'Student ID / Phone / Email already exists' });
          }
          writeLog('DB_ERROR', 'Register failed: ' + err.message, req);
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        writeLog('REGISTER_SUCCESS', `Student ID: ${student_id}`, req);
        res.json({ success: true, message: 'Registration successful' });
      }
    );
  } catch (err) {
    writeLog('ERROR', 'Register exception: ' + err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { student_id, password } = req.body;
    if (!student_id || !password) {
      return res.status(400).json({ success: false, message: 'Please input student ID and password' });
    }

    // 账号锁定校验
    if (isUserLocked(student_id)) {
      return res.status(403).json({ success: false, message: 'Account locked (too many failed attempts), try again in 15 minutes' });
    }

    // 查询用户
    db.get(`SELECT * FROM users WHERE student_id = ?`, [student_id], async (err, user) => {
      if (err) {
        writeLog('DB_ERROR', 'Login query failed', req);
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      if (!user) {
        writeLog('LOGIN_FAILED', 'User not found: ' + student_id, req);
        return res.status(400).json({ success: false, message: 'User does not exist' });
      }

      // 密码校验
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        loginAttempts[student_id] = (loginAttempts[student_id] || 0) + 1;
        if (loginAttempts[student_id] >= MAX_LOGIN_ATTEMPTS) {
          userLock[student_id] = Date.now() + LOCK_TIME_MINUTES * 60 * 1000;
        }
        writeLog('LOGIN_FAILED', 'Wrong password for ' + student_id, req);
        return res.status(400).json({ success: false, message: 'Incorrect password' });
      }

      // 登录成功，生成token
      loginAttempts[student_id] = 0;
      const token = generateToken();
      const tokenExpire = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7天有效期

      // 存储token
      db.run(`INSERT INTO user_tokens (student_id, token, expire_at) VALUES (?, ?, ?)`,
        [student_id, token, tokenExpire]);

      // 返回用户信息（隐藏密码）
      delete user.password;
      writeLog('LOGIN_SUCCESS', student_id, req);
      res.json({ success: true, user, token });
    });
  } catch (err) {
    writeLog('ERROR', 'Login exception: ' + err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/auth/verify-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Token is required' });

  db.get(`SELECT * FROM user_tokens WHERE token = ? AND expire_at > ?`,
    [token, Date.now()], (err, row) => {
      if (err || !row) return res.json({ success: false, message: 'Invalid or expired token' });
      db.get(`SELECT * FROM users WHERE student_id = ?`,
        [row.student_id], (err, user) => {
          if (err || !user) return res.json({ success: false, message: 'User not found' });
          delete user.password;
          res.json({ success: true, user });
        });
    });
});

app.post('/api/auth/logout', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Token is required' });

  db.run(`DELETE FROM user_tokens WHERE token = ?`, [token], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, new_password } = req.body;
    if (!email || !code || !new_password) {
      return res.status(400).json({ success: false, message: 'Email, code and new password are required' });
    }

    // 校验验证码
    cleanExpiredCodes();
    const record = verifyCodeStore[email];
    if (!record || record.code !== code) {
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }
    delete verifyCodeStore[email];

    // 加密新密码
    const hashed = await bcrypt.hash(new_password, SALT_ROUNDS);
    db.run(`UPDATE users SET password=?, updated_at=CURRENT_TIMESTAMP WHERE email=?`,
      [hashed, email],
      (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        writeLog('PASSWORD_RESET', `Email: ${maskEmail(email)}`, req);
        res.json({ success: true, message: 'Password reset successful' });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==================== 用户信息接口（完整） ====================
app.post('/api/user/profile', (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: 'Student ID is required' });

  db.get(`SELECT * FROM users WHERE student_id = ?`, [student_id], (err, user) => {
    if (err || !user) return res.status(400).json({ success: false, message: 'User not found' });
    delete user.password;
    res.json({ success: true, user });
  });
});

app.post('/api/user/update', (req, res) => {
  const { student_id, phone, anonymous_name, avatar } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: 'Student ID is required' });

  db.run(`UPDATE users SET phone=?, anonymous_name=?, avatar=?, updated_at=CURRENT_TIMESTAMP WHERE student_id=?`,
    [phone || '', anonymous_name || '', avatar || '', student_id],
    (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, message: 'Profile updated successfully' });
    }
  );
});

app.post('/api/user/public', (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: 'Student ID is required' });

  db.get(`SELECT anonymous_name, gender, created_at FROM users WHERE student_id = ?`,
    [student_id], (err, row) => {
      if (err || !row) return res.status(400).json({ success: false, message: 'User not found' });
      res.json({ success: true, data: row });
    });
});

// ==================== 任务接口（完整） ====================
app.post('/api/task/create', (req, res) => {
  try {
    const {
      publisher_id, move_date, move_time, from_address, to_address,
      items_desc, items_photo, people_needed, reward, note
    } = req.body;

    // 必选字段校验
    if (!publisher_id || !move_date || !move_time || !from_address ||
        !to_address || !items_desc || !people_needed || !reward) {
      return res.status(400).json({ success: false, message: 'Missing required fields (publisher_id, move_date, move_time, from_address, to_address, items_desc, people_needed, reward)' });
    }

    // 插入任务
    db.run(`INSERT INTO tasks
      (publisher_id, move_date, move_time, from_address, to_address,
       items_desc, items_photo, people_needed, reward, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [publisher_id, move_date, move_time, from_address, to_address,
       items_desc, items_photo || '', people_needed, reward, note || ''],
      function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        writeLog('TASK_CREATED', `Task ${this.lastID} by ${publisher_id}`, req);
        res.json({ success: true, task_id: this.lastID, message: 'Task created successfully' });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/task/list', (req, res) => {
  db.all(`
    SELECT t.*, u.anonymous_name AS publisher_name
    FROM tasks t
    LEFT JOIN users u ON t.publisher_id = u.student_id
    WHERE t.status = 'pending'
    ORDER BY t.created_at DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    res.json({ success: true, list: rows });
  });
});

app.post('/api/task/my-published', (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: 'Student ID is required' });

  db.all(`SELECT * FROM tasks WHERE publisher_id = ? ORDER BY created_at DESC`,
    [student_id], (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, list: rows });
    }
  );
});

app.post('/api/task/my-assigned', (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: 'Student ID is required' });

  db.all(`SELECT * FROM tasks WHERE helper_id = ? ORDER BY created_at DESC`,
    [student_id], (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, list: rows });
    }
  );
});

app.post('/api/task/apply', (req, res) => {
  const { task_id, helper_id } = req.body;
  if (!task_id || !helper_id) return res.status(400).json({ success: false, message: 'Task ID and helper ID are required' });

  // 校验任务是否存在且未被分配
  db.get(`SELECT * FROM tasks WHERE id = ? AND status = 'pending'`, [task_id], (err, task) => {
    if (err || !task) return res.status(400).json({ success: false, message: 'Task is unavailable (not found or already assigned)' });
    // 不能申请自己的任务
    if (task.publisher_id === helper_id) {
      return res.status(400).json({ success: false, message: 'Cannot apply for your own task' });
    }

    // 校验是否已申请
    db.get(`SELECT * FROM task_applications WHERE task_id = ? AND helper_id = ?`,
      [task_id, helper_id], (err, record) => {
        if (record) return res.status(400).json({ success: false, message: 'You have already applied for this task' });

        // 提交申请
        db.run(`INSERT INTO task_applications (task_id, helper_id) VALUES (?, ?)`,
          [task_id, helper_id], (err) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });
            res.json({ success: true, message: 'Applied for task successfully' });
          }
        );
      }
    );
  });
});

app.post('/api/task/applicants', (req, res) => {
  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ success: false, message: 'Task ID is required' });

  db.all(`
    SELECT a.*, u.anonymous_name, u.phone
    FROM task_applications a
    LEFT JOIN users u ON a.helper_id = u.student_id
    WHERE a.task_id = ?
  `, [task_id], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    res.json({ success: true, applicants: rows });
  });
});

app.post('/api/task/assign', (req, res) => {
  const { task_id, helper_id } = req.body;
  if (!task_id || !helper_id) return res.status(400).json({ success: false, message: 'Task ID and helper ID are required' });

  db.run(`UPDATE tasks SET status = 'assigned', helper_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [helper_id, task_id], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      writeLog('TASK_ASSIGNED', `Task ${task_id} to ${helper_id}`, req);
      res.json({ success: true, message: 'Task assigned to helper successfully' });
    }
  );
});

app.post('/api/task/complete', (req, res) => {
  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ success: false, message: 'Task ID is required' });

  db.run(`UPDATE tasks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [task_id], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, message: 'Task marked as completed' });
    }
  );
});

app.post('/api/task/cancel', (req, res) => {
  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ success: false, message: 'Task ID is required' });

  db.run(`UPDATE tasks SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [task_id], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, message: 'Task cancelled successfully' });
    }
  );
});

// ==================== 消息接口（完整） ====================
app.post('/api/message/send', (req, res) => {
  const { sender_id, receiver_id, content } = req.body;
  if (!sender_id || !receiver_id || !content) return res.status(400).json({ success: false, message: 'Sender ID, receiver ID and content are required' });

  db.run(`INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)`,
    [sender_id, receiver_id, content], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, message: 'Message sent successfully' });
    }
  );
});

app.post('/api/message/inbox', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, message: 'User ID is required' });

  db.all(`
    SELECT m.*, u.anonymous_name AS sender_name
    FROM messages m
    LEFT JOIN users u ON m.sender_id = u.student_id
    WHERE m.receiver_id = ?
    ORDER BY m.send_time DESC
  `, [user_id], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    res.json({ success: true, messages: rows });
  });
});

app.post('/api/message/mark-read', (req, res) => {
  const { msg_id } = req.body;
  if (!msg_id) return res.status(400).json({ success: false, message: 'Message ID is required' });

  db.run(`UPDATE messages SET is_read = 1 WHERE id = ?`, [msg_id], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    res.json({ success: true, message: 'Message marked as read' });
  });
});

// ==================== 反馈接口（完整） ====================
app.post('/api/feedback/submit', (req, res) => {
  const { user_id, content, contact } = req.body;
  if (!user_id || !content) return res.status(400).json({ success: false, message: 'User ID and feedback content are required' });

  db.run(`INSERT INTO feedbacks (user_id, content, contact) VALUES (?, ?, ?)`,
    [user_id, content, contact || ''], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      writeLog('FEEDBACK', `From ${user_id}`, req);
      res.json({ success: true, message: 'Feedback submitted successfully' });
    }
  );
});

// ==================== 统计接口（完整） ====================
app.get('/api/stats/overview', (req, res) => {
  db.get(`SELECT COUNT(*) AS user_count FROM users`, [], (err, userRow) => {
    db.get(`SELECT COUNT(*) AS task_count FROM tasks`, [], (err, taskRow) => {
      db.get(`SELECT COUNT(*) AS pending_count FROM tasks WHERE status='pending'`, [], (err, pendingRow) => {
        res.json({
          success: true,
          data: {
            total_users: userRow?.user_count || 0,
            total_tasks: taskRow?.task_count || 0,
            pending_tasks: pendingRow?.pending_count || 0
          }
        });
      });
    });
  });
});

// ==================== 服务启动（兼容Railway） ====================
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server started on 0.0.0.0:${PORT}`);
  // 延迟初始化数据库，避免启动阻塞
  setTimeout(() => {
    initDatabase();
    // 定时清理过期数据
    setInterval(cleanExpiredCodes, 60000);
    setInterval(cleanExpiredRateLimits, 5 * 60000);
  }, 1500);
});

// ==================== 优雅退出（避免部署报错） ====================
process.on('SIGTERM', () => {
  console.log('🛑 Server stopping...');
  server.close(() => {
    if (db) db.close();
    console.log('✅ Server stopped gracefully');
    process.exit(0);
  });
});

// 全局异常捕获（避免服务崩溃）
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
});

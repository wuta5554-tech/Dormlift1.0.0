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

// 全局配置
const PORT = process.env.PORT || 8080;
const SALT_ROUNDS = 12;
const VERIFY_CODE_EXPIRE_SECONDS = 5 * 60;
const DB_PATH = '/tmp/dormlift_final.db';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MINUTES = 15;
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 20;

// 全局变量
let db = null;
let isDbReady = false;
let verifyCodeStore = {};
let loginAttempts = {};
let userLock = {};
let rateLimit = {};

// 中间件
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// 频率限制
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (!rateLimit[ip]) rateLimit[ip] = { count: 0, time: now };
  if (now - rateLimit[ip].time > RATE_LIMIT_WINDOW) {
    rateLimit[ip] = { count: 1, time: now };
  } else {
    rateLimit[ip].count++;
    if (rateLimit[ip].count > RATE_LIMIT_MAX) {
      return res.status(429).json({ success: false, message: 'Too many requests' });
    }
  }
  next();
});

// 健康检查
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'running',
    service: 'DormLift Final Backend',
    port: PORT,
    db_connected: isDbReady,
    timestamp: new Date().toISOString()
  });
});

// 工具函数
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

// 邮件发送
async function sendVerifyEmail(email, code) {
  if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
    console.log(`[EMAIL DEBUG] Code for ${email}: ${code}`);
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
      text: `Your code: ${code}\nValid for 5 minutes.`,
      html: `<div style="padding:20px;"><h3>Verification Code</h3><p>Code: <strong>${code}</strong></p></div>`
    });
    return true;
  } catch (err) {
    console.error('Email error:', err.message);
    return true;
  }
}

// 数据库初始化
function initDatabase() {
  db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('DB error:', err.message);
      return;
    }
    console.log('DB connected:', DB_PATH);

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
      if (err) console.error('Table error:', err.message);
      else isDbReady = true;
    });
  });
}

// 日志
function writeLog(type, content, req) {
  if (!db) return;
  const ip = req ? (req.ip || req.connection.remoteAddress) : null;
  db.run(`INSERT INTO system_logs (type, content, ip) VALUES (?, ?, ?)`,
    [type, content.substring(0, 500), ip], (err) => {
      if (err) console.error('Log error:', err.message);
    });
}

// ==================== 认证接口 ====================
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }

    cleanExpiredCodes();
    const code = generateVerifyCode();
    verifyCodeStore[email] = { code, expireAt: Date.now() + VERIFY_CODE_EXPIRE_SECONDS * 1000 };

    await sendVerifyEmail(email, code);
    writeLog('CODE_SENT', maskEmail(email), req);
    res.json({ success: true, message: 'Code sent (check debug log if no email)' });
  } catch (err) {
    writeLog('ERROR', err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { student_id, first_name, given_name, gender, anonymous_name, phone, email, password, code } = req.body;

    if (!student_id || !first_name || !given_name || !gender || !anonymous_name || !phone || !email || !password || !code) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }

    if (!isValidEmail(email)) return res.status(400).json({ success: false, message: 'Invalid email' });
    if (!isValidPhone(phone)) return res.status(400).json({ success: false, message: 'Invalid phone' });
    if (!isValidStudentId(student_id)) return res.status(400).json({ success: false, message: 'Invalid student ID' });

    cleanExpiredCodes();
    const record = verifyCodeStore[email];
    if (!record || record.code !== code) {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }
    delete verifyCodeStore[email];

    const hashedPwd = await bcrypt.hash(password, SALT_ROUNDS);
    db.run(`INSERT INTO users (student_id, first_name, given_name, gender, anonymous_name, phone, email, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [student_id, first_name, given_name, gender, anonymous_name, phone, email, hashedPwd],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(400).json({ success: false, message: 'Student ID/Phone/Email exists' });
          return res.status(500).json({ success: false, message: 'DB error' });
        }
        writeLog('REGISTER', student_id, req);
        res.json({ success: true, message: 'Register success' });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { student_id, password } = req.body;
    if (!student_id || !password) {
      return res.status(400).json({ success: false, message: 'Student ID and password required' });
    }

    if (isUserLocked(student_id)) {
      return res.status(403).json({ success: false, message: 'Account locked for 15 mins' });
    }

    db.get(`SELECT * FROM users WHERE student_id = ?`, [student_id], async (err, user) => {
      if (err || !user) return res.status(400).json({ success: false, message: 'User not found' });

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        loginAttempts[student_id] = (loginAttempts[student_id] || 0) + 1;
        if (loginAttempts[student_id] >= MAX_LOGIN_ATTEMPTS) {
          userLock[student_id] = Date.now() + LOCK_TIME_MINUTES * 60 * 1000;
        }
        return res.status(400).json({ success: false, message: 'Wrong password' });
      }

      loginAttempts[student_id] = 0;
      const token = generateToken();
      const tokenExpire = Date.now() + 7 * 24 * 60 * 60 * 1000;
      db.run(`INSERT INTO user_tokens (student_id, token, expire_at) VALUES (?, ?, ?)`, [student_id, token, tokenExpire]);

      delete user.password;
      res.json({ success: true, user, token });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/auth/verify-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Token required' });

  db.get(`SELECT * FROM user_tokens WHERE token = ? AND expire_at > ?`, [token, Date.now()], (err, row) => {
    if (err || !row) return res.json({ success: false, message: 'Invalid token' });
    db.get(`SELECT * FROM users WHERE student_id = ?`, [row.student_id], (err, user) => {
      if (err || !user) return res.json({ success: false, message: 'User not found' });
      delete user.password;
      res.json({ success: true, user });
    });
  });
});

app.post('/api/auth/logout', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Token required' });

  db.run(`DELETE FROM user_tokens WHERE token = ?`, [token], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, message: 'Logout success' });
  });
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, new_password } = req.body;
    if (!email || !code || !new_password) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }

    cleanExpiredCodes();
    const record = verifyCodeStore[email];
    if (!record || record.code !== code) {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }
    delete verifyCodeStore[email];

    const hashed = await bcrypt.hash(new_password, SALT_ROUNDS);
    db.run(`UPDATE users SET password=?, updated_at=CURRENT_TIMESTAMP WHERE email=?`, [hashed, email], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'DB error' });
      res.json({ success: true, message: 'Password reset success' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==================== 用户接口 ====================
app.post('/api/user/profile', (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: 'Student ID required' });

  db.get(`SELECT * FROM users WHERE student_id = ?`, [student_id], (err, user) => {
    if (err || !user) return res.status(400).json({ success: false, message: 'User not found' });
    delete user.password;
    res.json({ success: true, user });
  });
});

app.post('/api/user/update', (req, res) => {
  const { student_id, phone, anonymous_name, avatar } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: 'Student ID required' });

  db.run(`UPDATE users SET phone=?, anonymous_name=?, avatar=?, updated_at=CURRENT_TIMESTAMP WHERE student_id=?`,
    [phone || '', anonymous_name || '', avatar || '', student_id], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'DB error' });
      res.json({ success: true, message: 'Profile updated' });
    }
  );
});

app.post('/api/user/public', (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: 'Student ID required' });

  db.get(`SELECT anonymous_name, gender, created_at FROM users WHERE student_id = ?`, [student_id], (err, row) => {
    if (err || !row) return res.status(400).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: row });
  });
});

// ==================== 任务接口 ====================
app.post('/api/task/create', (req, res) => {
  try {
    const { publisher_id, move_date, move_time, from_address, to_address, items_desc, items_photo, people_needed, reward, note } = req.body;

    if (!publisher_id || !move_date || !move_time || !from_address || !to_address || !items_desc || !people_needed || !reward) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    db.run(`INSERT INTO tasks (publisher_id, move_date, move_time, from_address, to_address, items_desc, items_photo, people_needed, reward, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [publisher_id, move_date, move_time, from_address, to_address, items_desc, items_photo || '', people_needed, reward, note || ''],
      function (err) {
        if (err) return res.status(500).json({ success: false, message: 'DB error' });
        res.json({ success: true, task_id: this.lastID, message: 'Task created' });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/task/list', (req, res) => {
  db.all(`SELECT t.*, u.anonymous_name AS publisher_name FROM tasks t LEFT JOIN users u ON t.publisher_id = u.student_id WHERE t.status = 'pending' ORDER BY t.created_at DESC`, (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, list: rows });
  });
});

app.post('/api/task/my-published', (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: 'Student ID required' });

  db.all(`SELECT * FROM tasks WHERE publisher_id = ? ORDER BY created_at DESC`, [student_id], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, list: rows });
  });
});

app.post('/api/task/my-assigned', (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: 'Student ID required' });

  db.all(`SELECT * FROM tasks WHERE helper_id = ? ORDER BY created_at DESC`, [student_id], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, list: rows });
  });
});

app.post('/api/task/apply', (req, res) => {
  const { task_id, helper_id } = req.body;
  if (!task_id || !helper_id) return res.status(400).json({ success: false, message: 'Task ID and helper ID required' });

  db.get(`SELECT * FROM tasks WHERE id = ? AND status = 'pending'`, [task_id], (err, task) => {
    if (err || !task) return res.status(400).json({ success: false, message: 'Task unavailable' });
    if (task.publisher_id === helper_id) return res.status(400).json({ success: false, message: 'Cannot apply own task' });

    db.get(`SELECT * FROM task_applications WHERE task_id = ? AND helper_id = ?`, [task_id, helper_id], (err, record) => {
      if (record) return res.status(400).json({ success: false, message: 'Already applied' });

      db.run(`INSERT INTO task_applications (task_id, helper_id) VALUES (?, ?)`, [task_id, helper_id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'DB error' });
        res.json({ success: true, message: 'Applied success' });
      });
    });
  });
});

app.post('/api/task/applicants', (req, res) => {
  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ success: false, message: 'Task ID required' });

  db.all(`SELECT a.*, u.anonymous_name, u.phone FROM task_applications a LEFT JOIN users u ON a.helper_id = u.student_id WHERE a.task_id = ?`, [task_id], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, applicants: rows });
  });
});

app.post('/api/task/assign', (req, res) => {
  const { task_id, helper_id } = req.body;
  if (!task_id || !helper_id) return res.status(400).json({ success: false, message: 'Task ID and helper ID required' });

  db.run(`UPDATE tasks SET status = 'assigned', helper_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [helper_id, task_id], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, message: 'Task assigned' });
  });
});

app.post('/api/task/complete', (req, res) => {
  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ success: false, message: 'Task ID required' });

  db.run(`UPDATE tasks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [task_id], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, message: 'Task completed' });
  });
});

app.post('/api/task/cancel', (req, res) => {
  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ success: false, message: 'Task ID required' });

  db.run(`UPDATE tasks SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [task_id], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, message: 'Task cancelled' });
  });
});

// ==================== 消息接口 ====================
app.post('/api/message/send', (req, res) => {
  const { sender_id, receiver_id, content } = req.body;
  if (!sender_id || !receiver_id || !content) return res.status(400).json({ success: false, message: 'All fields required' });

  db.run(`INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)`, [sender_id, receiver_id, content], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, message: 'Message sent' });
  });
});

app.post('/api/message/inbox', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, message: 'User ID required' });

  db.all(`SELECT m.*, u.anonymous_name AS sender_name FROM messages m LEFT JOIN users u ON m.sender_id = u.student_id WHERE m.receiver_id = ? ORDER BY m.send_time DESC`, [user_id], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, messages: rows });
  });
});

app.post('/api/message/mark-read', (req, res) => {
  const { msg_id } = req.body;
  if (!msg_id) return res.status(400).json({ success: false, message: 'Message ID required' });

  db.run(`UPDATE messages SET is_read = 1 WHERE id = ?`, [msg_id], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, message: 'Marked as read' });
  });
});

// ==================== 反馈接口 ====================
app.post('/api/feedback/submit', (req, res) => {
  const { user_id, content, contact } = req.body;
  if (!user_id || !content) return res.status(400).json({ success: false, message: 'User ID and content required' });

  db.run(`INSERT INTO feedbacks (user_id, content, contact) VALUES (?, ?, ?)`, [user_id, content, contact || ''], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    res.json({ success: true, message: 'Feedback submitted' });
  });
});

// ==================== 统计接口 ====================
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

// 服务启动
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
  setTimeout(() => {
    initDatabase();
    setInterval(cleanExpiredCodes, 60000);
    setInterval(cleanExpiredRateLimits, 5 * 60000);
  }, 1500);
});

// 优雅退出
process.on('SIGTERM', () => {
  console.log('Stopping server...');
  server.close(() => {
    if (db) db.close();
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught error:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

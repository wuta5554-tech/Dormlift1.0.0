const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 1. 数据库路径（强制使用 /tmp，Railway 唯一可写目录） =====
const DB_DIR = '/tmp/dormlift';
const DB_PATH = path.join(DB_DIR, 'dormlift.db');

// 确保目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  console.log(`📁 创建数据库目录：${DB_DIR}`);
}

// ===== 2. 全局变量 =====
let storedCode = null;
let db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
    process.exit(1); // 连接失败则退出，PM2 会自动重启
  } else {
    console.log(`✅ 数据库连接成功（路径：${DB_PATH}）`);
    initTables();
  }
});

// ===== 3. 中间件 =====
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(__dirname));

// ===== 4. 健康检查（Railway 必过） =====
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    port: PORT,
    db_connected: !!db,
    timestamp: new Date().toISOString()
  });
});

// ===== 5. 根路由返回前端页面 =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== 6. 初始化数据表 =====
function initTables() {
  // 用户表
  const userTableSql = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL,
      given_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      gender TEXT NOT NULL,
      anonymous_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `;

  // 搬家请求表
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

// ===== 7. 所有业务接口（完整保留） =====
app.post('/api/send-verification-code', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.json({ success: false, message: 'Phone number is required' });
  
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  storedCode = { phone, code, expireTime: Date.now() + 5 * 60 * 1000 };
  
  res.json({
    success: true,
    message: `Verification code sent! (Code: ${code})`
  });
});

app.post('/api/register', (req, res) => {
  const { givenName, firstName, studentId, gender, phone, verifyCode, anonymousName, password } = req.body;
  
  if (!givenName || !firstName || !studentId || !gender || !phone || !verifyCode || !anonymousName || !password) {
    return res.json({ success: false, message: 'All fields are required' });
  }

  if (!storedCode || storedCode.phone !== phone || storedCode.code !== verifyCode || Date.now() > storedCode.expireTime) {
    return res.json({ success: false, message: 'Invalid or expired verification code' });
  }

  // 检查学号是否已注册
  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (row) return res.json({ success: false, message: 'Student ID already registered' });

    // 检查手机号是否已注册
    db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, row) => {
      if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
      if (row) return res.json({ success: false, message: 'Phone number already registered' });

      // 插入新用户
      db.run(`INSERT INTO users (student_id, given_name, first_name, gender, anonymous_name, phone, password)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [studentId, givenName, firstName, gender, anonymousName, phone, password], (err) => {
        if (err) return res.json({ success: false, message: 'Registration failed: ' + err.message });
        storedCode = null; // 清空验证码
        res.json({ success: true, message: 'Registration successful! Please login' });
      });
    });
  });
});

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

app.post('/api/post-request', (req, res) => {
  const { studentId, moveDate, location, helpersNeeded, items, compensation } = req.body;
  if (!studentId || !moveDate || !location || !helpersNeeded || !items || !compensation) {
    return res.json({ success: false, message: 'All fields are required' });
  }

  db.run(`INSERT INTO moving_requests (student_id, move_date, location, helpers_needed, items, compensation)
    VALUES (?, ?, ?, ?, ?, ?)`, [studentId, moveDate, location, helpersNeeded, items, compensation], (err) => {
    if (err) return res.json({ success: false, message: 'Failed to post request: ' + err.message });
    res.json({ success: true, message: 'Moving request posted successfully' });
  });
});

app.get('/api/get-tasks', (req, res) => {
  db.all(`SELECT * FROM moving_requests 
    WHERE helper_assigned IS NULL OR helper_assigned = ''
    ORDER BY move_date ASC`, (err, rows) => {
    if (err) return res.json({ success: false, message: 'Failed to load tasks: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

app.post('/api/accept-task', (req, res) => {
  const { taskId, helperId } = req.body;
  if (!taskId || !helperId) return res.json({ success: false, message: 'Task ID and Helper ID are required' });

  db.get('SELECT * FROM moving_requests WHERE id = ?', [taskId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.json({ success: false, message: 'Task not found' });
    if (row.helper_assigned) return res.json({ success: false, message: 'This task has already been assigned' });

    db.run(`UPDATE moving_requests SET helper_assigned = ? WHERE id = ?`, [helperId, taskId], (err) => {
      if (err) return res.json({ success: false, message: 'Failed to accept task: ' + err.message });
      res.json({ success: true, message: 'Task accepted successfully' });
    });
  });
});

app.post('/api/my-posted-tasks', (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.json({ success: false, message: 'Student ID is required' });

  db.all(`SELECT * FROM moving_requests WHERE student_id = ? ORDER BY move_date ASC`, [studentId], (err, rows) => {
    if (err) return res.json({ success: false, message: 'Failed to load your requests: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

app.post('/api/my-accepted-tasks', (req, res) => {
  const { helperId } = req.body;
  if (!helperId) return res.json({ success: false, message: 'Helper ID is required' });

  db.all(`SELECT * FROM moving_requests WHERE helper_assigned = ? ORDER BY move_date ASC`, [helperId], (err, rows) => {
    if (err) return res.json({ success: false, message: 'Failed to load your tasks: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

app.post('/api/view-helper-id', (req, res) => {
  const { taskId, posterId } = req.body;
  if (!taskId || !posterId) return res.json({ success: false, message: 'Task ID and Poster ID are required' });

  db.get(`SELECT helper_assigned FROM moving_requests WHERE id = ? AND student_id = ?`, [taskId, posterId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (!row || !row.helper_assigned) return res.json({ success: false, message: 'No helper assigned to this task' });
    res.json({ success: true, helperId: row.helper_assigned });
  });
});

app.post('/api/view-poster-id', (req, res) => {
  const { taskId, helperId } = req.body;
  if (!taskId || !helperId) return res.json({ success: false, message: 'Task ID and Helper ID are required' });

  db.get(`SELECT student_id FROM moving_requests WHERE id = ? AND helper_assigned = ?`, [taskId, helperId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.json({ success: false, message: 'You are not assigned to this task' });
    res.json({ success: true, posterId: row.student_id });
  });
});

app.post('/api/delete-task', (req, res) => {
  const { taskId, studentId } = req.body;
  if (!taskId || !studentId) return res.json({ success: false, message: 'Task ID and Student ID are required' });

  db.get(`SELECT * FROM moving_requests WHERE id = ? AND student_id = ?`, [taskId, studentId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.json({ success: false, message: 'Task not found or you are not the owner' });

    db.run(`DELETE FROM moving_requests WHERE id = ?`, [taskId], (err) => {
      if (err) return res.json({ success: false, message: 'Failed to delete task: ' + err.message });
      res.json({ success: true, message: 'Task deleted successfully' });
    });
  });
});

app.post('/api/cancel-task', (req, res) => {
  const { taskId, helperId } = req.body;
  if (!taskId || !helperId) return res.json({ success: false, message: 'Task ID and Helper ID are required' });

  db.get(`SELECT * FROM moving_requests WHERE id = ? AND helper_assigned = ?`, [taskId, helperId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.json({ success: false, message: 'Task not found or you are not the helper' });

    db.run(`UPDATE moving_requests SET helper_assigned = NULL WHERE id = ?`, [taskId], (err) => {
      if (err) return res.json({ success: false, message: 'Failed to cancel task: ' + err.message });
      res.json({ success: true, message: 'Task cancelled successfully' });
    });
  });
});

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
        phone: row.phone
      }
    });
  });
});

// ===== 8. 启动服务器 =====
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 服务器已启动：http://0.0.0.0:${PORT}`);
  console.log(`🌐 访问地址：https://${process.env.RAILWAY_STATIC_URL || 'localhost:' + PORT}`);
});

// 优化服务器配置
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

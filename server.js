// 完整可运行的最终版代码（包含你所有业务功能 + 适配Railway）
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
// 关键：Railway 强制用这个端口，不用纠结数字
const PORT = process.env.PORT || 8080;

// 全局变量
let storedCode = null;
let db = null;

// 中间件（必须放在最前面）
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// ========== 新增：托管当前文件夹的静态文件（index.html） ==========
app.use(express.static(__dirname));
// ========== 新增结束 ==========
// 1. 健康检查接口（Railway 必过）
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// 2. 根路由（修改：返回 index.html 而不是文字）
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html'); // 关键：返回你的前端页面
});

// 3. 连接数据库（启动后立即执行，但不阻塞）
function connectDB() {
  db = new sqlite3.Database('./dormlift.db', (err) => {
    if (err) {
      console.error('数据库连接失败:', err.message);
    } else {
      console.log('✅ 数据库连接成功');
      initTables();
    }
  });
}

// 4. 初始化数据表
function initTables() {
  // 用户表
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT UNIQUE NOT NULL,
    given_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    gender TEXT NOT NULL,
    anonymous_name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`, (err) => {
    if (err) console.error('用户表初始化失败:', err.message);
    else console.log('✅ 用户表初始化完成');
  });

  // 搬家请求表
  db.run(`CREATE TABLE IF NOT EXISTS moving_requests (
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
  )`, (err) => {
    if (err) console.error('搬家请求表初始化失败:', err.message);
    else console.log('✅ 搬家请求表初始化完成');
  });
}

// ========== 你的所有业务接口（完整保留） ==========
// 发送验证码
app.post('/api/send-verification-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.json({ success: false, message: 'Phone number is required' });
  
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  storedCode = { phone, code, expireTime: Date.now() + 5 * 60 * 1000 };
  
  res.json({
    success: true,
    message: `Verification code sent! (Code: ${code})`
  });
});

// 注册
app.post('/api/register', async (req, res) => {
  const { givenName, firstName, studentId, gender, phone, verifyCode, anonymousName, password, confirmPassword } = req.body;
  
  if (!givenName || !firstName || !studentId || !gender || !phone || !verifyCode || !anonymousName || !password || !confirmPassword) {
    return res.json({ success: false, message: 'All fields are required' });
  }
  
  if (password !== confirmPassword) {
    return res.json({ success: false, message: 'Passwords do not match' });
  }

  db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (row) return res.json({ success: false, message: 'Student ID already registered' });

    db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, row) => {
      if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
      if (row) return res.json({ success: false, message: 'Phone number already registered' });

      db.run(`INSERT INTO users (student_id, given_name, first_name, gender, anonymous_name, phone, password)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [studentId, givenName, firstName, gender, anonymousName, phone, password], (err) => {
        if (err) return res.json({ success: false, message: 'Registration failed: ' + err.message });
        storedCode = null;
        res.json({ success: true, message: 'Registration successful! Please login' });
      });
    });
  });
});

// 登录
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

// 发布搬家请求
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

// 获取所有公开任务
app.get('/api/get-tasks', (req, res) => {
  db.all(`SELECT * FROM moving_requests 
    WHERE helper_assigned IS NULL OR helper_assigned = ''
    ORDER BY move_date ASC`, (err, rows) => {
    if (err) return res.json({ success: false, message: 'Failed to load tasks: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

// 接受任务
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

// 获取我发布的任务
app.post('/api/my-posted-tasks', (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.json({ success: false, message: 'Student ID is required' });

  db.all(`SELECT * FROM moving_requests WHERE student_id = ? ORDER BY move_date ASC`, [studentId], (err, rows) => {
    if (err) return res.json({ success: false, message: 'Failed to load your requests: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

// 获取我接受的任务
app.post('/api/my-accepted-tasks', (req, res) => {
  const { helperId } = req.body;
  if (!helperId) return res.json({ success: false, message: 'Helper ID is required' });

  db.all(`SELECT * FROM moving_requests WHERE helper_assigned = ? ORDER BY move_date ASC`, [helperId], (err, rows) => {
    if (err) return res.json({ success: false, message: 'Failed to load your tasks: ' + err.message });
    res.json({ success: true, tasks: rows });
  });
});

// 查看助手学号
app.post('/api/view-helper-id', (req, res) => {
  const { taskId, posterId } = req.body;
  if (!taskId || !posterId) return res.json({ success: false, message: 'Task ID and Poster ID are required' });

  db.get(`SELECT helper_assigned FROM moving_requests WHERE id = ? AND student_id = ?`, [taskId, posterId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (!row || !row.helper_assigned) return res.json({ success: false, message: 'No helper assigned to this task' });
    res.json({ success: true, helperId: row.helper_assigned });
  });
});

// 查看发布者学号
app.post('/api/view-poster-id', (req, res) => {
  const { taskId, helperId } = req.body;
  if (!taskId || !helperId) return res.json({ success: false, message: 'Task ID and Helper ID are required' });

  db.get(`SELECT student_id FROM moving_requests WHERE id = ? AND helper_assigned = ?`, [taskId, helperId], (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error: ' + err.message });
    if (!row) return res.json({ success: false, message: 'You are not assigned to this task' });
    res.json({ success: true, posterId: row.student_id });
  });
});

// 删除任务
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

// 取消任务
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

// 获取个人信息
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
// 在 app.listen 前面加
app.use(express.static('public')); // 托管前端页面
// ========== 启动服务器（核心：先启动，再连数据库） ==========
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 服务器已启动：http://0.0.0.0:${PORT}`);
  // 启动后再连数据库，避免阻塞
  connectDB();
});

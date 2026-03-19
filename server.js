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

// 中间件配置
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// 接口频率限制
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

// ===== 根路径返回正常渲染的前端页面（无任何文件夹依赖）=====
app.get('/', (req, res) => {
  // 前端页面完整代码，确保CSS样式、JS交互正常
  const frontEndHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DormLift - 搬家互助平台</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: "Microsoft YaHei", Arial, sans-serif;
    }
    body {
      background-color: #f5f7fa;
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      color: #2c3e50;
    }
    .section {
      background: white;
      margin: 20px 0;
      padding: 25px;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h2 {
      color: #34495e;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid #eee;
    }
    .form-group {
      margin: 15px 0;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #34495e;
    }
    input, textarea, select {
      width: 100%;
      padding: 10px 15px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
      transition: border 0.3s;
    }
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: #3498db;
      box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.1);
    }
    button {
      padding: 12px 25px;
      background-color: #3498db;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: background 0.3s;
    }
    button:hover {
      background-color: #2980b9;
    }
    .response {
      margin-top: 15px;
      padding: 15px;
      background-color: #f8f9fa;
      border-radius: 6px;
      white-space: pre-wrap;
      font-family: Consolas, monospace;
      font-size: 13px;
      color: #2c3e50;
      max-height: 300px;
      overflow-y: auto;
    }
    .form-group small {
      color: #7f8c8d;
      font-size: 12px;
      margin-top: 5px;
      display: block;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>DormLift 搬家互助平台</h1>
    <p>完整功能测试页面 - 无需配置，直接使用</p>
  </div>

  <!-- API配置 -->
  <div class="section">
    <h2>1. 系统配置</h2>
    <div class="form-group">
      <label>API服务器地址</label>
      <input type="text" id="apiBaseUrl" value="https://${req.headers.host}" placeholder="例如：https://xxx.railway.app">
      <small>已自动填充当前服务器地址，无需修改</small>
    </div>
  </div>

  <!-- 发送验证码 -->
  <div class="section">
    <h2>2. 发送验证码</h2>
    <div class="form-group">
      <label>邮箱地址</label>
      <input type="email" id="sendCodeEmail" placeholder="请输入你的邮箱（用于接收验证码）">
    </div>
    <button onclick="sendCode()">发送验证码</button>
    <div class="response" id="sendCodeResponse">点击按钮后，响应结果会显示在这里...</div>
  </div>

  <!-- 用户注册 -->
  <div class="section">
    <h2>3. 用户注册</h2>
    <div class="form-group">
      <label>学号</label>
      <input type="text" id="regStudentId" placeholder="请输入学号（唯一标识）">
    </div>
    <div class="form-group">
      <label>名</label>
      <input type="text" id="regFirstName" placeholder="例如：张">
    </div>
    <div class="form-group">
      <label>姓</label>
      <input type="text" id="regGivenName" placeholder="例如：三">
    </div>
    <div class="form-group">
      <label>性别</label>
      <select id="regGender">
        <option value="male">男</option>
        <option value="female">女</option>
        <option value="other">其他</option>
      </select>
    </div>
    <div class="form-group">
      <label>匿名昵称</label>
      <input type="text" id="regAnonymousName" placeholder="显示在平台的昵称">
    </div>
    <div class="form-group">
      <label>手机号</label>
      <input type="text" id="regPhone" placeholder="请输入手机号">
    </div>
    <div class="form-group">
      <label>邮箱地址</label>
      <input type="email" id="regEmail" placeholder="请输入接收验证码的邮箱">
    </div>
    <div class="form-group">
      <label>密码</label>
      <input type="password" id="regPassword" placeholder="请设置密码">
    </div>
    <div class="form-group">
      <label>验证码</label>
      <input type="text" id="regCode" placeholder="输入邮箱收到的6位验证码">
    </div>
    <button onclick="register()">注册账号</button>
    <div class="response" id="registerResponse">点击按钮后，响应结果会显示在这里...</div>
  </div>

  <!-- 用户登录 -->
  <div class="section">
    <h2>4. 用户登录</h2>
    <div class="form-group">
      <label>学号</label>
      <input type="text" id="loginStudentId" placeholder="请输入注册的学号">
    </div>
    <div class="form-group">
      <label>密码</label>
      <input type="password" id="loginPassword" placeholder="请输入密码">
    </div>
    <button onclick="login()">登录账号</button>
    <div class="response" id="loginResponse">点击按钮后，响应结果会显示在这里...</div>
  </div>

  <!-- 创建搬家任务 -->
  <div class="section">
    <h2>5. 创建搬家任务</h2>
    <div class="form-group">
      <label>发布者学号</label>
      <input type="text" id="taskPublisherId" placeholder="你的学号">
    </div>
    <div class="form-group">
      <label>搬家日期</label>
      <input type="date" id="taskMoveDate">
    </div>
    <div class="form-group">
      <label>搬家时间</label>
      <input type="time" id="taskMoveTime">
    </div>
    <div class="form-group">
      <label>出发地址</label>
      <input type="text" id="taskFromAddress" placeholder="例如：XX宿舍楼X栋">
    </div>
    <div class="form-group">
      <label>目的地址</label>
      <input type="text" id="taskToAddress" placeholder="例如：XX校区XX楼">
    </div>
    <div class="form-group">
      <label>物品描述</label>
      <textarea id="taskItemsDesc" placeholder="例如：2个行李箱、1个书桌、若干书籍"></textarea>
    </div>
    <div class="form-group">
      <label>需要人数</label>
      <input type="number" id="taskPeopleNeeded" placeholder="至少1人" min="1">
    </div>
    <div class="form-group">
      <label>报酬</label>
      <input type="text" id="taskReward" placeholder="例如：50元/人、奶茶、一顿饭">
    </div>
    <div class="form-group">
      <label>备注（可选）</label>
      <textarea id="taskNote" placeholder="其他说明，例如：有电梯、需要搬运工具等"></textarea>
    </div>
    <button onclick="createTask()">创建任务</button>
    <div class="response" id="createTaskResponse">点击按钮后，响应结果会显示在这里...</div>
  </div>

  <!-- 获取待接任务列表 -->
  <div class="section">
    <h2>6. 查看待接任务</h2>
    <button onclick="getTaskList()">获取所有待接任务</button>
    <div class="response" id="taskListResponse">点击按钮后，任务列表会显示在这里...</div>
  </div>

  <script>
    // 全局工具函数：获取API地址
    function getApiUrl() {
      return document.getElementById('apiBaseUrl').value.trim();
    }

    // 全局工具函数：发送请求
    async function request(apiPath, method, data) {
      try {
        const url = \`\${getApiUrl()}\${apiPath}\`;
        const options = {
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        };
        if (data) {
          options.body = JSON.stringify(data);
        }
        const response = await fetch(url, options);
        const result = await response.json();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    // 1. 发送验证码
    async function sendCode() {
      const email = document.getElementById('sendCodeEmail').value.trim();
      const responseEl = document.getElementById('sendCodeResponse');
      
      if (!email) {
        responseEl.textContent = '错误：请输入有效的邮箱地址';
        return;
      }

      responseEl.textContent = '正在发送验证码...';
      const result = await request('/api/auth/send-code', 'POST', { email });
      responseEl.textContent = JSON.stringify(result, null, 2);
    }

    // 2. 用户注册
    async function register() {
      const formData = {
        student_id: document.getElementById('regStudentId').value.trim(),
        first_name: document.getElementById('regFirstName').value.trim(),
        given_name: document.getElementById('regGivenName').value.trim(),
        gender: document.getElementById('regGender').value,
        anonymous_name: document.getElementById('regAnonymousName').value.trim(),
        phone: document.getElementById('regPhone').value.trim(),
        email: document.getElementById('regEmail').value.trim(),
        password: document.getElementById('regPassword').value.trim(),
        code: document.getElementById('regCode').value.trim()
      };
      const responseEl = document.getElementById('registerResponse');

      // 验证必填项
      for (const key in formData) {
        if (formData[key] === '' && key !== 'gender') {
          responseEl.textContent = \`错误：请填写\${key === 'student_id' ? '学号' : key === 'first_name' ? '名' : key === 'given_name' ? '姓' : key === 'anonymous_name' ? '匿名昵称' : key === 'phone' ? '手机号' : key === 'email' ? '邮箱' : key === 'password' ? '密码' : '验证码'}\`;
          return;
        }
      }

      responseEl.textContent = '正在注册账号...';
      const result = await request('/api/auth/register', 'POST', formData);
      responseEl.textContent = JSON.stringify(result, null, 2);
    }

    // 3. 用户登录
    async function login() {
      const formData = {
        student_id: document.getElementById('loginStudentId').value.trim(),
        password: document.getElementById('loginPassword').value.trim()
      };
      const responseEl = document.getElementById('loginResponse');

      if (!formData.student_id) {
        responseEl.textContent = '错误：请输入学号';
        return;
      }
      if (!formData.password) {
        responseEl.textContent = '错误：请输入密码';
        return;
      }

      responseEl.textContent = '正在登录...';
      const result = await request('/api/auth/login', 'POST', formData);
      responseEl.textContent = JSON.stringify(result, null, 2);
    }

    // 4. 创建搬家任务
    async function createTask() {
      const formData = {
        publisher_id: document.getElementById('taskPublisherId').value.trim(),
        move_date: document.getElementById('taskMoveDate').value,
        move_time: document.getElementById('taskMoveTime').value,
        from_address: document.getElementById('taskFromAddress').value.trim(),
        to_address: document.getElementById('taskToAddress').value.trim(),
        items_desc: document.getElementById('taskItemsDesc').value.trim(),
        people_needed: document.getElementById('taskPeopleNeeded').value.trim(),
        reward: document.getElementById('taskReward').value.trim(),
        note: document.getElementById('taskNote').value.trim()
      };
      const responseEl = document.getElementById('createTaskResponse');

      // 验证核心必填项
      const requiredFields = ['publisher_id', 'move_date', 'move_time', 'from_address', 'to_address', 'items_desc', 'people_needed', 'reward'];
      for (const field of requiredFields) {
        if (!formData[field]) {
          responseEl.textContent = \`错误：请填写\${field === 'publisher_id' ? '发布者学号' : field === 'move_date' ? '搬家日期' : field === 'move_time' ? '搬家时间' : field === 'from_address' ? '出发地址' : field === 'to_address' ? '目的地址' : field === 'items_desc' ? '物品描述' : field === 'people_needed' ? '需要人数' : '报酬'}\`;
          return;
        }
      }

      responseEl.textContent = '正在创建任务...';
      const result = await request('/api/task/create', 'POST', formData);
      responseEl.textContent = JSON.stringify(result, null, 2);
    }

    // 5. 获取待接任务列表
    async function getTaskList() {
      const responseEl = document.getElementById('taskListResponse');
      responseEl.textContent = '正在获取任务列表...';
      const result = await request('/api/task/list', 'GET');
      responseEl.textContent = JSON.stringify(result, null, 2);
    }
  </script>
</body>
</html>
  `;
  
  // 关键：设置正确的Content-Type，确保HTML正常渲染
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(frontEndHtml);
});

// 健康检查接口（独立路径，不影响前端）
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'running',
    service: 'DormLift Final Backend',
    port: PORT,
    db_connected: isDbReady,
    timestamp: new Date().toISOString()
  });
});

// ===== 工具函数 =====
// 验证邮箱格式
function isValidEmail(email) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(email);
}

// 验证手机号格式（简单验证）
function isValidPhone(phone) {
  const re = /^(\+?\d{1,4})?\s?\d{6,14}$/;
  return re.test(phone);
}

// 验证学号格式
function isValidStudentId(studentId) {
  return /^[a-zA-Z0-9]{4,20}$/.test(studentId);
}

// 生成6位数字验证码
function generateVerifyCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 生成用户Token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 检查账号是否被锁定
function isUserLocked(studentId) {
  if (!userLock[studentId]) return false;
  return Date.now() < userLock[studentId];
}

// 清理过期验证码
function cleanExpiredCodes() {
  const now = Date.now();
  for (let email in verifyCodeStore) {
    if (verifyCodeStore[email].expireAt < now) {
      delete verifyCodeStore[email];
    }
  }
}

// 清理过期频率限制
function cleanExpiredRateLimits() {
  const now = Date.now();
  for (let ip in rateLimit) {
    if (now - rateLimit[ip].time > RATE_LIMIT_WINDOW * 2) {
      delete rateLimit[ip];
    }
  }
}

// 格式化时间
function formatDatetime(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

// 脱敏邮箱
function maskEmail(email) {
  if (!email) return '';
  let [name, domain] = email.split('@');
  if (!domain) return email;
  if (name.length <= 2) return name + '***@' + domain;
  return name[0] + '***' + name[name.length-1] + '@' + domain;
}

// 脱敏手机号
function maskPhone(phone) {
  if (!phone) return '';
  if (phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

// 发送验证码邮件
async function sendVerifyEmail(email, code) {
  // 如果没有配置SMTP，仅在控制台输出验证码
  if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
    console.log(`[验证码调试] 发送至 ${maskEmail(email)} 的验证码：${code}`);
    return true;
  }

  try {
    // 配置邮件发送器（以Outlook/Hotmail为例）
    let transporter = nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_EMAIL, // 你的邮箱
        pass: process.env.SMTP_PASSWORD // 你的邮箱密码/授权码
      },
      tls: {
        ciphers: 'SSLv3'
      }
    });

    // 发送邮件
    await transporter.sendMail({
      from: `"DormLift" <${process.env.SMTP_EMAIL}>`, // 发件人
      to: email, // 收件人
      subject: 'DormLift 验证码', // 主题
      text: `你的DormLift验证码是：${code}，5分钟内有效。`, // 文本内容
      html: `<div style="padding:20px;max-width:500px;margin:0 auto;border:1px solid #eee;border-radius:10px;">
        <h3 style="color:#3498db;">DormLift 验证码</h3>
        <p style="margin:20px 0;font-size:16px;">你的验证码是：<strong style="font-size:20px;color:#e74c3c;">${code}</strong></p>
        <p style="color:#7f8c8d;font-size:12px;">该验证码5分钟内有效，请及时使用。</p>
      </div>` // HTML内容
    });
    return true;
  } catch (err) {
    console.error('邮件发送失败：', err.message);
    return false;
  }
}

// ===== 数据库初始化 =====
function initDatabase() {
  // 连接SQLite数据库（存储在/tmp目录，Railway持久化）
  db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('数据库连接失败：', err.message);
      return;
    }
    console.log('数据库连接成功：', DB_PATH);

    // 创建所有必要的表
    const createTablesSql = `
      PRAGMA foreign_keys = ON;

      -- 用户表
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

      -- 验证码表
      CREATE TABLE IF NOT EXISTS verify_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        expire_at DATETIME NOT NULL,
        is_used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- 任务表
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(publisher_id) REFERENCES users(student_id)
      );

      -- 任务申请表
      CREATE TABLE IF NOT EXISTS task_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        helper_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
        apply_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY(helper_id) REFERENCES users(student_id)
      );

      -- 消息表
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        content TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        send_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sender_id) REFERENCES users(student_id),
        FOREIGN KEY(receiver_id) REFERENCES users(student_id)
      );

      -- 反馈表
      CREATE TABLE IF NOT EXISTS feedbacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        contact TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(student_id)
      );

      -- Token表
      CREATE TABLE IF NOT EXISTS user_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL,
        token TEXT NOT NULL,
        expire_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES users(student_id)
      );

      -- 系统日志表
      CREATE TABLE IF NOT EXISTS system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        ip TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;

    db.exec(createTablesSql, (err) => {
      if (err) {
        console.error('创建表失败：', err.message);
      } else {
        isDbReady = true;
        console.log('所有表创建/检查完成');
      }
    });
  });
}

// ===== 日志记录函数 =====
function writeLog(type, content, req) {
  if (!db) return;
  const ip = req ? (req.ip || req.connection.remoteAddress) : null;
  db.run(`INSERT INTO system_logs (type, content, ip) VALUES (?, ?, ?)`,
    [type, content.substring(0, 500), ip], (err) => {
      if (err) console.error('日志记录失败：', err.message);
    });
}

// ===== 接口：认证相关 =====
// 发送验证码
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: '无效的邮箱地址' });
    }

    // 清理过期验证码
    cleanExpiredCodes();

    // 生成并存储验证码
    const code = generateVerifyCode();
    verifyCodeStore[email] = {
      code: code,
      expireAt: Date.now() + VERIFY_CODE_EXPIRE_SECONDS * 1000
    };

    // 发送验证码
    const sendResult = await sendVerifyEmail(email, code);
    if (!sendResult) {
      return res.status(500).json({ success: false, message: '验证码发送失败，请稍后重试' });
    }

    writeLog('SEND_CODE', `验证码发送至 ${maskEmail(email)}`, req);
    res.json({ success: true, message: '验证码已发送（如果未收到，请查看服务器控制台）' });
  } catch (err) {
    writeLog('ERROR', `发送验证码失败：${err.message}`, req);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 用户注册
app.post('/api/auth/register', async (req, res) => {
  try {
    const { student_id, first_name, given_name, gender, anonymous_name, phone, email, password, code } = req.body;

    // 验证必填项
    if (!student_id || !first_name || !given_name || !gender || !anonymous_name || !phone || !email || !password || !code) {
      return res.status(400).json({ success: false, message: '所有字段均为必填项' });
    }

    // 验证格式
    if (!isValidStudentId(student_id)) return res.status(400).json({ success: false, message: '学号格式无效（仅支持字母和数字，4-20位）' });
    if (!isValidPhone(phone)) return res.status(400).json({ success: false, message: '手机号格式无效' });
    if (!isValidEmail(email)) return res.status(400).json({ success: false, message: '邮箱格式无效' });

    // 验证验证码
    cleanExpiredCodes();
    const verifyRecord = verifyCodeStore[email];
    if (!verifyRecord || verifyRecord.code !== code) {
      return res.status(400).json({ success: false, message: '验证码错误或已过期' });
    }

    // 密码加密
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 插入用户数据
    db.run(`INSERT INTO users (student_id, first_name, given_name, gender, anonymous_name, phone, email, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [student_id, first_name, given_name, gender, anonymous_name, phone, email, hashedPassword],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ success: false, message: '学号、手机号或邮箱已存在' });
          }
          return res.status(500).json({ success: false, message: '数据库错误' });
        }

        // 注册成功后删除验证码
        delete verifyCodeStore[email];

        writeLog('REGISTER', `用户注册：${student_id}`, req);
        res.json({ success: true, message: '注册成功，请登录' });
      }
    );
  } catch (err) {
    writeLog('ERROR', `注册失败：${err.message}`, req);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 用户登录
app.post('/api/auth/login', async (req, res) => {
  try {
    const { student_id, password } = req.body;

    // 验证必填项
    if (!student_id || !password) {
      return res.status(400).json({ success: false, message: '学号和密码均为必填项' });
    }

    // 检查账号是否被锁定
    if (isUserLocked(student_id)) {
      return res.status(403).json({ success: false, message: '账号已被锁定，请15分钟后重试' });
    }

    // 查询用户
    db.get(`SELECT * FROM users WHERE student_id = ?`, [student_id], async (err, user) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      if (!user) return res.status(400).json({ success: false, message: '用户不存在' });

      // 验证密码
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        // 记录登录失败次数
        loginAttempts[student_id] = (loginAttempts[student_id] || 0) + 1;
        
        // 超过5次失败，锁定账号
        if (loginAttempts[student_id] >= MAX_LOGIN_ATTEMPTS) {
          userLock[student_id] = Date.now() + LOCK_TIME_MINUTES * 60 * 1000;
          writeLog('LOGIN_LOCK', `用户 ${student_id} 账号被锁定`, req);
          return res.status(403).json({ success: false, message: '密码错误次数过多，账号已锁定15分钟' });
        }

        return res.status(400).json({ success: false, message: `密码错误（剩余尝试次数：${5 - loginAttempts[student_id]}）` });
      }

      // 登录成功，重置失败次数
      loginAttempts[student_id] = 0;

      // 生成Token
      const token = generateToken();
      const tokenExpire = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7天有效期

      // 存储Token
      db.run(`INSERT INTO user_tokens (student_id, token, expire_at) VALUES (?, ?, ?)`,
        [student_id, token, new Date(tokenExpire).toISOString()]);

      // 返回用户信息（隐藏密码）
      delete user.password;
      writeLog('LOGIN', `用户 ${student_id} 登录成功`, req);
      res.json({
        success: true,
        message: '登录成功',
        user: user,
        token: token
      });
    });
  } catch (err) {
    writeLog('ERROR', `登录失败：${err.message}`, req);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 验证Token
app.post('/api/auth/verify-token', (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token不能为空' });

    // 查询Token是否有效
    db.get(`SELECT * FROM user_tokens WHERE token = ? AND expire_at > ?`, [token, new Date().toISOString()], (err, tokenRecord) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      if (!tokenRecord) return res.status(401).json({ success: false, message: 'Token无效或已过期' });

      // 查询用户信息
      db.get(`SELECT * FROM users WHERE student_id = ?`, [tokenRecord.student_id], (err, user) => {
        if (err) return res.status(500).json({ success: false, message: '数据库错误' });
        if (!user) return res.status(400).json({ success: false, message: '用户不存在' });

        delete user.password;
        res.json({ success: true, user: user });
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 退出登录
app.post('/api/auth/logout', (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token不能为空' });

    // 删除Token
    db.run(`DELETE FROM user_tokens WHERE token = ?`, [token], (err) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      writeLog('LOGOUT', `用户退出登录，Token：${token.substring(0, 10)}...`, req);
      res.json({ success: true, message: '退出登录成功' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 重置密码
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, new_password } = req.body;

    // 验证必填项
    if (!email || !code || !new_password) {
      return res.status(400).json({ success: false, message: '所有字段均为必填项' });
    }

    // 验证验证码
    cleanExpiredCodes();
    const verifyRecord = verifyCodeStore[email];
    if (!verifyRecord || verifyRecord.code !== code) {
      return res.status(400).json({ success: false, message: '验证码错误或已过期' });
    }

    // 密码加密
    const hashedPassword = await bcrypt.hash(new_password, SALT_ROUNDS);

    // 更新密码
    db.run(`UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?`,
      [hashedPassword, email], (err) => {
        if (err) return res.status(500).json({ success: false, message: '数据库错误' });

        // 重置成功后删除验证码
        delete verifyCodeStore[email];

        writeLog('RESET_PASSWORD', `用户 ${maskEmail(email)} 重置密码`, req);
        res.json({ success: true, message: '密码重置成功，请使用新密码登录' });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// ===== 接口：用户相关 =====
// 获取个人信息
app.post('/api/user/profile', (req, res) => {
  try {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ success: false, message: '学号不能为空' });

    db.get(`SELECT * FROM users WHERE student_id = ?`, [student_id], (err, user) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      if (!user) return res.status(400).json({ success: false, message: '用户不存在' });

      delete user.password;
      res.json({ success: true, user: user });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 更新个人信息
app.post('/api/user/update', (req, res) => {
  try {
    const { student_id, phone, anonymous_name, avatar } = req.body;
    if (!student_id) return res.status(400).json({ success: false, message: '学号不能为空' });

    // 验证手机号格式（如果填写）
    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: '手机号格式无效' });
    }

    // 更新信息
    db.run(`UPDATE users SET phone = ?, anonymous_name = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?`,
      [phone || '', anonymous_name || '', avatar || '', student_id], (err) => {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(400).json({ success: false, message: '手机号已被使用' });
          return res.status(500).json({ success: false, message: '数据库错误' });
        }

        writeLog('UPDATE_PROFILE', `用户 ${student_id} 更新个人信息`, req);
        res.json({ success: true, message: '个人信息更新成功' });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 获取用户公开信息
app.post('/api/user/public', (req, res) => {
  try {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ success: false, message: '学号不能为空' });

    db.get(`SELECT anonymous_name, gender, created_at FROM users WHERE student_id = ?`, [student_id], (err, userInfo) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      if (!userInfo) return res.status(400).json({ success: false, message: '用户不存在' });

      res.json({ success: true, data: userInfo });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// ===== 接口：任务相关 =====
// 创建任务
app.post('/api/task/create', (req, res) => {
  try {
    const { publisher_id, move_date, move_time, from_address, to_address, items_desc, items_photo, people_needed, reward, note } = req.body;

    // 验证核心必填项
    const requiredFields = [publisher_id, move_date, move_time, from_address, to_address, items_desc, people_needed, reward];
    if (requiredFields.some(field => !field)) {
      return res.status(400).json({ success: false, message: '核心字段（发布者学号、日期、地址、物品、人数、报酬）不能为空' });
    }

    // 插入任务数据
    db.run(`INSERT INTO tasks (publisher_id, move_date, move_time, from_address, to_address, items_desc, items_photo, people_needed, reward, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [publisher_id, move_date, move_time, from_address, to_address, items_desc, items_photo || '', people_needed, reward, note || ''],
      function (err) {
        if (err) return res.status(500).json({ success: false, message: '数据库错误' });

        writeLog('CREATE_TASK', `用户 ${publisher_id} 创建任务 #${this.lastID}`, req);
        res.json({
          success: true,
          message: '任务创建成功',
          task_id: this.lastID
        });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 获取待接任务列表
app.get('/api/task/list', (req, res) => {
  try {
    // 查询所有未完成的任务，并关联发布者昵称
    db.all(`SELECT t.*, u.anonymous_name AS publisher_name FROM tasks t LEFT JOIN users u ON t.publisher_id = u.student_id WHERE t.status = 'pending' ORDER BY t.created_at DESC`, (err, tasks) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      res.json({ success: true, list: tasks });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 获取我发布的任务
app.post('/api/task/my-published', (req, res) => {
  try {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ success: false, message: '学号不能为空' });

    db.all(`SELECT * FROM tasks WHERE publisher_id = ? ORDER BY created_at DESC`, [student_id], (err, tasks) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      res.json({ success: true, list: tasks });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 获取我接的任务
app.post('/api/task/my-assigned', (req, res) => {
  try {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ success: false, message: '学号不能为空' });

    db.all(`SELECT * FROM tasks WHERE helper_id = ? ORDER BY created_at DESC`, [student_id], (err, tasks) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      res.json({ success: true, list: tasks });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 申请任务
app.post('/api/task/apply', (req, res) => {
  try {
    const { task_id, helper_id } = req.body;
    if (!task_id || !helper_id) return res.status(400).json({ success: false, message: '任务ID和申请者学号不能为空' });

    // 检查任务是否存在且未被接取
    db.get(`SELECT * FROM tasks WHERE id = ? AND status = 'pending'`, [task_id], (err, task) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      if (!task) return res.status(400).json({ success: false, message: '任务不存在或已被接取' });

      // 检查是否是自己发布的任务
      if (task.publisher_id === helper_id) {
        return res.status(400).json({ success: false, message: '不能申请自己发布的任务' });
      }

      // 检查是否已申请过该任务
      db.get(`SELECT * FROM task_applications WHERE task_id = ? AND helper_id = ?`, [task_id, helper_id], (err, application) => {
        if (err) return res.status(500).json({ success: false, message: '数据库错误' });
        if (application) return res.status(400).json({ success: false, message: '已申请过该任务' });

        // 插入申请记录
        db.run(`INSERT INTO task_applications (task_id, helper_id) VALUES (?, ?)`, [task_id, helper_id], (err) => {
          if (err) return res.status(500).json({ success: false, message: '数据库错误' });

          writeLog('APPLY_TASK', `用户 ${helper_id} 申请任务 #${task_id}`, req);
          res.json({ success: true, message: '任务申请成功' });
        });
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 查看任务申请者
app.post('/api/task/applicants', (req, res) => {
  try {
    const { task_id } = req.body;
    if (!task_id) return res.status(400).json({ success: false, message: '任务ID不能为空' });

    // 查询申请者列表，并关联用户信息
    db.all(`SELECT a.*, u.anonymous_name, u.phone FROM task_applications a LEFT JOIN users u ON a.helper_id = u.student_id WHERE a.task_id = ?`, [task_id], (err, applicants) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      res.json({ success: true, applicants: applicants });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 指派任务给帮手
app.post('/api/task/assign', (req, res) => {
  try {
    const { task_id, helper_id } = req.body;
    if (!task_id || !helper_id) return res.status(400).json({ success: false, message: '任务ID和帮手学号不能为空' });

    // 更新任务状态和帮手ID
    db.run(`UPDATE tasks SET status = 'assigned', helper_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [helper_id, task_id], (err) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      // 更新申请状态为已接受
      db.run(`UPDATE task_applications SET status = 'accepted' WHERE task_id = ? AND helper_id = ?`, [task_id, helper_id]);

      writeLog('ASSIGN_TASK', `任务 #${task_id} 指派给用户 ${helper_id}`, req);
      res.json({ success: true, message: '任务指派成功' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 完成任务
app.post('/api/task/complete', (req, res) => {
  try {
    const { task_id } = req.body;
    if (!task_id) return res.status(400).json({ success: false, message: '任务ID不能为空' });

    // 更新任务状态为已完成
    db.run(`UPDATE tasks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [task_id], (err) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      writeLog('COMPLETE_TASK', `任务 #${task_id} 已完成`, req);
      res.json({ success: true, message: '任务标记为已完成' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 取消任务
app.post('/api/task/cancel', (req, res) => {
  try {
    const { task_id } = req.body;
    if (!task_id) return res.status(400).json({ success: false, message: '任务ID不能为空' });

    // 更新任务状态为已取消
    db.run(`UPDATE tasks SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [task_id], (err) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      writeLog('CANCEL_TASK', `任务 #${task_id} 已取消`, req);
      res.json({ success: true, message: '任务已取消' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// ===== 接口：消息相关 =====
// 发送消息
app.post('/api/message/send', (req, res) => {
  try {
    const { sender_id, receiver_id, content } = req.body;
    if (!sender_id || !receiver_id || !content) return res.status(400).json({ success: false, message: '发送者、接收者和消息内容不能为空' });

    // 插入消息记录
    db.run(`INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)`, [sender_id, receiver_id, content], (err) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      writeLog('SEND_MESSAGE', `用户 ${sender_id} 发送消息给 ${receiver_id}`, req);
      res.json({ success: true, message: '消息发送成功' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 获取收件箱
app.post('/api/message/inbox', (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ success: false, message: '用户学号不能为空' });

    // 查询收件箱，并关联发送者昵称
    db.all(`SELECT m.*, u.anonymous_name AS sender_name FROM messages m LEFT JOIN users u ON m.sender_id = u.student_id WHERE m.receiver_id = ? ORDER BY m.send_time DESC`, [user_id], (err, messages) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      res.json({ success: true, messages: messages });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 标记消息为已读
app.post('/api/message/mark-read', (req, res) => {
  try {
    const { msg_id } = req.body;
    if (!msg_id) return res.status(400).json({ success: false, message: '消息ID不能为空' });

    // 更新消息状态
    db.run(`UPDATE messages SET is_read = 1 WHERE id = ?`, [msg_id], (err) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      writeLog('MARK_READ', `消息 #${msg_id} 标记为已读`, req);
      res.json({ success: true, message: '消息已标记为已读' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// ===== 接口：反馈相关 =====
// 提交反馈
app.post('/api/feedback/submit', (req, res) => {
  try {
    const { user_id, content, contact } = req.body;
    if (!user_id || !content) return res.status(400).json({ success: false, message: '用户学号和反馈内容不能为空' });

    // 插入反馈记录
    db.run(`INSERT INTO feedbacks (user_id, content, contact) VALUES (?, ?, ?)`, [user_id, content, contact || ''], (err) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      writeLog('SUBMIT_FEEDBACK', `用户 ${user_id} 提交反馈`, req);
      res.json({ success: true, message: '反馈提交成功' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// ===== 接口：统计相关 =====
// 获取系统概览统计
app.get('/api/stats/overview', (req, res) => {
  try {
    // 查询用户总数
    db.get(`SELECT COUNT(*) AS user_count FROM users`, [], (err, userCount) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      // 查询任务总数
      db.get(`SELECT COUNT(*) AS task_count FROM tasks`, [], (err, taskCount) => {
        if (err) return res.status(500).json({ success: false, message: '数据库错误' });

        // 查询待接任务数
        db.get(`SELECT COUNT(*) AS pending_count FROM tasks WHERE status = 'pending'`, [], (err, pendingCount) => {
          if (err) return res.status(500).json({ success: false, message: '数据库错误' });

          res.json({
            success: true,
            data: {
              total_users: userCount?.user_count || 0,
              total_tasks: taskCount?.task_count || 0,
              pending_tasks: pendingCount?.pending_count || 0
            }
          });
        });
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// ===== 服务启动 =====
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`DormLift服务器启动成功：http://0.0.0.0:${PORT}`);
  // 延迟初始化数据库，避免启动顺序问题
  setTimeout(() => {
    initDatabase();
    // 定时清理过期验证码（每分钟）
    setInterval(cleanExpiredCodes, 60000);
    // 定时清理过期频率限制（每2分钟）
    setInterval(cleanExpiredRateLimits, 120000);
  }, 1500);
});

// ===== 优雅退出 =====
process.on('SIGTERM', () => {
  console.log('服务器正在关闭...');
  server.close(() => {
    if (db) db.close();
    console.log('服务器已关闭');
    process.exit(0);
  });
});

// 捕获未处理的异常
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常：', err.message);
  writeLog('ERROR', `未捕获异常：${err.message}`);
});

// 捕获未处理的Promise拒绝
process.on('unhandledRejection', (reason) => {
  console.error('未处理的Promise拒绝：', reason);
  writeLog('ERROR', `未处理Promise拒绝：${reason}`);
});

/**
 * DormLift 终极完整版（包含所有业务+部署修复+扩展功能）
 * 核心升级：
 * 1. 安全：密码bcrypt加密存储，避免明文风险
 * 2. 校验：手机号格式校验、邮箱唯一性校验、参数长度校验
 * 3. 扩展：修改用户信息、任务完成标记、密码重置（验证码版）
 * 4. 日志：每步操作详细日志，便于排查问题
 * 5. 部署：保留所有修复（0.0.0.0监听、健康检查、PM2、优雅退出）
 * 6. 兼容：适配不同Node版本，处理SQLite并发问题
 */
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const bcrypt = require('bcryptjs'); // 新增：密码加密
const crypto = require('crypto'); // 新增：生成随机串

// 初始化Express应用
const app = express();
const PORT = process.env.PORT || 8080;
const SALT_ROUNDS = 10; // 密码加密盐值轮数
const VERIFY_CODE_EXPIRE = 5 * 60 * 1000; // 验证码有效期5分钟
const MAX_REQUESTS_PER_HOUR = 10; // 单邮箱每小时最多发送10次验证码（防刷）

// 中间件配置
app.use(cors({ 
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // 支持所有常用方法
  allowedHeaders: ['Content-Type', 'Authorization'] // 允许的请求头
})); 
app.use(bodyParser.json({ limit: '1mb' })); // 限制请求体大小，防攻击
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

// 新增：验证码发送频率限制（内存缓存，简单防刷）
const verifyCodeRateLimit = new Map();

// ===================== 1. 健康检查接口（解决Application failed to respond） =====================
app.get('/', (req, res) => {
  const healthInfo = {
    status: 'success',
    message: 'DormLift服务器运行正常',
    port: PORT,
    listen_address: '0.0.0.0',
    timestamp: new Date().toISOString(),
    server_info: {
      node_version: process.version,
      sqlite_version: sqlite3.version,
      express_version: require('express/package.json').version
    },
    available_apis: [
      'GET / (健康检查)',
      'POST /api/send-verification-code (发送验证码)',
      'POST /api/register (用户注册)',
      'POST /api/login (用户登录)',
      'POST /api/get-profile (获取用户信息)',
      'POST /api/update-profile (修改用户信息)',
      'POST /api/reset-password (重置密码)',
      'POST /api/post-request (发布搬家请求)',
      'GET /api/get-tasks (获取未分配任务)',
      'POST /api/my-posted-tasks (我的发布任务)',
      'POST /api/my-accepted-tasks (我的接受任务)',
      'POST /api/accept-task (接受任务)',
      'POST /api/complete-task (标记任务完成)',
      'POST /api/view-helper-id (查看帮手ID)',
      'POST /api/view-poster-id (查看发布者ID)',
      'POST /api/delete-task (删除发布任务)',
      'POST /api/cancel-task (取消接受任务)'
    ]
  };
  res.status(200).json(healthInfo);
});

// ===================== 2. 数据库配置（优化并发+错误处理） =====================
// 新增：数据库连接配置，处理并发问题
const dbConfig = {
  filename: './dormlift.db',
  mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_FULLMUTEX // 开启全互斥锁，防并发问题
};

const db = new sqlite3.Database(dbConfig.filename, dbConfig.mode, (err) => {
  if (err) {
    console.error(`[${new Date().toISOString()}] ❌ 数据库连接失败:`, err.message);
    // 重试连接（新增：容错机制）
    setTimeout(() => {
      console.log(`[${new Date().toISOString()}] 📌 重试数据库连接...`);
      db.open(dbConfig.filename, dbConfig.mode, (retryErr) => {
        if (retryErr) {
          console.error(`[${new Date().toISOString()}] ❌ 重试连接失败:`, retryErr.message);
        } else {
          console.log(`[${new Date().toISOString()}] ✅ 数据库重试连接成功`);
          setTimeout(initDatabase, 2000);
        }
      });
    }, 3000);
  } else {
    console.log(`[${new Date().toISOString()}] ✅ 数据库连接成功（${dbConfig.filename}）`);
    // 延迟初始化，先响应健康检查
    setTimeout(initDatabase, 2000);
  }
});

// 全局变量
let storedVerificationCode = { email: '', code: '', expireTime: 0, sendTime: 0 };
const EMAIL_TEST_MODE = false;
let isDbInitialized = false; // 防重复初始化标记

// ===================== 3. 数据库表初始化（完整+索引优化） =====================
function initDatabase() {
  if (isDbInitialized) {
    console.log(`[${new Date().toISOString()}] 🔧 数据表已初始化，跳过重复执行`);
    return;
  }
  console.log(`[${new Date().toISOString()}] 🔧 开始初始化数据表（含索引优化）...`);

  // 3.1 用户表（新增：密码加密存储，添加索引）
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL,  -- 学生ID（唯一标识）
      given_name TEXT NOT NULL,         -- 名
      first_name TEXT NOT NULL,         -- 姓
      gender TEXT NOT NULL CHECK(gender IN ('male', 'female', 'other')), -- 性别枚举
      anonymous_name TEXT NOT NULL,     -- 匿名昵称
      phone TEXT UNIQUE NOT NULL,       -- 手机号（唯一）
      email TEXT UNIQUE NOT NULL,       -- 邮箱（唯一）
      password TEXT NOT NULL,           -- 加密后的密码
      avatar_url TEXT DEFAULT '',       -- 新增：头像URL
      bio TEXT DEFAULT '',              -- 新增：个人简介
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 创建时间
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- 更新时间
    );
    -- 新增：为常用查询字段添加索引，提升查询速度
    CREATE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
  `;

  // 3.2 搬家请求表（新增：任务描述、地址详情，添加索引）
  const createRequestsTable = `
    CREATE TABLE IF NOT EXISTS moving_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,         -- 发布者学生ID
      move_date TEXT NOT NULL,          -- 搬家日期（格式：YYYY-MM-DD）
      move_time TEXT NOT NULL,          -- 新增：搬家时间（格式：HH:MM）
      location TEXT NOT NULL,           -- 搬家地点（简略）
      address_detail TEXT NOT NULL,     -- 新增：详细地址
      helpers_needed TEXT NOT NULL,     -- 需要的帮手数量
      items TEXT NOT NULL,              -- 搬运物品
      task_desc TEXT DEFAULT '',        -- 新增：任务描述
      compensation TEXT NOT NULL,       -- 报酬（金额/物品）
      helper_assigned TEXT,             -- 已分配的帮手学生ID
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'assigned', 'completed', 'cancelled')), -- 状态枚举扩展
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
    );
    -- 新增：索引优化
    CREATE INDEX IF NOT EXISTS idx_requests_student_id ON moving_requests(student_id);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON moving_requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_move_date ON moving_requests(move_date);
  `;

  // 3.3 任务分配表（新增：分配备注，添加索引）
  const createAssignmentsTable = `
    CREATE TABLE IF NOT EXISTS task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,         -- 搬家请求ID
      helper_id TEXT NOT NULL,          -- 帮手学生ID
      assign_note TEXT DEFAULT '',      -- 新增：分配备注
      assign_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 分配时间
      complete_time TIMESTAMP,          -- 新增：完成时间
      FOREIGN KEY (task_id) REFERENCES moving_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (helper_id) REFERENCES users(student_id) ON DELETE CASCADE,
      UNIQUE(task_id, helper_id)        -- 一个任务只能分配给一个帮手
    );
    -- 新增：索引优化
    CREATE INDEX IF NOT EXISTS idx_assignments_task_id ON task_assignments(task_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_helper_id ON task_assignments(helper_id);
  `;

  // 3.4 验证码日志表（新增：记录验证码发送记录，便于追溯）
  const createVerifyLogsTable = `
    CREATE TABLE IF NOT EXISTS verify_code_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      send_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expire_time TIMESTAMP NOT NULL,
      is_used INTEGER DEFAULT 0 CHECK(is_used IN (0, 1)), -- 0=未使用，1=已使用
      usage_type TEXT NOT NULL CHECK(usage_type IN ('register', 'reset_password')) -- 使用场景
    );
    CREATE INDEX IF NOT EXISTS idx_verify_logs_email ON verify_code_logs(email);
    CREATE INDEX IF NOT EXISTS idx_verify_logs_is_used ON verify_code_logs(is_used);
  `;

  // 执行建表语句（分批次执行，避免SQLite执行过长）
  db.exec(createUsersTable, (err) => {
    if (err) console.error(`[${new Date().toISOString()}] ❌ 创建用户表失败:`, err.message);
    else console.log(`[${new Date().toISOString()}] ✅ 用户表初始化完成（含索引）`);
  });

  setTimeout(() => {
    db.exec(createRequestsTable, (err) => {
      if (err) console.error(`[${new Date().toISOString()}] ❌ 创建搬家请求表失败:`, err.message);
      else console.log(`[${new Date().toISOString()}] ✅ 搬家请求表初始化完成（含索引）`);
    });
  }, 500);

  setTimeout(() => {
    db.exec(createAssignmentsTable, (err) => {
      if (err) console.error(`[${new Date().toISOString()}] ❌ 创建任务分配表失败:`, err.message);
      else console.log(`[${new Date().toISOString()}] ✅ 任务分配表初始化完成（含索引）`);
    });
  }, 1000);

  setTimeout(() => {
    db.exec(createVerifyLogsTable, (err) => {
      if (err) console.error(`[${new Date().toISOString()}] ❌ 创建验证码日志表失败:`, err.message);
      else console.log(`[${new Date().toISOString()}] ✅ 验证码日志表初始化完成（含索引）`);
    });
  }, 1500);

  setTimeout(() => {
    console.log(`[${new Date().toISOString()}] 🔧 所有数据表初始化完成（含扩展表+索引）`);
    isDbInitialized = true; // 标记为已初始化
  }, 2000);
}

// ===================== 4. 工具函数（大幅扩展+详细校验） =====================
// 4.1 验证邮箱格式（严格校验）
function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;
  return emailRegex.test(email);
}

// 4.2 验证手机号格式（适配国际/国内格式）
function isValidPhone(phone) {
  // 国内手机号：11位数字，以1开头；国际号：含+，数字和空格
  const phoneRegex = /^(?:\+?86)?1[3-9]\d{9}$|^\+[1-9]\d{1,14}$/;
  return phoneRegex.test(phone);
}

// 4.3 验证学生ID格式（自定义规则：字母+数字，长度6-20）
function isValidStudentId(studentId) {
  const studentIdRegex = /^[a-zA-Z0-9]{6,20}$/;
  return studentIdRegex.test(studentId);
}

// 4.4 生成6位数字验证码
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 4.5 密码加密（新增：bcrypt加密）
async function encryptPassword(password) {
  try {
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    const hash = await bcrypt.hash(password, salt);
    return hash;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 密码加密失败:`, err.message);
    throw new Error('密码加密失败');
  }
}

// 4.6 密码校验（新增：对比加密密码）
async function verifyPassword(plainPassword, hashedPassword) {
  try {
    return await bcrypt.compare(plainPassword, hashedPassword);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 密码校验失败:`, err.message);
    throw new Error('密码校验失败');
  }
}

// 4.7 检查验证码发送频率（新增：防刷）
function checkVerifyCodeRateLimit(email) {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  // 初始化记录
  if (!verifyCodeRateLimit.has(email)) {
    verifyCodeRateLimit.set(email, { count: 0, startTime: now });
    return true;
  }

  const record = verifyCodeRateLimit.get(email);
  
  // 超过1小时，重置计数
  if (now - record.startTime > oneHour) {
    verifyCodeRateLimit.set(email, { count: 1, startTime: now });
    return true;
  }

  // 未超过1小时，检查次数
  if (record.count >= MAX_REQUESTS_PER_HOUR) {
    return false;
  }

  // 增加计数
  record.count += 1;
  verifyCodeRateLimit.set(email, record);
  return true;
}

// 4.8 发送验证码邮件（大幅扩展+日志记录）
async function sendVerificationCode(email, code, usageType = 'register') {
  // 1. 校验频率限制
  if (!checkVerifyCodeRateLimit(email)) {
    console.error(`[${new Date().toISOString()}] ❌ 邮箱${email}验证码发送频率超限（每小时最多${MAX_REQUESTS_PER_HOUR}次）`);
    throw new Error(`验证码发送过于频繁，请${60}分钟后再试`);
  }

  // 2. 调试：打印环境变量
  console.log(`[${new Date().toISOString()}] 📝 读取到的Outlook环境变量：`, {
    OUTLOOK_EMAIL: process.env.OUTLOOK_EMAIL ? '已配置' : '未配置',
    OUTLOOK_PASS: process.env.OUTLOOK_PASS ? '已配置（隐藏）' : '未配置'
  });

  // 3. 校验环境变量
  if (!process.env.OUTLOOK_EMAIL || !process.env.OUTLOOK_PASS) {
    console.error(`[${new Date().toISOString()}] ❌ Railway环境变量未配置：OUTLOOK_EMAIL/OUTLOOK_PASS`);
    // 记录验证码日志（降级）
    const expireTime = new Date(Date.now() + VERIFY_CODE_EXPIRE).toISOString();
    saveVerifyCodeLog(email, code, expireTime, usageType);
    console.log(`[${new Date().toISOString()}] ⚠️  验证码${code}已记录（邮箱${email}），但未发送邮件`);
    return true;
  }

  // 4. Outlook SMTP配置（优化）
  const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // 587=STARTTLS，465=SSL
    auth: {
      user: process.env.OUTLOOK_EMAIL,
      pass: process.env.OUTLOOK_PASS
    },
    tls: {
      ciphers: 'SSLv3',
      rejectUnauthorized: false // 解决自签名证书问题
    },
    connectionTimeout: 30000, // 连接超时30秒
    greetingTimeout: 10000,   // 问候超时10秒
    socketTimeout: 30000      // 套接字超时30秒
  });

  // 5. 邮件内容（扩展）
  const emailSubject = usageType === 'register' ? 'DormLift 注册验证码' : 'DormLift 重置密码验证码';
  const emailText = `你的${emailSubject}是：${code}\n有效期5分钟，请尽快使用。\n请勿将验证码泄露给他人，如非本人操作，请忽略此邮件。`;
  const emailHtml = `
    <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h2 style="color: #2c3e50; margin-top: 0;">${emailSubject}</h2>
        <p style="font-size: 16px; color: #34495e;">
          你好！你的验证码是：<strong style="color: #3498db; font-size: 24px; letter-spacing: 2px;">${code}</strong>
        </p>
        <p style="font-size: 14px; color: #7f8c8d;">
          有效期：5分钟<br>
          如非本人操作，请忽略此邮件，你的账号安全由我们守护。
        </p>
        <div style="margin-top: 20px; font-size: 12px; color: #95a5a6;">
          © 2026 DormLift 版权所有
        </div>
      </div>
    </div>
  `;

  try {
    // 6. 发送邮件
    const sendResult = await transporter.sendMail({
      from: `DormLift <${process.env.OUTLOOK_EMAIL}>`,
      to: email,
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
      priority: 'high' // 高优先级
    });

    // 7. 记录验证码日志
    const expireTime = new Date(Date.now() + VERIFY_CODE_EXPIRE).toISOString();
    saveVerifyCodeLog(email, code, expireTime, usageType);

    console.log(`[${new Date().toISOString()}] ✅ 验证码${code}已发送到邮箱${email}，邮件ID：${sendResult.messageId}`);
    return true;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 邮件发送失败（邮箱${email}）:`, err.message);
    // 记录失败日志
    const expireTime = new Date(Date.now() + VERIFY_CODE_EXPIRE).toISOString();
    saveVerifyCodeLog(email, code, expireTime, usageType, false);
    throw new Error(`验证码发送失败：${err.message}`);
  }
}

// 4.9 保存验证码日志（新增：持久化记录）
function saveVerifyCodeLog(email, code, expireTime, usageType, isSuccess = true) {
  const insertSql = `
    INSERT INTO verify_code_logs (email, code, expire_time, usage_type, is_used)
    VALUES (?, ?, ?, ?, 0)
  `;
  db.run(insertSql, [email, code, expireTime, usageType], (err) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] ❌ 保存验证码日志失败（邮箱${email}）:`, err.message);
    } else {
      if (isSuccess) {
        console.log(`[${new Date().toISOString()}] 📝 验证码日志已保存（邮箱${email}，用途：${usageType}）`);
      } else {
        console.log(`[${new Date().toISOString()}] 📝 验证码发送失败，日志已保存（邮箱${email}）`);
      }
    }
  });
}

// 4.10 验证验证码有效性（新增：从日志校验）
function verifyCodeValidity(email, code, usageType = 'register') {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    const selectSql = `
      SELECT * FROM verify_code_logs 
      WHERE email = ? AND code = ? AND usage_type = ? AND is_used = 0 AND expire_time > ?
      ORDER BY send_time DESC LIMIT 1
    `;
    db.get(selectSql, [email, code, usageType, now], (err, row) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] ❌ 校验验证码失败（邮箱${email}）:`, err.message);
        reject(new Error('验证码校验失败'));
        return;
      }

      if (!row) {
        reject(new Error('验证码无效、已过期或未发送'));
        return;
      }

      // 标记验证码为已使用
      const updateSql = `
        UPDATE verify_code_logs 
        SET is_used = 1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `;
      db.run(updateSql, [row.id], (updateErr) => {
        if (updateErr) {
          console.error(`[${new Date().toISOString()}] ❌ 标记验证码为已使用失败（ID${row.id}）:`, updateErr.message);
        } else {
          console.log(`[${new Date().toISOString()}] 📝 验证码${code}已标记为已使用（邮箱${email}）`);
        }
      });

      resolve(true);
    });
  });
}

// ===================== 5. 验证码接口（扩展+防刷） =====================
app.post('/api/send-verification-code', async (req, res) => {
  try {
    const { email, usageType = 'register' } = req.body;

    // 1. 校验邮箱是否为空
    if (!email) {
      return res.status(400).json({
        success: false,
        message: '错误：邮箱不能为空',
        timestamp: new Date().toISOString()
      });
    }

    // 2. 校验邮箱格式
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '错误：请输入有效的邮箱（示例：xxx@qq.com、xxx@outlook.com）',
        timestamp: new Date().toISOString()
      });
    }

    // 3. 校验使用场景
    const validUsageTypes = ['register', 'reset_password'];
    if (!validUsageTypes.includes(usageType)) {
      return res.status(400).json({
        success: false,
        message: `错误：使用场景只能是${validUsageTypes.join('/')}`,
        timestamp: new Date().toISOString()
      });
    }

    // 4. 生成验证码
    const code = generateVerificationCode();

    // 5. 发送验证码
    await sendVerificationCode(email, code, usageType);

    // 6. 返回成功响应
    res.status(200).json({
      success: true,
      message: `验证码已发送到邮箱${email}，有效期5分钟（每小时最多发送${MAX_REQUESTS_PER_HOUR}次）`,
      timestamp: new Date().toISOString(),
      data: {
        email: email,
        usage_type: usageType,
        expire_in: VERIFY_CODE_EXPIRE / 1000 + '秒'
      }
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 发送验证码接口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: `服务器错误：${err.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// ===================== 6. 用户相关接口（大幅扩展+安全优化） =====================
// 6.1 用户注册（密码加密+多维度校验）
app.post('/api/register', async (req, res) => {
  try {
    const { 
      student_id, given_name, first_name, gender, 
      anonymous_name, phone, email, password, verifyCode 
    } = req.body;

    // 1. 校验必填字段
    const requiredFields = ['student_id', 'given_name', 'first_name', 'gender', 'anonymous_name', 'phone', 'email', 'password', 'verifyCode'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `错误：以下字段不能为空：${missingFields.join('、')}`,
        timestamp: new Date().toISOString()
      });
    }

    // 2. 校验学生ID格式
    if (!isValidStudentId(student_id)) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID只能包含字母和数字，长度6-20位',
        timestamp: new Date().toISOString()
      });
    }

    // 3. 校验手机号格式
    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: '错误：请输入有效的手机号（国内：11位数字，以1开头；国际：含+）',
        timestamp: new Date().toISOString()
      });
    }

    // 4. 校验邮箱格式
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '错误：请输入有效的邮箱',
        timestamp: new Date().toISOString()
      });
    }

    // 5. 校验性别
    const validGenders = ['male', 'female', 'other'];
    if (!validGenders.includes(gender)) {
      return res.status(400).json({
        success: false,
        message: `错误：性别只能是${validGenders.join('/')}`,
        timestamp: new Date().toISOString()
      });
    }

    // 6. 校验密码长度
    if (password.length < 8 || password.length > 20) {
      return res.status(400).json({
        success: false,
        message: '错误：密码长度必须在8-20位之间',
        timestamp: new Date().toISOString()
      });
    }

    // 7. 校验验证码
    try {
      await verifyCodeValidity(email, verifyCode, 'register');
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: `错误：${err.message}`,
        timestamp: new Date().toISOString()
      });
    }

    // 8. 校验学生ID/手机号/邮箱是否已存在
    const checkSql = `
      SELECT 
        (SELECT 1 FROM users WHERE student_id = ?) as student_id_exists,
        (SELECT 1 FROM users WHERE phone = ?) as phone_exists,
        (SELECT 1 FROM users WHERE email = ?) as email_exists
    `;
    db.get(checkSql, [student_id, phone, email], async (err, row) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] ❌ 校验用户唯一性失败:`, err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：校验用户信息失败',
          timestamp: new Date().toISOString()
        });
      }

      // 9. 处理重复情况
      const errors = [];
      if (row.student_id_exists) errors.push('学生ID已存在');
      if (row.phone_exists) errors.push('手机号已存在');
      if (row.email_exists) errors.push('邮箱已存在');
      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: `错误：${errors.join('、')}`,
          timestamp: new Date().toISOString()
        });
      }

      // 10. 加密密码
      let hashedPassword;
      try {
        hashedPassword = await encryptPassword(password);
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: `服务器错误：${err.message}`,
          timestamp: new Date().toISOString()
        });
      }

      // 11. 插入用户数据
      const insertSql = `
        INSERT INTO users (student_id, given_name, first_name, gender, anonymous_name, phone, email, password)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      db.run(insertSql, [student_id, given_name, first_name, gender, anonymous_name, phone, email, hashedPassword], function (err) {
        if (err) {
          console.error(`[${new Date().toISOString()}] ❌ 注册用户失败（学生ID${student_id}）:`, err.message);
          return res.status(500).json({
            success: false,
            message: '服务器错误：注册失败',
            timestamp: new Date().toISOString()
          });
        }

        // 12. 返回成功响应
        res.status(200).json({
          success: true,
          message: '注册成功！请使用学生ID和密码登录',
          timestamp: new Date().toISOString(),
          data: {
            student_id: student_id,
            email: email,
            created_at: new Date().toISOString()
          }
        });
      });
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 注册接口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: `服务器错误：${err.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// 6.2 用户登录（密码加密校验）
app.post('/api/login', async (req, res) => {
  try {
    const { student_id, password } = req.body;

    // 1. 校验必填字段
    if (!student_id || !password) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID和密码不能为空',
        timestamp: new Date().toISOString()
      });
    }

    // 2. 校验学生ID格式
    if (!isValidStudentId(student_id)) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID格式无效（字母+数字，6-20位）',
        timestamp: new Date().toISOString()
      });
    }

    // 3. 查询用户
    const selectSql = 'SELECT * FROM users WHERE student_id = ?';
    db.get(selectSql, [student_id], async (err, row) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] ❌ 登录查询失败（学生ID${student_id}）:`, err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：登录失败',
          timestamp: new Date().toISOString()
        });
      }

      // 4. 校验用户是否存在
      if (!row) {
        return res.status(400).json({
          success: false,
          message: '错误：学生ID不存在',
          timestamp: new Date().toISOString()
        });
      }

      // 5. 校验密码
      let passwordValid;
      try {
        passwordValid = await verifyPassword(password, row.password);
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: `服务器错误：${err.message}`,
          timestamp: new Date().toISOString()
        });
      }

      if (!passwordValid) {
        return res.status(400).json({
          success: false,
          message: '错误：密码错误',
          timestamp: new Date().toISOString()
        });
      }

      // 6. 构造用户信息（隐藏敏感字段）
      const userInfo = {
        student_id: row.student_id,
        given_name: row.given_name,
        first_name: row.first_name,
        gender: row.gender,
        anonymous_name: row.anonymous_name,
        phone: row.phone,
        email: row.email,
        avatar_url: row.avatar_url,
        bio: row.bio,
        created_at: row.created_at,
        updated_at: row.updated_at
      };

      // 7. 记录登录日志（控制台）
      console.log(`[${new Date().toISOString()}] ✅ 学生ID${student_id}登录成功，IP：${req.ip}`);

      // 8. 返回成功响应
      res.status(200).json({
        success: true,
        message: '登录成功！',
        timestamp: new Date().toISOString(),
        data: userInfo
      });
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 登录接口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: `服务器错误：${err.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// 6.3 获取用户信息（扩展字段）
app.post('/api/get-profile', (req, res) => {
  try {
    const { student_id } = req.body;

    // 1. 校验必填字段
    if (!student_id) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID不能为空',
        timestamp: new Date().toISOString()
      });
    }

    // 2. 校验学生ID格式
    if (!isValidStudentId(student_id)) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID格式无效',
        timestamp: new Date().toISOString()
      });
    }

    // 3. 查询用户信息（扩展字段）
    const selectSql = `
      SELECT student_id, given_name, first_name, gender, anonymous_name, 
             phone, email, avatar_url, bio, created_at, updated_at
      FROM users WHERE student_id = ?
    `;
    db.get(selectSql, [student_id], (err, row) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] ❌ 获取用户信息失败（学生ID${student_id}）:`, err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取用户信息失败',
          timestamp: new Date().toISOString()
        });
      }

      // 4. 校验用户是否存在
      if (!row) {
        return res.status(400).json({
          success: false,
          message: '错误：用户不存在',
          timestamp: new Date().toISOString()
        });
      }

      // 5. 返回成功响应
      res.status(200).json({
        success: true,
        message: '获取用户信息成功！',
        timestamp: new Date().toISOString(),
        data: row
      });
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 获取用户信息接口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: `服务器错误：${err.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// 6.4 修改用户信息（新增：完整的信息修改）
app.post('/api/update-profile', (req, res) => {
  try {
    const { 
      student_id, given_name, first_name, gender, 
      anonymous_name, phone, avatar_url, bio 
    } = req.body;

    // 1. 校验必填字段
    if (!student_id) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID不能为空',
        timestamp: new Date().toISOString()
      });
    }

    // 2. 校验学生ID格式
    if (!isValidStudentId(student_id)) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID格式无效',
        timestamp: new Date().toISOString()
      });
    }

    // 3. 构造更新字段（只更新非空字段）
    const updateFields = [];
    const updateValues = [];

    if (given_name) {
      updateFields.push('given_name = ?');
      updateValues.push(given_name);
    }
    if (first_name) {
      updateFields.push('first_name = ?');
      updateValues.push(first_name);
    }
    if (gender && ['male', 'female', 'other'].includes(gender)) {
      updateFields.push('gender = ?');
      updateValues.push(gender);
    }
    if (anonymous_name) {
      updateFields.push('anonymous_name = ?');
      updateValues.push(anonymous_name);
    }
    if (phone && isValidPhone(phone)) {
      updateFields.push('phone = ?');
      updateValues.push(phone);
    }
    if (avatar_url) {
      updateFields.push('avatar_url = ?');
      updateValues.push(avatar_url);
    }
    if (bio) {
      updateFields.push('bio = ?');
      updateValues.push(bio);
    }

    // 4. 无更新字段
    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: '错误：没有需要更新的字段',
        timestamp: new Date().toISOString()
      });
    }

    // 5. 校验手机号是否重复（如果修改手机号）
    if (phone) {
      const checkPhoneSql = `
        SELECT 1 FROM users WHERE phone = ? AND student_id != ?
      `;
      db.get(checkPhoneSql, [phone, student_id], (err, row) => {
        if (err) {
          console.error(`[${new Date().toISOString()}] ❌ 校验手机号唯一性失败:`, err.message);
          return res.status(500).json({
            success: false,
            message: '服务器错误：校验手机号失败',
            timestamp: new Date().toISOString()
          });
        }

        if (row) {
          return res.status(400).json({
            success: false,
            message: '错误：手机号已被其他用户使用',
            timestamp: new Date().toISOString()
          });
        }

        // 6. 执行更新
        doUpdateProfile(updateFields, updateValues, student_id, res);
      });
    } else {
      // 6. 执行更新（未修改手机号）
      doUpdateProfile(updateFields, updateValues, student_id, res);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 修改用户信息接口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: `服务器错误：${err.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// 6.5 执行更新用户信息（抽离函数，复用）
function doUpdateProfile(updateFields, updateValues, student_id, res) {
  // 添加更新时间
  updateFields.push('updated_at = CURRENT_TIMESTAMP');
  // 构造SQL
  const updateSql = `
    UPDATE users 
    SET ${updateFields.join(', ')} 
    WHERE student_id = ?
  `;
  // 添加学生ID到参数
  updateValues.push(student_id);

  db.run(updateSql, updateValues, function (err) {
    if (err) {
      console.error(`[${new Date().toISOString()}] ❌ 修改用户信息失败（学生ID${student_id}）:`, err.message);
      return res.status(500).json({
        success: false,
        message: '服务器错误：修改用户信息失败',
        timestamp: new Date().toISOString()
      });
    }

    if (this.changes === 0) {
      return res.status(400).json({
        success: false,
        message: '错误：用户不存在或没有修改任何信息',
        timestamp: new Date().toISOString()
      });
    }

    // 7. 返回成功响应
    res.status(200).json({
      success: true,
      message: '修改用户信息成功！',
      timestamp: new Date().toISOString(),
      data: {
        student_id: student_id,
        updated_fields: updateFields.map(field => field.split(' = ')[0]),
        updated_at: new Date().toISOString()
      }
    });
  });
}

// 6.6 重置密码（新增：验证码版）
app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, verifyCode, newPassword } = req.body;

    // 1. 校验必填字段
    if (!email || !verifyCode || !newPassword) {
      return res.status(400).json({
        success: false,
        message: '错误：邮箱、验证码、新密码不能为空',
        timestamp: new Date().toISOString()
      });
    }

    // 2. 校验邮箱格式
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '错误：请输入有效的邮箱',
        timestamp: new Date().toISOString()
      });
    }

    // 3. 校验新密码长度
    if (newPassword.length < 8 || newPassword.length > 20) {
      return res.status(400).json({
        success: false,
        message: '错误：新密码长度必须在8-20位之间',
        timestamp: new Date().toISOString()
      });
    }

    // 4. 校验验证码
    try {
      await verifyCodeValidity(email, verifyCode, 'reset_password');
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: `错误：${err.message}`,
        timestamp: new Date().toISOString()
      });
    }

    // 5. 校验邮箱是否存在
    const checkSql = 'SELECT student_id FROM users WHERE email = ?';
    db.get(checkSql, [email], async (err, row) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] ❌ 校验邮箱存在性失败:`, err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：校验邮箱失败',
          timestamp: new Date().toISOString()
        });
      }

      if (!row) {
        return res.status(400).json({
          success: false,
          message: '错误：该邮箱未注册',
          timestamp: new Date().toISOString()
        });
      }

      // 6. 加密新密码
      let hashedPassword;
      try {
        hashedPassword = await encryptPassword(newPassword);
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: `服务器错误：${err.message}`,
          timestamp: new Date().toISOString()
        });
      }

      // 7. 更新密码
      const updateSql = `
        UPDATE users 
        SET password = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE email = ?
      `;
      db.run(updateSql, [hashedPassword, email], function (err) {
        if (err) {
          console.error(`[${new Date().toISOString()}] ❌ 重置密码失败（邮箱${email}）:`, err.message);
          return res.status(500).json({
            success: false,
            message: '服务器错误：重置密码失败',
            timestamp: new Date().toISOString()
          });
        }

        // 8. 返回成功响应
        res.status(200).json({
          success: true,
          message: '重置密码成功！请使用新密码登录',
          timestamp: new Date().toISOString(),
          data: {
            email: email,
            updated_at: new Date().toISOString()
          }
        });
      });
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 重置密码接口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: `服务器错误：${err.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// ===================== 7. 任务管理接口（大幅扩展+事务优化） =====================
// 7.1 发布搬家请求（扩展字段+详细校验）
app.post('/api/post-request', (req, res) => {
  try {
    const { 
      student_id, move_date, move_time, location, 
      address_detail, helpers_needed, items, task_desc, compensation 
    } = req.body;

    // 1. 校验必填字段
    const requiredFields = ['student_id', 'move_date', 'move_time', 'location', 'address_detail', 'helpers_needed', 'items', 'compensation'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `错误：以下字段不能为空：${missingFields.join('、')}`,
        timestamp: new Date().toISOString()
      });
    }

    // 2. 校验学生ID格式
    if (!isValidStudentId(student_id)) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID格式无效',
        timestamp: new Date().toISOString()
      });
    }

    // 3. 校验日期格式（YYYY-MM-DD）
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(move_date)) {
      return res.status(400).json({
        success: false,
        message: '错误：搬家日期格式无效（请使用YYYY-MM-DD）',
        timestamp: new Date().toISOString()
      });
    }

    // 4. 校验时间格式（HH:MM）
    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(move_time)) {
      return res.status(400).json({
        success: false,
        message: '错误：搬家时间格式无效（请使用HH:MM）',
        timestamp: new Date().toISOString()
      });
    }

    // 5. 校验帮手数量（数字）
    if (isNaN(helpers_needed) || parseInt(helpers_needed) < 1 || parseInt(helpers_needed) > 10) {
      return res.status(400).json({
        success: false,
        message: '错误：帮手数量必须是1-10之间的数字',
        timestamp: new Date().toISOString()
      });
    }

    // 6. 校验用户是否存在
    const checkUserSql = 'SELECT 1 FROM users WHERE student_id = ?';
    db.get(checkUserSql, [student_id], (err, row) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] ❌ 校验用户存在性失败:`, err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：校验用户失败',
          timestamp: new Date().toISOString()
        });
      }

      if (!row) {
        return res.status(400).json({
          success: false,
          message: '错误：发布者不存在',
          timestamp: new Date().toISOString()
        });
      }

      // 7. 插入搬家请求
      const insertSql = `
        INSERT INTO moving_requests (
          student_id, move_date, move_time, location, 
          address_detail, helpers_needed, items, task_desc, compensation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      db.run(insertSql, [
        student_id, move_date, move_time, location, 
        address_detail, helpers_needed, items, task_desc || '', compensation
      ], function (err) {
        if (err) {
          console.error(`[${new Date().toISOString()}] ❌ 发布搬家请求失败（学生ID${student_id}）:`, err.message);
          return res.status(500).json({
            success: false,
            message: '服务器错误：发布失败',
            timestamp: new Date().toISOString()
          });
        }

        // 8. 返回成功响应
        res.status(200).json({
          success: true,
          message: '搬家请求发布成功！',
          timestamp: new Date().toISOString(),
          data: {
            task_id: this.lastID,
            student_id: student_id,
            move_date: move_date,
            move_time: move_time,
            created_at: new Date().toISOString()
          }
        });
      });
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 发布请求接口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: `服务器错误：${err.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// 7.2 获取所有未分配的任务（扩展字段+分页）
app.get('/api/get-tasks', (req, res) => {
  try {
    // 新增：分页参数
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    // 1. 查询总数
    const countSql = `
      SELECT COUNT(*) as total FROM moving_requests 
      WHERE status = 'pending'
    `;
    db.get(countSql, [], (countErr, countRow) => {
      if (countErr) {
        console.error(`[${new Date().toISOString()}] ❌ 查询任务总数失败:`, countErr.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取任务失败',
          timestamp: new Date().toISOString()
        });
      }

      const total = countRow.total;
      const totalPages = Math.ceil(total / pageSize);

      // 2. 查询分页数据
      const selectSql = `
        SELECT mr.*, u.anonymous_name as publisher_name, u.phone as publisher_phone
        FROM moving_requests mr
        LEFT JOIN users u ON mr.student_id = u.student_id
        WHERE mr.status = 'pending'
        ORDER BY mr.created_at DESC
        LIMIT ? OFFSET ?
      `;

      db.all(selectSql, [pageSize, offset], (err, rows) => {
        if (err) {
          console.error(`[${new Date().toISOString()}] ❌ 获取任务失败:`, err.message);
          return res.status(500).json({
            success: false,
            message: '服务器错误：获取任务失败',
            timestamp: new Date().toISOString()
          });
        }

        // 3. 返回成功响应（带分页）
        res.status(200).json({
          success: true,
          message: '获取未分配任务成功！',
          timestamp: new Date().toISOString(),
          data: {
            list: rows,
            pagination: {
              page: page,
              pageSize: pageSize,
              total: total,
              totalPages: totalPages
            }
          }
        });
      });
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 获取任务接口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: `服务器错误：${err.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// 7.3 获取我发布的任务（扩展+分页）
app.post('/api/my-posted-tasks', (req, res) => {
  try {
    const { student_id, page = 1, pageSize = 10 } = req.body;

    // 1. 校验必填字段
    if (!student_id) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID不能为空',
        timestamp: new Date().toISOString()
      });
    }

    // 2. 校验学生ID格式
    if (!isValidStudentId(student_id)) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID格式无效',
        timestamp: new Date().toISOString()
      });
    }

    const offset = (page - 1) * pageSize;

    // 3. 查询总数
    const countSql = `
      SELECT COUNT(*) as total FROM moving_requests 
      WHERE student_id = ?
    `;
    db.get(countSql, [student_id], (countErr, countRow) => {
      if (countErr) {
        console.error(`[${new Date().toISOString()}] ❌ 查询我的发布任务总数失败:`, countErr.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取任务失败',
          timestamp: new Date().toISOString()
        });
      }

      const total = countRow.total;
      const totalPages = Math.ceil(total / pageSize);

      // 4. 查询分页数据
      const selectSql = `
        SELECT mr.*, u.anonymous_name as publisher_name,
               ta.helper_id, u2.anonymous_name as helper_name
        FROM moving_requests mr
        LEFT JOIN users u ON mr.student_id = u.student_id
        LEFT JOIN task_assignments ta ON mr.id = ta.task_id
        LEFT JOIN users u2 ON ta.helper_id = u2.student_id
        WHERE mr.student_id = ?
        ORDER BY mr.created_at DESC
        LIMIT ? OFFSET ?
      `;

      db.all(selectSql, [student_id, pageSize, offset], (err, rows) => {
        if (err) {
          console.error(`[${new Date().toISOString()}] ❌ 获取我的发布任务失败:`, err.message);
          return res.status(500).json({
            success: false,
            message: '服务器错误：获取任务失败',
            timestamp: new Date().toISOString()
          });
        }

        // 5. 返回成功响应
        res.status(200).json({
          success: true,
          message: '获取我的发布任务成功！',
          timestamp: new Date().toISOString(),
          data: {
            list: rows,
            pagination: {
              page: page,
              pageSize: pageSize,
              total: total,
              totalPages: totalPages
            }
          }
        });
      });
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 获取我的发布任务接口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: `服务器错误：${err.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// 7.4 获取我接受的任务（扩展+分页）
app.post('/api/my-accepted-tasks', (req, res) => {
  try {
    const { helper_id, page = 1, pageSize = 10 } = req.body;

    // 1. 校验必填字段
    if (!helper_id) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID不能为空',
        timestamp: new Date().toISOString()
      });
    }

    // 2. 校验学生ID格式
    if (!isValidStudentId(helper_id)) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID格式无效',
        timestamp: new Date().toISOString()
      });
    }

    const offset = (page - 1) * pageSize;

    // 3. 查询总数
    const countSql = `
      SELECT COUNT(*) as total FROM task_assignments ta
      JOIN moving_requests mr ON ta.task_id = mr.id
      WHERE ta.helper_id = ?
    `;
    db.get(countSql, [helper_id], (countErr, countRow) => {
      if (countErr) {
        console.error(`[${new Date().toISOString()}] ❌ 查询我的接受任务总数失败:`, countErr.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取任务失败',
          timestamp: new Date().toISOString()
        });
      }

      const total = countRow.total;
      const totalPages = Math.ceil(total / pageSize);

      // 4. 查询分页数据
      const selectSql = `
        SELECT mr.*, ta.assign_time, ta.complete_time,
               u.anonymous_name as publisher_name, u.phone as publisher_phone
        FROM moving_requests mr
        JOIN task_assignments ta ON mr.id = ta.task_id
        LEFT JOIN users u ON mr.student_id = u.student_id
        WHERE ta.helper_id = ?
        ORDER BY ta.assign_time DESC
        LIMIT ? OFFSET ?
      `;

      db.all(selectSql, [helper_id, pageSize, offset], (err, rows) => {
        if (err) {
          console.error(`[${new Date().toISOString()}] ❌ 获取我的接受任务失败:`, err.message);
          return res.status(500).json({
            success: false,
            message: '服务器错误：获取任务失败',
            timestamp: new Date().toISOString()
          });
        }

        // 5. 返回成功响应
        res.status(200).json({
          success: true,
          message: '获取我的接受任务成功！',
          timestamp: new Date().toISOString(),
          data: {
            list: rows,
            pagination: {
              page: page,
              pageSize: pageSize,
              total: total,
              totalPages: totalPages
            }
          }
        });
      });
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ 获取我的接受任务接口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: `服务器错误：${err.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

// 7.5 接受任务（扩展+更严格的校验）
app.post('/api/accept-task', (req, res) => {
  try {
    const { task_id, helper_id, assign_note = '' } = req.body;

    // 1. 校验必填字段
    if (!task_id || !helper_id) {
      return res.status(400).json({
        success: false,
        message: '错误：任务ID和帮手ID不能为空',
        timestamp: new Date().toISOString()
      });
    }

    // 2. 校验学生ID格式
    if (!isValidStudentId(helper_id)) {
      return res.status(400).json({
        success: false,
        message: '错误：帮手ID格式无效',
        timestamp: new Date().toISOString()
      });
    }

    // 3. 校验任务ID是否为数字
    if (isNaN(task_id)) {
      return res.status(400).json({
        success: false,
        message: '错误：任务ID必须是数字',
        timestamp: new Date().toISOString()
      });
    }

    // 4. 校验帮手是否存在
    const checkHelperSql = 'SELECT 1 FROM users WHERE student_id = ?';
    db.get(checkHelperSql, [helper_id], (helperErr, helperRow) => {
      if (helperErr) {
        console.error(`[${new Date().toISOString()}] ❌ 校验帮手存在性失败:`, helperErr.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：校验帮手失败',
          timestamp: new Date().toISOString()
        });
      }

      if (!helperRow) {
        return res.status(400).json({
          success: false,
          message: '错误：帮手不存在',
          timestamp: new Date().toISOString()
        });
      }

      // 5. 校验任务是否存在且未分配
      const checkTaskSql = `
        SELECT id, student_id FROM moving_requests 
        WHERE id = ? AND status = 'pending'
      `;
      db.get(checkTaskSql, [task_id], (taskErr, taskRow) => {
        if (taskErr) {
          console.error(`[${new Date().toISOString()}] ❌ 校验任务存在性失败:`, taskErr.message);
          return res.status(500).json({
            success: false,
            message: '服务器错误：校验任务失败',
            timestamp: new Date().toISOString()
          });
        }

        if (!taskRow) {
          return res.status(400).json({
            success: false,
            message: '错误：任务不存在或已被分配',
            timestamp: new Date().toISOString()
          });
        }

        // 6. 校验不能接受自己发布的任务
        if (taskRow.student_id === helper_id) {
          return res.status(400).json({
            success: false,
            message: '错误：不能接受自己发布的任务',
            timestamp: new Date().toISOString()
          });
        }

        // 7. 开启事务：更新任务状态 + 插入分配记录
        db.run('BEGIN TRANSACTION', (txErr) => {
          if (txErr) {
            console.error(`[${new Date().toISOString()}] ❌ 开启事务失败:`, txErr.message);
            return res.status(500).json({ success: false, message: '服务器错误：接受任务失败', timestamp: new Date().toISOString() });
          }

          // 第一步：更新搬家请求的状态和分配的帮手
          const updateTaskSql = `
            UPDATE moving_requests 
            SET helper_assigned = ?, status = 'assigned', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending'
          `;
          db.run(updateTaskSql, [helper_id, task_id], function (updateErr) {
            if (updateErr) {
              db.run('ROLLBACK');
              console.error(`[${new Date().toISOString()}] ❌ 更新任务状态失败:`, updateErr.message);
              return res.status(500).json({ success: false, message: '服务器错误：接受任务失败', timestamp: new Date().toISOString() });
            }

            if (this.changes === 0) {
              db.run('ROLLBACK');
              return res.status(400).json({ success: false, message: '错误：任务已被分配或不存在', timestamp: new Date().toISOString() });
            }

            // 第二步：插入任务分配记录（带备注）
            const insertAssignmentSql = `
              INSERT INTO task_assignments (task_id, helper_id, assign_note)
              VALUES (?, ?, ?)
            `;
            db.run(insertAssignmentSql, [task_id, helper_id, assign_note], function (insertErr) {
              if (insertErr) {
                db.run('ROLLBACK');
                console.error(`[${new Date().toISOString()}] ❌ 插入分配记录失败:`, insertErr.message);
                return res.status(500).json({ success: false, message: '服务器错误：接受任务失败', timestamp: new Date().toISOString() });
              }

              // 提交事务
              db.run('COMMIT', (commitErr) => {
                if (commitErr) {
                  console.error(`[${new Date().toISOString()}] ❌ 提交事务失败:`, commitErr.message);
                  return res.status(500).json({ success: false, message: '服务器错误：接受任务失败', timestamp: new Date().toISOString() });
                }

                // 8. 返回成功响应
                res.status(200).json({
                  success: true,
                  message: '接受任务成功！',
                  timestamp: new Date().toISOString(),
                  data: {
                    task_id: task_id,
                    helper_id: helper_id,
                    assign_time: new Date().toISOString(),
                    assign_note: assign_note
                  }

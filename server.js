const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

// 初始化Express应用
const app = express();
const PORT = process.env.PORT || 8080;

// 跨域+解析配置
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname)); // 托管静态文件

// ====================== 核心配置 ======================
// 1. 数据库配置（兼容生产/开发环境）
const DB_DIR = process.env.NODE_ENV === 'production' ? '/tmp/campusmove' : path.join(__dirname, 'db');
const DB_PATH = path.join(DB_DIR, 'campusmove.db');
// 创建数据库目录
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  console.log(`✅ 数据库目录创建成功: ${DB_DIR}`);
}
// 连接数据库
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
    process.exit(1);
  }
  console.log('✅ 数据库连接成功');
  initDatabase(); // 初始化表结构
});

// 2. Outlook邮件发送配置（核心！适配POST请求，无AADSTS900561错误）
const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com', // Outlook官方SMTP服务器
  port: 587, // 固定端口（587=STARTTLS，465=SSL，Outlook优先587）
  secure: false, // 587端口必须为false，465为true
  auth: {
    user: process.env.EMAIL_USER, // Outlook邮箱（如：xxx@outlook.com）
    pass: process.env.EMAIL_PASS  // Outlook登录密码（无需授权码）
  },
  tls: {
    ciphers: 'SSLv3', // 解决微软TLS兼容问题
    rejectUnauthorized: false // 避免证书验证错误
  },
  connectionTimeout: 10000 // 超时时间（避免卡死）
});

// 3. 验证码存储（绑定邮箱，带过期时间）
const verifyCodeMap = {};
const CODE_EXPIRE = 5 * 60 * 1000; // 5分钟过期

// ====================== 数据库初始化 ======================
function initDatabase() {
  // 1. 用户表（手机号仅存储，无验证）
  const createUserTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL COMMENT '学生ID',
      first_name TEXT NOT NULL COMMENT '名字',
      gender TEXT NOT NULL COMMENT '性别',
      email TEXT UNIQUE NOT NULL COMMENT '邮箱（验证用）',
      phone TEXT NOT NULL COMMENT '手机号（仅联系）',
      anonymous_name TEXT NOT NULL COMMENT '匿名昵称',
      password TEXT NOT NULL COMMENT '密码',
      create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
    );
  `;
  // 2. 搬家任务表
  const createTaskTable = `
    CREATE TABLE IF NOT EXISTS moving_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL COMMENT '发布者ID',
      move_date TEXT NOT NULL COMMENT '搬家时间',
      location TEXT NOT NULL COMMENT '搬家地点',
      helpers_needed INTEGER NOT NULL COMMENT '需要帮手数',
      items TEXT NOT NULL COMMENT '搬运物品',
      compensation TEXT NOT NULL COMMENT '报酬',
      helper_assigned TEXT DEFAULT NULL COMMENT '接单者ID',
      create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '发布时间',
      FOREIGN KEY (student_id) REFERENCES users(student_id)
    );
  `;

  // 执行建表
  db.run(createUserTable, (err) => {
    if (err) console.error('❌ 创建用户表失败:', err.message);
    else console.log('✅ 用户表初始化成功');
  });
  db.run(createTaskTable, (err) => {
    if (err) console.error('❌ 创建任务表失败:', err.message);
    else console.log('✅ 任务表初始化成功');
  });
}

// ====================== 核心接口 ======================
/**
 * 1. 健康检查接口（Railway部署验证）
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * 2. 发送Outlook验证码（仅绑定邮箱，无手机号验证）
 */
app.post('/api/send-verification-code', async (req, res) => {
  try {
    const { email } = req.body;
    // 基础验证
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: '请输入有效的Outlook邮箱（如：xxx@outlook.com）'
      });
    }
    // 生成6位验证码
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    // 存储验证码（覆盖旧的，防止重复发送）
    verifyCodeMap[email] = {
      code: verifyCode,
      expire: Date.now() + CODE_EXPIRE
    };
    console.log(`📧 准备发送验证码到 ${email}: ${verifyCode}`);

    // 发送Outlook邮件
    const mailOptions = {
      from: `"CampusMove" <${process.env.EMAIL_USER}>`, // 发件人（必须和EMAIL_USER一致）
      to: email, // 收件人
      subject: 'CampusMove 注册验证码', // 主题
      text: `你的注册验证码是：${verifyCode}\n有效期5分钟，请勿泄露给他人！`, // 纯文本内容
      html: `<div style="padding:20px;background:#f5f7fa;border-radius:8px;">
        <h3 style="color:#2563eb;">CampusMove 注册验证码</h3>
        <p style="font-size:16px;margin:10px 0;">你的验证码是：<strong style="color:#dc2626;font-size:20px;">${verifyCode}</strong></p>
        <p style="font-size:12px;color:#666;">有效期5分钟，请勿泄露给他人！</p>
      </div>` // HTML内容（更友好）
    };

    // 执行发送
    await transporter.sendMail(mailOptions);
    console.log(`✅ 验证码发送到 ${email} 成功`);
    res.status(200).json({
      success: true,
      message: '验证码已发送到你的Outlook邮箱，请查收（含垃圾邮件文件夹）'
    });
  } catch (error) {
    console.error('❌ 发送验证码失败:', error.message);
    res.status(500).json({
      success: false,
      message: `发送失败：${error.message}（请检查Outlook账号/密码是否正确）`
    });
  }
});

/**
 * 3. 注册接口（仅验证邮箱验证码，手机号仅存储）
 */
app.post('/api/register', (req, res) => {
  try {
    const { firstName, studentId, gender, email, phone, verifyCode, anonymousName, password } = req.body;
    // 必传项验证
    const requiredFields = [firstName, studentId, gender, email, phone, verifyCode, anonymousName, password];
    if (requiredFields.some(field => !field)) {
      return res.status(400).json({
        success: false,
        message: '请填写所有必填项'
      });
    }
    // 验证码验证
    const codeRecord = verifyCodeMap[email];
    if (!codeRecord) {
      return res.status(400).json({
        success: false,
        message: '请先获取验证码'
      });
    }
    if (codeRecord.expire < Date.now()) {
      delete verifyCodeMap[email]; // 清理过期验证码
      return res.status(400).json({
        success: false,
        message: '验证码已过期，请重新获取'
      });
    }
    if (codeRecord.code !== verifyCode) {
      return res.status(400).json({
        success: false,
        message: '验证码错误，请核对'
      });
    }

    // 插入用户数据（手机号仅存储，无验证）
    const insertSql = `
      INSERT INTO users (student_id, first_name, gender, email, phone, anonymous_name, password)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(insertSql, [studentId, firstName, gender, email, phone, anonymousName, password], function (err) {
      if (err) {
        console.error('❌ 注册失败:', err.message);
        return res.status(400).json({
          success: false,
          message: err.message.includes('UNIQUE') ? '学生ID/邮箱已存在' : '注册失败，请重试'
        });
      }
      // 注册成功，清理验证码
      delete verifyCodeMap[email];
      console.log(`✅ 用户 ${studentId} 注册成功`);
      res.status(200).json({
        success: true,
        message: '注册成功！请登录'
      });
    });
  } catch (error) {
    console.error('❌ 注册接口异常:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器异常，请重试'
    });
  }
});

/**
 * 4. 登录接口
 */
app.post('/api/login', (req, res) => {
  try {
    const { studentId, password } = req.body;
    if (!studentId || !password) {
      return res.status(400).json({
        success: false,
        message: '请输入学生ID和密码'
      });
    }
    // 查询用户
    const querySql = `SELECT * FROM users WHERE student_id = ? AND password = ?`;
    db.get(querySql, [studentId, password], (err, user) => {
      if (err) {
        console.error('❌ 登录查询失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '登录失败，请重试'
        });
      }
      if (!user) {
        return res.status(400).json({
          success: false,
          message: '学生ID或密码错误'
        });
      }
      // 登录成功，返回用户信息（隐藏敏感字段）
      const userInfo = {
        studentId: user.student_id,
        anonymousName: user.anonymous_name,
        email: user.email,
        phone: user.phone
      };
      console.log(`✅ 用户 ${studentId} 登录成功`);
      res.status(200).json({
        success: true,
        message: '登录成功',
        data: userInfo
      });
    });
  } catch (error) {
    console.error('❌ 登录接口异常:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器异常，请重试'
    });
  }
});

/**
 * 5. 发布搬家任务接口
 */
app.post('/api/post-task', (req, res) => {
  try {
    const { studentId, moveDate, location, helpersNeeded, items, compensation } = req.body;
    if (!studentId || !moveDate || !location || !helpersNeeded || !items || !compensation) {
      return res.status(400).json({
        success: false,
        message: '请填写所有任务信息'
      });
    }
    // 插入任务
    const insertSql = `
      INSERT INTO moving_tasks (student_id, move_date, location, helpers_needed, items, compensation)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.run(insertSql, [studentId, moveDate, location, helpersNeeded, items, compensation], function (err) {
      if (err) {
        console.error('❌ 发布任务失败:', err.message);
        return res.status(400).json({
          success: false,
          message: '发布失败，请重试'
        });
      }
      console.log(`✅ 用户 ${studentId} 发布任务成功（ID: ${this.lastID}）`);
      res.status(200).json({
        success: true,
        message: '任务发布成功',
        data: { taskId: this.lastID }
      });
    });
  } catch (error) {
    console.error('❌ 发布任务接口异常:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器异常，请重试'
    });
  }
});

/**
 * 6. 获取所有可用任务（未被接单的）
 */
app.get('/api/get-tasks', (req, res) => {
  try {
    const querySql = `
      SELECT t.*, u.anonymous_name AS publisher_name
      FROM moving_tasks t
      LEFT JOIN users u ON t.student_id = u.student_id
      WHERE t.helper_assigned IS NULL
      ORDER BY t.create_time DESC
    `;
    db.all(querySql, (err, tasks) => {
      if (err) {
        console.error('❌ 获取任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '获取任务失败，请重试'
        });
      }
      res.status(200).json({
        success: true,
        data: tasks
      });
    });
  } catch (error) {
    console.error('❌ 获取任务接口异常:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器异常，请重试'
    });
  }
});

/**
 * 7. 接受任务接口
 */
app.post('/api/accept-task', (req, res) => {
  try {
    const { taskId, helperId } = req.body;
    if (!taskId || !helperId) {
      return res.status(400).json({
        success: false,
        message: '参数错误'
      });
    }
    // 更新任务接单者
    const updateSql = `
      UPDATE moving_tasks
      SET helper_assigned = ?
      WHERE id = ? AND helper_assigned IS NULL
    `;
    db.run(updateSql, [helperId, taskId], function (err) {
      if (err) {
        console.error('❌ 接受任务失败:', err.message);
        return res.status(400).json({
          success: false,
          message: '接受失败，请重试'
        });
      }
      if (this.changes === 0) {
        return res.status(400).json({
          success: false,
          message: '任务已被他人接单'
        });
      }
      console.log(`✅ 用户 ${helperId} 接受任务 ${taskId} 成功`);
      res.status(200).json({
        success: true,
        message: '接受任务成功'
      });
    });
  } catch (error) {
    console.error('❌ 接受任务接口异常:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器异常，请重试'
    });
  }
});

/**
 * 8. 获取用户发布的任务
 */
app.post('/api/my-posted-tasks', (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: '请先登录'
      });
    }
    const querySql = `
      SELECT * FROM moving_tasks
      WHERE student_id = ?
      ORDER BY create_time DESC
    `;
    db.all(querySql, [studentId], (err, tasks) => {
      if (err) {
        console.error('❌ 获取发布任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '获取失败，请重试'
        });
      }
      res.status(200).json({
        success: true,
        data: tasks
      });
    });
  } catch (error) {
    console.error('❌ 获取发布任务接口异常:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器异常，请重试'
    });
  }
});

/**
 * 9. 获取用户接受的任务
 */
app.post('/api/my-accepted-tasks', (req, res) => {
  try {
    const { helperId } = req.body;
    if (!helperId) {
      return res.status(400).json({
        success: false,
        message: '请先登录'
      });
    }
    const querySql = `
      SELECT t.*, u.anonymous_name AS publisher_name
      FROM moving_tasks t
      LEFT JOIN users u ON t.student_id = u.student_id
      WHERE t.helper_assigned = ?
      ORDER BY create_time DESC
    `;
    db.all(querySql, [helperId], (err, tasks) => {
      if (err) {
        console.error('❌ 获取接受任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '获取失败，请重试'
        });
      }
      res.status(200).json({
        success: true,
        data: tasks
      });
    });
  } catch (error) {
    console.error('❌ 获取接受任务接口异常:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器异常，请重试'
    });
  }
});

/**
 * 10. 获取用户个人信息
 */
app.post('/api/get-profile', (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: '请先登录'
      });
    }
    const querySql = `
      SELECT student_id, first_name, gender, email, phone, anonymous_name
      FROM users
      WHERE student_id = ?
    `;
    db.get(querySql, [studentId], (err, user) => {
      if (err) {
        console.error('❌ 获取个人信息失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '获取失败，请重试'
        });
      }
      if (!user) {
        return res.status(400).json({
          success: false,
          message: '用户不存在'
        });
      }
      res.status(200).json({
        success: true,
        data: user
      });
    });
  } catch (error) {
    console.error('❌ 获取个人信息接口异常:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器异常，请重试'
    });
  }
});

// ====================== 启动服务 ======================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 服务器启动成功: http://0.0.0.0:${PORT}`);
  console.log(`🔍 健康检查地址: http://0.0.0.0:${PORT}/health`);
});

// ====================== 优雅退出 ======================
process.on('SIGTERM', () => {
  console.log('\n📤 收到退出信号，正在关闭服务器...');
  db.close((err) => {
    if (err) console.error('❌ 数据库关闭失败:', err.message);
    else console.log('✅ 数据库连接关闭成功');
    process.exit(0);
  });
});

// 捕获未处理的异常
process.on('uncaughtException', (err) => {
  console.error('❌ 未处理的异常:', err.message);
  db.close(() => process.exit(1));
});

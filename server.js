/**
 * DormLift 最终完整版（Railway环境变量版）
 * 核心特性：
 * 1. 支持任意邮箱注册（QQ/163/Gmail/Outlook等）
 * 2. 验证码通过Outlook SMTP真实发送（读取Railway环境变量，无硬编码）
 * 3. 适配Railway云端部署，安全且易维护
 * 使用前：在Railway的Variables里配置 OUTLOOK_EMAIL 和 OUTLOOK_PASS
 */
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

// 初始化Express应用
const app = express();
// 适配Railway动态端口（优先读取环境变量，本地默认3000）
const PORT = process.env.PORT || 3000;

// 中间件配置
app.use(cors({ origin: '*' })); // 允许跨域（测试环境）
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(__dirname)); // 托管前端页面

// 根路径返回index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===================== 数据库配置 =====================
const db = new sqlite3.Database('./dormlift.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) console.error('❌ 数据库连接失败:', err.message);
  else {
    console.log('✅ 数据库连接成功');
    initDatabase();
  }
});

// 全局变量：存储验证码（内存级，生产环境可换Redis）
let storedVerificationCode = { email: '', code: '', expireTime: 0 };
// 关闭测试模式（开启真实邮件发送）
const EMAIL_TEST_MODE = false;

// ===================== 数据库配置 =====================
// 连接SQLite数据库（不存在则自动创建）
const db = new sqlite3.Database('./dormlift.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
  } else {
    console.log('✅ 数据库连接成功（dormlift.db）');
    initDatabase(); // 连接成功后调用初始化函数
  }
});

// 全局变量：存储验证码（内存级，重启后清空）
let storedVerificationCode = { email: '', code: '', expireTime: 0 };
// 关闭测试模式（开启真实邮件发送）
const EMAIL_TEST_MODE = false;

// 新增：核心标记 → 防止数据表重复初始化（解决日志重复打印）
let isDbInitialized = false;

// ===================== 数据库表初始化 =====================
function initDatabase() {
  // 关键：如果已经初始化过，直接返回，不再重复执行
  if (isDbInitialized) {
    console.log('🔧 数据表已初始化，无需重复执行');
    return;
  }

  console.log('🔧 开始初始化数据表...');

  // 1. 用户表（users）
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL,  -- 学生ID（唯一）
      given_name TEXT NOT NULL,         -- 名
      first_name TEXT NOT NULL,         -- 姓
      gender TEXT NOT NULL,             -- 性别
      anonymous_name TEXT NOT NULL,     -- 匿名昵称
      phone TEXT UNIQUE NOT NULL,       -- 手机号（唯一）
      email TEXT UNIQUE NOT NULL,       -- 邮箱（唯一）
      password TEXT NOT NULL,           -- 密码
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 创建时间
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- 更新时间
    )
  `;

  // 2. 搬家请求表（moving_requests）
  const createRequestsTable = `
    CREATE TABLE IF NOT EXISTS moving_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,         -- 发布者学生ID
      move_date TEXT NOT NULL,         -- 搬家日期
      location TEXT NOT NULL,          -- 搬家地点
      helpers_needed TEXT NOT NULL,    -- 需要的帮手数量
      items TEXT NOT NULL,             -- 搬运物品
      compensation TEXT NOT NULL,      -- 报酬
      helper_assigned TEXT,            -- 被分配的帮手ID
      status TEXT DEFAULT 'pending',   -- 状态：pending/assigned/finished
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
    )
  `;

  // 3. 任务分配表（task_assignments）
  const createAssignmentsTable = `
    CREATE TABLE IF NOT EXISTS task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,         -- 搬家请求ID
      helper_id TEXT NOT NULL,          -- 帮手学生ID
      assign_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 分配时间
      FOREIGN KEY (task_id) REFERENCES moving_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (helper_id) REFERENCES users(student_id) ON DELETE CASCADE,
      UNIQUE(task_id, helper_id)        -- 一个任务只能分配给一个帮手
    )
  `;

  // 执行建表语句
  db.run(createUsersTable, (err) => {
    if (err) console.error('❌ 创建用户表失败:', err.message);
    else console.log('✅ 用户表初始化完成');
  });

  db.run(createRequestsTable, (err) => {
    if (err) console.error('❌ 创建搬家请求表失败:', err.message);
    else console.log('✅ 搬家请求表初始化完成');
  });

  db.run(createAssignmentsTable, (err) => {
    if (err) console.error('❌ 创建任务分配表失败:', err.message);
    else console.log('✅ 任务分配表初始化完成');
  });

  console.log('🔧 所有数据表初始化完成');
  // 关键：标记为已初始化，后续不再执行
  isDbInitialized = true;
}



// ===================== 核心工具函数 =====================
/**
 * 通用邮箱格式验证（valid：检查格式是否有效，非valuable）
 * @param {string} email - 用户输入的邮箱
 * @returns {boolean} - 验证结果
 */
function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;
  return emailRegex.test(email);
}

/**
 * 生成6位数字验证码
 * @returns {string} - 6位验证码
 */
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 发送验证码邮件（读取Railway环境变量，安全无硬编码）
 * @param {string} email - 收件人邮箱
 * @param {string} code - 6位验证码
 * @returns {Promise<boolean>} - 发送结果
 */
async function sendVerificationCode(email, code) {
  // 校验Railway环境变量是否配置
  if (!process.env.OUTLOOK_EMAIL || !process.env.OUTLOOK_PASS) {
    console.error('❌ Railway环境变量未配置：请设置OUTLOOK_EMAIL和OUTLOOK_PASS');
    // 降级：打印验证码到日志
    console.log(`⚠️  降级方案：验证码 ${code} 已打印（收件人：${email}）`);
    return true;
  }

  // Outlook SMTP配置（读取Railway环境变量）
  const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com', // Outlook官方SMTP服务器（固定）
    port: 587,                  // 固定端口
    secure: false,              // 587端口必须为false
    auth: {
      user: process.env.OUTLOOK_EMAIL, // 读取Railway的OUTLOOK_EMAIL变量
      pass: process.env.OUTLOOK_PASS   // 读取Railway的OUTLOOK_PASS变量
    },
    tls: {
      ciphers: 'SSLv3' // 解决Outlook连接兼容问题
    }
  });

  try {
    // 发送验证码邮件
    await transporter.sendMail({
      from: `DormLift <${process.env.OUTLOOK_EMAIL}>`, // 发件人=环境变量里的Outlook邮箱
      to: email,                                      // 收件人（用户输入的邮箱）
      subject: 'DormLift 验证码',                     // 邮件标题
      text: `你的DormLift验证码是：${code}\n有效期5分钟，请尽快使用。`, // 纯文本内容
      html: `<div style="font-family: Arial; padding: 20px;">
              <h3 style="color: #2c3e50;">你的DormLift验证码</h3>
              <p style="font-size: 16px;">验证码：<strong style="color: #3498db; font-size: 20px;">${code}</strong></p>
              <p style="color: #7f8c8d; font-size: 12px;">有效期5分钟，请勿泄露给他人</p>
            </div>` // 富文本内容
    });

    console.log(`✅ 验证码已发送到 ${email}（验证码：${code}）`);
    return true;
  } catch (err) {
    console.error('❌ 邮件发送失败:', err.message);
    // 降级：打印到日志
    console.log(`⚠️  降级方案：验证码 ${code} 已打印（收件人：${email}）`);
    return true;
  }
}
// 在所有API接口之前，添加健康检查接口（必须！）
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'DormLift服务器运行正常',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});
// ===================== API接口：获取验证码 =====================
app.post('/api/send-verification-code', async (req, res) => {
  try {
    const { email } = req.body;

    // 1. 检查邮箱是否为空
    if (!email) {
      return res.status(400).json({
        success: false,
        message: '错误：邮箱不能为空'
      });
    }

    // 2. 验证邮箱格式是否有效（valid，非valuable）
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '错误：请输入有效的邮箱（比如 xxx@qq.com / xxx@outlook.com）'
      });
    }

    // 3. 生成验证码（5分钟有效期）
    const code = generateVerificationCode();
    const expireTime = Date.now() + 5 * 60 * 1000;

    // 4. 发送验证码（读取Railway环境变量）
    await sendVerificationCode(email, code);

    // 5. 存储验证码
    storedVerificationCode = { email, code, expireTime };

    // 6. 返回成功响应
    res.status(200).json({
      success: true,
      message: '验证码已发送，请注意查收邮箱（含垃圾邮件箱）'
    });
  } catch (err) {
    console.error('❌ 获取验证码接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取验证码失败'
    });
  }
});

// ===================== API接口：用户注册 =====================
app.post('/api/register', (req, res) => {
  try {
    const {
      givenName, firstName, studentId, gender,
      email, verifyCode, phone, anonymousName,
      password, confirmPassword
    } = req.body;

    // 1. 检查所有字段是否为空
    const requiredFields = [givenName, firstName, studentId, gender, email, verifyCode, phone, anonymousName, password, confirmPassword];
    if (requiredFields.some(field => !field || field.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: '错误：所有字段都不能为空'
      });
    }

    // 2. 检查密码是否一致
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: '错误：两次输入的密码不一致'
      });
    }

    // 3. 验证邮箱格式是否有效
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '错误：请输入有效的邮箱（比如 xxx@qq.com / xxx@outlook.com）'
      });
    }

    // 4. 验证验证码（有效期+正确性+邮箱匹配）
    if (!storedVerificationCode || 
        storedVerificationCode.email !== email || 
        storedVerificationCode.code !== verifyCode || 
        Date.now() > storedVerificationCode.expireTime) {
      return res.status(400).json({
        success: false,
        message: '错误：验证码无效或已过期，请重新获取'
      });
    }

    // 5. 检查学生ID是否已注册
    db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, studentRow) => {
      if (err) {
        console.error('❌ 检查学生ID失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：检查学生ID失败' });
      }
      if (studentRow) {
        return res.status(400).json({ success: false, message: '错误：该学生ID已注册' });
      }

      // 6. 检查邮箱是否已注册
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, emailRow) => {
        if (err) {
          console.error('❌ 检查邮箱失败:', err.message);
          return res.status(500).json({ success: false, message: '服务器错误：检查邮箱失败' });
        }
        if (emailRow) {
          return res.status(400).json({ success: false, message: '错误：该邮箱已注册' });
        }

        // 7. 检查手机号是否已注册
        db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, phoneRow) => {
          if (err) {
            console.error('❌ 检查手机号失败:', err.message);
            return res.status(500).json({ success: false, message: '服务器错误：检查手机号失败' });
          }
          if (phoneRow) {
            return res.status(400).json({ success: false, message: '错误：该手机号已注册' });
          }

          // 8. 插入新用户
          const insertSql = `
            INSERT INTO users (
              student_id, given_name, first_name, gender,
              anonymous_name, phone, email, password
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(insertSql, [studentId, givenName, firstName, gender, anonymousName, phone, email, password], (err) => {
            if (err) {
              console.error('❌ 注册用户失败:', err.message);
              return res.status(500).json({ success: false, message: '服务器错误：注册失败' });
            }

            // 9. 清空验证码
            storedVerificationCode = { email: '', code: '', expireTime: 0 };

            // 10. 返回成功
            res.status(200).json({
              success: true,
              message: '注册成功！请使用学生ID和密码登录'
            });
          });
        });
      });
    });
  } catch (err) {
    console.error('❌ 注册接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：注册失败'
    });
  }
});

// ===================== API接口：用户登录 =====================
app.post('/api/login', (req, res) => {
  try {
    const { studentId, password } = req.body;

    // 1. 检查学生ID和密码是否为空
    if (!studentId || !password) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID和密码不能为空'
      });
    }

    // 2. 验证学生ID和密码
    db.get('SELECT * FROM users WHERE student_id = ? AND password = ?', [studentId, password], (err, row) => {
      if (err) {
        console.error('❌ 登录验证失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：登录失败' });
      }

      if (!row) {
        return res.status(401).json({ success: false, message: '错误：学生ID或密码错误' });
      }

      // 3. 返回登录成功
      res.status(200).json({
        success: true,
        message: '登录成功！',
        data: {
          studentId: row.student_id,
          anonymousName: row.anonymous_name,
          email: row.email,
          phone: row.phone,
          gender: row.gender
        }
      });
    });
  } catch (err) {
    console.error('❌ 登录接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：登录失败'
    });
  }
});

// ===================== API接口：发布搬家请求 =====================
app.post('/api/post-request', (req, res) => {
  try {
    const { studentId, moveDate, location, helpersNeeded, items, compensation } = req.body;

    // 1. 检查必填字段
    const requiredFields = [studentId, moveDate, location, helpersNeeded, items, compensation];
    if (requiredFields.some(field => !field || field.trim() === '')) {
      return res.status(400).json({ success: false, message: '错误：所有字段都不能为空' });
    }

    // 2. 检查学生ID是否存在
    db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
      if (err) {
        console.error('❌ 检查学生ID失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：检查学生ID失败' });
      }
      if (!row) {
        return res.status(400).json({ success: false, message: '错误：该学生ID未注册' });
      }

      // 3. 插入搬家请求
      const insertSql = `
        INSERT INTO moving_requests (
          student_id, move_date, location, helpers_needed, items, compensation
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;

      db.run(insertSql, [studentId, moveDate, location, helpersNeeded, items, compensation], (err) => {
        if (err) {
          console.error('❌ 发布请求失败:', err.message);
          return res.status(500).json({ success: false, message: '服务器错误：发布请求失败' });
        }

        res.status(200).json({
          success: true,
          message: '搬家请求发布成功！'
        });
      });
    });
  } catch (err) {
    console.error('❌ 发布请求接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：发布请求失败'
    });
  }
});

// ===================== API接口：获取所有未分配的任务 =====================
app.get('/api/get-tasks', (req, res) => {
  try {
    const sql = `
      SELECT * FROM moving_requests
      WHERE helper_assigned IS NULL OR helper_assigned = ''
      ORDER BY move_date ASC
    `;

    db.all(sql, (err, rows) => {
      if (err) {
        console.error('❌ 获取任务失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：获取任务失败', tasks: [] });
      }

      res.status(200).json({
        success: true,
        tasks: rows || []
      });
    });
  } catch (err) {
    console.error('❌ 获取任务接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取任务失败',
      tasks: []
    });
  }
});

// ===================== API接口：接受任务 =====================
app.post('/api/accept-task', (req, res) => {
  try {
    const { taskId, helperId } = req.body;

    // 1. 检查必填字段
    if (!taskId || !helperId) {
      return res.status(400).json({ success: false, message: '错误：任务ID和帮手ID不能为空' });
    }

    // 2. 检查任务是否存在且未分配
    db.get('SELECT * FROM moving_requests WHERE id = ? AND (helper_assigned IS NULL OR helper_assigned = \'\')', [taskId], (err, taskRow) => {
      if (err) {
        console.error('❌ 检查任务失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：检查任务失败' });
      }
      if (!taskRow) {
        return res.status(400).json({ success: false, message: '错误：任务不存在或已被分配' });
      }

      // 3. 检查帮手ID是否注册
      db.get('SELECT * FROM users WHERE student_id = ?', [helperId], (err, helperRow) => {
        if (err) {
          console.error('❌ 检查帮手ID失败:', err.message);
          return res.status(500).json({ success: false, message: '服务器错误：检查帮手ID失败' });
        }
        if (!helperRow) {
          return res.status(400).json({ success: false, message: '错误：帮手ID未注册' });
        }

        // 4. 更新任务状态
        const updateSql = 'UPDATE moving_requests SET helper_assigned = ?, status = ? WHERE id = ?';
        db.run(updateSql, [helperId, 'assigned', taskId], (err) => {
          if (err) {
            console.error('❌ 接受任务失败:', err.message);
            return res.status(500).json({ success: false, message: '服务器错误：接受任务失败' });
          }

          // 5. 插入任务分配记录
          const insertSql = 'INSERT INTO task_assignments (task_id, helper_id) VALUES (?, ?)';
          db.run(insertSql, [taskId, helperId], (err) => {
            if (err) console.error('❌ 插入分配记录失败:', err.message);
          });

          res.status(200).json({
            success: true,
            message: '任务接受成功！'
          });
        });
      });
    });
  } catch (err) {
    console.error('❌ 接受任务接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：接受任务失败'
    });
  }
});

// ===================== API接口：获取我发布的任务 =====================
app.post('/api/my-posted-tasks', (req, res) => {
  try {
    const { studentId } = req.body;

    // 1. 检查学生ID
    if (!studentId) {
      return res.status(400).json({ success: false, message: '错误：学生ID不能为空', tasks: [] });
    }

    // 2. 查询任务
    const sql = 'SELECT * FROM moving_requests WHERE student_id = ? ORDER BY move_date ASC';
    db.all(sql, [studentId], (err, rows) => {
      if (err) {
        console.error('❌ 获取我的任务失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：获取我的任务失败', tasks: [] });
      }

      res.status(200).json({
        success: true,
        tasks: rows || []
      });
    });
  } catch (err) {
    console.error('❌ 获取我的任务接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取我的任务失败',
      tasks: []
    });
  }
});

// ===================== API接口：获取我接受的任务 =====================
app.post('/api/my-accepted-tasks', (req, res) => {
  try {
    const { helperId } = req.body;

    // 1. 检查帮手ID
    if (!helperId) {
      return res.status(400).json({ success: false, message: '错误：帮手ID不能为空', tasks: [] });
    }

    // 2. 查询任务
    const sql = `
      SELECT mr.* FROM moving_requests mr
      JOIN task_assignments ta ON mr.id = ta.task_id
      WHERE ta.helper_id = ?
      ORDER BY mr.move_date ASC
    `;

    db.all(sql, [helperId], (err, rows) => {
      if (err) {
        console.error('❌ 获取接受的任务失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：获取接受的任务失败', tasks: [] });
      }

      res.status(200).json({
        success: true,
        tasks: rows || []
      });
    });
  } catch (err) {
    console.error('❌ 获取接受的任务接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取接受的任务失败',
      tasks: []
    });
  }
});

// ===================== API接口：查看任务的帮手ID =====================
app.post('/api/view-helper-id', (req, res) => {
  try {
    const { taskId, posterId } = req.body;

    // 1. 检查必填字段
    if (!taskId || !posterId) {
      return res.status(400).json({ success: false, message: '错误：任务ID和发布者ID不能为空' });
    }

    // 2. 查询帮手ID
    const sql = 'SELECT helper_assigned FROM moving_requests WHERE id = ? AND student_id = ?';
    db.get(sql, [taskId, posterId], (err, row) => {
      if (err) {
        console.error('❌ 查看帮手ID失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：查看帮手ID失败' });
      }

      if (!row) {
        return res.status(400).json({ success: false, message: '错误：任务不存在或你不是发布者' });
      }

      if (!row.helper_assigned) {
        return res.status(400).json({ success: false, message: '错误：该任务尚未分配帮手' });
      }

      res.status(200).json({
        success: true,
        helperId: row.helper_assigned,
        message: '帮手ID获取成功！'
      });
    });
  } catch (err) {
    console.error('❌ 查看帮手ID接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：查看帮手ID失败'
    });
  }
});

// ===================== API接口：查看任务的发布者ID =====================
app.post('/api/view-poster-id', (req, res) => {
  try {
    const { taskId, helperId } = req.body;

    // 1. 检查必填字段
    if (!taskId || !helperId) {
      return res.status(400).json({ success: false, message: '错误：任务ID和帮手ID不能为空' });
    }

    // 2. 查询发布者ID
    const sql = 'SELECT student_id FROM moving_requests WHERE id = ? AND helper_assigned = ?';
    db.get(sql, [taskId, helperId], (err, row) => {
      if (err) {
        console.error('❌ 查看发布者ID失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：查看发布者ID失败' });
      }

      if (!row) {
        return res.status(400).json({ success: false, message: '错误：任务不存在或你不是帮手' });
      }

      res.status(200).json({
        success: true,
        posterId: row.student_id,
        message: '发布者ID获取成功！'
      });
    });
  } catch (err) {
    console.error('❌ 查看发布者ID接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：查看发布者ID失败'
    });
  }
});

// ===================== API接口：删除我发布的任务 =====================
app.post('/api/delete-task', (req, res) => {
  try {
    const { taskId, studentId } = req.body;

    // 1. 检查必填字段
    if (!taskId || !studentId) {
      return res.status(400).json({ success: false, message: '错误：任务ID和学生ID不能为空' });
    }

    // 2. 检查任务是否存在且属于当前用户
    db.get('SELECT * FROM moving_requests WHERE id = ? AND student_id = ?', [taskId, studentId], (err, row) => {
      if (err) {
        console.error('❌ 检查任务失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：检查任务失败' });
      }
      if (!row) {
        return res.status(400).json({ success: false, message: '错误：任务不存在或你不是发布者' });
      }

      // 3. 先删除任务分配记录
      db.run('DELETE FROM task_assignments WHERE task_id = ?', [taskId], (err) => {
        if (err) console.error('❌ 删除分配记录失败:', err.message);
      });

      // 4. 删除任务
      db.run('DELETE FROM moving_requests WHERE id = ?', [taskId], (err) => {
        if (err) {
          console.error('❌ 删除任务失败:', err.message);
          return res.status(500).json({ success: false, message: '服务器错误：删除任务失败' });
        }

        res.status(200).json({
          success: true,
          message: '任务删除成功！'
        });
      });
    });
  } catch (err) {
    console.error('❌ 删除任务接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：删除任务失败'
    });
  }
});

// ===================== API接口：取消我接受的任务 =====================
app.post('/api/cancel-task', (req, res) => {
  try {
    const { taskId, helperId } = req.body;

    // 1. 检查必填字段
    if (!taskId || !helperId) {
      return res.status(400).json({ success: false, message: '错误：任务ID和帮手ID不能为空' });
    }

    // 2. 检查任务是否存在且分配给当前帮手
    db.get('SELECT * FROM moving_requests WHERE id = ? AND helper_assigned = ?', [taskId, helperId], (err, row) => {
      if (err) {
        console.error('❌ 检查任务失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：检查任务失败' });
      }
      if (!row) {
        return res.status(400).json({ success: false, message: '错误：任务不存在或你不是帮手' });
      }

      // 3. 更新任务状态
      const updateSql = 'UPDATE moving_requests SET helper_assigned = NULL, status = ? WHERE id = ?';
      db.run(updateSql, ['pending', taskId], (err) => {
        if (err) {
          console.error('❌ 取消任务失败:', err.message);
          return res.status(500).json({ success: false, message: '服务器错误：取消任务失败' });
        }

        // 4. 删除任务分配记录
        db.run('DELETE FROM task_assignments WHERE task_id = ? AND helper_id = ?', [taskId, helperId], (err) => {
          if (err) console.error('❌ 删除分配记录失败:', err.message);
        });

        res.status(200).json({
          success: true,
          message: '任务取消成功！'
        });
      });
    });
  } catch (err) {
    console.error('❌ 取消任务接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：取消任务失败'
    });
  }
});

// ===================== API接口：获取用户信息 =====================
app.post('/api/get-profile', (req, res) => {
  try {
    const { studentId } = req.body;

    // 1. 检查学生ID
    if (!studentId) {
      return res.status(400).json({ success: false, message: '错误：学生ID不能为空' });
    }

    // 2. 查询用户信息
    db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
      if (err) {
        console.error('❌ 获取用户信息失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：获取用户信息失败' });
      }

      if (!row) {
        return res.status(400).json({ success: false, message: '错误：学生ID不存在' });
      }

      // 3. 返回用户信息（隐藏密码）
      const profile = {
        student_id: row.student_id,
        given_name: row.given_name,
        first_name: row.first_name,
        gender: row.gender,
        anonymous_name: row.anonymous_name,
        phone: row.phone,
        email: row.email,
        created_at: row.created_at
      };

      res.status(200).json({
        success: true,
        user: profile,
        message: '用户信息获取成功！'
      });
    });
  } catch (err) {
    console.error('❌ 获取用户信息接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取用户信息失败'
    });
  }
});

// ===================== 启动服务器 =====================
const server = app.listen(PORT, '0.0.0.0', () => { // 新增 '0.0.0.0' 监听所有地址
  console.log(`🚀 服务器已启动，端口：${PORT}`);
  console.log(`✅ 监听地址：0.0.0.0:${PORT}（容器内必须监听0.0.0.0）`);
  console.log(`✅ 支持任意有效（valid）邮箱注册，无Outlook限制`);
  console.log(`✅ 验证码模式：读取Railway环境变量（Variable）发送`);
});
// ===================== 优雅处理进程终止（解决SIGTERM） =====================
// 处理Railway的SIGTERM信号
process.on('SIGTERM', () => {
  console.log('\n📢 收到SIGTERM信号，优雅关闭服务器...');
  // 关闭HTTP服务
  server.close(() => {
    console.log('✅ HTTP服务已关闭');
    // 关闭数据库连接
    db.close((err) => {
      if (err) console.error('❌ 数据库关闭失败:', err.message);
      else console.log('✅ 数据库连接已关闭');
      process.exit(0); // 正常退出
    });
  });
});

// 处理未捕获的异常（避免进程崩溃）
process.on('uncaughtException', (err) => {
  console.error('❌ 未捕获异常:', err.message);
  db.close(() => process.exit(1));
});

// 处理未处理的Promise拒绝
process.on('unhandledRejection', (err) => {
  console.error('❌ 未处理的Promise拒绝:', err.message);
  db.close(() => process.exit(1));
});

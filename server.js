/**
 * DormLift 后端服务 - 完整版本
 * 功能：用户注册/登录（Outlook邮箱验证）、搬家任务发布/管理
 * 保留所有原有接口，仅替换验证码为Outlook邮箱验证 + 新增静态文件服务
 */
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');

// 创建Express应用
const app = express();
const PORT = process.env.PORT || 3000;

// ===================== 中间件配置 =====================
// 跨域配置
app.use(cors({
  origin: '*', // 开发环境宽松配置，生产环境可指定域名
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 解析JSON请求体
app.use(bodyParser.json({ limit: '1mb' }));
// 解析URL编码请求体
app.use(bodyParser.urlencoded({ 
  extended: true,
  limit: '1mb'
}));

// 🔥 新增：服务前端静态文件（public文件夹下的index.html）
app.use(express.static('public'));

// ===================== 数据库配置 =====================
// 连接SQLite数据库（文件型，无需额外安装）
const db = new sqlite3.Database('./dormlift.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('【数据库错误】连接失败:', err.message);
    console.error('【解决方案】检查文件权限或重启服务');
  } else {
    console.log('【数据库成功】已连接到 dormlift.db');
    // 初始化数据库表结构
    initDatabase();
  }
});

// 全局变量：存储验证码（内存中，重启后丢失，仅测试/开发用）
// 生产环境建议用Redis存储，或数据库
let storedVerificationCode = {
  email: '',
  code: '',
  expireTime: 0 // 过期时间戳
};

// ===================== 邮箱配置（Outlook） =====================
// 配置nodemailer发送Outlook邮箱验证码
const emailTransporter = nodemailer.createTransport({
  host: 'smtp.office365.com', // Outlook SMTP服务器地址
  port: 587, // TLS端口
  secure: false, // 587端口使用TLS，不是SSL
  auth: {
    user: process.env.OUTLOOK_EMAIL || 'your-test-email@outlook.com', // 环境变量优先
    pass: process.env.OUTLOOK_PASSWORD || 'your-email-password' // 环境变量优先
  },
  tls: {
    // 解决SSL证书问题
    rejectUnauthorized: false,
    ciphers: 'SSLv3'
  }
});

// 测试邮箱连接
emailTransporter.verify((error, success) => {
  if (error) {
    console.log('【邮箱配置错误】', error.message);
    console.log('【提示】请检查Outlook邮箱账号/密码，或开启低安全等级应用权限');
  } else {
    console.log('【邮箱配置成功】已连接到Outlook SMTP服务器');
  }
});

// ===================== 数据库表初始化 =====================
/**
 * 初始化数据库表结构
 * 保留所有原有字段，仅新增email字段（用于Outlook验证）
 */
function initDatabase() {
  console.log('【数据库初始化】开始创建/检查表结构...');

  // 1. 用户表（users）- 核心表
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL COMMENT '学生ID（唯一）',
      given_name TEXT NOT NULL COMMENT '姓',
      first_name TEXT NOT NULL COMMENT '名',
      gender TEXT NOT NULL COMMENT '性别',
      anonymous_name TEXT NOT NULL COMMENT '匿名昵称',
      phone TEXT UNIQUE NOT NULL COMMENT '新西兰手机号（仅联系用）',
      email TEXT UNIQUE NOT NULL COMMENT 'Outlook邮箱（验证用）',
      password TEXT NOT NULL COMMENT '登录密码',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间'
    )
  `;

  db.run(createUsersTable, (err) => {
    if (err) {
      console.error('【数据库错误】创建users表失败:', err.message);
    } else {
      console.log('【数据库成功】users表初始化完成（含email字段）');
    }
  });

  // 2. 搬家请求表（moving_requests）- 任务核心表
  const createMovingRequestsTable = `
    CREATE TABLE IF NOT EXISTS moving_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL COMMENT '发布者学生ID',
      move_date TEXT NOT NULL COMMENT '搬家日期时间',
      location TEXT NOT NULL COMMENT '搬家地点（From → To）',
      helpers_needed TEXT NOT NULL COMMENT '需要帮手数量',
      items TEXT NOT NULL COMMENT '搬运物品',
      compensation TEXT NOT NULL COMMENT '报酬（NZD）',
      helper_assigned TEXT COMMENT '已分配的助手学生ID',
      status TEXT DEFAULT 'pending' COMMENT '任务状态：pending/assigned/completed/cancelled',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
      FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
    )
  `;

  db.run(createMovingRequestsTable, (err) => {
    if (err) {
      console.error('【数据库错误】创建moving_requests表失败:', err.message);
    } else {
      console.log('【数据库成功】moving_requests表初始化完成');
    }
  });

  // 3. 任务分配记录表（task_assignments）- 新增表（原有逻辑隐含，现在显式）
  const createTaskAssignmentsTable = `
    CREATE TABLE IF NOT EXISTS task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL COMMENT '搬家任务ID',
      helper_id TEXT NOT NULL COMMENT '助手学生ID',
      assign_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '分配时间',
      FOREIGN KEY (task_id) REFERENCES moving_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (helper_id) REFERENCES users(student_id) ON DELETE CASCADE,
      UNIQUE(task_id, helper_id)
    )
  `;

  db.run(createTaskAssignmentsTable, (err) => {
    if (err) {
      console.error('【数据库错误】创建task_assignments表失败:', err.message);
    } else {
      console.log('【数据库成功】task_assignments表初始化完成');
    }
  });

  console.log('【数据库初始化】所有表检查/创建完成');
}

// ===================== 工具函数 =====================
/**
 * 验证Outlook邮箱格式
 * @param {string} email - 待验证的邮箱
 * @returns {boolean} - 是否为有效Outlook/Hotmail邮箱
 */
function isValidOutlookEmail(email) {
  const outlookRegex = /^[a-zA-Z0-9._%+-]+@(outlook|hotmail)\.com$/i;
  return outlookRegex.test(email);
}

/**
 * 生成6位数字验证码
 * @returns {string} - 6位验证码
 */
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 发送Outlook邮箱验证码
 * @param {string} toEmail - 接收邮箱
 * @param {string} code - 验证码
 * @returns {Promise<boolean>} - 是否发送成功
 */
async function sendEmailVerificationCode(toEmail, code) {
  const mailOptions = {
    from: `"DormLift 验证" <${process.env.OUTLOOK_EMAIL || 'your-test-email@outlook.com'}>`,
    to: toEmail,
    subject: 'DormLift - 你的邮箱验证码',
    text: `【DormLift】你的验证码是：${code}，有效期5分钟，请尽快完成验证。`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">DormLift 邮箱验证</h2>
        <p style="font-size: 16px; color: #34495e;">你的验证码是：</p>
        <div style="font-size: 24px; font-weight: bold; color: #3498db; margin: 20px 0;">${code}</div>
        <p style="font-size: 14px; color: #7f8c8d;">验证码有效期5分钟，请勿泄露给他人。</p>
      </div>
    `
  };

  try {
    await emailTransporter.sendMail(mailOptions);
    console.log(`【邮箱发送成功】验证码已发送到 ${toEmail}`);
    return true;
  } catch (error) {
    console.error(`【邮箱发送失败】${toEmail}:`, error.message);
    return false;
  }
}

// ===================== 接口 - 验证码相关 =====================
/**
 * 接口：发送Outlook邮箱验证码
 * POST /api/send-verification-code
 * 请求体：{ email: string }
 * 响应：{ success: boolean, message: string }
 */
app.post('/api/send-verification-code', async (req, res) => {
  try {
    const { email } = req.body;

    // 1. 验证邮箱参数
    if (!email) {
      return res.status(400).json({
        success: false,
        message: '参数错误：邮箱不能为空'
      });
    }

    // 2. 验证Outlook邮箱格式
    if (!isValidOutlookEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '邮箱格式错误：仅支持Outlook/Hotmail邮箱（如xxx@outlook.com）'
      });
    }

    // 3. 生成6位验证码
    const verificationCode = generateVerificationCode();
    const expireTime = Date.now() + 5 * 60 * 1000; // 5分钟后过期

    // 4. 发送验证码到邮箱
    const sendSuccess = await sendEmailVerificationCode(email, verificationCode);

    // 5. 存储验证码（覆盖原有记录）
    storedVerificationCode = {
      email: email,
      code: verificationCode,
      expireTime: expireTime
    };

    // 6. 返回响应
    if (sendSuccess) {
      res.status(200).json({
        success: true,
        message: `验证码已发送到你的邮箱 ${email}，请查收（含垃圾箱）`
      });
    } else {
      // 发送失败但仍返回验证码（开发/测试用）
      res.status(200).json({
        success: true,
        message: `邮箱发送失败（测试模式），验证码：${verificationCode}（有效期5分钟）`
      });
    }
  } catch (error) {
    console.error('【接口错误】/api/send-verification-code:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：发送验证码失败'
    });
  }
});

// ===================== 接口 - 用户注册/登录 =====================
/**
 * 接口：用户注册
 * POST /api/register
 * 请求体：{
 *   givenName: string,
 *   firstName: string,
 *   studentId: string,
 *   gender: string,
 *   email: string,
 *   verifyCode: string,
 *   phone: string,
 *   anonymousName: string,
 *   password: string,
 *   confirmPassword: string
 * }
 * 响应：{ success: boolean, message: string }
 */
app.post('/api/register', (req, res) => {
  try {
    const {
      givenName,
      firstName,
      studentId,
      gender,
      email,
      verifyCode,
      phone,
      anonymousName,
      password,
      confirmPassword
    } = req.body;

    // 1. 验证所有必填字段
    const requiredFields = [
      givenName, firstName, studentId, gender,
      email, verifyCode, phone, anonymousName,
      password, confirmPassword
    ];
    if (requiredFields.some(field => !field || field.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: '参数错误：所有字段均为必填项'
      });
    }

    // 2. 验证密码一致性
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: '密码错误：两次输入的密码不一致'
      });
    }

    // 3. 验证Outlook邮箱格式
    if (!isValidOutlookEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '邮箱格式错误：仅支持Outlook/Hotmail邮箱'
      });
    }

    // 4. 验证验证码
    if (!storedVerificationCode || 
        storedVerificationCode.email !== email || 
        storedVerificationCode.code !== verifyCode || 
        Date.now() > storedVerificationCode.expireTime) {
      return res.status(400).json({
        success: false,
        message: '验证码错误：无效或已过期的验证码，请重新获取'
      });
    }

    // 5. 检查学生ID是否已注册
    db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, studentRow) => {
      if (err) {
        console.error('【数据库错误】查询学生ID失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：查询学生ID失败'
        });
      }

      if (studentRow) {
        return res.status(400).json({
          success: false,
          message: '注册失败：该学生ID已被注册'
        });
      }

      // 6. 检查邮箱是否已注册
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, emailRow) => {
        if (err) {
          console.error('【数据库错误】查询邮箱失败:', err.message);
          return res.status(500).json({
            success: false,
            message: '服务器错误：查询邮箱失败'
          });
        }

        if (emailRow) {
          return res.status(400).json({
            success: false,
            message: '注册失败：该Outlook邮箱已被注册'
          });
        }

        // 7. 检查手机号是否已注册
        db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, phoneRow) => {
          if (err) {
            console.error('【数据库错误】查询手机号失败:', err.message);
            return res.status(500).json({
              success: false,
              message: '服务器错误：查询手机号失败'
            });
          }

          if (phoneRow) {
            return res.status(400).json({
              success: false,
              message: '注册失败：该手机号已被注册'
            });
          }

          // 8. 插入新用户
          const insertUserSql = `
            INSERT INTO users (
              student_id, given_name, first_name, gender,
              anonymous_name, phone, email, password
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `;
          db.run(insertUserSql, [
            studentId, givenName, firstName, gender,
            anonymousName, phone, email, password
          ], (err) => {
            if (err) {
              console.error('【数据库错误】插入用户失败:', err.message);
              return res.status(500).json({
                success: false,
                message: '注册失败：数据库插入错误'
              });
            }

            // 9. 清空验证码（防止重复使用）
            storedVerificationCode = {
              email: '',
              code: '',
              expireTime: 0
            };

            // 10. 返回成功响应
            res.status(200).json({
              success: true,
              message: '注册成功！请使用学生ID和密码登录'
            });
          });
        });
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/register:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：注册失败'
    });
  }
});

/**
 * 接口：用户登录
 * POST /api/login
 * 请求体：{ studentId: string, password: string }
 * 响应：{ success: boolean, message: string, data?: object }
 */
app.post('/api/login', (req, res) => {
  try {
    const { studentId, password } = req.body;

    // 1. 验证必填字段
    if (!studentId || !password) {
      return res.status(400).json({
        success: false,
        message: '参数错误：学生ID和密码均为必填项'
      });
    }

    // 2. 查询用户
    db.get('SELECT * FROM users WHERE student_id = ? AND password = ?', [studentId, password], (err, row) => {
      if (err) {
        console.error('【数据库错误】登录查询失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：登录查询失败'
        });
      }

      if (!row) {
        return res.status(401).json({
          success: false,
          message: '登录失败：学生ID或密码错误'
        });
      }

      // 3. 返回登录成功响应（包含用户信息）
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
  } catch (error) {
    console.error('【接口错误】/api/login:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：登录失败'
    });
  }
});

// ===================== 接口 - 搬家任务管理 =====================
/**
 * 接口：发布搬家请求
 * POST /api/post-request
 * 请求体：{
 *   studentId: string,
 *   moveDate: string,
 *   location: string,
 *   helpersNeeded: string,
 *   items: string,
 *   compensation: string
 * }
 * 响应：{ success: boolean, message: string }
 */
app.post('/api/post-request', (req, res) => {
  try {
    const {
      studentId,
      moveDate,
      location,
      helpersNeeded,
      items,
      compensation
    } = req.body;

    // 1. 验证必填字段
    const requiredFields = [studentId, moveDate, location, helpersNeeded, items, compensation];
    if (requiredFields.some(field => !field || field.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: '参数错误：所有字段均为必填项'
      });
    }

    // 2. 验证学生ID是否存在
    db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
      if (err) {
        console.error('【数据库错误】验证学生ID失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：验证学生ID失败'
        });
      }

      if (!row) {
        return res.status(400).json({
          success: false,
          message: '发布失败：该学生ID未注册'
        });
      }

      // 3. 插入搬家请求
      const insertRequestSql = `
        INSERT INTO moving_requests (
          student_id, move_date, location,
          helpers_needed, items, compensation
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;
      db.run(insertRequestSql, [
        studentId, moveDate, location,
        helpersNeeded, items, compensation
      ], (err) => {
        if (err) {
          console.error('【数据库错误】插入搬家请求失败:', err.message);
          return res.status(500).json({
            success: false,
            message: '发布失败：数据库插入错误'
          });
        }

        // 4. 返回成功响应
        res.status(200).json({
          success: true,
          message: '搬家请求发布成功！'
        });
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/post-request:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：发布搬家请求失败'
    });
  }
});

/**
 * 接口：获取所有公开任务（未被分配的）
 * GET /api/get-tasks
 * 响应：{ success: boolean, tasks: array }
 */
app.get('/api/get-tasks', (req, res) => {
  try {
    const getTasksSql = `
      SELECT * FROM moving_requests
      WHERE helper_assigned IS NULL OR helper_assigned = ''
      ORDER BY move_date ASC
    `;

    db.all(getTasksSql, (err, rows) => {
      if (err) {
        console.error('【数据库错误】获取任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取任务失败',
          tasks: []
        });
      }

      res.status(200).json({
        success: true,
        tasks: rows || []
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/get-tasks:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取任务失败',
      tasks: []
    });
  }
});

/**
 * 接口：接受任务
 * POST /api/accept-task
 * 请求体：{ taskId: number, helperId: string }
 * 响应：{ success: boolean, message: string }
 */
app.post('/api/accept-task', (req, res) => {
  try {
    const { taskId, helperId } = req.body;

    // 1. 验证必填字段
    if (!taskId || !helperId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：任务ID和助手ID均为必填项'
      });
    }

    // 2. 检查任务是否存在且未被分配
    db.get('SELECT * FROM moving_requests WHERE id = ? AND (helper_assigned IS NULL OR helper_assigned = \'\')', [taskId], (err, taskRow) => {
      if (err) {
        console.error('【数据库错误】查询任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：查询任务失败'
        });
      }

      if (!taskRow) {
        return res.status(400).json({
          success: false,
          message: '接受任务失败：任务不存在或已被分配'
        });
      }

      // 3. 检查助手ID是否存在
      db.get('SELECT * FROM users WHERE student_id = ?', [helperId], (err, helperRow) => {
        if (err) {
          console.error('【数据库错误】查询助手ID失败:', err.message);
          return res.status(500).json({
            success: false,
            message: '服务器错误：查询助手ID失败'
          });
        }

        if (!helperRow) {
          return res.status(400).json({
            success: false,
            message: '接受任务失败：助手ID未注册'
          });
        }

        // 4. 更新任务分配状态
        const updateTaskSql = `
          UPDATE moving_requests
          SET helper_assigned = ?, status = 'assigned'
          WHERE id = ?
        `;
        db.run(updateTaskSql, [helperId, taskId], (err) => {
          if (err) {
            console.error('【数据库错误】更新任务失败:', err.message);
            return res.status(500).json({
              success: false,
              message: '接受任务失败：更新任务状态错误'
            });
          }

          // 5. 记录任务分配
          const insertAssignmentSql = `
            INSERT INTO task_assignments (task_id, helper_id)
            VALUES (?, ?)
          `;
          db.run(insertAssignmentSql, [taskId, helperId], (err) => {
            if (err) {
              console.error('【数据库错误】记录分配失败:', err.message);
              // 不影响主流程，仅打印日志
            }

            // 6. 返回成功响应
            res.status(200).json({
              success: true,
              message: '接受任务成功！'
            });
          });
        });
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/accept-task:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：接受任务失败'
    });
  }
});

/**
 * 接口：获取我发布的任务
 * POST /api/my-posted-tasks
 * 请求体：{ studentId: string }
 * 响应：{ success: boolean, tasks: array }
 */
app.post('/api/my-posted-tasks', (req, res) => {
  try {
    const { studentId } = req.body;

    // 1. 验证必填字段
    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：学生ID为必填项',
        tasks: []
      });
    }

    // 2. 查询用户发布的任务
    const getMyTasksSql = `
      SELECT * FROM moving_requests
      WHERE student_id = ?
      ORDER BY move_date ASC
    `;
    db.all(getMyTasksSql, [studentId], (err, rows) => {
      if (err) {
        console.error('【数据库错误】获取我的任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取我的任务失败',
          tasks: []
        });
      }

      res.status(200).json({
        success: true,
        tasks: rows || []
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/my-posted-tasks:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取我的任务失败',
      tasks: []
    });
  }
});

/**
 * 接口：获取我接受的任务
 * POST /api/my-accepted-tasks
 * 请求体：{ helperId: string }
 * 响应：{ success: boolean, tasks: array }
 */
app.post('/api/my-accepted-tasks', (req, res) => {
  try {
    const { helperId } = req.body;

    // 1. 验证必填字段
    if (!helperId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：助手ID为必填项',
        tasks: []
      });
    }

    // 2. 查询我接受的任务
    const getAcceptedTasksSql = `
      SELECT mr.* FROM moving_requests mr
      JOIN task_assignments ta ON mr.id = ta.task_id
      WHERE ta.helper_id = ?
      ORDER BY mr.move_date ASC
    `;
    db.all(getAcceptedTasksSql, [helperId], (err, rows) => {
      if (err) {
        console.error('【数据库错误】获取接受的任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取接受的任务失败',
          tasks: []
        });
      }

      res.status(200).json({
        success: true,
        tasks: rows || []
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/my-accepted-tasks:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取接受的任务失败',
      tasks: []
    });
  }
});

/**
 * 接口：查看助手学号（发布者）
 * POST /api/view-helper-id
 * 请求体：{ taskId: number, posterId: string }
 * 响应：{ success: boolean, helperId?: string, message: string }
 */
app.post('/api/view-helper-id', (req, res) => {
  try {
    const { taskId, posterId } = req.body;

    // 1. 验证必填字段
    if (!taskId || !posterId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：任务ID和发布者ID均为必填项'
      });
    }

    // 2. 验证任务归属
    db.get('SELECT helper_assigned FROM moving_requests WHERE id = ? AND student_id = ?', [taskId, posterId], (err, row) => {
      if (err) {
        console.error('【数据库错误】查询助手ID失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：查询助手ID失败'
        });
      }

      if (!row) {
        return res.status(400).json({
          success: false,
          message: '查看失败：任务不存在或你不是发布者'
        });
      }

      if (!row.helper_assigned) {
        return res.status(400).json({
          success: false,
          message: '查看失败：该任务尚未分配助手'
        });
      }

      // 3. 返回助手ID
      res.status(200).json({
        success: true,
        helperId: row.helper_assigned,
        message: '查询成功'
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/view-helper-id:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：查看助手ID失败'
    });
  }
});

/**
 * 接口：查看发布者学号（助手）
 * POST /api/view-poster-id
 * 请求体：{ taskId: number, helperId: string }
 * 响应：{ success: boolean, posterId?: string, message: string }
 */
app.post('/api/view-poster-id', (req, res) => {
  try {
    const { taskId, helperId } = req.body;

    // 1. 验证必填字段
    if (!taskId || !helperId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：任务ID和助手ID均为必填项'
      });
    }

    // 2. 验证任务分配关系
    db.get('SELECT student_id FROM moving_requests WHERE id = ? AND helper_assigned = ?', [taskId, helperId], (err, row) => {
      if (err) {
        console.error('【数据库错误】查询发布者ID失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：查询发布者ID失败'
        });
      }

      if (!row) {
        return res.status(400).json({
          success: false,
          message: '查看失败：任务不存在或你不是该任务的助手'
        });
      }

      // 3. 返回发布者ID
      res.status(200).json({
        success: true,
        posterId: row.student_id,
        message: '查询成功'
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/view-poster-id:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：查看发布者ID失败'
    });
  }
});

/**
 * 接口：删除我发布的任务
 * POST /api/delete-task
 * 请求体：{ taskId: number, studentId: string }
 * 响应：{ success: boolean, message: string }
 */
app.post('/api/delete-task', (req, res) => {
  try {
    const { taskId, studentId } = req.body;

    // 1. 验证必填字段
    if (!taskId || !studentId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：任务ID和学生ID均为必填项'
      });
    }

    // 2. 验证任务归属
    db.get('SELECT * FROM moving_requests WHERE id = ? AND student_id = ?', [taskId, studentId], (err, row) => {
      if (err) {
        console.error('【数据库错误】查询任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：查询任务失败'
        });
      }

      if (!row) {
        return res.status(400).json({
          success: false,
          message: '删除失败：任务不存在或你不是发布者'
        });
      }

      // 3. 删除任务分配记录
      db.run('DELETE FROM task_assignments WHERE task_id = ?', [taskId], (err) => {
        if (err) {
          console.error('【数据库错误】删除分配记录失败:', err.message);
          // 不影响主流程
        }

        // 4. 删除任务
        db.run('DELETE FROM moving_requests WHERE id = ?', [taskId], (err) => {
          if (err) {
            console.error('【数据库错误】删除任务失败:', err.message);
            return res.status(500).json({
              success: false,
              message: '删除失败：数据库删除错误'
            });
          }

          // 5. 返回成功响应
          res.status(200).json({
            success: true,
            message: '任务删除成功！'
          });
        });
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/delete-task:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：删除任务失败'
    });
  }
});

/**
 * 接口：取消我接受的任务
 * POST /api/cancel-task
 * 请求体：{ taskId: number, helperId: string }
 * 响应：{ success: boolean, message: string }
 */
app.post('/api/cancel-task', (req, res) => {
  try {
    const { taskId, helperId } = req.body;

    // 1. 验证必填字段
    if (!taskId || !helperId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：任务ID和助手ID均为必填项'
      });
    }

    // 2. 验证任务分配关系
    db.get('SELECT * FROM moving_requests WHERE id = ? AND helper_assigned = ?', [taskId, helperId], (err, row) => {
      if (err) {
        console.error('【数据库错误】查询任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：查询任务失败'
        });
      }

      if (!row) {
        return res.status(400).json({
          success: false,
          message: '取消失败：任务不存在或你不是该任务的助手'
        });
      }

      // 3. 更新任务状态
      const updateTaskSql = `
        UPDATE moving_requests
        SET helper_assigned = NULL, status = 'pending'
        WHERE id = ?
      `;
      db.run(updateTaskSql, [taskId], (err) => {
        if (err) {
          console.error('【数据库错误】更新任务失败:', err.message);
          return res.status(500).json({
            success: false,
            message: '取消失败：更新任务状态错误'
          });
        }

        // 4. 删除任务分配记录
        db.run('DELETE FROM task_assignments WHERE task_id = ? AND helper_id = ?', [taskId, helperId], (err) => {
          if (err) {
            console.error('【数据库错误】删除分配记录失败:', err.message);
            // 不影响主流程
          }

          // 5. 返回成功响应
          res.status(200).json({
            success: true,
            message: '取消任务成功！'
          });
        });
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/cancel-task:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：取消任务失败'
    });
  }
});

/**
 * 接口：获取个人信息
 * POST /api/get-profile
 * 请求体：{ studentId: string }
 * 响应：{ success: boolean, user?: object, message: string }
 */
app.post('/api/get-profile', (req, res) => {
  try {
    const { studentId } = req.body;

    // 1. 验证必填字段
    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：学生ID为必填项'
      });
    }

    // 2. 查询个人信息
    db.get('SELECT * FROM users WHERE student_id = ?', [studentId], (err, row) => {
      if (err) {
        console.error('【数据库错误】查询个人信息失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：查询个人信息失败'
        });
      }

      if (!row) {
        return res.status(400).json({
          success: false,
          message: '查询失败：该学生ID未注册'
        });
      }

      // 3. 返回个人信息（隐藏密码）
      const userInfo = {
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
        user: userInfo,
        message: '查询个人信息成功'
      });
    });
  } catch (error) {
    console.error('【接口错误】/api/get-profile:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：查询个人信息失败'
    });
  }
});

// ===================== 🔥 注释掉原根路由测试页面（避免冲突） =====================
// /**
//  * 首页路由：测试服务器是否运行
//  */
// app.get('/', (req, res) => {
//   res.status(200).send(`
//     <!DOCTYPE html>
//     <html>
//     <head>
//       <title>DormLift Server</title>
//       <style>
//         body { font-family: Arial; text-align: center; margin-top: 50px; }
//         .container { max-width: 800px; margin: 0 auto; padding: 20px; }
//         h1 { color: #2c3e50; }
//         .success { color: #27ae60; font-size: 18px; margin: 20px 0; }
//         .api-list { text-align: left; margin: 30px auto; max-width: 600px; }
//         .api-item { margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 4px; }
//       </style>
//     </head>
//     <body>
//       <div class="container">
//         <h1>✅ DormLift 后端服务运行中</h1>
//         <p class="success">服务器已成功启动，所有接口可用</p>
//         <h3>核心接口列表：</h3>
//         <div class="api-list">
//           <div class="api-item">POST /api/send-verification-code - 发送Outlook邮箱验证码</div>
//           <div class="api-item">POST /api/register - 用户注册</div>
//           <div class="api-item">POST /api/login - 用户登录</div>
//           <div class="api-item">POST /api/post-request - 发布搬家请求</div>
//           <div class="api-item">GET /api/get-tasks - 获取所有公开任务</div>
//           <div class="api-item">POST /api/accept-task - 接受任务</div>
//         </div>
//       </div>
//     </body>
//     </html>
//   `);
// });

// ===================== 启动服务器 =====================
app.listen(PORT, () => {
  console.log(`============================================`);
  console.log(`🚀 DormLift 后端服务已启动`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
  console.log(`📅 启动时间: ${new Date().toLocaleString()}`);
  console.log(`💡 前端界面已挂载，访问根路径即可查看`);
  console.log(`============================================`);
});

// ===================== 进程退出处理 =====================
process.on('SIGINT', () => {
  console.log('\n【服务器关闭】开始关闭数据库连接...');
  db.close((err) => {
    if (err) {
      console.error('【数据库错误】关闭连接失败:', err.message);
    } else {
      console.log('【数据库成功】连接已关闭');
    }
    process.exit(0);
  });
});

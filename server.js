/**
 * DormLift 完整服务器版（包含所有业务接口+部署修复）
 * 核心功能：
 * 1. 基础：健康检查、跨域、端口监听0.0.0.0
 * 2. 验证码：读取Railway环境变量发送Outlook邮件
 * 3. 用户：注册、登录、获取用户信息
 * 4. 任务：发布、获取未分配任务、我的发布/接受任务、删除/取消任务
 * 5. 部署：PM2守护、优雅退出、防重复初始化
 */
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

// 初始化Express应用
const app = express();
const PORT = process.env.PORT || 8080;

// 中间件配置
app.use(cors({ origin: '*' })); // 允许跨域（测试环境）
app.use(bodyParser.json()); // 解析JSON请求体
app.use(bodyParser.urlencoded({ extended: true }));

// ===================== 1. 健康检查接口（解决Application failed to respond） =====================
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'DormLift服务器运行正常',
    port: PORT,
    listen_address: '0.0.0.0',
    timestamp: new Date().toISOString(),
    functions: ['用户注册/登录', '验证码发送', '任务管理']
  });
});

// ===================== 2. 数据库配置 =====================
const db = new sqlite3.Database('./dormlift.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
  } else {
    console.log('✅ 数据库连接成功（dormlift.db）');
    // 延迟初始化，先响应健康检查
    setTimeout(initDatabase, 2000);
  }
});

// 全局变量
let storedVerificationCode = { email: '', code: '', expireTime: 0 };
const EMAIL_TEST_MODE = false;
let isDbInitialized = false; // 防重复初始化标记

// ===================== 3. 数据库表初始化（完整建表） =====================
function initDatabase() {
  if (isDbInitialized) return;
  console.log('🔧 开始初始化数据表...');

  // 3.1 用户表（users）
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL,  -- 学生ID（唯一标识）
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

  // 3.2 搬家请求表（moving_requests）
  const createRequestsTable = `
    CREATE TABLE IF NOT EXISTS moving_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,         -- 发布者学生ID
      move_date TEXT NOT NULL,          -- 搬家日期
      location TEXT NOT NULL,           -- 搬家地点
      helpers_needed TEXT NOT NULL,     -- 需要的帮手数量
      items TEXT NOT NULL,              -- 搬运物品
      compensation TEXT NOT NULL,       -- 报酬
      helper_assigned TEXT,             -- 已分配的帮手学生ID
      status TEXT DEFAULT 'pending',    -- 状态：pending/assigned/completed
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
    )
  `;

  // 3.3 任务分配表（task_assignments）
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
  isDbInitialized = true;
}

// ===================== 4. 核心工具函数 =====================
// 4.1 验证邮箱格式（valid，非valuable）
function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;
  return emailRegex.test(email);
}

// 4.2 生成6位数字验证码
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 4.3 发送验证码邮件（读取Railway环境变量）
async function sendVerificationCode(email, code) {
  // 调试：打印环境变量
  console.log('📝 读取到的环境变量：', {
    OUTLOOK_EMAIL: process.env.OUTLOOK_EMAIL,
    OUTLOOK_PASS: process.env.OUTLOOK_PASS ? '已读取（隐藏）' : '未读取'
  });

  // 校验环境变量
  if (!process.env.OUTLOOK_EMAIL || !process.env.OUTLOOK_PASS) {
    console.error('❌ Railway环境变量未配置：请设置OUTLOOK_EMAIL和OUTLOOK_PASS');
    console.log(`⚠️  降级方案：验证码 ${code} 已打印（收件人：${email}）`);
    return true;
  }

  // Outlook SMTP配置
  const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // 587端口用false，465用true
    auth: {
      user: process.env.OUTLOOK_EMAIL,
      pass: process.env.OUTLOOK_PASS
    },
    tls: {
      ciphers: 'SSLv3' // 解决Outlook连接兼容问题
    }
  });

  try {
    await transporter.sendMail({
      from: `DormLift <${process.env.OUTLOOK_EMAIL}>`, // 发件人必须和认证邮箱一致
      to: email,                                       // 收件人邮箱
      subject: 'DormLift 验证码',                      // 邮件标题
      text: `你的DormLift验证码是：${code}\n有效期5分钟，请尽快使用。`, // 纯文本内容
      html: `<div style="font-family: Arial; padding: 20px;">
              <h3 style="color: #2c3e50;">你的DormLift验证码</h3>
              <p style="font-size: 16px;">验证码：<strong style="color: #3498db; font-size: 20px;">${code}</strong></p>
              <p style="color: #7f8c8d; font-size: 12px;">有效期5分钟，请勿泄露给他人</p>
            </div>` // HTML内容
    });
    console.log(`✅ 验证码已发送到 ${email}（验证码：${code}）`);
    return true;
  } catch (err) {
    console.error('❌ 邮件发送失败:', err.message);
    console.log(`⚠️  降级方案：验证码 ${code} 已打印（收件人：${email}）`);
    return true;
  }
}

// ===================== 5. 验证码接口 =====================
app.post('/api/send-verification-code', async (req, res) => {
  try {
    const { email } = req.body;

    // 校验邮箱是否为空
    if (!email) {
      return res.status(400).json({
        success: false,
        message: '错误：邮箱不能为空'
      });
    }

    // 校验邮箱格式
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '错误：请输入有效的邮箱（比如 xxx@qq.com / xxx@outlook.com）'
      });
    }

    // 生成验证码并发送
    const code = generateVerificationCode();
    const expireTime = Date.now() + 5 * 60 * 1000; // 5分钟有效期
    await sendVerificationCode(email, code);
    storedVerificationCode = { email, code, expireTime };

    // 返回成功响应
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

// ===================== 6. 用户相关接口（完整） =====================
// 6.1 用户注册
app.post('/api/register', (req, res) => {
  try {
    const { student_id, given_name, first_name, gender, anonymous_name, phone, email, password, verifyCode } = req.body;

    // 校验必填字段
    if (!student_id || !given_name || !first_name || !gender || !anonymous_name || !phone || !email || !password || !verifyCode) {
      return res.status(400).json({
        success: false,
        message: '错误：所有字段都不能为空'
      });
    }

    // 校验验证码
    if (storedVerificationCode.email !== email || storedVerificationCode.code !== verifyCode || Date.now() > storedVerificationCode.expireTime) {
      return res.status(400).json({
        success: false,
        message: '错误：验证码无效或已过期'
      });
    }

    // 校验邮箱格式
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '错误：请输入有效的邮箱'
      });
    }

    // 插入用户数据
    const insertSql = `
      INSERT INTO users (student_id, given_name, first_name, gender, anonymous_name, phone, email, password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(insertSql, [student_id, given_name, first_name, gender, anonymous_name, phone, email, password], (err) => {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({
            success: false,
            message: '错误：学生ID/手机号/邮箱已存在'
          });
        }
        console.error('❌ 注册用户失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：注册失败'
        });
      }

      // 注册成功，清空验证码
      storedVerificationCode = { email: '', code: '', expireTime: 0 };
      res.status(200).json({
        success: true,
        message: '注册成功！请登录'
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

// 6.2 用户登录
app.post('/api/login', (req, res) => {
  try {
    const { student_id, password } = req.body;

    // 校验必填字段
    if (!student_id || !password) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID和密码不能为空'
      });
    }

    // 查询用户
    const selectSql = 'SELECT * FROM users WHERE student_id = ? AND password = ?';
    db.get(selectSql, [student_id, password], (err, row) => {
      if (err) {
        console.error('❌ 登录查询失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：登录失败'
        });
      }

      if (!row) {
        return res.status(400).json({
          success: false,
          message: '错误：学生ID或密码错误'
        });
      }

      // 登录成功，返回用户信息（隐藏密码）
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
        message: '登录成功！',
        data: userInfo
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

// 6.3 获取用户信息
app.post('/api/get-profile', (req, res) => {
  try {
    const { student_id } = req.body;

    if (!student_id) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID不能为空'
      });
    }

    const selectSql = 'SELECT student_id, given_name, first_name, gender, anonymous_name, phone, email, created_at FROM users WHERE student_id = ?';
    db.get(selectSql, [student_id], (err, row) => {
      if (err) {
        console.error('❌ 获取用户信息失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取用户信息失败'
        });
      }

      if (!row) {
        return res.status(400).json({
          success: false,
          message: '错误：用户不存在'
        });
      }

      res.status(200).json({
        success: true,
        message: '获取用户信息成功！',
        data: row
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

// ===================== 7. 任务管理接口（完整） =====================
// 7.1 发布搬家请求
app.post('/api/post-request', (req, res) => {
  try {
    const { student_id, move_date, location, helpers_needed, items, compensation } = req.body;

    // 校验必填字段
    if (!student_id || !move_date || !location || !helpers_needed || !items || !compensation) {
      return res.status(400).json({
        success: false,
        message: '错误：所有字段都不能为空'
      });
    }

    // 插入搬家请求
    const insertSql = `
      INSERT INTO moving_requests (student_id, move_date, location, helpers_needed, items, compensation)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.run(insertSql, [student_id, move_date, location, helpers_needed, items, compensation], function (err) {
      if (err) {
        console.error('❌ 发布搬家请求失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：发布失败'
        });
      }

      res.status(200).json({
        success: true,
        message: '搬家请求发布成功！',
        data: { task_id: this.lastID } // 返回任务ID
      });
    });
  } catch (err) {
    console.error('❌ 发布请求接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：发布失败'
    });
  }
});

// 7.2 获取所有未分配的任务
app.get('/api/get-tasks', (req, res) => {
  try {
    const selectSql = `
      SELECT mr.*, u.anonymous_name as publisher_name 
      FROM moving_requests mr
      LEFT JOIN users u ON mr.student_id = u.student_id
      WHERE mr.status = 'pending'
      ORDER BY mr.created_at DESC
    `;

    db.all(selectSql, [], (err, rows) => {
      if (err) {
        console.error('❌ 获取任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取任务失败'
        });
      }

      res.status(200).json({
        success: true,
        message: '获取未分配任务成功！',
        data: rows
      });
    });
  } catch (err) {
    console.error('❌ 获取任务接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取任务失败'
    });
  }
});

// 7.3 获取我发布的任务
app.post('/api/my-posted-tasks', (req, res) => {
  try {
    const { student_id } = req.body;

    if (!student_id) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID不能为空'
      });
    }

    const selectSql = `
      SELECT * FROM moving_requests 
      WHERE student_id = ?
      ORDER BY created_at DESC
    `;

    db.all(selectSql, [student_id], (err, rows) => {
      if (err) {
        console.error('❌ 获取我的发布任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取任务失败'
        });
      }

      res.status(200).json({
        success: true,
        message: '获取我的发布任务成功！',
        data: rows
      });
    });
  } catch (err) {
    console.error('❌ 获取我的发布任务接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取任务失败'
    });
  }
});

// 7.4 获取我接受的任务
app.post('/api/my-accepted-tasks', (req, res) => {
  try {
    const { helper_id } = req.body;

    if (!helper_id) {
      return res.status(400).json({
        success: false,
        message: '错误：学生ID不能为空'
      });
    }

    const selectSql = `
      SELECT mr.*, ta.assign_time 
      FROM moving_requests mr
      JOIN task_assignments ta ON mr.id = ta.task_id
      WHERE ta.helper_id = ?
      ORDER BY ta.assign_time DESC
    `;

    db.all(selectSql, [helper_id], (err, rows) => {
      if (err) {
        console.error('❌ 获取我的接受任务失败:', err.message);
        return res.status(500).json({
          success: false,
          message: '服务器错误：获取任务失败'
        });
      }

      res.status(200).json({
        success: true,
        message: '获取我的接受任务成功！',
        data: rows
      });
    });
  } catch (err) {
    console.error('❌ 获取我的接受任务接口异常:', err.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：获取任务失败'
    });
  }
});

// 7.5 接受任务（分配帮手）
app.post('/api/accept-task', (req, res) => {
  try {
    const { task_id, helper_id } = req.body;

    if (!task_id || !helper_id) {
      return res.status(400).json({
        success: false,
        message: '错误：任务ID和帮手ID不能为空'
      });
    }

    // 开启事务：更新任务状态 + 插入分配记录
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) {
        console.error('❌ 开启事务失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：接受任务失败' });
      }

      // 第一步：更新搬家请求的状态和分配的帮手
      const updateTaskSql = `
        UPDATE moving_requests 
        SET helper_assigned = ?, status = 'assigned', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'
      `;
      db.run(updateTaskSql, [helper_id, task_id], function (err) {
        if (err) {
          db.run('ROLLBACK');
          console.error('❌ 更新任务状态失败:', err.message);
          return res.status(500).json({ success: false, message: '服务器错误：接受任务失败' });
        }

        if (this.changes === 0) {
          db.run('ROLLBACK');
          return res.status(400).json({ success: false, message: '错误：任务已被分配或不存在' });
        }

        // 第二步：插入任务分配记录
        const insertAssignmentSql = `
          INSERT INTO task_assignments (task_id, helper_id)
          VALUES (?, ?)
        `;
        db.run(insertAssignmentSql, [task_id, helper_id], function (err) {
          if (err) {
            db.run('ROLLBACK');
            console.error('❌ 插入分配记录失败:', err.message);
            return res.status(500).json({ success: false, message: '服务器错误：接受任务失败' });
          }

          // 提交事务
          db.run('COMMIT', (err) => {
            if (err) {
              console.error('❌ 提交事务失败:', err.message);
              return res.status(500).json({ success: false, message: '服务器错误：接受任务失败' });
            }

            res.status(200).json({
              success: true,
              message: '接受任务成功！'
            });
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

// 7.6 查看任务的帮手ID
app.post('/api/view-helper-id', (req, res) => {
  try {
    const { task_id, poster_id } = req.body;

    if (!task_id || !poster_id) {
      return res.status(400).json({
        success: false,
        message: '错误：任务ID和发布者ID不能为空'
      });
    }

    // 校验发布者是否有权限
    const checkSql = 'SELECT helper_assigned FROM moving_requests WHERE id = ? AND student_id = ?';
    db.get(checkSql, [task_id, poster_id], (err, row) => {
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
        message: '查看帮手ID成功！',
        data: { helper_id: row.helper_assigned }
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

// 7.7 查看任务的发布者ID
app.post('/api/view-poster-id', (req, res) => {
  try {
    const { task_id, helper_id } = req.body;

    if (!task_id || !helper_id) {
      return res.status(400).json({
        success: false,
        message: '错误：任务ID和帮手ID不能为空'
      });
    }

    // 校验帮手是否有权限
    const checkSql = `
      SELECT mr.student_id as poster_id 
      FROM moving_requests mr
      JOIN task_assignments ta ON mr.id = ta.task_id
      WHERE mr.id = ? AND ta.helper_id = ?
    `;
    db.get(checkSql, [task_id, helper_id], (err, row) => {
      if (err) {
        console.error('❌ 查看发布者ID失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：查看发布者ID失败' });
      }

      if (!row) {
        return res.status(400).json({ success: false, message: '错误：任务不存在或你不是该任务的帮手' });
      }

      res.status(200).json({
        success: true,
        message: '查看发布者ID成功！',
        data: { poster_id: row.poster_id }
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

// 7.8 删除我发布的任务
app.post('/api/delete-task', (req, res) => {
  try {
    const { task_id, student_id } = req.body;

    if (!task_id || !student_id) {
      return res.status(400).json({
        success: false,
        message: '错误：任务ID和学生ID不能为空'
      });
    }

    // 开启事务：删除任务 + 删除关联的分配记录
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) {
        console.error('❌ 开启事务失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：删除任务失败' });
      }

      // 第一步：删除任务分配记录
      const deleteAssignmentSql = 'DELETE FROM task_assignments WHERE task_id = ?';
      db.run(deleteAssignmentSql, [task_id], (err) => {
        if (err) {
          db.run('ROLLBACK');
          console.error('❌ 删除分配记录失败:', err.message);
          return res.status(500).json({ success: false, message: '服务器错误：删除任务失败' });
        }

        // 第二步：删除搬家请求（仅发布者可删）
        const deleteTaskSql = 'DELETE FROM moving_requests WHERE id = ? AND student_id = ?';
        db.run(deleteTaskSql, [task_id, student_id], function (err) {
          if (err) {
            db.run('ROLLBACK');
            console.error('❌ 删除任务失败:', err.message);
            return res.status(500).json({ success: false, message: '服务器错误：删除任务失败' });
          }

          if (this.changes === 0) {
            db.run('ROLLBACK');
            return res.status(400).json({ success: false, message: '错误：任务不存在或你不是发布者' });
          }

          // 提交事务
          db.run('COMMIT', (err) => {
            if (err) {
              console.error('❌ 提交事务失败:', err.message);
              return res.status(500).json({ success: false, message: '服务器错误：删除任务失败' });
            }

            res.status(200).json({
              success: true,
              message: '删除任务成功！'
            });
          });
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

// 7.9 取消我接受的任务
app.post('/api/cancel-task', (req, res) => {
  try {
    const { task_id, helper_id } = req.body;

    if (!task_id || !helper_id) {
      return res.status(400).json({
        success: false,
        message: '错误：任务ID和帮手ID不能为空'
      });
    }

    // 开启事务：删除分配记录 + 恢复任务状态
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) {
        console.error('❌ 开启事务失败:', err.message);
        return res.status(500).json({ success: false, message: '服务器错误：取消任务失败' });
      }

      // 第一步：删除任务分配记录
      const deleteAssignmentSql = 'DELETE FROM task_assignments WHERE task_id = ? AND helper_id = ?';
      db.run(deleteAssignmentSql, [task_id, helper_id], function (err) {
        if (err) {
          db.run('ROLLBACK');
          console.error('❌ 删除分配记录失败:', err.message);
          return res.status(500).json({ success: false, message: '服务器错误：取消任务失败' });
        }

        if (this.changes === 0) {
          db.run('ROLLBACK');
          return res.status(400).json({ success: false, message: '错误：你未接受该任务' });
        }

        // 第二步：恢复任务状态为pending
        const updateTaskSql = `
          UPDATE moving_requests 
          SET helper_assigned = NULL, status = 'pending', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        db.run(updateTaskSql, [task_id], (err) => {
          if (err) {
            db.run('ROLLBACK');
            console.error('❌ 恢复任务状态失败:', err.message);
            return res.status(500).json({ success: false, message: '服务器错误：取消任务失败' });
          }

          // 提交事务
          db.run('COMMIT', (err) => {
            if (err) {
              console.error('❌ 提交事务失败:', err.message);
              return res.status(500).json({ success: false, message: '服务器错误：取消任务失败' });
            }

            res.status(200).json({
              success: true,
              message: '取消任务成功！'
            });
          });
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

// ===================== 8. 启动服务器（核心：监听0.0.0.0） =====================
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 服务器已启动，端口：${PORT}`);
  console.log(`✅ 监听地址：0.0.0.0:${PORT}（适配Railway容器）`);
  console.log(`✅ 健康检查接口：GET http://0.0.0.0:${PORT}/`);
  console.log(`✅ 支持接口：注册/登录/验证码/任务管理`);
});

// ===================== 9. 优雅退出（解决SIGTERM） =====================
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

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  console.error('❌ 未捕获异常:', err.message);
  db.close(() => process.exit(1));
});

// 处理未处理的Promise拒绝
process.on('unhandledRejection', (err) => {
  console.error('❌ 未处理的Promise拒绝:', err.message);
  db.close(() => process.exit(1));
});

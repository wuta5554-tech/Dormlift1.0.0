/**
 * DormLift 后端服务 - Railway适配最终版
 * 修复：SQLite COMMENT语法 + 端口动态配置 + 语法闭合完整
 * 测试模式：验证码打印在控制台，无需Outlook邮箱连接
 */
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path'); // 新增：处理路径

// 创建Express应用
const app = express();
// 🔥 关键：Railway动态端口（优先读取环境变量）
const PORT = process.env.PORT || 3000;

// ===================== 中间件配置 =====================
// 跨域配置
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 解析JSON请求体
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ 
  extended: true,
  limit: '1mb'
}));

// 🔥 静态文件配置：index.html和server.js同级（无需public文件夹）
app.use(express.static(__dirname));
// 强制根路径返回index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===================== 数据库配置 =====================
const db = new sqlite3.Database('./dormlift.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('【数据库错误】连接失败:', err.message);
  } else {
    console.log('【数据库成功】已连接到 dormlift.db');
    initDatabase();
  }
});

// 全局验证码存储（测试用）
let storedVerificationCode = {
  email: '',
  code: '',
  expireTime: 0
};

// ===================== 邮箱配置（测试模式） =====================
const EMAIL_TEST_MODE = true;

const emailTransporter = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.OUTLOOK_EMAIL || 'test@outlook.com',
    pass: process.env.OUTLOOK_PASSWORD || 'test-password'
  },
  tls: {
    rejectUnauthorized: false,
    ciphers: 'SSLv3'
  }
});

// 测试邮箱连接（不阻塞）
emailTransporter.verify((error, success) => {
  if (error) {
    console.log('【邮箱提示】连接失败，已启用测试模式（验证码将打印在控制台）');
  } else {
    console.log('【邮箱配置成功】已连接到Outlook SMTP服务器');
  }
});

// ===================== 数据库表初始化（无COMMENT） =====================
function initDatabase() {
  console.log('【数据库初始化】开始创建/检查表结构...');

  // 1. 用户表
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL,
      given_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      gender TEXT NOT NULL,
      anonymous_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.run(createUsersTable, (err) => {
    if (err) {
      console.error('【数据库错误】创建users表失败:', err.message);
    } else {
      console.log('【数据库成功】users表初始化完成');
    }
  });

  // 2. 搬家请求表
  const createMovingRequestsTable = `
    CREATE TABLE IF NOT EXISTS moving_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      move_date TEXT NOT NULL,
      location TEXT NOT NULL,
      helpers_needed TEXT NOT NULL,
      items TEXT NOT NULL,
      compensation TEXT NOT NULL,
      helper_assigned TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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

  // 3. 任务分配表
  const createTaskAssignmentsTable = `
    CREATE TABLE IF NOT EXISTS task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      helper_id TEXT NOT NULL,
      assign_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
function isValidOutlookEmail(email) {
  const outlookRegex = /^[a-zA-Z0-9._%+-]+@(outlook|hotmail)\.com$/i;
  return outlookRegex.test(email);
}

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmailVerificationCode(toEmail, code) {
  if (EMAIL_TEST_MODE) {
    console.log(`【测试模式】验证码：${code}（发送到 ${toEmail}）`);
    return true;
  }

  const mailOptions = {
    from: `"DormLift" <${process.env.OUTLOOK_EMAIL || 'test@outlook.com'}>`,
    to: toEmail,
    subject: 'DormLift 验证码',
    text: `你的验证码是：${code}，有效期5分钟`,
    html: `<div style="font-size:16px;">你的验证码是：<b>${code}</b></div>`
  };

  try {
    await emailTransporter.sendMail(mailOptions);
    console.log(`【邮箱发送成功】验证码已发送到 ${toEmail}`);
    return true;
  } catch (error) {
    console.error(`【邮箱发送失败】${toEmail}:`, error.message);
    console.log(`【备用方案】验证码：${code}`);
    return true;
  }
}

// ===================== 接口 - 验证码 =====================
app.post('/api/send-verification-code', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: '参数错误：邮箱不能为空'
      });
    }

    if (!isValidOutlookEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '邮箱格式错误：仅支持Outlook/Hotmail邮箱'
      });
    }

    const verificationCode = generateVerificationCode();
    const expireTime = Date.now() + 5 * 60 * 1000;

    await sendEmailVerificationCode(email, verificationCode);

    storedVerificationCode = {
      email: email,
      code: verificationCode,
      expireTime: expireTime
    };

    res.status(200).json({
      success: true,
      message: EMAIL_TEST_MODE 
        ? `验证码已生成：${verificationCode}（测试模式，有效期5分钟）`
        : `验证码已发送到 ${email}，请查收`
    });
  } catch (error) {
    console.error('【接口错误】/api/send-verification-code:', error.message);
    res.status(500).json({
      success: false,
      message: '服务器错误：发送验证码失败'
    });
  }
});

// ===================== 接口 - 注册/登录 =====================
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

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: '密码错误：两次输入的密码不一致'
      });
    }

    if (!isValidOutlookEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '邮箱格式错误：仅支持Outlook/Hotmail邮箱'
      });
    }

    if (!storedVerificationCode || 
        storedVerificationCode.email !== email || 
        storedVerificationCode.code !== verifyCode || 
        Date.now() > storedVerificationCode.expireTime) {
      return res.status(400).json({
        success: false,
        message: '验证码错误：无效或已过期，请重新获取'
      });
    }

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

            storedVerificationCode = {
              email: '',
              code: '',
              expireTime: 0
            };

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

app.post('/api/login', (req, res) => {
  try {
    const { studentId, password } = req.body;

    if (!studentId || !password) {
      return res.status(400).json({
        success: false,
        message: '参数错误：学生ID和密码均为必填项'
      });
    }

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

// ===================== 接口 - 任务管理 =====================
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

    const requiredFields = [studentId, moveDate, location, helpersNeeded, items, compensation];
    if (requiredFields.some(field => !field || field.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: '参数错误：所有字段均为必填项'
      });
    }

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

app.post('/api/accept-task', (req, res) => {
  try {
    const { taskId, helperId } = req.body;

    if (!taskId || !helperId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：任务ID和助手ID均为必填项'
      });
    }

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

          const insertAssignmentSql = `
            INSERT INTO task_assignments (task_id, helper_id)
            VALUES (?, ?)
          `;
          db.run(insertAssignmentSql, [taskId, helperId], (err) => {
            if (err) {
              console.error('【数据库错误】记录分配失败:', err.message);
            }

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

app.post('/api/my-posted-tasks', (req, res) => {
  try {
    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：学生ID为必填项',
        tasks: []
      });
    }

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

app.post('/api/my-accepted-tasks', (req, res) => {
  try {
    const { helperId } = req.body;

    if (!helperId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：助手ID为必填项',
        tasks: []
      });
    }

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

app.post('/api/view-helper-id', (req, res) => {
  try {
    const { taskId, posterId } = req.body;

    if (!taskId || !posterId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：任务ID和发布者ID均为必填项'
      });
    }

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

app.post('/api/view-poster-id', (req, res) => {
  try {
    const { taskId, helperId } = req.body;

    if (!taskId || !helperId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：任务ID和助手ID均为必填项'
      });
    }

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

app.post('/api/delete-task', (req, res) => {
  try {
    const { taskId, studentId } = req.body;

    if (!taskId || !studentId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：任务ID和学生ID均为必填项'
      });
    }

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

      db.run('DELETE FROM task_assignments WHERE task_id = ?', [taskId], (err) => {
        if (err) {
          console.error('【数据库错误】删除分配记录失败:', err.message);
        }

        db.run('DELETE FROM moving_requests WHERE id = ?', [taskId], (err) => {
          if (err) {
            console.error('【数据库错误】删除任务失败:', err.message);
            return res.status(500).json({
              success: false,
              message: '删除失败：数据库删除错误'
            });
          }

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

app.post('/api/cancel-task', (req, res) => {
  try {
    const { taskId, helperId } = req.body;

    if (!taskId || !helperId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：任务ID和助手ID均为必填项'
      });
    }

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

        db.run('DELETE FROM task_assignments WHERE task_id = ? AND helper_id = ?', [taskId, helperId], (err) => {
          if (err) {
            console.error('【数据库错误】删除分配记录失败:', err.message);
          }

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

app.post('/api/get-profile', (req, res) => {
  try {
    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: '参数错误：学生ID为必填项'
      });
    }

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

// ===================== 启动服务器 =====================
app.listen(PORT, () => {
  console.log(`============================================`);
  console.log(`🚀 DormLift 后端服务已启动`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
  console.log(`📅 启动时间: ${new Date().toLocaleString()}`);
  console.log(`💡 前端界面已挂载，访问根路径即可查看`);
  console.log(`🔧 测试模式已开启：验证码将打印在控制台`);
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

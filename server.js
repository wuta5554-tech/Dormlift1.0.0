/**
 * DormLift Pro - Backend Master Node (Ultimate Edition)
 * -------------------------------------------------------------
 * 核心架构功能：
 * 1. 用户：UoA学号实名体系、Bcrypt强加密、GAS验证码安全修改
 * 2. 任务：高密度数据结构、Cloudinary多图托管、发布者删除特权
 * 3. 互动：无限层级关联留言回复（Threaded Comments）
 * 4. 流程：任务审批流、状态死锁物理重置逻辑
 * -------------------------------------------------------------
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 8080;

// --- 1. 数据库与环境连接 ---
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Master Node: Connected'))
    .catch(err => console.error('❌ DB Connection Critical Failure:', err));

// --- 2. 数据模型定义 (Strict Schemas) ---

// 用户模型：增加 student_id 字段
const User = mongoose.model('User', new mongoose.Schema({
    full_name: { type: String, required: true },
    student_id: { type: String, required: true }, 
    anonymous_name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    phone: { type: String, default: "" },
    password: { type: String, required: true },
    created_at: { type: Date, default: Date.now }
}));

// 任务模型：加固状态位
const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true },
    helper_id: { type: String, default: null },     // 帮手ID，重置时需设为null
    move_date: { type: String, required: true },
    from_addr: { type: String, required: true },
    to_addr: { type: String, required: true },
    items_desc: String,
    reward: String,
    img_url: { type: String, default: "[]" }, 
    status: { 
        type: String, 
        enum: ['pending', 'assigned', 'finished'], 
        default: 'pending' 
    },
    cancel_requested: { type: Boolean, default: false }, // 取消申请状态
    comments: { type: Array, default: [] }, // 结构: [{id, user, text, time, parentId}]
    created_at: { type: Date, default: Date.now }
}));

// --- 3. 第三方服务配置 (Cloudinary) ---
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const storage = new CloudinaryStorage({ 
    cloudinary, 
    params: { folder: 'dormlift_pro_production', allowed_formats: ['jpg', 'png', 'jpeg'] } 
});
const upload = multer({ storage });

// --- 4. 全局中间件 ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- 5. API 接口闭环实现 ---

/** [Auth] 发送验证码 (GAS 代理) */
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    try {
        await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                to: email, 
                subject: "DormLift Security Authentication", 
                html: `<div style="font-family:sans-serif; padding:20px; border:1px solid #eee;">
                        <h2 style="color:#4f46e5;">Verification Code</h2>
                        <p>Your security code is: <b style="font-size:24px;">${code}</b></p>
                        <p>If you did not request this code, please ignore this email.</p>
                       </div>` 
            })
        });
        res.json({ success: true, code }); // 仅供测试环境，生产环境建议存入Redis
    } catch (e) {
        res.status(500).json({ success: false, msg: "Mail server unreachable" });
    }
});

/** [Auth] 注册 (Bcrypt 强哈希) */
app.post('/api/auth/register', async (req, res) => {
    try {
        const { password, ...data } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ ...data, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, msg: "Registration failed (duplicate email or missing fields)" });
    }
});

/** [Auth] 登录 (逻辑闭环) */
app.post('/api/auth/login', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            res.json({ 
                success: true, 
                user: { 
                    email: user.email, 
                    anonymous_name: user.anonymous_name,
                    student_id: user.student_id 
                } 
            });
        } else {
            res.status(401).json({ success: false, msg: "Invalid credentials" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [User] 详情查询 */
app.get('/api/user/detail/:email', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email }, { password: 0 });
        if(user) res.json({ success: true, user });
        else res.status(404).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [User] 资料更新 (带码验证逻辑) */
app.post('/api/user/update', async (req, res) => {
    const { current_email, new_data, code, target_code } = req.body;
    if (code !== target_code) {
        return res.status(400).json({ success: false, msg: "Verification code mismatch" });
    }
    try {
        await User.findOneAndUpdate({ email: current_email }, { $set: new_data });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

/** [Task] 任务发布 (多图上传) */
app.post('/api/task/create', upload.array('task_images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        const newTask = new Task({
            ...req.body,
            img_url: JSON.stringify(urls)
        });
        await newTask.save();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, msg: e.message });
    }
});

/** [Task] 市场查询 (核心修复：确保只返回无帮手的任务) */
app.get('/api/task/all', async (req, res) => {
    try {
        // 只有状态为 pending 且帮手 ID 为空的任务才出现在市场
        const list = await Task.find({ status: 'pending', helper_id: null }).sort({ created_at: -1 });
        res.json({ success: true, list });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

/** [Task] 提交留言/回复 (盖楼逻辑支持) */
app.post('/api/task/comment', async (req, res) => {
    try {
        const { task_id, comment } = req.body;
        // comment 对象包含: { id, user, text, time, parentId }
        await Task.findByIdAndUpdate(task_id, { $push: { comments: comment } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [Task] 工作流 API (核心加固：物理清空 Helper 逻辑) */
app.post('/api/task/workflow', async (req, res) => {
    try {
        const { task_id, ...updates } = req.body;
        // 动态更新传入的所有状态位 (status, helper_id, cancel_requested 等)
        // 注意：前端批准取消时会传 helper_id: null，此处 $set 会正确处理
        await Task.findByIdAndUpdate(task_id, { $set: updates });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

/** [Task] 任务撤回 (发布者物理删除) */
app.post('/api/task/delete', async (req, res) => {
    try {
        const { task_id, email } = req.body;
        const task = await Task.findById(task_id);
        if (task && task.publisher_id === email) {
            await Task.findByIdAndDelete(task_id);
            res.json({ success: true });
        } else {
            res.status(403).json({ success: false, msg: "Unauthorized" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [User] 个人任务看板数据 */
app.post('/api/user/dashboard', async (req, res) => {
    try {
        const { email } = req.body;
        const list = await Task.find({ 
            $or: [{ publisher_id: email }, { helper_id: email }] 
        }).sort({ created_at: -1 });
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [Dev] 数据库一键核平 (初始化) */
app.post('/api/dev/nuke', async (req, res) => {
    try {
        await Task.deleteMany({});
        await User.deleteMany({});
        res.json({ success: true, msg: "Database reset to zero." });
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- 6. 监听端口 ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀==================================================🚀
       DormLift Pro Master Node Active
       Port: ${PORT}
       Status: Peer-to-Peer Protocol Ready
    🚀==================================================🚀
    `);
});

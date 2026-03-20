/**
 * DormLift Pro - Backend Master Node (Full Feature Version)
 * 包含功能：
 * 1. 用户体系：学号实名、Bcrypt加密、验证码安全修改资料
 * 2. 任务流转：市场发布、多图云存储、接单、申请取消、审批取消
 * 3. 社交互动：盖楼式留言回复系统
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

// --- 1. 数据库与环境配置 ---
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL; // Google Apps Script 邮件接口地址

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Master Connected'))
    .catch(err => console.error('❌ Connection Error:', err));

// --- 2. 数据模型定义 (Models) ---

// 用户模型
const User = mongoose.model('User', new mongoose.Schema({
    full_name: { type: String, required: true },
    student_id: { type: String, required: true },
    anonymous_name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    phone: { type: String, default: "" },
    password: { type: String, required: true },
    created_at: { type: Date, default: Date.now }
}));

// 任务模型 (包含嵌套评论结构)
const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true },
    helper_id: { type: String, default: null },
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
    cancel_requested: { type: Boolean, default: false },
    comments: { type: Array, default: [] }, // 结构: [{id, user, text, time, parentId}]
    created_at: { type: Date, default: Date.now }
}));

// --- 3. 图片存储配置 (Cloudinary) ---
cloudinary.config({ 
    cloud_name: process.env.CLOCDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const storage = new CloudinaryStorage({ 
    cloudinary, 
    params: { folder: 'dormlift_pro_prod', allowed_formats: ['jpg', 'png', 'jpeg'] } 
});
const upload = multer({ storage });

// --- 4. 中间件配置 ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- 5. API 接口实现 ---

/** [Auth] 发送验证码 (支持注册与修改资料) */
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    try {
        await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                to: email, 
                subject: "DormLift Security Verification", 
                html: `<p>Your security code is: <b style="font-size:20px;">${code}</b></p>` 
            })
        });
        res.json({ success: true, code }); // 仅供测试使用，实际应存入Session/Redis
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

/** [Auth] 注册 */
app.post('/api/auth/register', async (req, res) => {
    try {
        const { password, ...data } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ ...data, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, msg: "User already exists" });
    }
});

/** [Auth] 登录 */
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
            res.status(401).json({ success: false });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [User] 获取资料 */
app.get('/api/user/detail/:email', async (req, res) => {
    const user = await User.findOne({ email: req.params.email }, { password: 0 });
    res.json({ success: true, user });
});

/** [User] 更新资料 (验证码校验) */
app.post('/api/user/update', async (req, res) => {
    const { current_email, new_data, code, target_code } = req.body;
    if (code !== target_code) return res.status(400).json({ success: false, msg: "Wrong code" });
    try {
        await User.findOneAndUpdate({ email: current_email }, { $set: new_data });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [Task] 发布任务 */
app.post('/api/task/create', upload.array('task_images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        const newTask = new Task({ ...req.body, img_url: JSON.stringify(urls) });
        await newTask.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, msg: e.message }); }
});

/** [Task] 市场列表 (仅待接单) */
app.get('/api/task/all', async (req, res) => {
    try {
        const list = await Task.find({ status: 'pending' }).sort({ created_at: -1 });
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [Task] 提交留言/回复 (盖楼逻辑) */
app.post('/api/task/comment', async (req, res) => {
    try {
        const { task_id, comment } = req.body;
        // comment 对象包含: { id, user, text, time, parentId }
        await Task.findByIdAndUpdate(task_id, { $push: { comments: comment } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [Task] 工作流控制 (接单、取消、审批) */
app.post('/api/task/workflow', async (req, res) => {
    try {
        const { task_id, ...updates } = req.body;
        await Task.findByIdAndUpdate(task_id, { $set: updates });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [User] 个人任务看板 */
app.post('/api/user/dashboard', async (req, res) => {
    try {
        const list = await Task.find({ 
            $or: [{ publisher_id: req.body.email }, { helper_id: req.body.email }] 
        }).sort({ created_at: -1 });
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [Dev] 数据清空按钮 */
app.post('/api/dev/nuke', async (req, res) => {
    await Task.deleteMany({});
    await User.deleteMany({});
    res.json({ success: true });
});

// --- 6. 启动服务 ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DormLift Master Server is running on port ${PORT}`);
});

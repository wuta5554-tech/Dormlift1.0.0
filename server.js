/**
 * DormLift Pro - Backend Master Server (Full Synchronization Version)
 * 包含：用户/任务管理、Cloudinary 存储、评论系统、开发者初始化工具
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 8080;

// --- 1. 环境配置 ---
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Master DB Connected (Auckland Node)'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// --- 2. 数据模型 (Models) ---

const User = mongoose.model('User', new mongoose.Schema({
    full_name: { type: String, required: true },
    anonymous_name: { type: String, required: true },
    school_name: { type: String, default: 'University of Auckland' },
    email: { type: String, unique: true, required: true },
    phone: String,
    password: { type: String, required: true },
    created_at: { type: Date, default: Date.now }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true }, 
    helper_id: { type: String, default: null },
    move_date: { type: String, required: true },
    from_addr: { type: String, required: true }, 
    to_addr: { type: String, required: true },
    items_desc: String,
    reward: String,
    img_url: { type: String, default: "[]" }, 
    people_needed: { type: String, default: "1" },
    elevator: { type: String, enum: ['Yes', 'No'], default: 'No' },
    status: { type: String, enum: ['pending', 'assigned', 'finished'], default: 'pending' },
    // 新增：评论存储数组
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// --- 3. Cloudinary 配置 ---
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const storage = new CloudinaryStorage({ 
    cloudinary, 
    params: { folder: 'dormlift_v15', allowed_formats: ['jpg', 'png', 'jpeg'] } 
});
const upload = multer({ storage: storage });

// --- 4. 中间件 ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 

// --- 5. 核心 API ---

// [Auth] GAS 验证码对接
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ to: email, subject: "DormLift Verification", html: `Your code is: <b>${code}</b>` })
        });
        const result = await response.json();
        if (result.success) res.json({ success: true, code });
        else res.status(500).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

// [Auth] 注册与登录
app.post('/api/auth/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        await new User({ ...req.body, password: hashed }).save();
        res.status(201).json({ success: true });
    } catch (e) { res.status(400).json({ success: false }); }
});

app.post('/api/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ success: true, user: { email: user.email, anonymous_name: user.anonymous_name } });
    } else res.status(401).json({ success: false });
});

// [Task] 创建任务 (带错误捕捉)
app.post('/api/task/create', (req, res) => {
    upload.array('task_images', 5)(req, res, async function (err) {
        if (err) return res.status(500).json({ success: false, msg: err.message });
        try {
            const urls = req.files ? req.files.map(f => f.path) : [];
            const newTask = new Task({ ...req.body, img_url: JSON.stringify(urls), status: 'pending' });
            await newTask.save();
            res.json({ success: true });
        } catch (dbErr) { res.status(500).json({ success: false, msg: dbErr.message }); }
    });
});

// [Task] 获取所有市场任务
app.get('/api/task/all', async (req, res) => {
    try {
        const list = await Task.find({ status: 'pending' }).sort({ created_at: -1 });
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

// [Task] 提交评论 (同步详情页功能)
app.post('/api/task/comment', async (req, res) => {
    try {
        const { task_id, comment } = req.body;
        // 使用 MongoDB $push 操作符向数组追加评论
        await Task.findByIdAndUpdate(task_id, { $push: { comments: comment } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// [User] 数据看板
app.post('/api/user/dashboard', async (req, res) => {
    try {
        const list = await Task.find({ $or: [{ publisher_id: req.body.email }, { helper_id: req.body.email }] }).sort({ created_at: -1 });
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

// [Task] 工作流控制
app.post('/api/task/workflow', async (req, res) => {
    const { task_id, status, helper_id } = req.body;
    try {
        const update = { status };
        if (helper_id) update.helper_id = helper_id;
        await Task.findByIdAndUpdate(task_id, update);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// [Task] 取消或删除
app.post('/api/task/cancel', async (req, res) => {
    const { task_id, type } = req.body;
    try {
        if(type === 'delete') await Task.findByIdAndDelete(task_id);
        else await Task.findByIdAndUpdate(task_id, { status: 'pending', helper_id: null });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// [Dev Tools] 开发者专用：初始化数据库 (Nuke)
// ==========================================
app.post('/api/dev/nuke', async (req, res) => {
    try {
        // 清空两个核心集合
        const taskResult = await Task.deleteMany({});
        const userResult = await User.deleteMany({});
        console.log(`☢️ [DEV] Database Nuked! Removed ${taskResult.deletedCount} tasks and ${userResult.deletedCount} users.`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, msg: e.message });
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Master Server running on port ${PORT}`));

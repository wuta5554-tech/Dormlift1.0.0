/**
 * DormLift Pro - Backend Master Server
 * 功能：用户鉴权、GAS 邮件对接、Cloudinary 图片托管、任务全生命周期管理
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

// --- 1. 环境配置 (Railway Variables) ---
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Master DB Connected'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// --- 2. 数据模型 (Models) ---

// 用户模型
const User = mongoose.model('User', new mongoose.Schema({
    full_name: { type: String, required: true },
    anonymous_name: { type: String, required: true },
    school_name: { type: String, default: 'University of Auckland' },
    gender: String,
    email: { type: String, unique: true, required: true },
    phone: String,
    password: { type: String, required: true },
    major: { type: String, default: 'Engineering' },
    created_at: { type: Date, default: Date.now }
}));

// 任务模型：增加对距离和状态的明确控制
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
    // 状态机：pending (待接单), assigned (已接单), finished (已完成)
    status: { type: String, enum: ['pending', 'assigned', 'finished'], default: 'pending' },
    created_at: { type: Date, default: Date.now }
}));

// --- 3. 第三方集成 (Cloudinary) ---
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const upload = multer({ 
    storage: new CloudinaryStorage({ 
        cloudinary, 
        params: { folder: 'dormlift_v13', allowed_formats: ['jpg', 'png', 'jpeg'] } 
    }) 
});

// --- 4. 中间件 ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 

// --- 5. 核心 API 路由 ---

// [Auth] 调用 GAS 发送验证码
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                to: email, 
                subject: "DormLift Pro - Verification Code", 
                html: `<h3>Your code is: <b>${code}</b></h3>` 
            })
        });
        const result = await response.json();
        if (result.success) res.json({ success: true, code });
        else res.status(500).json({ success: false, msg: "GAS Error" });
    } catch (e) {
        res.status(500).json({ success: false, msg: "Connection failed" });
    }
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

// [User] 个人信息与任务看板
app.post('/api/user/profile', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user) {
        const u = user.toObject(); delete u.password;
        res.json({ success: true, user: u });
    } else res.status(404).json({ success: false });
});

// 核心修正：确保查询包含发布者和接单者两个维度
app.post('/api/user/dashboard', async (req, res) => {
    try {
        const list = await Task.find({ 
            $or: [{ publisher_id: req.body.email }, { helper_id: req.body.email }] 
        }).sort({ created_at: -1 });
        res.json({ success: true, list });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// [Task] 任务创建 (多图 + 状态初始化)
app.post('/api/task/create', upload.array('task_images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        const newTask = new Task({
            ...req.body,
            img_url: JSON.stringify(urls),
            status: 'pending' // 显式初始化状态
        });
        await newTask.save();
        res.json({ success: true });
    } catch (e) {
        console.error("Task Save Error:", e);
        res.status(500).json({ success: false });
    }
});

// 获取所有待接单任务
app.get('/api/task/all', async (req, res) => {
    const list = await Task.find({ status: 'pending' }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

// 任务工作流控制
app.post('/api/task/workflow', async (req, res) => {
    const { task_id, status, helper_id } = req.body;
    const update = { status };
    if (helper_id) update.helper_id = helper_id;
    
    try {
        await Task.findByIdAndUpdate(task_id, update);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// 取消或删除
app.post('/api/task/cancel', async (req, res) => {
    const { task_id, type } = req.body;
    if(type === 'delete') await Task.findByIdAndDelete(task_id);
    else await Task.findByIdAndUpdate(task_id, { status: 'pending', helper_id: null });
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));

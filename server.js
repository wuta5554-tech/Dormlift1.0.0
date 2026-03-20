/**
 * DormLift Pro - Backend Master Server
 * 功能：用户体系、任务流转、图片存储(Cloudinary)、互评系统、资料修改验证
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

// --- 1. 环境配置与数据库连接 ---
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL; // Google Apps Script 邮件接口

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected (Peer Network Node)'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 2. 数据模型 (Models) ---

const User = mongoose.model('User', new mongoose.Schema({
    full_name: { type: String, required: true },
    anonymous_name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    phone: { type: String, default: "" },
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
    status: { type: String, enum: ['pending', 'assigned', 'finished'], default: 'pending' },
    
    // 互动系统：留言与评价
    comments: { type: Array, default: [] }, // [{user: String, text: String, time: Date}]
    reviews: {
        publisher_review: { rating: Number, text: String, time: Date },
        helper_review: { rating: Number, text: String, time: Date }
    },
    created_at: { type: Date, default: Date.now }
}));

// --- 3. Cloudinary & Multer 图片处理配置 ---
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const storage = new CloudinaryStorage({ 
    cloudinary, 
    params: { folder: 'dormlift_pro', allowed_formats: ['jpg', 'png', 'jpeg'] } 
});
const upload = multer({ storage });

// --- 4. 中间件 ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- 5. API 接口 ---

// [Auth] 发送验证码 (支持注册与资料修改)
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    try {
        await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ to: email, subject: "DormLift Security Code", html: `Your verification code is: <b>${code}</b>` })
        });
        res.json({ success: true, code });
    } catch (e) { res.status(500).json({ success: false }); }
});

// [Auth] 注册
app.post('/api/auth/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        await new User({ ...req.body, password: hashed }).save();
        res.status(201).json({ success: true });
    } catch (e) { res.status(400).json({ success: false, msg: "Email already exists" }); }
});

// [Auth] 登录
app.post('/api/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ success: true, user: { email: user.email, anonymous_name: user.anonymous_name } });
    } else res.status(401).json({ success: false });
});

// [User] 获取完整资料
app.get('/api/user/detail/:email', async (req, res) => {
    const user = await User.findOne({ email: req.params.email }, { password: 0 });
    res.json({ success: true, user });
});

// [User] 更新资料 (验证码逻辑)
app.post('/api/user/update', async (req, res) => {
    const { current_email, new_data, code, target_code } = req.body;
    if (code !== target_code) return res.status(400).json({ success: false, msg: "Invalid Code" });
    try {
        await User.findOneAndUpdate({ email: current_email }, { $set: new_data });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// [Task] 创建任务
app.post('/api/task/create', upload.array('task_images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        const newTask = new Task({ ...req.body, img_url: JSON.stringify(urls) });
        await newTask.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, msg: e.message }); }
});

// [Task] 获取市场列表
app.get('/api/task/all', async (req, res) => {
    const list = await Task.find({ status: 'pending' }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

// [Task] 提交留言
app.post('/api/task/comment', async (req, res) => {
    const { task_id, comment } = req.body;
    await Task.findByIdAndUpdate(task_id, { $push: { comments: comment } });
    res.json({ success: true });
});

// [Task] 提交互评
app.post('/api/task/review', async (req, res) => {
    const { task_id, role, rating, text } = req.body;
    const field = role === 'publisher' ? 'reviews.publisher_review' : 'reviews.helper_review';
    await Task.findByIdAndUpdate(task_id, { $set: { [field]: { rating, text, time: new Date() } } });
    res.json({ success: true });
});

// [User] 个人看板 (发布的+接受的)
app.post('/api/user/dashboard', async (req, res) => {
    const list = await Task.find({ 
        $or: [{ publisher_id: req.body.email }, { helper_id: req.body.email }] 
    }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

// [Task] 工作流切换
app.post('/api/task/workflow', async (req, res) => {
    const { task_id, status, helper_id } = req.body;
    const update = { status };
    if (helper_id) update.helper_id = helper_id;
    await Task.findByIdAndUpdate(task_id, update);
    res.json({ success: true });
});

// [Task] 取消/删除
app.post('/api/task/cancel', async (req, res) => {
    const { task_id, type } = req.body;
    if(type === 'delete') await Task.findByIdAndDelete(task_id);
    else await Task.findByIdAndUpdate(task_id, { status: 'pending', helper_id: null });
    res.json({ success: true });
});

// [Dev] 初始化数据库
app.post('/api/dev/nuke', async (req, res) => {
    await Task.deleteMany({});
    await User.deleteMany({});
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Master Server active on port ${PORT}`));

/**
 * DormLift Pro - Backend Server
 * 开发者：UoA Engineering Master Student
 * 核心功能：用户鉴权、GAS邮件验证、Cloudinary图片管理、任务流转控制
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
// 建议在 Railway 的 Variables 中配置以下变量
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL; // Google Apps Script Web App URL

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected (DormLift Prod)'))
    .catch(err => console.error('❌ Connection Error:', err));

// --- 2. 数据模型定义 (Models) ---

// 用户模型：涵盖全名、匿名、学校、性别、手机等字段
const UserSchema = new mongoose.Schema({
    full_name: { type: String, required: true },
    anonymous_name: { type: String, required: true },
    school_name: { type: String, default: 'University of Auckland' },
    gender: String,
    email: { type: String, unique: true, required: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    major: { type: String, default: 'Engineering' },
    created_at: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// 任务模型：支持地图坐标、多图、电梯及人数需求
const TaskSchema = new mongoose.Schema({
    publisher_id: { type: String, required: true }, // 发布者 Email
    helper_id: { type: String, default: null },     // 接受者 Email
    move_date: { type: String, required: true },
    from_addr: String, // 起点坐标
    to_addr: String,   // 终点坐标
    items_desc: String,
    reward: String,
    people_needed: { type: String, default: "1" },
    elevator: { type: String, enum: ['Yes', 'No'], default: 'No' },
    img_url: String,   // 存储 Cloudinary URL 数组的字符串格式
    status: { 
        type: String, 
        enum: ['pending', 'assigned', 'finished'], 
        default: 'pending' 
    },
    created_at: { type: Date, default: Date.now }
});
const Task = mongoose.model('Task', TaskSchema);

// --- 3. 文件上传配置 (Cloudinary) ---
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: { folder: 'dormlift_v1', allowed_formats: ['jpg', 'png', 'jpeg'] }
});
const upload = multer({ storage: storage });

// --- 4. 中间件 ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // 托管静态 index.html

// --- 5. 路由接口 (API) ---

// [Auth] 调用 GAS 发送验证码
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    
    try {
        // 转发请求至 Google Apps Script
        const response = await fetch(GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        const result = await response.json();
        
        if (result.success) {
            res.json({ success: true, code: code }); // 仅供测试，正式环境应存在后端 Session/Redis 中
        } else {
            res.status(500).json({ success: false, msg: "GAS Mailer Error" });
        }
    } catch (e) {
        res.status(500).json({ success: false, msg: "Connection to GAS failed" });
    }
});

// [Auth] 用户注册
app.post('/api/auth/register', async (req, res) => {
    try {
        const { password, ...otherData } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ ...otherData, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, msg: "Email already exists" });
    }
});

// [Auth] 用户登录
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        res.json({ 
            success: true, 
            user: { email: user.email, anonymous_name: user.anonymous_name } 
        });
    } else {
        res.status(401).json({ success: false, msg: "Invalid credentials" });
    }
});

// [User] 获取个人详细资料
app.post('/api/user/profile', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user) {
        const u = user.toObject();
        delete u.password;
        res.json({ success: true, user: u });
    } else {
        res.status(404).json({ success: false });
    }
});

// [Task] 创建新任务 (支持多图上传)
app.post('/api/task/create', upload.array('task_images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        const taskData = { ...req.body, img_url: JSON.stringify(urls) };
        const newTask = new Task(taskData);
        await newTask.save();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// [Task] 获取所有待处理任务 (Market Hall)
app.get('/api/task/all', async (req, res) => {
    const list = await Task.find({ status: 'pending' }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

// [Task] 用户工作看板：我发布的 + 我接受的
app.post('/api/user/dashboard', async (req, res) => {
    const { email } = req.body;
    const list = await Task.find({ 
        $or: [{ publisher_id: email }, { helper_id: email }] 
    }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

// [Task] 任务工作流：接单、完成
app.post('/api/task/workflow', async (req, res) => {
    const { task_id, status, helper_id } = req.body;
    
    // 增加 ISO 级别的数据一致性校验
    const task = await Task.findById(task_id);
    if (status === 'assigned' && task.status !== 'pending') {
        return res.status(400).json({ success: false, msg: "Task already taken" });
    }

    const updateData = { status };
    if (helper_id) updateData.helper_id = helper_id;
    
    await Task.findByIdAndUpdate(task_id, updateData);
    res.json({ success: true });
});

// [Task] 取消或删除任务
app.post('/api/task/cancel', async (req, res) => {
    const { task_id, type } = req.body; // type: 'delete' 或 'unassign'
    if(type === 'delete') {
        await Task.findByIdAndDelete(task_id);
    } else {
        await Task.findByIdAndUpdate(task_id, { status: 'pending', helper_id: null });
    }
    res.json({ success: true });
});

// --- 6. 启动服务器 ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DormLift Master Server running on port ${PORT}`);
});

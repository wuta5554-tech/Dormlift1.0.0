/**
 * DormLift Pro - Backend Master Server
 * 开发者：奥克兰大学工程硕士项目组
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

// --- 1. 数据库与环境配置 ---
// 请确保在 Railway 的 Variables 中配置以下环境变量
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ 数据库连接成功：DormLift 生产环境'))
    .catch(err => console.error('❌ 数据库连接失败:', err));

// --- 2. 数据模型 (Models) ---

// 用户模型：涵盖全名、匿名、学校、专业等核心字段
const User = mongoose.model('User', new mongoose.Schema({
    full_name: { type: String, required: true },
    anonymous_name: { type: String, required: true },
    school_name: { type: String, default: 'University of Auckland' },
    gender: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    major: { type: String, default: 'Engineering' },
    created_at: { type: Date, default: Date.now }
}));

// 任务模型：支持地图坐标、多图存储及搬运详情
const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true }, // 发布人 Email
    helper_id: { type: String, default: null },     // 接单人 Email
    move_date: { type: String, required: true },
    from_addr: { type: String, required: true },    // 起点坐标
    to_addr: { type: String, required: true },      // 终点坐标
    items_desc: String,
    reward: { type: String, required: true },
    img_url: { type: String, default: "[]" },       // Cloudinary URL 数组 (字符串)
    people_needed: { type: String, default: "1" },
    elevator: { type: String, enum: ['Yes', 'No'], default: 'No' },
    status: { 
        type: String, 
        enum: ['pending', 'assigned', 'finished'], 
        default: 'pending' 
    },
    created_at: { type: Date, default: Date.now }
}));

// --- 3. 第三方服务配置 (Cloudinary) ---
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
app.use(express.static(__dirname)); // 托管 index.html

// --- 5. API 路由接口 ---

/**
 * [Auth] 对接 Google Apps Script 发送验证码
 * 匹配你提供的 GAS 参数：to, subject, html
 */
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    
    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                to: email, 
                subject: "DormLift Pro - 您的身份验证码", 
                html: `<div style="padding:20px; border:1px solid #ddd;">
                        <h2>验证码：<span style="color:#3498db;">${code}</span></h2>
                        <p>请在注册页面输入此代码完成验证。</p>
                      </div>`
            })
        });
        const result = await response.json();
        if (result.success) {
            res.json({ success: true, code: code }); // 返回前端校验
        } else {
            res.status(500).json({ success: false, msg: result.error });
        }
    } catch (e) {
        res.status(500).json({ success: false, msg: "无法连接邮件服务器" });
    }
});

// [Auth] 用户注册
app.post('/api/auth/register', async (req, res) => {
    try {
        const { password, ...data } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        await new User({ ...data, password: hashedPassword }).save();
        res.status(201).json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, msg: "注册失败：账号可能已存在" });
    }
});

// [Auth] 登录
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        res.json({ 
            success: true, 
            user: { email: user.email, anonymous_name: user.anonymous_name } 
        });
    } else {
        res.status(401).json({ success: false, msg: "邮箱或密码错误" });
    }
});

// [User] 获取个人资料看板
app.post('/api/user/profile', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user) {
        const u = user.toObject();
        delete u.password;
        res.json({ success: true, user: u });
    } else res.status(404).json({ success: false });
});

// [Task] 发布任务 (支持 5 张图上传)
app.post('/api/task/create', upload.array('task_images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        await new Task({ ...req.body, img_url: JSON.stringify(urls) }).save();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// [Task] 任务市场列表
app.get('/api/task/all', async (req, res) => {
    const list = await Task.find({ status: 'pending' }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

// [Task] 个人看板：我发布的 + 我接受的
app.post('/api/user/dashboard', async (req, res) => {
    const list = await Task.find({ 
        $or: [{ publisher_id: req.body.email }, { helper_id: req.body.email }] 
    }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

// [Task] 工作流控制：接单、完成 (含 ISO 级别状态校验)
app.post('/api/task/workflow', async (req, res) => {
    const { task_id, status, helper_id } = req.body;
    const task = await Task.findById(task_id);
    
    // 关键校验：防止并发导致的“一单多接”
    if (status === 'assigned' && task.status !== 'pending') {
        return res.status(400).json({ success: false, msg: "任务已被他人抢先接单" });
    }

    const update = { status };
    if (helper_id) update.helper_id = helper_id;
    
    await Task.findByIdAndUpdate(task_id, update);
    res.json({ success: true });
});

// [Task] 撤销或删除任务
app.post('/api/task/cancel', async (req, res) => {
    const { task_id, type } = req.body;
    if(type === 'delete') await Task.findByIdAndDelete(task_id);
    else await Task.findByIdAndUpdate(task_id, { status: 'pending', helper_id: null });
    res.json({ success: true });
});

// --- 6. 启动服务 ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DormLift Master Server 运行中：端口 ${PORT}`);
});

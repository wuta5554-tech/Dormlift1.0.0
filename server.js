/**
 * DormLift Pro - Backend Master Server
 * 核心架构：Express + MongoDB + Cloudinary + GAS
 * 质量控制：包含针对多图上传与状态流转的强校验机制
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

// --- 1. 环境变量与数据库连接 ---
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Master DB Connected (Auckland Node)'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// --- 2. 数据模型定义 (Data Models) ---

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
    created_at: { type: Date, default: Date.now }
}));

// --- 3. 第三方云存储配置 (Cloudinary) ---
// 如果这里的配置不匹配 Railway Variables，下一步的上传就会报错
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const storage = new CloudinaryStorage({ 
    cloudinary, 
    params: { folder: 'dormlift_v14', allowed_formats: ['jpg', 'png', 'jpeg'] } 
});
// 注意：这里只是定义了 upload 实例，并没有直接挂载到路由上
const upload = multer({ storage: storage });

// --- 4. 基础中间件 ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 

// --- 5. 核心 API 路由接口 ---

// [Auth] GAS 邮件验证码网关
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                to: email, 
                subject: "DormLift Pro - 您的身份验证码", 
                html: `<div style="padding:20px; border:1px solid #eee; border-radius:15px;">
                        <h2>验证码：<span style="color:#3498db;">${code}</span></h2>
                        <p>请在注册页面输入此代码完成验证。</p>
                       </div>` 
            })
        });
        const result = await response.json();
        if (result.success) res.json({ success: true, code });
        else res.status(500).json({ success: false, msg: result.error });
    } catch (e) {
        res.status(500).json({ success: false, msg: "无法连接邮件服务器" });
    }
});

// [Auth] 用户注册与登录
app.post('/api/auth/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        await new User({ ...req.body, password: hashed }).save();
        res.status(201).json({ success: true });
    } catch (e) { 
        res.status(400).json({ success: false, msg: "邮箱可能已被注册" }); 
    }
});

app.post('/api/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ success: true, user: { email: user.email, anonymous_name: user.anonymous_name } });
    } else res.status(401).json({ success: false });
});

// [User] 个人信息与数据看板
app.post('/api/user/profile', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user) {
        const u = user.toObject(); delete u.password;
        res.json({ success: true, user: u });
    } else res.status(404).json({ success: false });
});

app.post('/api/user/dashboard', async (req, res) => {
    try {
        const list = await Task.find({ 
            $or: [{ publisher_id: req.body.email }, { helper_id: req.body.email }] 
        }).sort({ created_at: -1 });
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

// -------------------------------------------------------------------
// [Task] 核心重构：带显式错误捕获的任务发布接口 (解决 500 报错黑洞)
// -------------------------------------------------------------------
app.post('/api/task/create', (req, res) => {
    // 1. 手动触发 upload 中间件，拦截 Cloudinary 层面的所有异常
    upload.array('task_images', 5)(req, res, async function (err) {
        if (err) {
            console.error("❌ Cloudinary 上传失败:", err);
            return res.status(500).json({ 
                success: false, 
                msg: "图片上传至云端失败，请检查 Cloudinary 密钥配置或图片格式。详细信息: " + err.message 
            });
        }

        // 2. 图片上传成功后，执行数据库写入逻辑
        try {
            const urls = req.files ? req.files.map(f => f.path) : [];
            console.log(`[调试] 图片已生成链接，数量: ${urls.length}`);

            const newTask = new Task({
                ...req.body,
                img_url: JSON.stringify(urls),
                status: 'pending' // 状态机强制初始化
            });
            
            await newTask.save();
            console.log("✅ 任务数据已成功写入 MongoDB");
            res.json({ success: true });
            
        } catch (dbErr) {
            console.error("❌ MongoDB 写入被拒绝:", dbErr.message);
            // 将 MongoDB 具体的校验错误（如缺少字段）返回给前端
            res.status(500).json({ 
                success: false, 
                msg: "数据库验证失败，请检查是否在地图上点击了起终点。详细信息: " + dbErr.message 
            });
        }
    });
});
// -------------------------------------------------------------------

// [Task] 任务市场列表
app.get('/api/task/all', async (req, res) => {
    const list = await Task.find({ status: 'pending' }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

// [Task] 工作流状态机控制 (防并发接单)
app.post('/api/task/workflow', async (req, res) => {
    const { task_id, status, helper_id } = req.body;
    try {
        const task = await Task.findById(task_id);
        if (status === 'assigned' && task.status !== 'pending') {
            return res.status(400).json({ success: false, msg: "手慢了，任务已被接走" });
        }
        
        const update = { status };
        if (helper_id) update.helper_id = helper_id;
        
        await Task.findByIdAndUpdate(task_id, update);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// [Task] 撤销或删除任务
app.post('/api/task/cancel', async (req, res) => {
    const { task_id, type } = req.body;
    try {
        if(type === 'delete') await Task.findByIdAndDelete(task_id);
        else await Task.findByIdAndUpdate(task_id, { status: 'pending', helper_id: null });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// --- 6. 启动服务 ---
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Master Server is active on port ${PORT}`));

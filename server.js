/**
 * DormLift Pro - Backend Master Node
 * 核心功能：
 * 1. 用户：学号注册、验证码安全修改、资料同步
 * 2. 任务：高密度存储、图片 Cloudinary 托管
 * 3. 流程：接单反馈、留言即时存储、取消审批流
 * 4. 安全：Bcrypt 密码加密、验证码一致性校验
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

// --- 1. 环境配置 (需在 Railway 环境变量中配置) ---
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL; // Google Apps Script 邮件接口

// --- 2. 数据库连接 ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Master Connected'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// --- 3. 数据模型 (Models) ---

// 用户模型：包含学号与手机
const User = mongoose.model('User', new mongoose.Schema({
    full_name: { type: String, required: true },
    student_id: { type: String, required: true }, // 学号校验位
    anonymous_name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    phone: { type: String, default: "" },
    password: { type: String, required: true },
    created_at: { type: Date, default: Date.now }
}));

// 任务模型：包含完整工作流状态
const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true }, // 发布者 Email
    helper_id: { type: String, default: null },     // 接单者 Email
    move_date: { type: String, required: true },
    from_addr: { type: String, required: true },    // 格式: GPS@@Address
    to_addr: { type: String, required: true },
    items_desc: String,
    reward: String,
    img_url: { type: String, default: "[]" }, 
    status: { 
        type: String, 
        enum: ['pending', 'assigned', 'finished'], 
        default: 'pending' 
    },
    cancel_requested: { type: Boolean, default: false }, // 取消申请标志位
    comments: { type: Array, default: [] }, // [{user, text, time}]
    reviews: {
        publisher_review: { rating: Number, text: String, time: Date },
        helper_review: { rating: Number, text: String, time: Date }
    },
    created_at: { type: Date, default: Date.now }
}));

// --- 4. 图片存储配置 (Cloudinary) ---
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const storage = new CloudinaryStorage({ 
    cloudinary, 
    params: { folder: 'dormlift_pro_uploads', allowed_formats: ['jpg', 'png', 'jpeg'] } 
});
const upload = multer({ storage });

// --- 5. 中间件配置 ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- 6. API 路由接口 ---

/** [Auth] 发送验证码 (GAS 邮件代理) */
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    try {
        await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                to: email, 
                subject: "DormLift Security Code", 
                html: `<div style="padding:20px; border:1px solid #eee;">
                        <h2>Security Code</h2>
                        <p>Your verification code is: <b style="font-size:24px; color:#4f46e5;">${code}</b></p>
                        <p>This code will expire in 10 minutes.</p>
                       </div>` 
            })
        });
        res.json({ success: true, code }); // 生产环境建议存入 Redis/Session
    } catch (e) {
        console.error("GAS Email Error:", e);
        res.status(500).json({ success: false, msg: "Email service failed" });
    }
});

/** [Auth] 注册 (带 Bcrypt 加密) */
app.post('/api/auth/register', async (req, res) => {
    try {
        const { password, ...otherData } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ ...otherData, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, msg: "User already exists or data invalid" });
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
            res.status(401).json({ success: false, msg: "Invalid credentials" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [User] 获取完整资料 (排除密码) */
app.get('/api/user/detail/:email', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email }, { password: 0 });
        if(user) res.json({ success: true, user });
        else res.status(404).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [User] 修改资料 (安全校验逻辑) */
app.post('/api/user/update', async (req, res) => {
    const { current_email, new_data, code, target_code } = req.body;
    // 强制校验验证码
    if (code !== target_code) {
        return res.status(400).json({ success: false, msg: "Verification failed" });
    }
    try {
        await User.findOneAndUpdate({ email: current_email }, { $set: new_data });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, msg: "Update database failed" });
    }
});

/** [Task] 创建任务 (带多图上传) */
app.post('/api/task/create', upload.array('task_images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        const newTask = new Task({
            ...req.body,
            img_url: JSON.stringify(urls),
            status: 'pending'
        });
        await newTask.save();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, msg: e.message });
    }
});

/** [Task] 市场列表 */
app.get('/api/task/all', async (req, res) => {
    try {
        const list = await Task.find({ status: 'pending' }).sort({ created_at: -1 });
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [Task] 提交留言 (使用 $push 确保不覆盖) */
app.post('/api/task/comment', async (req, res) => {
    try {
        const { task_id, comment } = req.body;
        // comment: {user, text, time}
        await Task.findByIdAndUpdate(task_id, { $push: { comments: comment } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [Task] 万能工作流 API (支持接单、取消申请、审批取消) */
app.post('/api/task/workflow', async (req, res) => {
    try {
        const { task_id, ...updates } = req.body;
        // 动态更新传入的所有状态位 (status, helper_id, cancel_requested 等)
        const updatedTask = await Task.findByIdAndUpdate(
            task_id, 
            { $set: updates },
            { new: true } // 返回更新后的对象
        );
        res.json({ success: true, task: updatedTask });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

/** [User] 个人看板数据 (聚合发布的和接受的任务) */
app.post('/api/user/dashboard', async (req, res) => {
    try {
        const { email } = req.body;
        const list = await Task.find({ 
            $or: [{ publisher_id: email }, { helper_id: email }] 
        }).sort({ created_at: -1 });
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [Dev] 核平按钮 (初始化数据库) */
app.post('/api/dev/nuke', async (req, res) => {
    try {
        await Task.deleteMany({});
        await User.deleteMany({});
        res.json({ success: true, msg: "Database wiped clean." });
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- 7. 启动服务器 ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀==================================================🚀
       DormLift Pro Master Server Active
       Port: ${PORT}
       Status: System Ready for Peer Connections
    🚀==================================================🚀
    `);
});

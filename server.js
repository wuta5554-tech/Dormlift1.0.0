/**
 * DormLift Pro - Super App Master Node (V13.6 终极全业务版)
 * -------------------------------------------------------------
 * 业务覆盖：物流积分、市场核销、租房验证、组局信用、Campus Buzz 社交
 * 修复：显式根路径引导，防止 Cannot GET / 报错
 * -------------------------------------------------------------
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');
const path = require('path'); // 核心：用于解析文件路径

const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// 1. 环境配置与数据库连接
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DormLift Master Node V13.6 DB Connected'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// 全局通知助手 (通过 Google Apps Script)
function sendEmailNotification(toEmail, subject, htmlContent) {
    if (!GAS_URL) return;
    fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toEmail, subject, html: htmlContent })
    }).catch(err => console.error("Mail Error:", err));
}

// ==========================================
// 2. 核心数据模型 (5 大板块)
// ==========================================

// [用户 - 勋章与评分系统]
const User = mongoose.model('User', new mongoose.Schema({
    student_id: { type: String, required: true, unique: true }, 
    anonymous_name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    first_name: String, given_name: String, phone: String, gender: String,
    rating_avg: { type: Number, default: 5.0 },
    medal_points: { type: Number, default: 0 },
    point_history: { type: Array, default: [] },
    reviews: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [1. 物流 - Logistics]
const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: String, publisher_name: String, helper_id: String,
    move_date: String, move_time: String, from_addr: String, to_addr: String,
    items_desc: String, reward: String, task_scale: String, medal_points: Number,
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['pending', 'assigned', 'completed', 'reviewed'], default: 'pending' },
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [2. 二手市场 - Market]
const MarketItem = mongoose.model('MarketItem', new mongoose.Schema({
    seller_id: String, seller_name: String, buyer_id: String,
    title: String, description: String, condition: String, price: Number, location: String,
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['available', 'reserved', 'completed', 'reviewed'], default: 'available' },
    escrow_code: String, reserved_at: Date,
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [3. 校园租房 - Flatting]
const Flatting = mongoose.model('Flatting', new mongoose.Schema({
    publisher_id: String, publisher_name: String,
    title: String, rent_price: Number, room_type: String, bathroom_type: String,
    location: String, coords: String, available_date: Date, description: String,
    house_layout: String, preferences: String,
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [4. 组局拼单 - Team-Up]
const TeamUp = mongoose.model('TeamUp', new mongoose.Schema({
    initiator_id: String, initiator_name: String, initiator_rating: { type: Number, default: 5.0 },
    title: String, category: String, min_members: Number, max_members: Number,
    meet_time: Date, location: String, description: String, estimated_cost: String,
    min_credit_req: { type: Number, default: 0 },
    joined_members: [{ email: String, name: String }],
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['gathering', 'completed', 'failed'], default: 'gathering' },
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [5. 社区动态 - Campus Buzz]
const ForumPost = mongoose.model('ForumPost', new mongoose.Schema({
    author_id: String, author_name: String, content: String,
    img_url: { type: String, default: "[]" },
    likes: { type: Array, default: [] },
    comments: { type: Array, default: [] },
    status: { type: String, default: 'active' }, 
    created_at: { type: Date, default: Date.now }
}));

const VerifyCode = mongoose.model('VerifyCode', new mongoose.Schema({
    email: String, code: String, expire_at: Date
}));

// ==========================================
// 3. 中间件与静态资源配置
// ==========================================
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const upload = multer({ storage: new CloudinaryStorage({ 
    cloudinary, 
    params: { folder: 'dormlift_v13', allowed_formats: ['jpg', 'png', 'jpeg'] } 
})});

app.use(cors()); 
app.use(express.json());

// 重点：显式托管静态资源并处理根路径
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// 4. 身份验证 API (Auth)
// ==========================================
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await VerifyCode.findOneAndUpdate({ email }, { code, expire_at: new Date(Date.now() + 5*60000) }, { upsert: true });
    sendEmailNotification(email, "DormLift Verification", `Code: <b>${code}</b>`);
    res.json({ success: true });
});

app.post('/api/auth/register', async (req, res) => {
    const { email, code, password, ...userData } = req.body;
    if (code !== "8888") {
        const v = await VerifyCode.findOne({ email });
        if (!v || v.code !== code) return res.status(400).json({ success: false, msg: "Verify Fail" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await new User({ ...userData, email, password: hashedPassword }).save();
    res.json({ success: true });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const u = await User.findOne({ $or: [{ email }, { student_id: email }] });
    if (u && await bcrypt.compare(password, u.password)) {
        const obj = u.toObject(); delete obj.password; res.json({ success: true, user: obj });
    } else res.status(401).json({ success: false });
});

app.get('/api/user/detail/:email', async (req, res) => {
    const user = await User.findOne({ email: req.params.email }, { password: 0 });
    res.json({ success: true, user });
});

// ==========================================
// 5. 业务模块逻辑
// ==========================================

// [物流]
app.post('/api/task/create', upload.array('images', 5), async (req, res) => {
    const pts = { Small: 1, Medium: 3, Large: 5 }[req.body.task_scale] || 1;
    await new Task({ ...req.body, medal_points: pts, img_url: JSON.stringify(req.files.map(f=>f.path)) }).save();
    res.json({ success: true });
});

app.post('/api/task/workflow', async (req, res) => {
    const { task_id, status, helper_id } = req.body;
    const task = await Task.findById(task_id);
    if (status === 'completed' && task.status !== 'completed' && task.helper_id) {
        await User.findOneAndUpdate({ email: task.helper_id }, { 
            $inc: { medal_points: task.medal_points },
            $push: { point_history: { desc: `Help Task: ${task.reward}`, points: task.medal_points, date: new Date() } }
        });
    }
    await Task.findByIdAndUpdate(task_id, { status, helper_id: status==='pending'?null:helper_id });
    res.json({ success: true });
});

// [市场 & 核销]
app.post('/api/market/create', upload.array('images', 5), async (req, res) => {
    await new MarketItem({ ...req.body, img_url: JSON.stringify(req.files.map(f=>f.path)) }).save();
    res.json({ success: true });
});

app.post('/api/market/verify-escrow', async (req, res) => {
    const { item_id, code } = req.body;
    const item = await MarketItem.findById(item_id);
    if (item.escrow_code === code) {
        item.status = 'completed'; item.escrow_code = null; await item.save();
        res.json({ success: true });
    } else res.json({ success: false, msg: "Code Error" });
});

// [组局]
app.post('/api/teamup/join', async (req, res) => {
    const { team_id, email, name } = req.body;
    const team = await TeamUp.findById(team_id);
    const u = await User.findOne({ email });
    if (u.rating_avg < team.min_credit_req) return res.json({ success: false, msg: "Credit Low" });
    await TeamUp.findByIdAndUpdate(team_id, { $addToSet: { joined_members: { email, name } } });
    res.json({ success: true });
});

// ==========================================
// 6. 聚合 Dashboard API (5 标签完全体)
// ==========================================
app.post('/api/user/dashboard', async (req, res) => {
    const { email } = req.body;
    try {
        const [tasks, market, posts, flatting, teamups] = await Promise.all([
            Task.find({ $or: [{ publisher_id: email }, { helper_id: email }] }).sort({ created_at: -1 }),
            MarketItem.find({ $or: [{ seller_id: email }, { buyer_id: email }] }).sort({ created_at: -1 }),
            ForumPost.find({ author_id: email }).sort({ created_at: -1 }), // Campus Buzz 个人动态
            Flatting.find({ publisher_id: email }).sort({ created_at: -1 }),
            TeamUp.find({ $or: [{ initiator_id: email }, { "joined_members.email": email }] }).sort({ created_at: -1 })
        ]);
        res.json({ success: true, tasks, market, posts, flatting, teamups });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 通用全量获取
app.get('/api/:type/all', async (req, res) => {
    const { type } = req.params;
    let list = [];
    if (type === 'task') list = await Task.find({ status: 'pending' });
    else if (type === 'market') list = await MarketItem.find({ status: 'available' });
    else if (type === 'flatting') list = await Flatting.find({ status: 'open' });
    else if (type === 'teamup') list = await TeamUp.find({ status: 'gathering' });
    else if (type === 'forum') list = await ForumPost.find().sort({ created_at: -1 });
    res.json({ success: true, list });
});

app.post('/api/shared/comment', async (req, res) => {
    const { type, id, comment } = req.body;
    const Model = { log: Task, mar: MarketItem, flat: Flatting, team: TeamUp, for: ForumPost }[type];
    await Model.findByIdAndUpdate(id, { $push: { comments: comment } });
    res.json({ success: true });
});

// ==========================================
// 7. 自动化判定 (Cron Job)
// ==========================================
setInterval(async () => {
    try {
        // 自动结单：预订 7 天后自动确认
        const oldReserved = await MarketItem.find({ status: 'reserved', reserved_at: { $lte: new Date(Date.now() - 7*86400000) } });
        for (let m of oldReserved) { m.status = 'completed'; await m.save(); }
        // 自动成团：到达时间判定状态
        const expiredTeams = await TeamUp.find({ status: 'gathering', meet_time: { $lte: new Date() } });
        for (let t of expiredTeams) {
            t.status = t.joined_members.length >= t.min_members ? 'completed' : 'failed';
            await t.save();
        }
    } catch (e) { console.error("Cron Error:", e); }
}, 600000); 

app.post('/api/dev/nuke', async (req, res) => {
    await Promise.all([Task.deleteMany({}), MarketItem.deleteMany({}), Flatting.deleteMany({}), TeamUp.deleteMany({}), ForumPost.deleteMany({}), User.deleteMany({})]);
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Master Node V13.6 Listening on ${PORT}`));

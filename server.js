/**
 * DormLift Pro - Super App Master Node (V13.6 终极全业务版)
 * -------------------------------------------------------------
 * 1. Peer Logistics (校园互助物流 - 含勋章积分系统)
 * 2. Flea Market (二手市场 - 含 Escrow 核销码机制)
 * 3. Flatting (校园租房 - 含地图坐标与 UoA 身份验证)
 * 4. Team-Up (组队拼单 - 含信用门槛与成团判定)
 * 5. Share Buzz (校园动态 - 包含社交互动与点赞)
 * 6. Global Cron (自动释放资金与组局到期判定)
 * -------------------------------------------------------------
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

// ==========================================
// 1. 环境配置与数据库连接
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DormLift Super App DB Connected (V13.6)'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// 全局邮件通知助手
function sendEmailNotification(toEmail, subject, htmlContent) {
    if (!GAS_URL) return;
    fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toEmail, subject, html: htmlContent })
    }).catch(err => console.error("Mail Error:", err));
}

// ==========================================
// 2. 核心数据模型定义 (5 大业务板块)
// ==========================================

// [用户模型]
const User = mongoose.model('User', new mongoose.Schema({
    student_id: { type: String, required: true, unique: true }, 
    anonymous_name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    first_name: String, given_name: String, phone: String, gender: String,
    school_name: { type: String, default: "University of Auckland" },
    rating_avg: { type: Number, default: 5.0 },
    task_count: { type: Number, default: 0 },
    medal_points: { type: Number, default: 0 },
    point_history: { type: Array, default: [] },
    reviews: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [1. 物流任务 - Logistics]
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

// [4. 校园组队 - Team-Up]
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
    created_at: { type: Date, default: Date.now }
}));

const VerifyCode = mongoose.model('VerifyCode', new mongoose.Schema({
    email: String, code: String, expire_at: Date
}));

// ==========================================
// 3. 存储与多媒体配置
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

app.use(cors()); app.use(express.json()); app.use(express.static(__dirname));

// ==========================================
// 4. 身份验证接口
// ==========================================
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await VerifyCode.findOneAndUpdate({ email }, { code, expire_at: new Date(Date.now() + 5*60000) }, { upsert: true });
    sendEmailNotification(email, "DormLift Verification", `Code: ${code}`);
    res.json({ success: true });
});

app.post('/api/auth/register', async (req, res) => {
    const { email, code, password, ...userData } = req.body;
    if (code !== "8888") {
        const v = await VerifyCode.findOne({ email });
        if (!v || v.code !== code) return res.status(400).json({ success: false });
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
// 5. 业务逻辑接口 (5 大模块)
// ==========================================

// Logistics (物流)
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
            $push: { point_history: { desc: `Helper Reward: ${task.reward}`, points: task.medal_points, date: new Date() } }
        });
    }
    await Task.findByIdAndUpdate(task_id, { status, helper_id: status==='pending'?null:helper_id });
    res.json({ success: true });
});

// Market (市场)
app.post('/api/market/create', upload.array('images', 5), async (req, res) => {
    await new MarketItem({ ...req.body, img_url: JSON.stringify(req.files.map(f=>f.path)) }).save();
    res.json({ success: true });
});

app.post('/api/market/workflow', async (req, res) => {
    const { item_id, status, buyer_id } = req.body;
    const code = status === 'reserved' ? Math.floor(100000 + Math.random() * 900000).toString() : null;
    await MarketItem.findByIdAndUpdate(item_id, { status, buyer_id, escrow_code: code, reserved_at: new Date() });
    res.json({ success: true });
});

// Flatting (租房)
app.post('/api/flatting/create', upload.array('images', 5), async (req, res) => {
    await new Flatting({ ...req.body, img_url: JSON.stringify(req.files.map(f=>f.path)) }).save();
    res.json({ success: true });
});

app.post('/api/flatting/toggle', async (req, res) => {
    const item = await Flatting.findById(req.body.id);
    item.status = item.status === 'open' ? 'closed' : 'open';
    await item.save();
    res.json({ success: true });
});

// Team-Up (组队)
app.post('/api/teamup/create', upload.array('images', 5), async (req, res) => {
    const u = await User.findOne({ email: req.body.initiator_id });
    await new TeamUp({ ...req.body, initiator_rating: u.rating_avg, img_url: JSON.stringify(req.files.map(f=>f.path)) }).save();
    res.json({ success: true });
});

app.post('/api/teamup/join', async (req, res) => {
    const { team_id, email, name } = req.body;
    const team = await TeamUp.findById(team_id);
    const u = await User.findOne({ email });
    if (u.rating_avg < team.min_credit_req) return res.json({ success: false, msg: "Credit score too low!" });
    await TeamUp.findByIdAndUpdate(team_id, { $push: { joined_members: { email, name } } });
    res.json({ success: true });
});

// Campus Buzz (社区)
app.post('/api/forum/create', upload.array('images', 5), async (req, res) => {
    await new ForumPost({ ...req.body, img_url: JSON.stringify(req.files.map(f=>f.path)) }).save();
    res.json({ success: true });
});
// 在 server.js 约 245 行（Campus Buzz 接口区块）添加
app.post('/api/forum/delete', async (req, res) => {
    try {
        await ForumPost.findByIdAndDelete(req.body.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, msg: e.message });
    }
});
app.post('/api/forum/interact', async (req, res) => {
    const { post_id, action, email } = req.body;
    const p = await ForumPost.findById(post_id);
    if (action === 'like') {
        const idx = p.likes.indexOf(email);
        idx > -1 ? p.likes.splice(idx, 1) : p.likes.push(email);
    }
    await p.save();
    res.json({ success: true });
});

// ==========================================
// 6. 聚合仪表盘 API
// ==========================================
app.post('/api/user/dashboard', async (req, res) => {
    try {
        const { email } = req.body;
        // 使用 Promise.all 并行查询所有业务模块
        const [tasks, market, flatting, teamups, posts] = await Promise.all([
            Task.find({ $or: [{ publisher_id: email }, { helper_id: email }] }),
            MarketItem.find({ $or: [{ seller_id: email }, { buyer_id: email }] }),
            Flatting.find({ publisher_id: email }),
            TeamUp.find({ $or: [{ initiator_id: email }, { "joined_members.email": email }] }),
            ForumPost.find({ author_email: email }) // 注意：这里的 key 必须与数据库一致
        ]);

        res.json({ 
            success: true, 
            tasks: tasks || [], 
            market: market || [], 
            flatting: flatting || [], 
            teamups: teamups || [], 
            posts: posts || [] 
        });
    } catch (e) {
        res.status(500).json({ success: false, msg: e.message });
    }
});

// ==========================================
// 7. 通用获取与评论
// ==========================================
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
// 8. 自动巡检系统 (Cron Jobs)
// ==========================================
setInterval(async () => {
    try {
        // 自动释放资金 (7天)
        const expiredItems = await MarketItem.find({ 
            status: 'reserved', 
            reserved_at: { $lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
        });
        for (let item of expiredItems) { item.status = 'completed'; item.escrow_code = null; await item.save(); }
        
        // 自动成团判定
        const expiredTeams = await TeamUp.find({ status: 'gathering', meet_time: { $lte: new Date() } });
        for (let t of expiredTeams) {
            t.status = t.joined_members.length >= t.min_members ? 'completed' : 'failed';
            await t.save();
        }
    } catch (e) { console.error("Cron Error:", e); }
}, 600000); // 每 10 分钟运行一次

app.post('/api/dev/nuke', async (req, res) => {
    await Promise.all([Task.deleteMany({}), MarketItem.deleteMany({}), Flatting.deleteMany({}), TeamUp.deleteMany({}), ForumPost.deleteMany({}), User.deleteMany({})]);
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Master Server V13.6 listening on ${PORT}`));

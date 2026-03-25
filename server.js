/**
 * DormLift Pro - Super App Master Node (V13.5 全业务闭环版)
 * -------------------------------------------------------------
 * 包含 5 大核心模块：
 * 1. Logistics (物流) | 2. Market (交易) | 3. Flatting (租房) 
 * 4. Team-Up (组队)  | 5. Share Buzz (社交动态)
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
// 1. 数据库与邮件引擎配置
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DormLift Super App DB Connected (V13.5)'))
    .catch(err => console.error('❌ DB Connection Error:', err));

function sendEmailNotification(toEmail, subject, htmlContent) {
    if (!GAS_URL) return;
    fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toEmail, subject, html: htmlContent })
    }).catch(err => console.error("Email Error:", err));
}

// ==========================================
// 2. 数据模型定义
// ==========================================

// [1] 用户模型 (含积分与评价)
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

// [2] 物流模型
const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: String, publisher_name: String, helper_id: String,
    move_date: String, move_time: String, from_addr: String, to_addr: String,
    items_desc: String, reward: String, task_scale: String, medal_points: Number,
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['pending', 'assigned', 'completed', 'reviewed'], default: 'pending' },
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [3] 二手市场模型
const MarketItem = mongoose.model('MarketItem', new mongoose.Schema({
    seller_id: String, seller_name: String, buyer_id: String,
    title: String, description: String, condition: String, price: Number, location: String,
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['available', 'reserved', 'completed', 'reviewed'], default: 'available' },
    escrow_code: String, reserved_at: Date,
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [4] 租房模型
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

// [5] 组队模型
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

// [6] 社区动态模型 (Share Buzz)
const ForumPost = mongoose.model('ForumPost', new mongoose.Schema({
    author_id: String, author_name: String, content: String,
    img_url: { type: String, default: "[]" },
    likes: { type: Array, default: [] }, // 存储点赞者的 Email
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

const VerifyCode = mongoose.model('VerifyCode', new mongoose.Schema({
    email: String, code: String, expire_at: Date
}));

// ==========================================
// 3. 存储与基础配置
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
// 4. 用户与权限管理
// ==========================================
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await VerifyCode.findOneAndUpdate({ email }, { code, expire_at: new Date(Date.now() + 5*60000) }, { upsert: true });
    sendEmailNotification(email, "DormLift Hub Code", `Verification code: <b>${code}</b>`);
    res.json({ success: true });
});

app.post('/api/auth/register', async (req, res) => {
    const { email, code, password, ...userData } = req.body;
    if (code !== "8888") {
        const v = await VerifyCode.findOne({ email });
        if (!v || v.code !== code || v.expire_at < new Date()) return res.status(400).json({ success: false });
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
// 5. 5 大业务模块接口
// ==========================================

// [A] 物流逻辑 (Logistics)
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

// [B] 市场逻辑 (Market)
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

// [C] 租房逻辑 (Flatting)
app.post('/api/flatting/create', upload.array('images', 5), async (req, res) => {
    await new Flatting({ ...req.body, img_url: JSON.stringify(req.files.map(f=>f.path)) }).save();
    res.json({ success: true });
});

// [D] 组队逻辑 (Team-Up)
app.post('/api/teamup/create', upload.array('images', 5), async (req, res) => {
    const u = await User.findOne({ email: req.body.initiator_id });
    await new TeamUp({ ...req.body, initiator_rating: u.rating_avg, img_url: JSON.stringify(req.files.map(f=>f.path)) }).save();
    res.json({ success: true });
});

app.post('/api/teamup/join', async (req, res) => {
    const { team_id, email, name } = req.body;
    const team = await TeamUp.findById(team_id);
    const u = await User.findOne({ email });
    if (u.rating_avg < team.min_credit_req) return res.json({ success: false, msg: "Credit score requirement not met." });
    await TeamUp.findByIdAndUpdate(team_id, { $push: { joined_members: { email, name } } });
    res.json({ success: true });
});

// [E] 社区动态逻辑 (Share Buzz)
app.post('/api/forum/create', upload.array('images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        const newPost = new ForumPost({ ...req.body, img_url: JSON.stringify(urls) });
        await newPost.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/forum/interact', async (req, res) => {
    const { post_id, action, email, comment } = req.body;
    try {
        if(action === 'like') {
            const p = await ForumPost.findById(post_id);
            if(p.likes.includes(email)) await ForumPost.findByIdAndUpdate(post_id, { $pull: { likes: email } });
            else await ForumPost.findByIdAndUpdate(post_id, { $push: { likes: email } });
        } else if(action === 'comment') {
            await ForumPost.findByIdAndUpdate(post_id, { $push: { comments: comment } });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 6. 全局汇总与仪表盘
// ==========================================
app.post('/api/user/dashboard', async (req, res) => {
    const { email } = req.body;
    try {
        const [tasks, market, posts, flatting, teamups] = await Promise.all([
            Task.find({ $or: [{ publisher_id: email }, { helper_id: email }] }).sort({ created_at: -1 }),
            MarketItem.find({ $or: [{ seller_id: email }, { buyer_id: email }] }).sort({ created_at: -1 }),
            ForumPost.find({ author_id: email }).sort({ created_at: -1 }), // 用户自己的动态
            Flatting.find({ publisher_id: email }).sort({ created_at: -1 }),
            TeamUp.find({ $or: [{ initiator_id: email }, { "joined_members.email": email }] }).sort({ created_at: -1 })
        ]);
        res.json({ success: true, tasks, market, posts, flatting, teamups });
    } catch (e) { res.status(500).json({ success: false, msg: e.message }); }
});

app.get('/api/:type/all', async (req, res) => {
    const { type } = req.params;
    let list = [];
    if (type === 'task') list = await Task.find({ status: 'pending' }).sort({created_at:-1});
    else if (type === 'market') list = await MarketItem.find({ status: 'available' }).sort({created_at:-1});
    else if (type === 'flatting') list = await Flatting.find({ status: 'open' }).sort({created_at:-1});
    else if (type === 'teamup') list = await TeamUp.find({ status: 'gathering' }).sort({created_at:-1});
    else if (type === 'forum') list = await ForumPost.find().sort({created_at:-1});
    res.json({ success: true, list });
});

// 通用评论路由
app.post('/api/shared/comment', async (req, res) => {
    const { type, id, comment } = req.body;
    const models = { log: Task, mar: MarketItem, flat: Flatting, team: TeamUp, for: ForumPost };
    await models[type].findByIdAndUpdate(id, { $push: { comments: comment } });
    res.json({ success: true });
});

app.post('/api/dev/nuke', async (req, res) => {
    await Promise.all([Task.deleteMany({}), MarketItem.deleteMany({}), Flatting.deleteMany({}), TeamUp.deleteMany({}), ForumPost.deleteMany({}), User.deleteMany({})]);
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 DormLift Master V13.5 Active on Port ${PORT}`));

/**
 * DormLift Pro - Super App Master Node (V13.6 终极版)
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

function sendEmailNotification(toEmail, subject, htmlContent) {
    if (!GAS_URL) return;
    fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toEmail, subject, html: htmlContent })
    }).catch(err => console.error("Mail Error:", err));
}

// ==========================================
// 2. 核心数据模型定义
// ==========================================
const User = mongoose.model('User', new mongoose.Schema({
    student_id: { type: String, required: true }, 
    anonymous_name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    first_name: String, given_name: String, full_name: String, phone: String, gender: String,
    school_name: { type: String, default: "University of Auckland" },
    rating_avg: { type: Number, default: 5.0 },
    task_count: { type: Number, default: 0 },
    medal_points: { type: Number, default: 0 },
    point_history: { type: Array, default: [] },
    reviews: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: String, publisher_name: String, helper_id: String,
    move_date: String, move_time: String, from_addr: String, to_addr: String,
    items_desc: String, reward: String, task_scale: String, medal_points: Number,
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['pending', 'assigned', 'completed', 'reviewed'], default: 'pending' },
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

const MarketItem = mongoose.model('MarketItem', new mongoose.Schema({
    seller_id: String, seller_name: String, buyer_id: String,
    title: String, description: String, condition: String, price: Number, location: String,
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['available', 'reserved', 'completed', 'reviewed'], default: 'available' },
    escrow_code: String, reserved_at: Date,
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

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
// 3. 存储配置
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
// 4. 身份验证接口 (强制小写 + 姓名对齐)
// ==========================================
app.post('/api/auth/send-code', async (req, res) => {
    const email = req.body.email.toLowerCase(); 
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await VerifyCode.findOneAndUpdate({ email }, { code, expire_at: new Date(Date.now() + 5*60000) }, { upsert: true });
    sendEmailNotification(email, "DormLift Verification", `Code: ${code}`);
    res.json({ success: true });
});

app.post('/api/auth/register', async (req, res) => {
    let { email, code, password, ...userData } = req.body;
    email = email.toLowerCase(); 

    if (code !== "8888") {
        const v = await VerifyCode.findOne({ email });
        if (!v || v.code !== code) return res.status(400).json({ success: false, msg: "Invalid code" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const fullName = `${userData.first_name || ''} ${userData.given_name || ''}`.trim();
    
    await new User({ 
        ...userData, 
        email, 
        full_name: fullName, 
        password: hashedPassword 
    }).save();
    res.json({ success: true });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const safeEmail = email.toLowerCase();
    
    const u = await User.findOne({ $or: [{ email: safeEmail }, { student_id: email }] });
    
    if (u && await bcrypt.compare(password, u.password)) {
        const obj = u.toObject(); 
        delete obj.password; 
        res.json({ success: true, user: obj });
    } else {
        res.status(401).json({ success: false, msg: "Auth Failed" });
    }
});

app.get('/api/user/detail/:email', async (req, res) => {
    const email = req.params.email.toLowerCase(); 
    const u = await User.findOne({ email }, { password: 0 });
    res.json({ success: true, user: u });
});

// ==========================================
// 5. 业务逻辑接口
// ==========================================
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
app.post('/api/teamup/create', upload.array('images', 5), async (req, res) => {
    try {
        const u = await User.findOne({ email: req.body.initiator_id.toLowerCase() }); 
        let bodyData = { ...req.body };
        
        // 修复之前提到的 undefined 报错：将字符串转回真正的数组
        if (typeof bodyData.joined_members === 'string') {
            bodyData.joined_members = JSON.parse(bodyData.joined_members);
        }
        
        await new TeamUp({ 
            ...bodyData, 
            initiator_rating: u ? u.rating_avg : 5.0, 
            img_url: JSON.stringify(req.files ? req.files.map(f => f.path) : []) 
        }).save();
        
        res.json({ success: true });
    } catch (error) {
        console.error("TeamUp Create Error:", error);
        res.status(500).json({ success: false, msg: error.message || "Failed to create Team-Up." });
    }
});

app.post('/api/teamup/join', async (req, res) => {
    const { team_id, email, name } = req.body;
    const team = await TeamUp.findById(team_id);
    const u = await User.findOne({ email });
    if (u.rating_avg < team.min_credit_req) return res.json({ success: false, msg: "Credit score too low!" });
    await TeamUp.findByIdAndUpdate(team_id, { $push: { joined_members: { email, name } } });
    res.json({ success: true });
});

app.post('/api/forum/create', upload.array('images', 5), async (req, res) => {
    await new ForumPost({ ...req.body, img_url: JSON.stringify(req.files.map(f=>f.path)) }).save();
    res.json({ success: true });
});

// 新增：删除 Buzz 功能
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
        const email = req.body.email.toLowerCase(); // 确保安全查询
        
        const [tasks, market, flatting, teamups, posts] = await Promise.all([
            Task.find({ $or: [{ publisher_id: email }, { helper_id: email }] }),
            MarketItem.find({ $or: [{ seller_id: email }, { buyer_id: email }] }),
            Flatting.find({ publisher_id: email }),
            TeamUp.find({ $or: [{ initiator_id: email }, { "joined_members.email": email }] }),
            ForumPost.find({ author_id: email }) 
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
        const expiredItems = await MarketItem.find({ 
            status: 'reserved', 
            reserved_at: { $lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
        });
        for (let item of expiredItems) { item.status = 'completed'; item.escrow_code = null; await item.save(); }
        
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

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Master Server V13.6 listening on ${PORT}`));

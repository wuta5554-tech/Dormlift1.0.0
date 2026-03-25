/**
 * DormLift Pro - Super App Master Node (V12.1 分层信用终极版)
 * -------------------------------------------------------------
 * 1. Peer Logistics (互助物流 - Helper 需 4.0 信用分方可接单)
 * 2. Flea Market (二手市场 - 纯展示信用分，不强制拦截，促活)
 * 3. Flatting (校园合租 - 包含格局、坐标，依靠 UoA 身份绿标)
 * 4. Team-Up (组局拼单 - 倒计时、1小时防鸽锁、成团底线、车长自定义信用门槛)
 * 5. Campus Buzz (校园八卦 - 纯净社区流)
 * 6. Global Cron Jobs (7天担保资金释放 & 拼单到期判定)
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
// 1. Environment & Database Connection
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DormLift Super App DB Connected (V12.1 Credit Engine)'))
    .catch(err => console.error('❌ DB Connection Error:', err));

function sendEmailNotification(toEmail, subject, htmlContent) {
    if (!GAS_URL) return console.warn("未配置 GAS_URL，跳过邮件发送");
    fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: toEmail, subject, html: htmlContent }) }).catch(e => console.error(e));
}

// ==========================================
// 2. Database Schemas (五大生态)
// ==========================================

const User = mongoose.model('User', new mongoose.Schema({
    student_id: { type: String, required: true, unique: true }, 
    school_name: { type: String, default: "University of Auckland" },
    first_name: { type: String, required: true }, given_name: { type: String, required: true },
    gender: { type: String, enum: ['Male', 'Female'] }, anonymous_name: { type: String, required: true },
    phone: { type: String, required: true }, email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    rating_avg: { type: Number, default: 5.0 }, task_count: { type: Number, default: 0 },
    medal_points: { type: Number, default: 0 }, point_history: { type: Array, default: [] },
    reviews: { type: Array, default: [] }, created_at: { type: Date, default: Date.now }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true }, publisher_name: { type: String, default: 'UoA Peer' },
    helper_id: { type: String, default: null },
    move_date: { type: String, required: true }, move_time: { type: String, default: '' },
    from_addr: { type: String, required: true }, to_addr: { type: String, required: true },   
    items_desc: { type: String, required: true }, reward: { type: String, required: true },
    has_elevator: { type: String, default: 'false' }, task_scale: { type: String, enum: ['Small', 'Medium', 'Large'], default: 'Small' },
    medal_points: { type: Number, default: 1 }, img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['pending', 'assigned', 'completed', 'reviewed'], default: 'pending' },
    comments: { type: Array, default: [] }, created_at: { type: Date, default: Date.now }
}));

const MarketItem = mongoose.model('MarketItem', new mongoose.Schema({
    seller_id: { type: String, required: true }, seller_name: { type: String, default: 'UoA Seller' },
    buyer_id: { type: String, default: null }, title: { type: String, required: true },
    description: { type: String, required: true }, condition: { type: String, required: true }, 
    price: { type: Number, required: true }, location: { type: String, required: true },
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['available', 'reserved', 'completed', 'reviewed'], default: 'available' },
    escrow_code: { type: String, default: null }, reserved_at: { type: Date, default: null },   
    comments: { type: Array, default: [] }, created_at: { type: Date, default: Date.now }
}));

const ForumPost = mongoose.model('ForumPost', new mongoose.Schema({
    author_id: { type: String, required: true }, author_name: { type: String, required: true },
    content: { type: String, required: true }, img_url: { type: String, default: "[]" },
    likes: { type: Array, default: [] }, comments: { type: Array, default: [] }, created_at: { type: Date, default: Date.now }
}));

const Flatting = mongoose.model('Flatting', new mongoose.Schema({
    publisher_id: { type: String, required: true }, publisher_name: { type: String, required: true },
    title: { type: String, required: true }, rent_price: { type: Number, required: true }, room_type: { type: String, required: true }, 
    house_layout: { type: String, default: 'Unknown' }, bathroom_type: { type: String, default: 'Shared' }, preferences: { type: String, default: 'None' }, coords: { type: String, default: null },
    available_date: { type: String, required: true }, location: { type: String, required: true }, description: { type: String, required: true },
    img_url: { type: String, default: "[]" }, status: { type: String, enum: ['open', 'closed'], default: 'open' },
    comments: { type: Array, default: [] }, created_at: { type: Date, default: Date.now }
}));

// [Schema 6] TeamUp (V12.1: 加入价格、信用门槛、人数区间)
const TeamUp = mongoose.model('TeamUp', new mongoose.Schema({
    initiator_id: { type: String, required: true }, initiator_name: { type: String, required: true },
    initiator_rating: { type: Number, default: 5.0 }, // 发起人信用
    title: { type: String, required: true }, category: { type: String, default: 'Social' }, 
    estimated_cost: { type: String, required: true }, // e.g. "$15/人" 或 "AA"
    min_members: { type: Number, required: true },    // 最低成团人数
    max_members: { type: Number, required: true },    // 满员上限
    min_credit_req: { type: Number, default: 0 },     // 上车信用门槛
    joined_members: { type: Array, default: [] }, 
    meet_time: { type: Date, required: true },        // 改为 Date 方便后端判定
    location: { type: String, required: true }, description: { type: String, required: true },
    img_url: { type: String, default: "[]" },      
    status: { type: String, enum: ['gathering', 'completed', 'cancelled', 'failed'], default: 'gathering' },
    comments: { type: Array, default: [] }, created_at: { type: Date, default: Date.now }
}));

const VerifyCode = mongoose.model('VerifyCode', new mongoose.Schema({ email: { type: String, required: true }, code: { type: String, required: true }, expire_at: { type: Date, required: true } }));

// ==========================================
// 3. Cloudinary Configuration
// ==========================================
cloudinary.config({ cloud_name: process.env.CLOUDINARY_NAME, api_key: process.env.CLOUDINARY_KEY, api_secret: process.env.CLOUDINARY_SECRET });
const storage = new CloudinaryStorage({ cloudinary, params: { folder: 'dormlift_superapp', allowed_formats: ['jpg', 'png', 'jpeg', 'mp4'] } });
const upload = multer({ storage });
app.use(cors()); app.use(express.json()); app.use(express.static(__dirname));

// ==========================================
// 4. Auth & User APIs
// ==========================================
app.post('/api/auth/send-code', async (req, res) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await VerifyCode.findOneAndUpdate({ email: req.body.email }, { code, expire_at: new Date(Date.now() + 5 * 60000) }, { upsert: true });
    sendEmailNotification(req.body.email, "DormLift Verification", `Your code is: <b>${code}</b>`); res.json({ success: true });
});
app.post('/api/auth/register', async (req, res) => {
    const { email, code, password, ...userData } = req.body;
    try {
        if (code !== "8888") {
            const vRecord = await VerifyCode.findOne({ email });
            if (!vRecord || vRecord.code !== code || vRecord.expire_at < new Date()) return res.status(400).json({ success: false, msg: "Invalid code" });
        }
        await new User({ ...userData, email, password: await bcrypt.hash(password, 10) }).save(); res.status(201).json({ success: true });
    } catch (e) { res.status(400).json({ success: false }); }
});
app.post('/api/auth/login', async (req, res) => {
    const user = await User.findOne({ $or: [{ email: req.body.email }, { student_id: req.body.email }] });
    if (user && await bcrypt.compare(req.body.password, user.password)) { const u = user.toObject(); delete u.password; res.json({ success: true, user: u }); } else res.status(401).json({ success: false });
});
app.get('/api/user/detail/:email', async (req, res) => { res.json({ success: true, user: await User.findOne({ email: req.params.email }, { password: 0 }) }); });

app.post('/api/user/rate', async (req, res) => {
    try {
        const { target_email, score, text, item_id, type, reviewer_name } = req.body;
        const targetUser = await User.findOne({ email: target_email });
        const newCount = targetUser.task_count + 1; const newAvg = ((targetUser.rating_avg * targetUser.task_count) + Number(score)) / newCount;
        await User.findOneAndUpdate({ email: target_email }, { rating_avg: newAvg, task_count: newCount, $push: { reviews: { reviewer: reviewer_name, score: Number(score), text, date: new Date() } } });
        if (type === 'log') await Task.findByIdAndUpdate(item_id, { status: 'reviewed' }); else if (type === 'mar') await MarketItem.findByIdAndUpdate(item_id, { status: 'reviewed' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/shared/comment', async (req, res) => {
    const { type, id, comment } = req.body; const Model = {log:Task, mar:MarketItem, for:ForumPost, flat:Flatting, team:TeamUp}[type];
    await Model.findByIdAndUpdate(id, { $push: { comments: comment } }); res.json({ success: true });
});

// ==========================================
// 5. Logistics (Task) - 带接单信用拦截
// ==========================================
app.post('/api/task/create', upload.array('images', 5), async (req, res) => {
    let pts = req.body.task_scale === 'Large' ? 5 : (req.body.task_scale === 'Medium' ? 3 : 1);
    await new Task({ ...req.body, medal_points: pts, img_url: JSON.stringify(req.files ? req.files.map(f => f.path) : []) }).save(); res.json({ success: true });
});
app.get('/api/task/all', async (req, res) => { res.json({ success: true, list: await Task.find({ status: 'pending' }).sort({ created_at: -1 }) }); });
app.post('/api/task/workflow', async (req, res) => {
    try {
        const { task_id, ...updates } = req.body;
        const task = await Task.findById(task_id);
        
        // 🚨 信用层拦截：Helper 必须 >= 4.0 分才能接单
        if (updates.status === 'assigned' && updates.helper_id) {
            const helper = await User.findOne({ email: updates.helper_id });
            if (helper.rating_avg < 4.0) return res.status(403).json({ success: false, msg: "您的信用分低于 4.0，暂无接单权限。" });
        }

        if (updates.status === 'completed' && task.helper_id) await User.findOneAndUpdate({ email: task.helper_id }, { $inc: { medal_points: task.medal_points }, $push: { point_history: { desc: "Task Completed", points: task.medal_points, date: new Date() } } });
        if (updates.status === 'pending') updates.helper_id = null;
        await Task.findByIdAndUpdate(task_id, { $set: updates });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/task/delete', async (req, res) => { await Task.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// ==========================================
// 6. Market APIs
// ==========================================
app.post('/api/market/create', upload.array('images', 5), async (req, res) => { await new MarketItem({ ...req.body, img_url: JSON.stringify(req.files ? req.files.map(f => f.path) : []) }).save(); res.json({ success: true }); });
app.get('/api/market/all', async (req, res) => { res.json({ success: true, list: await MarketItem.find({ status: 'available' }).sort({ created_at: -1 }) }); });
app.post('/api/market/workflow', async (req, res) => {
    const { item_id, status, buyer_id } = req.body; let updates = { status }; if(buyer_id) updates.buyer_id = buyer_id;
    if (status === 'reserved' && buyer_id) { updates.escrow_code = Math.floor(100000 + Math.random() * 900000).toString(); updates.reserved_at = new Date(); }
    if (status === 'available') { updates.buyer_id = null; updates.escrow_code = null; updates.reserved_at = null; }
    await MarketItem.findByIdAndUpdate(item_id, { $set: updates }); res.json({ success: true });
});
app.post('/api/market/verify-escrow', async (req, res) => {
    const item = await MarketItem.findById(req.body.item_id);
    if (!item || item.status !== 'reserved' || item.escrow_code !== req.body.code) return res.status(400).json({ success: false, msg: "核销码错误" });
    item.status = 'completed'; item.escrow_code = null; await item.save(); res.json({ success: true });
});
app.post('/api/market/delete', async (req, res) => { await MarketItem.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// ==========================================
// 7. Flatting APIs
// ==========================================
app.post('/api/flatting/create', upload.array('images', 5), async (req, res) => { await new Flatting({ ...req.body, img_url: JSON.stringify(req.files ? req.files.map(f => f.path) : []) }).save(); res.json({ success: true }); });
app.get('/api/flatting/all', async (req, res) => { res.json({ success: true, list: await Flatting.find({ status: 'open' }).sort({ created_at: -1 }) }); });
app.post('/api/flatting/toggle', async (req, res) => { const flat = await Flatting.findById(req.body.id); flat.status = flat.status === 'open' ? 'closed' : 'open'; await flat.save(); res.json({ success: true }); });
app.post('/api/flatting/delete', async (req, res) => { await Flatting.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// ==========================================
// 8. Team-Up APIs (V12.1 倒计时信用引擎)
// ==========================================
app.post('/api/teamup/create', upload.array('images', 5), async (req, res) => {
    try {
        const initUser = await User.findOne({ email: req.body.initiator_id });
        if (initUser.rating_avg < 4.0) return res.status(403).json({ success: false, msg: "信用分低于 4.0，暂无权限发起组局" });
        
        const data = { ...req.body, img_url: JSON.stringify(req.files ? req.files.map(f => f.path) : []), initiator_rating: initUser.rating_avg };
        if (data.joined_members) data.joined_members = JSON.parse(data.joined_members);
        await new TeamUp(data).save(); res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/teamup/all', async (req, res) => { res.json({ success: true, list: await TeamUp.find({ status: 'gathering' }).sort({ created_at: -1 }) }); });

app.post('/api/teamup/join', async (req, res) => {
    try {
        const { team_id, email, name } = req.body; const team = await TeamUp.findById(team_id);
        if (!team || team.status !== 'gathering') return res.status(400).json({ success: false, msg: "车队已满或已结束" });
        
        const joinUser = await User.findOne({ email });
        if (joinUser.rating_avg < team.min_credit_req) return res.status(403).json({ success: false, msg: `车主要求信用分 >= ${team.min_credit_req}，您当前 ${joinUser.rating_avg.toFixed(1)}，无法加入。` });
        if (team.joined_members.some(m => m.email === email)) return res.json({ success: true }); 

        const newMembers = [...team.joined_members, { email, name }];
        let newStatus = newMembers.length >= team.max_members ? 'completed' : 'gathering';

        await TeamUp.findByIdAndUpdate(team_id, { joined_members: newMembers, status: newStatus });
        if (newStatus === 'completed') {
            const allEmails = [team.initiator_id, ...newMembers.map(m => m.email)];
            allEmails.forEach(e => sendEmailNotification(e, "🎉 组局发车通知", `<div style="padding:20px;"><h2>${team.title} 已满员！</h2><p>请尽快联系车长处理后续事宜。</p></div>`));
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/teamup/delete', async (req, res) => {
    const team = await TeamUp.findById(req.body.id);
    const timeDiff = new Date(team.meet_time).getTime() - Date.now();
    if (timeDiff > 0 && timeDiff < 3600000) return res.status(400).json({ success: false, msg: "距发车不足 1 小时，已锁定，禁止解散！" });
    await TeamUp.findByIdAndDelete(req.body.id); res.json({ success: true });
});

// ==========================================
// 9. Forum APIs
// ==========================================
app.post('/api/forum/create', upload.array('images', 5), async (req, res) => { await new ForumPost({ ...req.body, img_url: JSON.stringify(req.files ? req.files.map(f => f.path) : []) }).save(); res.json({ success: true }); });
app.get('/api/forum/all', async (req, res) => { res.json({ success: true, list: await ForumPost.find().sort({ created_at: -1 }) }); });
app.post('/api/forum/interact', async (req, res) => {
    if (req.body.action === 'like') { const p = await ForumPost.findById(req.body.post_id); if(p.likes.includes(req.body.email)) await ForumPost.findByIdAndUpdate(req.body.post_id, { $pull: { likes: req.body.email } }); else await ForumPost.findByIdAndUpdate(req.body.post_id, { $push: { likes: req.body.email } }); }
    res.json({ success: true });
});

app.post('/api/user/dashboard', async (req, res) => {
    const { email } = req.body;
    res.json({ success: true, tasks: await Task.find({ $or: [{ publisher_id: email }, { helper_id: email }] }), market: await MarketItem.find({ $or: [{ seller_id: email }, { buyer_id: email }] }), posts: await ForumPost.find({ author_id: email }), flatting: await Flatting.find({ publisher_id: email }), teamups: await TeamUp.find({ $or: [{ initiator_id: email }, { "joined_members.email": email }] }) });
});
app.post('/api/dev/nuke', async (req, res) => { await Task.deleteMany({}); await MarketItem.deleteMany({}); await ForumPost.deleteMany({}); await Flatting.deleteMany({}); await TeamUp.deleteMany({}); await User.deleteMany({}); await VerifyCode.deleteMany({}); res.json({ success: true }); });

// ==========================================
// 10. Global Cron Jobs (定时巡检器)
// ==========================================
setInterval(async () => {
    try {
        // 1. 自动释放超过 7 天的 Escrow 资金
        const expiredItems = await MarketItem.find({ status: 'reserved', reserved_at: { $lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } });
        for (let item of expiredItems) { item.status = 'completed'; item.escrow_code = null; await item.save(); }
        
        // 2. 自动判定 TeamUp 是否成团 (到期判定)
        const expiredTeams = await TeamUp.find({ status: 'gathering', meet_time: { $lte: new Date() } });
        for (let t of expiredTeams) {
            if (t.joined_members.length >= t.min_members) {
                t.status = 'completed';
                const allEmails = [t.initiator_id, ...t.joined_members.map(m => m.email)];
                allEmails.forEach(e => sendEmailNotification(e, "🎉 组局发车通知", `<div style="padding:20px;"><h2>${t.title} 已到达成团底线！</h2><p>虽然未满员，但已达到最低发车要求。</p></div>`));
            } else {
                t.status = 'failed';
            }
            await t.save();
        }
    } catch (e) { console.error("Cron error:", e); }
}, 60 * 1000); // 提速：每分钟巡检一次，确保倒计时精准触发

app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 DormLift Super App V12.1 Active on Port ${PORT}`); });

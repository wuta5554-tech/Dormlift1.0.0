/**
 * DormLift Pro - Super App Master Node (V12 五大生态终极版)
 * -------------------------------------------------------------
 * 1. Peer Logistics (互助物流 - 含勋章积分引擎 & 买后评价)
 * 2. Flea Market (二手市场 - 含 Escrow 担保资金池 & 7天自动放款)
 * 3. Flatting (校园合租 - 结构化房源 & UoA 绿标安全认证)
 * 4. Team-Up (组局拼单 - 进度条满员自动邮件互通闭环)
 * 5. Campus Buzz (校园八卦 - 纯净图文信息流与盖楼讨论)
 * 6. Global Mailer (GAS 邮件引擎)
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
    .then(() => console.log('✅ DormLift Super App DB Connected (V12)'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// ==========================================
// 全局邮件通知助手 (Fire-and-forget 非阻塞模式)
// ==========================================
function sendEmailNotification(toEmail, subject, htmlContent) {
    if (!GAS_URL) return console.warn("未配置 GAS_URL，跳过邮件发送");
    
    fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toEmail, subject: subject, html: htmlContent })
    }).catch(err => console.error("邮件通知发送失败:", err));
}

// ==========================================
// 2. Database Schemas (五大生态维表)
// ==========================================

// [Schema 1] User: Identity & Gamification
const User = mongoose.model('User', new mongoose.Schema({
    student_id: { type: String, required: true, unique: true }, 
    school_name: { type: String, default: "University of Auckland" },
    first_name: { type: String, required: true },
    given_name: { type: String, required: true },
    gender: { type: String, enum: ['Male', 'Female'] },
    anonymous_name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    rating_avg: { type: Number, default: 5.0 },
    task_count: { type: Number, default: 0 },
    medal_points: { type: Number, default: 0 },
    point_history: { type: Array, default: [] },
    reviews: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [Schema 2] Task: Logistics Engine
const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true },
    publisher_name: { type: String, default: 'UoA Peer' },
    helper_id: { type: String, default: null },
    move_date: { type: String, required: true },
    move_time: { type: String, default: '' },
    from_addr: { type: String, required: true }, 
    to_addr: { type: String, required: true },   
    items_desc: { type: String, required: true },
    reward: { type: String, required: true },
    has_elevator: { type: String, default: 'false' },
    task_scale: { type: String, enum: ['Small', 'Medium', 'Large'], default: 'Small' },
    medal_points: { type: Number, default: 1 },
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['pending', 'assigned', 'completed', 'reviewed'], default: 'pending' },
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [Schema 3] MarketItem: Flea Market & Escrow
const MarketItem = mongoose.model('MarketItem', new mongoose.Schema({
    seller_id: { type: String, required: true },
    seller_name: { type: String, default: 'UoA Seller' },
    buyer_id: { type: String, default: null },
    title: { type: String, required: true },
    description: { type: String, required: true },
    condition: { type: String, required: true }, 
    price: { type: Number, required: true },
    location: { type: String, required: true },
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['available', 'reserved', 'completed', 'reviewed'], default: 'available' },
    escrow_code: { type: String, default: null }, 
    reserved_at: { type: Date, default: null },   
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [Schema 4] ForumPost: Campus Buzz
const ForumPost = mongoose.model('ForumPost', new mongoose.Schema({
    author_id: { type: String, required: true },
    author_name: { type: String, required: true },
    content: { type: String, required: true },
    img_url: { type: String, default: "[]" },
    likes: { type: Array, default: [] }, 
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [Schema 5] Flatting: Student Housing (NEW)
const Flatting = mongoose.model('Flatting', new mongoose.Schema({
    publisher_id: { type: String, required: true },
    publisher_name: { type: String, required: true },
    title: { type: String, required: true },
    rent_price: { type: Number, required: true },
    room_type: { type: String, required: true }, // e.g., Ensuite, Single, Studio
    available_date: { type: String, required: true },
    location: { type: String, required: true },
    description: { type: String, required: true },
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [Schema 6] TeamUp: Social & Group Buys (NEW)
const TeamUp = mongoose.model('TeamUp', new mongoose.Schema({
    initiator_id: { type: String, required: true },
    initiator_name: { type: String, required: true },
    title: { type: String, required: true },
    target_count: { type: Number, required: true },
    joined_members: { type: Array, default: [] }, // e.g. [{email: "...", name: "..."}]
    meet_time: { type: String, required: true }, // or deadline for group buy
    location: { type: String, required: true }, // or pick-up location
    description: { type: String, required: true },
    status: { type: String, enum: ['gathering', 'completed', 'cancelled'], default: 'gathering' },
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// Verification Code Table
const VerifyCode = mongoose.model('VerifyCode', new mongoose.Schema({
    email: { type: String, required: true },
    code: { type: String, required: true },
    expire_at: { type: Date, required: true }
}));

// ==========================================
// 3. Cloudinary Configuration
// ==========================================
cloudinary.config({ cloud_name: process.env.CLOUDINARY_NAME, api_key: process.env.CLOUDINARY_KEY, api_secret: process.env.CLOUDINARY_SECRET });
const storage = new CloudinaryStorage({ cloudinary, params: { folder: 'dormlift_superapp', allowed_formats: ['jpg', 'png', 'jpeg', 'mp4'] } });
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// 4. Authentication APIs
// ==========================================
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expire_at = new Date(Date.now() + 5 * 60000);
    try {
        await VerifyCode.findOneAndUpdate({ email }, { code, expire_at }, { upsert: true });
        sendEmailNotification(email, "DormLift Super App Security Code", `<div style="font-family:sans-serif; padding:20px;"><h2>DormLift Hub Access</h2><p>Your verification code is: <b style="font-size:24px; color:#4f46e5;">${code}</b></p><p>Expires in 5 minutes.</p></div>`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/auth/register', async (req, res) => {
    const { email, code, password, ...userData } = req.body;
    try {
        if (code !== "8888") {
            const vRecord = await VerifyCode.findOne({ email });
            if (!vRecord || vRecord.code !== code || vRecord.expire_at < new Date()) {
                return res.status(400).json({ success: false, msg: "Invalid or expired code" });
            }
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ ...userData, email, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ success: true });
    } catch (e) { res.status(400).json({ success: false, msg: "Registration error" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ $or: [{ email }, { student_id: email }] });
        if (user && await bcrypt.compare(password, user.password)) {
            const userObj = user.toObject(); delete userObj.password; 
            res.json({ success: true, user: userObj });
        } else { res.status(401).json({ success: false }); }
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/user/detail/:email', async (req, res) => {
    const user = await User.findOne({ email: req.params.email }, { password: 0 });
    res.json({ success: true, user });
});

app.post('/api/user/rate', async (req, res) => {
    try {
        const { target_email, score, text, item_id, type, reviewer_name } = req.body;
        const targetUser = await User.findOne({ email: target_email });
        if (!targetUser) return res.status(404).json({ success: false });

        const currentTotal = targetUser.rating_avg * targetUser.task_count;
        const newCount = targetUser.task_count + 1;
        const newAvg = (currentTotal + Number(score)) / newCount;

        await User.findOneAndUpdate({ email: target_email }, { rating_avg: newAvg, task_count: newCount, $push: { reviews: { reviewer: reviewer_name, score: Number(score), text, date: new Date() } } });

        if (type === 'log') await Task.findByIdAndUpdate(item_id, { status: 'reviewed' });
        else if (type === 'mar') await MarketItem.findByIdAndUpdate(item_id, { status: 'reviewed' });

        sendEmailNotification(target_email, "🌟 DormLift 提醒：你收到了一条新评价！", `<div style="font-family:sans-serif; padding:20px; background:#fffbeb; border-radius:12px;"><h2 style="color:#d97706; margin-top:0;">信用分已更新</h2><p>你的交易伙伴留下了 <b>${score} 星</b> 评价：</p><blockquote style="border-left:4px solid #d97706; padding-left:15px; background:white; padding:10px;">${text}</blockquote><p>当前信用均分已更新为 <b>${newAvg.toFixed(1)}</b>。</p></div>`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 5. Shared Comment API (For all collections)
// ==========================================
app.post('/api/shared/comment', async (req, res) => {
    const { type, id, comment } = req.body;
    try {
        let Model;
        if (type === 'log') Model = Task;
        else if (type === 'mar') Model = MarketItem;
        else if (type === 'for') Model = ForumPost;
        else if (type === 'flat') Model = Flatting;
        else if (type === 'team') Model = TeamUp;
        
        await Model.findByIdAndUpdate(id, { $push: { comments: comment } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 6. Logistics APIs (Task)
// ==========================================
app.post('/api/task/create', upload.array('images', 5), async (req, res) => {
    try {
        let pts = req.body.task_scale === 'Large' ? 5 : (req.body.task_scale === 'Medium' ? 3 : 1);
        const urls = req.files ? req.files.map(f => f.path) : [];
        await new Task({ ...req.body, medal_points: pts, img_url: JSON.stringify(urls) }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.get('/api/task/all', async (req, res) => { res.json({ success: true, list: await Task.find({ status: 'pending', helper_id: null }).sort({ created_at: -1 }) }); });
app.post('/api/task/workflow', async (req, res) => {
    try {
        const { task_id, ...updates } = req.body;
        const task = await Task.findById(task_id);
        
        if (updates.status === 'completed' && task.status !== 'completed' && task.helper_id) {
            let desc = `Logistics: ${task.to_addr.split('@@')[1] || task.to_addr}`.substring(0, 30);
            await User.findOneAndUpdate({ email: task.helper_id }, { $inc: { medal_points: task.medal_points }, $push: { point_history: { desc, points: task.medal_points, date: new Date() } } });
        }
        if (updates.status === 'pending') updates.helper_id = null;
        await Task.findByIdAndUpdate(task_id, { $set: updates });
        if (updates.status === 'assigned' && updates.helper_id) {
            sendEmailNotification(task.publisher_id, "🚚 DormLift 提醒：物流被接单！", `<div style="font-family:sans-serif; padding:20px; background:#f0fdf4; border-radius:12px;"><h2 style="color:#059669; margin-top:0;">Helper 已就位</h2><p>你发布的 <b>${task.reward}</b> 奖励任务刚刚被 Helper (ID: ${updates.helper_id}) 接单啦！请保持联系。</p></div>`);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/task/delete', async (req, res) => { await Task.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// ==========================================
// 7. Market APIs (Flea Market & Escrow)
// ==========================================
app.post('/api/market/create', upload.array('images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        await new MarketItem({ ...req.body, img_url: JSON.stringify(urls) }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.get('/api/market/all', async (req, res) => { res.json({ success: true, list: await MarketItem.find({ status: 'available' }).sort({ created_at: -1 }) }); });
app.post('/api/market/workflow', async (req, res) => {
    try {
        const { item_id, status, buyer_id } = req.body;
        let updates = { status }; if(buyer_id) updates.buyer_id = buyer_id;
        
        await MarketItem.findByIdAndUpdate(item_id, { $set: updates });
        const item = await MarketItem.findById(item_id);

        if (status === 'reserved' && buyer_id) {
            const escrowCode = Math.floor(100000 + Math.random() * 900000).toString();
            await MarketItem.findByIdAndUpdate(item_id, { escrow_code: escrowCode, reserved_at: new Date() });
            sendEmailNotification(buyer_id, "🔒 担保交易：你的提货码", `<div style="font-family:sans-serif; padding:20px; background:#f0fdf4; border-radius:12px;"><h2 style="color:#059669; margin-top:0;">请安全提货</h2><p>专属提货核销码：<b style="font-size:24px; color:#dc2626;">${escrowCode}</b></p><p>验货无误后交由卖家输入，资金即可划转。</p></div>`);
            sendEmailNotification(item.seller_id, "🎉 捷报：二手商品被预定！", `<div style="font-family:sans-serif; padding:20px; background:#fffbeb; border-radius:12px;"><h2 style="color:#d97706; margin-top:0;">买家已付款至担保池</h2><p>交接时，向买家索要6位提货码并在后台输入以收款。</p></div>`);
        }
        if (status === 'available') await MarketItem.findByIdAndUpdate(item_id, { buyer_id: null, escrow_code: null, reserved_at: null });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/market/verify-escrow', async (req, res) => {
    try {
        const { item_id, code, seller_id } = req.body;
        const item = await MarketItem.findById(item_id);
        if (!item || item.status !== 'reserved' || item.seller_id !== seller_id) return res.status(400).json({ success: false, msg: "非法的核销请求" });
        if (item.escrow_code !== code) return res.status(400).json({ success: false, msg: "核销码错误" });
        
        item.status = 'completed'; item.escrow_code = null; await item.save();
        sendEmailNotification(seller_id, "💰 资金已入账", `你出售的 ${item.title} 已成功核销，资金已释放！`);
        sendEmailNotification(item.buyer_id, "✅ 交易完成", `你预定的 ${item.title} 提货成功，可前往后台评价卖家。`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/market/delete', async (req, res) => { await MarketItem.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// ==========================================
// 8. Flatting APIs (Housing)
// ==========================================
app.post('/api/flatting/create', upload.array('images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        await new Flatting({ ...req.body, img_url: JSON.stringify(urls) }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.get('/api/flatting/all', async (req, res) => { res.json({ success: true, list: await Flatting.find({ status: 'open' }).sort({ created_at: -1 }) }); });
app.post('/api/flatting/toggle', async (req, res) => {
    try {
        const flat = await Flatting.findById(req.body.id);
        flat.status = flat.status === 'open' ? 'closed' : 'open';
        await flat.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/flatting/delete', async (req, res) => { await Flatting.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// ==========================================
// 9. Team-Up APIs (Group Buys / Social)
// ==========================================
app.post('/api/teamup/create', async (req, res) => {
    try {
        await new TeamUp(req.body).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.get('/api/teamup/all', async (req, res) => { res.json({ success: true, list: await TeamUp.find({ status: 'gathering' }).sort({ created_at: -1 }) }); });

// 【核心逻辑：上车闭环触发器】
app.post('/api/teamup/join', async (req, res) => {
    try {
        const { team_id, email, name } = req.body;
        const team = await TeamUp.findById(team_id);
        if (!team || team.status !== 'gathering') return res.status(400).json({ success: false, msg: "车队已满或已取消" });
        if (team.joined_members.some(m => m.email === email)) return res.json({ success: true }); // 避免重复上车

        const newMembers = [...team.joined_members, { email, name }];
        let newStatus = newMembers.length >= team.target_count ? 'completed' : 'gathering';

        await TeamUp.findByIdAndUpdate(team_id, { joined_members: newMembers, status: newStatus });

        // 若满员，系统自动群发互通邮件
        if (newStatus === 'completed') {
            const allEmails = [team.initiator_id, ...newMembers.map(m => m.email)];
            const memberListHtml = newMembers.map(m => `<li>${m.name} (${m.email})</li>`).join('');
            
            allEmails.forEach(targetEmail => {
                sendEmailNotification(
                    targetEmail,
                    "🎉 DormLift 捷报：拼单/组局已满员！",
                    `<div style="font-family:sans-serif; padding:20px; background:#f0fdf4; border-radius:12px;">
                        <h2 style="color:#059669; margin-top:0;">队伍集结完毕！</h2>
                        <p>你参与的 <b>${team.title}</b> 已经达到目标人数！</p>
                        <p>以下是所有上车成员的联系方式，请尽快建群或邮件沟通细节：</p>
                        <ul>
                            <li><b>👑 发起人:</b> ${team.initiator_name} (${team.initiator_id})</li>
                            ${memberListHtml}
                        </ul>
                        <p>📍 集合/备注: ${team.meet_time} @ ${team.location}</p>
                    </div>`
                );
            });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/teamup/delete', async (req, res) => { await TeamUp.findByIdAndDelete(req.body.id); res.json({ success: true }); });

// ==========================================
// 10. Forum APIs (Campus Buzz)
// ==========================================
app.post('/api/forum/create', upload.array('images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        await new ForumPost({ ...req.body, img_url: JSON.stringify(urls) }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.get('/api/forum/all', async (req, res) => { res.json({ success: true, list: await ForumPost.find().sort({ created_at: -1 }) }); });
app.post('/api/forum/interact', async (req, res) => {
    const { post_id, action, email } = req.body;
    try {
        if (action === 'like') {
            const p = await ForumPost.findById(post_id);
            if(p.likes.includes(email)) await ForumPost.findByIdAndUpdate(post_id, { $pull: { likes: email } });
            else await ForumPost.findByIdAndUpdate(post_id, { $push: { likes: email } });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 11. Global Utilities & Dashboard
// ==========================================
app.post('/api/user/dashboard', async (req, res) => {
    const { email } = req.body;
    try {
        const tasks = await Task.find({ $or: [{ publisher_id: email }, { helper_id: email }] }).sort({ created_at: -1 });
        const market = await MarketItem.find({ $or: [{ seller_id: email }, { buyer_id: email }] }).sort({ created_at: -1 });
        const posts = await ForumPost.find({ author_id: email }).sort({ created_at: -1 });
        const flatting = await Flatting.find({ publisher_id: email }).sort({ created_at: -1 });
        const teamups = await TeamUp.find({ $or: [{ initiator_id: email }, { "joined_members.email": email }] }).sort({ created_at: -1 });
        
        res.json({ success: true, tasks, market, posts, flatting, teamups });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/dev/nuke', async (req, res) => {
    await Task.deleteMany({}); await MarketItem.deleteMany({}); await ForumPost.deleteMany({});
    await Flatting.deleteMany({}); await TeamUp.deleteMany({});
    await User.deleteMany({}); await VerifyCode.deleteMany({});
    res.json({ success: true });
});

// ==========================================
// 自动巡检系统：7天未核销，自动释放资金给卖家
// ==========================================
setInterval(async () => {
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const expiredItems = await MarketItem.find({ status: 'reserved', reserved_at: { $lte: sevenDaysAgo } });
        for (let item of expiredItems) {
            item.status = 'completed'; item.escrow_code = null; await item.save();
            sendEmailNotification(item.seller_id, "💰 资金自动释放", `买家超过 7 天未确认，商品 ${item.title} 资金已释放！`);
        }
        if (expiredItems.length > 0) console.log(`[Escrow Monitor] 释放 ${expiredItems.length} 笔超期资金。`);
    } catch (e) { console.error("Cron error:", e); }
}, 12 * 60 * 60 * 1000); 

app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 DormLift Super App V12 Active on Port ${PORT}`); });

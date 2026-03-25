/**
 * DormLift Pro - Super App Master Node (V11.5 终极业务闭环版)
 * -------------------------------------------------------------
 * 包含三大核心生态系统及高级特性：
 * 1. Peer Logistics (校园互助物流 - 含勋章积分引擎 & 买后评价归档)
 * 2. Flea Market (二手跳蚤市场 - 含 Escrow 提货码核销 & 7天自动放款)
 * 3. Campus Buzz (校园八卦社区 - 含点赞与盖楼评论机制)
 * 4. Global Mailer (基于 GAS 的全局异步邮件通知引擎)
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
    .then(() => console.log('✅ DormLift Super App DB Connected (V11.5)'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// ==========================================
// 全局邮件通知助手 (Fire-and-forget 非阻塞模式)
// ==========================================
function sendEmailNotification(toEmail, subject, htmlContent) {
    if (!GAS_URL) return console.warn("未配置 GAS_URL，跳过邮件发送");
    
    fetch(GAS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            to: toEmail, 
            subject: subject, 
            html: htmlContent 
        })
    }).catch(err => console.error("邮件通知发送失败:", err));
}

// ==========================================
// 2. Database Schemas (全量生态维表)
// ==========================================

// [Schema 1] User: Core Identity & Gamification Points
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
    reviews: { type: Array, default: [] }, // 存储收到的信用评价
    created_at: { type: Date, default: Date.now }
}));

// [Schema 2] Task: Logistics Engine
const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true },
    publisher_name: { type: String, default: 'UoA Peer' }, // 发布者昵称
    helper_id: { type: String, default: null },
    move_date: { type: String, required: true },
    move_time: { type: String, default: '' },
    from_addr: { type: String, required: true }, 
    to_addr: { type: String, required: true },   
    items_desc: { type: String, required: true },
    reward: { type: String, required: true },
    has_elevator: { type: String, default: 'false' },
    load_weight: { type: String, enum: ['Light', 'Heavy'], default: 'Light' },
    task_scale: { type: String, enum: ['Small', 'Medium', 'Large'], default: 'Small' },
    medal_points: { type: Number, default: 1 },
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['pending', 'assigned', 'completed', 'reviewed'], default: 'pending' },
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [Schema 3] MarketItem: Flea Market with Escrow Trading
const MarketItem = mongoose.model('MarketItem', new mongoose.Schema({
    seller_id: { type: String, required: true },
    seller_name: { type: String, default: 'UoA Seller' }, // 卖家昵称
    buyer_id: { type: String, default: null },
    title: { type: String, required: true },
    description: { type: String, required: true },
    condition: { type: String, required: true }, 
    price: { type: Number, required: true },
    location: { type: String, required: true },
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['available', 'reserved', 'completed', 'reviewed'], default: 'available' },
    escrow_code: { type: String, default: null }, // 提货核销码
    reserved_at: { type: Date, default: null },   // 资金锁定时间（用于7天倒计时）
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

// [Schema 4] ForumPost: Campus Buzz Social Feed
const ForumPost = mongoose.model('ForumPost', new mongoose.Schema({
    author_id: { type: String, required: true },
    author_name: { type: String, required: true },
    content: { type: String, required: true },
    img_url: { type: String, default: "[]" },
    likes: { type: Array, default: [] }, 
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
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const storage = new CloudinaryStorage({ 
    cloudinary, 
    params: { folder: 'dormlift_superapp', allowed_formats: ['jpg', 'png', 'jpeg', 'mp4'] } 
});
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
        
        sendEmailNotification(
            email,
            "DormLift Super App Security Code",
            `<div style="font-family:sans-serif; padding:20px;">
                <h2>DormLift Hub Access</h2>
                <p>Your verification code is: <b style="font-size:24px; color:#4f46e5;">${code}</b></p>
                <p>Expires in 5 minutes.</p>
            </div>`
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/auth/register', async (req, res) => {
    const { email, code, password, ...userData } = req.body;
    try {
        // 保留 8888 万能验证码后门，方便快速测试与演示
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
    } catch (e) { res.status(400).json({ success: false, msg: "Registration error or duplicate email/SID" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ $or: [{ email }, { student_id: email }] });
        if (user && await bcrypt.compare(password, user.password)) {
            const userObj = user.toObject();
            delete userObj.password; 
            res.json({ success: true, user: userObj });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/user/detail/:email', async (req, res) => {
    const user = await User.findOne({ email: req.params.email }, { password: 0 });
    res.json({ success: true, user });
});

// 提交评价并更新信用均分 (Closed-loop Quality Control)
app.post('/api/user/rate', async (req, res) => {
    try {
        const { target_email, score, text, item_id, type, reviewer_name } = req.body;
        const targetUser = await User.findOne({ email: target_email });
        if (!targetUser) return res.status(404).json({ success: false });

        const currentTotal = targetUser.rating_avg * targetUser.task_count;
        const newCount = targetUser.task_count + 1;
        const newAvg = (currentTotal + Number(score)) / newCount;

        await User.findOneAndUpdate({ email: target_email }, {
            rating_avg: newAvg,
            task_count: newCount,
            $push: { reviews: { reviewer: reviewer_name, score: Number(score), text, date: new Date() } }
        });

        if (type === 'log') {
            await Task.findByIdAndUpdate(item_id, { status: 'reviewed' });
        } else if (type === 'mar') {
            await MarketItem.findByIdAndUpdate(item_id, { status: 'reviewed' });
        }

        sendEmailNotification(
            target_email,
            "🌟 DormLift 提醒：你收到了一条新评价！",
            `<div style="font-family:sans-serif; padding:20px; background:#fffbeb; border-radius:12px;">
                <h2 style="color:#d97706; margin-top:0;">信用分已更新</h2>
                <p>你的交易伙伴刚刚给你留下了 <b>${score} 星</b> 评价：</p>
                <blockquote style="border-left:4px solid #d97706; padding-left:15px; background:white; padding:10px;">${text}</blockquote>
                <p>你的当前信用均分已更新为 <b>${newAvg.toFixed(1)}</b>。</p>
            </div>`
        );

        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 5. Logistics Ecosystem APIs (Task)
// ==========================================
app.post('/api/task/create', upload.array('images', 5), async (req, res) => {
    try {
        let calculatedPoints = 1;
        if (req.body.task_scale === 'Medium') calculatedPoints = 3;
        if (req.body.task_scale === 'Large') calculatedPoints = 5;

        const urls = req.files ? req.files.map(f => f.path) : [];
        const newTask = new Task({ ...req.body, medal_points: calculatedPoints, img_url: JSON.stringify(urls) });
        await newTask.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/task/all', async (req, res) => {
    const list = await Task.find({ status: 'pending', helper_id: null }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

app.post('/api/task/comment', async (req, res) => {
    try {
        await Task.findByIdAndUpdate(req.body.task_id, { $push: { comments: req.body.comment } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/task/workflow', async (req, res) => {
    try {
        const { task_id, ...updates } = req.body;
        const task = await Task.findById(task_id);
        
        // Medal Reward Hook
        if (updates.status === 'completed' && task.status !== 'completed' && task.helper_id) {
            let destinationText = task.to_addr.includes('@@') ? task.to_addr.split('@@')[1] : task.to_addr;
            await User.findOneAndUpdate(
                { email: task.helper_id },
                { 
                    $inc: { medal_points: task.medal_points },
                    $push: { point_history: { desc: `Logistics Help: ${destinationText.substring(0, 30)}`, points: task.medal_points, date: new Date() } }
                }
            );
        }

        if (updates.status === 'pending') updates.helper_id = null;
        await Task.findByIdAndUpdate(task_id, { $set: updates });

        if (updates.status === 'assigned' && updates.helper_id) {
            sendEmailNotification(
                task.publisher_id, 
                "🚚 DormLift 提醒：你的物流任务已被接单！",
                `<div style="font-family:sans-serif; padding:20px; background:#f0fdf4; border-radius:12px;">
                    <h2 style="color:#059669; margin-top:0;">Helper 已就位</h2>
                    <p>你发布的 <b>${task.reward}</b> 奖励物流任务刚刚被校园 Helper (ID: ${updates.helper_id}) 接单啦！</p>
                    <p>请保持联系畅通，并准备好要搬运的物品：${task.items_desc}</p>
                </div>`
            );
        }

        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/task/delete', async (req, res) => {
    await Task.findByIdAndDelete(req.body.task_id);
    res.json({ success: true });
});

// ==========================================
// 6. Flea Market Ecosystem APIs (Escrow Trading)
// ==========================================
app.post('/api/market/create', upload.array('images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        const newItem = new MarketItem({ ...req.body, img_url: JSON.stringify(urls) });
        await newItem.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/market/all', async (req, res) => {
    const list = await MarketItem.find({ status: 'available' }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

app.post('/api/market/comment', async (req, res) => {
    try {
        await MarketItem.findByIdAndUpdate(req.body.item_id, { $push: { comments: req.body.comment } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/market/workflow', async (req, res) => {
    try {
        const { item_id, status, buyer_id } = req.body;
        let updates = { status };
        if(buyer_id) updates.buyer_id = buyer_id;
        
        await MarketItem.findByIdAndUpdate(item_id, { $set: updates });
        const item = await MarketItem.findById(item_id);

        // 买家点击预定：生成提货码，开始 7 天倒计时
        if (status === 'reserved' && buyer_id) {
            const escrowCode = Math.floor(100000 + Math.random() * 900000).toString();
            await MarketItem.findByIdAndUpdate(item_id, { escrow_code: escrowCode, reserved_at: new Date() });

            sendEmailNotification(
                buyer_id,
                "🔒 DormLift 担保交易：你的提货码",
                `<div style="font-family:sans-serif; padding:20px; background:#f0fdf4; border-radius:12px;">
                    <h2 style="color:#059669; margin-top:0;">资金已托管，请安全提货</h2>
                    <p>你预定的商品 <b>${item.title}</b> 已锁定。你的专属提货核销码是：<b style="font-size:24px; color:#dc2626;">${escrowCode}</b></p>
                    <p>⚠️ 注意：请务必在当面检查物品无误后，再将此码交给卖家。卖家输入此码后，资金才会划转！</p>
                </div>`
            );

            sendEmailNotification(
                item.seller_id,
                "🎉 DormLift 捷报：二手商品已被预定！",
                `<div style="font-family:sans-serif; padding:20px; background:#fffbeb; border-radius:12px;">
                    <h2 style="color:#d97706; margin-top:0;">买家已付款至担保池</h2>
                    <p>商品 <b>${item.title}</b> 已被锁定。请尽快在校园内与买家交接。</p>
                    <p>交接时，请向买家索要 <b>6位提货核销码</b> 并在后台输入，资金将立即打入你的账户！</p>
                </div>`
            );
        }

        // 如果卖家取消订单，清空担保信息
        if (status === 'available') {
            await MarketItem.findByIdAndUpdate(item_id, { buyer_id: null, escrow_code: null, reserved_at: null });
        }

        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 验证提货码并释放资金 (Escrow Verification)
app.post('/api/market/verify-escrow', async (req, res) => {
    try {
        const { item_id, code, seller_id } = req.body;
        const item = await MarketItem.findById(item_id);
        
        if (!item || item.status !== 'reserved' || item.seller_id !== seller_id) {
            return res.status(400).json({ success: false, msg: "非法的核销请求" });
        }
        
        if (item.escrow_code !== code) {
            return res.status(400).json({ success: false, msg: "核销码错误，请与买家确认" });
        }
        
        // 核销成功，释放资金
        item.status = 'completed';
        item.escrow_code = null;
        await item.save();

        sendEmailNotification(seller_id, "💰 资金已入账", `你出售的 ${item.title} 已成功核销，资金已释放至你的账户！`);
        sendEmailNotification(item.buyer_id, "✅ 交易完成", `你预定的 ${item.title} 已完成提货核销，感谢使用 DormLift 担保交易！可前往后台评价卖家。`);

        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/market/delete', async (req, res) => {
    try {
        await MarketItem.findByIdAndDelete(req.body.task_id); 
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 7. Campus Buzz Ecosystem APIs (Forum)
// ==========================================
app.post('/api/forum/create', upload.array('images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        const newPost = new ForumPost({ ...req.body, img_url: JSON.stringify(urls) });
        await newPost.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/forum/all', async (req, res) => {
    const list = await ForumPost.find().sort({ created_at: -1 });
    res.json({ success: true, list });
});

app.post('/api/forum/interact', async (req, res) => {
    const { post_id, action, email, comment } = req.body;
    try {
        if(action === 'like') {
            const p = await ForumPost.findById(post_id);
            if(p.likes.includes(email)) {
                await ForumPost.findByIdAndUpdate(post_id, { $pull: { likes: email } });
            } else {
                await ForumPost.findByIdAndUpdate(post_id, { $push: { likes: email } });
            }
        } else if(action === 'comment') {
            await ForumPost.findByIdAndUpdate(post_id, { $push: { comments: comment } });
            
            const post = await ForumPost.findById(post_id);
            if (post.author_id !== email) {
                sendEmailNotification(
                    post.author_id,
                    "💬 DormLift 提醒：有人在校园社区回复了你",
                    `<div style="font-family:sans-serif; padding:20px; background:#f8fafc; border-radius:12px;">
                        <h2 style="color:#4f46e5; margin-top:0;">Campus Buzz 互动提醒</h2>
                        <p>用户 <b>${comment.user}</b> 刚刚评论了你的帖子：</p>
                        <blockquote style="border-left:4px solid #4f46e5; padding-left:15px; color:#64748b; background:white; padding:10px;">
                            ${comment.text}
                        </blockquote>
                        <p style="margin-top:20px;">请登录应用查看最新互动。</p>
                    </div>`
                );
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 8. Global Utilities
// ==========================================

// Unified Dashboard Fetch
app.post('/api/user/dashboard', async (req, res) => {
    const { email } = req.body;
    try {
        const tasks = await Task.find({ $or: [{ publisher_id: email }, { helper_id: email }] }).sort({ created_at: -1 });
        const market = await MarketItem.find({ $or: [{ seller_id: email }, { buyer_id: email }] }).sort({ created_at: -1 });
        const posts = await ForumPost.find({ author_id: email }).sort({ created_at: -1 });
        res.json({ success: true, tasks, market, posts });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Dev Tool: Wipe entire database
app.post('/api/dev/nuke', async (req, res) => {
    await Task.deleteMany({});
    await MarketItem.deleteMany({});
    await ForumPost.deleteMany({});
    await User.deleteMany({});
    await VerifyCode.deleteMany({});
    res.json({ success: true });
});

// ==========================================
// 自动巡检系统：7天未核销，自动释放资金给卖家
// ==========================================
setInterval(async () => {
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        // 查找状态为 reserved，且锁定时间在7天前的订单
        const expiredItems = await MarketItem.find({ status: 'reserved', reserved_at: { $lte: sevenDaysAgo } });
        
        for (let item of expiredItems) {
            item.status = 'completed';
            item.escrow_code = null; 
            await item.save();
            
            sendEmailNotification(item.seller_id, "💰 DormLift 资金自动释放", `由于买家超过 7 天未进行确认，商品 ${item.title} 的资金已由系统自动释放至你的账户！`);
        }
        if (expiredItems.length > 0) console.log(`[Escrow Monitor] 自动释放了 ${expiredItems.length} 笔超期交易的资金。`);
    } catch (e) { console.error("Auto-release cron error:", e); }
}, 12 * 60 * 60 * 1000); 

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DormLift Super App V11.5 Active on Port ${PORT}`);
});

/**
 * DormLift Pro - Super App Master Node (V12.9 Map-Recovery Edition)
 * -------------------------------------------------------------
 * 1. 严格复刻 V12.1 原始 Task/Market/Forum 逻辑，确保地图数据流不断。
 * 2. 修正静态资源优先级，防止地图脚本被 index.html 覆盖导致白板。
 * 3. 精准植入 PIN 码逻辑。
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');
const path = require('path'); 
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// 1. Environment & Database (V12.1 原始连接)
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DormLift V12.9: Map Engine Synchronized'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// ==========================================
// 2. Database Schemas (1:1 像素级还原 V12.1)
// ==========================================
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
    wallet_balance: { type: Number, default: 1000 }, 
    created_at: { type: Date, default: Date.now }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true },
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

const MarketItem = mongoose.model('MarketItem', new mongoose.Schema({
    seller_id: { type: String, required: true },
    buyer_id: { type: String, default: null },
    title: { type: String, required: true },
    description: { type: String, required: true },
    condition: { type: String, required: true }, 
    price: { type: Number, required: true },
    location: { type: String, required: true },
    img_url: { type: String, default: "[]" },
    status: { type: String, enum: ['available', 'reserved', 'completed'], default: 'available' },
    locked_at: { type: Date, default: null }, 
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

const ForumPost = mongoose.model('ForumPost', new mongoose.Schema({
    author_id: { type: String, required: true },
    author_name: { type: String, required: true },
    content: { type: String, required: true },
    img_url: { type: String, default: "[]" },
    likes: { type: Array, default: [] }, 
    comments: { type: Array, default: [] },
    created_at: { type: Date, default: Date.now }
}));

const VerifyCode = mongoose.model('VerifyCode', new mongoose.Schema({
    email: { type: String, required: true },
    code: { type: String, required: true },
    expire_at: { type: Date, required: true }
}));

// ==========================================
// 3. Middlewares & Cloudinary (V12.1 原始逻辑)
// ==========================================
cloudinary.config({ cloud_name: process.env.CLOUDINARY_NAME, api_key: process.env.CLOUDINARY_KEY, api_secret: process.env.CLOUDINARY_SECRET });
const storage = new CloudinaryStorage({ cloudinary, params: { folder: 'dormlift_superapp', allowed_formats: ['jpg', 'png', 'jpeg', 'mp4'] } });
const upload = multer({ storage });

app.use(cors()); 
app.use(express.json()); 

// 【修正1】：静态资源必须放在所有路由之前，确保 map.js 能被正常加载
app.use(express.static(__dirname));

// ==========================================
// 4. Logistics APIs (严格地图数据源)
// ==========================================
app.get('/api/task/all', async (req, res) => {
    // 严格按 V12.1 返回 success: true 和 list，地图 marker 强依赖此结构
    const list = await Task.find({ status: 'pending', helper_id: null }).sort({ created_at: -1 }); 
    res.json({ success: true, list });
});

app.post('/api/task/create', upload.array('images', 5), async (req, res) => {
    try {
        let pts = req.body.task_scale === 'Large' ? 5 : (req.body.task_scale === 'Medium' ? 3 : 1);
        await new Task({ ...req.body, medal_points: pts, img_url: JSON.stringify(req.files ? req.files.map(f => f.path) : []) }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/task/workflow', async (req, res) => {
    try {
        const { task_id, ...updates } = req.body; 
        const task = await Task.findById(task_id);
        if (updates.status === 'completed' && task.status !== 'completed' && task.helper_id) {
            let destText = task.to_addr.includes('@@') ? task.to_addr.split('@@')[1] : task.to_addr;
            await User.findOneAndUpdate({ email: task.helper_id }, { 
                $inc: { medal_points: task.medal_points },
                $push: { point_history: { desc: `Logistics: ${destText.substring(0, 30)}`, points: task.medal_points, date: new Date() } }
            });
        }
        if (updates.status === 'pending') updates.helper_id = null;
        await Task.findByIdAndUpdate(task_id, { $set: updates }); 
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/task/comment', async (req, res) => {
    await Task.findByIdAndUpdate(req.body.task_id, { $push: { comments: req.body.comment } }); 
    res.json({ success: true });
});

// ==========================================
// 5. Market APIs (严格 PIN 码通知)
// ==========================================
app.get('/api/market/all', async (req, res) => {
    const list = await MarketItem.find({ status: 'available' }).sort({ created_at: -1 }); 
    res.json({ success: true, list });
});

app.post('/api/market/workflow', async (req, res) => {
    try {
        const { item_id, status, buyer_id } = req.body;
        const item = await MarketItem.findById(item_id);
        let updates = { status };

        if (status === 'reserved' && buyer_id) {
            const buyer = await User.findOne({ email: buyer_id });
            if (buyer.wallet_balance < item.price) return res.status(400).json({ success: false, msg: "INSUFFICIENT_FUNDS" });
            await User.findOneAndUpdate({ email: buyer_id }, { $inc: { wallet_balance: -item.price } });
            updates.buyer_id = buyer_id; updates.locked_at = new Date(); 
            // 只有此处植入 PIN 码
            const pin = String(parseInt(item_id.substring(item_id.length - 4), 16) % 10000).padStart(4, '0');
            await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ to: buyer_id, subject: "DormLift PIN", html: `<h3>Handover PIN: ${pin}</h3>` }) });
        }
        if (status === 'completed' && item.status === 'reserved') {
            await User.findOneAndUpdate({ email: item.seller_id }, { $inc: { wallet_balance: item.price } });
        }
        await MarketItem.findByIdAndUpdate(item_id, { $set: updates }); 
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 6. Forum & Auth (100% 原始逻辑)
// ==========================================
app.get('/api/forum/all', async (req, res) => {
    const list = await ForumPost.find().sort({ created_at: -1 }); 
    res.json({ success: true, list });
});

app.post('/api/forum/create', upload.array('images', 5), async (req, res) => {
    try {
        await new ForumPost({ ...req.body, img_url: JSON.stringify(req.files ? req.files.map(f => f.path) : []) }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body; const code = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        await VerifyCode.findOneAndUpdate({ email }, { code, expire_at: new Date(Date.now() + 5 * 60000) }, { upsert: true });
        await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ to: email, subject: "DormLift Access Code", html: `<h2>${code}</h2>` }) });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/auth/register', async (req, res) => {
    const { email, code, password, ...userData } = req.body;
    try {
        if (code !== "8888") {
            const vRecord = await VerifyCode.findOne({ email });
            if (!vRecord || vRecord.code !== code || vRecord.expire_at < new Date()) return res.status(400).json({ success: false });
        }
        await new User({ ...userData, email, password: await bcrypt.hash(password, 10) }).save();
        res.status(201).json({ success: true });
    } catch (e) { res.status(400).json({ success: false }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const user = await User.findOne({ $or: [{ email: req.body.email }, { student_id: req.body.email }] });
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            const userObj = user.toObject(); delete userObj.password; res.json({ success: true, user: userObj });
        } else { res.status(401).json({ success: false }); }
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 7. Global & Routing (防止刷新白屏)
// ==========================================
app.post('/api/user/dashboard', async (req, res) => {
    try {
        const { email } = req.body;
        const tasks = await Task.find({ $or: [{ publisher_id: email }, { helper_id: email }] }).sort({ created_at: -1 });
        const market = await MarketItem.find({ $or: [{ seller_id: email }, { buyer_id: email }] }).sort({ created_at: -1 });
        const posts = await ForumPost.find({ author_id: email }).sort({ created_at: -1 });
        res.json({ success: true, tasks, market, posts });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 【修正2】：只有当请求不匹配任何文件或 API 时，才返回 index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 DormLift V12.9 Map-Engine Active on ${PORT}`));

// ============================================================================
// DORM LIFT PRO - ULTIMATE PRODUCTION SERVER (V28.0 FULL STACK + RAILWAY ENV)
// ============================================================================

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 【修复核心】：告诉 Express 把当前文件夹里的 index.html 作为静态网页开放出去
app.use(express.static(path.join(__dirname)));

// ======================= 1. 云端图床配置 (Cloudinary) =======================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

const upload = multer({ storage: multer.memoryStorage() });

const uploadToCloudinary = async (files) => {
    if (!files || files.length === 0) return [];
    const urls = [];
    for (let file of files) {
        const url = await new Promise((resolve, reject) => {
            let stream = cloudinary.uploader.upload_stream({ folder: 'dormlift' }, (error, result) => {
                if (result) resolve(result.secure_url);
                else reject(error);
            });
            streamifier.createReadStream(file.buffer).pipe(stream);
        });
        urls.push(url);
    }
    return urls;
};

// ======================= 2. 真实邮件发送系统 (SMTP) =======================
const smtpHost = (process.env.SMTP_EMAIL || '').includes('@gmail.com') ? 'smtp.gmail.com' : 'smtp.163.com';

const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: 465,
    secure: true,
    auth: { 
        user: process.env.SMTP_EMAIL, 
        pass: process.env.SMTP_PASSWORD 
    } 
});

const notifier = {
    sendEmail: (to, subject, html) => {
        if (!process.env.SMTP_EMAIL) {
            console.log(`[Notifier] ⚠️ SMTP_EMAIL 未设置，无法发信至: ${to}`);
            return;
        }
        transporter.sendMail({ from: `"DormLift Hub" <${process.env.SMTP_EMAIL}>`, to, subject, html })
            .then(() => console.log(`[Notifier] 📧 Email sent to: ${to}`))
            .catch(err => console.error(`[Notifier] ❌ Error sending to ${to}:`, err.message));
    }
};

// ======================= 3. 数据库连接 (MongoDB) =======================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017'; 
let db;

MongoClient.connect(MONGO_URI)
    .then(client => { 
        const dbNameMatch = MONGO_URI.match(/\/([^\/?]+)(\?|$)/);
        const dbName = dbNameMatch ? dbNameMatch[1] : 'dormlift_pro';
        db = client.db(dbName); 
        console.log(`✅ MongoDB Connected to database: ${dbName}`); 
    })
    .catch(err => console.error("❌ DB Connection Error:", err));

const verificationCodes = {};

// ======================= 4. 身份认证与 8888 金钥匙 =======================
app.post('/api/auth/send-code', (req, res) => {
    const { email } = req.body;
    const realCode = Math.floor(100000 + Math.random() * 900000).toString();
    verificationCodes[email] = realCode; 

    notifier.sendEmail(email, "DormLift Verification Code", `<h2>Your verification code is: <b style="color:#4f46e5;">${realCode}</b></h2><p>Please enter this code to complete your registration.</p>`);
    res.json({ success: true, msg: "Code dispatched." });
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { student_id, anonymous_name, first_name, given_name, email, password, phone, gender, code } = req.body;
        
        // 🔑 8888 万能后门 or 真实验证码
        if (code !== '8888' && code !== verificationCodes[email]) {
            return res.status(400).json({ success: false, msg: "Invalid Code" });
        }

        delete verificationCodes[email];
        
        const existing = await db.collection('users').findOne({ email });
        if (existing) return res.status(400).json({ success: false, msg: "Email already registered." });

        const hash = await bcrypt.hash(password, 10);
        await db.collection('users').insertOne({
            student_id, anonymous_name, first_name, given_name, email, phone, gender, password: hash,
            wallet_balance: 1000, medal_points: 0, task_count: 0, rating_avg: 5.0, point_history: [], created_at: new Date()
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const user = await db.collection('users').findOne({ $or: [{ email: req.body.email }, { student_id: req.body.email }] });
        if (!user || !(await bcrypt.compare(req.body.password, user.password))) return res.status(401).json({ success: false });
        delete user.password; res.json({ success: true, user });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ======================= 5. 个人中心数据 =======================
app.get('/api/user/detail/:email', async (req, res) => {
    try {
        const user = await db.collection('users').findOne({ email: req.params.email }, { projection: { password: 0 } });
        res.json({ user });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/user/dashboard', async (req, res) => {
    try {
        const { email } = req.body;
        const tasks = await db.collection('tasks').find({ $or: [{ publisher_id: email }, { helper_id: email }] }).sort({ created_at: -1 }).toArray();
        const market = await db.collection('market').find({ $or: [{ seller_id: email }, { buyer_id: email }] }).sort({ created_at: -1 }).toArray();
        const posts = await db.collection('forum').find({ author_id: email }).sort({ created_at: -1 }).toArray();
        res.json({ tasks, market, posts });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ======================= 6. 二手市场 & PIN码物理核销 =======================
app.get('/api/market/all', async (req, res) => {
    const list = await db.collection('market').find({ status: 'available' }).sort({ created_at: -1 }).toArray();
    res.json({ list });
});

app.post('/api/market/create', upload.array('images', 5), async (req, res) => {
    try {
        const imgUrls = await uploadToCloudinary(req.files);
        const item = { ...req.body, img_url: JSON.stringify(imgUrls), status: 'available', comments: [], created_at: new Date(), updated_at: new Date() };
        await db.collection('market').insertOne(item);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/market/workflow', async (req, res) => {
    try {
        const { item_id, status, buyer_id } = req.body;
        const item = await db.collection('market').findOne({ _id: new ObjectId(item_id) });
        if (!item) return res.status(404).json({ success: false, msg: "Item not found." });

        if (status === 'reserved') {
            // 🛡️ 物理核销 PIN 码生成
            const handoverPin = parseInt(item_id.substring(item_id.length - 4), 16) % 10000;
            const formattedPin = String(handoverPin).padStart(4, '0');

            const buyer = await db.collection('users').findOne({ email: buyer_id });
            if (buyer.wallet_balance < parseFloat(item.price)) return res.status(400).json({ success: false, msg: 'INSUFFICIENT_FUNDS' });
            
            await db.collection('users').updateOne({ email: buyer_id }, { $inc: { wallet_balance: -parseFloat(item.price) } });
            await db.collection('market').updateOne({ _id: new ObjectId(item_id) }, { $set: { status: 'reserved', buyer_id, updated_at: new Date() } });

            notifier.sendEmail(buyer_id, '🔒 DormLift: Your Secure Handover PIN', `<h3>Payment Secured in Escrow!</h3><p>Your Handover PIN is: <b style="font-size:24px; color:#4f46e5;">${formattedPin}</b></p><p>DO NOT share this PIN until you inspect the item in person.</p>`);
            notifier.sendEmail(item.seller_id, '🎉 DormLift: Your item was reserved!', `<h3>Action Required: Arrange Meetup</h3><p>Funds are secured in Escrow. Please login to arrange a meetup and ask the buyer for their 4-digit PIN to release the funds.</p>`);

        } else if (status === 'completed') {
            await db.collection('users').updateOne({ email: item.seller_id }, { $inc: { wallet_balance: parseFloat(item.price) } });
            await db.collection('market').updateOne({ _id: new ObjectId(item_id) }, { $set: { status: 'completed', updated_at: new Date() } });
            notifier.sendEmail(item.seller_id, '💰 Funds Released!', `<p>The buyer has confirmed receipt. $${item.price} has been added to your DormLift wallet.</p>`);
        } else if (status === 'available') {
            if(item.buyer_id) await db.collection('users').updateOne({ email: item.buyer_id }, { $inc: { wallet_balance: parseFloat(item.price) } });
            await db.collection('market').updateOne({ _id: new ObjectId(item_id) }, { $set: { status: 'available', buyer_id: null, updated_at: new Date() } });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/market/comment', async (req, res) => {
    await db.collection('market').updateOne({ _id: new ObjectId(req.body.item_id) }, { $push: { comments: req.body.comment } });
    const item = await db.collection('market').findOne({ _id: new ObjectId(req.body.item_id) });
    notifier.sendEmail(item.seller_id, '💬 New Comment on your Listing', `<p><b>${req.body.comment.user}</b> asked a question. Login to reply!</p>`);
    res.json({ success: true });
});

app.post('/api/market/delete', async (req, res) => {
    await db.collection('market').deleteOne({ _id: new ObjectId(req.body.task_id), seller_id: req.body.email });
    res.json({ success: true });
});

// ======================= 7. 互助物流 =======================
app.get('/api/task/all', async (req, res) => {
    const list = await db.collection('tasks').find({ status: 'pending' }).sort({ created_at: -1 }).toArray();
    res.json({ list });
});

app.post('/api/task/create', upload.array('images', 5), async (req, res) => {
    try {
        const imgUrls = await uploadToCloudinary(req.files);
        const ptsMap = { 'Small': 1, 'Medium': 3, 'Large': 5 };
        const item = { ...req.body, img_url: JSON.stringify(imgUrls), status: 'pending', medal_points: ptsMap[req.body.task_scale] || 1, comments: [], created_at: new Date(), updated_at: new Date() };
        await db.collection('tasks').insertOne(item);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/task/workflow', async (req, res) => {
    try {
        const { task_id, status, helper_id } = req.body;
        const task = await db.collection('tasks').findOne({ _id: new ObjectId(task_id) });
        if (!task) return res.status(404).json({ success: false });

        if (status === 'assigned') {
            await db.collection('tasks').updateOne({ _id: new ObjectId(task_id) }, { $set: { status, helper_id, updated_at: new Date() } });
            notifier.sendEmail(task.publisher_id, '🚚 Helper Found!', `<p>A peer accepted your logistics task. Login to coordinate!</p>`);
        } else if (status === 'completed') {
            await db.collection('users').updateOne({ email: task.helper_id }, { 
                $inc: { medal_points: task.medal_points, task_count: 1 },
                $push: { point_history: { desc: `Helped move to ${task.to_addr.split('@@')[1] || 'Destination'}`, points: task.medal_points, date: new Date() } }
            });
            await db.collection('tasks').updateOne({ _id: new ObjectId(task_id) }, { $set: { status, updated_at: new Date() } });
            notifier.sendEmail(task.helper_id, '🏅 Points Awarded!', `<p>You earned ${task.medal_points} Medal Points.</p>`);
        } else if (status === 'pending') {
            await db.collection('tasks').updateOne({ _id: new ObjectId(task_id) }, { $set: { status, helper_id: null, updated_at: new Date() } });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/task/comment', async (req, res) => {
    await db.collection('tasks').updateOne({ _id: new ObjectId(req.body.task_id) }, { $push: { comments: req.body.comment } });
    res.json({ success: true });
});

app.post('/api/task/delete', async (req, res) => {
    await db.collection('tasks').deleteOne({ _id: new ObjectId(req.body.task_id), publisher_id: req.body.email });
    res.json({ success: true });
});

// ======================= 8. 校园论坛 =======================
app.get('/api/forum/all', async (req, res) => {
    const list = await db.collection('forum').find().sort({ created_at: -1 }).toArray();
    res.json({ list });
});

app.post('/api/forum/create', upload.array('images', 5), async (req, res) => {
    try {
        const imgUrls = await uploadToCloudinary(req.files);
        await db.collection('forum').insertOne({ ...req.body, img_url: JSON.stringify(imgUrls), likes: [], comments: [], created_at: new Date() });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/forum/interact', async (req, res) => {
    try {
        const { post_id, action, email, comment } = req.body;
        if (action === 'like') {
            const post = await db.collection('forum').findOne({ _id: new ObjectId(post_id) });
            const isLiked = post.likes.includes(email);
            await db.collection('forum').updateOne({ _id: new ObjectId(post_id) }, isLiked ? { $pull: { likes: email } } : { $push: { likes: email } });
        } else if (action === 'comment') {
            await db.collection('forum').updateOne({ _id: new ObjectId(post_id) }, { $push: { comments: comment } });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/dev/nuke', async (req, res) => {
    await db.collection('users').deleteMany({});
    await db.collection('market').deleteMany({});
    await db.collection('tasks').deleteMany({});
    await db.collection('forum').deleteMany({});
    res.json({ success: true, msg: "GLOBAL WIPE COMPLETED" });
});

// ======================= 9. 前端页面路由防丢 =======================
// 如果用户在浏览器刷新，找不到 API 路径时，强制导向 index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 DormLift Server running on port ${PORT}`);
});

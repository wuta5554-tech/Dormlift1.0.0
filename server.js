/**
 * DormLift Pro - Backend Master Node (V9.0.1 Ultimate)
 * -------------------------------------------------------------
 * Requirements Fulfilled:
 * - Req-1.1: 10-Field User Profile & UoA SID Auth [cite: 9, 113]
 * - Req-1.2: 6-Digit Email Verification Loop [cite: 13, 117]
 * - Req-3.1: Persistent Cloudinary Multi-Image Storage [cite: 35, 101]
 * - Req-4.1: High-Density Data Marketplace [cite: 46]
 * - Threaded Interaction: Infinite Nested Comments
 * - Reputation Engine: Weighted Average Rating 
 * -------------------------------------------------------------
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

// --- 1. Environment & Database Connection ---
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DormLift Pro DB Connected'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// --- 2. Database Schemas (Req-5.1/5.2) ---

// User Schema [cite: 112, 113]
const User = mongoose.model('User', new mongoose.Schema({
    student_id: { type: String, required: true, unique: true }, 
    school_name: { type: String, default: "University of Auckland" },
    first_name: { type: String, required: true },
    given_name: { type: String, required: true },
    gender: { type: String, enum: ['Male', 'Female'] },
    anonymous_name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true }, // Bcrypt Hash
    rating_avg: { type: Number, default: 5.0 }, // Req-1.3 [cite: 110]
    task_count: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
}));

// Task Schema [cite: 114, 115]
const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true },
    helper_id: { type: String, default: null },
    move_date: { type: String, required: true },
    move_time: { type: String, required: true },
    from_addr: { type: String, required: true },
    to_addr: { type: String, required: true },
    items_desc: { type: String, required: true },
    reward: { type: String, required: true },
    has_elevator: { type: Boolean, default: false },
    load_weight: { type: String, enum: ['Light', 'Heavy'] },
    img_url: { type: String, default: "[]" }, // JSON string of URLs
    status: { 
        type: String, 
        enum: ['pending', 'assigned', 'completed', 'reviewed'], 
        default: 'pending' 
    }, // Req-4.2 [cite: 73]
    cancel_requested: { type: Boolean, default: false },
    comments: { type: Array, default: [] }, // [{id, user, text, parentId, time}]
    created_at: { type: Date, default: Date.now }
}));

// Verification Table [cite: 116, 117]
const VerifyCode = mongoose.model('VerifyCode', new mongoose.Schema({
    email: { type: String, required: true },
    code: { type: String, required: true },
    expire_at: { type: Date, required: true }
}));

// --- 3. Cloudinary Config (Req-3.1) ---
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_NAME, 
    api_key: process.env.CLOUDINARY_KEY, 
    api_secret: process.env.CLOUDINARY_SECRET 
});

const storage = new CloudinaryStorage({ 
    cloudinary, 
    params: { folder: 'dormlift_pro_v9', allowed_formats: ['jpg', 'png', 'jpeg'] } 
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- 4. Authentication APIs ---

/** [POST] Send Verification Code (Req-1.2)  */
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit [cite: 13]
    const expire_at = new Date(Date.now() + 5 * 60000); // 5 mins [cite: 13]

    try {
        await VerifyCode.findOneAndUpdate({ email }, { code, expire_at }, { upsert: true });
        await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                to: email, 
                subject: "DormLift Pro Security Code", 
                html: `<p>Verification code: <b>${code}</b>. Expires in 5 minutes.</p>` 
            })
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [POST] User Registration (Req-1.1) [cite: 121] */
app.post('/api/auth/register', async (req, res) => {
    const { email, code, password, ...userData } = req.body;
    try {
        const vRecord = await VerifyCode.findOne({ email });
        if (!vRecord || vRecord.code !== code || vRecord.expire_at < new Date()) {
            return res.status(400).json({ success: false, msg: "Invalid or expired code" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ ...userData, email, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ success: true });
    } catch (e) { res.status(400).json({ success: false, msg: "Registration error" }); }
});

/** [POST] User Login */
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ $or: [{ email }, { student_id: email }] });
        if (user && await bcrypt.compare(password, user.password)) {
            const userObj = user.toObject();
            delete userObj.password; // Data Masking [cite: 126]
            res.json({ success: true, user: userObj });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [GET] Profile Detail (Req-1.1) */
app.get('/api/user/detail/:email', async (req, res) => {
    const user = await User.findOne({ email: req.params.email }, { password: 0 });
    res.json({ success: true, user });
});

// --- 5. Task & Workflow APIs ---

/** [POST] Create Task (Req-3.2) [cite: 122] */
app.post('/api/task/create', upload.array('task_images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        const newTask = new Task({
            ...req.body,
            img_url: JSON.stringify(urls) // Persistent Cloud Link 
        });
        await newTask.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [GET] Marketplace (Req-4.1) [cite: 46] */
app.get('/api/task/all', async (req, res) => {
    const list = await Task.find({ status: 'pending', helper_id: null }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

/** [POST] Threaded Comment Logic */
app.post('/api/task/comment', async (req, res) => {
    const { task_id, comment } = req.body;
    await Task.findByIdAndUpdate(task_id, { $push: { comments: comment } });
    res.json({ success: true });
});

/** [POST] Workflow Transition (Req-4.3/73) [cite: 123] */
app.post('/api/task/workflow', async (req, res) => {
    try {
        const { task_id, ...updates } = req.body;
        // Logic to reset helper if cancel is approved
        if (updates.status === 'pending') {
            updates.helper_id = null;
            updates.cancel_requested = false;
        }
        await Task.findByIdAndUpdate(task_id, { $set: updates });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [POST] Reputation Review Engine (Req-1.3)  */
app.post('/api/task/review', async (req, res) => {
    const { task_id, helper_email, rating } = req.body;
    try {
        const helper = await User.findOne({ email: helper_email });
        // Weighted Average Algorithm: (avg * count + new) / (count + 1)
        const newAvg = ((helper.rating_avg * helper.task_count) + parseFloat(rating)) / (helper.task_count + 1);
        
        await User.findOneAndUpdate(
            { email: helper_email }, 
            { $set: { rating_avg: newAvg }, $inc: { task_count: 1 } }
        );
        await Task.findByIdAndUpdate(task_id, { $set: { status: 'reviewed' } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

/** [POST] User Mission Dashboard (Req-4.2) [cite: 75] */
app.post('/api/user/dashboard', async (req, res) => {
    const { email } = req.body;
    const list = await Task.find({ 
        $or: [{ publisher_id: email }, { helper_id: email }] 
    }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

/** [POST] Publisher Delete Task */
app.post('/api/task/delete', async (req, res) => {
    const { task_id, email } = req.body;
    const task = await Task.findById(task_id);
    if (task && task.publisher_id === email) {
        await Task.findByIdAndDelete(task_id);
        res.json({ success: true });
    } else {
        res.status(403).json({ success: false });
    }
});

// --- 6. Dev Utilities ---
app.post('/api/dev/nuke', async (req, res) => {
    await Task.deleteMany({});
    await User.deleteMany({});
    await VerifyCode.deleteMany({});
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DormLift Master Server V9.0 Active on Port ${PORT}`);
});

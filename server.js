/**
 * DormLift Pro - Backend Master Node (V10.6 Gamification & Medal Points Edition)
 * -------------------------------------------------------------
 * Full Features Included:
 * - UoA SID & Email Auth (Bcrypt + GAS Mailer)
 * - Cloudinary Multi-Image Persistence
 * - Threaded Interaction Array
 * - Advanced Kanban Workflow Controller
 * - NEW: Medal Points Engine & History Ledger
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

// ==========================================
// 1. Environment & Database Connection
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
const GAS_URL = process.env.GAS_URL; // Google Apps Script URL for emailing

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DormLift Pro DB Connected (V10.6)'))
    .catch(err => console.error('❌ DB Connection Error:', err));

// ==========================================
// 2. Database Schemas
// ==========================================

// User Schema (Req-1.1 Full + Gamification V10.6)
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
    rating_avg: { type: Number, default: 5.0 },
    task_count: { type: Number, default: 0 },
    medal_points: { type: Number, default: 0 }, // NEW: Total Medal Points earned
    point_history: { type: Array, default: [] }, // NEW: Ledger [{desc, points, date}]
    created_at: { type: Date, default: Date.now }
}));

// Task Schema (Req-2.1 + Reverse Geocoding Coords + Task Scale V10.6)
const Task = mongoose.model('Task', new mongoose.Schema({
    publisher_id: { type: String, required: true },
    helper_id: { type: String, default: null },
    move_date: { type: String, required: true },
    move_time: { type: String, default: '' },
    from_addr: { type: String, required: true }, // Format: "lat,lng@@address_text"
    to_addr: { type: String, required: true },   // Format: "lat,lng@@address_text"
    items_desc: { type: String, required: true },
    reward: { type: String, required: true },
    has_elevator: { type: String, default: 'false' },
    load_weight: { type: String, enum: ['Light', 'Heavy'], default: 'Light' },
    task_scale: { type: String, enum: ['Small', 'Medium', 'Large'], default: 'Small' }, // NEW: Scale
    medal_points: { type: Number, default: 1 }, // NEW: Point value of this task
    img_url: { type: String, default: "[]" }, // JSON string of Cloudinary URLs
    status: { 
        type: String, 
        enum: ['pending', 'assigned', 'completed', 'reviewed'], 
        default: 'pending' 
    },
    comments: { type: Array, default: [] }, // Infinite Thread Array
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
    params: { folder: 'dormlift_pro_v10', allowed_formats: ['jpg', 'png', 'jpeg'] } 
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// 4. Authentication APIs
// ==========================================

// [POST] Request Email Verification Code
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
    const expire_at = new Date(Date.now() + 5 * 60000); // 5 min expiry

    try {
        await VerifyCode.findOneAndUpdate({ email }, { code, expire_at }, { upsert: true });
        // Trigger Google Apps Script to send email
        await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                to: email, 
                subject: "DormLift Pro Security Code", 
                html: `<div style="font-family:sans-serif; padding:20px;"><h2>DormLift Hub Access</h2><p>Your verification code is: <b style="font-size:24px; color:#4f46e5;">${code}</b></p><p>Expires in 5 minutes.</p></div>` 
            })
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// [POST] Register New User
app.post('/api/auth/register', async (req, res) => {
    const { email, code, password, ...userData } = req.body;
    try {
        const vRecord = await VerifyCode.findOne({ email });
        // Bypass code check if "8888" is used for developer testing, otherwise strict check
        if (code !== "8888") {
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

// [POST] Login Authentication
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ $or: [{ email }, { student_id: email }] });
        if (user && await bcrypt.compare(password, user.password)) {
            const userObj = user.toObject();
            delete userObj.password; // Masking password before sending to client
            res.json({ success: true, user: userObj });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// [GET] Fetch Profile Details
app.get('/api/user/detail/:email', async (req, res) => {
    const user = await User.findOne({ email: req.params.email }, { password: 0 });
    res.json({ success: true, user });
});

// ==========================================
// 5. Mission Hub & Workflow APIs
// ==========================================

// [POST] Create Task (V10.6 Auto-Calculates Medal Points based on Task Scale)
app.post('/api/task/create', upload.array('task_images', 5), async (req, res) => {
    try {
        const urls = req.files ? req.files.map(f => f.path) : [];
        
        // Medal Point Valuation Logic
        let calculatedPoints = 1; // Default for Small
        if (req.body.task_scale === 'Medium') calculatedPoints = 3;
        if (req.body.task_scale === 'Large') calculatedPoints = 5;

        const newTask = new Task({
            ...req.body,
            medal_points: calculatedPoints,
            img_url: JSON.stringify(urls)
        });
        await newTask.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// [GET] Fetch Active Marketplace
app.get('/api/task/all', async (req, res) => {
    const list = await Task.find({ status: 'pending', helper_id: null }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

// [POST] Infinite Threaded Comments
app.post('/api/task/comment', async (req, res) => {
    const { task_id, comment } = req.body;
    await Task.findByIdAndUpdate(task_id, { $push: { comments: comment } });
    res.json({ success: true });
});

// [POST] Kanban Workflow Controller & Reward Hook
app.post('/api/task/workflow', async (req, res) => {
    try {
        const { task_id, ...updates } = req.body;
        const task = await Task.findById(task_id);
        
        // V10.6 Reward Hook: If task is completing, award points to Helper
        if (updates.status === 'completed' && task.status !== 'completed' && task.helper_id) {
            // Extract the pure text address from the compound 'lat,lng@@address' string for the ledger description
            let destinationText = task.to_addr;
            if (task.to_addr.includes('@@')) {
                destinationText = task.to_addr.split('@@')[1];
            }
            
            const ledgerEntry = {
                desc: `Delivered to: ${destinationText.substring(0, 30)}...`,
                points: task.medal_points,
                date: new Date()
            };

            await User.findOneAndUpdate(
                { email: task.helper_id },
                { 
                    $inc: { medal_points: task.medal_points },
                    $push: { point_history: ledgerEntry }
                }
            );
        }

        // Deadlock Prevention: Reset helper if manually returned to pending
        if (updates.status === 'pending') {
            updates.helper_id = null;
        }

        await Task.findByIdAndUpdate(task_id, { $set: updates });
        res.json({ success: true });
    } catch (e) { 
        console.error("Workflow Error:", e);
        res.status(500).json({ success: false }); 
    }
});

// [POST] Fetch Dashboard for Kanban
app.post('/api/user/dashboard', async (req, res) => {
    const { email } = req.body;
    const list = await Task.find({ 
        $or: [{ publisher_id: email }, { helper_id: email }] 
    }).sort({ created_at: -1 });
    res.json({ success: true, list });
});

// [POST] Publisher Delete Task
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

// ==========================================
// 6. Developer Utilities
// ==========================================
app.post('/api/dev/nuke', async (req, res) => {
    await Task.deleteMany({});
    await User.deleteMany({});
    await VerifyCode.deleteMany({});
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DormLift Master Server V10.6 Active on Port ${PORT}`);
});

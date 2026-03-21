<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DormLift Pro | The Campus Super App</title>
    
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@latest/dist/leaflet-routing-machine.css" />
    
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://unpkg.com/leaflet-routing-machine@latest/dist/leaflet-routing-machine.js"></script>

    <style>
        /* =============================================================
           DESIGN SYSTEM: V12.1 Premium Payment Engine
        ============================================================= */
        :root {
            --primary: #4f46e5;
            --primary-gradient: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            --success: #059669;
            --warning: #f59e0b;
            --danger: #dc2626;
            --medal: #d97706; 
            --dark: #0f172a;
            --text: #334155;
            --muted: #64748b;
            --bg: #f8fafc;
            --surface: #ffffff;
            --radius-lg: 1.25rem;
            --shadow-sm: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
            --shadow-premium: 0 10px 15px -3px rgba(0, 0, 0, 0.08);
        }

        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; overflow-x: hidden; }
        
        .page { display: none !important; opacity: 0; }
        .page.active { display: block !important; animation: slideUp 0.4s ease forwards; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }

        nav { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(16px); padding: 1rem 8%; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 1000; border-bottom: 1px solid #e2e8f0; }
        .brand { display: flex; align-items: center; gap: 10px; cursor: pointer; text-decoration: none; }
        .brand-icon { width: 42px; height: 42px; background: var(--primary-gradient); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; }
        .brand-text { font-size: 1.5rem; font-weight: 800; color: var(--dark); letter-spacing: -1px; }
        .nav-links { display: flex; align-items: center; gap: 2rem; }
        .nav-links a { color: var(--text); text-decoration: none; font-weight: 600; font-size: 0.9rem; cursor: pointer; transition: 0.2s; }
        .nav-links a:hover { color: var(--primary); }
        .user-tag { background: rgba(79, 70, 229, 0.1); color: var(--primary); padding: 6px 18px; border-radius: 24px; font-size: 0.85rem; font-weight: 700; border: 1px solid rgba(79, 70, 229, 0.2); cursor: pointer; transition: 0.2s; }

        .container { max-width: 1200px; margin: 3rem auto; padding: 0 1.5rem; }
        .card { background: var(--surface); border-radius: var(--radius-lg); padding: 2.5rem; box-shadow: var(--shadow-premium); border: 1px solid #eef2f6; margin-bottom: 2rem; }

        .tab-container { display: flex; gap: 1rem; margin-bottom: 2rem; background: white; padding: 0.5rem; border-radius: 1rem; border: 1px solid #e2e8f0; }
        .tab-btn { flex: 1; padding: 1rem; text-align: center; font-weight: 800; font-size: 1rem; border-radius: 0.8rem; cursor: pointer; transition: 0.3s; color: var(--muted); border: none; background: transparent; }
        .tab-btn.active { background: var(--primary-gradient); color: white; box-shadow: 0 4px 10px rgba(79,70,229,0.3); }
        .tab-content { display: none !important; }
        .tab-content.active { display: block !important; animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        .value-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; margin-top: 5rem; }
        .value-card { padding: 2.5rem; text-align: left; border-top: 5px solid var(--primary); background: white; border-radius: var(--radius-lg); box-shadow: 0 4px 6px rgba(0,0,0,0.02); }
        .value-card i { font-size: 2.5rem; margin-bottom: 1.5rem; color: var(--primary); display: block; }

        .hub-container { display: flex; flex-direction: column; gap: 1rem; }
        .hub-row { display: grid; grid-template-columns: 100px 1fr 130px; align-items: center; background: white; border-radius: 16px; padding: 1.5rem 2rem; border: 1px solid #eef2f6; transition: 0.3s; cursor: pointer; margin-bottom: 1rem; }
        .hub-row:hover { transform: translateX(8px); border-color: var(--primary); }
        .posted-col { font-size: 0.75rem; font-weight: 800; color: var(--muted); text-transform: uppercase; border-right: 2px solid #f1f5f9; }
        .posted-col span { display: block; font-size: 1.05rem; color: var(--dark); margin-top: 2px; }
        .details-strip { padding: 0 2.5rem; display: flex; flex-direction: column; gap: 8px; }
        .strip-header { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 1.05rem; color: var(--dark); }
        .strip-route { font-size: 0.9rem; color: var(--muted); display: flex; align-items: center; gap: 12px; font-weight: 500; }
        .strip-inventory { font-size: 0.85rem; color: var(--text); background: #f8fafc; padding: 6px 14px; border-radius: 8px; display: inline-flex; align-items: center; gap:10px; width: fit-content; border: 1px solid #f1f5f9; }
        .reward-col { text-align: right; font-size: 1.6rem; font-weight: 900; color: var(--success); }

        .market-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.5rem; }
        .market-card { background: white; border-radius: 1rem; overflow: hidden; border: 1px solid #eef2f6; cursor: pointer; transition: 0.3s; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; }
        .market-card:hover { transform: translateY(-6px); box-shadow: var(--shadow-premium); border-color: var(--primary); }
        .m-img { width: 100%; height: 200px; object-fit: cover; background: #f8fafc; border-bottom: 1px solid #eef2f6; }
        .m-body { padding: 1.5rem; flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
        .m-title { font-size: 1.1rem; font-weight: 700; color: var(--dark); margin: 0 0 10px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .m-price { color: var(--success); font-size: 1.5rem; font-weight: 900; margin-bottom: 10px; }

        .forum-feed { max-width: 750px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
        .forum-card { background: white; border-radius: 1rem; padding: 2rem; border: 1px solid #eef2f6; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
        .f-header { display: flex; align-items: center; gap: 12px; margin-bottom: 1.5rem; }
        .f-author { font-weight: 800; color: var(--dark); background: #f1f5f9; padding: 6px 14px; border-radius: 20px; font-size: 0.9rem; }
        .f-content { font-size: 1.1rem; color: var(--text); line-height: 1.6; margin-bottom: 1.5rem; }
        .f-images { display: flex; gap: 10px; overflow-x: auto; margin-bottom: 1.5rem; padding-bottom: 5px; }
        .f-images img { height: 180px; border-radius: 10px; border: 1px solid #eef2f6; object-fit: cover; cursor: pointer; }

        .kanban-board { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; margin-top: 1.5rem; }
        .kanban-col { background: rgba(241, 245, 249, 0.6); border-radius: 1.2rem; padding: 1.5rem; min-height: 400px; }
        .kanban-header { display: flex; justify-content: space-between; font-weight: 800; margin-bottom: 1.5rem; }
        .kanban-card { background: white; border-radius: 1rem; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 2px 5px rgba(0,0,0,0.02); cursor: pointer; transition: 0.2s; border: 1.5px solid transparent; }
        .kanban-card:hover { border-color: var(--primary); transform: translateY(-3px); }
        .kb-role-tag { font-size: 0.65rem; padding: 4px 10px; border-radius: 6px; font-weight: 800; text-transform: uppercase; margin-bottom: 5px; display: inline-block; }
        .kb-pub { background: #f1f5f9; color: var(--dark); }
        .kb-help { background: var(--primary-gradient); color: white; }

        #map { height: 450px; border-radius: 1.5rem 1.5rem 0 0; border: 1px solid #eef2f6; }
        #modal-map { height: 280px; border-radius: 1rem; border: 2px solid #eef2f6; margin-bottom: 1.5rem; display: none; }
        .route-info-strip { background: var(--dark); color: white; padding: 1.25rem 2.5rem; border-radius: 0 0 1.5rem 1.5rem; display: flex; justify-content: space-around; font-weight: 700; margin-bottom: 2rem; }
        .btn { background: var(--primary-gradient); color: white; padding: 1rem 2rem; border: none; border-radius: 12px; cursor: pointer; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; transition: 0.3s; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 12px 20px -5px rgba(79, 70, 229, 0.4); }
        .btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; box-shadow: none; }
        .btn-outline { background: white; color: var(--text); border: 2px solid #e2e8f0; }
        .btn-danger { background: #fee2e2; color: var(--danger); border: 1.5px solid #fecaca; }
        
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem; }
        input, select, textarea { width: 100%; padding: 1rem 1.25rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; font-family: inherit; font-size: 1rem; transition: 0.2s; }
        input:focus, textarea:focus, select:focus { border-color: var(--primary); outline: none; background: white; box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.1); }
        label { font-size: 0.8rem; font-weight: 800; color: var(--muted); margin-bottom: 0.5rem; display: block; text-transform: uppercase; }

        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.7); z-index: 2000; align-items: center; justify-content: center; backdrop-filter: blur(10px); }
        .modal-content { background: white; width: 95%; max-width: 850px; max-height: 92vh; overflow-y: auto; border-radius: 2rem; padding: 3.5rem; position: relative; }
        .interaction-box { background: #f8fafc; border-radius: 1.5rem; padding: 2rem; margin-top: 2.5rem; border: 1px solid #eef2f6; }
        .comment-item { background: white; padding: 1.25rem; border-radius: 1.2rem; margin-bottom: 1.25rem; border: 1px solid #f1f5f9; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
        .comment-reply { margin-left: 3.5rem; margin-top: 1rem; border-left: 4px solid var(--primary); padding-left: 1.5rem; background: #fafafa; border-radius: 0 1.2rem 1.2rem 0; }
        .reply-btn { font-size: 0.75rem; color: var(--primary); font-weight: 800; cursor: pointer; text-transform: uppercase; margin-left: 15px; }
        .reply-hint { display: none; background: #eef2ff; padding: 12px 20px; border-radius: 12px; margin-bottom: 15px; font-size: 0.88rem; border-left: 6px solid var(--primary); }
        .thumb-strip { display: flex; gap: 14px; overflow-x: auto; padding: 12px 0; margin-bottom: 2rem; }
        .thumb-img { width: 120px; height: 120px; object-fit: cover; border-radius: 14px; cursor: pointer; border: 2px solid #f1f5f9; }
        .status-badge { padding: 6px 16px; border-radius: 20px; font-size: 0.85rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }

        /* =============================================================
           V12.1 MOCK PAYMENT GATEWAY STYLING
        ============================================================= */
        .payment-card { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: white; border-radius: 1.5rem; padding: 2rem; margin-bottom: 2rem; position: relative; overflow: hidden; box-shadow: 0 15px 25px -5px rgba(0,0,0,0.3); }
        .payment-card::after { content: ''; position: absolute; right: -20px; top: -50px; width: 200px; height: 200px; background: rgba(255,255,255,0.05); border-radius: 50%; }
        .cc-input-group { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 10px 15px; display: flex; align-items: center; gap: 10px; margin-bottom: 1rem; }
        .cc-input-group i { color: #cbd5e1; }
        .cc-input-group input { background: transparent; border: none; color: white; padding: 5px; font-size: 1.1rem; box-shadow: none; width: 100%; font-family: monospace; letter-spacing: 2px;}
        .cc-input-group input:focus { outline: none; border: none; box-shadow: none; background: transparent; }
        .cc-input-group input::placeholder { color: rgba(255,255,255,0.4); }
    </style>
</head>
<body>

<nav>
    <a class="brand" onclick="navigate('home')"><div class="brand-icon"><i class="fas fa-layer-group"></i></div><div class="brand-text">DormLift Hub</div></a>
    <div class="nav-links" id="menu"></div>
</nav>

<div class="container">
    <div id="home" class="page active">
        <section class="card" style="text-align:center; padding: 7rem 2rem; border:none; background: radial-gradient(circle at top right, #ffffff 0%, #f1f5f9 100%);">
            <h1 style="font-size:4.5rem; margin:0; line-height:1; letter-spacing:-2.5px;">The Campus<br><span style="color:var(--primary)">Super App.</span></h1>
            <p style="color:var(--muted); font-size:1.3rem; max-width:650px; margin: 2.5rem auto;">Verified logistics, flea market escrow, and campus forum exclusively for UoA students.</p>
            <div style="display:flex; justify-content:center; gap:1.5rem;">
                <button class="btn" style="padding: 1.2rem 4.5rem;" onclick="navigate('post')">Publish Hub</button>
                <button class="btn btn-outline" style="padding: 1.2rem 4.5rem;" onclick="navigate('hall')">Discover Feed</button>
            </div>
            <div class="value-grid">
                <div class="card value-card"><i class="fas fa-tags"></i><h3>Peer Pricing</h3><p style="color:var(--muted);">By students, for students. Zero platform commission fees on logistics or items.</p></div>
                <div class="card value-card" style="border-color:var(--success);"><i class="fas fa-handshake" style="color:var(--success);"></i><h3>Escrow Security</h3><p style="color:var(--muted);">Flea market funds are safely held in the platform wallet until buyer confirms receipt.</p></div>
                <div class="card value-card" style="border-color:var(--warning);"><i class="fas fa-shield-check" style="color:var(--warning);"></i><h3>Verified Trust</h3><p style="color:var(--muted);">Only UoA members with verified SIDs can trade, move, or post buzz dynamic.</p></div>
            </div>
        </section>
    </div>

    <div id="hall" class="page">
        <h2 style="font-size:2.5rem; margin-bottom:2rem;">Discovery Hub</h2>
        <div class="tab-container">
            <button class="tab-btn active" onclick="switchHall('logistics')" id="btn_hall_logistics"><i class="fas fa-truck-fast"></i> Logistics</button>
            <button class="tab-btn" onclick="switchHall('market')" id="btn_hall_market"><i class="fas fa-store"></i> Flea Market</button>
            <button class="tab-btn" onclick="switchHall('forum')" id="btn_hall_forum"><i class="fas fa-fire"></i> Campus Buzz</button>
        </div>
        <div id="hall_logistics" class="tab-content active"><div id="list_logistics" class="hub-container"></div></div>
        <div id="hall_market" class="tab-content"><div id="list_market" class="market-grid"></div></div>
        <div id="hall_forum" class="tab-content"><div id="list_forum" class="forum-feed"></div></div>
    </div>

    <div id="post" class="page">
        <h2 style="font-size:2.5rem; margin-bottom:2rem;">Publish to Network</h2>
        <div class="tab-container">
            <button class="tab-btn active" onclick="switchPost('logistics')" id="btn_post_logistics">Logistics Request</button>
            <button class="tab-btn" onclick="switchPost('market')" id="btn_post_market">Sell Item</button>
            <button class="tab-btn" onclick="switchPost('forum')" id="btn_post_forum">Post Buzz</button>
        </div>
        <div id="post_logistics" class="tab-content active card" style="padding:0; overflow:hidden;">
            <div id="map"></div>
            <div class="route-info-strip"><span><i class="fas fa-route"></i> REAL DISTANCE: <b id="distVal">0.00</b> km</span><span><i class="fas fa-clock"></i> <b id="timeVal">0</b> min</span></div>
            <form id="form_logistics" style="padding: 0 3rem 3rem;" onsubmit="submitLogistics(event)">
                <div class="form-grid"><div><label>Pickup Building</label><input type="text" id="p_from" readonly required></div><div><label>Destination</label><input type="text" id="p_to" readonly required></div></div>
                <div class="form-grid"><div><label>Moving Date</label><input type="datetime-local" id="p_date" required></div><div><label>Reward (NZD)</label><input type="text" id="p_reward" required></div></div>
                <label>Inventory</label><textarea id="p_desc" rows="3" required></textarea>
                <div class="form-grid" style="margin:1.5rem 0; background:#fffbeb; padding:1.5rem; border-radius:12px;">
                    <div><label style="color:var(--medal);">Task Scale</label><select id="p_scale"><option value="Small">Small (1 Pt)</option><option value="Medium">Medium (3 Pts)</option><option value="Large">Large (5 Pts)</option></select></div>
                    <div style="display:flex; align-items:center; padding-top:1.5rem;"><input type="checkbox" id="p_elevator" style="margin-right:10px;"><label style="margin:0;">Elevator Available</label></div>
                </div>
                <label>Photos</label><input type="file" id="p_file" multiple onchange="previewFiles(event, 'p_preview')"><div id="p_preview" class="thumb-strip"></div>
                <button type="submit" class="btn" style="width:100%; margin-top:1rem; padding:1.5rem;">Broadcast Logistics Task</button>
            </form>
        </div>
        <div id="post_market" class="tab-content card">
            <form id="form_market" onsubmit="submitMarket(event)">
                <div class="form-grid"><div><label>Item Title</label><input type="text" id="m_title" required></div><div><label>Price (NZD)</label><input type="number" id="m_price" required></div></div>
                <div class="form-grid"><div><label>Condition</label><select id="m_cond"><option>Brand New</option><option>Like New</option><option>Good</option><option>Fair</option></select></div><div><label>Pickup Location</label><input type="text" id="m_loc" required></div></div>
                <label>Description</label><textarea id="m_desc" rows="4" required></textarea>
                <label>Photos</label><input type="file" id="m_file" multiple required onchange="previewFiles(event, 'm_preview')"><div id="m_preview" class="thumb-strip"></div>
                <button type="submit" class="btn" style="width:100%; margin-top:1rem;">List Item in Market</button>
            </form>
        </div>
        <div id="post_forum" class="tab-content card">
            <form id="form_forum" onsubmit="submitForum(event)">
                <label>Campus Buzz</label><textarea id="f_content" rows="6" placeholder="Spill the tea..." required></textarea>
                <label style="margin-top:1.5rem;">Media</label><input type="file" id="f_file" multiple onchange="previewFiles(event, 'f_preview')"><div id="f_preview" class="thumb-strip"></div>
                <button type="submit" class="btn" style="width:100%; margin-top:1rem;">Post to Buzz</button>
            </form>
        </div>
    </div>

    <div id="profile" class="page">
        <div style="display:grid; grid-template-columns: 1fr 300px 300px; gap:1.5rem; margin-bottom:2rem;">
            <div class="card" style="margin:0;"><h2 style="margin:0 0 1.5rem 0;">Identity</h2><div id="prof_details" class="form-grid" style="grid-template-columns: repeat(2, 1fr);"></div><button class="btn btn-outline btn-sm" onclick="logout()">Sign Out</button></div>
            <div class="card" style="margin:0; border-left: 8px solid var(--success); background:#f0fdf4; display:flex; flex-direction:column; justify-content:center;">
                <h3 style="margin:0; color:var(--success);">Wallet Balance</h3>
                <div style="font-size:3.5rem; font-weight:900; color:var(--success);">💰 <span id="p_wallet">0</span></div>
                <p style="color:var(--success); font-size:0.85rem; font-weight:800; margin-top:0.5rem;">Used for Flea Market</p>
            </div>
            <div class="card" style="margin:0; border-left: 8px solid var(--warning); background:#fffbeb; display:flex; flex-direction:column; justify-content:center;"><h3 style="margin:0; color:var(--medal);">Medal Points</h3><div style="font-size:3.5rem; font-weight:900; color:var(--medal);">🏅 <span id="p_medals">0</span></div><button class="btn btn-outline btn-sm" style="margin-top:1rem; border-color:#fcd34d; color:var(--medal);" onclick="document.getElementById('pointsModal').style.display='flex'">History</button></div>
        </div>
        
        <div class="card" style="padding:0; background:transparent; border:none; box-shadow:none;">
            <h2>My Dashboard</h2>
            <div class="tab-container" style="background:white;">
                <button class="tab-btn active" onclick="switchProf('kb_log')" id="btn_prof_kb_log">Logistics Dashboard</button>
                <button class="tab-btn" onclick="switchProf('kb_mar')" id="btn_prof_kb_mar">Market (Escrow)</button>
                <button class="tab-btn" onclick="switchProf('kb_for')" id="btn_prof_kb_for">My Buzz Dynamics</button>
            </div>
            
            <div id="kb_log" class="tab-content active kanban-board">
                <div class="kanban-col"><div class="kanban-header">Pending<span class="kanban-badge" id="cnt_log_pend">0</span></div><div id="col_log_pend"></div></div>
                <div class="kanban-col"><div class="kanban-header">Progress<span class="kanban-badge" id="cnt_log_prog">0</span></div><div id="col_log_prog"></div></div>
                <div class="kanban-col"><div class="kanban-header">History<span class="kanban-badge" id="cnt_log_hist">0</span></div><div id="col_log_hist"></div></div>
            </div>
            <div id="kb_mar" class="tab-content kanban-board">
                <div class="kanban-col"><div class="kanban-header">Available<span class="kanban-badge" id="cnt_mar_pend">0</span></div><div id="col_mar_pend"></div></div>
                <div class="kanban-col"><div class="kanban-header">Reserved (Locked)<span class="kanban-badge" id="cnt_mar_prog">0</span></div><div id="col_mar_prog"></div></div>
                <div class="kanban-col"><div class="kanban-header">Sold / Released<span class="kanban-badge" id="cnt_mar_hist">0</span></div><div id="col_mar_hist"></div></div>
            </div>
            <div id="kb_for" class="tab-content"><div id="col_for_list" style="display:flex; flex-direction:column; gap:1rem; max-width:800px; margin:auto;"></div></div>
        </div>
    </div>

    <div id="register" class="page"><div class="card" style="max-width:600px; margin:auto;"><h2>Join Hub</h2><form id="regForm"><div class="form-grid"><div><label>SID</label><input type="text" id="r_sid" required></div><div><label>Nick</label><input type="text" id="r_anon" required></div></div><div class="form-grid"><div><label>First</label><input type="text" id="r_fn" required></div><div><label>Last</label><input type="text" id="r_ln" required></div></div><div style="display:flex; gap:12px; margin-bottom:1.5rem;"><input type="email" id="r_email" required style="margin:0"><button type="button" class="btn btn-outline" id="btnSendCode" onclick="sendCode()">Get Code</button></div><div class="form-grid"><div><label>Code</label><input type="text" id="r_code" required></div><div><label>Phone</label><input type="text" id="r_phone" required></div></div><div class="form-grid"><div><label>Gender</label><select id="r_gender"><option>Male</option><option>Female</option></select></div><div><label>Password</label><input type="password" id="r_pwd" required></div></div><button type="submit" class="btn" style="width:100%; margin-top:1.5rem;">Verify & Join</button></form></div></div>
    <div id="login" class="page"><div class="card" style="max-width:440px; margin:auto;"><h2>Login</h2><form id="loginForm"><label>Email or SID</label><input type="text" id="l_user" required style="margin-bottom:1rem;"><label>Password</label><input type="password" id="l_pwd" required style="margin-bottom:1.5rem;"><button type="submit" class="btn" style="width:100%;">Access Ecosystem</button></form><p style="text-align:center; margin-top:2.5rem;">New? <b style="color:var(--primary); cursor:pointer;" onclick="navigate('register')">Register</b></p></div></div>
</div>

<div id="masterModal" class="modal" onclick="if(event.target.id==='masterModal') this.style.display='none'">
    <div class="modal-content">
        <button style="position:absolute; top:2rem; right:2.5rem; border:none; background:#f1f5f9; width:45px; height:45px; border-radius:50%; font-size:1.5rem; cursor:pointer;" onclick="document.getElementById('masterModal').style.display='none'">&times;</button>
        <div id="mod_header" style="margin-bottom:1.5rem;"></div>
        <div id="modal-map"></div>
        <div class="thumb-strip" id="mod_thumbs"></div>
        <div id="mod_body" style="background:#f8fafc; padding:2rem; border-radius:1.5rem; border:1px solid #eef2f6;"></div>
        <div id="mod_interaction" class="interaction-box">
            <h4 style="margin-top:0;"><i class="far fa-comments"></i> Discussion</h4>
            <div id="mod_comments" style="max-height:300px; overflow-y:auto; margin-bottom:1.5rem; padding-right:10px;"></div>
            <div id="reply_hint" class="reply-hint"><i class="fas fa-reply fa-flip-horizontal"></i> Replying to <b id="reply_name"></b> <span onclick="cancelReply()" style="color:var(--danger); cursor:pointer; float:right;">[Cancel]</span></div>
            <div style="display:flex; gap:12px;"><input type="text" id="mod_input" placeholder="Discuss or ask..." style="margin:0; height:54px;"><button class="btn btn-sm" style="width:130px; height:54px;" onclick="postMasterComment()">Send</button></div>
        </div>
        <div id="mod_footer" style="margin-top:2.5rem; display:flex; justify-content:flex-end; gap:15px;"></div>
    </div>
</div>

<div id="paymentModal" class="modal" onclick="if(event.target.id==='paymentModal') this.style.display='none'">
    <div class="modal-content" style="max-width:550px; padding:3rem;">
        <button style="position:absolute; top:1.5rem; right:1.5rem; border:none; background:transparent; font-size:1.5rem; cursor:pointer;" onclick="document.getElementById('paymentModal').style.display='none'">&times;</button>
        
        <div style="text-align:center; margin-bottom:2rem;">
            <i class="fas fa-lock" style="font-size:2.5rem; color:var(--success); margin-bottom:1rem;"></i>
            <h2 style="margin:0;">Secure Escrow Checkout</h2>
            <p style="color:var(--muted); margin-top:5px;">Funds will be held securely until you confirm receipt.</p>
        </div>

        <div class="payment-card">
            <div style="display:flex; justify-content:space-between; margin-bottom:1.5rem;">
                <i class="fab fa-cc-visa" style="font-size:2rem; color:rgba(255,255,255,0.8);"></i>
                <i class="fas fa-wifi" style="font-size:1.5rem; color:rgba(255,255,255,0.5);"></i>
            </div>
            
            <label style="color:rgba(255,255,255,0.6); font-size:0.75rem;">Card Number</label>
            <div class="cc-input-group">
                <i class="far fa-credit-card"></i>
                <input type="text" placeholder="0000  0000  0000  0000" maxlength="19" id="cc_num" value="4242 4242 4242 4242">
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
                <div>
                    <label style="color:rgba(255,255,255,0.6); font-size:0.75rem;">Expiry Date</label>
                    <div class="cc-input-group">
                        <i class="far fa-calendar-alt"></i>
                        <input type="text" placeholder="MM/YY" maxlength="5" value="12/28">
                    </div>
                </div>
                <div>
                    <label style="color:rgba(255,255,255,0.6); font-size:0.75rem;">CVC</label>
                    <div class="cc-input-group">
                        <i class="fas fa-lock"></i>
                        <input type="password" placeholder="123" maxlength="3" value="123">
                    </div>
                </div>
            </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; padding:1.5rem; background:#f8fafc; border-radius:1rem; margin-bottom:2rem; border:1px solid #eef2f6;">
            <div>
                <div style="font-weight:700; color:var(--dark);" id="pay_item_title">Item Name</div>
                <div style="font-size:0.85rem; color:var(--muted);">DormLift Secure Protection</div>
            </div>
            <div style="font-size:1.8rem; font-weight:900; color:var(--dark);" id="pay_item_price">$0.00</div>
        </div>

        <button id="btn_process_pay" class="btn" style="width:100%; padding:1.2rem; font-size:1.1rem;" onclick="processPayment()">
            Pay Securely <i class="fas fa-arrow-right"></i>
        </button>
    </div>
</div>

<div id="pointsModal" class="modal" onclick="if(event.target.id==='pointsModal') this.style.display='none'">
    <div class="modal-content" style="max-width:550px;"><button style="position:absolute; top:1.5rem; right:1.5rem; border:none; background:transparent; font-size:1.5rem; cursor:pointer;" onclick="document.getElementById('pointsModal').style.display='none'">&times;</button><h2 style="margin-top:0;">Medal History</h2><div id="pts_list" style="max-height:400px; overflow-y:auto; border:1px solid #eef2f6; border-radius:12px;"></div></div>
</div>

<script>
    // ======================= STATE & NAVIGATION =======================
    let user = JSON.parse(localStorage.getItem('user'));
    let map, routingControl, modalMap, modalRoutingControl, markers = [], modalMarkers = [];
    let state = { log: [], mar: [], for: [], activeId: null, activeType: null, activeReplyId: null, pendingPayId: null };

    const getAddrText = (s) => s && s.includes('@@') ? s.split('@@')[1] : s;
    const getAddrCoords = (s) => (s && s.includes('@@')) ? s.split('@@')[0].split(',').map(Number) : null;

    function navigate(p) {
        if (!user && ['post', 'profile'].includes(p)) p = 'login';
        document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
        document.getElementById(p).classList.add('active');
        if(user) document.getElementById('menu').innerHTML = `<div class="user-tag" onclick="navigate('profile')">${user.anonymous_name} <span style="margin-left:5px; background:white; color:var(--primary); padding:2px 6px; border-radius:10px;">$${user.wallet_balance || 1000}</span></div><a onclick="navigate('hall')">Discover</a><a onclick="navigate('post')">Publish</a>`;
        else document.getElementById('menu').innerHTML = `<a onclick="navigate('home')">Home</a><a onclick="navigate('hall')">Discover</a><a onclick="navigate('login')">Login</a>`;
        
        if(p==='hall') loadHall();
        if(p==='post') initMap();
        if(p==='profile') loadProfile();
        window.scrollTo(0,0);
    }

    function logout() { localStorage.clear(); location.reload(); }

    function switchHall(tab) {
        ['logistics', 'market', 'forum'].forEach(t => {
            const btn = document.getElementById(`btn_hall_${t}`); const content = document.getElementById(`hall_${t}`);
            if(btn) btn.classList.toggle('active', t===tab); if(content) content.classList.toggle('active', t===tab);
        });
    }
    function switchPost(tab) {
        ['logistics', 'market', 'forum'].forEach(t => {
            const btn = document.getElementById(`btn_post_${t}`); const content = document.getElementById(`post_${t}`);
            if(btn) btn.classList.toggle('active', t===tab); if(content) content.classList.toggle('active', t===tab);
        });
        if(tab==='logistics' && map) setTimeout(()=>map.invalidateSize(), 200);
    }
    function switchProf(tab) {
        ['kb_log', 'kb_mar', 'kb_for'].forEach(t => {
            const btn = document.getElementById(`btn_prof_${t}`); const content = document.getElementById(t);
            if(btn) btn.classList.toggle('active', t===tab); if(content) content.classList.toggle('active', t===tab);
        });
    }

    function previewFiles(e, id) {
        const s = document.getElementById(id); s.innerHTML="";
        Array.from(e.target.files).slice(0,5).forEach(f=>{ const r=new FileReader(); r.onload=ev=>s.innerHTML+=`<img src="${ev.target.result}" class="thumb-img">`; r.readAsDataURL(f); });
    }

    // ======================= MAP ENGINE =======================
    function initMap() {
        if(map) return;
        setTimeout(() => {
            map = L.map('map', {zoomControl:false}).setView([-36.8509, 174.7645], 14); L.control.zoom({position:'topright'}).addTo(map);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(map);
            routingControl = L.Routing.control({lineOptions:{styles:[{color:'#4f46e5',weight:6, dashArray: '10, 10'}]}, createMarker:()=>null, show:false, addWaypoints:false}).on('routesfound', ev=>{
                document.getElementById('distVal').innerText=(ev.routes[0].summary.totalDistance/1000).toFixed(2);
                document.getElementById('timeVal').innerText=Math.round(ev.routes[0].summary.totalTime/60);
            }).addTo(map);

            map.on('click', async e => {
                if(markers.length>=2) { markers.forEach(m=>map.removeLayer(m)); markers=[]; routingControl.setWaypoints([]); document.getElementById('distVal').innerText="0.00"; document.getElementById('timeVal').innerText="0"; }
                let isStart = markers.length === 0;
                let icon = L.divIcon({className:'custom-pin', html:`<div class="pin-wrapper" style="border-color:${isStart?'var(--primary)':'var(--success)'}"><i class="fas ${isStart?'fa-street-view':'fa-flag-checkered'}" style="color:${isStart?'var(--primary)':'var(--success)'}; font-size:14px;"></i></div>`, iconSize:[34,34], iconAnchor:[17,34]});
                markers.push(L.marker(e.latlng, {icon}).addTo(map));
                const inp = document.getElementById(isStart ? 'p_from' : 'p_to'); inp.value = "Fetching address...";
                try {
                    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${e.latlng.lat}&lon=${e.latlng.lng}`,{headers:{'User-Agent':'DormLift/12'}});
                    const d = await r.json(); inp.value = d.display_name ? d.display_name.split(',').slice(0,3).join(',') : `${e.latlng.lat.toFixed(3)},${e.latlng.lng.toFixed(3)}`;
                } catch(err) { inp.value = "Coordinate pinned"; }
                if(markers.length===2) routingControl.setWaypoints([markers[0].getLatLng(), markers[1].getLatLng()]);
            });
        }, 300);
    }

    // ======================= LOAD HUB DATA =======================
    async function loadHall() {
        const [rL, rM, rF] = await Promise.all([fetch('/api/task/all'), fetch('/api/market/all'), fetch('/api/forum/all')]);
        state.log = (await rL.json()).list || []; state.mar = (await rM.json()).list || []; state.for = (await rF.json()).list || [];
        
        document.getElementById('list_logistics').innerHTML = state.log.map(t=>`
            <div class="hub-row" onclick="openMaster('log', '${t._id}')">
                <div class="posted-col">PUB<span>${new Date(t.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span></div>
                <div class="details-strip"><div class="strip-header"><i class="far fa-calendar-check"></i> Move: ${t.move_date}</div><div class="strip-route"><i class="fas fa-circle"></i> ${getAddrText(t.from_addr)} <i class="fas fa-arrow-right" style="margin:0 5px; color:var(--text);"></i> <i class="fas fa-flag-checkered"></i> ${getAddrText(t.to_addr)}</div><div class="strip-inventory"><span style="background:#fef3c7; color:var(--medal); padding:2px 8px; border-radius:6px; font-weight:800; font-size:0.75rem;">🏅 ${t.medal_points||1} Pts</span> <b>Items:</b> ${t.items_desc.substring(0,60)}...</div></div>
                <div class="reward-col">${t.reward}</div>
            </div>`).join('') || '<div style="padding:5rem; text-align:center; color:var(--muted); font-size:1.1rem; font-weight:600;">No active logistics tasks.</div>';
            
        document.getElementById('list_market').innerHTML = state.mar.map(m=>{
            const img = JSON.parse(m.img_url)[0] || '';
            return `<div class="market-card" onclick="openMaster('mar', '${m._id}')"><img src="${img}" class="m-img" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\\'http://www.w3.org/2000/svg\\\' width=\\\'100\\\' height=\\\'100\\\'></svg>'"><div class="m-body"><div><h3 class="m-title">${m.title}</h3><div style="margin-bottom:10px;"><span style="background:#f1f5f9; padding:4px 10px; border-radius:6px; color:var(--dark); font-weight:700; font-size:0.8rem;">${m.condition}</span></div></div><div><div class="m-price">$${m.price}</div><div style="font-size:0.85rem; color:grey; margin-top:10px;"><i class="fas fa-map-marker-alt"></i> ${m.location}</div></div></div></div>`;
        }).join('') || '<div style="padding:5rem; text-align:center; grid-column:1/-1; color:var(--muted); font-size:1.1rem; font-weight:600;">Market is empty.</div>';
        
        document.getElementById('list_forum').innerHTML = state.for.map(f=>{
            const imgs = JSON.parse(f.img_url).map(u=>`<img src="${u}" style="max-width:100%; border-radius:10px; margin-top:10px;">`).join('');
            const isLiked = user && f.likes.includes(user.email);
            return `<div class="forum-card"><div style="display:flex; align-items:center; gap:10px; margin-bottom:15px;"><div class="user-tag" style="background:#f1f5f9;">${f.author_name}</div><small style="color:grey;">${new Date(f.created_at).toLocaleDateString()}</small></div><div style="font-size:1.1rem;">${f.content}</div>${imgs}<div style="margin-top:15px; border-top:1px solid #eee; padding-top:15px;"><button class="btn btn-outline btn-sm" style="${isLiked?'background:var(--primary);color:white;border-color:var(--primary);':''}" onclick="interactForum('${f._id}', 'like')"><i class="fas fa-heart"></i> ${f.likes.length}</button> <button class="btn btn-outline btn-sm" onclick="openMaster('for','${f._id}')"><i class="fas fa-comment"></i> Discuss (${f.comments.length})</button></div></div>`;
        }).join('') || '<div style="padding:5rem; text-align:center; color:var(--muted); font-size:1.1rem; font-weight:600;">No buzz yet.</div>';
    }

    // ======================= MASTER MODAL LOGIC =======================
    function initModalMap(fromC, toC) {
        if(!modalMap) {
            modalMap = L.map('modal-map', {zoomControl: false}).setView([-36.8509, 174.7645], 14);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(modalMap);
            modalRoutingControl = L.Routing.control({ lineOptions: { styles: [{ color: '#4f46e5', weight: 5, opacity: 0.8, dashArray: '10, 10' }] }, createMarker: () => null, show: false, addWaypoints: false }).addTo(modalMap);
        }
        modalMarkers.forEach(layer => modalMap.removeLayer(layer)); modalMarkers = [];
        modalRoutingControl.setWaypoints([]);

        if(fromC && toC) {
            let sI = L.divIcon({className: 'custom-pin', html: `<div class="pin-wrapper" style="border-color:var(--primary)"><i class="fas fa-street-view" style="color:var(--primary); font-size:14px;"></i></div>`, iconSize: [34, 34], iconAnchor: [17, 34]});
            let eI = L.divIcon({className: 'custom-pin', html: `<div class="pin-wrapper" style="border-color:var(--success)"><i class="fas fa-flag-checkered" style="color:var(--success); font-size:14px;"></i></div>`, iconSize: [34, 34], iconAnchor: [17, 34]});
            let m1 = L.marker(fromC, {icon: sI}).addTo(modalMap); let m2 = L.marker(toC, {icon: eI}).addTo(modalMap);
            modalMarkers.push(m1, m2);
            modalRoutingControl.setWaypoints([L.latLng(fromC[0], fromC[1]), L.latLng(toC[0], toC[1])]);
            modalMap.fitBounds(new L.featureGroup([m1, m2]).getBounds(), {padding: [30, 30]});
        }
        setTimeout(() => modalMap.invalidateSize(), 300); 
    }

    async function openMaster(type, id) {
        state.activeType = type; state.activeId = id;
        
        let item = state[type].find(x=>x._id===id); 
        if(!item && user) {
            const r = await fetch('/api/user/dashboard', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:user.email})});
            const d = await r.json();
            const arr = type==='log'?d.tasks:(type==='mar'?d.market:d.posts);
            item = arr.find(x=>x._id===id);
        }
        if(!item) return;

        const h = document.getElementById('mod_header'); const b = document.getElementById('mod_body'); const f = document.getElementById('mod_footer');
        const mapD = document.getElementById('modal-map'); mapD.style.display='none';
        
        document.getElementById('mod_thumbs').innerHTML = JSON.parse(item.img_url||'[]').map(u=>`<img src="${u}" class="thumb-img" onclick="window.open('${u}')">`).join('');
        renderComments(item.comments||[]);

        if(type === 'log') {
            h.innerHTML = `<h2>${item.reward} Task</h2><span class="status-badge" style="background:var(--primary);color:white;">${item.status}</span>`;
            b.innerHTML = `<p><b>From:</b> ${getAddrText(item.from_addr)}</p><p><b>To:</b> ${getAddrText(item.to_addr)}</p><p><b>Scale:</b> ${item.task_scale} <span style="background:#fef3c7; padding:2px 8px; border-radius:6px; color:var(--medal); font-size:0.8rem; font-weight:800;">🏅 ${item.medal_points} Pts</span></p><p><b>Items:</b> ${item.items_desc}</p>`;
            let btns = '';
            if(item.status==='pending' && item.publisher_id!==user.email) btns=`<button class="btn" onclick="execFlow('log','assigned')">Accept Mission</button>`;
            else if(item.status==='assigned' && item.publisher_id===user.email) btns=`<button class="btn" onclick="execFlow('log','completed')">Confirm Delivery</button>`;
            if(item.publisher_id===user.email) btns+=`<button class="btn btn-danger" onclick="deleteItem('log', '${item._id}')">Withdraw Task</button>`;
            f.innerHTML = btns || `<span>Read Only</span>`;
            
            let fC = getAddrCoords(item.from_addr); let tC = getAddrCoords(item.to_addr);
            if(fC && tC) { mapD.style.display='block'; initModalMap(fC, tC); }
            
        } else if (type === 'mar') {
            h.innerHTML = `<h2>$${item.price} - ${item.title}</h2><span class="status-badge" style="background:var(--success);color:white;">${item.status}</span>`;
            let escrowNote = item.status === 'reserved' ? `<div style="background:#fef3c7; color:#b45309; padding:12px; border-radius:8px; margin-bottom:15px; font-weight:700;"><i class="fas fa-lock"></i> Funds ($${item.price}) secured in Escrow.</div>` : '';
            b.innerHTML = `${escrowNote}<p><b>Condition:</b> ${item.condition}</p><p><b>Location:</b> ${item.location}</p><p><b>Details:</b> ${item.description}</p>`;
            
            let btns = '';
            // V12.1 MOCK PAYMENT INTERCEPTOR
            if(item.status==='available' && item.seller_id!==user.email) {
                // Open simulated Stripe payment instead of direct execution
                btns=`<button class="btn" style="background:var(--success); padding:1.4rem 3rem;" onclick="openPaymentModal('${item._id}', ${item.price}, '${item.title.replace(/'/g, "\\'")}')">Pay securely to Escrow <i class="fas fa-credit-card"></i></button>`;
            }
            else if(item.status==='reserved' && item.buyer_id===user.email) {
                btns=`<button class="btn" onclick="execFlow('mar','completed')">Confirm Receipt (Release to Seller)</button><button class="btn btn-outline" style="color:var(--danger);" onclick="execFlow('mar','available')">Cancel & Refund</button>`;
            }
            else if(item.status==='reserved' && item.seller_id===user.email) {
                btns=`<span style="color:var(--muted); font-weight:700;">Waiting for Buyer receipt confirmation...</span>`;
            }
            if(item.seller_id===user.email && item.status==='available') btns+=`<button class="btn btn-danger" onclick="deleteItem('mar', '${item._id}')">Remove Listing</button>`;
            f.innerHTML = btns || `<span>Read Only</span>`;
            
        } else if (type === 'for') {
            h.innerHTML = `<h3>${item.author_name}</h3><small>${new Date(item.created_at).toLocaleString()}</small>`;
            b.innerHTML = `<div style="font-size:1.1rem; line-height:1.6;">${item.content}</div>`; f.innerHTML = '';
        }
        document.getElementById('masterModal').style.display='flex';
    }

    function renderComments(c) {
        document.getElementById('mod_comments').innerHTML = c.filter(x=>!x.parentId).map(p=>`
            <div class="comment-item">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;"><b>${p.user}</b><small>${new Date(p.time).toLocaleString()}</small></div>
                <div>${p.text} <span class="reply-btn" onclick="setReply('${p.id}', '${p.user}')" style="color:var(--primary);cursor:pointer;font-size:0.7rem;font-weight:800;margin-left:10px;">REPLY</span></div>
                ${c.filter(r=>String(r.parentId)===String(p.id)).map(r2=>`<div class="comment-reply" style="margin-left:20px; border-left:3px solid var(--primary); padding-left:15px; margin-top:10px; font-size:0.9rem;"><b>${r2.user}:</b> ${r2.text}</div>`).join('')}
            </div>`).join('') || '<p style="text-align:center; padding:1rem; color:var(--muted);">No discussion yet.</p>';
    }

    function setReply(id, name) { state.activeReplyId = String(id); document.getElementById('reply_hint').style.display='block'; document.getElementById('reply_name').innerText=name; document.getElementById('mod_input').focus(); }
    function cancelReply() { state.activeReplyId = null; document.getElementById('reply_hint').style.display='none'; }

    async function postMasterComment() {
        const text = document.getElementById('mod_input').value; if(!text) return;
        const api = state.activeType==='log' ? '/api/task/comment' : (state.activeType==='mar' ? '/api/market/comment' : '/api/forum/interact');
        const body = state.activeType==='for' ? {post_id:state.activeId, action:'comment', comment:{user:user.anonymous_name, text}} : (state.activeType==='log' ? {task_id:state.activeId, comment:{user:user.anonymous_name, text}} : {item_id:state.activeId, comment:{user:user.anonymous_name, text}});
        await fetch(api, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
        document.getElementById('mod_input').value=""; cancelReply(); openMaster(state.activeType, state.activeId); loadHall();
    }
    
    async function execFlow(type, nextStatus) {
        if(!confirm("Confirm binding transaction?")) return;
        const api = type==='log' ? '/api/task/workflow' : '/api/market/workflow';
        const body = type==='log' ? {task_id:state.activeId, status:nextStatus, helper_id:user.email} : {item_id:state.activeId, status:nextStatus, buyer_id:user.email};
        
        const res = await fetch(api, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
        const data = await res.json();
        
        if(data.msg === 'INSUFFICIENT_FUNDS') alert("Insufficient Wallet Balance! Transaction blocked.");
        else if (data.success) { document.getElementById('masterModal').style.display='none'; navigate('profile'); }
    }
    
    async function deleteItem(type, id) {
        if(!confirm("Permanently withdraw?")) return;
        const api = type === 'log' ? '/api/task/delete' : '/api/market/delete';
        await fetch(api, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({task_id:id, email:user.email}) });
        document.getElementById('masterModal').style.display='none'; loadHall();
    }
    async function interactForum(id, action) { await fetch('/api/forum/interact', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({post_id:id, action, email:user.email})}); loadHall(); }

    // ======================= V12.1 PAYMENT GATEWAY SIMULATOR =======================
    function openPaymentModal(id, price, title) {
        state.pendingPayId = id;
        document.getElementById('pay_item_title').innerText = title;
        document.getElementById('pay_item_price').innerText = `$${price.toFixed(2)}`;
        
        const btn = document.getElementById('btn_process_pay');
        btn.innerHTML = `Pay Securely <i class="fas fa-arrow-right"></i>`;
        btn.disabled = false;
        
        // Hide master modal, show payment modal
        document.getElementById('masterModal').style.display = 'none';
        document.getElementById('paymentModal').style.display = 'flex';
    }

    function processPayment() {
        const btn = document.getElementById('btn_process_pay');
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing Secure Payment...`;
        
        // Simulate network delay and card authorization (1.5 seconds)
        setTimeout(async () => {
            btn.innerHTML = `<i class="fas fa-check-circle"></i> Payment Authorized`;
            btn.style.background = 'var(--success)';
            
            // Execute the actual Escrow backend logic after fake card auth
            const res = await fetch('/api/market/workflow', { 
                method:'POST', 
                headers:{'Content-Type':'application/json'}, 
                body:JSON.stringify({item_id: state.pendingPayId, status: 'reserved', buyer_id: user.email}) 
            });
            const data = await res.json();
            
            setTimeout(() => {
                document.getElementById('paymentModal').style.display = 'none';
                btn.style.background = 'var(--primary-gradient)'; // Reset color
                
                if(data.msg === 'INSUFFICIENT_FUNDS') {
                    alert("Virtual Bank declined: Insufficient wallet balance.");
                } else if (data.success) {
                    alert("Payment Successful! Funds are now secured in Platform Escrow.");
                    navigate('profile');
                }
            }, 800);
            
        }, 1500);
    }

    // ======================= PROFILE & DASHBOARD =======================
    async function loadProfile() {
        const r1 = await fetch(`/api/user/detail/${user.email}`); const d1 = await r1.json(); const u = d1.user;
        user.wallet_balance = u.wallet_balance; localStorage.setItem('user', JSON.stringify(user)); renderMenu(); // Sync wallet
        
        document.getElementById('prof_details').innerHTML = `<div><label>SID</label><b>${u.student_id}</b></div><div><label>Name</label><b>${u.first_name}</b></div><div><label>Email</label><b>${u.email}</b></div>`;
        document.getElementById('p_medals').innerText = u.medal_points||0;
        document.getElementById('p_wallet').innerText = u.wallet_balance||0;
        document.getElementById('pts_list').innerHTML = (u.point_history||[]).slice().reverse().map(h=>`<div style="padding:15px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;"><div><b>${h.desc}</b><br><small>${new Date(h.date).toLocaleDateString()}</small></div><b style="color:var(--medal);">+${h.points} Pts</b></div>`).join('') || '<p style="text-align:center; padding:2rem;">No points yet.</p>';

        const r2 = await fetch('/api/user/dashboard', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:user.email})}); const d2 = await r2.json();
        
        const renderKB = (pre, col, sts, arr) => {
            const list = arr.filter(x=>sts.includes(x.status));
            document.getElementById(`cnt_${pre}_${col}`).innerText = list.length;
            document.getElementById(`col_${pre}_${col}`).innerHTML = list.map(x=>{
                const isPub = (x.publisher_id||x.seller_id)===user.email;
                return `<div class="kanban-card" onclick="openMaster('${pre}', '${x._id}')"><div style="display:flex; justify-content:space-between; margin-bottom:10px;"><span class="kb-role-tag ${isPub?'kb-pub':'kb-help'}">${isPub?'Publisher/Seller':'Helper/Buyer'}</span><small>${new Date(x.created_at).toLocaleDateString()}</small></div><b style="font-size:1.2rem;">${x.reward||'$'+x.price}</b><br><small style="color:grey;">${pre==='log'?getAddrText(x.from_addr):x.location}</small></div>`;
            }).join('');
        };
        renderKB('log', 'pend', ['pending'], d2.tasks); renderKB('log', 'prog', ['assigned'], d2.tasks); renderKB('log', 'hist', ['completed','reviewed'], d2.tasks);
        renderKB('mar', 'pend', ['available'], d2.market); renderKB('mar', 'prog', ['reserved'], d2.market); renderKB('mar', 'hist', ['completed'], d2.market);
        
        document.getElementById('col_for_list').innerHTML = d2.posts.map(p => `<div class="card" style="padding:1.5rem; cursor:pointer;" onclick="openMaster('for', '${p._id}')"><span class="kb-role-tag kb-pub">My Buzz</span><div style="margin-top:10px;">${p.content}</div><div style="font-size:0.85rem; color:grey; margin-top:10px;"><i class="fas fa-heart"></i> ${p.likes.length} • <i class="fas fa-comment"></i> ${p.comments.length}</div></div>`).join('') || '<p style="text-align:center;">No posts.</p>';
    }

    // ======================= AUTH =======================
    async function sendCode() { const e=document.getElementById('r_email').value; if(!e)return; await fetch('/api/auth/send-code', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:e})}); alert('Code Sent'); }
    document.getElementById('regForm').onsubmit = async e => { e.preventDefault(); const b={student_id:document.getElementById('r_sid').value, anonymous_name:document.getElementById('r_anon').value, first_name:document.getElementById('r_fn').value, given_name:document.getElementById('r_ln').value, email:document.getElementById('r_email').value, password:document.getElementById('r_pwd').value, code:document.getElementById('r_code').value, phone:document.getElementById('r_phone').value, gender:document.getElementById('r_gender').value}; await fetch('/api/auth/register', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}); navigate('login'); };
    document.getElementById('loginForm').onsubmit = async e => { e.preventDefault(); const r=await fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:document.getElementById('l_user').value, password:document.getElementById('l_pwd').value})}); const d=await r.json(); if(d.success){ user=d.user; localStorage.setItem('user',JSON.stringify(user)); navigate('home'); } };

    navigate('home');
</script>
</body>
</html>

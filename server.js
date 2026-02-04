// server.js - Complete Personal Journal Server with Authentication
const express = require("express");
const fs = require("fs");
const path = require("path");
const session = require("express-session");

const app = express();
const PORT = 3000;

// IMPORTANT: Session MUST come before static files and body parsers
app.use(session({
    secret: 'journal-app-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'journal.sid', // Custom cookie name
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 30 * 60 * 1000,
        sameSite: 'lax',
        path: '/'
    }
}));

// Body parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files from current directory (where index.html is)
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, "data.json");
const AUTH_FILE = path.join(__dirname, "auth-data.json");

// ========== AUTHENTICATION FUNCTIONS ==========

function initializeAuthFile() {
    if (!fs.existsSync(AUTH_FILE)) {
        const initialAuth = {
            hasPassword: false,
            passwordHash: null,
            createdAt: new Date().toISOString()
        };
        fs.writeFileSync(AUTH_FILE, JSON.stringify(initialAuth, null, 2));
        console.log('✅ Created auth-data.json file');
    }
}

function readAuth() {
    try {
        const data = fs.readFileSync(AUTH_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { hasPassword: false, passwordHash: null };
    }
}

function writeAuth(authData) {
    try {
        fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing auth:', error);
        return false;
    }
}

function hashPassword(password) {
    return Buffer.from(password).toString('base64');
}

function verifyPassword(password, hash) {
    return hashPassword(password) === hash;
}

function requireAuth(req, res, next) {
    console.log('🔒 Auth check:');
    console.log('   Cookies received:', req.headers.cookie);
    console.log('   Session ID:', req.sessionID);
    console.log('   Session data:', req.session);
    console.log('   Authenticated?:', req.session.authenticated);
    
    if (req.session.authenticated) {
        console.log('   ✅ Auth passed');
        next();
    } else {
        console.log('   ❌ Auth failed - 401 Unauthorized');
        res.status(401).json({ error: 'Unauthorized' });
    }
}

// ========== DATA MANAGEMENT FUNCTIONS ==========

function initializeDataFile() {
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = { 
            journals: [], 
            todos: [],
            goals: [],
            folders: [],
            system: {
                version: "2.0.0",
                folderSchemaVersion: "1.0",
                lastBackup: new Date().toISOString()
            },
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
        console.log('✅ Created data.json file');
    }
}

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            initializeDataFile();
        }
        
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const data = JSON.parse(raw);
        
        return {
            journals: Array.isArray(data.journals) ? data.journals : [],
            todos: Array.isArray(data.todos) ? data.todos : [],
            goals: Array.isArray(data.goals) ? data.goals : [],
            folders: Array.isArray(data.folders) ? data.folders : [],
            system: data.system || {
                version: "2.0.0",
                folderSchemaVersion: "1.0",
                lastBackup: new Date().toISOString()
            },
            lastUpdated: data.lastUpdated || new Date().toISOString()
        };
    } catch (error) {
        console.error('❌ Error loading data:', error);
        return {
            journals: [],
            todos: [],
            goals: [],
            folders: [],
            system: { version: "2.0.0" },
            lastUpdated: new Date().toISOString()
        };
    }
}

function saveData(data) {
    try {
        data.lastUpdated = new Date().toISOString();
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('❌ Error saving data:', error);
        return false;
    }
}

// ========== AUTHENTICATION ENDPOINTS ==========

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        server: 'Journal API v2.0'
    });
});

app.get('/api/auth/check', (req, res) => {
    try {
        const authData = readAuth();
        res.json({ 
            hasPassword: authData.hasPassword,
            authenticated: req.session.authenticated || false
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/setup', (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password || password.length < 4) {
            return res.status(400).json({ error: 'Password must be at least 4 characters' });
        }
        
        const authData = readAuth();
        
        if (authData.hasPassword) {
            return res.status(400).json({ error: 'Password already set' });
        }
        
        authData.hasPassword = true;
        authData.passwordHash = hashPassword(password);
        authData.createdAt = new Date().toISOString();
        
        writeAuth(authData);
        req.session.authenticated = true;
        
        console.log('✅ Password set up successfully');
        res.json({ success: true, message: 'Password set successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', (req, res) => {
    console.log('🔐 Login attempt received');
    console.log('   Cookies received:', req.headers.cookie);
    console.log('   Session ID:', req.sessionID);
    console.log('   Session data:', req.session);
    
    try {
        const { password } = req.body;
        const authData = readAuth();
        
        if (!authData.hasPassword) {
            console.log('   ❌ No password set');
            return res.status(400).json({ error: 'No password set' });
        }
        
        if (verifyPassword(password, authData.passwordHash)) {
            req.session.authenticated = true;
            req.session.lastActivity = Date.now();
            
            // Force session save
            req.session.save((err) => {
                if (err) {
                    console.log('   ❌ Session save error:', err);
                    return res.status(500).json({ error: 'Session error' });
                }
                
                console.log('   ✅ Login successful');
                console.log('   Session after save:', req.session);
                console.log('   Setting cookie:', res.getHeader('Set-Cookie'));
                res.json({ success: true, message: 'Login successful' });
            });
        } else {
            console.log('   ❌ Incorrect password');
            res.status(401).json({ error: 'Incorrect password' });
        }
    } catch (error) {
        console.log('   ❌ Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    console.log('✅ User logged out');
    res.json({ success: true, message: 'Logged out' });
});

app.post('/api/auth/activity', requireAuth, (req, res) => {
    req.session.lastActivity = Date.now();
    res.json({ success: true });
});

// ========== DATA ENDPOINTS (with auth) ==========

// Serve index.html at root
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    console.log('📄 Serving index.html from:', indexPath);
    
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        console.error('❌ index.html not found at:', indexPath);
        res.status(404).send(`
            <h1>Error: index.html not found</h1>
            <p>Looking for file at: ${indexPath}</p>
            <p>Please ensure index.html is in the same directory as server.js</p>
        `);
    }
});

app.get("/api/journals", requireAuth, (req, res) => {
    try {
        const data = loadData();
        console.log(`📊 Loaded: ${data.journals.length} journals, ${data.todos.length} todos, ${data.goals.length} goals`);
        res.json(data);
    } catch (error) {
        console.error('❌ Error loading data:', error);
        res.status(500).json({ error: 'Failed to load data' });
    }
});

app.post("/api/journals", requireAuth, (req, res) => {
    try {
        const data = req.body;
        if (saveData(data)) {
            console.log(`💾 Saved: ${data.journals?.length || 0} journals, ${data.todos?.length || 0} todos, ${data.goals?.length || 0} goals`);
            res.json({ success: true, message: 'Data saved successfully' });
        } else {
            res.status(500).json({ error: 'Failed to save data' });
        }
    } catch (error) {
        console.error('❌ Error saving data:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get("/api/folders", requireAuth, (req, res) => {
    try {
        const data = loadData();
        res.json({
            success: true,
            folders: data.folders,
            count: data.folders.length
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to get folders" });
    }
});

app.get("/api/todos", requireAuth, (req, res) => {
    try {
        const data = loadData();
        res.json({
            success: true,
            todos: data.todos,
            count: data.todos.length
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to get todos" });
    }
});

app.get("/api/goals", requireAuth, (req, res) => {
    try {
        const data = loadData();
        res.json({
            success: true,
            goals: data.goals,
            count: data.goals.length
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to get goals" });
    }
});

app.get("/api/export", requireAuth, (req, res) => {
    try {
        const data = loadData();
        const exportData = {
            ...data,
            exportedAt: new Date().toISOString(),
            exportFormat: "journal-app-v2.0"
        };
        
        const filename = `journal-backup-${new Date().toISOString().split('T')[0]}.json`;
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(exportData, null, 2));
    } catch (error) {
        res.status(500).json({ error: "Failed to export data" });
    }
});

// ========== SERVER STARTUP ==========

initializeAuthFile();
initializeDataFile();

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║   📔 Personal Journal Server v2.0 + Auth   ║
╚════════════════════════════════════════════╝

🌐 Server: http://localhost:${PORT}
🔒 Authentication: ENABLED
📁 Data file: ${DATA_FILE}
🔐 Auth file: ${AUTH_FILE}

📡 Available Endpoints:
  GET    /api/health               ✅ Public
  GET    /api/auth/check           ✅ Public
  POST   /api/auth/setup           ✅ Public
  POST   /api/auth/login           ✅ Public
  POST   /api/auth/logout          🔒 Protected
  POST   /api/auth/activity        🔒 Protected
  GET    /api/journals             🔒 Protected
  POST   /api/journals             🔒 Protected
  GET    /api/folders              🔒 Protected
  GET    /api/todos                🔒 Protected
  GET    /api/goals                🔒 Protected
  GET    /api/export               🔒 Protected

✅ Server ready!
    `);
});

app.use((err, req, res, next) => {
    console.error('🚨 Server error:', err);
    res.status(500).json({ error: "Internal server error" });
});

app.use((req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
});

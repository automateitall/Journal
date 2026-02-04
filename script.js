// ===================================
// GLOBAL VARIABLES & INITIALIZATION
// ===================================

let journals = [];
let goals = [];
let todos = [];
let folders = [];
let currentSection = 'entries';
let currentDate = new Date();
let selectedDate = null;
let isAuthenticated = false;
let sessionTimeout = null;
let currentTags = [];
let editingEntryId = null;
let editingGoalId = null;
let selectedGoalIds = [];
let selectedTodoIds = [];
let selectedEntryIds = [];
let quill = null;
let currentEntryId = null;
let pomodoroInterval = null;
let pomodoroSeconds = 1500;
let pomodoroRunning = false;
let serverConnected = false;
let connectionCheckInterval = null;

const SESSION_DURATION = 30 * 60 * 1000;
const API_BASE_URL = 'http://localhost:3000/api';
const CONNECTION_CHECK_INTERVAL = 10000; // Check every 10 seconds

// Charts
let moodTrendChart, moodDistributionChart, moodByDayChart;
let writingFrequencyChart, moodByLocationChart, moodByMonthChart;

// ===================================
// DUAL-AXIS MOOD MODEL (Valence-Energy)
// ===================================

// Circumplex Model: Each mood has valence (-1 to +1) and energy (-1 to +1)
const moodModel = {
    // High Energy Positive (Quadrant I)
    'Happy': { valence: 0.8, energy: 0.6, color: '#FFD700', emoji: '😊' },
    'Excited': { valence: 0.7, energy: 0.9, color: '#FF6B35', emoji: '🤩' },
    'Grateful': { valence: 0.9, energy: 0.3, color: '#95E1D3', emoji: '🙏' },
    'Inspired': { valence: 0.8, energy: 0.7, color: '#AA96DA', emoji: '✨' },
    
    // Low Energy Positive (Quadrant II)
    'Peaceful': { valence: 0.7, energy: -0.4, color: '#A8DADC', emoji: '😌' },
    
    // Neutral
    'Thoughtful': { valence: 0.2, energy: -0.2, color: '#D3D3D3', emoji: '🤔' },
    
    // Low Energy Negative (Quadrant III)
    'Melancholic': { valence: -0.6, energy: -0.5, color: '#8D99AE', emoji: '😔' },
    'Tired': { valence: -0.3, energy: -0.8, color: '#A9B4C2', emoji: '😴' },
    
    // High Energy Negative (Quadrant IV)
    'Anxious': { valence: -0.4, energy: 0.7, color: '#E63946', emoji: '😰' },
    'Frustrated': { valence: -0.7, energy: 0.5, color: '#D62828', emoji: '😤' }
};
// Add at the top of your script.js, after global variables
function initializeMobileView() {
    const isMobile = window.innerWidth <= 768;
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    
    if (isMobile && sidebar && mainContent) {
        // Convert sidebar to top navigation
        sidebar.style.position = 'fixed';
        sidebar.style.top = '0';
        sidebar.style.left = '0';
        sidebar.style.width = '100%';
        sidebar.style.height = '60px';
        sidebar.style.flexDirection = 'row';
        sidebar.style.overflowX = 'auto';
        sidebar.style.zIndex = '1000';
        sidebar.style.padding = '0 10px';
        sidebar.style.backgroundColor = 'var(--bg-primary)';
        sidebar.style.borderBottom = '1px solid var(--border-light)';
        
        // Adjust main content
        mainContent.style.marginTop = '60px';
        
        // Make nav items horizontal
        const navItems = sidebar.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.style.flex = '0 0 auto';
            item.style.padding = '10px 15px';
            item.style.height = '100%';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.whiteSpace = 'nowrap';
        });
        
        // Hide folders on mobile
        const foldersSection = document.querySelector('.folders-section');
        if (foldersSection) {
            foldersSection.style.display = 'none';
        }
    }
}

// Call this on load and resize
window.addEventListener('resize', initializeMobileView);
// Helper functions for dual-axis mood model
function getMoodValence(mood) {
    return moodModel[mood]?.valence ?? 0;
}

function getMoodEnergy(mood) {
    return moodModel[mood]?.energy ?? 0;
}

function getMoodColor(mood) {
    return moodModel[mood]?.color ?? '#CCCCCC';
}

function getMoodEmoji(mood) {
    return moodModel[mood]?.emoji ?? '😐';
}

function getMoodQuadrant(mood) {
    const v = getMoodValence(mood);
    const e = getMoodEnergy(mood);
    
    if (v >= 0.3 && e >= 0.3) return 'High Energy Positive';
    if (v >= 0.3 && e < 0.3) return 'Low Energy Positive';
    if (v < -0.3 && e < -0.3) return 'Low Energy Negative';
    if (v < -0.3 && e >= -0.3) return 'High Energy Negative';
    return 'Neutral';
}

// Calculate average mood coordinates
function calculateAverageMood(entries) {
    if (!entries || entries.length === 0) return { valence: 0, energy: 0 };
    
    let totalValence = 0;
    let totalEnergy = 0;
    let count = 0;
    
    entries.forEach(entry => {
        if (entry.mood && moodModel[entry.mood]) {
            totalValence += getMoodValence(entry.mood);
            totalEnergy += getMoodEnergy(entry.mood);
            count++;
        }
    });
    
    if (count === 0) return { valence: 0, energy: 0 };
    
    return {
        valence: parseFloat((totalValence / count).toFixed(2)),
        energy: parseFloat((totalEnergy / count).toFixed(2))
    };
}

// Convert dual-axis to simple 1-5 score (backward compatibility)
function getMoodScore(mood) {
    if (!moodModel[mood]) return 3;
    
    const valence = getMoodValence(mood);
    const energy = getMoodEnergy(mood);
    
    // Weighted formula: Valence 70%, Energy 30%
    // Positive valence + high energy = higher score
    // Positive valence + low energy = moderate-high score
    // Negative valence + high energy = low score (stressed)
    // Negative valence + low energy = very low score (depressed)
    
    const baseScore = (valence + 1) * 2.5; // Convert -1 to +1 → 0 to 5
    const energyModifier = valence >= 0 
        ? energy * 0.3  // Positive moods: high energy boosts score
        : -Math.abs(energy) * 0.2; // Negative moods: energy lowers score
    
    const finalScore = baseScore + energyModifier;
    return Math.max(1, Math.min(5, Math.round(finalScore * 10) / 10)); // Round to 1 decimal
}

// Get mood quadrant statistics
function getMoodQuadrantStats(entries) {
    const quadrants = {
        'High Energy Positive': 0,
        'Low Energy Positive': 0,
        'Neutral': 0,
        'Low Energy Negative': 0,
        'High Energy Negative': 0
    };
    
    entries.forEach(e => {
        if (e.mood) {
            const quadrant = getMoodQuadrant(e.mood);
            quadrants[quadrant]++;
        }
    });
    
    return quadrants;
}

// Calculate mood distance between two moods (for similarity)
function moodDistance(mood1, mood2) {
    const v1 = getMoodValence(mood1);
    const e1 = getMoodEnergy(mood1);
    const v2 = getMoodValence(mood2);
    const e2 = getMoodEnergy(mood2);
    
    return Math.sqrt(Math.pow(v2 - v1, 2) + Math.pow(e2 - e1, 2));
}

// Find similar moods
function findSimilarMoods(mood, threshold = 0.4) {
    if (!moodModel[mood]) return [];
    
    const similar = [];
    Object.keys(moodModel).forEach(m => {
        if (m !== mood && moodDistance(mood, m) <= threshold) {
            similar.push(m);
        }
    });
    return similar;
}
function fixEntryLinkingSearch() {
    // Find the existing dropdown and replace it with search
    const entriesDropdown = document.getElementById('entriesDropdown');
    const entriesLinkingSection = document.querySelector('[data-section="entries-linking"]') || 
                                  document.querySelector('.form-group:has(#entriesDropdown)');
    
    if (entriesLinkingSection) {
        // Remove dropdown
        if (entriesDropdown) {
            entriesDropdown.remove();
        }
        
        // Create search input
        const searchHTML = `
            <div class="form-group">
                <label>🔗 Link Related Entries</label>
                <input type="text" 
                       id="entryLinkSearchInput" 
                       class="entry-search-input"
                       placeholder="Search entries to link (title, content, tags, mood, location)..."
                       oninput="searchEntriesToLink(this.value)">
                <div id="entrySearchResults" class="entry-search-results" style="display: none;"></div>
            </div>
            <div id="linkedEntriesDisplay" class="linked-entries-display">
                ${selectedEntryIds.length === 0 ? 
                    '<div class="empty-message">No entries linked yet</div>' : 
                    selectedEntryIds.map(id => {
                        const entry = journals.find(j => j.id === id);
                        return entry ? `
                            <div class="linked-entry-tag">
                                <span>${entry.title}</span>
                                <button class="remove-link" onclick="removeLinkedEntry('${id}')">×</button>
                            </div>
                        ` : '';
                    }).join('')}
            </div>
        `;
        
        entriesLinkingSection.innerHTML = searchHTML;
    }
}
// Analyze mood trend (valence and energy separately)
function analyzeMoodTrend(entries) {
    if (entries.length < 7) return { trend: 'insufficient data', valence: 0, energy: 0 };
    
    const recent = entries.slice(-7);
    const older = entries.length >= 14 ? entries.slice(-14, -7) : entries.slice(0, Math.max(1, entries.length - 7));
    
    const recentAvg = calculateAverageMood(recent);
    const olderAvg = calculateAverageMood(older);
    
    const valenceDiff = recentAvg.valence - olderAvg.valence;
    const energyDiff = recentAvg.energy - olderAvg.energy;
    
    let trend = '';
    if (valenceDiff > 0.2) trend = 'improving positivity';
    else if (valenceDiff < -0.2) trend = 'declining positivity';
    else if (energyDiff > 0.2) trend = 'increasing energy';
    else if (energyDiff < -0.2) trend = 'decreasing energy';
    else trend = 'stable';
    
    return {
        trend: trend,
        valenceDiff: valenceDiff.toFixed(2),
        energyDiff: energyDiff.toFixed(2),
        recentValence: recentAvg.valence,
        recentEnergy: recentAvg.energy
    };
}



// Initialize
document.addEventListener('DOMContentLoaded', function() {
    checkServerConnection();
    checkAuthentication();
    updateCurrentDate();
    // Initialize all fixes
setTimeout(() => {
    initializeMobileView();
    fixEntriesHeaderAlignment();
    addBackToAllButton();
}, 500);
    const editorElement = document.getElementById('editor');
    if (editorElement) {
        quill = new Quill('#editor', {
            theme: 'snow',
            placeholder: 'Write your thoughts...',
            modules: {
                toolbar: [
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ align: [] }, { align: 'center' }, { align: 'right' }, { align: 'justify' }],
                    [{ header: [1, 2, 3, false] }],
                    ['link', 'image'],
                    [{ list: 'ordered' }, { list: 'bullet' }],
                    [{ color: [] }, { background: [] }],
                    ['clean']
                ]
            }
        });
    }
    
    // Start periodic connection check
    startConnectionMonitoring();
});

// ===================================
// SERVER CONNECTION MANAGEMENT
// ===================================

async function checkServerConnection() {
    updateConnectionStatus('checking', 'Checking...');
    
    try {
        const response = await fetch(`${API_BASE_URL}/health`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
            serverConnected = true;
            updateConnectionStatus('connected', 'Server Connected');
            return true;
        } else {
            serverConnected = false;
            updateConnectionStatus('disconnected', 'Server Error');
            return false;
        }
    } catch (error) {
        serverConnected = false;
        updateConnectionStatus('disconnected', 'Server Offline');
        console.error('Server connection error:', error);
        return false;
    }
}

function updateConnectionStatus(status, message) {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;
    
    statusEl.className = `connection-status ${status}`;
    const textEl = statusEl.querySelector('.status-text');
    if (textEl) textEl.textContent = message;
}

function startConnectionMonitoring() {
    // Check connection immediately
    checkServerConnection();
    
    // Then check periodically
    connectionCheckInterval = setInterval(() => {
        checkServerConnection();
    }, CONNECTION_CHECK_INTERVAL);
}

function stopConnectionMonitoring() {
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
    }
}

// ===================================
// AUTHENTICATION (SERVER-BASED ONLY)
// ===================================

async function checkAuthentication() {
    // Wait for server connection check
    const connected = await checkServerConnection();
    
    if (!connected) {
        showToast('Cannot connect to server. Please ensure the server is running.', 'error');
        document.getElementById('loginOverlay').style.display = 'flex';
        return;
    }
    
    try {
        // Check if user exists on server
        const response = await fetch(`${API_BASE_URL}/auth/check`, {
            method: 'GET',
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.hasPassword) {
                // User exists, show login
                document.getElementById('loginOverlay').style.display = 'flex';
            } else {
                // First time setup
                document.getElementById('firstTimeSetup').style.display = 'block';
                document.querySelector('.login-form').style.display = 'none';
            }
        } else {
            // Show first time setup
            document.getElementById('firstTimeSetup').style.display = 'block';
            document.querySelector('.login-form').style.display = 'none';
        }
    } catch (error) {
        console.error('Auth check error:', error);
        showToast('Authentication error. Using first-time setup.', 'warning');
        document.getElementById('firstTimeSetup').style.display = 'block';
        document.querySelector('.login-form').style.display = 'none';
    }
}

async function setupPassword(event) {
    event.preventDefault();
    
    if (!serverConnected) {
        showToast('Server not connected. Cannot set password.', 'error');
        return;
    }
    
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (newPassword !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
    }
    
    if (newPassword.length < 4) {
        showToast('Password must be at least 4 characters', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ password: newPassword })
        });
        
        if (response.ok) {
            // Wait a moment for session to be established
            await new Promise(resolve => setTimeout(resolve, 100));
            
            isAuthenticated = true;
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('mainApp').style.display = 'grid';
            
            await loadData();
            startSessionTimer();
            updateStreak();
            initializeFolders();
        } else {
            const error = await response.json();
            showToast(error.error || 'Failed to set password', 'error');
        }
    } catch (error) {
        showToast('Server error during setup', 'error');
        console.error('Setup error:', error);
    }
}

async function handleLogin(event) {
    event.preventDefault();
    
    if (!serverConnected) {
        showToast('Server not connected. Cannot login.', 'error');
        return;
    }
    
    const password = document.getElementById('passwordInput').value;
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ password })
        });
        
        if (response.ok) {
            // Wait a moment for session to be established
            await new Promise(resolve => setTimeout(resolve, 100));
            
            isAuthenticated = true;
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('mainApp').style.display = 'grid';
            
            await loadData();
            startSessionTimer();
            updateStreak();
            initializeFolders();
        } else {
            document.getElementById('loginError').textContent = 'Incorrect password';
        }
    } catch (error) {
        showToast('Login error', 'error');
        console.error('Login error:', error);
    }
}

function startSessionTimer() {
    clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(() => {
        logout();
    }, SESSION_DURATION);
}

async function logout() {
    try {
        await fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    isAuthenticated = false;
    clearTimeout(sessionTimeout);
    stopConnectionMonitoring();
    location.reload();
}

// ===================================
// DATA MANAGEMENT
// ===================================

async function loadData() {
    if (!serverConnected) {
        showToast('Cannot load data - server not connected', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/journals`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            journals = data.journals || [];
            todos = data.todos || [];
            goals = data.goals || [];
            folders = data.folders || [];
            
            console.log('✅ Data loaded from server:', {
                journals: journals.length,
                todos: todos.length,
                goals: goals.length,
                folders: folders.length
            });
        } else {
            throw new Error('Failed to load data from server');
        }
    } catch (error) {
        console.error('❌ Failed to load data:', error);
        showToast('Failed to load data from server', 'error');
        
        // Initialize with empty data
        journals = [];
        todos = [];
        goals = [];
        folders = [];
    }
    
    // Initialize with sample data if empty (first time use)
    if (goals.length === 0) {
        goals = [
            { id: 'g1', title: 'Read 12 books this year', type: 'milestone', progress: 25, target: 12, current: 3, startDate: new Date().toISOString() },
            { id: 'g2', title: 'Exercise 3 times per week', type: 'habit', progress: 60, target: 150, current: 90, startDate: new Date().toISOString() },
            { id: 'g3', title: 'Learn Spanish', type: 'project', progress: 15, target: 100, current: 15, startDate: new Date().toISOString() }
        ];
        await saveData();
    }
    
    if (todos.length === 0) {
        const today = new Date();
        todos = [
            { id: 't1', text: 'Review journal entries from last week', completed: false, priority: 'medium', dueDate: today.toISOString() },
            { id: 't2', text: 'Update goal progress', completed: false, priority: 'high', dueDate: today.toISOString() },
            { id: 't3', text: 'Write reflection for the month', completed: false, priority: 'low', dueDate: new Date(today.getTime() + 86400000).toISOString() }
        ];
        await saveData();
    }
    
    navigateToSection('entries');
    updateAllCounts();
    
    // Render mini calendar with loaded data
    renderMiniCalendar();
}

async function saveData() {
    if (!serverConnected) {
        showToast('Cannot save - server not connected', 'error');
        return false;
    }
    
    const data = {
        journals,
        todos,
        goals,
        folders,
        lastUpdated: new Date().toISOString()
    };
    
    try {
        const response = await fetch(`${API_BASE_URL}/journals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`Save failed with status ${response.status}`);
        }
        
        console.log('✅ Data saved to server');
        showToast('Saved successfully');
        
        // Update mini calendar after save
        if (typeof renderMiniCalendar === 'function') {
            renderMiniCalendar();
        }
        
        return true;
    } catch (error) {
        console.error('❌ Failed to save to server:', error);
        showToast('Failed to save to server', 'error');
        return false;
    }
}

// ===================================
// NAVIGATION & SECTION MANAGEMENT
// ===================================

function navigateToSection(sectionName) {
    currentSection = sectionName;
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeNav = document.querySelector(`[data-section="${sectionName}"]`);
    if (activeNav) activeNav.classList.add('active');
    
    // CRITICAL: Clear third column before switching sections
    const detailContent = document.getElementById('detailContent');
    if (detailContent && sectionName !== 'entries') {
        // For non-entry sections, clear the content
        detailContent.innerHTML = '';
    }
    
    // Update UI based on section
    switch(sectionName) {
        case 'entries':
            showEntriesSection();
            break;
        case 'todos':
            showTodosSection();
            break;
        case 'goals':
            showGoalsSection();
            break;
        case 'calendar':
            showCalendarSection();
            break;
        case 'analytics':
            showAnalyticsSection();
            break;
        // case 'ai-reviews':
        //     showAIReviewsSection();
        //     break;
    }
}

function showEntriesSection() {
    console.log('📝 showEntriesSection called');
    currentSection = 'entries';
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeNav = document.querySelector('[data-section="entries"]');
    if (activeNav) activeNav.classList.add('active');
    
    // Show columns properly
    const entriesCol = document.querySelector('.entries-column');
    const detailCol = document.querySelector('.detail-column');
    
    if (entriesCol) entriesCol.style.display = 'block';
    if (detailCol) {
        detailCol.style.gridColumn = '3 / 4';
        detailCol.style.display = 'block';
    }
    
    const titleEl = document.getElementById('entriesColumnTitle');
    const newItemBtn = document.getElementById('newItemBtn');
    
    if (titleEl) titleEl.textContent = 'All Entries';
    if (newItemBtn) newItemBtn.style.display = 'flex';
    
    updateFilterOptions('entries');
    renderEntriesList();
    
    // Always show "Back to All" button
    addBackToAllButton();
    
    // Show latest entry or new form
    if (journals.length > 0) {
        const sorted = [...journals].sort((a, b) => new Date(b.date) - new Date(a.date));
        viewEntry(sorted[0].id || sorted[0].timestamp);
    } else {
        createNewEntry();
    }
}
function addBackToAllButton() {
    // Remove existing button if any
    const existingBtn = document.querySelector('.back-to-all-btn');
    if (existingBtn) existingBtn.remove();
    
    // Add button to entries column header
    const entriesHeader = document.querySelector('.entries-column-header');
    if (entriesHeader && !entriesHeader.querySelector('.back-to-all-btn')) {
        const backBtn = document.createElement('button');
        backBtn.className = 'back-to-all-btn';
        backBtn.innerHTML = '← All Entries';
        backBtn.style.marginRight = '10px';
        backBtn.style.padding = '6px 12px';
        backBtn.style.background = 'var(--bg-secondary)';
        backBtn.style.border = '1px solid var(--border-light)';
        backBtn.style.borderRadius = '4px';
        backBtn.style.cursor = 'pointer';
        
        backBtn.onclick = function() {
            navigateToSection('entries');
        };
        
        entriesHeader.insertBefore(backBtn, entriesHeader.firstChild);
    }
}

// ===================================
// ENTRIES SECTION
// ===================================



async function saveEntry(event) {
    event.preventDefault();
    console.log('💾 Save entry called');
    
    try {
        const title = document.getElementById('entryTitle').value;
        const mood = document.getElementById('entryMood').value;
        const location = document.getElementById('entryLocation')?.value || '';
        const content = quill ? quill.root.innerHTML : '';
        
        if (!title || !mood) {
            showToast('Please fill in title and mood', 'error');
            return;
        }
        
        console.log('Entry data:', { title, mood, hasContent: !!content });
        
        const entry = {
            id: editingEntryId || Date.now().toString(),
            title,
            content,
            mood,
            location,
            tags: currentTags,
            linkedGoals: selectedGoalIds,
            linkedTodos: selectedTodoIds,
            linkedEntries: selectedEntryIds,
            date: new Date().toISOString(),
            featured: false,
            wordCount: content.replace(/<[^>]*>/g, '').split(/\s+/).filter(w => w).length
        };
        
        if (editingEntryId) {
            const index = journals.findIndex(j => 
                j.id === editingEntryId || 
                String(j.id) === String(editingEntryId) ||
                j.timestamp === editingEntryId
            );
            if (index !== -1) {
                journals[index] = entry;
                console.log('✅ Entry updated at index', index);
            }
        } else {
            journals.unshift(entry);
            console.log('✅ New entry added');
        }
        
        // Update linked goals progress and complete linked todos
        updateGoalsFromEntry(entry);
        updateTodosFromEntry(entry);
        
        await saveData();
        renderEntriesList();
        
        // Refresh todos and goals lists if we're in those sections
        if (typeof renderTodosList === 'function') renderTodosList();
        if (typeof renderGoalsList === 'function') renderGoalsList();
        
        viewEntry(entry.id);
        showToast(editingEntryId ? 'Entry updated' : 'Entry saved');
    } catch (error) {
        console.error('❌ Error saving entry:', error);
        showToast('Failed to save entry: ' + error.message, 'error');
    }
}

function viewEntry(entryId) {
    currentEntryId = entryId;
    
    // Try multiple ID matching strategies
    const entry = journals.find(j => 
        j.id === entryId || 
        j.id === String(entryId) || 
        String(j.id) === String(entryId) ||
        j.timestamp === entryId ||
        String(j.timestamp) === String(entryId)
    );
    
    if (!entry) {
        console.error('Entry not found:', entryId);
        console.log('Available journal IDs:', journals.map(j => ({id: j.id, timestamp: j.timestamp, title: j.title})));
        showToast('Entry not found', 'error');
        return;
    }
    
    const formEl = document.getElementById('new-entry-form');
    const viewEl = document.getElementById('entry-view');
    
    if (formEl) formEl.style.display = 'none';
    if (!viewEl) return;
    
    viewEl.style.display = 'block';
    viewEl.innerHTML = `
        <div class="entry-view-header">
            <h1 class="entry-view-title">${entry.title}</h1>
            <div class="entry-view-actions">
                <button class="btn-icon-only" onclick="toggleFullscreen()" title="Fullscreen">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                    </svg>
                </button>
                <button class="btn-icon-only" onclick="toggleFeatured()" id="featuredBtn">
                    <svg viewBox="0 0 24 24" fill="${entry.featured ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                </button>
                <button class="btn-icon-only" onclick="editEntry('${entryId}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-icon-only delete" onclick="deleteEntry('${entryId}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="entry-view-meta">
            <span class="meta-item">Created: ${new Date(entry.date).toLocaleDateString('en-US', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}</span>
            <span class="meta-item">🕐 ${new Date(entry.date).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true})}</span>
            ${entry.lastUpdated && entry.lastUpdated !== entry.date ? `<span class="meta-item">📝 Edited: ${new Date(entry.lastUpdated).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})} ${new Date(entry.lastUpdated).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})}</span>` : ''}
            <span class="meta-item meta-mood">${entry.mood}</span>
            ${entry.location ? `<span class="meta-item">📍 ${entry.location}</span>` : ''}
            <span class="meta-item">${entry.wordCount || 0} words</span>
            ${(() => {
                const validGoals = (entry.linkedGoals || []).filter(gid => goals.find(g => g.id === gid));
                return validGoals.length > 0 ? `<span class="meta-item meta-goal">🎯 ${validGoals.length} ${validGoals.length === 1 ? 'Goal' : 'Goals'}</span>` : '';
            })()}
            ${(() => {
                const validTodos = (entry.linkedTodos || []).filter(tid => todos.find(t => t.id === tid));
                return validTodos.length > 0 ? `<span class="meta-item meta-todo">✓ ${validTodos.length} ${validTodos.length === 1 ? 'Todo' : 'Todos'}</span>` : '';
            })()}
            ${(() => {
                const validLinkedEntries = (entry.linkedEntries || []).filter(eid => journals.find(j => j.id === eid || String(j.id) === String(eid)));
                return validLinkedEntries.length > 0 ? `<span class="meta-item meta-linked-entries" onclick="showLinkedEntriesModal('${entryId}')" style="cursor: pointer; text-decoration: underline;">🔗 ${validLinkedEntries.length} Linked ${validLinkedEntries.length === 1 ? 'Entry' : 'Entries'}</span>` : '';
            })()}
        </div>
        <div class="entry-view-tags">
            ${entry.tags?.map(tag => `<span class="tag">${tag}</span>`).join('') || ''}
        </div>
        <div class="entry-view-content">${entry.content}</div>
        ${entry.linkedGoals && entry.linkedGoals.length > 0 ? `
            <div class="entry-view-linked">
                <h4 style="margin-bottom: var(--space-md); font-size: var(--font-size-sm); color: var(--text-secondary);">Linked Goals</h4>
                ${entry.linkedGoals.map(gid => {
                    const goal = goals.find(g => g.id === gid);
                    return goal ? `
                        <div class="linked-goal-item">
                            <div style="display: flex; justify-content: space-between; margin-bottom: var(--space-xs);">
                                <span style="font-weight: 500;">${goal.title}</span>
                                <span style="font-size: var(--font-size-sm); color: var(--text-secondary);">${goal.current || 0}/${goal.target || 0}</span>
                            </div>
                            <div class="progress-mini">
                                <div class="progress-mini-fill" style="width: ${goal.progress || 0}%"></div>
                            </div>
                        </div>
                    ` : '';
                }).join('')}
            </div>
        ` : ''}
        ${entry.linkedTodos && entry.linkedTodos.length > 0 ? `
            
                <div class="entry-view-linked">
                    <h4 style="margin-bottom: var(--space-md); font-size: var(--font-size-sm); color: var(--text-secondary);">Linked Todos</h4>
                    ${entry.linkedTodos.map(tid => {
                        const todo = todos.find(t => t.id === tid);
                        return todo ? `
                            <div class="linked-goal-item">
                                <div style="display: flex; justify-content: space-between; margin-bottom: var(--space-xs);">
                                    <span style="font-weight: 500; ${todo.completed ? 'text-decoration: line-through; color: var(--text-tertiary);' : ''}">${todo.text}</span>
                                    <span style="font-size: var(--font-size-sm); color: var(--text-secondary);">${todo.completed ? 'Done ✓' : 'Pending'}</span>
                                </div>
                                <div class="progress-mini">
                                    <div class="progress-mini-fill" style="width: ${todo.completed ? 100 : 0}%; background: #38b2ac;"></div>
                                </div>
                            </div>
                        ` : '';
                    }).join('')}
                </div>
            
        ` : ''}
        ${entry.linkedEntries && entry.linkedEntries.length > 0 ? `
            
                <div class="entry-view-linked">
                    <h4 style="margin-bottom: var(--space-md); font-size: var(--font-size-sm); color: var(--text-secondary);">🔗 Linked Entries</h4>
                    ${entry.linkedEntries.map(eid => {
                        const linkedEntry = journals.find(j => j.id === eid || String(j.id) === String(eid));
                        return linkedEntry ? `
                            <div class="linked-entry-card" onclick="showEntryDetail('${linkedEntry.id}')" style="cursor: pointer;">
                                <div class="linked-entry-title">${linkedEntry.title}</div>
                                <div class="linked-entry-meta">
                                    <span>${new Date(linkedEntry.date).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'})}</span>
                                    ${linkedEntry.mood ? `<span>${linkedEntry.mood}</span>` : ''}
                                    <span>${linkedEntry.wordCount || 0} words</span>
                                </div>
                            </div>
                        ` : '';
                    }).join('')}
                </div>
            
        ` : ''}
    `;
    
    renderEntriesList();
}

// Replace the editEntry function with this improved version
function editEntry(entryId) {
    console.log('✏️ Editing entry:', entryId);
    
    editingEntryId = entryId;
    const entry = journals.find(j => 
        j.id === entryId || 
        String(j.id) === String(entryId) ||
        j.timestamp === entryId ||
        String(j.timestamp) === String(entryId)
    );
    
    if (!entry) {
        console.error('Entry not found for editing:', entryId);
        showToast('Entry not found', 'error');
        return;
    }
    
    editingEntryId = entry.id || entry.timestamp;
    
    const formEl = document.getElementById('new-entry-form');
    const viewEl = document.getElementById('entry-view');
    
    if (formEl) formEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    
    // Populate form
    const titleInput = document.getElementById('entryTitle');
    const moodSelect = document.getElementById('entryMood');
    const locationInput = document.getElementById('entryLocation');
    
    if (titleInput) titleInput.value = entry.title || '';
    if (moodSelect) moodSelect.value = entry.mood || '';
    if (locationInput) locationInput.value = entry.location || '';
    
    // Populate tags
    currentTags = entry.tags || [];
    updateTagsDisplay();
    
    // Populate linked items
    selectedGoalIds = entry.linkedGoals || [];
    selectedTodoIds = entry.linkedTodos || [];
    selectedEntryIds = entry.linkedEntries || [];
    
    // Set Quill content
    if (quill) {
        quill.root.innerHTML = entry.content || '';
        // Add fullscreen button to editor
        addEditorFullscreenButton();
    }
    
    // Update all dropdowns
    updateGoalsCheckboxes();
    updateTodosCheckboxes();
    updateLinkedEntriesDisplay();
    
    // CRITICAL: Fix entry linking to use search instead of dropdown
    fixEntryLinkingSearch();
    
    // Scroll to top
    const detailContent = document.querySelector('.detail-content');
    if (detailContent) detailContent.scrollTop = 0;
    
    console.log('✅ Edit mode ready');
}
function searchEntriesToLink(query) {
    if (!query || query.trim().length < 1) {
        document.getElementById('entrySearchResults').style.display = 'none';
        return;
    }
    
    const searchLower = query.toLowerCase().trim();
    const resultsContainer = document.getElementById('entrySearchResults');
    
    // Filter entries (same as filterCurrentSection)
    const results = journals.filter(j => {
        if (editingEntryId && (j.id === editingEntryId || String(j.id) === String(editingEntryId))) {
            return false;
        }
        
        const titleMatch = j.title && j.title.toLowerCase().includes(searchLower);
        const contentText = j.content ? j.content.replace(/<[^>]*>/g, '').toLowerCase() : '';
        const contentMatch = contentText.includes(searchLower);
        const tagsMatch = j.tags && j.tags.some(tag => tag.toLowerCase().includes(searchLower));
        const moodMatch = j.mood && j.mood.toLowerCase().includes(searchLower);
        const locationMatch = j.location && j.location.toLowerCase().includes(searchLower);
        
        return titleMatch || contentMatch || tagsMatch || moodMatch || locationMatch;
    }).slice(0, 10);
    
    if (results.length > 0) {
        resultsContainer.innerHTML = results.map(entry => {
            const isLinked = selectedEntryIds.includes(entry.id);
            const date = new Date(entry.date).toLocaleDateString();
            return `
                <div class="search-result-item ${isLinked ? 'linked' : ''}">
                    <div class="search-result-content" onclick="toggleEntrySelection('${entry.id}')">
                        <div class="search-result-title">${entry.title}</div>
                        <div class="search-result-meta">${date} • ${entry.mood || 'No mood'}</div>
                    </div>
                    <button class="btn-${isLinked ? 'secondary' : 'primary'}" 
                            onclick="toggleEntrySelection('${entry.id}')">
                        ${isLinked ? 'Unlink' : 'Link'}
                    </button>
                </div>
            `;
        }).join('');
        resultsContainer.style.display = 'block';
    } else {
        resultsContainer.innerHTML = '<div class="empty-result">No entries found</div>';
        resultsContainer.style.display = 'block';
    }
}
// Add fullscreen editor functionality
function addEditorFullscreenButton() {
    const editorContainer = document.querySelector('.ql-editor').parentElement;
    if (!editorContainer.querySelector('.fullscreen-toggle')) {
        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.className = 'fullscreen-toggle';
        fullscreenBtn.innerHTML = '⛶';
        fullscreenBtn.title = 'Toggle fullscreen';
        fullscreenBtn.style.position = 'absolute';
        fullscreenBtn.style.top = '10px';
        fullscreenBtn.style.right = '10px';
        fullscreenBtn.style.zIndex = '100';
        fullscreenBtn.style.background = 'var(--bg-primary)';
        fullscreenBtn.style.border = '1px solid var(--border-light)';
        fullscreenBtn.style.borderRadius = '4px';
        fullscreenBtn.style.padding = '5px 10px';
        fullscreenBtn.style.cursor = 'pointer';
        
        fullscreenBtn.onclick = function() {
            editorContainer.classList.toggle('fullscreen');
            if (editorContainer.classList.contains('fullscreen')) {
                editorContainer.style.position = 'fixed';
                editorContainer.style.top = '0';
                editorContainer.style.left = '0';
                editorContainer.style.width = '100vw';
                editorContainer.style.height = '100vh';
                editorContainer.style.zIndex = '9999';
                editorContainer.style.background = 'var(--bg-primary)';
                editorContainer.style.padding = '20px';
                editorContainer.style.overflowY = 'auto';
                fullscreenBtn.innerHTML = '✕';
            } else {
                editorContainer.style.position = '';
                editorContainer.style.top = '';
                editorContainer.style.left = '';
                editorContainer.style.width = '';
                editorContainer.style.height = '';
                editorContainer.style.zIndex = '';
                editorContainer.style.background = '';
                editorContainer.style.padding = '';
                editorContainer.style.overflowY = '';
                fullscreenBtn.innerHTML = '⛶';
            }
        };
        
        editorContainer.style.position = 'relative';
        editorContainer.appendChild(fullscreenBtn);
    }
}

function deleteEntry(entryId) {
    if (!confirm('Delete this entry?')) return;
    
    const index = journals.findIndex(j => 
        j.id === entryId || 
        String(j.id) === String(entryId) ||
        j.timestamp === entryId ||
        String(j.timestamp) === String(entryId)
    );
    
    if (index !== -1) {
        journals.splice(index, 1);
        saveData();
        renderEntriesList();
        if (journals.length > 0) {
            viewEntry(journals[0].id || journals[0].timestamp);
        } else {
            createNewEntry();
        }
        showToast('Entry deleted');
    }
}

function toggleFeatured() {
    if (!currentEntryId) return;
    const entry = journals.find(j => 
        j.id === currentEntryId || 
        String(j.id) === String(currentEntryId) ||
        j.timestamp === currentEntryId ||
        String(j.timestamp) === String(currentEntryId)
    );
    if (entry) {
        entry.featured = !entry.featured;
        saveData();
        viewEntry(currentEntryId);
    }
}
function toggleEntrySelection(entryId) {
    if (selectedEntryIds.includes(entryId)) {
        selectedEntryIds = selectedEntryIds.filter(id => id !== entryId);
    } else {
        selectedEntryIds.push(entryId);
    }
    updateLinkedEntriesDisplay();
    searchEntriesToLink(document.getElementById('entryLinkSearchInput')?.value || '');
}
// Tags
function handleTagInput(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const tag = event.target.value.trim();
        if (tag && !currentTags.includes(tag)) {
            currentTags.push(tag);
            renderTags();
            event.target.value = '';
        }
    }
}

function renderTags() {
    // Try new inline layout first
    let container = document.getElementById('tagsDisplayInline');
    if (!container) {
        // Fallback to old layout
        container = document.getElementById('tagsInput');
    }
    
    if (!container) return;
    
    if (container.id === 'tagsDisplayInline') {
        // New inline layout
        container.innerHTML = currentTags.map(tag => 
            `<span class="tag">${tag}<button class="tag-remove" onclick="removeTag('${tag}')">×</button></span>`
        ).join('');
    } else {
        // Old layout with input preservation
        const input = container.querySelector('.tag-input');
        container.innerHTML = currentTags.map(tag => 
            `<span class="tag">${tag}<button class="tag-remove" onclick="removeTag('${tag}')">×</button></span>`
        ).join('');
        if (input) container.appendChild(input);
    }
}

function removeTag(tag) {
    currentTags = currentTags.filter(t => t !== tag);
    renderTags();
}

// Continue in next message due to length...

// ===================================
// TODOS SECTION
// ===================================

function showTodosSection() {
    const titleEl = document.getElementById('entriesColumnTitle');
    const btnTextEl = document.getElementById('newItemBtnText');
    const newItemBtn = document.getElementById('newItemBtn');
    
    if (titleEl) titleEl.textContent = 'To-Dos';
    if (btnTextEl) btnTextEl.textContent = 'New Todo';
    if (newItemBtn) newItemBtn.style.display = 'flex';
    
    // Hide second column for todos (Fix #1)
    const entriesCol = document.querySelector('.entries-column');
    const detailCol = document.querySelector('.detail-column');
    if (entriesCol) entriesCol.style.display = 'none';
    if (detailCol) detailCol.style.gridColumn = '2 / 4'; // Span both columns
    
    updateFilterOptions('todos');
    renderTodosList();
    showTodosDetail();
    addBackToAllButton();
}

function renderTodosList() {
    const container = document.getElementById('entriesList');
    const statusFilter = document.getElementById('filterSelect')?.value || 'active';
    
    let filtered = todos;
    if (statusFilter === 'active') filtered = todos.filter(t => !t.completed);
    else if (statusFilter === 'completed') filtered = todos.filter(t => t.completed);
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No todos</p></div>';
        return;
    }
    
    container.innerHTML = filtered.map(todo => `
        <div class="entry-card" onclick="viewTodo('${todo.id}')">
            <div class="entry-card-title">${todo.text}</div>
            <div class="entry-card-meta">
                <span class="meta-badge todo-priority ${todo.priority}">${todo.priority}</span>
                ${todo.dueDate ? `<span class="meta-badge">${new Date(todo.dueDate).toLocaleDateString()}</span>` : ''}
                ${todo.completed ? '<span class="meta-badge">✓ Completed</span>' : ''}
            </div>
        </div>
    `).join('');
    
    updateTodosStats();
}

function showTodosDetail() {
    const detailContent = document.getElementById('detailContent');
    detailContent.innerHTML = `
        <div class="todos-stats">
            <div class="stat-card">
                <div class="stat-value" id="todosActiveCount">0</div>
                <div class="stat-label">Active</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="todosCompletedToday">0</div>
                <div class="stat-label">Completed Today</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="todosOverdue">0</div>
                <div class="stat-label">Overdue</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="todosCompletionRate">0%</div>
                <div class="stat-label">Completion Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="todosTotalCompleted">0</div>
                <div class="stat-label">Total Completed</div>
            </div>
        </div>
        
        <!-- Rest of your existing code -->
        
        <div class="completed-todos-section" style="margin-top: var(--space-xl);">
            <h3>Completed Todos</h3>
            <div class="completed-todos-list" id="completedTodosList"></div>
        </div>
    `;
    
    renderTodosDetailList();
    updateTodosStats();
    renderCompletedTodosList(); // Add this line
}

function renderTodosDetailList() {
    const container = document.getElementById('todosList');
    if (!container) return;
    
    const activeTodos = todos.filter(t => !t.completed);
    
    container.innerHTML = activeTodos.map(todo => {
        const isOverdue = todo.dueDate && new Date(todo.dueDate) < new Date();
        return `
            <div class="todo-item ${todo.completed ? 'completed' : ''}">
                <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''} 
                       onchange="toggleTodo('${todo.id}')">
                <div class="todo-text">${todo.text}</div>
                <span class="todo-priority ${todo.priority}">${todo.priority}</span>
                ${todo.dueDate ? `<span class="todo-due-date ${isOverdue ? 'overdue' : ''}">${new Date(todo.dueDate).toLocaleDateString()}</span>` : ''}
                <button class="btn-icon-only delete" onclick="deleteTodo('${todo.id}')">×</button>
            </div>
        `;
    }).join('');
}

function handleTodoEnter(event) {
    if (event.key === 'Enter') {
        addTodo();
    }
}

function addTodo() {
    const input = document.getElementById('newTodoInput');
    const priority = document.getElementById('newTodoPriority').value;
    const dueDate = document.getElementById('newTodoDueDate').value;
    
    if (!input.value.trim()) return;
    
    const todo = {
        id: Date.now().toString(),
        text: input.value,
        completed: false,
        priority,
        dueDate: dueDate || null,
        createdAt: new Date().toISOString()
    };
    
    todos.unshift(todo);
    saveData();
    renderTodosList();
    renderTodosDetailList();
    updateTodosStats();
    
    input.value = '';
    showToast('Todo added');
}

function toggleTodo(todoId) {
    const todo = todos.find(t => t.id === todoId);

    if (todo) {
        todo.completed = !todo.completed;
        todo.completedAt = todo.completed ? new Date().toISOString() : null;

        // 🔁 SYNC into linked journal entries
        journals.forEach(entry => {
            if (entry.linkedTodos && entry.linkedTodos.length) {
                entry.linkedTodos.forEach(lt => {
                    if (lt.id === todoId) {
                        lt.completed = todo.completed;
                        lt.completedAt = todo.completedAt;
                    }
                });
            }
        });

        saveData();

        renderTodosDetailList();
        updateTodosStats();

        // refresh entry view if open
        if (currentEntryId) {
            showEntryDetail(currentEntryId);
        }
    }
}


function deleteTodo(todoId) {
    const index = todos.findIndex(t => t.id === todoId);
    if (index !== -1) {
        todos.splice(index, 1);
        saveData();
        renderTodosDetailList();
        updateTodosStats();
        showToast('Todo deleted');
    }
}

function editTodo(todoId) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    
    const newText = prompt('Edit todo:', todo.text);
    if (newText && newText.trim() && newText !== todo.text) {
        todo.text = newText.trim();
        saveData();
        renderTodosDetailList();
        showToast('Todo updated');
        
        // Update in linked entries
        journals.forEach(entry => {
            if (entry.linkedTodos && entry.linkedTodos.length) {
                entry.linkedTodos.forEach(lt => {
                    if (lt.id === todoId) {
                        lt.text = todo.text;
                    }
                });
            }
        });
    }
}

function updateTodosStats() {
    const active = todos.filter(t => !t.completed).length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const completedToday = todos.filter(t => t.completed && new Date(t.completedAt) >= today).length;
    const overdue = todos.filter(t => !t.completed && t.dueDate && new Date(t.dueDate) < new Date()).length;
    const completionRate = todos.length > 0 ? Math.round((todos.filter(t => t.completed).length / todos.length) * 100) : 0;
    const totalCompleted = todos.filter(t => t.completed).length;
    
    if (document.getElementById('todosActiveCount')) document.getElementById('todosActiveCount').textContent = active;
    if (document.getElementById('todosCompletedToday')) document.getElementById('todosCompletedToday').textContent = completedToday;
    if (document.getElementById('todosOverdue')) document.getElementById('todosOverdue').textContent = overdue;
    if (document.getElementById('todosCompletionRate')) document.getElementById('todosCompletionRate').textContent = `${completionRate}%`;
    if (document.getElementById('todosTotalCompleted')) document.getElementById('todosTotalCompleted').textContent = totalCompleted;
}

// Pomodoro Timer
function startPomodoro() {
    if (pomodoroRunning) return;
    pomodoroRunning = true;
    
    pomodoroInterval = setInterval(() => {
        pomodoroSeconds--;
        updatePomodoroDisplay();
        
        if (pomodoroSeconds <= 0) {
            pausePomodoro();
            showToast('Pomodoro session complete!');
            new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZQQ0PVqzn77BdGAg+ltryxnMpBSh+zPLaizsIGGS57OihUhELTKXh8bllHAU2kNXzxnUsA=='); // beep sound
        }
    }, 1000);
}

function pausePomodoro() {
    pomodoroRunning = false;
    clearInterval(pomodoroInterval);
}

function resetPomodoro() {
    pausePomodoro();
    const focusDuration = parseInt(document.getElementById('focusDuration').value) || 25;
    pomodoroSeconds = focusDuration * 60;
    updatePomodoroDisplay();
}

function updatePomodoroDisplay() {
    const minutes = Math.floor(pomodoroSeconds / 60);
    const seconds = pomodoroSeconds % 60;
    const display = document.getElementById('pomodoroDisplay');
    if (display) {
        display.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// ===================================
// GOALS SECTION
// ===================================

function showGoalsSection() {
    const titleEl = document.getElementById('entriesColumnTitle');
    const btnTextEl = document.getElementById('newItemBtnText');
    const newItemBtn = document.getElementById('newItemBtn');
    
    if (titleEl) titleEl.textContent = 'Goals';
    if (btnTextEl) btnTextEl.textContent = 'New Goal';
    if (newItemBtn) newItemBtn.style.display = 'flex';
    
    // Hide second column for goals (Fix #1)
    const entriesCol = document.querySelector('.entries-column');
    const detailCol = document.querySelector('.detail-column');
    if (entriesCol) entriesCol.style.display = 'none';
    if (detailCol) detailCol.style.gridColumn = '2 / 4'; // Span both columns
    
    updateFilterOptions('goals');
    renderGoalsList();
    showGoalsDetail();
    addBackToAllButton();
}

function renderGoalsList() {
    const container = document.getElementById('entriesList');
    const statusFilter = document.getElementById('filterSelect')?.value || 'active';
    
    let filtered = goals;
    if (statusFilter === 'active') filtered = goals.filter(g => g.progress < 100);
    else if (statusFilter === 'completed') filtered = goals.filter(g => g.progress >= 100);
    
    container.innerHTML = filtered.map(goal => `
        <div class="entry-card" onclick="viewGoal('${goal.id}')">
            <div class="entry-card-title">${goal.title}</div>
            <div class="entry-card-preview">
                <div class="progress-mini">
                    <div class="progress-mini-fill" style="width: ${goal.progress}%"></div>
                </div>
            </div>
            <div class="entry-card-meta">
                <span class="meta-badge">${goal.type}</span>
                <span class="meta-badge">${goal.progress}%</span>
            </div>
        </div>
    `).join('');
    
    updateGoalsStats();
}

function showGoalsDetail() {
    const detailContent = document.getElementById('detailContent');
    detailContent.innerHTML = `
        <div class="goals-stats">
            <div class="stat-card">
                <div class="stat-value" id="goalsActiveCount">0</div>
                <div class="stat-label">Active Goals</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="goalsCompleted">0</div>
                <div class="stat-label">Completed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="goalsAvgProgress">0%</div>
                <div class="stat-label">Avg Progress</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="goalsOnTrack">0</div>
                <div class="stat-label">On Track</div>
            </div>
        </div>
        
        <button class="btn-primary" onclick="showCreateGoalModal()" style="margin-bottom: var(--space-lg); width: 100%;">
            Create New Goal
        </button>
        
        <div class="goals-list" id="goalsDetailList"></div>
    `;
    
    renderGoalsDetailList();
    updateGoalsStats();
}

function renderGoalsDetailList() {
    const container = document.getElementById('goalsDetailList');
    if (!container) return;
    
    container.innerHTML = '<div class="goals-horizontal-grid">' + goals.map(goal => `
        <div class="goal-card goal-card-compact">
            <div class="goal-card-header">
                <div>
                    <div class="goal-title">${goal.title}</div>
                    <span class="goal-type">${goal.type}</span>
                </div>
            </div>
            ${goal.description ? `<div class="goal-description">${goal.description}</div>` : ''}
            <div class="goal-progress-section">
                <div class="goal-progress-header">
                    <span>${goal.current || 0} / ${goal.target || 100}</span>
                    <span>${goal.progress || 0}%</span>
                </div>
                <div class="goal-progress-bar">
                    <div class="goal-progress-fill" style="width: ${goal.progress || 0}%"></div>
                </div>
            </div>
            <div class="goal-meta">
                ${goal.startDate ? `<span>Started: ${new Date(goal.startDate).toLocaleDateString()}</span>` : ''}
                ${goal.targetDate ? `<span>Target: ${new Date(goal.targetDate).toLocaleDateString()}</span>` : ''}
            </div>
            <div class="goal-actions">
                <button class="btn-secondary" onclick="updateGoalProgress('${goal.id}')">Update Progress</button>
                <button class="btn-secondary" onclick="editGoal('${goal.id}')">Edit</button>
                <button class="btn-secondary delete" onclick="deleteGoal('${goal.id}')">Delete</button>
            </div>
        </div>
    `).join('') + '</div>';
}

// function showCreateGoalModal() {
//     editingGoalId = null;
//     document.getElementById('goalModalTitle').textContent = 'Create New Goal';
//     document.getElementById('goalTitle').value = '';
//     document.getElementById('goalType').value = 'habit';
//     document.getElementById('goalDescription').value = '';
//     document.getElementById('goalTarget').value = 100;
//     document.getElementById('goalCurrent').value = 0;
//     document.getElementById('goalStartDate').value = new Date().toISOString().split('T')[0];
//     document.getElementById('goalTargetDate').value = '';
//     document.getElementById('goalModal').style.display = 'flex';
// }

function closeGoalModal() {
    document.getElementById('goalModal').style.display = 'none';
}

function saveGoal() {
    const title = document.getElementById('goalTitle').value;
    if (!title) return;
    
    const goal = {
        id: editingGoalId || Date.now().toString(),
        title,
        type: document.getElementById('goalType').value,
        description: document.getElementById('goalDescription').value,
        target: parseInt(document.getElementById('goalTarget').value),
        current: parseInt(document.getElementById('goalCurrent').value),
        progress: 0,
        startDate: document.getElementById('goalStartDate').value,
        targetDate: document.getElementById('goalTargetDate').value,
        createdAt: new Date().toISOString()
    };
    
    goal.progress = goal.target > 0 ? Math.round((goal.current / goal.target) * 100) : 0;
    
    if (editingGoalId) {
        const index = goals.findIndex(g => g.id === editingGoalId);
        if (index !== -1) goals[index] = goal;
    } else {
        goals.push(goal);
    }
    
    saveData();
    closeGoalModal();
    renderGoalsList();
    renderGoalsDetailList();
    updateGoalsStats();
    // Toast removed for cleaner UX
}

function updateGoalProgress(goalId) {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    
    const newCurrent = prompt(`Current progress for "${goal.title}" (Target: ${goal.target}):`, goal.current);
    if (newCurrent !== null) {
        goal.current = parseInt(newCurrent);
        goal.progress = goal.target > 0 ? Math.round((goal.current / goal.target) * 100) : 0;
        saveData();
        renderGoalsDetailList();
        updateGoalsStats();
        showToast('Progress updated');
    }
}

function editGoal(goalId) {
    editingGoalId = goalId;
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    
    document.getElementById('goalModalTitle').textContent = 'Edit Goal';
    document.getElementById('goalTitle').value = goal.title;
    document.getElementById('goalType').value = goal.type;
    document.getElementById('goalDescription').value = goal.description || '';
    document.getElementById('goalTarget').value = goal.target;
    document.getElementById('goalCurrent').value = goal.current;
    document.getElementById('goalStartDate').value = goal.startDate || '';
    document.getElementById('goalTargetDate').value = goal.targetDate || '';
    document.getElementById('goalModal').style.display = 'flex';
}

function deleteGoal(goalId) {
    if (!confirm('Delete this goal?')) return;
    
    const index = goals.findIndex(g => g.id === goalId);
    if (index !== -1) {
        goals.splice(index, 1);
        saveData();
        renderGoalsList();
        renderGoalsDetailList();
        updateGoalsStats();
        // Toast removed for cleaner UX
    }
}

function updateGoalsStats() {
    const active = goals.filter(g => g.progress < 100).length;
    const completed = goals.filter(g => g.progress >= 100).length;
    const avgProgress = goals.length > 0 ? Math.round(goals.reduce((sum, g) => sum + g.progress, 0) / goals.length) : 0;
    const onTrack = goals.filter(g => g.progress >= 50 && g.progress < 100).length;
    
    if (document.getElementById('goalsActiveCount')) document.getElementById('goalsActiveCount').textContent = active;
    if (document.getElementById('goalsCompleted')) document.getElementById('goalsCompleted').textContent = completed;
    if (document.getElementById('goalsAvgProgress')) document.getElementById('goalsAvgProgress').textContent = `${avgProgress}%`;
    if (document.getElementById('goalsOnTrack')) document.getElementById('goalsOnTrack').textContent = onTrack;
}

function updateGoalsFromEntry(entry) {
    if (!entry.linkedGoals || entry.linkedGoals.length === 0) return;
    
    // Auto-increment goal progress based on entry
    entry.linkedGoals.forEach(goalId => {
        const goal = goals.find(g => g.id === goalId);
        if (goal) {
            if (goal.type === 'habit') {
                goal.current = (goal.current || 0) + 1;
                goal.progress = goal.target > 0 ? Math.round((goal.current / goal.target) * 100) : 0;
            } else {
                // For non-habit goals, increment by 5%
                goal.progress = Math.min((goal.progress || 0) + 5, 100);
            }
            console.log(`📈 Updated goal "${goal.title}" progress: ${goal.progress}%`);
        }
    });
}

function updateTodosFromEntry(entry) {
    if (!entry.linkedTodos || entry.linkedTodos.length === 0) return;
    
    // Mark linked todos as completed
    entry.linkedTodos.forEach(todoId => {
        const todo = todos.find(t => t.id === todoId);
        if (todo && !todo.completed) {
            todo.completed = true;
            console.log(`✅ Completed todo: "${todo.text}"`);
        }
    });
}

function loadGoalsLinking() {
    const container = document.getElementById('goalsLinkingList');
    if (!container) return;
    
    if (goals.length === 0) {
        container.innerHTML = '<p class="empty-message">No goals yet</p>';
        return;
    }
    
    // Clear and rebuild with proper event listeners
    container.innerHTML = goals.map(goal => {
        const isChecked = selectedGoalIds.includes(goal.id);
        return `
            <label class="checkbox-item">
                <input type="checkbox" 
                       value="${goal.id}"
                       ${isChecked ? 'checked' : ''}
                       onchange="handleGoalCheckboxChange('${goal.id}', this.checked)">
                <span>${goal.title} (${goal.progress}%)</span>
            </label>
        `;
    }).join('');
    
    loadTodosLinking();
}

function handleGoalCheckboxChange(goalId, isChecked) {
    if (isChecked && !selectedGoalIds.includes(goalId)) {
        selectedGoalIds.push(goalId);
    } else if (!isChecked) {
        selectedGoalIds = selectedGoalIds.filter(id => id !== goalId);
    }
}

function toggleGoalLink(goalId) {
    if (selectedGoalIds.includes(goalId)) {
        selectedGoalIds = selectedGoalIds.filter(id => id !== goalId);
    } else {
        selectedGoalIds.push(goalId);
    }
}

function toggleGoalsLinking() {
    const section = document.getElementById('goalsLinkingSection');
    if (section) section.classList.toggle('collapsed');
}

function toggleTodosLinking() {
    const section = document.getElementById('todosLinkingSection');
    if (section) section.classList.toggle('collapsed');
}

// Continue with Calendar, Analytics, and AI sections in next part...

// ===================================
// CALENDAR SECTION
// ===================================

let calendarCurrentMonth = new Date().getMonth();
let calendarCurrentYear = new Date().getFullYear();

function showCalendarSection() {
    document.getElementById('entriesColumnTitle').textContent = 'Calendar';
    document.getElementById('newItemBtn').style.display = 'none';
    renderCalendar();
    addBackToAllButton();
    showCalendarDetail();
}
function renderCompletedTodosList() {
    const container = document.getElementById('completedTodosList');
    if (!container) return;
    
    const completedTodos = todos.filter(t => t.completed);
    
    if (completedTodos.length === 0) {
        container.innerHTML = '<p class="empty-message">No completed todos yet.</p>';
        return;
    }
    
    container.innerHTML = completedTodos.map(todo => `
        <div class="todo-item completed">
            <div class="todo-text">${todo.text}</div>
            <span class="todo-priority ${todo.priority}">${todo.priority}</span>
            ${todo.completedAt ? `<span class="todo-completed-date">Completed: ${new Date(todo.completedAt).toLocaleDateString()}</span>` : ''}
        </div>
    `).join('');
}
function renderCalendar() {
    const container = document.getElementById('entriesList');
    const daysInMonth = new Date(calendarCurrentYear, calendarCurrentMonth + 1, 0).getDate();
    const firstDay = new Date(calendarCurrentYear, calendarCurrentMonth, 1).getDay();
    
    let calendarHTML = `
        <div style="padding: var(--space-md);">
            <div style="display: flex; justify-content: space-between; margin-bottom: var(--space-md);">
                <button class="btn-secondary" onclick="previousMonth()">←</button>
                <h3>${new Date(calendarCurrentYear, calendarCurrentMonth).toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}</h3>
                <button class="btn-secondary" onclick="nextMonth()">→</button>
            </div>
            <div class="calendar-weekdays" style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-weight: bold; margin-bottom: var(--space-sm);">
                <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">
    `;
    
    for (let i = 0; i < firstDay; i++) {
        calendarHTML += '<div style="min-height: 40px; background: var(--bg-tertiary);"></div>';
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(calendarCurrentYear, calendarCurrentMonth, day);
        const dateStr = date.toISOString().split('T')[0];
        const hasEntries = journals.some(j => j.date.startsWith(dateStr));
        const hasTodos = todos.some(t => t.dueDate && t.dueDate.startsWith(dateStr));
        const isToday = new Date().toDateString() === date.toDateString();
        
        calendarHTML += `
            <div onclick="viewCalendarDate('${dateStr}')" style="min-height: 40px; padding: 4px; background: ${isToday ? 'var(--accent-light)' : 'var(--bg-secondary)'}; cursor: pointer; border: 1px solid var(--border-light); position: relative;">
                <div style="font-weight: ${isToday ? 'bold' : 'normal'};">${day}</div>
                <div style="display: flex; gap: 2px; margin-top: 2px;">
                    ${hasEntries ? '<div style="width: 6px; height: 6px; background: var(--accent-primary); border-radius: 50%;"></div>' : ''}
                    ${hasTodos ? '<div style="width: 6px; height: 6px; background: var(--warning); border-radius: 50%;"></div>' : ''}
                </div>
            </div>
        `;
    }
    
    calendarHTML += '</div></div>';
    container.innerHTML = calendarHTML;
}

function showCalendarDetail() {
    const detailContent = document.getElementById('detailContent');
    detailContent.innerHTML = `
        <div class="calendar-header">
            <button class="btn-calendar" onclick="previousMonth()">←</button>
            <h2 id="calendarMonthYear">${new Date(calendarCurrentYear, calendarCurrentMonth).toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}</h2>
            <button class="btn-calendar" onclick="nextMonth()">→</button>
            <button class="btn-calendar" onclick="goToToday()">Today</button>
            <select class="view-select" id="calendarViewType" onchange="changeCalendarView()">
                <option value="month">Month</option>
                <option value="heatmap">Heat Map</option>
            </select>
        </div>
        
        <div id="calendarViewContainer">
            <div class="calendar-legend" style="display: flex; gap: var(--space-lg); margin-bottom: var(--space-md);">
                <div class="legend-item"><span class="legend-dot entry-dot"></span> Entries</div>
                <div class="legend-item"><span class="legend-dot todo-dot"></span> Todos</div>
                <div class="legend-item"><span class="legend-dot today-dot"></span> Today</div>
            </div>
            <div id="monthView"></div>
            <div id="heatmapView" style="display: none;"></div>
        </div>
        
        <div id="dateDetails" style="display: none; margin-top: var(--space-lg); padding: var(--space-lg); background: var(--bg-tertiary); border-radius: 8px;">
            <h3 id="selectedDateTitle"></h3>
            <div id="dateDetailsContent"></div>
        </div>
    `;
    
    renderMonthView();
}

function renderMonthView() {
    const container = document.getElementById('monthView');
    if (!container) return;
    
    const daysInMonth = new Date(calendarCurrentYear, calendarCurrentMonth + 1, 0).getDate();
    const firstDay = new Date(calendarCurrentYear, calendarCurrentMonth, 1).getDay();
    
    let html = '<div class="calendar-weekdays"><div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div></div>';
    html += '<div class="calendar-grid">';
    
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="calendar-day other-month"></div>';
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(calendarCurrentYear, calendarCurrentMonth, day);
        const dateStr = date.toISOString().split('T')[0];
        const hasEntries = journals.some(j => j.date.startsWith(dateStr));
        const hasTodos = todos.some(t => t.dueDate && t.dueDate.startsWith(dateStr));
        const isToday = new Date().toDateString() === date.toDateString();
        
        html += `
            <div class="calendar-day ${isToday ? 'today' : ''} ${hasEntries ? 'has-entries' : ''}" onclick="viewCalendarDate('${dateStr}')">
                <div class="day-number">${day}</div>
                <div class="day-indicators">
                    ${hasEntries ? '<div class="entry-dot"></div>' : ''}
                    ${hasTodos ? '<div class="todo-dot"></div>' : ''}
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    container.innerHTML = html;
}

function viewCalendarDate(dateStr) {
    selectedDate = dateStr;
    const date = new Date(dateStr);
    const entries = journals.filter(j => j.date.startsWith(dateStr));
    const dateTodos = todos.filter(t => t.dueDate && t.dueDate.startsWith(dateStr));
    
    const detailsEl = document.getElementById('dateDetails');
    const titleEl = document.getElementById('selectedDateTitle');
    const contentEl = document.getElementById('dateDetailsContent');
    
    if (detailsEl && titleEl && contentEl) {
        detailsEl.style.display = 'block';
        titleEl.textContent = date.toLocaleDateString('en-US', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'});
        
        let html = '';
        
        if (entries.length > 0) {
            html += '<h4>Entries</h4>';
            entries.forEach(entry => {
                html += `<div class="entry-card" onclick="navigateToSection('entries'); viewEntry('${entry.id}');">${entry.title}</div>`;
            });
        }
        
        if (dateTodos.length > 0) {
            html += '<h4>Todos</h4>';
            dateTodos.forEach(todo => {
                html += `<div class="todo-item"><input type="checkbox" ${todo.completed ? 'checked' : ''} onchange="toggleTodo('${todo.id}')"> ${todo.text}</div>`;
            });
        }
        
        if (entries.length === 0 && dateTodos.length === 0) {
            html = '<p>No entries or todos for this date.</p>';
        }
        
        html += `
            <div style="margin-top: var(--space-md); display: flex; gap: var(--space-sm);">
                <button class="btn-primary" onclick="createEntryForDate('${dateStr}')">New Entry</button>
                <button class="btn-secondary" onclick="createTodoForDate('${dateStr}')">New Todo</button>
            </div>
        `;
        
        contentEl.innerHTML = html;
    }
}

function createEntryForDate(dateStr) {
    navigateToSection('entries');
    showNewEntryForm();
}

function createTodoForDate(dateStr) {
    navigateToSection('todos');
    document.getElementById('newTodoDueDate').value = dateStr;
}

function changeCalendarView() {
    const viewType = document.getElementById('calendarViewType').value;
    if (viewType === 'heatmap') {
        document.getElementById('monthView').style.display = 'none';
        document.getElementById('heatmapView').style.display = 'block';
        renderHeatmap();
    } else {
        document.getElementById('monthView').style.display = 'block';
        document.getElementById('heatmapView').style.display = 'none';
    }
}

function renderHeatmap() {
    const container = document.getElementById('heatmapView');
    if (!container) return;
    
    // Create a year-long heatmap
    const today = new Date();
    const startDate = new Date(today.getFullYear(), 0, 1);
    const days = Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1;
    
    let html = '<div class="heatmap-grid" style="display: grid; grid-template-columns: repeat(53, 1fr); gap: 3px;">';
    
    for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        const entryCount = journals.filter(j => j.date.startsWith(dateStr)).length;
        const level = Math.min(4, entryCount);
        
        html += `<div class="heatmap-cell" data-level="${level}" title="${dateStr}: ${entryCount} entries" style="aspect-ratio: 1; border-radius: 2px; background: ${getHeatmapColor(level)};"></div>`;
    }
    
    html += '</div>';
    container.innerHTML = html;
}

function getHeatmapColor(level) {
    const colors = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
    return colors[level] || colors[0];
}

function previousMonth() {
    if (calendarCurrentMonth === 0) {
        calendarCurrentMonth = 11;
        calendarCurrentYear--;
    } else {
        calendarCurrentMonth--;
    }
    renderCalendar();
    renderMonthView();
    document.getElementById('calendarMonthYear').textContent = new Date(calendarCurrentYear, calendarCurrentMonth).toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
}

function nextMonth() {
    if (calendarCurrentMonth === 11) {
        calendarCurrentMonth = 0;
        calendarCurrentYear++;
    } else {
        calendarCurrentMonth++;
    }
    renderCalendar();
    renderMonthView();
    document.getElementById('calendarMonthYear').textContent = new Date(calendarCurrentYear, calendarCurrentMonth).toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
}

function goToToday() {
    calendarCurrentMonth = new Date().getMonth();
    calendarCurrentYear = new Date().getFullYear();
    renderCalendar();
    renderMonthView();
    document.getElementById('calendarMonthYear').textContent = new Date(calendarCurrentYear, calendarCurrentMonth).toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
}

// ===================================
// ANALYTICS SECTION
// ===================================

function showAnalyticsSection() {
    document.getElementById('entriesColumnTitle').textContent = 'Analytics';
    document.getElementById('newItemBtn').style.display = 'none';
    
    // Hide second column for analytics (Fix #1)
    const entriesCol = document.querySelector('.entries-column');
    const detailCol = document.querySelector('.detail-column');
    if (entriesCol) entriesCol.style.display = 'none';
    if (detailCol) detailCol.style.gridColumn = '2 / 4'; // Span both columns
    addBackToAllButton();
    showAnalyticsDetail();
}

function showAnalyticsDetail() {
    const detailContent = document.getElementById('detailContent');
    detailContent.innerHTML = `
        <div class="analytics-header">
            <h2>Analytics & Insights</h2>
            <div class="date-range-selector">
                <select id="analyticsTimeRange" onchange="updateAnalytics()">
                    <option value="week">This Week</option>
                    <option value="month" selected>This Month</option>
                    <option value="quarter">This Quarter</option>
                    <option value="year">This Year</option>
                    <option value="all">All Time</option>
                </select>
                <button class="btn-secondary" onclick="exportAnalytics()">Export Report</button>
            </div>
        </div>
        
        <!-- Writing Analytics -->
        <div class="analytics-section">
            <h3>Writing Analytics</h3>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value" id="totalEntries">0</div><div class="stat-label">Total Entries</div></div>
                <div class="stat-card"><div class="stat-value" id="totalWords">0</div><div class="stat-label">Total Words</div></div>
                <div class="stat-card"><div class="stat-value" id="avgWordsPerEntry">0</div><div class="stat-label">Avg Words/Entry</div></div>
                <div class="stat-card"><div class="stat-value" id="longestStreak">0</div><div class="stat-label">Longest Streak</div></div>
            </div>
            <div class="charts-row">
                <div class="chart-container"><h4>Writing Frequency by Day of Week</h4><canvas id="writingFrequencyChart"></canvas></div>
            </div>
        </div>
        
        <!-- Mood Analytics -->
        <div class="analytics-section">
            <h3>Mood Analytics</h3>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value" id="avgMoodRating">0</div><div class="stat-label">Avg Mood Rating</div></div>
            </div>
            <div class="charts-row">
                <div class="chart-container"><h4>Mood Trend Over Time</h4><canvas id="moodTrendChart"></canvas></div>
                <div class="chart-container"><h4>Mood Distribution</h4><canvas id="moodDistributionChart"></canvas></div>
            </div>
            <div class="charts-row">
                <div class="chart-container"><h4>Mood Frequency by Day of Week</h4><canvas id="moodByDayChart"></canvas></div>
                <div class="chart-container"><h4>Mood by Location</h4><canvas id="moodByLocationChart"></canvas></div>
            </div>
            <div class="charts-row">
                <div class="chart-container"><h4>Mood by Month</h4><canvas id="moodByMonthChart"></canvas></div>
            </div>
        </div>
        
        <!-- Content Analytics -->
        <div class="analytics-section">
            <h3>Content Analytics</h3>
            <div class="charts-row">
                <div class="chart-container" style="max-width: 100%;"><h4>Most Meaningful Words</h4><div id="topWords" class="word-cloud"></div></div>
            </div>
        </div>
        
        <!-- Pattern Detection -->
        <div class="analytics-section">
            <h3>Detected Patterns</h3>
            <div id="patternInsights" class="insights-list"></div>
        </div>
    `;
    
    updateAnalytics();
}

function updateAnalytics() {
    const timeRange = document.getElementById('analyticsTimeRange')?.value || 'month';
    const filtered = filterByTimeRange(journals, timeRange);
    
    console.log('📊 Analytics update:', {
        totalJournals: journals.length,
        filteredEntries: filtered.length,
        timeRange: timeRange
    });
    
    // Debug: Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
        console.error('❌ Chart.js is not loaded!');
        return;
    } else {
        console.log('✅ Chart.js is loaded, version:', Chart.version);
    }
    
    // Debug: Check canvas elements
    const canvases = [
        'writingFrequencyChart',
        'moodTrendChart', 
        'moodDistributionChart',
        'moodByDayChart',
        'moodByLocationChart',
        'moodByMonthChart'
    ];
    
    canvases.forEach(id => {
        const el = document.getElementById(id);
        if (!el) {
            console.warn(`⚠️ Canvas not found: ${id}`);
        } else {
            console.log(`✅ Canvas found: ${id}`);
        }
    });
    
    // Writing stats
    const totalEntriesEl = document.getElementById('totalEntries');
    const totalWordsEl = document.getElementById('totalWords');
    const avgWordsEl = document.getElementById('avgWordsPerEntry');
    const streakEl = document.getElementById('longestStreak');
    
    if (totalEntriesEl) totalEntriesEl.textContent = filtered.length;
    
    // Calculate word count from content if wordCount field doesn't exist
    const totalWords = filtered.reduce((sum, e) => {
        if (e.wordCount) {
            return sum + e.wordCount;
        } else if (e.content) {
            // Calculate from content
            const text = e.content.replace(/<[^>]*>/g, '').trim();
            const words = text.split(/\s+/).filter(w => w.length > 0);
            return sum + words.length;
        }
        return sum;
    }, 0);
    
    if (totalWordsEl) totalWordsEl.textContent = totalWords.toLocaleString();
    if (avgWordsEl) avgWordsEl.textContent = filtered.length > 0 ? Math.round(totalWords / filtered.length) : 0;
    if (streakEl) streakEl.textContent = calculateLongestStreak();
    
    // Calculate average mood rating using dual-axis model
    const totalMoodRating = filtered.reduce((sum, e) => sum + getMoodScore(e.mood), 0);
    const avgMoodRating = filtered.length > 0 ? (totalMoodRating / filtered.length).toFixed(1) : 0;
    const avgMoodEl = document.getElementById('avgMoodRating');
    if (avgMoodEl) avgMoodEl.textContent = avgMoodRating;
    
    // Also calculate and display valence/energy averages
    const avgMood = calculateAverageMood(filtered);
    const avgValenceEl = document.getElementById('avgValence');
    const avgEnergyEl = document.getElementById('avgEnergy');
    if (avgValenceEl) avgValenceEl.textContent = `${(avgMood.valence * 100).toFixed(0)}%`;
    if (avgEnergyEl) avgEnergyEl.textContent = `${(avgMood.energy * 100).toFixed(0)}%`;
    
    // Charts
    renderWritingFrequencyChart(filtered);
    renderMoodTrendChart(filtered);
    renderMoodDistributionChart(filtered);
    renderMoodByDayChart(filtered);
    renderMoodByLocationChart(filtered);
    renderMoodByMonthChart(filtered);
    // renderTopTags(filtered); // Removed - now only showing meaningful words
    renderTopWords(filtered);
    renderPatternInsights(filtered);
}

function filterByTimeRange(items, range) {
    // Return all items if no valid items exist
    if (!items || items.length === 0) return [];
    
    // For "all" range, return everything
    if (range === 'all') return items;
    
    const now = new Date();
    let startDate;
    
    switch(range) {
        case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        case 'quarter':
            startDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
            break;
        case 'year':
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
        default:
            return items;
    }
    
    return items.filter(item => {
        if (!item.date) return false; // Skip items without dates
        const itemDate = new Date(item.date);
        // Check if date is valid
        if (isNaN(itemDate.getTime())) return false;
        return itemDate >= startDate;
    });
}

function renderWritingFrequencyChart(entries) {
    const ctx = document.getElementById('writingFrequencyChart');
    if (!ctx) {
        console.warn('⚠️ writingFrequencyChart canvas not found');
        return;
    }
    
    console.log('📊 Rendering Writing Frequency Chart with', entries.length, 'entries');
    
    try {
    
    // Calculate average entries per day of week from filtered entries
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    
    entries.forEach(e => {
        if (!e.date) return;
        const dayOfWeek = new Date(e.date).getDay();
        dayCounts[dayOfWeek]++;
    });
    
    // Calculate average if we have multiple weeks
    const totalDays = entries.length > 0 ? Math.ceil((new Date() - new Date(Math.min(...entries.map(e => new Date(e.date))))) / (1000 * 60 * 60 * 24)) : 7;
    const weeks = Math.max(1, Math.ceil(totalDays / 7));
    const avgCounts = dayCounts.map(count => (count / weeks).toFixed(1));
    
    if (writingFrequencyChart) writingFrequencyChart.destroy();
    writingFrequencyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dayNames,
            datasets: [{
                label: 'Avg Entries/Day',
                data: avgCounts,
                backgroundColor: '#4299e1'
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
    console.log('✅ Writing Frequency Chart rendered');
    } catch (error) {
        console.error('❌ Error rendering Writing Frequency Chart:', error);
    }
}

function renderMoodDistributionChart(entries) {
    const ctx = document.getElementById('moodDistributionChart');
    if (!ctx) return;
    
    const moodCounts = {};
    entries.forEach(e => {
        moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1;
    });
    
    if (moodDistributionChart) moodDistributionChart.destroy();
    moodDistributionChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(moodCounts),
            datasets: [{
                data: Object.values(moodCounts),
                backgroundColor: ['#4299e1', '#38b2ac', '#ed8936', '#9f7aea', '#f687b3', '#68d391', '#fc8181', '#f6e05e']
            }]
        },
        options: { responsive: true, maintainAspectRatio: true }
    });
}

function renderTopTags(entries) {
    const container = document.getElementById('topTags');
    if (!container) return;
    
    const tagCounts = {};
    entries.forEach(e => {
        (e.tags || []).forEach(tag => {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
    });
    
    const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    container.innerHTML = sorted.map(([tag, count]) => 
        `<div class="cloud-item" style="font-size: ${12 + count * 2}px;">${tag} (${count})</div>`
    ).join('');
}

function renderTopWords(entries) {
    const container = document.getElementById('topWords');
    if (!container) return;
    
    const wordCounts = {};
    const stopwords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 'as', 'by', 'that', 'this', 'it', 'from', 'be', 'was', 'were', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'very', 'really', 'just', 'like', 'more', 'so', 'some', 'what', 'about', 'into', 'out', 'up', 'down', 'over', 'there', 'then', 'when', 'where', 'who', 'why', 'how', 'all', 'each', 'she', 'they', 'them', 'their', 'said', 'than', 'him', 'her', 'his', 'hers', 'also', 'its', 'our', 'ours', 'your', 'yours', 'are', 'not', 'my', 'me', 'we', 'us', 'you', 'he', 'she', 'it', 'they', 'them', 'much', 'many', 'most', 'other', 'another', 'such', 'only', 'own', 'same', 'these', 'those', 'get', 'got', 'getting', 'make', 'made', 'making', 'being', 'having', 'nbsp']);
    
    entries.forEach(e => {
        const words = e.content.replace(/<[^>]*>/g, '').toLowerCase().split(/\W+/);
        words.forEach(word => {
            if (word.length > 3 && !stopwords.has(word)) {
                wordCounts[word] = (wordCounts[word] || 0) + 1;
            }
        });
    });
    
    const sorted = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
    container.innerHTML = sorted.map(([word, count]) => 
        `<div class="cloud-item" style="font-size: ${12 + Math.min(count, 10) * 1.5}px;">${word}</div>`
    ).join('');
}

function renderPatternInsights(entries) {
    const container = document.getElementById('patternInsights');
    if (!container) return;
    
    const insights = [];
    
    // Most common mood
    const moodCounts = {};
    entries.forEach(e => {
        moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1;
    });
    const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0];
    if (topMood) {
        insights.push({
            title: 'Most Common Mood',
            description: `You're most often ${topMood[0].toLowerCase()} (${topMood[1]} times this period)`
        });
    }
    
    // Writing patterns
    const hourCounts = {};
    entries.forEach(e => {
        const hour = new Date(e.date).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
    if (peakHour) {
        const time = parseInt(peakHour[0]) < 12 ? 'morning' : parseInt(peakHour[0]) < 17 ? 'afternoon' : 'evening';
        insights.push({
            title: 'Peak Writing Time',
            description: `You write most often in the ${time} (around ${peakHour[0]}:00)`
        });
    }
    
    container.innerHTML = insights.map(insight => `
        <div class="insight-card">
            <div class="insight-title">${insight.title}</div>
            <div class="insight-description">${insight.description}</div>
        </div>
    `).join('');
}

function calculateLongestStreak() {
    if (journals.length === 0) return 0;
    
    const sortedDates = journals.map(j => new Date(j.date).toISOString().split('T')[0]).sort();
    let maxStreak = 1;
    let currentStreak = 1;
    
    for (let i = 1; i < sortedDates.length; i++) {
        const prev = new Date(sortedDates[i-1]);
        const curr = new Date(sortedDates[i]);
        const diff = (curr - prev) / (1000 * 60 * 60 * 24);
        
        if (diff === 1) {
            currentStreak++;
            maxStreak = Math.max(maxStreak, currentStreak);
        } else if (diff > 1) {
            currentStreak = 1;
        }
    }
    
    return maxStreak;
}

function exportAnalytics() {
    const report = {
        generated: new Date().toISOString(),
        totalEntries: journals.length,
        totalWords: journals.reduce((sum, e) => sum + (e.wordCount || 0), 0),
        goals: goals.length,
        todos: todos.length,
        longestStreak: calculateLongestStreak()
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-report-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Analytics report exported');
}

// Continue with AI Reviews and remaining functions...

// ===================================
// AI REVIEWS SECTION
// ===================================

let aiReviews = [];
let chatMessages = [];

function showAIReviewsSection() {
    const titleEl = document.getElementById('entriesColumnTitle');
    const newItemBtn = document.getElementById('newItemBtn');
    
    if (titleEl) titleEl.textContent = 'AI Reviews';
    if (newItemBtn) newItemBtn.style.display = 'none';
    
    renderAIReviewsList();
    showAIReviewsDetail();
}

function renderAIReviewsList() {
    const container = document.getElementById('entriesList');
    container.innerHTML = `
        <div style="padding: var(--space-md);">
            <button class="btn-primary" onclick="generateNewReview()" style="width: 100%; margin-bottom: var(--space-md);">Generate AI Review</button>
            <div id="reviewTypesList">
                <div class="entry-card" onclick="switchReviewType('weekly')">Weekly Reviews</div>
                <div class="entry-card" onclick="switchReviewType('monthly')">Monthly Reviews</div>
                <div class="entry-card" onclick="switchReviewType('quarterly')">Quarterly Reviews</div>
                <div class="entry-card" onclick="switchReviewType('yearly')">Yearly Reviews</div>
            </div>
        </div>
    `;
}

function showAIReviewsDetail() {
    const detailContent = document.getElementById('detailContent');
    detailContent.innerHTML = `
        <div class="ai-reviews-header">
            <h2>AI-Powered Insights</h2>
            <p style="color: var(--text-secondary); font-size: var(--font-size-sm); margin-top: var(--space-xs);">
                Get intelligent analysis of your journal entries, moods, and patterns
            </p>
        </div>
        
        <!-- Quick Insights Cards -->
        <div class="quick-insights-grid">
            <div class="insight-card-modern" onclick="generateQuickInsight('mood')">
                <div class="insight-icon">😊</div>
                <h4>Mood Analysis</h4>
                <p>Understand your emotional patterns</p>
            </div>
            <div class="insight-card-modern" onclick="generateQuickInsight('achievements')">
                <div class="insight-icon">🏆</div>
                <h4>Key Achievements</h4>
                <p>Celebrate your progress</p>
            </div>
            <div class="insight-card-modern" onclick="generateQuickInsight('goals')">
                <div class="insight-icon">🎯</div>
                <h4>Goal Review</h4>
                <p>Track your goal progress</p>
            </div>
            <div class="insight-card-modern" onclick="generateQuickInsight('themes')">
                <div class="insight-icon">💭</div>
                <h4>Common Themes</h4>
                <p>Discover recurring topics</p>
            </div>
        </div>
        
        <!-- Generated Insights Display -->
        <div id="generatedInsightDisplay" class="generated-insight-display" style="display: none;">
            <div class="insight-content-header">
                <h3 id="insightTitle">Insight</h3>
                <button class="btn-icon-only" onclick="closeInsightDisplay()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div id="insightContent" class="insight-content-body"></div>
        </div>
        
        <!-- Smart Assistant -->
        <div class="ai-assistant-section">
            <h3 style="margin-bottom: var(--space-md);">Ask Your Journal Assistant</h3>
            <div class="assistant-suggestions">
                <button class="suggestion-modern" onclick="askAssistant('What were my best days this month?')">
                    <span>📅</span> Best days this month
                </button>
                <button class="suggestion-modern" onclick="askAssistant('What should I reflect on?')">
                    <span>🤔</span> What to reflect on
                </button>
                <button class="suggestion-modern" onclick="askAssistant('How am I doing with my goals?')">
                    <span>📈</span> Goal progress check
                </button>
            </div>
            <div class="chat-modern-container">
                <div class="chat-messages-modern" id="chatMessages"></div>
                <div class="chat-input-modern-container">
                    <input type="text" id="aiChatInput" class="chat-input-modern" placeholder="Ask anything about your journal..." onkeypress="handleChatEnter(event)">
                    <button class="btn-chat-send" onclick="sendChatMessage()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    renderReviews('weekly');
}

function switchReviewType(type) {
    document.querySelectorAll('.review-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-type="${type}"]`)?.classList.add('active');
    renderReviews(type);
}

function renderReviews(type) {
    const container = document.getElementById('reviewsList');
    if (!container) return;
    
    const filtered = aiReviews.filter(r => r.type === type);
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No reviews yet. Generate your first review!</p></div>';
        return;
    }
    
    container.innerHTML = filtered.map(review => `
        <div class="review-card">
            <div class="review-header">
                <div>
                    <div class="review-period">${review.period}</div>
                    <div class="review-date">${new Date(review.date).toLocaleDateString()}</div>
                </div>
            </div>
            <div class="review-content">${review.content}</div>
        </div>
    `).join('');
}

function generateNewReview() {
    const type = document.querySelector('.review-tab.active')?.dataset.type || 'weekly';
    
    // Generate AI review based on journal data
    const review = generateAIInsights(type);
    
    aiReviews.push({
        id: Date.now().toString(),
        type,
        period: getPeriodName(type),
        date: new Date().toISOString(),
        content: review
    });
    
    renderReviews(type);
    showToast('Review generated!');
}

function generateAIInsights(type) {
    const timeRange = type === 'weekly' ? 'week' : type === 'monthly' ? 'month' : type === 'quarterly' ? 'quarter' : 'year';
    const entries = filterByTimeRange(journals, timeRange);
    
    if (entries.length === 0) {
        return '<p>Not enough data to generate insights for this period.</p>';
    }
    
    let insights = '<div class="review-section"><h4>Summary</h4>';
    insights += `<p>You wrote ${entries.length} journal entries during this period. `;
    
    // Mood analysis
    const moodCounts = {};
    entries.forEach(e => {
        moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1;
    });
    const dominantMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0];
    insights += `Your dominant mood was ${dominantMood[0].toLowerCase()}, appearing in ${Math.round((dominantMood[1] / entries.length) * 100)}% of entries.</p></div>`;
    
    // Pattern detection
    insights += '<div class="review-section"><h4>Patterns Detected</h4><ul>';
    
    // Check for tags
    const allTags = {};
    entries.forEach(e => {
        (e.tags || []).forEach(tag => {
            allTags[tag] = (allTags[tag] || 0) + 1;
        });
    });
    const topTags = Object.entries(allTags).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topTags.length > 0) {
        insights += `<li>Your main focus areas were: ${topTags.map(([tag]) => tag).join(', ')}</li>`;
    }
    
    // Writing frequency
    const avgEntriesPerWeek = (entries.length / (type === 'weekly' ? 1 : type === 'monthly' ? 4 : type === 'quarterly' ? 12 : 52)).toFixed(1);
    insights += `<li>You averaged ${avgEntriesPerWeek} entries per week</li>`;
    
    insights += '</ul></div>';
    
    // Goals progress
    const activeGoals = goals.filter(g => g.progress < 100);
    if (activeGoals.length > 0) {
        insights += '<div class="review-section"><h4>Goal Progress</h4><ul>';
        activeGoals.forEach(goal => {
            insights += `<li>${goal.title}: ${goal.progress}% complete</li>`;
        });
        insights += '</ul></div>';
    }
    
    // Recommendations
    insights += '<div class="review-section"><h4>Recommendations</h4><ul>';
    if (entries.length < 7 && type === 'weekly') {
        insights += '<li>Try to write more consistently - aim for daily entries</li>';
    }
    if (activeGoals.some(g => g.progress < 20)) {
        insights += '<li>Some goals need more attention - consider breaking them into smaller steps</li>';
    }
    if (dominantMood[0] === 'Anxious' || dominantMood[0] === 'Frustrated') {
        insights += '<li>You might benefit from stress-reduction techniques or talking to someone</li>';
    }
    insights += '</ul></div>';
    
    return insights;
}

function getPeriodName(type) {
    const now = new Date();
    switch(type) {
        case 'weekly':
            return `Week of ${now.toLocaleDateString()}`;
        case 'monthly':
            return now.toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
        case 'quarterly':
            const quarter = Math.floor(now.getMonth() / 3) + 1;
            return `Q${quarter} ${now.getFullYear()}`;
        case 'yearly':
            return `Year ${now.getFullYear()}`;
        default:
            return '';
    }
}

function handleChatEnter(event) {
    if (event.key === 'Enter') {
        sendChatMessage();
    }
}

function sendChatMessage() {
    const input = document.getElementById('aiChatInput');
    if (!input || !input.value.trim()) return;
    
    const message = input.value.trim();
    chatMessages.push({role: 'user', content: message});
    
    // Generate AI response
    const response = generateChatResponse(message);
    chatMessages.push({role: 'ai', content: response});
    
    renderChatMessages();
    input.value = '';
}

function askSuggestion(question) {
    document.getElementById('aiChatInput').value = question;
    sendChatMessage();
}

function generateChatResponse(question) {
    const lowerQ = question.toLowerCase();
    
    if (lowerQ.includes('mood') || lowerQ.includes('feel')) {
        const moodCounts = {};
        journals.forEach(e => {
            moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1;
        });
        const sorted = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]);
        return `Based on your journal entries, you're most often ${sorted[0][0].toLowerCase()} (${sorted[0][1]} times), followed by ${sorted[1][0].toLowerCase()} (${sorted[1][1]} times). There's a positive trend overall!`;
    }
    
    if (lowerQ.includes('goal') || lowerQ.includes('progress')) {
        const avgProgress = goals.length > 0 ? Math.round(goals.reduce((sum, g) => sum + g.progress, 0) / goals.length) : 0;
        const onTrack = goals.filter(g => g.progress >= 50).length;
        return `You're doing well! Your goals are ${avgProgress}% complete on average. ${onTrack} out of ${goals.length} goals are on track. Keep up the great work!`;
    }
    
    if (lowerQ.includes('achievement') || lowerQ.includes('accomplish')) {
        const completedGoals = goals.filter(g => g.progress >= 100).length;
        const completedTodos = todos.filter(t => t.completed).length;
        return `You've completed ${completedGoals} goals and ${completedTodos} todos! Your longest writing streak is ${calculateLongestStreak()} days. You're making excellent progress!`;
    }
    
    if (lowerQ.includes('focus') || lowerQ.includes('improve')) {
        const lowProgressGoals = goals.filter(g => g.progress < 30);
        if (lowProgressGoals.length > 0) {
            return `I'd suggest focusing on: ${lowProgressGoals.map(g => g.title).join(', ')}. These goals need more attention. Consider breaking them into smaller, achievable steps!`;
        }
        return `You're doing great across the board! Consider setting new challenging goals to keep growing.`;
    }
    
    return `That's an interesting question! Based on your ${journals.length} journal entries, I can see you're actively working on self-improvement. Keep journaling regularly - it's a powerful tool for reflection and growth!`;
}

function renderChatMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    
    container.innerHTML = chatMessages.map(msg => `
        <div class="chat-message ${msg.role}">
            ${msg.content}
        </div>
    `).join('');
    
    container.scrollTop = container.scrollHeight;
}

// ===================================
// FOLDERS SECTION
// ===================================

function initializeFolders() {
    // System folders are always present
    const systemFolders = [
        { id: 'all', name: 'All Entries', type: 'system', icon: 'folder', color: '#4299e1' },
        { id: 'featured', name: 'Featured', type: 'system', icon: 'star', color: '#f6e05e' }
    ];
    
    // User folders come from server data
    const userFolders = folders.filter(f => f.type !== 'system');
    
    // Combine system and user folders
    folders = [...systemFolders, ...userFolders];
    
    renderFolders();
}

function renderFolders() {
    const container = document.getElementById('foldersList');
    if (!container) return;
    
    container.innerHTML = folders.map(folder => {
        const count = folder.id === 'all' ? journals.length : 
                     folder.id === 'featured' ? journals.filter(j => j.featured).length :
                     getEntriesInFolder(folder).length;
        
        return `
            <div class="folder-item" onclick="viewFolder('${folder.id}')" data-id="${folder.id}">
                <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="folder-name">${folder.name}</span>
                <span class="folder-count">(${count})</span>
            </div>
        `;
    }).join('');
}

function getEntriesInFolder(folder) {
    if (!folder.rules || folder.rules.length === 0) return [];
    
    return journals.filter(entry => {
        return folder.rules.every(rule => {
            const value = entry[rule.field];
            if (!value) return false;
            
            switch(rule.operator) {
                case 'contains':
                    return Array.isArray(value) ? value.includes(rule.value) : value.includes(rule.value);
                case 'equals':
                    return value === rule.value;
                case 'startsWith':
                    return value.startsWith(rule.value);
                case 'endsWith':
                    return value.endsWith(rule.value);
                default:
                    return false;
            }
        });
    });
}

function viewFolder(folderId) {
    navigateToSection('entries');
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;
    
    document.getElementById('entriesColumnTitle').textContent = folder.name;
    
    let filtered;
    if (folderId === 'all') {
        filtered = journals;
    } else if (folderId === 'featured') {
        filtered = journals.filter(j => j.featured);
    } else {
        filtered = getEntriesInFolder(folder);
    }
    
    const container = document.getElementById('entriesList');
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No entries in this folder</p></div>';
        return;
    }
    
    container.innerHTML = filtered.map(entry => {
        const date = new Date(entry.date);
        const preview = entry.content.replace(/<[^>]*>/g, '').substring(0, 100);
        return `
            <div class="entry-card" onclick="openEntry('${entry.id}')">
                <div class="entry-card-title">${entry.title}</div>
                <div class="entry-card-date">${date.toLocaleDateString()}</div>
                <div class="entry-card-preview">${preview}...</div>
                <div class="entry-card-meta">
                    <span class="meta-badge">${entry.mood}</span>
                </div>
            </div>
        `;
    }).join('');
}
// Add this function to fix entries-header
function fixEntriesHeaderAlignment() {
    const entriesHeader = document.querySelector('.entries-header');
    if (entriesHeader) {
        // Ensure proper flexbox alignment
        entriesHeader.style.display = 'flex';
        entriesHeader.style.alignItems = 'center';
        entriesHeader.style.justifyContent = 'space-between';
        entriesHeader.style.padding = '15px 20px';
        entriesHeader.style.borderBottom = '1px solid var(--border-light)';
        
        // Ensure child elements are properly aligned
        const title = entriesHeader.querySelector('h2');
        const buttons = entriesHeader.querySelector('.header-actions');
        
        if (title) {
            title.style.margin = '0';
            title.style.flex = '1';
        }
        
        if (buttons) {
            buttons.style.display = 'flex';
            buttons.style.gap = '10px';
            buttons.style.alignItems = 'center';
        }
    }
}

// Call this after page load
document.addEventListener('DOMContentLoaded', function() {
    fixEntriesHeaderAlignment();
    initializeMobileView();
});
// Replace the toggleFoldersSection function
function toggleFoldersSection() {
    const section = document.getElementById('foldersSection');
    const button = document.querySelector('.nav-item-collapsible');
    
    if (section && button) {
        const isCollapsed = section.classList.contains('collapsed');
        
        if (isCollapsed) {
            // Expand - open upward
            section.classList.remove('collapsed');
            button.classList.add('expanded');
            
            // Position to open upward
            section.style.position = 'relative';
            section.style.zIndex = '100';
            
            // Ensure button stays visible
            const sidebar = document.querySelector('.sidebar-content');
            if (sidebar) {
                sidebar.scrollTop = 0;
            }
        } else {
            // Collapse
            section.classList.add('collapsed');
            button.classList.remove('expanded');
        }
    }
}

// function showCreateFolderModal() {
//     document.getElementById('folderModal').style.display = 'flex';
//     document.getElementById('folderTypeInput').value = 'smart';
//     toggleFolderRules();
// }

function closeFolderModal() {
    document.getElementById('folderModal').style.display = 'none';
}

function toggleFolderRules() {
    const type = document.getElementById('folderTypeInput').value;
    const rulesGroup = document.getElementById('folderRulesGroup');
    if (rulesGroup) {
        rulesGroup.style.display = type === 'smart' ? 'block' : 'none';
    }
}

function addRule() {
    const container = document.getElementById('rulesContainer');
    const ruleRow = document.createElement('div');
    ruleRow.className = 'rule-row';
    ruleRow.innerHTML = `
        <select class="rule-field">
            <option value="">Select field</option>
            <option value="tags">Tags</option>
            <option value="mood">Mood</option>
            <option value="title">Title</option>
            <option value="content">Content</option>
            <option value="location">Location</option>
        </select>
        <select class="rule-operator">
            <option value="contains">Contains</option>
            <option value="equals">Equals</option>
            <option value="startsWith">Starts with</option>
            <option value="endsWith">Ends with</option>
        </select>
        <input type="text" class="rule-value" placeholder="Value">
        <button type="button" class="btn-remove-rule" onclick="removeRule(this)">×</button>
    `;
    container.appendChild(ruleRow);
}

function removeRule(button) {
    button.parentElement.remove();
}

async function createFolder() {
    const name = document.getElementById('folderNameInput').value.trim();
    if (!name) {
        showToast('Please enter a folder name', 'error');
        return;
    }
    
    if (!serverConnected) {
        showToast('Cannot create folder - server not connected', 'error');
        return;
    }
    
    const type = document.getElementById('folderTypeInput').value;
    const color = document.querySelector('.color-option.selected')?.dataset.color || '#4299e1';
    
    const rules = [];
    if (type === 'smart') {
        document.querySelectorAll('#rulesContainer .rule-row').forEach(row => {
            const field = row.querySelector('.rule-field').value;
            const operator = row.querySelector('.rule-operator').value;
            const value = row.querySelector('.rule-value').value;
            
            if (field && value) {
                rules.push({field, operator, value});
            }
        });
    }
    
    const folder = {
        id: Date.now().toString(),
        name,
        type,
        color,
        rules,
        createdAt: new Date().toISOString()
    };
    
    folders.push(folder);
    
    await saveData();
    
    closeFolderModal();
    renderFolders();
    showToast('Folder created!');
}

// Color picker
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('color-option')) {
        document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
        e.target.classList.add('selected');
    }
});

// ===================================
// UTILITY FUNCTIONS
// ===================================

function updateCurrentDate() {
    const el = document.getElementById('currentDate');
    if (el) {
        el.textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
}

function updateStreak() {
    const streakEl = document.getElementById('streakNumber');
    if (!streakEl) return;
    
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const sortedEntries = [...journals].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    for (let i = 0; i < sortedEntries.length; i++) {
        const entryDate = new Date(sortedEntries[i].date);
        entryDate.setHours(0, 0, 0, 0);
        
        const diffDays = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
        
        if (diffDays === streak) {
            streak++;
        } else if (diffDays > streak) {
            break;
        }
    }
    
    streakEl.textContent = streak;
}

function updateAllCounts() {
    const entriesCount = document.getElementById('entriesCount');
    if (entriesCount) {
        entriesCount.textContent = `${journals.length} entries`;
    }
    
    updateStreak();
}

function filterCurrentSection() {
    switch(currentSection) {
        case 'entries':
            renderEntriesList();
            break;
        case 'todos':
            renderTodosList();
            break;
        case 'goals':
            renderGoalsList();
            break;
    }
}

function handleNewItemClick() {
    switch(currentSection) {
        case 'entries':
            createNewEntry();
            break;
        case 'todos':
            document.getElementById('newTodoInput')?.focus();
            break;
        case 'goals':
            showCreateGoalModal();
            break;
    }
}

function createNewEntry() {
    console.log('📝 Create new entry called');
    
    editingEntryId = null;
    currentEntryId = null;
    
    const formEl = document.getElementById('new-entry-form');
    const viewEl = document.getElementById('entry-view');
    
    console.log('Form element:', formEl ? 'found' : 'NOT FOUND');
    console.log('View element:', viewEl ? 'found' : 'NOT FOUND');
    
    if (formEl) formEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    
    // Clear form
    const titleInput = document.getElementById('entryTitle');
    const moodSelect = document.getElementById('entryMood');
    const locationInput = document.getElementById('entryLocation');
    
    if (titleInput) {
        titleInput.value = '';
        console.log('✅ Title input cleared');
    }
    if (moodSelect) {
        moodSelect.value = '';
        console.log('✅ Mood select cleared');
    }
    if (locationInput) {
        locationInput.value = '';
        console.log('✅ Location input cleared');
    }
    
    currentTags = [];
    selectedGoalIds = [];
    selectedTodoIds = [];
    selectedEntryIds = [];
    clearEntryLinking();
    renderTags();
    
    if (quill) {
        quill.setText('');
        console.log('✅ Quill editor cleared');
    } else {
        console.warn('⚠️ Quill editor not found');
    }
    
    loadGoalsLinking();
    
    // Scroll to top
    const detailContent = document.querySelector('.detail-content');
    if (detailContent) {
        detailContent.scrollTop = 0;
        console.log('✅ Scrolled to top');
    }
    
    console.log('✅ New entry form ready');
}

function exportData() {
    const data = {
        journals,
        todos,
        goals,
        folders: folders.filter(f => f.type !== 'system'),
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Backup downloaded');
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Update activity timestamp on server
document.addEventListener('click', async () => {
    if (isAuthenticated && serverConnected) {
        try {
            await fetch(`${API_BASE_URL}/auth/activity`, {
                method: 'POST',
                credentials: 'include'
            });
            startSessionTimer();
        } catch (error) {
            // Silent fail - not critical
        }
    }
});

// Initialize filter selects based on section
function updateFilterOptions(section) {
    const filterSelect = document.getElementById('filterSelect');
    if (!filterSelect) return;
    
    filterSelect.innerHTML = '';
    
    switch(section) {
        case 'entries':
            filterSelect.innerHTML = `
                <option value="">All Moods</option>
                <option value="Happy">Happy</option>
                <option value="Peaceful">Peaceful</option>
                <option value="Thoughtful">Thoughtful</option>
                <option value="Melancholic">Melancholic</option>
                <option value="Anxious">Anxious</option>
                <option value="Tired">Tired</option>
                <option value="Excited">Excited</option>
                <option value="Frustrated">Frustrated</option>
                <option value="Grateful">Grateful</option>
                <option value="Inspired">Inspired</option>
            `;
            break;
        case 'todos':
            filterSelect.innerHTML = `
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="all">All</option>
            `;
            break;
        case 'goals':
            filterSelect.innerHTML = `
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="all">All</option>
            `;
            break;
    }
}

console.log('✅ Journal app initialized');

// ===================================
// MISSING FUNCTIONS - TODO VIEW
// ===================================

function viewTodo(todoId) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    
    const detailContent = document.getElementById('detailContent');
    if (!detailContent) return;
    
    detailContent.innerHTML = `
        <div class="todo-detail-view">
            <div class="entry-view-header">
                <h1 class="entry-view-title">${todo.text}</h1>
                <div class="entry-view-actions">
                    <button class="btn-icon-only" onclick="toggleTodo('${todoId}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 11l3 3L22 4"/>
                        </svg>
                    </button>
                    <button class="btn-icon-only" onclick="editTodo('${todoId}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn-icon-only delete" onclick="deleteTodo('${todoId}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
            
            <div class="entry-view-meta">
                <span class="meta-item">
                    <span class="todo-priority ${todo.priority}">${todo.priority} priority</span>
                </span>
                ${todo.dueDate ? `<span class="meta-item">Due: ${new Date(todo.dueDate).toLocaleDateString()}</span>` : ''}
                <span class="meta-item">${todo.completed ? '✓ Completed' : '○ Pending'}</span>
                ${todo.completedAt ? `<span class="meta-item">Completed on ${new Date(todo.completedAt).toLocaleDateString()}</span>` : ''}
            </div>
            
            <div class="todo-detail-content">
                <p>${todo.text}</p>
            </div>
            
            <div class="todo-actions" style="margin-top: var(--space-lg); display: flex; gap: var(--space-md);">
                <button class="btn-primary" onclick="toggleTodo('${todoId}'); viewTodo('${todoId}')">
                    ${todo.completed ? 'Mark as Incomplete' : 'Mark as Complete'}
                </button>
                <button class="btn-secondary" onclick="showTodosDetail()">Back to List</button>
            </div>
        </div>
    `;
    
    renderTodosList();
}

function editTodo(todoId) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    
    const newText = prompt('Edit todo:', todo.text);
    if (newText && newText.trim()) {
        todo.text = newText.trim();
        saveData();
        renderTodosList();
        renderTodosDetailList();
        viewTodo(todoId);
        showToast('Todo updated');
    }
}

function viewGoal(goalId) {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    
    const detailContent = document.getElementById('detailContent');
    if (!detailContent) return;
    
    const linkedEntries = journals.filter(j => j.linkedGoals && j.linkedGoals.includes(goalId));
    
    detailContent.innerHTML = `
        <div class="goal-detail-view">
            <div class="entry-view-header">
                <h1 class="entry-view-title">${goal.title}</h1>
                <div class="entry-view-actions">
                    <button class="btn-icon-only" onclick="editGoal('${goalId}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn-icon-only delete" onclick="deleteGoal('${goalId}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
            
            <div class="goal-type-badge" style="margin-bottom: var(--space-md);">
                <span class="goal-type">${goal.type}</span>
            </div>
            
            ${goal.description ? `
                <div class="goal-description" style="margin-bottom: var(--space-lg);">
                    <p>${goal.description}</p>
                </div>
            ` : ''}
            
            <div class="goal-progress-section">
                <div class="goal-progress-header">
                    <span style="font-weight: 600;">Progress</span>
                    <span style="font-weight: 600; color: var(--accent-primary);">${goal.progress}%</span>
                </div>
                <div class="goal-progress-bar" style="margin: var(--space-md) 0;">
                    <div class="goal-progress-fill" style="width: ${goal.progress}%"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: var(--font-size-sm); color: var(--text-secondary);">
                    <span>Current: ${goal.current || 0}</span>
                    <span>Target: ${goal.target || 100}</span>
                </div>
            </div>
            
            <div class="goal-meta" style="margin: var(--space-lg) 0;">
                ${goal.startDate ? `<div>Started: ${new Date(goal.startDate).toLocaleDateString()}</div>` : ''}
                ${goal.targetDate ? `<div>Target Date: ${new Date(goal.targetDate).toLocaleDateString()}</div>` : ''}
                ${goal.createdAt ? `<div>Created: ${new Date(goal.createdAt).toLocaleDateString()}</div>` : ''}
            </div>
            
            ${linkedEntries.length > 0 ? `
                <div class="linked-entries-section" style="margin-top: var(--space-xl);">
                    <h3 style="margin-bottom: var(--space-md);">Linked Journal Entries (${linkedEntries.length})</h3>
                    <div class="linked-entries-list">
                        ${linkedEntries.map(entry => `
                            <div class="entry-card" onclick="openEntry('${entry.id}');" style="cursor: pointer;">
                                <div class="entry-card-title">${entry.title}</div>
                                <div class="entry-card-date">${new Date(entry.date).toLocaleDateString()}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div class="goal-actions" style="margin-top: var(--space-xl); display: flex; gap: var(--space-md); flex-wrap: wrap;">
                <button class="btn-primary" onclick="updateGoalProgress('${goalId}')">Update Progress</button>
                <button class="btn-secondary" onclick="editGoal('${goalId}')">Edit Goal</button>
                <button class="btn-secondary" onclick="showGoalsDetail()">Back to Goals</button>
            </div>
        </div>
    `;
    
    renderGoalsList();
}

function viewCalendarDate(dateStr) {
    selectedDate = dateStr;
    const date = new Date(dateStr);
    const entries = journals.filter(j => j.date.startsWith(dateStr));
    const dateTodos = todos.filter(t => t.dueDate && t.dueDate.startsWith(dateStr));
    
    const detailContent = document.getElementById('detailContent');
    if (!detailContent) return;
    
    detailContent.innerHTML = `
        <div class="date-detail-view">
            <div class="entry-view-header">
                <h1 class="entry-view-title">${date.toLocaleDateString('en-US', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}</h1>
                <button class="btn-icon-only" onclick="showCalendarDetail()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            
            <div class="date-stats" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-md); margin: var(--space-lg) 0;">
                <div class="stat-card">
                    <div class="stat-value">${entries.length}</div>
                    <div class="stat-label">Journal Entries</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${dateTodos.length}</div>
                    <div class="stat-label">Todos</div>
                </div>
            </div>
            
            ${entries.length > 0 ? `
                <div class="date-entries-section" style="margin-top: var(--space-xl);">
                    <h3 style="margin-bottom: var(--space-md);">Journal Entries</h3>
                    ${entries.map(entry => `
                        <div class="entry-card" onclick="openEntry('${entry.id}');" style="cursor: pointer; margin-bottom: var(--space-sm);">
                            <div class="entry-card-title">${entry.title}</div>
                            <div class="entry-card-meta">
                                <span class="meta-badge">${entry.mood}</span>
                                ${entry.wordCount ? `<span class="meta-badge">${entry.wordCount} words</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            ${dateTodos.length > 0 ? `
                <div class="date-todos-section" style="margin-top: var(--space-xl);">
                    <h3 style="margin-bottom: var(--space-md);">Todos</h3>
                    ${dateTodos.map(todo => `
                        <div class="todo-item ${todo.completed ? 'completed' : ''}">
                            <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''} onchange="toggleTodo('${todo.id}'); viewCalendarDate('${dateStr}');">
                            <div class="todo-text">${todo.text}</div>
                            <span class="todo-priority ${todo.priority}">${todo.priority}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            ${entries.length === 0 && dateTodos.length === 0 ? `
                <div class="empty-state">
                    <p>No entries or todos for this date.</p>
                </div>
            ` : ''}
            
            <div class="date-actions" style="margin-top: var(--space-xl); display: flex; gap: var(--space-md);">
                <button class="btn-primary" onclick="createEntryForDate('${dateStr}')">New Entry for This Date</button>
                <button class="btn-secondary" onclick="createTodoForDate('${dateStr}')">New Todo for This Date</button>
            </div>
        </div>
    `;
}

function closeDateDetails() {
    showCalendarDetail();
}

function getCurrentLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                try {
                    const response = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?lat=${position.coords.latitude}&lon=${position.coords.longitude}&format=json`
                    );
                    const data = await response.json();
                    const location = data.address.city || data.address.town || data.address.village || 'Unknown';
                    const locationInput = document.getElementById('entryLocation');
                    if (locationInput) {
                        locationInput.value = location;
                        showToast('Location detected');
                    }
                } catch (error) {
                    showToast('Could not get location name', 'error');
                }
            },
            (error) => {
                showToast('Location access denied', 'error');
            }
        );
    } else {
        showToast('Geolocation not supported', 'error');
    }
}

// Fix updateFilterOptions to handle null gracefully
function updateFilterOptions(section) {
    const filterSelect = document.getElementById('filterSelect');
    if (!filterSelect) return;
    
    filterSelect.innerHTML = '';
    
    switch(section) {
        case 'entries':
            filterSelect.innerHTML = `
                <option value="">All Moods</option>
                <option value="Happy">Happy</option>
                <option value="Peaceful">Peaceful</option>
                <option value="Thoughtful">Thoughtful</option>
                <option value="Melancholic">Melancholic</option>
                <option value="Anxious">Anxious</option>
                <option value="Tired">Tired</option>
                <option value="Excited">Excited</option>
                <option value="Frustrated">Frustrated</option>
                <option value="Grateful">Grateful</option>
                <option value="Inspired">Inspired</option>
            `;
            break;
        case 'todos':
            filterSelect.innerHTML = `
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="all">All</option>
            `;
            break;
        case 'goals':
            filterSelect.innerHTML = `
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="all">All</option>
            `;
            break;
    }
}

console.log('✅ All missing functions added');

// ==================================
// MINI CALENDAR
// ==================================

let miniCalMonth = new Date().getMonth();
let miniCalYear = new Date().getFullYear();

function renderMiniCalendar() {
    const grid = document.getElementById('miniCalGrid');
    const monthEl = document.getElementById('miniMonth');
    
    if (!grid || !monthEl) return;
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    monthEl.textContent = `${monthNames[miniCalMonth]} ${miniCalYear}`;
    
    const firstDay = new Date(miniCalYear, miniCalMonth, 1).getDay();
    const daysInMonth = new Date(miniCalYear, miniCalMonth + 1, 0).getDate();
    const today = new Date();
    
    let html = '';
    
    // Add previous month days
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="mini-cal-day other-month"></div>';
    }
    
    // Add current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(miniCalYear, miniCalMonth, day);
        const dateStr = date.toISOString().split('T')[0];
        const hasEntry = journals.some(j => j.date && j.date.startsWith(dateStr));
        const isToday = date.toDateString() === today.toDateString();
        
        const classes = ['mini-cal-day'];
        if (isToday) classes.push('today');
        if (hasEntry) classes.push('has-entry');
        
        html += `<div class="${classes.join(' ')}" onclick="miniCalDayClick('${dateStr}')">${day}</div>`;
    }
    
    grid.innerHTML = html;
}

function miniCalPrev() {
    if (miniCalMonth === 0) {
        miniCalMonth = 11;
        miniCalYear--;
    } else {
        miniCalMonth--;
    }
    renderMiniCalendar();
}

function miniCalNext() {
    if (miniCalMonth === 11) {
        miniCalMonth = 0;
        miniCalYear++;
    } else {
        miniCalMonth++;
    }
    renderMiniCalendar();
}

function miniCalDayClick(dateStr) {
    navigateToSection('calendar');
    viewCalendarDate(dateStr);
}


// ==================================
// SORT ENTRIES LATEST FIRST & SHOW LINKED ITEMS
// ==================================

function renderEntriesList() {
    const container = document.getElementById('entriesList');
    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const moodFilter = document.getElementById('filterSelect')?.value || '';
    
    let filtered = journals.filter(entry => {
        // Comprehensive search
        const titleMatch = entry.title?.toLowerCase().includes(searchTerm);
        const contentMatch = entry.content?.toLowerCase().includes(searchTerm);
        const locationMatch = entry.location?.toLowerCase().includes(searchTerm);
        
        // Search in tags
        const tagsMatch = entry.tags?.some(tag => tag.toLowerCase().includes(searchTerm));
        
        // Search in linked goals
        const goalsMatch = (entry.linkedGoals || []).some(gid => {
            const goal = goals.find(g => g.id === gid);
            return goal && goal.title.toLowerCase().includes(searchTerm);
        });
        
        // Search in linked todos
        const todosMatch = (entry.linkedTodos || []).some(tid => {
            const todo = todos.find(t => t.id === tid);
            return todo && todo.text.toLowerCase().includes(searchTerm);
        });
        
        const matchesSearch = !searchTerm || titleMatch || contentMatch || locationMatch || tagsMatch || goalsMatch || todosMatch;
        
        // Fixed mood filter
        const matchesMood = !moodFilter || moodFilter === '' || entry.mood === moodFilter;
        
        return matchesSearch && matchesMood;
    });
    
    // Sort by date - latest first
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No entries found</p></div>';
        return;
    }
    
    container.innerHTML = filtered.map(entry => {
        const date = new Date(entry.date);
        const preview = entry.content ? entry.content.replace(/<[^>]*>/g, '').substring(0, 100) : '';
        
        // Get linked items
        const linkedGoals = (entry.linkedGoals || []).map(gid => {
            const goal = goals.find(g => g.id === gid);
            return goal ? goal.title : null;
        }).filter(Boolean);
        
        const linkedTodos = (entry.linkedTodos || []).map(tid => {
            const todo = todos.find(t => t.id === tid);
            return todo ? todo.text : null;
        }).filter(Boolean);
        
        return `
            <div class="entry-card ${entry.id === currentEntryId ? 'active' : ''} ${entry.featured ? 'featured' : ''}" 
                 data-entry-id="${entry.id || entry.timestamp}" 
                 onclick="openEntry('${entry.id || entry.timestamp}')">
                <div class="entry-card-header">
                    <div class="entry-card-title">${entry.title}</div>
                    ${entry.featured ? '<svg class="featured-icon" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : ''}
                </div>
                <div class="entry-card-date">${date.toLocaleDateString()}</div>
                <div class="entry-card-preview">${preview}...</div>
                <div class="entry-card-meta">
                    <span class="meta-badge meta-badge-mood">${entry.mood}</span>
                    ${linkedGoals.length > 0 ? `<span class="meta-badge meta-badge-goal">🎯 ${linkedGoals.length}</span>` : ''}
                    ${linkedTodos.length > 0 ? `<span class="meta-badge meta-badge-todo">✓ ${linkedTodos.length}</span>` : ''}
                    ${(entry.linkedEntries && entry.linkedEntries.length > 0) ? `<span class="meta-badge meta-badge-link">🔗 ${entry.linkedEntries.length}</span>` : ''}
                    ${(entry.tags && entry.tags.length > 0) ? `<span class="meta-badge meta-badge-tags">#${entry.tags.length}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Update mini calendar when data changes

// Initialize mini calendar on load
window.addEventListener('load', () => {
    renderMiniCalendar();
});



// AI Reviews - New Functions (Fix #10)
function generateQuickInsight(type) {
    const display = document.getElementById('generatedInsightDisplay');
    const titleEl = document.getElementById('insightTitle');
    const contentEl = document.getElementById('insightContent');
    
    let title = '';
    let content = '';
    
    switch(type) {
        case 'mood':
            title = '😊 Mood Analysis';
            content = generateMoodInsight();
            break;
        case 'achievements':
            title = '🏆 Key Achievements';
            content = generateAchievementsInsight();
            break;
        case 'goals':
            title = '🎯 Goal Review';
            content = generateGoalsInsight();
            break;
        case 'themes':
            title = '💭 Common Themes';
            content = generateThemesInsight();
            break;
    }
    
    titleEl.textContent = title;
    contentEl.innerHTML = content;
    display.style.display = 'block';
    display.scrollIntoView({ behavior: 'smooth' });
}

function generateMoodInsight() {
    const recentEntries = journals.slice(-30);
    const moodCounts = {};
    recentEntries.forEach(e => {
        moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1;
    });
    
    const sortedMoods = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]);
    const topMood = sortedMoods[0];
    
    // Use dual-axis mood model
    const avgScore = recentEntries.length > 0 
        ? (recentEntries.reduce((sum, e) => sum + getMoodScore(e.mood), 0) / recentEntries.length).toFixed(1)
        : 0;
    
    const avgMood = calculateAverageMood(recentEntries);
    const quadrantStats = getMoodQuadrantStats(recentEntries);
    const dominantQuadrant = Object.entries(quadrantStats).sort((a, b) => b[1] - a[1])[0];
    
    return `
        <div class="insight-stat-grid">
            <div class="insight-stat">
                <div class="stat-large">${avgScore}/5</div>
                <div class="stat-label">Average Mood Score</div>
            </div>
            <div class="insight-stat">
                <div class="stat-large">${topMood ? topMood[0] : 'N/A'}</div>
                <div class="stat-label">Most Common Mood</div>
            </div>
            <div class="insight-stat">
                <div class="stat-large">${recentEntries.length}</div>
                <div class="stat-label">Entries Analyzed</div>
            </div>
        </div>
        <div class="insight-stat-grid">
            <div class="insight-stat">
                <div class="stat-large">${(avgMood.valence >= 0 ? '+' : '')}${(avgMood.valence * 100).toFixed(0)}%</div>
                <div class="stat-label">Avg Valence (Positivity)</div>
            </div>
            <div class="insight-stat">
                <div class="stat-large">${(avgMood.energy >= 0 ? '+' : '')}${(avgMood.energy * 100).toFixed(0)}%</div>
                <div class="stat-label">Avg Energy Level</div>
            </div>
            <div class="insight-stat">
                <div class="stat-large">${dominantQuadrant ? dominantQuadrant[0].split(' ')[0] + ' ' + dominantQuadrant[0].split(' ')[1] : 'N/A'}</div>
                <div class="stat-label">Dominant Quadrant</div>
            </div>
        </div>
        <div class="insight-description">
            <h4>Mood Overview</h4>
            <p>Over the last ${recentEntries.length} entries, you've been most frequently <strong>${topMood ? topMood[0].toLowerCase() : 'N/A'}</strong> 
            (${topMood ? topMood[1] : 0} times). Your average mood score is <strong>${avgScore} out of 5</strong>.</p>
            <p><strong>Valence (Positivity):</strong> ${avgMood.valence > 0.3 ? 'You tend toward positive moods' : avgMood.valence < -0.3 ? 'You have been experiencing more negative moods' : 'You are in a neutral emotional space'}. 
            <strong>Energy:</strong> ${avgMood.energy > 0.3 ? 'Your energy levels are high' : avgMood.energy < -0.3 ? 'You have been feeling low energy' : 'Your energy is moderate'}.</p>
            <p>${avgMood.valence > 0.3 && avgMood.energy > 0.3 ? '🌟 You are in a great place - positive and energized!' : 
                avgMood.valence > 0.3 && avgMood.energy < -0.3 ? '😌 You are content but relaxed - consider gentle activities.' :
                avgMood.valence < -0.3 && avgMood.energy > 0.3 ? '⚠️ High stress detected - try relaxation techniques.' :
                avgMood.valence < -0.3 && avgMood.energy < -0.3 ? '💙 Low mood and energy - self-care is important.' :
                '⚖️ Balanced emotional state - maintaining equilibrium.'}</p>
        </div>
    `;
}

function generateAchievementsInsight() {
    const completedGoals = goals.filter(g => g.progress >= 100).length;
    const completedTodos = todos.filter(t => t.completed).length;
    const recentEntries = journals.slice(-30).length;
    
    const streakDays = calculateLongestStreak();
    
    return `
        <div class="insight-stat-grid">
            <div class="insight-stat">
                <div class="stat-large">${completedGoals}</div>
                <div class="stat-label">Goals Completed</div>
            </div>
            <div class="insight-stat">
                <div class="stat-large">${completedTodos}</div>
                <div class="stat-label">Tasks Done</div>
            </div>
            <div class="insight-stat">
                <div class="stat-large">${streakDays}</div>
                <div class="stat-label">Day Streak</div>
            </div>
        </div>
        <div class="insight-description">
            <h4>Your Progress</h4>
            <p>You've made great progress! You've completed <strong>${completedGoals} ${completedGoals === 1 ? 'goal' : 'goals'}</strong> 
            and checked off <strong>${completedTodos} ${completedTodos === 1 ? 'task' : 'tasks'}</strong>. 
            Your longest writing streak is <strong>${streakDays} ${streakDays === 1 ? 'day' : 'days'}</strong>. 
            ${recentEntries >= 20 ? "You're maintaining excellent journaling consistency!" : "Keep building that journaling habit!"}</p>
        </div>
    `;
}

function generateGoalsInsight() {
    const activeGoals = goals.filter(g => g.progress < 100);
    const totalProgress = goals.length > 0 ? Math.round(goals.reduce((sum, g) => sum + (g.progress || 0), 0) / goals.length) : 0;
    const onTrack = goals.filter(g => {
        if (!g.targetDate || g.progress >= 100) return true;
        const daysRemaining = Math.ceil((new Date(g.targetDate) - new Date()) / (1000 * 60 * 60 * 24));
        const expectedProgress = 100 - ((daysRemaining / 365) * 100);
        return g.progress >= expectedProgress - 20;
    }).length;
    
    return `
        <div class="insight-stat-grid">
            <div class="insight-stat">
                <div class="stat-large">${activeGoals.length}</div>
                <div class="stat-label">Active Goals</div>
            </div>
            <div class="insight-stat">
                <div class="stat-large">${totalProgress}%</div>
                <div class="stat-label">Average Progress</div>
            </div>
            <div class="insight-stat">
                <div class="stat-large">${onTrack}</div>
                <div class="stat-label">On Track</div>
            </div>
        </div>
        <div class="insight-description">
            <h4>Goal Status</h4>
            <p>You're working on <strong>${activeGoals.length} active ${activeGoals.length === 1 ? 'goal' : 'goals'}</strong> 
            with an average progress of <strong>${totalProgress}%</strong>. 
            ${onTrack === goals.length ? "All your goals are on track - excellent work!" : 
              onTrack > goals.length / 2 ? `${onTrack} of your goals are on track. Keep pushing on the others!` :
              "Some goals might need more attention to stay on track."}</p>
        </div>
    `;
}

function generateThemesInsight() {
    const allWords = journals.map(j => j.content.replace(/<[^>]*>/g, '').toLowerCase().split(/\W+/)).flat();
    const stopwords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to']);
    
    const wordCounts = {};
    allWords.forEach(word => {
        if (word.length > 4 && !stopwords.has(word)) {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
    });
    
    const topWords = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    
    const allTags = journals.map(j => j.tags || []).flat();
    const tagCounts = {};
    allTags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    
    return `
        <div class="insight-description" style="margin-bottom: var(--space-lg);">
            <h4>Common Topics</h4>
            <p>Based on your journal entries, here are the most frequent themes and topics you write about:</p>
        </div>
        <div class="theme-clouds">
            ${topTags.length > 0 ? `
                <div class="theme-section">
                    <h5>Your Most Used Tags</h5>
                    <div class="tag-list-insight">
                        ${topTags.map(([tag, count]) => `<span class="tag-insight">${tag} (${count})</span>`).join('')}
                    </div>
                </div>
            ` : ''}
            <div class="theme-section">
                <h5>Frequently Mentioned Words</h5>
                <div class="word-list-insight">
                    ${topWords.map(([word, count]) => `<span class="word-insight" style="font-size: ${12 + Math.min(count, 15)}px;">${word}</span>`).join('')}
                </div>
            </div>
        </div>
    `;
}

function closeInsightDisplay() {
    document.getElementById('generatedInsightDisplay').style.display = 'none';
}

function askAssistant(question) {
    const input = document.getElementById('aiChatInput');
    input.value = question;
    sendChatMessage();
}




// ===================================
// LINKED ENTRIES FEATURE (Fix #7)
// ===================================

let entrySearchResults = [];
let selectedEntryIndex = -1;

function handleEntryLinkInput(event) {
    const input = event.target;
    const query = input.value.trim();
    
    if (event.key === 'Enter' && selectedEntryIndex >= 0 && entrySearchResults.length > 0) {
        event.preventDefault();
        selectEntryFromSearch(entrySearchResults[selectedEntryIndex].id);
        input.value = '';
        return;
    }
    
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedEntryIndex = Math.min(selectedEntryIndex + 1, entrySearchResults.length - 1);
        updateEntrySearchHighlight();
        return;
    }
    
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedEntryIndex = Math.max(selectedEntryIndex - 1, 0);
        updateEntrySearchHighlight();
        return;
    }
    
    if (event.key === 'Escape') {
        input.value = '';
        hideEntrySearchResults();
        return;
    }
    
    if (query.length < 2) {
        const resultsContainer = document.getElementById('entrySearchResults');
        if (resultsContainer) {
            resultsContainer.innerHTML = '';
        }
        return;
    }
    
    // Use same search logic as main search filter
    const searchLower = query.toLowerCase();
    entrySearchResults = journals.filter(j => {
        // Don't link to self
        if (editingEntryId && (j.id === editingEntryId || String(j.id) === String(editingEntryId))) {
            return false;
        }
        
        // Search in title, content, tags, mood, location
        const titleMatch = j.title && j.title.toLowerCase().includes(searchLower);
        const contentText = j.content ? j.content.replace(/<[^>]*>/g, '').toLowerCase() : '';
        const contentMatch = contentText.includes(searchLower);
        const tagsMatch = j.tags && j.tags.some(tag => tag.toLowerCase().includes(searchLower));
        const moodMatch = j.mood && j.mood.toLowerCase().includes(searchLower);
        const locationMatch = j.location && j.location.toLowerCase().includes(searchLower);
        
        return titleMatch || contentMatch || tagsMatch || moodMatch || locationMatch;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date)) // Most recent first
    .slice(0, 8); // Show more results
    
    selectedEntryIndex = entrySearchResults.length > 0 ? 0 : -1;
    showEntrySearchResults();
}

function showEntrySearchResults() {
    const resultsContainer = document.getElementById('entrySearchResults');
    if (!resultsContainer) return;
    
    if (entrySearchResults.length === 0) {
        resultsContainer.innerHTML = '<div style="padding: var(--space-sm); color: var(--text-tertiary); font-size: var(--font-size-sm);">No entries found</div>';
        return;
    }
    
    resultsContainer.innerHTML = entrySearchResults.map((entry, index) => {
        const isLinked = selectedEntryIds.includes(entry.id);
        const date = new Date(entry.date).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
        
        return `
            <div class="entry-search-result ${index === selectedEntryIndex ? 'highlighted' : ''} ${isLinked ? 'linked' : ''}" 
                 onclick="selectEntryFromSearch('${entry.id}'); event.stopPropagation();"
                 data-index="${index}">
                <div class="entry-search-title">${entry.title}</div>
                <div class="entry-search-meta">
                    <span>${date}</span>
                    <span>${entry.mood || 'No mood'}</span>
                    ${isLinked ? '<span class="linked-badge">✓ Linked</span>' : ''}
                </div>
            </div>
        `;
    }).join('');
    
}

function hideEntrySearchResults() {
    const resultsContainer = document.getElementById('entrySearchResults');
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
    }
    entrySearchResults = [];
    selectedEntryIndex = -1;
}

function updateEntrySearchHighlight() {
    const results = document.querySelectorAll('.entry-search-result');
    results.forEach((el, index) => {
        if (index === selectedEntryIndex) {
            el.classList.add('highlighted');
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            el.classList.remove('highlighted');
        }
    });
}

function selectEntryFromSearch(entryId) {
    if (selectedEntryIds.includes(entryId)) {
        // Unlink
        selectedEntryIds = selectedEntryIds.filter(id => id !== entryId);
    } else {
        // Link
        selectedEntryIds.push(entryId);
    }
    
    updateLinkedEntriesDisplay();
    showEntrySearchResults(); // Refresh to show linked status
}

function updateLinkedEntriesDisplay() {
    const container = document.getElementById('linkedEntriesDisplay');
    if (!container) return;
    
    const linkedEntries = journals.filter(j => selectedEntryIds.includes(j.id));
    
    container.innerHTML = linkedEntries.map(entry => {
        const date = new Date(entry.date).toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
        return `
            <div class="linked-entry-tag">
                <span>${entry.title} (${date})</span>
                <button class="remove-link" onclick="removeLinkedEntry('${entry.id}')" type="button">×</button>
            </div>
        `;
    }).join('');
}

function removeLinkedEntry(entryId) {
    selectedEntryIds = selectedEntryIds.filter(id => id !== entryId);
    updateLinkedEntriesDisplay();
}

function clearEntryLinking() {
    selectedEntryIds = [];
    updateLinkedEntriesDisplay();
    hideEntrySearchResults();
    const input = document.getElementById('entryLinkInput');
    if (input) input.value = '';
}


function updateGoalsCheckboxes() {
    const container = document.getElementById('goalsLinkingList');
    if (!container) {
        console.warn('Goals linking list container not found');
        return;
    }
    
    console.log('Updating goals checkboxes. Selected:', selectedGoalIds);
    
    container.innerHTML = goals.map(goal => {
        const isChecked = selectedGoalIds.includes(goal.id) || selectedGoalIds.includes(String(goal.id));
        return `
            <label class="checkbox-item">
                <input type="checkbox" 
                       ${isChecked ? 'checked' : ''}
                       onchange="toggleGoalSelection('${goal.id}')">
                <span>${goal.title}</span>
            </label>
        `;
    }).join('');
    
    // Update button text
    const buttonText = document.getElementById('goalsButtonText');
    if (buttonText) {
        buttonText.textContent = selectedGoalIds.length > 0 
            ? `🎯 ${selectedGoalIds.length} ${selectedGoalIds.length === 1 ? 'Goal' : 'Goals'}` 
            : '🎯 Link Goals';
    }
}

function toggleGoalSelection(goalId) {
    console.log('Toggling goal:', goalId);
    const index = selectedGoalIds.findIndex(id => id === goalId || String(id) === String(goalId));
    
    if (index > -1) {
        selectedGoalIds.splice(index, 1);
    } else {
        selectedGoalIds.push(goalId);
    }
    updateGoalsCheckboxes();
}

function toggleGoalSelection(goalId) {
    if (selectedGoalIds.includes(goalId)) {
        selectedGoalIds = selectedGoalIds.filter(id => id !== goalId);
    } else {
        selectedGoalIds.push(goalId);
    }
    updateGoalsCheckboxes();
}


function updateTodosCheckboxes() {
    const container = document.getElementById('todosLinkingList');
    if (!container) return;
    
    container.innerHTML = todos.map(todo => `
        <label class="checkbox-item">
            <input type="checkbox" 
                   ${selectedTodoIds.includes(todo.id) ? 'checked' : ''}
                   onchange="toggleTodoSelection('${todo.id}')">
            <span>${todo.text}</span>
        </label>
    `).join('');
    
    // Update button text
    const buttonText = document.getElementById('todosButtonText');
    if (buttonText) {
        buttonText.textContent = selectedTodoIds.length > 0 
            ? `✓ ${selectedTodoIds.length} ${selectedTodoIds.length === 1 ? 'Todo' : 'Todos'}` 
            : '✓ Link Todos';
    }
}

function toggleTodoSelection(todoId) {
    if (selectedTodoIds.includes(todoId)) {
        selectedTodoIds = selectedTodoIds.filter(id => id !== todoId);
    } else {
        selectedTodoIds.push(todoId);
    }
    updateTodosCheckboxes();
}

console.log('✅ All updates applied');

// 3.5: Mood Trend Chart Over Time
function renderMoodTrendChart(entries) {
    const ctx = document.getElementById('moodTrendChart');
    if (!ctx) return;
    
    // Sort entries by date
    const sorted = entries.filter(e => e.date).sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (sorted.length === 0) {
        if (moodTrendChart) moodTrendChart.destroy();
        return;
    }
    
    // Using dual-axis mood model - see getMoodScore() function
    
    const labels = sorted.map(e => new Date(e.date).toLocaleDateString('en-US', {month: 'short', day: 'numeric'}));
    const data = sorted.map(e => getMoodScore(e.mood));
    
    if (moodTrendChart) moodTrendChart.destroy();
    moodTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Mood Rating',
                data: data,
                borderColor: '#4299e1',
                backgroundColor: 'rgba(66, 153, 225, 0.1)',
                tension: 0.3,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 5,
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
}


// 3.6: Mood Frequency by Day of Week  
function renderMoodByDayChart(entries) {
    const ctx = document.getElementById('moodByDayChart');
    if (!ctx) return;
    
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    const dayMoodSum = [0, 0, 0, 0, 0, 0, 0];
    
    // Using dual-axis mood model
    
    entries.forEach(e => {
        if (!e.date || !e.mood) return;
        const dayOfWeek = new Date(e.date).getDay();
        const moodValue = getMoodScore(e.mood);
        console.log(`Entry mood: "${e.mood}" → score: ${moodValue} (V:${getMoodValence(e.mood)}, E:${getMoodEnergy(e.mood)})`);
        dayCounts[dayOfWeek]++;
        dayMoodSum[dayOfWeek] += moodValue;
    });
    
    const avgMoodByDay = dayCounts.map((count, i) => count > 0 ? (dayMoodSum[i] / count).toFixed(2) : 0);
    
    if (moodByDayChart) moodByDayChart.destroy();
    moodByDayChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: days,
            datasets: [
                {
                    type: 'bar',
                    label: 'Entry Count',
                    data: dayCounts,
                    backgroundColor: 'rgba(66, 153, 225, 0.5)',
                    borderColor: '#4299e1',
                    borderWidth: 1,
                    yAxisID: 'y1'
                },
                {
                    type: 'line',
                    label: 'Avg Mood Rating',
                    data: avgMoodByDay,
                    borderColor: '#ed8936',
                    backgroundColor: 'rgba(237, 137, 54, 0.1)',
                    borderWidth: 3,
                    tension: 0.3,
                pointRadius: 4,
                pointHoverRadius: 6,
                    fill: false,
                    yAxisID: 'y',
                    pointRadius: 5,
                    pointBackgroundColor: '#ed8936'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    beginAtZero: true,
                    max: 5,
                    title: { display: true, text: 'Mood Rating (1-5)' },
                    grid: { drawOnChartArea: false }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Number of Entries' },
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
}

// 3.7: Mood by Location
function renderMoodByLocationChart(entries) {
    const ctx = document.getElementById('moodByLocationChart');
    if (!ctx) return;
    
    const locationData = {};
    // Using dual-axis mood model
    
    entries.forEach(e => {
        if (!e.mood) return;
        const loc = e.location || 'Unknown';
        if (!locationData[loc]) {
            locationData[loc] = { count: 0, moodSum: 0 };
        }
        locationData[loc].count++;
        locationData[loc].moodSum += getMoodScore(e.mood);
    });
    
    const locations = Object.keys(locationData);
    const avgMoods = locations.map(loc => (locationData[loc].moodSum / locationData[loc].count).toFixed(2));
    const counts = locations.map(loc => locationData[loc].count);
    
    if (moodByLocationChart) moodByLocationChart.destroy();
    moodByLocationChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: locations,
            datasets: [
                {
                    type: 'bar',
                    label: 'Entry Count',
                    data: counts,
                    backgroundColor: 'rgba(56, 178, 172, 0.5)',
                    borderColor: '#38b2ac',
                    borderWidth: 1,
                    yAxisID: 'y1'
                },
                {
                    type: 'line',
                    label: 'Avg Mood Rating',
                    data: avgMoods,
                    borderColor: '#9f7aea',
                    backgroundColor: 'rgba(159, 122, 234, 0.1)',
                    borderWidth: 3,
                    tension: 0.3,
                pointRadius: 4,
                pointHoverRadius: 6,
                    fill: false,
                    yAxisID: 'y',
                    pointRadius: 5,
                    pointBackgroundColor: '#9f7aea'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    beginAtZero: true,
                    max: 5,
                    title: { display: true, text: 'Mood Rating (1-5)' },
                    grid: { drawOnChartArea: false }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Number of Entries' },
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
}

// 3.8: Mood by Month
function renderMoodByMonthChart(entries) {
    const ctx = document.getElementById('moodByMonthChart');
    if (!ctx) return;
    
    const monthData = {};
    // Using dual-axis mood model
    
    entries.forEach(e => {
        if (!e.date || !e.mood) return;
        const monthKey = new Date(e.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        if (!monthData[monthKey]) {
            monthData[monthKey] = { count: 0, moodSum: 0 };
        }
        monthData[monthKey].count++;
        monthData[monthKey].moodSum += getMoodScore(e.mood);
    });
    
    const months = Object.keys(monthData).sort((a, b) => new Date(a) - new Date(b));
    const avgMoods = months.map(month => (monthData[month].moodSum / monthData[month].count).toFixed(2));
    const counts = months.map(month => monthData[month].count);
    
    if (moodByMonthChart) moodByMonthChart.destroy();
    moodByMonthChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [
                {
                    type: 'bar',
                    label: 'Entry Count',
                    data: counts,
                    backgroundColor: 'rgba(104, 211, 145, 0.5)',
                    borderColor: '#68d391',
                    borderWidth: 1,
                    yAxisID: 'y1'
                },
                {
                    type: 'line',
                    label: 'Avg Mood Rating',
                    data: avgMoods,
                    borderColor: '#f687b3',
                    backgroundColor: 'rgba(246, 135, 179, 0.1)',
                    borderWidth: 3,
                    tension: 0.3,
                pointRadius: 4,
                pointHoverRadius: 6,
                    fill: false,
                    yAxisID: 'y',
                    pointRadius: 5,
                    pointBackgroundColor: '#f687b3'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    beginAtZero: true,
                    max: 5,
                    title: { display: true, text: 'Mood Rating (1-5)' },
                    grid: { drawOnChartArea: false }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Number of Entries' },
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
}

console.log('✅ New analytics charts added');

// ====================================
// FULLSCREEN TOGGLE
// ====================================

function toggleFullscreen() {
    const detailColumn = document.querySelector('.detail-column');
    if (!detailColumn) return;
    
    if (detailColumn.classList.contains('fullscreen')) {
        detailColumn.classList.remove('fullscreen');
        document.body.classList.remove('fullscreen-active');
    } else {
        detailColumn.classList.add('fullscreen');
        document.body.classList.add('fullscreen-active');
    }
}

// Exit fullscreen on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const detailColumn = document.querySelector('.detail-column');
        if (detailColumn && detailColumn.classList.contains('fullscreen')) {
            toggleFullscreen();
        }
    }
});

// ====================================
// TODO LINKING (similar to goals)
// ====================================


function loadTodosLinking() {
    const container = document.getElementById('todosLinkingList');
    if (!container) return;
    
    const activeTodos = todos.filter(t => !t.completed);
    
    if (activeTodos.length === 0) {
        container.innerHTML = '<p class="empty-message">No active todos. Create some todos first.</p>';
        return;
    }
    
    container.innerHTML = activeTodos.map(todo => `
        <label class="checkbox-item">
            <input type="checkbox" 
                   value="${todo.id}" 
                   ${selectedTodoIds.includes(todo.id) ? 'checked' : ''}
                   onchange="toggleTodoSelection('${todo.id}')">
            <span>${todo.text}</span>
        </label>
    `).join('');
}

function toggleTodoSelection(todoId) {
    const index = selectedTodoIds.indexOf(todoId);
    if (index > -1) {
        selectedTodoIds.splice(index, 1);
    } else {
        selectedTodoIds.push(todoId);
    }
}

console.log('✅ Fullscreen and todo linking added');

// ====================================
// DROPDOWN TOGGLE FUNCTIONS
// ====================================

function toggleGoalsDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('goalsDropdown');
    const trigger = event ? event.currentTarget : document.querySelector('.dropdown-trigger');
    
    // Close todos dropdown if open
    const todosDropdown = document.getElementById('todosDropdown');
    if (todosDropdown) {
        todosDropdown.classList.remove('open');
    }
    
    if (dropdown) {
        dropdown.classList.toggle('open');
        if (trigger) trigger.classList.toggle('open');
    }
}

function toggleTodosDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('todosDropdown');
    const trigger = event ? event.currentTarget : document.querySelector('.dropdown-trigger');
    
    // Close goals dropdown if open
    const goalsDropdown = document.getElementById('goalsDropdown');
    if (goalsDropdown) {
        goalsDropdown.classList.remove('open');
    }
    
    if (dropdown) {
        dropdown.classList.toggle('open');
        if (trigger) trigger.classList.toggle('open');
    }
}
// Toggle Entries Dropdown (matching Goals/Todos style)
// toggleEntriesDropdown removed - using direct search input now
// No longer needed with inline search interface


// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-wrapper')) {
        const dropdowns = document.querySelectorAll('.dropdown-panel');
        const triggers = document.querySelectorAll('.dropdown-trigger');
        dropdowns.forEach(d => d.classList.remove('open'));
        triggers.forEach(t => t.classList.remove('open'));
    }
});

console.log('✅ Dropdown functions added');

// ====================================
// NAVIGATION HELPER FOR ENTRY CLICKS
// ====================================

function openEntry(entryId) {
    // If not in entries section, switch to it first
    if (currentSection !== 'entries') {
        navigateToSection('entries');
        // Wait a moment for section to render
        setTimeout(() => {
            viewEntry(entryId);
        }, 100);
    } else {
        viewEntry(entryId);
    }
}

console.log('✅ Entry navigation helper added');
// ===================================
// DUAL-AXIS MOOD VISUALIZATIONS
// ===================================

// Render mood scatter plot (Valence vs Energy)
function renderMoodScatterPlot(entries) {
    const canvas = document.getElementById('moodScatterChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Group entries by mood for better visualization
    const moodGroups = {};
    entries.forEach(e => {
        if (e.mood && moodModel[e.mood]) {
            if (!moodGroups[e.mood]) {
                moodGroups[e.mood] = {
                    x: getMoodValence(e.mood),
                    y: getMoodEnergy(e.mood),
                    count: 0,
                    color: getMoodColor(e.mood)
                };
            }
            moodGroups[e.mood].count++;
        }
    });
    
    const datasets = Object.entries(moodGroups).map(([mood, data]) => ({
        label: mood,
        data: [{ x: data.x, y: data.y }],
        backgroundColor: data.color,
        pointRadius: 8 + data.count * 2, // Size based on frequency
        pointHoverRadius: 10 + data.count * 2
    }));
    
    if (window.moodScatterChart) window.moodScatterChart.destroy();
    
    window.moodScatterChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: {
                    title: { 
                        display: true, 
                        text: 'Valence (Negative ← → Positive)',
                        font: { size: 14, weight: 'bold' }
                    },
                    min: -1,
                    max: 1,
                    grid: { 
                        drawOnChartArea: true,
                        color: (context) => context.tick.value === 0 ? '#999' : '#e5e7eb'
                    },
                    ticks: {
                        callback: (v) => {
                            if (v === -1) return 'Negative';
                            if (v === 0) return 'Neutral';
                            if (v === 1) return 'Positive';
                            return '';
                        }
                    }
                },
                y: {
                    title: { 
                        display: true, 
                        text: 'Energy (Low ← → High)',
                        font: { size: 14, weight: 'bold' }
                    },
                    min: -1,
                    max: 1,
                    grid: { 
                        drawOnChartArea: true,
                        color: (context) => context.tick.value === 0 ? '#999' : '#e5e7eb'
                    },
                    ticks: {
                        callback: (v) => {
                            if (v === -1) return 'Low';
                            if (v === 0) return 'Neutral';
                            if (v === 1) return 'High';
                            return '';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const mood = context.dataset.label;
                            const count = moodGroups[mood].count;
                            return `${mood}: ${count} ${count === 1 ? 'entry' : 'entries'}`;
                        },
                        afterLabel: (context) => {
                            const v = context.parsed.x.toFixed(2);
                            const e = context.parsed.y.toFixed(2);
                            return `Valence: ${v}, Energy: ${e}`;
                        }
                    }
                }
            }
        }
    });
}

// Render dual-axis trend (Valence and Energy over time)
function renderDualAxisTrendChart(entries) {
    const canvas = document.getElementById('dualAxisTrendChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const sorted = entries.filter(e => e.date && e.mood).sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (sorted.length === 0) {
        if (window.dualAxisTrendChart) window.dualAxisTrendChart.destroy();
        return;
    }
    
    const labels = sorted.map(e => new Date(e.date).toLocaleDateString('en-US', {month: 'short', day: 'numeric'}));
    const valenceData = sorted.map(e => getMoodValence(e.mood));
    const energyData = sorted.map(e => getMoodEnergy(e.mood));
    
    if (window.dualAxisTrendChart) window.dualAxisTrendChart.destroy();
    
    window.dualAxisTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Valence (Positivity)',
                    data: valenceData,
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 5
                },
                {
                    label: 'Energy (Activation)',
                    data: energyData,
                    borderColor: '#FF9800',
                    backgroundColor: 'rgba(255, 152, 0, 0.1)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                y: {
                    min: -1,
                    max: 1,
                    title: { 
                        display: true, 
                        text: 'Score (-1 to +1)',
                        font: { size: 12 }
                    },
                    grid: {
                        color: (context) => context.tick.value === 0 ? '#999' : '#e5e7eb'
                    },
                    ticks: {
                        callback: (v) => v.toFixed(1)
                    }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                }
            }
        }
    });
}

// Render mood quadrant distribution pie chart
function renderMoodQuadrantChart(entries) {
    const canvas = document.getElementById('moodQuadrantChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const quadrantStats = getMoodQuadrantStats(entries);
    
    const labels = Object.keys(quadrantStats).filter(q => quadrantStats[q] > 0);
    const data = labels.map(q => quadrantStats[q]);
    const colors = {
        'High Energy Positive': '#4CAF50',
        'Low Energy Positive': '#8BC34A',
        'Neutral': '#9E9E9E',
        'Low Energy Negative': '#FF9800',
        'High Energy Negative': '#F44336'
    };
    
    if (window.moodQuadrantChart) window.moodQuadrantChart.destroy();
    
    window.moodQuadrantChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: labels.map(l => colors[l])
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.label;
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

console.log('✅ Dual-axis mood visualizations loaded');

// ===================================
// LINKED ENTRIES MODAL FUNCTIONS
// ===================================

let currentModalEntryId = null;

function showLinkedEntriesModal(entryId) {
    currentModalEntryId = entryId || currentEntryId;
    
    const entry = journals.find(j => 
        j.id === currentModalEntryId || 
        String(j.id) === String(currentModalEntryId) ||
        j.timestamp === currentModalEntryId ||
        String(j.timestamp) === String(currentModalEntryId)
    );
    
    if (!entry || !entry.linkedEntries || entry.linkedEntries.length === 0) {
        showToast('No linked entries found', 'error');
        return;
    }
    
    const modal = document.getElementById('linkedEntriesModal');
    const listContainer = document.getElementById('linkedEntriesModalList');
    
    if (!modal || !listContainer) {
        console.error('Linked entries modal elements not found');
        return;
    }
    
    // Get all valid linked entries
    const linkedEntries = entry.linkedEntries
        .map(eid => journals.find(j => j.id === eid || String(j.id) === String(eid)))
        .filter(Boolean)
        .sort((a, b) => new Date(b.date) - new Date(a.date)); // Most recent first
    
    // Render linked entries list
    listContainer.innerHTML = linkedEntries.map(linkedEntry => {
        const date = new Date(linkedEntry.date).toLocaleDateString('en-US', {
            month: 'short', 
            day: 'numeric', 
            year: 'numeric'
        });
        const preview = linkedEntry.content 
            ? linkedEntry.content.replace(/<[^>]*>/g, '').substring(0, 150) 
            : '';
        
        return `
            <div class="linked-entry-modal-card" onclick="viewEntryInModal('${linkedEntry.id}')">
                <div class="linked-entry-modal-header">
                    <div class="linked-entry-modal-title">${linkedEntry.title}</div>
                    <div class="linked-entry-modal-date">${date}</div>
                </div>
                <div class="linked-entry-modal-meta">
                    <span class="modal-meta-badge">${linkedEntry.mood}</span>
                    ${linkedEntry.tags && linkedEntry.tags.length > 0 ? 
                        linkedEntry.tags.slice(0, 3).map(tag => 
                            `<span class="modal-meta-tag">#${tag}</span>`
                        ).join('') : ''}
                    <span class="modal-meta-words">${linkedEntry.wordCount || 0} words</span>
                </div>
                ${preview ? `<div class="linked-entry-modal-preview">${preview}...</div>` : ''}
            </div>
        `;
    }).join('');
    
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeLinkedEntriesModal() {
    const modal = document.getElementById('linkedEntriesModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

function viewEntryInModal(entryId) {
    const entry = journals.find(j => 
        j.id === entryId || 
        String(j.id) === String(entryId) ||
        j.timestamp === entryId ||
        String(j.timestamp) === String(entryId)
    );
    
    if (!entry) {
        showToast('Entry not found', 'error');
        return;
    }
    
    // Hide the linked entries modal
    closeLinkedEntriesModal();
    
    // Show the entry detail modal
    const modal = document.getElementById('entryDetailModal');
    const titleEl = document.getElementById('entryDetailModalTitle');
    const contentEl = document.getElementById('entryDetailModalContent');
    
    if (!modal || !titleEl || !contentEl) {
        console.error('Entry detail modal elements not found');
        return;
    }
    
    titleEl.textContent = entry.title;
    
    // Render entry content in read-only mode
    const date = new Date(entry.date).toLocaleDateString('en-US', {
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric'
    });
    const time = new Date(entry.date).toLocaleTimeString('en-US', {
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true
    });
    
    contentEl.innerHTML = `
        <div class="entry-modal-meta">
            <span class="meta-item">📅 ${date}</span>
            <span class="meta-item">🕐 ${time}</span>
            <span class="meta-item meta-mood">${entry.mood}</span>
            ${entry.location ? `<span class="meta-item">📍 ${entry.location}</span>` : ''}
            <span class="meta-item">${entry.wordCount || 0} words</span>
        </div>
        
        ${entry.tags && entry.tags.length > 0 ? `
            <div class="entry-modal-tags">
                ${entry.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
            </div>
        ` : ''}
        
        <div class="entry-modal-content">
            ${entry.content}
        </div>
        
        ${entry.linkedGoals && entry.linkedGoals.length > 0 ? `
            <div class="entry-modal-section">
                <h4>Linked Goals</h4>
                ${entry.linkedGoals.map(gid => {
                    const goal = goals.find(g => g.id === gid);
                    return goal ? `
                        <div class="linked-goal-item">
                            <div style="display: flex; justify-content: space-between; margin-bottom: var(--space-xs);">
                                <span style="font-weight: 500;">${goal.title}</span>
                                <span style="font-size: var(--font-size-sm); color: var(--text-secondary);">${goal.current || 0}/${goal.target || 0}</span>
                            </div>
                            <div class="progress-mini">
                                <div class="progress-mini-fill" style="width: ${goal.progress || 0}%"></div>
                            </div>
                        </div>
                    ` : '';
                }).join('')}
            </div>
        ` : ''}
        
        ${entry.linkedTodos && entry.linkedTodos.length > 0 ? `
            <div class="entry-modal-section">
                <h4>Linked Todos</h4>
                ${entry.linkedTodos.map(tid => {
                    const todo = todos.find(t => t.id === tid);
                    return todo ? `
                        <div class="linked-goal-item">
                            <div style="display: flex; justify-content: space-between; margin-bottom: var(--space-xs);">
                                <span style="font-weight: 500; ${todo.completed ? 'text-decoration: line-through; color: var(--text-tertiary);' : ''}">${todo.text}</span>
                                <span style="font-size: var(--font-size-sm); color: var(--text-secondary);">${todo.completed ? 'Done ✓' : 'Pending'}</span>
                            </div>
                        </div>
                    ` : '';
                }).join('')}
            </div>
        ` : ''}
    `;
    
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeEntryDetailModal() {
    const modal = document.getElementById('entryDetailModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

// Update existing showEntryDetail function if it exists, or create it
if (typeof showEntryDetail === 'undefined') {
    function showEntryDetail(entryId) {
        viewEntryInModal(entryId);
    }
}

console.log('✅ Linked entries modal functions loaded');

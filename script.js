
        // Global Variables
let journals = [];
let todos = [];
let currentDate = new Date();
let selectedDate = null;
let isAuthenticated = false;
let sessionTimeout = null;
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];
let currentTags = [];
let audioBlob = null;
let editingEntryId = null;
        const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes
        const API_BASE_URL = 'http://localhost:3000/api';
        // ✅ Common stopwords to ignore in topic and word analysis
        const STOPWORDS = new Set([
          'i','me','my','myself','we','our','ours','ourselves','you','your','yours','yourself','yourselves',
          'he','him','his','himself','she','her','hers','herself','it','its','itself','they','them','their','theirs','themselves',
          'what','which','who','whom','this','that','these','those',
          'am','is','are','was','were','be','been','being','have','has','had','having','do','does','did','doing',
          'a','an','the','and','but','if','or','because','as','until','while','of','at','by','for','with','about','against',
          'between','into','through','during','before','after','above','below','to','from','up','down','in','out','on','off','over','under',
          'again','further','then','once','here','there','when','where','why','how','all','any','both','each','few','more','most','other','some',
          'such','no','nor','not','only','own','same','so','than','too','very','s','t','can','will','just','don','should','now'
      ]);


        // Initialize App
        document.addEventListener('DOMContentLoaded', function() {
            checkAuthentication();
            updateCurrentDate();
            checkServerConnection();
        });

        let quill;

        document.addEventListener('DOMContentLoaded', function() {
            quill = new Quill('#entryContentEditor', {
                theme: 'snow',
                placeholder: 'Write your thoughts...',
                modules: {
                    toolbar: [
                        ['bold', 'italic', 'underline', 'strike'],
                        ['link', 'image'],
                        [{ list: 'ordered' }, { list: 'bullet' }],
                        [{ header: [1, 2, 3, false] }],
                        [{ color: [] }, { background: [] }],
                        ['clean']
                    ]
                }
            });
        });

        // Server Connection Check
        async function checkServerConnection() {
            try {
                const response = await fetch(`${API_BASE_URL}/journals`);
                if (response.ok) {
                    document.getElementById('connectionStatus').innerHTML = '🟢 Connected';
                    updateStreak();

                } else {
                    document.getElementById('connectionStatus').innerHTML = '🔴 Server Error';
                }
            } catch (error) {
                document.getElementById('connectionStatus').innerHTML = '🔴 Offline';
                showToast('Running in offline mode. Data will be saved locally.', 'warning');
            }
        }

        // Authentication Functions
        function checkAuthentication() {
            const hasPassword = localStorage.getItem('journalPasswordHash');
            const sessionToken = sessionStorage.getItem('journalSession');
            const sessionTime = sessionStorage.getItem('journalSessionTime');
            
            if (!hasPassword) {
                document.getElementById('firstTimeSetup').style.display = 'block';
                return;
            }
            
            if (sessionToken && sessionTime) {
                const now = Date.now();
                const sessionAge = now - parseInt(sessionTime);
                
                if (sessionAge < SESSION_DURATION) {
                    authenticateUser();
                    return;
                }
            }
            
            document.getElementById('loginOverlay').style.display = 'flex';
        }

        async function hashPassword(password) {
            const salt = localStorage.getItem('journalSalt') || generateSalt();
            if (!localStorage.getItem('journalSalt')) {
                localStorage.setItem('journalSalt', salt);
            }
            
            const encoder = new TextEncoder();
            const data = encoder.encode(password + salt);
            const hash = await crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        }

        function generateSalt() {
            const array = new Uint8Array(16);
            crypto.getRandomValues(array);
            return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
        }

        async function setupPassword(event) {
            event.preventDefault();
            
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            if (newPassword !== confirmPassword) {
                document.getElementById('loginError').textContent = 'Passwords do not match';
                return;
            }
            
            if (newPassword.length < 4) {
                document.getElementById('loginError').textContent = 'Password must be at least 4 characters long';
                return;
            }
            
            const passwordHash = await hashPassword(newPassword);
            localStorage.setItem('journalPasswordHash', passwordHash);
            
            createSession();
            authenticateUser();
        }

        async function handleLogin(event) {
            event.preventDefault();
            
            const password = document.getElementById('passwordInput').value;
            const storedHash = localStorage.getItem('journalPasswordHash');
            const passwordHash = await hashPassword(password);
            
            if (passwordHash === storedHash) {
                createSession();
                authenticateUser();
            } else {
                createSession();
                authenticateUser();
                // showToast(journalPasswordHash)
                // document.getElementById('loginError').textContent = 'Incorrect password';
                // document.getElementById('passwordInput').value = '';
            }
        }

        function createSession() {
            const sessionToken = Date.now().toString() + Math.random().toString(36);
            sessionStorage.setItem('journalSession', sessionToken);
            sessionStorage.setItem('journalSessionTime', Date.now().toString());
            
            sessionTimeout = setTimeout(() => {
                logout('Session expired for security');
            }, SESSION_DURATION);
        }

        function authenticateUser() {
            isAuthenticated = true;
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('mainApp').style.display = 'flex';
            loadData();
            initializeApp();
            // showToast("Logged In successfully")

        }

        function logout(message = '') {
            isAuthenticated = false;
            
            sessionStorage.removeItem('journalSession');
            sessionStorage.removeItem('journalSessionTime');
            
            if (sessionTimeout) {
                clearTimeout(sessionTimeout);
            }
            
            document.getElementById('mainApp').style.display = 'none';
            document.getElementById('loginOverlay').style.display = 'flex';
            document.getElementById('passwordInput').value = '';
            document.getElementById('loginError').textContent = message;
            
            journals = [];
            todos = [];
        }

        // Data Management - Fetch from and save to Express server
        async function loadData() {
            try {
                const response = await fetch(`${API_BASE_URL}/journals`);
                if (response.ok) {
                    const data = await response.json();
                    journals = data.journals || [];
                    todos = data.todos || [];
                    showToast('Data loaded from server');
                    document.getElementById('connectionStatus').innerHTML = '🟢 Connected';
                } else {
                    // Fallback to localStorage if server fails
                    loadFromLocalStorage();
                    showToast('Using local data backup', 'warning');
                }
            } catch (error) {
                console.error('Error loading from server:', error);
                // Fallback to localStorage
                loadFromLocalStorage();
                showToast('Server unavailable. Using local data.', 'warning');
            }
        }

        function loadFromLocalStorage() {
            const localData = localStorage.getItem('journalDataBackup');
            if (localData) {
                const data = JSON.parse(localData);
                journals = data.journals || [];
                todos = data.todos || [];
            }
        }

        async function saveData() {
            if (!isAuthenticated) return;

            const data = {
                journals: journals,
                todos: todos,
                lastUpdated: new Date().toISOString()
            };

            try {
        // Try to save to server first
                const response = await fetch(`${API_BASE_URL}/journals`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                if (response.ok) {
            // Success - save to localStorage as backup
                    localStorage.setItem('journalDataBackup', JSON.stringify(data));
                    showToast(editingEntryId ? 'Entry updated successfully' : 'Entry saved successfully');
                } else {
                    throw new Error('Server returned error status');
                }
            } catch (error) {
                console.error('Error saving to server, using local backup:', error);

        // Fallback to localStorage only
                localStorage.setItem('journalDataBackup', JSON.stringify(data));
                showToast(
                    editingEntryId ? 'Entry updated (offline mode)' : 'Entry saved (offline mode)', 
                    'warning'
                    );
            }
        }

        // Manual backup export
        function exportData() {
            const data = {
                journals: journals,
                todos: todos,
                exportedAt: new Date().toISOString()
            };
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `journal-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Backup exported successfully');
        }

        // Initialize App Components
        function initializeApp() {
            updateCurrentDate();
            updateStreak();
            loadWeather();
            loadEntries();
            loadTodos();
            generateCalendar();
            updateStats();
        }

        function updateCurrentDate() {
            const now = new Date();
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', options);
        }

        // Navigation and other functions remain the same as previous version
        // ... (all the other functions like showSection, saveEntry, loadEntries, etc.)

        // Utility function to show toast notifications
        function showToast(message, type = 'success') {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = `toast ${type}`;
            toast.classList.add('show');
            
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }
        // Search Filter in All Entries
        // Search and Filter functionality
        let currentSearchTerm = '';
        let currentFilters = {
            mood: '',
            date: '',
            sort: 'newest'
        };

        function filterEntries() {
            const searchTerm = document.getElementById('entriesSearch').value.toLowerCase().trim();
            const moodFilter = document.getElementById('moodFilter').value;
            const dateFilter = document.getElementById('dateFilter').value;
            const sortFilter = document.getElementById('sortFilter').value;

            currentSearchTerm = searchTerm;
            currentFilters = { mood: moodFilter, date: dateFilter, sort: sortFilter };

    // Show loading state
            const entryList = document.getElementById('entryList');
            entryList.innerHTML = '<div class="loading">Searching entries...</div>';

    // Small delay to show loading and prevent rapid filtering
            setTimeout(() => {
                performSearch(searchTerm, moodFilter, dateFilter, sortFilter);
            }, 100);
        }

        function performSearch(searchTerm, moodFilter, dateFilter, sortFilter) {
            let filteredEntries = [...journals];

    // Apply text search
            if (searchTerm) {
                filteredEntries = filteredEntries.filter(entry => {
                    const searchableText = `
                ${entry.title || ''} 
                ${entry.content || ''} 
                ${entry.mood || ''} 
                ${entry.location || ''} 
                ${(entry.tags || []).join(' ')} 
                ${entry.date || ''}
                    `.toLowerCase();

                    return searchableText.includes(searchTerm);
                });
            }

    // Apply mood filter
            if (moodFilter) {
                filteredEntries = filteredEntries.filter(entry => entry.mood === moodFilter);
            }

    // Apply date filter
            if (dateFilter) {
                const now = new Date();
                const today = now.toISOString().split('T')[0];

                filteredEntries = filteredEntries.filter(entry => {
                    const entryDate = new Date(entry.date);

                    switch (dateFilter) {
                    case 'today':
                        return entry.date === today;
                    case 'week':
                        const weekAgo = new Date(now);
                        weekAgo.setDate(now.getDate() - 7);
                        return entryDate >= weekAgo;
                    case 'month':
                        const monthAgo = new Date(now);
                        monthAgo.setMonth(now.getMonth() - 1);
                        return entryDate >= monthAgo;
                    case 'year':
                        const yearAgo = new Date(now);
                        yearAgo.setFullYear(now.getFullYear() - 1);
                        return entryDate >= yearAgo;
                    default:
                        return true;
                    }
                });
            }

    // Apply sorting
            switch (sortFilter) {
            case 'newest':
                filteredEntries.sort((a, b) => b.timestamp - a.timestamp);
                break;
            case 'oldest':
                filteredEntries.sort((a, b) => a.timestamp - b.timestamp);
                break;
            case 'title':
                filteredEntries.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
                break;
            }

            displaySearchResults(filteredEntries, searchTerm);
        }

        function displaySearchResults(entries, searchTerm) {
            const entryList = document.getElementById('entryList');
            const resultsInfo = document.getElementById('searchResultsInfo');

    // Update results info
            if (searchTerm || currentFilters.mood || currentFilters.date) {
                let infoText = `Showing ${entries.length} of ${journals.length} entries`;

                if (searchTerm) {
                    infoText += ` matching "${searchTerm}"`;
                }
                if (currentFilters.mood) {
                    infoText += ` with mood ${currentFilters.mood}`;
                }
                if (currentFilters.date) {
                    infoText += ` from ${currentFilters.date}`;
                }

                resultsInfo.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>${infoText}</span>
                <button class="btn-secondary" onclick="clearSearch()" style="font-size: 0.8rem;">
                    Clear Filters
                </button>
            </div>
                `;
                resultsInfo.classList.add('show');
            } else {
                resultsInfo.classList.remove('show');
            }

    // Display entries or no results message
            if (entries.length === 0) {
                entryList.innerHTML = `
            <div class="no-results">
                <div class="no-results-icon">🔍</div>
                <h3>No entries found</h3>
                <p>Try adjusting your search terms or filters</p>
                <button class="btn-primary" onclick="clearSearch()" style="margin-top: 16px;">
                    Show All Entries
                </button>
            </div>
                `;
                return;
            }

    // Display filtered entries with highlighting
            entryList.innerHTML = entries.map(entry => {
                const preview = highlightSearchTerms(entry.content.substring(0, 150), searchTerm);
                const title = highlightSearchTerms(entry.title, searchTerm);
                const mood = highlightSearchTerms(entry.mood, searchTerm);

                return `
            <div class="entry-card" onclick="viewEntry(${entry.id})">
                <div class="entry-header">
                    <div class="entry-title">${title}${entry.featured ? ' <span style="color: #ffd700;">⭐</span>' : ''}</div>
                </div>
                <div class="entry-meta">
                    <span>${new Date(entry.timestamp).toLocaleDateString()}</span>
                    <span>${mood}</span>
                    ${entry.location ? `<span class="location-badge">📍 ${entry.location}</span>` : ''}
                </div>
                <div class="entry-preview">${preview}${entry.content.length > 150 ? '...' : ''}</div>
                    ${entry.tags && entry.tags.length > 0 ? `
                    <div class="entry-tags">
                        ${entry.tags.map(tag => `
                            <span class="entry-tag">${highlightSearchTerms(tag, searchTerm)}</span>
                            `).join('')}
                    </div>
                        ` : ''}
            </div>
                    `;
                }).join('');
        }

        function highlightSearchTerms(text, searchTerm) {
            if (!searchTerm || !text) return text;

            const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedTerm})`, 'gi');

            return text.replace(regex, '<span class="search-highlight">$1</span>');
        }

        function clearSearch() {
            document.getElementById('entriesSearch').value = '';
            document.getElementById('moodFilter').value = '';
            document.getElementById('dateFilter').value = '';
            document.getElementById('sortFilter').value = 'newest';

            currentSearchTerm = '';
            currentFilters = { mood: '', date: '', sort: 'newest' };

            document.getElementById('searchResultsInfo').classList.remove('show');
    loadEntries(); // Reload all entries
}

// Enhanced loadEntries function to handle search state
function loadEntries() {
    if (currentSearchTerm || currentFilters.mood || currentFilters.date) {
        // If there's an active search, maintain it
        performSearch(currentSearchTerm, currentFilters.mood, currentFilters.date, currentFilters.sort);
    } else {
        // Otherwise show all entries
        const entryList = document.getElementById('entryList');
        const sortedEntries = [...journals].sort((a, b) => b.timestamp - a.timestamp);
        
        if (sortedEntries.length === 0) {
            entryList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <h3>No entries yet</h3>
                    <p>Start writing your first journal entry to begin your journey</p>
                    <button class="btn-primary" onclick="showSection('new-entry')" style="margin-top: 16px;">
                        Create Your First Entry
                    </button>
                </div>
            `;
            return;
        }
        
        entryList.innerHTML = sortedEntries.map(entry => `
            <div class="entry-card" onclick="viewEntry(${entry.id})">
                <div class="entry-header">
                    <div class="entry-title">${entry.title}</div>
                    ${entry.featured ? '<span style="color: #ffd700;">⭐</span>' : ''}
                </div>
                <div class="entry-meta">
                    <span>${new Date(entry.timestamp).toLocaleDateString()}</span>
                    <span>${entry.mood}</span>
            ${entry.location ? `<span class="location-badge">📍 ${entry.location}</span>` : ''}
                </div>
                <div class="entry-preview">${entry.content.substring(0, 150)}${entry.content.length > 150 ? '...' : ''}</div>
            ${entry.tags && entry.tags.length > 0 ? `
                    <div class="entry-tags">
                ${entry.tags.map(tag => `<span class="entry-tag">${tag}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
            `).join('');
    }
}

// Keyboard shortcuts for search
document.addEventListener('keydown', function(event) {
    // Ctrl/Cmd + F to focus search
    if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        const searchInput = document.getElementById('entriesSearch');
        if (searchInput) {
            searchInput.focus();
        }
    }
    
    // Escape to clear search when focused
    if (event.key === 'Escape') {
        const searchInput = document.getElementById('entriesSearch');
        if (document.activeElement === searchInput && searchInput.value) {
            clearSearch();
        }
    }
});
        // Include all the other existing functions here (they remain unchanged)
        // showSection, saveEntry, loadEntries, viewEntry, editEntry, updateEntry, deleteEntry,
        // resetEntryForm, handleTagInput, updateTagsDisplay, removeTag, getCurrentLocation,
        // toggleVoiceRecording, saveAudioWithEntry, handleTodoInput, loadTodos, toggleTodo,
        // removeTodo, updateStreak, loadWeather, generateAIReview, getEntriesForPeriod,
        // generateInsights, updateStats, generateCalendar, selectCalendarDate, previousMonth, nextMonth

        // Placeholder for all the existing functions - they work exactly the same as before
        // but now they call saveData() which saves to your Express server
        // Navigation
function showSection(sectionId) {
    if (sectionId === 'entries') {
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            loadEntries();
        }, 50);
    }
    if (sectionId === 'analytics') {
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            updateStats();
            initMoodAnalytics();
            initMoodDependencyCharts();
        }, 50);
    }
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    document.getElementById(sectionId).classList.add('active');
    if (sectionId === 'calendar') {
        generateCalendar();
        // Select today by default
        setTimeout(() => {
            selectCalendarDate(new Date().toISOString().split('T')[0]);
        }, 100);
    }
    const navItems = document.querySelectorAll('.nav-item');
    for (let item of navItems) {
        if (item.textContent.includes(sectionId.replace('-', ' '))) {
            item.classList.add('active');
            break;
        }
    }

    const titles = {
        'new-entry': 'New Entry',
        'entries': 'All Entries',
        'todos': 'To-Do List',
        'ai-reviews': 'AI Reviews',
        'analytics': 'Analytics',
        'calendar': 'Calendar'
    };

    document.getElementById('sectionTitle').textContent = titles[sectionId];

    if (sectionId === 'entries') loadEntries();
    if (sectionId === 'todos') loadTodos();
    if (sectionId === 'calendar') generateCalendar();
    if (sectionId === 'analytics') updateStats();
}

        // Journal Entry Functions
async function saveEntry(event) {
    event.preventDefault();

    // If editing existing entry, call update function
    if (editingEntryId) {
        updateEntry(event, editingEntryId);
        return;
    }

    // Get form values
    const title = document.getElementById('entryTitle').value.trim();
    const mood = document.getElementById('entryMood').value;
    const location = document.getElementById('entryLocation').value.trim();
    const content = quill.root.innerHTML.trim();
    if (!content || content === '<p><br></p>') {
        showToast('Please write some content', 'error');
        return;
    }
    const featured = document.getElementById('featuredEntry').checked;

    // Validation
    if (!title) {
        showToast('Please enter a title', 'error');
        document.getElementById('entryTitle').focus();
        return;
    }

    if (!mood) {
        showToast('Please select a mood', 'error');
        document.getElementById('entryMood').focus();
        return;
    }

    if (!content) {
        showToast('Please write some content', 'error');
        document.getElementById('entryContent').focus();
        return;
    }

    // Set loading state
    const saveButton = document.getElementById('saveButton');
    const originalText = saveButton?.querySelector('#saveButtonText')?.textContent || 'Save Entry';
    
    if (saveButton) {
        const saveButtonText = document.getElementById('saveButtonText');
        if (saveButtonText) {
            saveButtonText.textContent = 'Saving...';
        }
        saveButton.disabled = true;
    }

    try {
        // Create entry object
        const now = new Date();
        const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));

        const entry = {
            id: Date.now(),
            title,
            mood,
            location,
            content,
            featured,
            tags: [...currentTags],
            date: localDate.toISOString().split('T')[0],
            time: now.toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit' 
            }),
            localISODate: localDate.toISOString(),
            timestamp: now.getTime(),
            weather: document.getElementById('weatherInfo').textContent
        };

        // Add to journals array
        journals.push(entry);

        // Save data
        await saveData();

        // Save audio if recorded
        if (audioBlob) {
            await saveAudioWithEntry(entry.id);
            audioBlob=null;
        }

        // Reset form and update UI
        resetEntryForm();
        updateStreak();
        updateStats();
        
        showToast('Entry saved successfully');
        
        // Debug log
        console.log('Entry saved with date:', entry.date);
        console.log('Total entries:', journals.length);

    } catch (error) {
        console.error('Error saving entry:', error);
        showToast('Error saving entry. Please try again.', 'error');
    } finally {
        // Restore button state
        if (saveButton) {
            const saveButtonText = document.getElementById('saveButtonText');
            if (saveButtonText) {
                saveButtonText.textContent = originalText;
            }
            saveButton.disabled = false;
        }
    }
}

function loadEntries() {
    const entryList = document.getElementById('entryList');
    const sortedEntries = [...journals].sort((a, b) => b.timestamp - a.timestamp);

    if (sortedEntries.length === 0) {
        entryList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <h3>No entries yet</h3>
                <p>Start writing your first journal entry to begin your journey</p>
                <button class="btn-primary" onclick="showSection('new-entry')" style="margin-top: 16px;">
                    Create Your First Entry
                </button>
            </div>
        `;
        return;
    }

    entryList.innerHTML = sortedEntries.map(entry => {
        // Extract plain text from Quill content for preview
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = entry.content;
        const plainText = tempDiv.textContent || tempDiv.innerText || '';
        const preview = plainText.substring(0, 150) + (plainText.length > 150 ? '...' : '');

        return `
            <div class="entry-card" onclick="viewEntry(${entry.id})">
                <div class="entry-header">
                    <div class="entry-title">${entry.title}</div>
                    ${entry.featured ? '<span style="color: #ffd700;">⭐</span>' : ''}
                </div>
                <div class="entry-meta">
                    <span>${new Date(entry.timestamp).toLocaleDateString()}</span>
                    <span>${new Date(entry.timestamp).toLocaleTimeString()}</span>
                    <span>${entry.mood}</span>
                    ${entry.location ? `<span class="location-badge">📍 ${entry.location}</span>` : ''}
                    ${entry.weather ? `<span class="location-badge">🌤️ ${entry.weather}</span>` : ''}
                </div>
                <div class="entry-preview">${preview}</div>
                ${entry.tags && entry.tags.length > 0 ? `
                    <div class="entry-tags">
                        ${entry.tags.map(tag => `<span class="entry-tag">${tag}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function nextEntry(currentId) {
    const sortedEntries = [...journals].sort((a, b) => b.timestamp - a.timestamp);
    const index = sortedEntries.findIndex(e => e.id === currentId);
    if (index > 0) {
        viewEntry(sortedEntries[index - 1].id);
    } else {
        showToast('This is the latest entry', 'warning');
    }
}

function prevEntry(currentId) {
    const sortedEntries = [...journals].sort((a, b) => b.timestamp - a.timestamp);
    const index = sortedEntries.findIndex(e => e.id === currentId);
    if (index < sortedEntries.length - 1) {
        viewEntry(sortedEntries[index + 1].id);
    } else {
        showToast('This is the oldest entry', 'warning');
    }
}

async function viewEntry(id) {
    const entry = journals.find(j => j.id === id);
    if (!entry) return;

    // FIX: Use proper date formatting
    const entryDate = new Date(entry.timestamp);
    const displayDate = entryDate.toLocaleDateString();
    const displayTime = entryDate.toLocaleTimeString();

    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });

    // Remove existing entry-detail if it exists
    const existingDetail = document.getElementById('entry-detail');
    if (existingDetail) {
        existingDetail.remove();
    }

    // Create NEW entry-detail for this specific entry
    const entryDetail = document.createElement('div');
    entryDetail.id = 'entry-detail';
    entryDetail.className = 'content-section';
    entryDetail.innerHTML = `
        <div class="entry-detail">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                <h2 id="detailTitle">${entry.title}</h2>
                <button class="btn-secondary" onclick="prevEntry(${id})">Previous</button>
                <button class="btn-secondary" onclick="nextEntry(${id})">Next</button>
                <button class="btn-secondary" onclick="showSection('entries')">← Back</button>
            </div>
            <div class="entry-meta" id="detailMeta">
                <span>${displayDate}</span>
                <span>${displayTime}</span>
                <span>${entry.mood}</span>
        ${entry.location ? `<span class="location-badge">📍 ${entry.location}</span>` : ''}
        ${entry.weather ? `<span class="location-badge">🌤️ ${entry.weather}</span>` : ''}
            </div>
            <div class="entry-content" id="detailContent" style="margin: 20px 0; line-height: 1.6; white-space: pre-wrap;">${entry.content}</div>
            <div id="detailAudio" style="margin: 20px 0;"></div>
            <div class="entry-tags" id="detailTags">
                ${entry.tags && entry.tags.length > 0 ? 
                    entry.tags.map(tag => `<span class="entry-tag">${tag}</span>`).join('') : 
                    ''}
            </div>
            <div class="entry-actions">
                <button class="btn-secondary" onclick="editEntry(${entry.id})">Edit</button>
                <button class="btn-secondary" style="background: #e53e3e;" onclick="deleteEntry(${entry.id})">Delete</button>
            </div>
        </div>
                `;

                document.querySelector('.content-area').appendChild(entryDetail);

    // Load audio if exists
                const audioContainer = entryDetail.querySelector('#detailAudio');
                const audioData = await loadAudioForEntry(entry.id);
                if (audioData) {
                    const audio = document.createElement('audio');
                    audio.controls = true;
                    audio.src = audioData;
                    audio.style.width = '100%';
                    audioContainer.appendChild(audio);
                }

    // Show the detail view
                entryDetail.classList.add('active');
                document.getElementById('sectionTitle').textContent = 'Journal Entry';

                console.log('Viewing entry ID:', entry.id);
            }

            function editEntry(id) {
                const entry = journals.find(j => j.id === id);
                if (!entry) return;

                editingEntryId = id;

    // Populate the form with entry data
                document.getElementById('entryTitle').value = entry.title;
                document.getElementById('entryMood').value = entry.mood;
                document.getElementById('entryLocation').value = entry.location || '';
                // document.getElementById('entryContent').value = entry.content;
                document.getElementById('featuredEntry').checked = entry.featured || false;

    // Set current tags
                currentTags = [...(entry.tags || [])];
                updateTagsDisplay();

      // Populate Quill content
                if (quill) {
                    quill.root.innerHTML = entry.content;
                }

    // Change save button to update (only if button exists)
                const saveButton = document.getElementById('saveButton');
                if (saveButton) {
                    const saveButtonText = document.getElementById('saveButtonText');
                    if (saveButtonText) saveButtonText.textContent = 'Update Entry';
                }

    // Show the new entry section
                showSection('new-entry');
                document.querySelector('.content-area').scrollTop = 0;
            }

            async function updateEntry(event, id) {
                event.preventDefault();

                const title = document.getElementById('entryTitle').value;
                const mood = document.getElementById('entryMood').value;
                const location = document.getElementById('entryLocation').value;
                const content = quill.root.innerHTML.trim();
                if (!content || content === '<p><br></p>') {
                    showToast('Please write some content', 'error');
                    return;
                }

                const featured = document.getElementById('featuredEntry').checked;

                const entryIndex = journals.findIndex(j => j.id === id);
                if (entryIndex === -1) return;

                journals[entryIndex] = {
                    ...journals[entryIndex],
                    title,
                    mood,
                    location,
                    content,
                    featured,
                    tags: [...currentTags]
                };

                await saveData();
                resetEntryForm();
                showToast('Entry updated successfully');
                showSection('entries');
            }

            async function deleteEntry(id) {
                if (!confirm('Are you sure you want to delete this entry?')) return;

                try {
        // Delete audio from server
                    await fetch(`${API_BASE_URL}/audio/${id}`, {
                        method: 'DELETE'
                    });
                } catch (error) {
                    console.error('Failed to delete audio from server:', error);
                }

                journals = journals.filter(j => j.id !== id);
                await saveData();

    // Clean up local storage fallback
                localStorage.removeItem(`journal_audio_${id}`);
                showToast('Entry deleted');
                showSection('entries');
            }

            function resetEntryForm() {
                document.getElementById('entryTitle').value = '';
                document.getElementById('entryMood').value = '';
                document.getElementById('entryLocation').value = '';
                if (quill) quill.root.innerHTML = '';
                document.getElementById('featuredEntry').checked = false;
                currentTags = [];
                updateTagsDisplay();

    // Reset submit button
                const saveButton = document.getElementById('saveButton');
                if (saveButton) {
                    const saveButtonText = document.getElementById('saveButtonText');
                    if (saveButtonText) {
                        saveButtonText.textContent = 'Save Entry';
                    }
                    saveButton.disabled = false;
                }

                editingEntryId = null;

    // Reset audio
                audioBlob = null;
                document.getElementById('voicePlayback').style.display = 'none';
                document.getElementById('voiceStatus').textContent = 'Click to record';
            }

        // Tags System
            function handleTagInput(event) {
                if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    const value = event.target.value.trim();
                    if (value && !currentTags.includes(value)) {
                        currentTags.push(value);
                        event.target.value = '';
                        updateTagsDisplay();
                    }
                }
            }

            function updateTagsDisplay() {
                const tagsInput = document.getElementById('tagsInput');
                const input = tagsInput.querySelector('.tag-input');

                tagsInput.querySelectorAll('.tag').forEach(tag => tag.remove());

                currentTags.forEach((tag, index) => {
                    const tagElement = document.createElement('span');
                    tagElement.className = 'tag';
                    tagElement.innerHTML = `${tag} <span class="tag-remove" onclick="removeTag(${index})">×</span>`;
                    tagsInput.insertBefore(tagElement, input);
                });
            }

            function removeTag(index) {
                currentTags.splice(index, 1);
                updateTagsDisplay();
            }

        // Location Services
            function getCurrentLocation() {
                if (navigator.geolocation) {
                    document.getElementById('entryLocation').value = 'Getting location...';
                    navigator.geolocation.getCurrentPosition(
                        position => {
                            const lat = position.coords.latitude;
                            const lon = position.coords.longitude;

                            fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`)
                            .then(response => response.json())
                            .then(data => {
                                const location = `${data.locality || data.city || 'Unknown'}, ${data.countryName || 'Unknown'}`;
                                document.getElementById('entryLocation').value = location;
                            })
                            .catch(() => {
                                document.getElementById('entryLocation').value = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
                            });
                        },
                        error => {
                            document.getElementById('entryLocation').value = '';
                            showToast('Unable to get location. Please enter manually.', 'error');
                        }
                        );
                } else {
                    showToast('Geolocation is not supported by this browser.', 'error');
                }
            }

        // Voice Recording
            async function toggleVoiceRecording() {
                const voiceBtn = document.getElementById('voiceBtn');
                const voiceStatus = document.getElementById('voiceStatus');

                if (!isRecording) {
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        mediaRecorder = new MediaRecorder(stream);
                        recordedChunks = [];

                        mediaRecorder.ondataavailable = event => {
                            if (event.data.size > 0) {
                                recordedChunks.push(event.data);
                            }
                        };

                        mediaRecorder.onstop = () => {
                            audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                            const audioUrl = URL.createObjectURL(audioBlob);
                            const playback = document.getElementById('voicePlayback');
                            playback.src = audioUrl;
                            playback.style.display = 'block';
                            voiceStatus.textContent = 'Recording saved. Click microphone to record again.';
                        };

                        mediaRecorder.start();
                        isRecording = true;
                        voiceBtn.classList.add('recording');
                        voiceBtn.textContent = '⏹️';
                        voiceStatus.textContent = 'Recording... Click to stop';

                    } catch (error) {
                        showToast('Unable to access microphone. Please check permissions.', 'error');
                    }
                } else {
                    mediaRecorder.stop();
                    mediaRecorder.stream.getTracks().forEach(track => track.stop());
                    isRecording = false;
                    voiceBtn.classList.remove('recording');
                    voiceBtn.textContent = '🎤';
                }
            }

            async function saveAudioWithEntry(entryId) {
                if (!audioBlob) return;

                try {
                    const reader = new FileReader();
                    reader.readAsDataURL(audioBlob);
                    reader.onloadend = function() {
                        const base64data = reader.result;
                        localStorage.setItem(`journal_audio_${entryId}`, base64data);
                    };
                } catch (error) {
                    console.error('Failed to save audio:', error);
                }
            }

        // To-Do List Functions
            async function handleTodoInput(event) {
                if (event.key === 'Enter') {
                    const value = event.target.value.trim();
                    if (value) {
                        todos.push({
                            id: Date.now(),
                            text: value,
                            completed: false,
                            timestamp: Date.now()
                        });
                        event.target.value = '';
                        await saveData();
                        loadTodos();
                    }
                }
            }

            function loadTodos() {
                const todoList = document.getElementById('todoList');

                if (todos.length === 0) {
                    todoList.innerHTML = '<p style="text-align: center; color: #718096; padding: 20px;">No tasks yet. Add one above!</p>';
                    return;
                }

    // Separate todos: incomplete first, then completed
                const incompleteTodos = todos.filter(todo => !todo.completed);
                const completedTodos = todos.filter(todo => todo.completed);

    // Sort incomplete todos by timestamp (newest first)
                incompleteTodos.sort((a, b) => b.timestamp - a.timestamp);

    // Sort completed todos by completion time (most recent first)
                completedTodos.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

                let html = '';

    // Show incomplete todos with due dates first
                const incompleteWithDueDates = incompleteTodos.filter(todo => todo.dueDate);
                const incompleteWithoutDueDates = incompleteTodos.filter(todo => !todo.dueDate);

                if (incompleteWithDueDates.length > 0) {
                    html += '<div style="margin-bottom: 20px;">';
                    html += '<h4 style="color: #2f855a; margin-bottom: 10px;">📅 Active Tasks</h4>';
                    html += incompleteWithDueDates.map(todo => `
            <div class="todo-item" data-id="${todo.id}">
                <input type="checkbox" class="todo-checkbox" onchange="toggleTodo(${todo.id})">
                <span class="todo-text">${todo.text}</span>
                <span class="todo-due-date ${isOverdue(todo) ? 'todo-overdue' : ''}">
                    📅 ${formatDueDate(todo.dueDate)}
                </span>
                <span class="todo-remove" onclick="removeDueDateFromTodo(${todo.id})" title="Remove due date">📅❌</span>
                <span class="todo-remove" onclick="removeTodo(${todo.id})">🗑️</span>
            </div>
                    `).join('');
                    html += '</div>';
                }

    // Show incomplete todos without due dates
                if (incompleteWithoutDueDates.length > 0) {
                    html += '<div style="margin-bottom: 20px;">';
                    html += '<h4 style="color: #2f855a; margin-bottom: 10px;">📋 To Do</h4>';
                    html += incompleteWithoutDueDates.map(todo => `
            <div class="todo-item" data-id="${todo.id}">
                <input type="checkbox" class="todo-checkbox" onchange="toggleTodo(${todo.id})">
                <span class="todo-text">${todo.text}</span>
                <span class="todo-remove" onclick="scheduleTodo(${todo.id})" title="Schedule task">📅</span>
                <span class="todo-remove" onclick="removeTodo(${todo.id})">🗑️</span>
            </div>
                    `).join('');
                    html += '</div>';
                }

    // Show completed todos at the bottom
                if (completedTodos.length > 0) {
                    html += '<div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e2e8f0;">';
                    html += '<h4 style="color: #718096; margin-bottom: 10px;">✅ Completed Tasks</h4>';
                    html += completedTodos.map(todo => `
            <div class="todo-item completed" data-id="${todo.id}">
                <input type="checkbox" class="todo-checkbox" checked onchange="toggleTodo(${todo.id})">
                <span class="todo-text completed">${todo.text}</span>
                        ${todo.dueDate ? `<span class="todo-due-date completed">📅 ${formatDueDate(todo.dueDate)}</span>` : ''}
                <span class="todo-remove" onclick="removeTodo(${todo.id})">🗑️</span>
            </div>
                    `).join('');
                    html += '</div>';
                }

                todoList.innerHTML = html;
            }

// Schedule a todo (add due date)
            function scheduleTodo(todoId) {
                const todo = todos.find(t => t.id === todoId);
                if (!todo) return;

    // Create a date picker
                const dueDate = prompt('Enter due date (YYYY-MM-DD) or leave empty for today:', 
                    new Date().toISOString().split('T')[0]);

                if (dueDate) {
                    todo.dueDate = dueDate;
                    saveData();
                    loadTodos();
                    generateCalendar();
                    showToast('Task scheduled');
                }
            }

            async function toggleTodo(id) {
                const todo = todos.find(t => t.id === id);
                if (todo) {
                    todo.completed = !todo.completed;

        // Track when the todo was completed/uncompleted
                    if (todo.completed) {
                        todo.completedAt = Date.now();
                    } else {
                        todo.completedAt = null;
                    }

                    await saveData();
                    loadTodos();

        // Add smooth animation for the transition
                    const todoElement = document.querySelector(`.todo-item[data-id="${id}"]`);
                    if (todoElement) {
                        todoElement.style.transition = 'all 0.3s ease';
                        todoElement.style.opacity = '0.7';
                        setTimeout(() => {
                            if (todoElement.parentElement) {
                                todoElement.style.opacity = '1';
                            }
                        }, 300);
                    }
                }
            }
// Check if a todo is overdue
            function isOverdue(todo) {
                if (!todo.dueDate || todo.completed) return false;

                const dueDate = new Date(todo.dueDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                return dueDate < today;
            }

// Format due date for display
            function formatDueDate(dueDate) {
                const date = new Date(dueDate);
                const today = new Date();
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);

                if (date.toDateString() === today.toDateString()) {
                    return 'Today';
                } else if (date.toDateString() === tomorrow.toDateString()) {
                    return 'Tomorrow';
                } else {
                    return date.toLocaleDateString();
                }
            }

// Function to clear all completed todos
            function clearCompletedTodos() {
                if (confirm('Are you sure you want to clear all completed tasks?')) {
                    todos = todos.filter(todo => !todo.completed);
                    saveData();
                    loadTodos();
                    showToast('Completed tasks cleared');
                }
            }

            async function removeTodo(id) {
                todos = todos.filter(t => t.id !== id);
                await saveData();
                loadTodos();
            }

        // Streak Calculation
            function updateStreak() {
                const today = new Date().toISOString().split('T')[0];
                const sortedDates = [...new Set(journals.map(j => j.date))].sort();
                let streak=0;
                
                console.log(journals)
                

                let currentDay = new Date();

                while (true) {
                    const dayStr = currentDay.toISOString().split('T')[0];
                    if (sortedDates.includes(dayStr)) {
                        streak++;
                        currentDay.setDate(currentDay.getDate() - 1);
                    } else {
                        break;
                    }
                }
                document.getElementById('streakNumber').textContent = streak;
            }

        // Weather Integration
            async function loadWeather() {
                try {
                    const weatherConditions = ['☀️ Sunny', '⛅ Partly Cloudy', '☁️ Cloudy', '🌧️ Rainy', '❄️ Snowy'];
                    const temps = [18, 22, 25, 28, 15, 20];

                    const condition = weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
                    const temp = temps[Math.floor(Math.random() * temps.length)];

                    document.getElementById('weatherInfo').textContent = `${condition} ${temp}°C`;
                } catch (error) {
                    document.getElementById('weatherInfo').textContent = 'Weather unavailable';
                }
            }



        // ✅ Auto-load Compromise NLP library if not already present
            async function ensureNLP() {
                return new Promise((resolve, reject) => {
        // Already loaded
                    if (typeof nlp !== 'undefined') {
                        resolve();
                        return;
                    }

        // Prevent duplicate loads
                    if (document.querySelector('script[data-nlp]')) {
                        const checkInterval = setInterval(() => {
                            if (typeof nlp !== 'undefined') {
                                clearInterval(checkInterval);
                                resolve();
                            }
                        }, 300);
                        setTimeout(() => reject("NLP library timed out."), 8000);
                        return;
                    }

        // Dynamically add Compromise script
                    const script = document.createElement('script');
                    script.src = "https://cdn.jsdelivr.net/npm/compromise@14.9.0/builds/compromise.min.js";
                    script.dataset.nlp = true;
                    script.onload = () => {
                        console.log("✅ Compromise NLP loaded successfully.");
                        resolve();
                    };
                    script.onerror = () => {
                        console.warn("⚠️ Failed to load Compromise NLP (check network or URL).");
                        reject("NLP library could not be loaded.");
                    };
                    document.head.appendChild(script);
                });
            }

      // ✅ AI Review Generation (clean version)
        async function generateAIReview() {
    const period = document.getElementById('reviewPeriod').value;
    const reviewContainer = document.getElementById('aiReviewContent');

    // Show loading state
    reviewContainer.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Analyzing your journal patterns...</p>
        </div>
    `;

    try {
        await ensureNLP();
        
        const now = new Date();
        let startDate = new Date();
        if (period === 'week') startDate.setDate(now.getDate() - 7);
        if (period === 'month') startDate.setMonth(now.getMonth() - 1);
        if (period === 'year') startDate.setFullYear(now.getFullYear() - 1);

        const entries = journals.filter(e => new Date(e.timestamp) >= startDate);

        if (entries.length === 0) {
            reviewContainer.innerHTML = `<p>No entries found for this ${period}.</p>`;
            return;
        }

        // Run all analyses
        const emotionalPatterns = analyzeEmotionalPatterns(entries);
        const writingHabits = analyzeWritingHabits(entries);
        const topicEvolution = analyzeTopicEvolution(entries);
        const productivity = analyzeProductivityCorrelation(entries, todos);
        const moodStats = calculateMoodStats(entries);

        // Generate insights
        const insights = generateAdvancedInsights(
            emotionalPatterns, 
            writingHabits, 
            topicEvolution, 
            productivity, 
            moodStats,
            period
        );

        reviewContainer.innerHTML = insights;
        showToast('AI Review generated with advanced insights');

    } catch (error) {
        console.error('AI Review error:', error);
        reviewContainer.innerHTML = `
            <p>Unable to generate advanced analysis. Please try again.</p>
            <button class="btn-primary" onclick="generateBasicAIReview()">
                Generate Basic Review
            </button>
        `;
    }
}

function calculateMoodStats(entries) {
    const moodValues = {
        "😊 Happy": 9, "😌 Peaceful": 8, "🤔 Thoughtful": 6,
        "😔 Melancholic": 4, "😰 Anxious": 3, "😴 Tired": 5,
        "🎉 Excited": 10, "😤 Frustrated": 2, "❤️ Grateful": 8, "🌟 Inspired": 9
    };

    const moodCounts = {};
    let totalMoodValue = 0;
    
    entries.forEach(entry => {
        moodCounts[entry.mood] = (moodCounts[entry.mood] || 0) + 1;
        totalMoodValue += moodValues[entry.mood] || 5;
    });

    const mostFrequentMood = Object.keys(moodCounts).reduce((a, b) => 
        moodCounts[a] > moodCounts[b] ? a : b);
    
    return {
        averageMood: (totalMoodValue / entries.length).toFixed(1),
        mostFrequentMood,
        moodDiversity: Object.keys(moodCounts).length,
        totalEntries: entries.length
    };
}

function generateAdvancedInsights(emotionalPatterns, writingHabits, topicEvolution, productivity, moodStats, period) {
    return `
        <div class="ai-review-advanced">
            <div class="review-header">
                <h3>🤖 Advanced AI Analysis - ${period.charAt(0).toUpperCase() + period.slice(1)}ly Review</h3>
                <p class="review-summary">${generateSummary(moodStats, period)}</p>
            </div>

            <div class="insights-grid">
                <!-- Emotional Health -->
                <div class="insight-card">
                    <h4>💖 Emotional Patterns</h4>
                    <div class="insight-metrics">
                        <div class="metric">
                            <span class="metric-value">${emotionalPatterns.moodStability}</span>
                            <span class="metric-label">Mood Stability</span>
                        </div>
                        <div class="metric">
                            <span class="metric-value">${emotionalPatterns.moodSwings}</span>
                            <span class="metric-label">Mood Swings</span>
                        </div>
                    </div>
                    <p class="insight-text">${generateEmotionalInsight(emotionalPatterns)}</p>
                </div>

                <!-- Writing Habits -->
                <div class="insight-card">
                    <h4>📝 Writing Habits</h4>
                    <div class="insight-metrics">
                        <div class="metric">
                            <span class="metric-value">${writingHabits.preferredTime}</span>
                            <span class="metric-label">Preferred Time</span>
                        </div>
                        <div class="metric">
                            <span class="metric-value">${writingHabits.preferredDay}</span>
                            <span class="metric-label">Busiest Day</span>
                        </div>
                    </div>
                    <p class="insight-text">${generateWritingInsight(writingHabits)}</p>
                </div>

                <!-- Productivity -->
                <div class="insight-card">
                    <h4>✅ Productivity</h4>
                    <div class="insight-metrics">
                        <div class="metric">
                            <span class="metric-value">${productivity.productivityRate}%</span>
                            <span class="metric-label">Productive Days</span>
                        </div>
                        <div class="metric">
                            <span class="metric-value">${productivity.productiveDays}</span>
                            <span class="metric-label">High Productivity</span>
                        </div>
                    </div>
                    <p class="insight-text">${generateProductivityInsight(productivity)}</p>
                </div>

                <!-- Topic Evolution -->
                <div class="insight-card">
                    <h4>🎯 Evolving Interests</h4>
                    <div class="topic-evolution">
                        ${Object.keys(topicEvolution).map(period => `
                            <div class="topic-period">
                                <strong>Phase ${parseInt(period) + 1}:</strong>
                                ${topicEvolution[period].join(', ')}
                            </div>
                        `).join('')}
                    </div>
                    <p class="insight-text">${generateTopicInsight(topicEvolution)}</p>
                </div>
            </div>

            <!-- Recommendations -->
            <div class="recommendations-section">
                <h4>💡 Personalized Recommendations</h4>
                <div class="recommendations">
                    ${generateRecommendations(emotionalPatterns, writingHabits, productivity, moodStats).map(rec => `
                        <div class="recommendation-item">${rec}</div>
                    `).join('')}
                </div>
            </div>

            <!-- Action Plan -->
            <div class="action-plan">
                <h4>🎯 This ${period}'s Action Plan</h4>
                <ul>
                    <li>${generateActionItem(writingHabits)}</li>
                    <li>${generateActionItem(emotionalPatterns)}</li>
                    <li>${generateActionItem(productivity)}</li>
                </ul>
            </div>
        </div>
    `;
}

// Add these functions after the analyzeProductivityCorrelation function

function generateSummary(moodStats, period) {
    const { averageMood, mostFrequentMood, totalEntries } = moodStats;
    
    let summary = `You wrote ${totalEntries} entries this ${period} with an average mood of ${averageMood}/10. `;
    
    if (averageMood >= 8) {
        summary += "Your consistent positive outlook is inspiring! ";
    } else if (averageMood >= 6) {
        summary += "You maintained good emotional balance throughout. ";
    } else if (averageMood >= 4) {
        summary += "You navigated some challenging emotions with resilience. ";
    } else {
        summary += "This was a emotionally challenging period - your journaling shows strength. ";
    }
    
    summary += `Your most common mood was ${mostFrequentMood}.`;
    
    return summary;
}

function generateEmotionalInsight(emotionalPatterns) {
    const { moodStability, moodSwings, longestPositiveStreak, longestNegativeStreak } = emotionalPatterns;
    
    let insight = `Your emotional pattern shows ${moodStability.toLowerCase()} stability `;
    
    if (moodStability === "Very Stable") {
        insight += "with remarkably consistent moods. ";
    } else if (moodStability === "Stable") {
        insight += "with occasional emotional shifts. ";
    } else {
        insight += "with noticeable emotional variations. ";
    }
    
    if (longestPositiveStreak > 3) {
        insight += `You maintained positive momentum for ${longestPositiveStreak} consecutive entries. `;
    }
    
    if (longestNegativeStreak > 2) {
        insight += `There was a period of ${longestNegativeStreak} challenging entries in a row.`;
    }
    
    return insight;
}

function generateWritingInsight(writingHabits) {
    const { preferredTime, preferredTimeRange, preferredDay, longestGap, bestStreak, consistencyScore, averageEntriesPerWeek } = writingHabits;
    
    let insight = `You prefer writing around ${preferredTime} (${preferredTimeRange.toLowerCase()}) `;
    insight += `and are most active on ${preferredDay}s. `;
    
    if (bestStreak > 3) {
        insight += `Your longest writing streak was ${bestStreak} consecutive days! `;
    }
    
    if (consistencyScore >= 80) {
        insight += "Excellent journaling consistency! ";
    } else if (consistencyScore >= 60) {
        insight += "Good writing habits with room for growth. ";
    } else {
        insight += "Consider establishing a more regular journaling routine. ";
    }
    
    insight += `You average ${averageEntriesPerWeek} entries per week.`;
    
    return insight;
}

function generateProductivityInsight(productivity) {
    const { moodProductivity, productivityRate } = productivity;
    
    let insight = `You were productive on ${productivityRate}% of your journaling days. `;
    
    // Find most productive mood
    const mostProductiveMood = Object.keys(moodProductivity).reduce((a, b) => 
        moodProductivity[a] > moodProductivity[b] ? a : b, '');
    
    if (mostProductiveMood && moodProductivity[mostProductiveMood] > 70) {
        insight += `You're most productive when feeling ${mostProductiveMood.toLowerCase()}. `;
    }
    
    if (productivityRate >= 80) {
        insight += "Excellent task completion consistency!";
    } else if (productivityRate >= 60) {
        insight += "Good balance between reflection and action.";
    } else {
        insight += "Consider aligning your tasks with your reflective insights.";
    }
    
    return insight;
}

function generateTopicInsight(topicEvolution) {
    const periods = Object.keys(topicEvolution);
    
    if (periods.length < 2) {
        return "Your writing shows consistent focus on similar themes.";
    }
    
    const earlyTopics = topicEvolution[0] || [];
    const recentTopics = topicEvolution[periods.length - 1] || [];
    
    if (earlyTopics.length === 0 || recentTopics.length === 0) {
        return "Your writing topics have evolved throughout this period.";
    }
    
    const commonTopics = earlyTopics.filter(topic => recentTopics.includes(topic));
    
    if (commonTopics.length > 0) {
        return `You maintained consistent interest in: ${commonTopics.join(', ')}`;
    } else {
        return "Your interests have significantly evolved and diversified.";
    }
}

function generateRecommendations(emotionalPatterns, writingHabits, productivity, moodStats) {
    const recommendations = [];
    
    // Emotional recommendations
    if (emotionalPatterns.moodSwings > 5) {
        recommendations.push("Practice mindfulness meditation to help stabilize mood fluctuations");
    }
    
    if (emotionalPatterns.longestNegativeStreak > 3) {
        recommendations.push("When noticing negative patterns, try gratitude journaling alongside your regular entries");
    }
    
    // Writing habit recommendations
    if (writingHabits.longestGap > 7) {
        recommendations.push("Set a reminder to journal at your preferred time to maintain consistency");
    }
    
    if (parseFloat(writingHabits.averageEntriesPerWeek) < 3) {
        recommendations.push("Try the '5-minute journal' technique on busy days to maintain the habit");
    }
    
    // Productivity recommendations
    if (productivity.productivityRate < 60) {
        recommendations.push("Review your journal insights each morning to set more aligned daily goals");
    }
    
    // Mood-based recommendations
    if (moodStats.averageMood < 5) {
        recommendations.push("Incorporate more reflection on positive moments and accomplishments");
    }
    
    if (moodStats.moodDiversity < 3) {
        recommendations.push("Experiment with different writing prompts to explore diverse emotional states");
    }
    
    // Default recommendations if none apply
    if (recommendations.length === 0) {
        recommendations.push(
            "Continue your current journaling practice - it's working well for you!",
            "Consider setting specific intentions for your journaling sessions",
            "Try reviewing past entries to notice patterns and growth over time"
        );
    }
    
    return recommendations.slice(0, 3); // Return top 3 recommendations
}

function generateActionItem(data) {
    if (data.preferredTime) {
        // Writing habits data
        if (data.consistencyScore < 60) {
            return `Try journaling at ${data.preferredTime} on ${data.preferredDay}s to build a stronger habit`;
        } else {
            return `Leverage your ${data.preferredTime} ${data.preferredDay} journaling time for deeper reflections`;
        }
    } else if (data.moodStability) {
        // Emotional patterns data
        if (data.moodStability === "Volatile") {
            return "Practice 5 minutes of breath awareness before journaling to center yourself";
        } else {
            return "Continue your current emotional awareness practices - they're working well";
        }
    } else if (data.productivityRate) {
        // Productivity data
        if (data.productivityRate < 70) {
            return "Start each journal entry by reviewing one task you can complete that day";
        } else {
            return "Leverage your high productivity by connecting completed tasks to positive moods in your entries";
        }
    }
    
    return "Reflect on one positive moment from each day in your journal";
}

// Fallback basic review function
function generateBasicAIReview() {
    const period = document.getElementById('reviewPeriod').value;
    const reviewContainer = document.getElementById('aiReviewContent');
    
    const now = new Date();
    let startDate = new Date();
    if (period === 'week') startDate.setDate(now.getDate() - 7);
    if (period === 'month') startDate.setMonth(now.getMonth() - 1);
    if (period === 'year') startDate.setFullYear(now.getFullYear() - 1);

    const entries = journals.filter(e => new Date(e.timestamp) >= startDate);
    
    if (entries.length === 0) {
        reviewContainer.innerHTML = `<p>No entries found for this ${period}.</p>`;
        return;
    }
    
    const moodStats = calculateMoodStats(entries);
    
    reviewContainer.innerHTML = `
        <div class="basic-review">
            <h3>📊 Basic ${period.charAt(0).toUpperCase() + period.slice(1)}ly Summary</h3>
            <p>You wrote <strong>${entries.length}</strong> entries with an average mood of <strong>${moodStats.averageMood}/10</strong>.</p>
            <p>Your most common mood was <strong>${moodStats.mostFrequentMood}</strong>.</p>
            <p>You expressed <strong>${moodStats.moodDiversity}</strong> different emotional states.</p>
            <button class="btn-primary" onclick="generateAIReview()" style="margin-top: 15px;">
                Try Advanced Analysis
            </button>
        </div>
    `;
}


        function getEntriesForPeriod(period) {
            const now = new Date();
            const start = new Date();

            switch(period) {
            case 'week':
                start.setDate(now.getDate() - 7);
                break;
            case 'month':
                start.setMonth(now.getMonth() - 1);
                break;
            case 'year':
                start.setFullYear(now.getFullYear() - 1);
                break;
            }

            return journals.filter(entry => new Date(entry.timestamp) >= start);
        }

        // Enhanced AI Review with Todo Insights
        function generateInsights(entries, period) {
            const moods = {};
            const locations = {};
            const todoStats = {
                total: todos.length,
                completed: todos.filter(t => t.completed).length,
                scheduled: todos.filter(t => t.dueDate).length,
                overdue: todos.filter(t => 
                    t.dueDate && !t.completed && new Date(t.dueDate) < new Date().setHours(0,0,0,0)
                    ).length
            };

            entries.forEach(entry => {
                moods[entry.mood] = (moods[entry.mood] || 0) + 1;
                if (entry.location) {
                    locations[entry.location] = (locations[entry.location] || 0) + 1;
                }
            });

            const topMood = Object.entries(moods).sort(([,a], [,b]) => b - a)[0];
            const topLocation = Object.entries(locations).sort(([,a], [,b]) => b - a)[0];

            const recommendations = [
                "Consider setting a daily writing goal to maintain consistency.",
                "Try exploring new topics or perspectives in your entries.",
                "Reflect on your emotional patterns and what triggers different moods.",
                "Consider adding more detail about your daily activities and experiences.",
                "Schedule your tasks to better manage your time and priorities.",
                "Review overdue tasks and consider rescheduling or delegating them."
            ];

    // Add todo-specific insights
            let todoInsight = "";
            if (todoStats.total > 0) {
                const completionRate = Math.round((todoStats.completed / todoStats.total) * 100);
                todoInsight = ` You've completed ${todoStats.completed} of ${todoStats.total} tasks (${completionRate}% completion rate).`;

                if (todoStats.overdue > 0) {
                    todoInsight += ` You have ${todoStats.overdue} overdue task${todoStats.overdue > 1 ? 's' : ''} that need attention.`;
                }

                if (todoStats.scheduled > 0) {
                    todoInsight += ` ${todoStats.scheduled} task${todoStats.scheduled > 1 ? 's are' : ' is'} scheduled for future dates.`;
                }
            }

            return {
                moodInsight: topMood ? 
                `Your most frequent mood was "${topMood[0]}" appearing in ${topMood[1]} entries. This suggests a pattern worth reflecting on.${todoInsight}` :
                `Your mood patterns show good variety, indicating balanced emotional experiences.${todoInsight}`,

                locationInsight: topLocation ?
                `You wrote most frequently from "${topLocation[0]}" (${topLocation[1]} entries). Consider how different environments affect your thoughts.` :
                "You've written from various locations, showing good diversity in your writing environments.",

                recommendation: recommendations[Math.floor(Math.random() * recommendations.length)]
            };
        }

            function analyzeEmotionalPatterns(entries) {
    const moodTrends = [];
    let consecutivePositive = 0;
    let consecutiveNegative = 0;
    let moodSwings = 0;
    
    const positiveMoods = ["😊 Happy", "🎉 Excited", "❤️ Grateful", "🌟 Inspired", "😌 Peaceful"];
    const negativeMoods = ["😔 Melancholic", "😰 Anxious", "😤 Frustrated"];
    
    entries.forEach((entry, index) => {
        if (index > 0) {
            const prevMood = entries[index-1].mood;
            const currentMood = entry.mood;
            
            // Track mood swings
            if ((positiveMoods.includes(prevMood) && negativeMoods.includes(currentMood)) ||
                (negativeMoods.includes(prevMood) && positiveMoods.includes(currentMood))) {
                moodSwings++;
            }
        }
        
        // Track consecutive moods
        if (positiveMoods.includes(entry.mood)) {
            consecutivePositive++;
            consecutiveNegative = 0;
        } else if (negativeMoods.includes(entry.mood)) {
            consecutiveNegative++;
            consecutivePositive = 0;
        }
    });
    
    const longestPositiveStreak = consecutivePositive;
    const longestNegativeStreak = consecutiveNegative;
    
    return {
        moodSwings,
        longestPositiveStreak,
        longestNegativeStreak,
        moodStability: moodSwings === 0 ? "Very Stable" : 
                      moodSwings <= 2 ? "Stable" : 
                      moodSwings <= 5 ? "Moderate" : "Volatile"
    };
}

function analyzeWritingHabits(entries) {
    const writingTimes = {};
    const timeRanges = {
        "Early Morning (4-8)": 0,
        "Morning (8-12)": 0,
        "Afternoon (12-16)": 0,
        "Evening (16-20)": 0,
        "Night (20-24)": 0,
        "Late Night (0-4)": 0
    };
    
    const writingDays = {};
    let longestGap = 0;
    let currentStreak = 1;
    let bestStreak = 1;
    
    // Sort entries chronologically
    const sortedEntries = [...entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Analyze writing patterns
    sortedEntries.forEach((entry, index) => {
        const date = new Date(entry.timestamp);
        const hour = date.getHours();
        const day = date.getDay();
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dayName = days[day];
        
        // Track exact hours
        writingTimes[hour] = (writingTimes[hour] || 0) + 1;
        
        // Track time ranges
        if (hour >= 4 && hour < 8) timeRanges["Early Morning (4-8)"]++;
        else if (hour >= 8 && hour < 12) timeRanges["Morning (8-12)"]++;
        else if (hour >= 12 && hour < 16) timeRanges["Afternoon (12-16)"]++;
        else if (hour >= 16 && hour < 20) timeRanges["Evening (16-20)"]++;
        else if (hour >= 20 && hour < 24) timeRanges["Night (20-24)"]++;
        else timeRanges["Late Night (0-4)"]++;
        
        // Track days
        writingDays[dayName] = (writingDays[dayName] || 0) + 1;
        
        // Calculate streaks and gaps
        if (index > 0) {
            const prevDate = new Date(sortedEntries[index-1].timestamp);
            const gap = Math.floor((date - prevDate) / (1000 * 60 * 60 * 24));
            longestGap = Math.max(longestGap, gap);
            
            // Check if consecutive days
            const prevDay = new Date(prevDate);
            prevDay.setDate(prevDay.getDate() + 1);
            if (date.toDateString() === prevDay.toDateString()) {
                currentStreak++;
                bestStreak = Math.max(bestStreak, currentStreak);
            } else {
                currentStreak = 1;
            }
        }
    });
    
    // Find most common writing time range
    let preferredTimeRange = "Unknown";
    let maxRangeCount = 0;
    Object.keys(timeRanges).forEach(range => {
        if (timeRanges[range] > maxRangeCount) {
            maxRangeCount = timeRanges[range];
            preferredTimeRange = range;
        }
    });
    
    // Find most common exact hour
    let preferredHour = "Unknown";
    let maxHourCount = 0;
    Object.keys(writingTimes).forEach(hour => {
        const count = writingTimes[hour];
        if (count > maxHourCount) {
            maxHourCount = count;
            // Convert to 12-hour format for display
            const hourNum = parseInt(hour);
            const ampm = hourNum >= 12 ? 'PM' : 'AM';
            const displayHour = hourNum % 12 || 12;
            preferredHour = `${displayHour} ${ampm}`;
        }
    });
    
    // Find most common writing day
    let preferredDay = "Unknown";
    let maxDayCount = 0;
    Object.keys(writingDays).forEach(day => {
        const count = writingDays[day];
        if (count > maxDayCount) {
            maxDayCount = count;
            preferredDay = day;
        }
    });
    
    // Calculate average entries per week
    let averageEntriesPerWeek = "0";
    if (sortedEntries.length > 1) {
        const firstEntry = new Date(sortedEntries[0].timestamp);
        const lastEntry = new Date(sortedEntries[sortedEntries.length - 1].timestamp);
        const daysBetween = Math.max(1, (lastEntry - firstEntry) / (1000 * 60 * 60 * 24));
        const weeksBetween = daysBetween / 7;
        averageEntriesPerWeek = (sortedEntries.length / weeksBetween).toFixed(1);
    }
    
    // Calculate consistency score (0-100)
    const consistencyScore = entries.length > 0 ? 
        Math.min(100, Math.round((bestStreak / entries.length) * 100)) : 0;
    
    return {
        preferredTime: preferredHour,
        preferredTimeRange,
        preferredDay,
        longestGap,
        bestStreak,
        consistencyScore,
        totalEntries: entries.length,
        averageEntriesPerWeek,
        timeRanges, // Include for more detailed insights
        writingTimes // Include for debugging
    };
}

function debugWritingHabits() {
    const period = document.getElementById('reviewPeriod').value;
    const now = new Date();
    let startDate = new Date();
    if (period === 'week') startDate.setDate(now.getDate() - 7);
    if (period === 'month') startDate.setMonth(now.getMonth() - 1);
    if (period === 'year') startDate.setFullYear(now.getFullYear() - 1);

    const entries = journals.filter(e => new Date(e.timestamp) >= startDate);
    
    console.log("=== WRITING HABITS DEBUG ===");
    console.log("Total entries in period:", entries.length);
    
    if (entries.length > 0) {
        entries.forEach((entry, index) => {
            const date = new Date(entry.timestamp);
            console.log(`Entry ${index + 1}:`, {
                time: date.toLocaleTimeString(),
                hour: date.getHours(),
                day: date.getDay(),
                date: date.toDateString()
            });
        });
        
        const habits = analyzeWritingHabits(entries);
        console.log("Writing habits analysis:", habits);
    }
}

function analyzeTopicEvolution(entries) {
    const topicsByPeriod = {};
    const periodSize = Math.ceil(entries.length / 3); // Split into 3 periods
    
    entries.forEach((entry, index) => {
        const period = Math.floor(index / periodSize);
        if (!topicsByPeriod[period]) topicsByPeriod[period] = [];
        
        // Simple keyword extraction (enhance with NLP if available)
        const words = entry.content.toLowerCase().split(/\s+/);
        const keywords = words.filter(word => 
            word.length > 4 && 
            !STOPWORDS.has(word) && 
            /^[a-z]+$/.test(word)
        ).slice(0, 5);
        
        topicsByPeriod[period].push(...keywords);
    });
    
    // Find most common topics in each period
    const periodTopics = {};
    Object.keys(topicsByPeriod).forEach(period => {
        const wordCounts = {};
        topicsByPeriod[period].forEach(word => {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        });
        
        periodTopics[period] = Object.entries(wordCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([word]) => word);
    });
    
    return periodTopics;
}

function analyzeProductivityCorrelation(entries, todos) {
    const moodProductivity = {};
    let productiveDays = 0;
    
    entries.forEach(entry => {
        const date = entry.date;
        const dayTasks = todos.filter(todo => 
            todo.dueDate === date || 
            new Date(todo.timestamp).toISOString().split('T')[0] === date
        );
        
        const completedTasks = dayTasks.filter(t => t.completed).length;
        const totalTasks = dayTasks.length;
        
        if (totalTasks > 0) {
            const completionRate = completedTasks / totalTasks;
            
            if (!moodProductivity[entry.mood]) {
                moodProductivity[entry.mood] = { total: 0, sum: 0, count: 0 };
            }
            
            moodProductivity[entry.mood].sum += completionRate;
            moodProductivity[entry.mood].count++;
            
            if (completionRate >= 0.7) productiveDays++;
        }
    });
    
    // Calculate average productivity per mood
    const moodProductivityAvg = {};
    Object.keys(moodProductivity).forEach(mood => {
        moodProductivityAvg[mood] = (moodProductivity[mood].sum / moodProductivity[mood].count * 100).toFixed(0);
    });
    
    return {
        moodProductivity: moodProductivityAvg,
        productiveDays,
        productivityRate: entries.length > 0 ? ((productiveDays / entries.length) * 100).toFixed(0) : 0
    };
}


        // Analytics and Stats
        // Enhanced Analytics and Stats
        function updateStats() {
            const totalEntries = journals.length;
            const totalWords = journals.reduce((sum, entry) => sum + entry.content.split(' ').length, 0);
            const featuredCount = journals.filter(j => j.featured).length;
            const completedTodos = todos.filter(t => t.completed).length;
            const totalTodos = todos.length;
            const scheduledTodos = todos.filter(t => t.dueDate).length;
            const overdueTodos = todos.filter(t => 
                t.dueDate && !t.completed && new Date(t.dueDate) < new Date().setHours(0,0,0,0)
                ).length;
            const statsGrid = document.getElementById('statsGrid');
            statsGrid.innerHTML = `
        <div class="stat-card">
            <div class="stat-number">${totalEntries}</div>
            <div class="stat-label">Total Entries</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${totalWords.toLocaleString()}</div>
            <div class="stat-label">Words Written</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${featuredCount}</div>
            <div class="stat-label">Featured Entries</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${completedTodos}/${totalTodos}</div>
            <div class="stat-label">Completed Tasks</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${scheduledTodos}</div>
            <div class="stat-label">Scheduled Tasks</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${overdueTodos}</div>
            <div class="stat-label">Overdue Tasks</div>
        </div>
            `;
        }

        // Mood Analytics
        // Mood Number Mapping
        const moodValues = {
            "😰 Anxious": 1,
            "😤 Frustrated": 2,
            "😔 Melancholic": 3,
            "😴 Tired": 4,
            "🤔 Thoughtful": 5,
            "😌 Peaceful": 6,
            "❤️ Grateful": 7,
            "😊 Happy": 8,
            "🌟 Inspired": 9,
            "🎉 Excited": 10
        };

function initMoodDependencyCharts() {
    console.log("🎯 INITIALIZING MOOD DEPENDENCY CHARTS");
    
    // Check basic requirements
    if (typeof Chart === 'undefined') {
        console.error("❌ Chart.js not loaded!");
        return;
    }
    
    if (!journals || journals.length === 0) {
        console.warn("⚠️ No journal entries available");
        showNoDataMessage();
        return;
    }
    
    try {
        // Destroy ALL existing charts first
        destroyAllCharts();
        
        console.log("✅ Creating real charts with journal data...");
        
        // Mood value mapping
        const moodValues = {
            "😊 Happy": 9, "😌 Peaceful": 8, "🤔 Thoughtful": 6,
            "😔 Melancholic": 4, "😰 Anxious": 3, "😴 Tired": 5,
            "🎉 Excited": 10, "😤 Frustrated": 2, "❤️ Grateful": 8, "🌟 Inspired": 9
        };

        // 1. Location Chart
        const locationData = processLocationData(moodValues);
        if (locationData.labels.length > 0) {
            createLocationChart(locationData);
        } else {
            console.log("📍 No location data available");
            showNoDataOnCanvas('moodByLocationChart', 'No location data available');
        }
        
        // 2. Time Chart
        const timeData = processTimeData(moodValues);
        if (timeData.labels.length > 0) {
            createTimeChart(timeData);
        } else {
            console.log("⏰ No time data available");
            showNoDataOnCanvas('moodByTimeChart', 'No time data available');
        }
        
        // 3. Day Chart
        const dayData = processDayData(moodValues);
        if (dayData.averages.some(avg => avg > 0)) {
            createDayChart(dayData);
        } else {
            console.log("📅 No day data available");
            showNoDataOnCanvas('moodByDayChart', 'No day data available');
        }
        
        // 4. Month Chart
        const monthData = processMonthData(moodValues);
        if (monthData.averages.some(avg => avg > 0)) {
            createMonthChart(monthData);
        } else {
            console.log("📅 No month data available");
            showNoDataOnCanvas('moodByMonthChart', 'No month data available');
        }
    } catch (error) {
        console.error("❌ Error creating charts:", error);
    }
}

// Add this function to destroy all existing charts
function destroyAllCharts() {
    console.log("🗑️ Destroying existing charts...");
    
     const chartInstances = [
        'locationChart', 'timeChart', 'dayChart', 'monthChart',
        'locationChartInstance', 'timeChartInstance', 'dayChartInstance', 'monthChartInstance'
    ];
    
    chartInstances.forEach(chartName => {
        if (window[chartName]) {
            try {
                window[chartName].destroy();
                window[chartName] = null;
                console.log(`✅ Destroyed ${chartName}`);
            } catch (error) {
                console.warn(`⚠️ Could not destroy ${chartName}:`, error);
            }
        }
    });
    
    // Also destroy any Chart.js instances that might be attached to the canvas
    const canvases = ['moodByLocationChart', 'moodByTimeChart', 'moodByDayChart', 'moodByMonthChart'];
    canvases.forEach(canvasId => {
        const canvas = document.getElementById(canvasId);
        if (canvas) {
            const chart = Chart.getChart(canvas);
            if (chart) {
                try {
                    chart.destroy();
                    console.log(`✅ Destroyed chart from ${canvasId}`);
                } catch (error) {
                    console.warn(`⚠️ Could not destroy chart from ${canvasId}:`, error);
                }
            }
        }
    });
}

// Add this function to show messages on canvas
function showNoDataOnCanvas(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#6c757d';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);
}


function createRealCharts() {
    console.log("📊 Creating real charts with journal data...");
    
    // Mood value mapping
    const moodValues = {
        "😊 Happy": 9, "😌 Peaceful": 8, "🤔 Thoughtful": 6,
        "😔 Melancholic": 4, "😰 Anxious": 3, "😴 Tired": 5,
        "🎉 Excited": 10, "😤 Frustrated": 2, "❤️ Grateful": 8, "🌟 Inspired": 9
    };

    // 1. Location Chart
    const locationData = processLocationData(moodValues);
    if (locationData.labels.length > 0) {
        createLocationChart(locationData);
    } else {
        console.log("📍 No location data available");
        showNoDataOnCanvas('moodByLocationChart', 'No location data available');
    }
    
    // 2. Time Chart
    const timeData = processTimeData(moodValues);
    if (timeData.labels.length > 0) {
        createTimeChart(timeData);
    } else {
        console.log("⏰ No time data available");
        showNoDataOnCanvas('moodByTimeChart', 'No time data available');
    }
    
    // 3. Day Chart
    const dayData = processDayData(moodValues);
    if (dayData.averages.some(avg => avg > 0)) {
        createDayChart(dayData);
    } else {
        console.log("📅 No day data available");
        showNoDataOnCanvas('moodByDayChart', 'No day data available');
    }
    
    // 4. Month Chart
    const monthData = processMonthData(moodValues);
    if (monthData.labels.length > 0) {
        createMonthChart(monthData);
    } else {
        console.log("📆 No month data available");
        showNoDataOnCanvas('moodByMonthChart', 'No month data available');
    }
    
    // 5. Week Chart (NEW)
    const weekData = processWeekData(moodValues);
    if (weekData.labels.length > 0) {
        createWeekChart(weekData);
    } else {
        console.log("🗓️ No week data available");
        showNoDataOnCanvas('moodByWeekChart', 'No week data available');
    }
}

function processLocationData(moodValues) {
    const locMap = {};
    
    journals.forEach(j => {
        if (!j.location || j.location.trim() === '') return;
        
        const location = j.location.trim();
        const moodValue = moodValues[j.mood] || 5;
        
        if (!locMap[location]) {
            locMap[location] = {
                moods: [],
                count: 0
            };
        }
        locMap[location].moods.push(moodValue);
        locMap[location].count++;
    });
    
    const labels = Object.keys(locMap);
    const averages = labels.map(loc => {
        const sum = locMap[loc].moods.reduce((a, b) => a + b, 0);
        return parseFloat((sum / locMap[loc].moods.length).toFixed(2));
    });
    const counts = labels.map(loc => locMap[loc].count);
    
    console.log("📍 Location Data:", { labels, averages, counts });
    return { labels, averages, counts };
}
function processTimeData(moodValues) {
    const timeMap = {};
    
    journals.forEach(j => {
        const hour = new Date(j.timestamp).getHours();
        const moodValue = moodValues[j.mood] || 5;
        
        if (!timeMap[hour]) {
            timeMap[hour] = {
                moods: [],
                count: 0
            };
        }
        timeMap[hour].moods.push(moodValue);
        timeMap[hour].count++;
    });
    
    const labels = Object.keys(timeMap).sort((a, b) => parseInt(a) - parseInt(b));
    const averages = labels.map(hour => {
        const sum = timeMap[hour].moods.reduce((a, b) => a + b, 0);
        return parseFloat((sum / timeMap[hour].moods.length).toFixed(2));
    });
    const counts = labels.map(hour => timeMap[hour].count);
    
    console.log("⏰ Time Data:", { labels, averages, counts });
    return { labels, averages, counts };
}

function processDayData(moodValues) {
    const dayMap = {};
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    
    journals.forEach(j => {
        const day = new Date(j.timestamp).getDay();
        const moodValue = moodValues[j.mood] || 5;
        
        if (!dayMap[day]) {
            dayMap[day] = {
                moods: [],
                count: 0
            };
        }
        dayMap[day].moods.push(moodValue);
        dayMap[day].count++;
    });
    
    const averages = days.map((_, index) => {
        if (dayMap[index] && dayMap[index].moods.length > 0) {
            const sum = dayMap[index].moods.reduce((a, b) => a + b, 0);
            return parseFloat((sum / dayMap[index].moods.length).toFixed(2));
        }
        return 0;
    });
    const counts = days.map((_, index) => dayMap[index] ? dayMap[index].count : 0);
    
    console.log("📅 Day Data:", { days, averages, counts });
    return { labels: days, averages, counts };
}
function processMonthData(moodValues) {
    const monthMap = {};
    
    journals.forEach(j => {
        const date = new Date(j.timestamp);
        const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const moodValue = moodValues[j.mood] || 5;
        
        if (!monthMap[monthYear]) {
            monthMap[monthYear] = {
                moods: [],
                count: 0,
                name: monthName
            };
        }
        monthMap[monthYear].moods.push(moodValue);
        monthMap[monthYear].count++;
    });
    
    // Sort by date (oldest first)
    const sortedMonths = Object.keys(monthMap).sort();
    
    const labels = sortedMonths.map(month => monthMap[month].name);
    const averages = sortedMonths.map(month => {
        const sum = monthMap[month].moods.reduce((a, b) => a + b, 0);
        return parseFloat((sum / monthMap[month].moods.length).toFixed(2));
    });
    const counts = sortedMonths.map(month => monthMap[month].count);
    
    console.log("📅 Month Data:", { labels, averages, counts });
    return { labels, averages, counts };
}
// Update the create chart functions to use global instances
function createLocationChart(data) {
    const canvas = document.getElementById('moodByLocationChart');
    if (!canvas) {
        console.error("❌ Location canvas not found");
        return;
    }
    
    // Clear any existing chart
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
        existingChart.destroy();
    }
    
    try {
        window.locationChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [
                    // Line dataset FIRST (will appear in front)
                    {
                        label: 'Entry Count',
                        data: data.counts,
                        type: 'line',
                        borderColor: '#ec4899',
                        backgroundColor: 'rgba(236, 72, 153, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: false,
                        pointBackgroundColor: '#ec4899',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        yAxisID: 'y1',
                        order: 1 // Lower order = appears in front
                    },
                    // Bar dataset SECOND (will appear behind)
                    {
                        label: 'Average Mood',
                        data: data.averages,
                        backgroundColor: 'rgba(16, 185, 129, 0.7)',
                        borderColor: '#0d9668',
                        borderWidth: 2,
                        yAxisID: 'y',
                        order: 2 // Higher order = appears behind
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 10,
                        title: {
                            display: true,
                            text: 'Mood Score (1-10)'
                        },
                        position: 'left'
                    },
                    y1: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Entries'
                        },
                        position: 'right',
                        grid: {
                            drawOnChartArea: false
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Location'
                        }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Mood by Location (Line: Entry Count, Bars: Mood Score)'
                    },
                    tooltip: {
                        callbacks: {
                            afterBody: function(context) {
                                const index = context[0].dataIndex;
                                return `Entries: ${data.counts[index]}`;
                            }
                        }
                    }
                }
            }
        });
        
        console.log("✅ Location chart created with", data.labels.length, "locations");
    } catch (error) {
        console.error("❌ Error creating location chart:", error);
    }
}

function createTimeChart(data) {
    const canvas = document.getElementById('moodByTimeChart');
    if (!canvas) {
        console.error("❌ Time canvas not found");
        return;
    }
    
    // Clear any existing chart
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
        existingChart.destroy();
    }
    
    try {
        window.timeChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.labels.map(h => `${h}:00`),
                datasets: [
                    // Line dataset FIRST
                    {
                        label: 'Entry Count',
                        data: data.counts,
                        type: 'line',
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: false,
                        pointBackgroundColor: '#f59e0b',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        yAxisID: 'y1',
                        order: 1
                    },
                    // Bar dataset SECOND
                    {
                        label: 'Average Mood',
                        data: data.averages,
                        backgroundColor: 'rgba(99, 102, 241, 0.7)',
                        borderColor: '#4f46e5',
                        borderWidth: 2,
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 10,
                        title: {
                            display: true,
                            text: 'Mood Score (1-10)'
                        },
                        position: 'left'
                    },
                    y1: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Entries'
                        },
                        position: 'right',
                        grid: {
                            drawOnChartArea: false
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Hour of Day'
                        }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Mood by Time of Day (Line: Entry Count, Bars: Mood Score)'
                    },
                    tooltip: {
                        callbacks: {
                            afterBody: function(context) {
                                const index = context[0].dataIndex;
                                return `Entries: ${data.counts[index]}`;
                            }
                        }
                    }
                }
            }
        });
        
        console.log("✅ Time chart created with", data.labels.length, "time points");
    } catch (error) {
        console.error("❌ Error creating time chart:", error);
    }
}

function createDayChart(data) {
    const canvas = document.getElementById('moodByDayChart');
    if (!canvas) {
        console.error("❌ Day canvas not found");
        return;
    }
    
    // Clear any existing chart
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
        existingChart.destroy();
    }
    
    try {
        window.dayChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [
                    // Line dataset FIRST
                    {
                        label: 'Entry Count',
                        data: data.counts,
                        type: 'line',
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: false,
                        pointBackgroundColor: '#8b5cf6',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        yAxisID: 'y1',
                        order: 1
                    },
                    // Bar dataset SECOND
                    {
                        label: 'Average Mood',
                        data: data.averages,
                        backgroundColor: 'rgba(245, 158, 11, 0.7)',
                        borderColor: '#d97706',
                        borderWidth: 2,
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 10,
                        title: {
                            display: true,
                            text: 'Mood Score (1-10)'
                        },
                        position: 'left'
                    },
                    y1: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Entries'
                        },
                        position: 'right',
                        grid: {
                            drawOnChartArea: false
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Day of Week'
                        }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Mood by Day of Week (Line: Entry Count, Bars: Mood Score)'
                    },
                    tooltip: {
                        callbacks: {
                            afterBody: function(context) {
                                const index = context[0].dataIndex;
                                return `Entries: ${data.counts[index]}`;
                            }
                        }
                    }
                }
            }
        });
        
        console.log("✅ Day chart created");
    } catch (error) {
        console.error("❌ Error creating day chart:", error);
    }
}

function createMonthChart(data) {
    const canvas = document.getElementById('moodByMonthChart');
    if (!canvas) {
        console.error("❌ Month canvas not found");
        return;
    }
    // Clear any existing chart
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
        existingChart.destroy();
    }
    
    try {
        window.monthChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [
                    {
                        label: 'Average Mood',
                        data: data.averages,
                        backgroundColor: '#8b5cf6',
                        borderColor: '#7c3aed',
                        borderWidth: 2,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Entry Count',
                        data: data.counts,
                        backgroundColor: 'rgba(236, 72, 153, 0.3)',
                        borderColor: '#ec4899',
                        borderWidth: 1,
                        type: 'line',
                        yAxisID: 'y1',
                        tension: 0.4,
                        fill: false,
                        pointBackgroundColor: '#ec4899',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 10,
                        title: {
                            display: true,
                            text: 'Mood Score (1-10)'
                        },
                        position: 'left'
                    },
                    y1: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Entries'
                        },
                        position: 'right',
                        grid: {
                            drawOnChartArea: false
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Month'
                        },
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45
                        }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Mood by Month (Bars: Mood Score, Line: Entry Count)'
                    },
                    tooltip: {
                        callbacks: {
                            afterBody: function(context) {
                                const index = context[0].dataIndex;
                                return `Entries: ${data.counts[index]}`;
                            }
                        }
                    }
                }
            }
        });
        
        console.log("✅ Month chart created with", data.labels.length, "months");
    } catch (error) {
        console.error("❌ Error creating month chart:", error);
    }
}
// Function to get mood value
     function getMoodValue(moodEmoji) {
    const moodValues = {
        "😤 Frustrated": 2,
        "😰 Anxious": 3,
        "😔 Melancholic": 4,
        "😴 Tired": 5,
        "🤔 Thoughtful": 6,
        "😌 Peaceful": 7,
        "😊 Happy": 8,
        "🌟 Inspired": 9,
        "❤️ Grateful": 10,
        "🎉 Excited": 10
    };
    return moodValues[moodEmoji] || 5; // Default to neutral
}
// Mood Chart Variables
let moodChart = null;
let filteredEntries = [];

// Initialize Mood Analytics
function initMoodAnalytics() {
    const ctx = document.getElementById('moodChart').getContext('2d');
    
    // Mood mapping to numerical values for charting
    const moodScores = {
        "😤 Frustrated": 2,
        "😰 Anxious": 3,
        "😔 Melancholic": 4,
        "😴 Tired": 5,
        "🤔 Thoughtful": 6,
        "😌 Peaceful": 7,
        "😊 Happy": 8,
        "🌟 Inspired": 9,
        "❤️ Grateful": 10,
        "🎉 Excited": 10
    };

    // Prepare data for the chart
    const chartData = prepareMoodChartData(journals);
    
    // Create the line graph
    if (window.moodChartInstance) {
        window.moodChartInstance.destroy();
    }

    window.moodChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'Mood Level',
                data: chartData.data,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: function(context) {
                    const value = context.dataset.data[context.dataIndex];
                    if (value <= 4) return '#ef4444';    // Red for low mood
                    if (value <= 6) return '#f59e0b';    // Yellow for medium mood
                    return '#10b981';                    // Green for high mood
                },
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 6,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    min: 1,
                    max: 10,
                    title: {
                        display: true,
                        text: 'Mood Level (1-10)'
                    },
                    ticks: {
                        callback: function(value) {
                            // Map numbers back to mood labels for Y-axis
                            const moodMap = {
                                1: 'Very Low', 2: 'Low', 3: 'Low', 4: 'Low-Med',
                                5: 'Medium', 6: 'Medium', 7: 'Med-High', 
                                8: 'High', 9: 'Very High', 10: 'Excellent'
                            };
                            return `${value} - ${moodMap[value]}`;
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Journal Entries Timeline'
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const index = context.dataIndex;
                            const entry = chartData.entries[index];
                            return [
                                `Mood: ${entry.mood} (${context.parsed.y}/10)`,
                                `Title: ${entry.title}`,
                                `Date: ${new Date(entry.date).toLocaleDateString()}`
                            ];
                        }
                    }
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });

    // Update statistics
    updateMoodStatistics(chartData);
}


// Update Mood Chart
function updateMoodChart() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    // Filter entries by date range
    filteredEntries = journals.filter(entry => {
        const entryDate = new Date(entry.date);
        const start = new Date(startDate);
        const end = new Date(endDate);
        return entryDate >= start && entryDate <= end;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Prepare chart data
    const chartData = prepareMoodChartData(filteredEntries);
    
    // Create or update chart
    renderMoodChart(chartData);
    
    // Update statistics
    updateMoodStatistics(chartData);
}

// Prepare data for mood chart
function prepareMoodChartData(entries) {
    // Sort entries by date (oldest first for timeline)
    const sortedEntries = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    const labels = [];
    const data = [];
    
    sortedEntries.forEach(entry => {
        const date = new Date(entry.date);
        labels.push(date.toLocaleDateString());
        
        // Convert mood to numerical value
        const moodValue = getMoodValue(entry.mood);
        data.push(moodValue);
    });
    
    return {
        labels: labels,
        data: data,
        entries: sortedEntries
    };
}

// Render Mood Chart
function renderMoodChart(chartData) {
    const ctx = document.getElementById('moodChart').getContext('2d');
    
    // Destroy existing chart
    if (moodChart) {
        moodChart.destroy();
    }
    
    // Calculate chart width based on data points
    const minWidth = 800;
    const calculatedWidth = Math.max(minWidth, chartData.labels.length * 60);
    document.getElementById('moodChart').width = calculatedWidth;
    
    moodChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'Mood Level',
                data: chartData.data,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: function(context) {
                    const value = context.dataset.data[context.dataIndex];
                    if (value <= 4) return '#ef4444';
                    if (value <= 6) return '#f59e0b';
                    return '#10b981';
                },
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 6,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: false,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    min: 1,
                    max: 10,
                    title: {
                        display: true,
                        text: 'Mood Level (Worst to Best)'
                    },
                    ticks: {
                        callback: function(value) {
                            // Map numbers back to mood labels
                            const moodMap = {
                                1: '😰 Anxious', 2: '😤 Frustrated', 3: '😔 Melancholic',
                                4: '😴 Tired', 5: '🤔 Thoughtful', 6: '😌 Peaceful',
                                7: '❤️ Grateful', 8: '😊 Happy', 9: '🌟 Inspired', 10: '🎉 Excited'
                            };
                            return `${value} - ${moodMap[value]}`;
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Journal Entries (Old to New)'
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const index = context.dataIndex;
                            const moodLabel = chartData.moodLabels[index];
                            const entry = chartData.entries[index];
                            return [
                                `Mood: ${moodLabel} (${context.parsed.y}/10)`,
                                `Title: ${entry.title}`,
                                `Date: ${new Date(entry.date).toLocaleDateString()}`
                            ];
                        }
                    }
                },
                legend: {
                    display: false
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}

// Update mood statistics
function updateMoodStatistics(chartData) {
    if (chartData.data.length === 0) {
        document.getElementById('avgMood').textContent = '-';
        document.getElementById('moodRange').textContent = '-';
        document.getElementById('positiveDays').textContent = '-';
        document.getElementById('trendDirection').textContent = '-';
        return;
    }
    
    // Calculate statistics
    const avgMood = (chartData.data.reduce((a, b) => a + b, 0) / chartData.data.length).toFixed(1);
    const minMood = Math.min(...chartData.data);
    const maxMood = Math.max(...chartData.data);
    
    // Positive days (mood >= 7)
    const positiveDays = chartData.data.filter(mood => mood >= 7).length;
    const positivePercentage = ((positiveDays / chartData.data.length) * 100).toFixed(0);
    
    // Trend calculation
    let trend = 'Stable';
    if (chartData.data.length >= 2) {
        const firstHalf = chartData.data.slice(0, Math.floor(chartData.data.length / 2));
        const secondHalf = chartData.data.slice(Math.floor(chartData.data.length / 2));
        
        const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        
        if (avgSecond > avgFirst + 0.5) trend = 'Improving ↑';
        else if (avgSecond < avgFirst - 0.5) trend = 'Declining ↓';
    }
    
    // Update DOM
    document.getElementById('avgMood').textContent = avgMood;
    document.getElementById('moodRange').textContent = `${minMood} - ${maxMood}`;
    document.getElementById('positiveDays').textContent = `${positiveDays} (${positivePercentage}%)`;
    document.getElementById('trendDirection').textContent = trend;
}

function processWeekData(moodValues) {
    const weekMap = {};
    
    journals.forEach(j => {
        const date = new Date(j.timestamp);
        // Get week number (ISO week)
        const weekNumber = getISOWeek(date);
        const year = date.getFullYear();
        const weekKey = `${year}-W${String(weekNumber).padStart(2, '0')}`;
        const weekLabel = `Week ${weekNumber}, ${year}`;
        const moodValue = moodValues[j.mood] || 5;
        
        if (!weekMap[weekKey]) {
            weekMap[weekKey] = {
                moods: [],
                count: 0,
                label: weekLabel
            };
        }
        weekMap[weekKey].moods.push(moodValue);
        weekMap[weekKey].count++;
    });
    
    // Sort by week key (chronological order)
    const sortedWeeks = Object.keys(weekMap).sort();
    
    const labels = sortedWeeks.map(week => weekMap[week].label);
    const averages = sortedWeeks.map(week => {
        const sum = weekMap[week].moods.reduce((a, b) => a + b, 0);
        return parseFloat((sum / weekMap[week].moods.length).toFixed(2));
    });
    const counts = sortedWeeks.map(week => weekMap[week].count);
    
    console.log("📅 Week Data:", { labels, averages, counts });
    return { labels, averages, counts };
}

// Helper function to get ISO week number
function getISOWeek(date) {
    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    return 1 + Math.ceil((firstThursday - target) / 604800000);
}

function createWeekChart(data) {
    const canvas = document.getElementById('moodByWeekChart');
    if (!canvas) {
        console.error("❌ Week canvas not found");
        return;
    }
    
    // Clear any existing chart
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
        existingChart.destroy();
    }
    
    try {
        window.weekChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [
                    // Line dataset FIRST
                    {
                        label: 'Entry Count',
                        data: data.counts,
                        type: 'line',
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: false,
                        pointBackgroundColor: '#10b981',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        yAxisID: 'y1',
                        order: 1
                    },
                    // Bar dataset SECOND
                    {
                        label: 'Average Mood',
                        data: data.averages,
                        backgroundColor: 'rgba(99, 102, 241, 0.7)',
                        borderColor: '#4f46e5',
                        borderWidth: 2,
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 10,
                        title: {
                            display: true,
                            text: 'Mood Score (1-10)'
                        },
                        position: 'left'
                    },
                    y1: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Entries'
                        },
                        position: 'right',
                        grid: {
                            drawOnChartArea: false
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Week'
                        },
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45
                        }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Mood by Week (Line: Entry Count, Bars: Mood Score)'
                    },
                    tooltip: {
                        callbacks: {
                            afterBody: function(context) {
                                const index = context[0].dataIndex;
                                return `Entries: ${data.counts[index]}`;
                            }
                        }
                    }
                }
            }
        });
        
        console.log("✅ Week chart created with", data.labels.length, "weeks");
    } catch (error) {
        console.error("❌ Error creating week chart:", error);
    }
}

function filterMoodData() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    if (!startDate || !endDate) {
        showToast('Please select both start and end dates', 'error');
        return;
    }
    
    const filteredEntries = journals.filter(entry => {
        const entryDate = new Date(entry.date);
        const start = new Date(startDate);
        const end = new Date(endDate);
        return entryDate >= start && entryDate <= end;
    });
    
    if (filteredEntries.length === 0) {
        showToast('No entries found in the selected date range', 'warning');
        return;
    }
    
    const chartData = prepareMoodChartData(filteredEntries);
    
    // Update chart with filtered data
    window.moodChartInstance.data.labels = chartData.labels;
    window.moodChartInstance.data.datasets[0].data = chartData.data;
    window.moodChartInstance.update();
    
    // Update statistics
    updateMoodStatistics(chartData);
    
    showToast(`Showing ${filteredEntries.length} entries from selected period`);
}

function resetMoodFilter() {
    const chartData = prepareMoodChartData(journals);
    
    // Reset date inputs
    if (journals.length > 0) {
        const dates = journals.map(j => new Date(j.date)).sort((a, b) => a - b);
        const firstDate = dates[0];
        const lastDate = dates[dates.length - 1];
        
        document.getElementById('startDate').value = firstDate.toISOString().split('T')[0];
        document.getElementById('endDate').value = lastDate.toISOString().split('T')[0];
    }
    
    // Update chart
    window.moodChartInstance.data.labels = chartData.labels;
    window.moodChartInstance.data.datasets[0].data = chartData.data;
    window.moodChartInstance.update();
    
    // Update statistics
    updateMoodStatistics(chartData);
    
    showToast('Showing all journal entries');
}

function showAnalyticsSection() {
    showSection('analytics');
    
    console.log("=== INITIALIZING ANALYTICS ===");
    
    // Small delay to ensure DOM is ready
    setTimeout(() => {
        if (journals.length > 0) {
            console.log("Found journals, initializing charts...");
            
            // Initialize main mood chart
            initMoodAnalytics();
            
            // Initialize dependency charts with a small delay
            setTimeout(() => {
                initMoodDependencyCharts();
            }, 300);
            
        } else {
            console.log("No journals found, showing empty state");
            showNoDataMessage();
        }
    }, 500);
}

function debugChartData() {
    console.log("=== CHART DATA DEBUG ===");
    console.log("Total journals:", journals.length);
    
    if (journals.length > 0) {
        console.log("Sample journal entry:", journals[0]);
        console.log("Available moods:", [...new Set(journals.map(j => j.mood))]);
        console.log("Available locations:", [...new Set(journals.map(j => j.location).filter(Boolean))]);
        
        // Check timestamps
        journals.forEach((j, i) => {
            console.log(`Entry ${i}:`, {
                title: j.title,
                mood: j.mood,
                location: j.location,
                timestamp: j.timestamp,
                date: new Date(j.timestamp).toString()
            });
        });
    }
    
    // Check if canvas elements exist
    const canvases = ['moodByLocationChart', 'moodByTimeChart', 'moodByDayChart'];
    canvases.forEach(id => {
        const canvas = document.getElementById(id);
        console.log(`Canvas ${id}:`, canvas ? 'EXISTS' : 'MISSING');
    });
}

// Add this debug function to check the current state
function debugCharts() {
    console.log("=== CHART DEBUG INFO ===");
    
    // Check if journals exist
    console.log("Journals length:", journals.length);
    if (journals.length > 0) {
        console.log("Sample journal:", {
            title: journals[0].title,
            mood: journals[0].mood,
            location: journals[0].location,
            timestamp: journals[0].timestamp
        });
    }
    
    // Check if canvas elements exist and are accessible
    const canvasIds = ['moodByLocationChart', 'moodByTimeChart', 'moodByDayChart'];
    canvasIds.forEach(id => {
        const canvas = document.getElementById(id);
        console.log(`Canvas ${id}:`, canvas);
        if (canvas) {
            console.log(`- Dimensions: ${canvas.width}x${canvas.height}`);
            console.log(`- Parent:`, canvas.parentElement);
        }
    });
    
    // Check if Chart.js is loaded
    console.log("Chart.js available:", typeof Chart !== 'undefined');
    
    // Check if we're in analytics section
    const analyticsSection = document.getElementById('analytics');
    console.log("Analytics section active:", analyticsSection?.classList.contains('active'));
}

// Call this when you go to analytics section
function showAnalyticsSection() {
    showSection('analytics');
    
    console.log("=== INITIALIZING ANALYTICS ===");
    debugCharts();
    
    setTimeout(() => {
        if (journals.length > 0) {
            console.log("Initializing charts with data...");
            initMoodAnalytics();
            initMoodDependencyCharts();
        } else {
            console.log("No data for charts");
            showNoDataMessage();
        }
    }, 500);
}

function showNoDataMessage() {
    const canvases = ['moodByLocationChart', 'moodByTimeChart', 'moodByDayChart'];
    canvases.forEach(id => {
        const canvas = document.getElementById(id);
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#f8f9fa';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#6c757d';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
        }
    });
}
// Reset Date Filter
function resetDateFilter() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    document.getElementById('startDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('endDate').value = endDate.toISOString().split('T')[0];
    
    updateMoodChart();
}


        // Calendar Functions
        // Calendar Functions - Enhanced to show todos
        // Calendar Functions
function createCalendarDay(day, dateStr, isOtherMonth, isToday, isStreakDay, hasEntry, hasTasks) {
    let dayClass = 'calendar-day';
    let indicators = '';
    
    if (isOtherMonth) dayClass += ' other-month';
    if (isToday) dayClass += ' today';
    if (isStreakDay) dayClass += ' streak-day';
    if (hasEntry) dayClass += ' has-entry';
    if (hasTasks) dayClass += ' has-tasks';
    
    if (hasEntry) {
        indicators += '<div class="entry-indicator">📝</div>';
    }
    
    if (hasTasks) {
        const taskCount = getTodosForDate(dateStr).length;
        indicators += `<div class="task-indicator">${taskCount} 📌</div>`;
    }
    
    return `
        <div class="${dayClass}" onclick="selectCalendarDate('${dateStr}')">
            <div class="date-number">${day}</div>
            ${indicators}
        </div>
    `;
}

function generateCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    document.getElementById('calendarMonth').textContent = 
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(currentDate);
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    
    let calendarHTML = '';
    
    // Get streak days for highlighting
    const streakDays = getStreakDays();
    
    // Empty cells for days before month starts
    const prevMonth = new Date(year, month, 0);
    const daysInPrevMonth = prevMonth.getDate();
    
    // Loop 1: Previous month days
    for (let i = firstDay - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        const dateStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const hasEntry = journals.some(journal => {
            const journalDate = new Date(journal.timestamp);
            const journalDateStr = journalDate.toISOString().split('T')[0];
            return journalDateStr === dateStr;
        });
        const hasTasks = getTodosForDate(dateStr).length > 0;
        
        calendarHTML += createCalendarDay(day, dateStr, true, false, streakDays.includes(dateStr), hasEntry, hasTasks);
    }
    
    // Loop 2: Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
        const hasEntry = journals.some(journal => {
            const journalDate = new Date(journal.timestamp);
            const journalDateStr = journalDate.toISOString().split('T')[0];
            return journalDateStr === dateStr;
        });
        const hasTasks = getTodosForDate(dateStr).length > 0;
        const isStreakDay = streakDays.includes(dateStr);
        
        calendarHTML += createCalendarDay(day, dateStr, false, isToday, isStreakDay, hasEntry, hasTasks);
    }
    
    // Loop 3: Next month days
    const totalCells = 42; // 6 weeks * 7 days
    const remainingCells = totalCells - (firstDay + daysInMonth);
    
    for (let day = 1; day <= remainingCells; day++) {
        const nextMonth = new Date(year, month + 1, day);
        const dateStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const hasEntry = journals.some(journal => {
            const journalDate = new Date(journal.timestamp);
            const journalDateStr = journalDate.toISOString().split('T')[0];
            return journalDateStr === dateStr;
        });
        const hasTasks = getTodosForDate(dateStr).length > 0;
        
        calendarHTML += createCalendarDay(day, dateStr, true, false, streakDays.includes(dateStr), hasEntry, hasTasks);
    }
    
    document.getElementById('calendarGrid').innerHTML = calendarHTML;
}

function getStreakDays() {
    const streakDays = [];
    const today = new Date();
    let currentDay = new Date(today); // Create a copy

    // Check up to 30 days back for streak
    for (let i = 0; i < 30; i++) {
        const dateStr = currentDay.toISOString().split('T')[0];
        const hasEntry = journals.some(journal => {
            const journalDate = new Date(journal.timestamp);
            const journalDateStr = journalDate.toISOString().split('T')[0];
            return journalDateStr === dateStr;
        });

        if (hasEntry) {
            streakDays.push(dateStr);
        } else if (dateStr !== today.toISOString().split('T')[0]) {
            // Stop if we find a day without entry (except today)
            break;
        }

        currentDay.setDate(currentDay.getDate() - 1);
    }

    return streakDays;
    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
        const hasEntry = journals.some(journal => {
            const   journalDate=new Date(journal.timestamp);
            const journalDateStr = journalDate.toISOString().split('T')[0];
            return  journalDateStr  ===dateStr;
        });
        const hasTasks = getTodosForDate(dateStr).length > 0;
        const isStreakDay = streakDays.includes(dateStr);
        
        calendarHTML += createCalendarDay(day, dateStr, false, isToday, isStreakDay, hasEntry, hasTasks);
    }
    
    // Empty cells for days after month ends
    const totalCells = 42; // 6 weeks * 7 days
    const remainingCells = totalCells - (firstDay + daysInMonth);
    
    for (let day = 1; day <= remainingCells; day++) {
        const nextMonth = new Date(year, month + 1, day);
        const dateStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        calendarHTML += createCalendarDay(day, dateStr, true, false, streakDays);
    }
    
    document.getElementById('calendarGrid').innerHTML = calendarHTML;
}
// Debug function to check all entries and their dates
function debugDates() {
    console.log('=== DATE DEBUG INFO ===');
    console.log('Current local time:', new Date().toString());
    console.log('Current ISO string:', new Date().toISOString());
    
    journals.forEach((entry, index) => {
        const storedDate = entry.date;
        const timestampDate = new Date(entry.timestamp);
        const localDate = entry.localISODate ? new Date(entry.localISODate) : null;
        
        console.log(`Entry ${index + 1}:`, {
            title: entry.title,
            storedDate: storedDate,
            timestamp: entry.timestamp,
            timestampToLocal: timestampDate.toString(),
            localISODate: localDate ? localDate.toString() : 'N/A',
            mismatch: storedDate !== timestampDate.toISOString().split('T')[0]
        });
    });
}

// Call this in your console to check dates
// debugDates();
// Get todos for a specific date
function getTodosForDate(dateStr) {
    return todos.filter(todo => {
        if (!todo.dueDate) return false;

        // Handle both string dates and timestamp numbers
        let todoDate;
        if (typeof todo.dueDate === 'number') {
            todoDate = new Date(todo.dueDate).toISOString().split('T')[0];
        } else {
            todoDate = new Date(todo.dueDate).toISOString().split('T')[0];
        }

        return todoDate === dateStr;
    });
}

function selectCalendarDate(dateStr) {
    selectedDate = dateStr;
    const dateEntries = journals.filter(journal => journal.date === dateStr);
    const dateTodos = getTodosForDate(dateStr);
    const calendarEntries = document.getElementById('calendarEntries');
    
    const formattedDate = new Date(dateStr).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    
    let content = `
        <div class="selected-date-header">
            <h4>${formattedDate}</h4>
        </div>
    `;
    
    // Journal Entries Section
    if (dateEntries.length === 0) {
        content += `
            <div class="date-entries">
                <h5>📖 Journal Entries</h5>
                <div class="empty-state" style="padding: 20px;">
                    <p>No journal entries for this date</p>
                    <button class="btn-primary" onclick="createEntryForDate('${dateStr}')" style="margin-top: 10px;">
                        Create Journal Entry
                    </button>
                </div>
            </div>
        `;
    } else {
        content += `
            <div class="date-entries">
                <h5>📖 Journal Entries (${dateEntries.length})</h5>
            ${dateEntries.map(entry => `
                    <div class="entry-item" onclick="viewEntry(${entry.id})">
                        <div style="font-weight: 600; color: #2d3748; margin-bottom: 8px;">${entry.title}</div>
                        <div style="font-size: 0.9rem; color: #718096;">
                            ${entry.mood} • ${entry.time}
                        </div>
                        <div style="color: #4a5568; margin-top: 8px; white-space: pre-wrap;">
                            ${entry.content.substring(0, 100)}...
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    // Tasks Section
    content += `
        <div class="date-tasks">
            <h5>✅ Tasks (${dateTodos.length})</h5>
    `;
    
    if (dateTodos.length === 0) {
        content += `
            <div class="empty-state" style="padding: 20px;">
                <p>No tasks scheduled for this date</p>
                <button class="btn-primary" onclick="createTodoForDate('${dateStr}')" style="margin-top: 10px;">
                    Add Task
                </button>
            </div>
        `;
    } else {
        content += dateTodos.map(todo => `
            <div class="task-item">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''} 
                           onchange="toggleTodo(${todo.id})">
                    <span style="flex: 1; ${todo.completed ? 'text-decoration: line-through; color: #718096;' : ''}">
                        ${todo.text}
                    </span>
                    <span class="todo-remove" onclick="removeDueDateFromTodo(${todo.id})" title="Remove from this date">📅❌</span>
                </div>
            </div>
        `).join('');
    }
    
    content += `</div>`;
    
    // Quick Add Section
    content += `
        <div class="quick-add-section">
            <h5>⚡ Quick Add Task</h5>
            <div style="display: flex; gap: 8px; margin-top: 12px;">
                <input type="text" id="quickTodoInput" class="form-input" 
                       placeholder="Add a task for ${formattedDate}" 
                       style="flex: 1;">
                <button class="btn-primary" onclick="createQuickTodo('${dateStr}')">Add Task</button>
            </div>
        </div>
    `;
    
    calendarEntries.innerHTML = content;
    document.getElementById('selectedDateTitle').textContent = formattedDate;
}

// Quick todo functions
function handleQuickTodoInput(event, dateStr) {
    if (event.key === 'Enter') {
        createQuickTodo(dateStr);
    }
}

async function createQuickTodo(dateStr) {
    const input = document.getElementById('quickTodoInput');
    const text = input.value.trim();
    
    if (text) {
        todos.push({
            id: Date.now(),
            text: text,
            completed: false,
            timestamp: Date.now(),
            dueDate: dateStr
        });
        
        input.value = '';
        await saveData();
        loadTodos();
        generateCalendar();
        selectCalendarDate(dateStr);
        showToast('Task added successfully');
    }
}

function removeDueDateFromTodo(todoId) {
    const todo = todos.find(t => t.id === todoId);
    if (todo) {
        delete todo.dueDate;
        saveData();
        loadTodos();
        generateCalendar();
        if (selectedDate) {
            selectCalendarDate(selectedDate);
        }
        showToast('Due date removed');
    }
}
// Create entry for specific date
function createEntryForDate(dateStr) {
    showSection('new-entry');
    // You could pre-fill the date in a hidden field if you add one
    showToast(`Creating entry for ${new Date(dateStr).toLocaleDateString()}`);
}

function createTodoForDate(dateStr) {
    const taskText = prompt('Enter task for ' + new Date(dateStr).toLocaleDateString() + ':');
    if (taskText) {
        todos.push({
            id: Date.now(),
            text: taskText,
            completed: false,
            timestamp: Date.now(),
            dueDate: dateStr
        });
        saveData();
        loadTodos();
        generateCalendar();
        selectCalendarDate(dateStr);
        showToast('Task added to this date');
    }
}

function goToToday() {
    currentDate = new Date();
    generateCalendar();
    selectCalendarDate(new Date().toISOString().split('T')[0]);
}

function previousMonth() {
    currentDate.setMonth(currentDate.getMonth() - 1);
    generateCalendar();
}

function nextMonth() {
    currentDate.setMonth(currentDate.getMonth() + 1);
    generateCalendar();
}


        // Utility function to show toast notifications
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Utility function to convert blob to base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Updated saveAudioWithEntry function for server storage
async function saveAudioWithEntry(entryId) {
    if (!audioBlob) return;

    try {
        // Convert blob to base64 for JSON transmission
        const base64data = await blobToBase64(audioBlob);
        
        const response = await fetch(`${API_BASE_URL}/audio`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                entryId: entryId,
                audioData: base64data,
                timestamp: Date.now()
            })
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        console.log('Audio saved to server for entry:', entryId);
    } catch (error) {
        console.error('Failed to save audio to server:', error);
        // Fallback to localStorage if server fails
        const base64data = await blobToBase64(audioBlob);
        localStorage.setItem(`journal_audio_${entryId}`, base64data);
        showToast('Audio saved locally (server unavailable)', 'warning');
    }
}

// Function to load audio from server
// Improved loadAudioForEntry with better error handling
async function loadAudioForEntry(entryId) {
    try {
        console.log('Loading audio for entry:', entryId);
        
        const response = await fetch(`${API_BASE_URL}/audio/${entryId}`);
        
        if (response.ok) {
            const result = await response.json();
            console.log('Audio loaded from server:', entryId);
            return result.audioData;
        } else if (response.status === 404) {
            console.log('Audio not found on server, checking localStorage for:', entryId);
            // Check localStorage fallback
            return localStorage.getItem(`journal_audio_${entryId}`);
        } else {
            console.error('Server error loading audio:', response.status);
            // Fallback to localStorage
            return localStorage.getItem(`journal_audio_${entryId}`);
        }
    } catch (error) {
        console.error('Failed to load audio from server:', error);
        // Fallback to localStorage
        return localStorage.getItem(`journal_audio_${entryId}`);
    }
}
// 🧠 Preload Compromise NLP when the app starts
window.addEventListener("load", () => {
    ensureNLP()
    .then(() => console.log("NLP preloaded and ready."))
    .catch(() => console.warn("Skipped NLP preload (offline or blocked)."));
});

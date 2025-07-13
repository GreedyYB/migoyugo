const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Import authentication modules
const { initializeDatabase, createUser, getUserByEmail, getUserByUsername, verifyPassword, getUserStats, getAllUsers, getSystemStats, getRecentUsers, getTopPlayers } = require('./database');
const { generateToken, authenticateToken, optionalAuth } = require('./auth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL || true
      : "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 5000;

// Log environment info for debugging
console.log('=== ENVIRONMENT INFO ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', PORT);
console.log('RAILWAY_STATIC_URL:', process.env.RAILWAY_STATIC_URL);
console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('========================');

// Initialize database
initializeDatabase().catch(console.error);

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL || true
    : "http://localhost:3000",
  credentials: true
}));
app.use(express.json());

// Serve static files from React build
app.use(express.static(path.join(__dirname, '../client/build')));

// Authentication routes
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    
    // Validate input
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Validate username
    const usernameRegex = /^[a-zA-Z][a-zA-Z0-9]{5,19}$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ error: 'Username must be 6-20 characters, start with a letter, and contain only letters and numbers' });
    }
    
    // Validate password
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character' });
    }
    
    // Check if user already exists
    const existingUserByEmail = await getUserByEmail(email);
    if (existingUserByEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    const existingUserByUsername = await getUserByUsername(username);
    if (existingUserByUsername) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    
    // Create user
    const user = await createUser(email, username, password);
    const token = generateToken(user);
    
    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws
      },
      token
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Get user by email
    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Verify password
    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Generate token
    const token = generateToken(user);
    
    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws
      },
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Protected route example - get user profile
app.get('/api/auth/profile', authenticateToken, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      username: req.user.username,
      wins: req.user.wins,
      losses: req.user.losses,
      draws: req.user.draws,
      created_at: req.user.created_at
    }
  });
});

// Get user statistics
app.get('/api/auth/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await getUserStats(req.user.id);
    if (!stats) {
      return res.status(404).json({ error: 'User stats not found' });
    }
    res.json({ stats });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin routes - Simple password protection
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'migoyugo-admin-2024';

function adminAuth(req, res, next) {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  next();
}

// Admin dashboard - Get all users
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin dashboard - Get system statistics  
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const stats = await getSystemStats();
    res.json({ stats });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin dashboard - Get recent users
app.get('/api/admin/recent-users', adminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const users = await getRecentUsers(limit);
    res.json({ users });
  } catch (error) {
    console.error('Admin recent users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin dashboard - Get top players
app.get('/api/admin/top-players', adminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const players = await getTopPlayers(limit);
    res.json({ players });
  } catch (error) {
    console.error('Admin top players error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin dashboard - Serve admin panel HTML (must be before catch-all)
app.get('/admin', (req, res) => {
  const adminHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>migoyugo Game Admin Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        body {
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            background: linear-gradient(135deg, #2c3e50, #34495e);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        
        .header p {
            font-size: 1.2em;
            opacity: 0.9;
        }
        
        .login-section {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
            margin-bottom: 30px;
        }
        
        .login-section input {
            padding: 12px 20px;
            font-size: 16px;
            border: 2px solid #ddd;
            border-radius: 5px;
            margin: 10px;
            width: 250px;
        }
        
        .login-section button {
            padding: 12px 30px;
            background: #3498db;
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 16px;
            cursor: pointer;
            margin: 10px;
        }
        
        .login-section button:hover {
            background: #2980b9;
        }
        
        .dashboard {
            display: none;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
            border-left: 5px solid #3498db;
        }
        
        .stat-card h3 {
            color: #2c3e50;
            font-size: 1.2em;
            margin-bottom: 10px;
        }
        
        .stat-card .number {
            font-size: 2.5em;
            font-weight: bold;
            color: #3498db;
            margin: 10px 0;
        }
        
        .section {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        
        .section h2 {
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
            margin-bottom: 20px;
            font-size: 1.5em;
        }
        
        .table-container {
            overflow-x: auto;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        
        th {
            background: #f8f9fa;
            font-weight: 600;
            color: #2c3e50;
            position: sticky;
            top: 0;
        }
        
        tr:hover {
            background: #f8f9fa;
        }
        
        .win-rate {
            font-weight: bold;
        }
        
        .win-rate.high { color: #27ae60; }
        .win-rate.medium { color: #f39c12; }
        .win-rate.low { color: #e74c3c; }
        
        .streak {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.9em;
            font-weight: bold;
        }
        
        .streak.win { background: #d4edda; color: #155724; }
        .streak.loss { background: #f8d7da; color: #721c24; }
        .streak.none { background: #e2e3e5; color: #6c757d; }
        
        .loading {
            text-align: center;
            padding: 50px;
            font-size: 1.2em;
            color: #666;
        }
        
        .error {
            background: #f8d7da;
            color: #721c24;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
            border: 1px solid #f5c6cb;
        }
        
        .refresh-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin-bottom: 20px;
            font-size: 14px;
        }
        
        .refresh-btn:hover {
            background: #218838;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            .header h1 {
                font-size: 2em;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            table {
                font-size: 14px;
            }
            
            th, td {
                padding: 8px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎮 migoyugo Game Admin Dashboard</h1>
            <p>Monitor your game's users, statistics, and performance</p>
        </div>
        
        <div class="login-section" id="loginSection">
            <h2>Admin Access Required</h2>
            <p>Enter admin password to access dashboard</p>
            <br>
            <input type="password" id="adminPassword" placeholder="Admin Password" />
            <button onclick="login()">Access Dashboard</button>
            <div id="loginError"></div>
        </div>
        
        <div class="dashboard" id="dashboard">
            <button class="refresh-btn" onclick="loadDashboard()">🔄 Refresh Data</button>
            
            <div class="stats-grid" id="statsGrid">
                <div class="loading">Loading system statistics...</div>
            </div>
            
            <div class="section">
                <h2>📊 All Users</h2>
                <div class="table-container">
                    <table id="usersTable">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Username</th>
                                <th>Email</th>
                                <th>Games</th>
                                <th>W/L/D</th>
                                <th>Win Rate</th>
                                <th>Streak</th>
                                <th>Joined</th>
                                <th>Verified</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td colspan="9" class="loading">Loading users...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div class="section">
                <h2>🏆 Top Players (5+ Games)</h2>
                <div class="table-container">
                    <table id="topPlayersTable">
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Username</th>
                                <th>Games</th>
                                <th>Wins</th>
                                <th>Win Rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td colspan="5" class="loading">Loading top players...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <script>
        let adminPassword = '';
        
        function login() {
            adminPassword = document.getElementById('adminPassword').value;
            if (!adminPassword) {
                showError('loginError', 'Please enter admin password');
                return;
            }
            
            // Test admin access
            fetch('/api/admin/stats?password=' + encodeURIComponent(adminPassword))
                .then(response => {
                    if (response.ok) {
                        document.getElementById('loginSection').style.display = 'none';
                        document.getElementById('dashboard').style.display = 'block';
                        loadDashboard();
                    } else {
                        showError('loginError', 'Invalid admin password');
                    }
                })
                .catch(error => {
                    showError('loginError', 'Connection error: ' + error.message);
                });
        }
        
        function showError(elementId, message) {
            document.getElementById(elementId).innerHTML = '<div class="error">' + message + '</div>';
        }
        
        function loadDashboard() {
            loadSystemStats();
            loadUsers();
            loadTopPlayers();
        }
        
        function loadSystemStats() {
            fetch('/api/admin/stats?password=' + encodeURIComponent(adminPassword))
                .then(response => response.json())
                .then(data => {
                    const stats = data.stats;
                    document.getElementById('statsGrid').innerHTML = \`
                        <div class="stat-card">
                            <h3>Total Users</h3>
                            <div class="number">\${stats.totalUsers}</div>
                        </div>
                        <div class="stat-card">
                            <h3>Total Games</h3>
                            <div class="number">\${stats.totalGames}</div>
                        </div>
                        <div class="stat-card">
                            <h3>Avg Games/User</h3>
                            <div class="number">\${stats.avgGamesPerUser}</div>
                        </div>
                        <div class="stat-card">
                            <h3>Total Wins</h3>
                            <div class="number">\${stats.totalWins}</div>
                        </div>
                        <div class="stat-card">
                            <h3>Total Losses</h3>
                            <div class="number">\${stats.totalLosses}</div>
                        </div>
                        <div class="stat-card">
                            <h3>Total Draws</h3>
                            <div class="number">\${stats.totalDraws}</div>
                        </div>
                    \`;
                })
                .catch(error => {
                    document.getElementById('statsGrid').innerHTML = '<div class="error">Error loading stats: ' + error.message + '</div>';
                });
        }
        
        function loadUsers() {
            fetch('/api/admin/users?password=' + encodeURIComponent(adminPassword))
                .then(response => response.json())
                .then(data => {
                    const tbody = document.querySelector('#usersTable tbody');
                    if (data.users.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #666;">No users found</td></tr>';
                        return;
                    }
                    
                    tbody.innerHTML = data.users.map(user => {
                        const winRateClass = user.winRate >= 70 ? 'high' : user.winRate >= 40 ? 'medium' : 'low';
                        const streakClass = user.streak_type === 'win' ? 'win' : user.streak_type === 'loss' ? 'loss' : 'none';
                        const streakText = user.current_streak > 0 ? \`\${user.current_streak} \${user.streak_type}\` : 'none';
                        
                        return \`
                            <tr>
                                <td>\${user.id}</td>
                                <td><strong>\${user.username}</strong></td>
                                <td>\${user.email}</td>
                                <td>\${user.gamesPlayed}</td>
                                <td>\${user.wins}/\${user.losses}/\${user.draws}</td>
                                <td><span class="win-rate \${winRateClass}">\${user.winRate}%</span></td>
                                <td><span class="streak \${streakClass}">\${streakText}</span></td>
                                <td>\${new Date(user.created_at).toLocaleDateString()}</td>
                                <td>\${user.email_verified ? '✅' : '❌'}</td>
                            </tr>
                        \`;
                    }).join('');
                })
                .catch(error => {
                    document.querySelector('#usersTable tbody').innerHTML = '<tr><td colspan="9" class="error">Error loading users: ' + error.message + '</td></tr>';
                });
        }
        
        function loadTopPlayers() {
            fetch('/api/admin/top-players?password=' + encodeURIComponent(adminPassword))
                .then(response => response.json())
                .then(data => {
                    const tbody = document.querySelector('#topPlayersTable tbody');
                    if (data.players.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #666;">No players with 5+ games found</td></tr>';
                        return;
                    }
                    
                    tbody.innerHTML = data.players.map((player, index) => {
                        const winRateClass = player.winRate >= 70 ? 'high' : player.winRate >= 40 ? 'medium' : 'low';
                        const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
                        
                        return \`
                            <tr>
                                <td>\${rankEmoji} #\${index + 1}</td>
                                <td><strong>\${player.username}</strong></td>
                                <td>\${player.gamesPlayed}</td>
                                <td>\${player.wins}</td>
                                <td><span class="win-rate \${winRateClass}">\${player.winRate}%</span></td>
                            </tr>
                        \`;
                    }).join('');
                })
                .catch(error => {
                    document.querySelector('#topPlayersTable tbody').innerHTML = '<tr><td colspan="5" class="error">Error loading top players: ' + error.message + '</td></tr>';
                });
        }
        
        // Allow Enter key to login
        document.getElementById('adminPassword').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                login();
            }
        });
    </script>
</body>
</html>
  `;
  res.send(adminHTML);
});

// Catch all handler: send back React's index.html file for any non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

// Game state management
const games = new Map();
const waitingPlayers = [];
const rooms = new Map(); // Room management: roomCode -> { host, guest, gameId, status }

// Game logic functions
function createEmptyBoard() {
  return Array(8).fill(null).map(() => Array(8).fill(null));
}

function isValidMove(board, row, col, playerColor) {
  if (row < 0 || row >= 8 || col < 0 || col >= 8) return false;
  if (board[row][col] !== null) return false;
  
  // Check if move would create a line too long
  return !wouldCreateLineTooLong(board, row, col, playerColor);
}

function wouldCreateLineTooLong(board, row, col, playerColor) {
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  for (const [dr, dc] of directions) {
    let count = 1;
    
    // Count in positive direction
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
           board[r][c] && board[r][c].color === playerColor) {
      count++;
      r += dr;
      c += dc;
    }
    
    // Count in negative direction
    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
           board[r][c] && board[r][c].color === playerColor) {
      count++;
      r -= dr;
      c -= dc;
    }
    
    if (count > 4) return true;
  }
  
  return false;
}

function checkForVectors(board, row, col, playerColor) {
  const directions = [
    [-1, 0],  // up
    [-1, 1],  // up-right diagonal  
    [0, 1],   // right
    [1, 1]    // down-right diagonal
  ];
  
  const vectors = [];
  
  for (const [dr, dc] of directions) {
    const line = [{row, col}];
    
    // Collect in positive direction
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
           board[r][c] && board[r][c].color === playerColor) {
      line.push({row: r, col: c});
      r += dr;
      c += dc;
    }
    
    // Collect in negative direction
    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
           board[r][c] && board[r][c].color === playerColor) {
      line.unshift({row: r, col: c});
      r -= dr;
      c -= dc;
    }
    
    if (line.length === 4) {
      vectors.push(line);
    }
  }
  
  return vectors;
}

function processVectors(board, vectors, row, col) {
  if (vectors.length === 0) return { nodeType: null, removedCells: [] };
  
  const removedCells = [];
  
  // Remove ions from vectors (except nodes and the new placement)
  vectors.forEach(vector => {
    vector.forEach(cell => {
      if (!(cell.row === row && cell.col === col) && 
          board[cell.row][cell.col] && 
          !board[cell.row][cell.col].isNode) {
        removedCells.push({row: cell.row, col: cell.col});
        board[cell.row][cell.col] = null;
      }
    });
  });
  
  // Determine node type based on number of vectors
  let nodeType = 'standard';
  if (vectors.length === 2) nodeType = 'double';
  else if (vectors.length === 3) nodeType = 'triple';
  else if (vectors.length === 4) nodeType = 'quadruple';
  
  return { nodeType, removedCells };
}

function checkForNexus(board, row, col, playerColor) {
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];
  
  for (const [dr, dc] of directions) {
    const line = [{row, col}];
    
    // Collect in positive direction
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
           board[r][c] && board[r][c].isNode && board[r][c].color === playerColor) {
      line.push({row: r, col: c});
      r += dr;
      c += dc;
    }
    
    // Collect in negative direction
    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
           board[r][c] && board[r][c].isNode && board[r][c].color === playerColor) {
      line.unshift({row: r, col: c});
      r -= dr;
      c -= dc;
    }
    
    if (line.length === 4) {
      return line;
    }
  }
  
  return null;
}

function hasLegalMoves(board, playerColor) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (isValidMove(board, row, col, playerColor)) {
        return true;
      }
    }
  }
  return false;
}

function countNodes(board, playerColor) {
  let count = 0;
  console.log(`DEBUG SERVER: Counting nodes for ${playerColor}`);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cell = board[row][col];
      if (cell && cell.isNode && cell.color === playerColor) {
        // Count node value based on its type
        let nodeValue = 1; // default
        switch (cell.nodeType) {
          case 'standard':
            nodeValue = 1;
            break;
          case 'double':
            nodeValue = 2;
            break;
          case 'triple':
            nodeValue = 3;
            break;
          case 'quadruple':
            nodeValue = 4;
            break;
          default:
            nodeValue = 1; // fallback for nodes without nodeType
        }
        console.log(`DEBUG SERVER: Node at ${row},${col} type=${cell.nodeType} value=${nodeValue}`);
        count += nodeValue;
      }
    }
  }
  console.log(`DEBUG SERVER: Total count for ${playerColor}: ${count}`);
  return count;
}

function startServerTimer(gameId) {
  const game = games.get(gameId);
  if (!game || !game.timerSettings.timerEnabled) return;
  
  console.log(`Starting server timer for game ${gameId}`);
  
  // Clear any existing timer
  if (game.timerInterval) {
    clearInterval(game.timerInterval);
  }
  
  game.timerInterval = setInterval(() => {
    if (game.gameStatus !== 'active') {
      clearInterval(game.timerInterval);
      return;
    }
    
    const currentPlayer = game.currentPlayer;
    game.timers[currentPlayer] -= 1;
    
    // Broadcast timer update to all players
    io.to(gameId).emit('timerUpdate', {
      timers: game.timers,
      activeTimer: currentPlayer
    });
    
    // Check for timeout
    if (game.timers[currentPlayer] <= 0) {
      const winner = currentPlayer === 'white' ? 'black' : 'white';
      game.gameStatus = 'finished';
      clearInterval(game.timerInterval);
      
      io.to(gameId).emit('gameEnd', {
        winner,
        reason: 'timeout',
        timers: game.timers
      });
    }
  }, 1000);
  
  game.lastMoveTime = Date.now();
}

function stopServerTimer(gameId) {
  const game = games.get(gameId);
  if (game && game.timerInterval) {
    clearInterval(game.timerInterval);
    game.timerInterval = null;
    console.log(`Stopped server timer for game ${gameId}`);
  }
}

function addTimeIncrement(gameId) {
  const game = games.get(gameId);
  if (!game || !game.timerSettings.timerEnabled || game.timerSettings.incrementSeconds === 0) return;
  
  const currentPlayer = game.currentPlayer === 'white' ? 'black' : 'white'; // Previous player gets increment
  game.timers[currentPlayer] += game.timerSettings.incrementSeconds;
  
  console.log(`Added ${game.timerSettings.incrementSeconds}s increment to ${currentPlayer} in game ${gameId}`);
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Get user info from auth data
  const authData = socket.handshake.auth;
  let playerName = '';
  let userId = null;
  
  if (authData.isGuest) {
    playerName = `Guest${Math.floor(Math.random() * 9000) + 1000}`;
  } else if (authData.user && authData.user.username) {
    playerName = authData.user.username;
    userId = authData.user.id;
  } else {
    playerName = `Player${Math.floor(Math.random() * 9000) + 1000}`;
  }
  
  console.log(`${playerName} connected ${authData.isGuest ? '(guest)' : '(authenticated)'}`);

  socket.on('findMatch', (timerSettings) => {
    const playerId = socket.id;
    
    // Use standard timer settings for all online games
    const standardTimer = {
      timerEnabled: true,
      minutesPerPlayer: 10,
      incrementSeconds: 0
    };
    
    console.log(`Player ${playerName} looking for match with timer:`, standardTimer);
    
    if (waitingPlayers.length > 0) {
      // Match with waiting player
      const opponent = waitingPlayers.shift();
      const gameId = uuidv4();
      
      const gameState = {
        id: gameId,
        players: {
          white: { id: opponent.id, name: opponent.name, userId: opponent.userId, socket: opponent.socket },
          black: { id: playerId, name: playerName, userId: userId, socket: socket }
        },
        board: createEmptyBoard(),
        currentPlayer: 'white',
        gameStatus: 'active',
        moveHistory: [],
        scores: { white: 0, black: 0 },
        lastMove: null,
        timerSettings: standardTimer,
        timers: {
          white: standardTimer.minutesPerPlayer * 60,
          black: standardTimer.minutesPerPlayer * 60
        },
        timerInterval: null,
        lastMoveTime: Date.now()
      };
      
      games.set(gameId, gameState);
      
      // Join both players to game room
      socket.join(gameId);
      opponent.socket.join(gameId);
      
      // Notify both players
      opponent.socket.emit('gameStart', {
        gameId,
        playerColor: 'white',
        opponentName: playerName,
        timerSettings: standardTimer,
        gameState: {
          board: gameState.board,
          currentPlayer: gameState.currentPlayer,
          scores: gameState.scores,
          players: {
            white: opponent.name,
            black: playerName
          }
        },
        timers: gameState.timers
      });
      
      socket.emit('gameStart', {
        gameId,
        playerColor: 'black',
        opponentName: opponent.name,
        timerSettings: standardTimer,
        gameState: {
          board: gameState.board,
          currentPlayer: gameState.currentPlayer,
          scores: gameState.scores,
          players: {
            white: opponent.name,
            black: playerName
          }
        },
        timers: gameState.timers
      });
      
      // Start server-side timer
      if (standardTimer.timerEnabled) {
        startServerTimer(gameId);
      }
      
    } else {
      // Add to waiting list
      waitingPlayers.push({ id: playerId, name: playerName, userId: userId, socket });
      socket.emit('waitingForOpponent');
    }
  });

  socket.on('makeMove', ({ gameId, row, col }) => {
    const game = games.get(gameId);
    if (!game || game.gameStatus !== 'active') return;
    
    const playerColor = game.players.white.id === socket.id ? 'white' : 'black';
    if (game.currentPlayer !== playerColor) return;
    
    if (!isValidMove(game.board, row, col, playerColor)) return;
    
    // Place the ion
    game.board[row][col] = { color: playerColor, isNode: false };
    
    // Check for vectors
    const vectors = checkForVectors(game.board, row, col, playerColor);
    const { nodeType, removedCells } = processVectors(game.board, vectors, row, col);
    
    // If vectors were formed, make this cell a node
    if (nodeType) {
      game.board[row][col] = { color: playerColor, isNode: true, nodeType };
      // Recalculate scores for both players (vector formation can affect both)
      game.scores.white = countNodes(game.board, 'white');
      game.scores.black = countNodes(game.board, 'black');
    }
    
    // Check for nexus (winning condition)
    const nexus = checkForNexus(game.board, row, col, playerColor);
    let gameOver = false;
    let winner = null;
    
    if (nexus) {
      gameOver = true;
      winner = playerColor;
      game.gameStatus = 'finished';
    } else {
      // Switch players
      game.currentPlayer = game.currentPlayer === 'white' ? 'black' : 'white';
      
      // Check if next player has legal moves
      if (!hasLegalMoves(game.board, game.currentPlayer)) {
        gameOver = true;
        const whiteNodes = countNodes(game.board, 'white');
        const blackNodes = countNodes(game.board, 'black');
        
        if (whiteNodes > blackNodes) winner = 'white';
        else if (blackNodes > whiteNodes) winner = 'black';
        else winner = 'draw';
        
        game.gameStatus = 'finished';
      }
    }
    
    game.lastMove = { row, col, player: playerColor };
    game.moveHistory.push({ row, col, player: playerColor, vectors: vectors.length });
    
    // Add time increment for the player who just moved
    addTimeIncrement(gameId);
    
    // Stop timer if game is over, otherwise restart for next player
    if (gameOver) {
      stopServerTimer(gameId);
    } else if (game.timerSettings.timerEnabled) {
      // Restart timer for the new current player
      startServerTimer(gameId);
    }
    
    // Broadcast move to both players
    const moveData = {
      row,
      col,
      player: playerColor,
      vectors: vectors.length,
      nodeType,
      removedCells,
      board: game.board,
      currentPlayer: game.currentPlayer,
      scores: game.scores,
      gameOver,
      winner,
      nexus,
      timers: game.timers
    };
    
    io.to(gameId).emit('moveUpdate', moveData);
  });

  socket.on('cancelMatchmaking', () => {
    const index = waitingPlayers.findIndex(p => p.id === socket.id);
    if (index !== -1) {
      waitingPlayers.splice(index, 1);
    }
  });

  socket.on('resign', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game) return;
    
    const playerColor = game.players.white.id === socket.id ? 'white' : 'black';
    const winner = playerColor === 'white' ? 'black' : 'white';
    
    game.gameStatus = 'finished';
    stopServerTimer(gameId);
    
    io.to(gameId).emit('gameEnd', {
      winner,
      reason: 'resignation'
    });
  });

  // Draw offer handlers
  socket.on('draw-offer', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.gameStatus !== 'active') return;
    
    const playerColor = game.players.white.id === socket.id ? 'white' : 'black';
    const opponentColor = playerColor === 'white' ? 'black' : 'white';
    const opponentSocketId = game.players[opponentColor].id;
    
    // Send draw offer to opponent
    io.to(opponentSocketId).emit('drawOffered', {
      gameId,
      fromPlayer: playerColor,
      fromPlayerName: game.players[playerColor].name
    });
  });

  socket.on('draw-accept', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.gameStatus !== 'active') return;
    
    game.gameStatus = 'finished';
    stopServerTimer(gameId);
    
    // Notify both players that the game ended in a draw
    io.to(gameId).emit('drawAccepted');
    io.to(gameId).emit('gameEnd', {
      winner: null,
      reason: 'draw'
    });
  });

  socket.on('draw-decline', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.gameStatus !== 'active') return;
    
    const playerColor = game.players.white.id === socket.id ? 'white' : 'black';
    const opponentColor = playerColor === 'white' ? 'black' : 'white';
    const opponentSocketId = game.players[opponentColor].id;
    
    // Notify the player who offered the draw that it was declined
    io.to(opponentSocketId).emit('drawDeclined');
  });

  // Room-based multiplayer handlers
  socket.on('createRoom', () => {
    // Generate a 6-character room code
    let roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Ensure room code is unique
    while (rooms.has(roomCode)) {
      roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    
    const room = {
      code: roomCode,
      host: {
        id: socket.id,
        name: playerName,
        userId: userId,
        socket: socket
      },
      guest: null,
      gameId: null,
      status: 'waiting' // waiting, ready, active
    };
    
    rooms.set(roomCode, room);
    socket.join(`room-${roomCode}`);
    
    console.log(`Room ${roomCode} created by ${playerName}`);
    
    socket.emit('roomCreated', {
      roomCode,
      playerName,
      isHost: true
    });
  });

  socket.on('joinRoom', ({ roomCode }) => {
    const room = rooms.get(roomCode.toUpperCase());
    
    if (!room) {
      socket.emit('roomError', { message: 'Room not found' });
      return;
    }
    
    if (room.status !== 'waiting') {
      socket.emit('roomError', { message: 'Room is not available' });
      return;
    }
    
    if (room.guest) {
      socket.emit('roomError', { message: 'Room is full' });
      return;
    }
    
    if (room.host.id === socket.id) {
      socket.emit('roomError', { message: 'Cannot join your own room' });
      return;
    }
    
    // Add guest to room
    room.guest = {
      id: socket.id,
      name: playerName,
      userId: userId,
      socket: socket
    };
    room.status = 'ready';
    
    socket.join(`room-${roomCode}`);
    
    console.log(`${playerName} joined room ${roomCode}`);
    
    // Notify both players
    io.to(`room-${roomCode}`).emit('roomJoined', {
      roomCode,
      host: { name: room.host.name, userId: room.host.userId },
      guest: { name: room.guest.name, userId: room.guest.userId },
      status: room.status
    });
  });

  socket.on('startRoomGame', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    
    if (!room || room.status !== 'ready') {
      socket.emit('roomError', { message: 'Room is not ready to start' });
      return;
    }
    
    if (room.host.id !== socket.id) {
      socket.emit('roomError', { message: 'Only the host can start the game' });
      return;
    }
    
    // Create game
    const gameId = uuidv4();
    
    const standardTimer = {
      timerEnabled: true,
      minutesPerPlayer: 10,
      incrementSeconds: 0
    };
    
    const gameState = {
      id: gameId,
      players: {
        white: room.host,
        black: room.guest
      },
      board: createEmptyBoard(),
      currentPlayer: 'white',
      gameStatus: 'active',
      moveHistory: [],
      scores: { white: 0, black: 0 },
      lastMove: null,
      timerSettings: standardTimer,
      timers: {
        white: standardTimer.minutesPerPlayer * 60,
        black: standardTimer.minutesPerPlayer * 60
      },
      timerInterval: null,
      lastMoveTime: Date.now(),
      roomCode: roomCode // Track which room this game came from
    };
    
    games.set(gameId, gameState);
    room.gameId = gameId;
    room.status = 'active';
    
    // Move players from room to game room
    room.host.socket.leave(`room-${roomCode}`);
    room.guest.socket.leave(`room-${roomCode}`);
    room.host.socket.join(gameId);
    room.guest.socket.join(gameId);
    
    console.log(`Game ${gameId} started from room ${roomCode}`);
    
    // Notify both players
    room.host.socket.emit('gameStart', {
      gameId,
      playerColor: 'white',
      opponentName: room.guest.name,
      timerSettings: standardTimer,
      gameState: {
        board: gameState.board,
        currentPlayer: gameState.currentPlayer,
        scores: gameState.scores,
        players: {
          white: room.host.name,
          black: room.guest.name
        }
      },
      timers: gameState.timers,
      fromRoom: true
    });
    
    room.guest.socket.emit('gameStart', {
      gameId,
      playerColor: 'black',
      opponentName: room.host.name,
      timerSettings: standardTimer,
      gameState: {
        board: gameState.board,
        currentPlayer: gameState.currentPlayer,
        scores: gameState.scores,
        players: {
          white: room.host.name,
          black: room.guest.name
        }
      },
      timers: gameState.timers,
      fromRoom: true
    });
    
    // Start server-side timer
    if (standardTimer.timerEnabled) {
      startServerTimer(gameId);
    }
  });

  socket.on('leaveRoom', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    socket.leave(`room-${roomCode}`);
    
    if (room.host.id === socket.id) {
      // Host is leaving - notify guest and delete room
      if (room.guest) {
        room.guest.socket.emit('roomClosed', { message: 'Host left the room' });
        room.guest.socket.leave(`room-${roomCode}`);
      }
      rooms.delete(roomCode);
      console.log(`Room ${roomCode} closed - host left`);
    } else if (room.guest && room.guest.id === socket.id) {
      // Guest is leaving - notify host and reset room
      room.guest = null;
      room.status = 'waiting';
      room.host.socket.emit('guestLeft', { roomCode });
      console.log(`Guest left room ${roomCode}`);
    }
  });

  socket.on('test-connection', (data) => {
    console.log(`\n=== TEST CONNECTION ===`);
    console.log(`Test connection received from ${socket.id}:`, data);
    console.log(`Socket rooms:`, Array.from(socket.rooms));
    console.log(`All connected sockets:`, Array.from(io.sockets.sockets.keys()));
    
    // Send back a response
    socket.emit('test-connection-response', {
      message: 'Test connection successful',
      serverSocketId: socket.id,
      timestamp: Date.now(),
      originalData: data
    });
    
    // If this is part of a game, check the opponent
    if (data.gameId) {
      const game = games.get(data.gameId);
      if (game) {
        console.log(`Game found for test - Status: ${game.gameStatus}`);
        console.log(`Game players:`, {
          white: { id: game.players.white.id, name: game.players.white.name },
          black: { id: game.players.black.id, name: game.players.black.name }
        });
        
        const playerColor = game.players.white.id === socket.id ? 'white' : 'black';
        const opponentColor = playerColor === 'white' ? 'black' : 'white';
        const opponentSocketId = game.players[opponentColor].id;
        
        console.log(`Opponent socket ID: ${opponentSocketId}`);
        const opponentSocket = io.sockets.sockets.get(opponentSocketId);
        if (opponentSocket) {
          console.log(`✓ Opponent socket found and connected: ${opponentSocket.connected}`);
          console.log(`Opponent socket rooms:`, Array.from(opponentSocket.rooms));
          
          // Send test message to opponent
          io.to(opponentSocketId).emit('test-connection-from-opponent', {
            message: `Test message from ${game.players[playerColor].name}`,
            from: playerColor,
            timestamp: Date.now()
          });
          console.log(`✓ Sent test message to opponent`);
        } else {
          console.log(`✗ Opponent socket ${opponentSocketId} not found!`);
        }
      } else {
        console.log(`✗ Game ${data.gameId} not found`);
      }
    }
    console.log(`=== END TEST CONNECTION ===\n`);
  });

  socket.on('requestRematch', ({ gameId }) => {
    console.log(`\n=== REMATCH REQUEST DEBUG ===`);
    console.log(`Rematch request received from ${socket.id} for game ${gameId}`);
    console.log(`Current games:`, Array.from(games.keys()));
    console.log(`Current connected sockets:`, Array.from(io.sockets.sockets.keys()));
    
    const game = games.get(gameId);
    
    if (!game) {
      console.log(`ERROR: Game ${gameId} not found in games map`);
      console.log(`Available games:`, Array.from(games.entries()).map(([id, g]) => ({
        id,
        status: g.gameStatus,
        players: { white: g.players.white.id, black: g.players.black.id }
      })));
      return;
    }
    
    console.log(`Game found - Status: ${game.gameStatus}`);
    console.log(`Game players:`, {
      white: { id: game.players.white.id, name: game.players.white.name },
      black: { id: game.players.black.id, name: game.players.black.name }
    });
    
    if (game.gameStatus !== 'finished') {
      console.log(`ERROR: Game ${gameId} is not finished (status: ${game.gameStatus})`);
      return;
    }
    
    const playerColor = game.players.white.id === socket.id ? 'white' : 'black';
    const opponentColor = playerColor === 'white' ? 'black' : 'white';
    const opponentSocketId = game.players[opponentColor].id;
    
    console.log(`Player colors: ${playerColor} (${socket.id}) vs ${opponentColor} (${opponentSocketId})`);
    
    // Check if opponent socket exists
    const opponentSocket = io.sockets.sockets.get(opponentSocketId);
    if (opponentSocket) {
      console.log(`✓ Opponent socket found and connected: ${opponentSocket.connected}`);
      console.log(`Opponent socket rooms:`, Array.from(opponentSocket.rooms));
    } else {
      console.log(`✗ ERROR: Opponent socket ${opponentSocketId} not found!`);
      console.log(`Available sockets:`, Array.from(io.sockets.sockets.keys()));
      return;
    }
    
    // Mark this player as requesting rematch
    if (!game.rematchRequests) {
      game.rematchRequests = {};
    }
    game.rematchRequests[playerColor] = true;
    
    console.log(`Sending rematch request to opponent ${opponentSocketId}...`);
    
    // Notify opponent about rematch request
    const rematchData = {
      gameId,
      requester: playerColor,
      requesterName: game.players[playerColor].name
    };
    console.log(`Rematch data:`, rematchData);
    
    io.to(opponentSocketId).emit('rematchRequested', rematchData);
    console.log(`✓ Emitted rematchRequested event to ${opponentSocketId}`);
    
    // Notify requester that request was sent
    socket.emit('rematchRequestSent', { gameId });
    console.log(`✓ Sent confirmation to requester ${socket.id}`);
    console.log(`=== END REMATCH REQUEST DEBUG ===\n`);
  });

  socket.on('respondToRematch', ({ gameId, accept }) => {
    console.log(`Rematch response received from ${socket.id} for game ${gameId}: ${accept ? 'accepted' : 'declined'}`);
    const game = games.get(gameId);
    if (!game || game.gameStatus !== 'finished') return;
    
    const playerColor = game.players.white.id === socket.id ? 'white' : 'black';
    const opponentColor = playerColor === 'white' ? 'black' : 'white';
    const opponentSocketId = game.players[opponentColor].id;
    
    if (accept) {
      // Both players agreed to rematch - create new game
      const newGameId = uuidv4();
      
      // Use same timer settings as original game
      const timerSettings = game.timerSettings || {
        timerEnabled: true,
        minutesPerPlayer: 10,
        incrementSeconds: 0
      };
      
      // Swap colors for the rematch
      const newGameState = {
        id: newGameId,
        players: {
          white: game.players[opponentColor], // Swap colors
          black: game.players[playerColor]
        },
        board: createEmptyBoard(),
        currentPlayer: 'white',
        gameStatus: 'active',
        moveHistory: [],
        scores: { white: 0, black: 0 },
        lastMove: null,
        timerSettings: timerSettings,
        timers: {
          white: timerSettings.minutesPerPlayer * 60,
          black: timerSettings.minutesPerPlayer * 60
        },
        timerInterval: null,
        lastMoveTime: Date.now()
      };
      
      games.set(newGameId, newGameState);
      
      // Remove old game
      games.delete(gameId);
      
      // Update socket rooms
      socket.leave(gameId);
      io.sockets.sockets.get(opponentSocketId)?.leave(gameId);
      socket.join(newGameId);
      io.sockets.sockets.get(opponentSocketId)?.join(newGameId);
      
      // Notify both players about new game
      const whitePlayerName = newGameState.players.white.name;
      const blackPlayerName = newGameState.players.black.name;
      
      io.to(newGameState.players.white.id).emit('rematchAccepted', {
        gameId: newGameId,
        playerColor: 'white',
        opponentName: blackPlayerName,
        gameState: {
          board: newGameState.board,
          currentPlayer: newGameState.currentPlayer,
          scores: newGameState.scores,
          players: {
            white: whitePlayerName,
            black: blackPlayerName
          }
        },
        timers: newGameState.timers
      });
      
      io.to(newGameState.players.black.id).emit('rematchAccepted', {
        gameId: newGameId,
        playerColor: 'black',
        opponentName: whitePlayerName,
        gameState: {
          board: newGameState.board,
          currentPlayer: newGameState.currentPlayer,
          scores: newGameState.scores,
          players: {
            white: whitePlayerName,
            black: blackPlayerName
          }
        },
        timers: newGameState.timers
      });
      
      // Start server timer for new game
      if (timerSettings.timerEnabled) {
        startServerTimer(newGameId);
      }
      
    } else {
      // Rematch declined
      io.to(opponentSocketId).emit('rematchDeclined', { gameId });
      
      // Clean up rematch requests
      if (game.rematchRequests) {
        delete game.rematchRequests[opponentColor];
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove from waiting players
    const waitingIndex = waitingPlayers.findIndex(p => p.id === socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    
    // Handle room disconnection
    for (const [roomCode, room] of rooms.entries()) {
      if (room.host.id === socket.id) {
        // Host disconnected - notify guest and delete room
        if (room.guest) {
          room.guest.socket.emit('roomClosed', { message: 'Host disconnected' });
          room.guest.socket.leave(`room-${roomCode}`);
        }
        rooms.delete(roomCode);
        console.log(`Room ${roomCode} deleted - host disconnected`);
        break;
      } else if (room.guest && room.guest.id === socket.id) {
        // Guest disconnected - notify host and reset room
        room.guest = null;
        room.status = 'waiting';
        room.host.socket.emit('guestLeft', { roomCode, reason: 'disconnected' });
        console.log(`Guest disconnected from room ${roomCode}`);
        break;
      }
    }
    
    // Handle game disconnection
    for (const [gameId, game] of games.entries()) {
      if (game.players.white.id === socket.id || game.players.black.id === socket.id) {
        if (game.gameStatus === 'active') {
          const remainingPlayer = game.players.white.id === socket.id ? 
            game.players.black.socket : game.players.white.socket;
          
          stopServerTimer(gameId);
          remainingPlayer.emit('opponentDisconnected');
        }
        
        // Clean up associated room if game came from a room
        if (game.roomCode) {
          rooms.delete(game.roomCode);
          console.log(`Cleaned up room ${game.roomCode} after game ${gameId} ended`);
        }
        
        games.delete(gameId);
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 
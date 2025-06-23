const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Import authentication modules
const { initializeDatabase, createUser, getUserByEmail, getUserByUsername, verifyPassword } = require('./database');
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
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get user by username
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Verify password
    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
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

// Catch all handler: send back React's index.html file for any non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

// Game state management
const games = new Map();
const waitingPlayers = [];

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
        timerSettings: standardTimer
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
        }
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
        }
      });
      
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
      nexus
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
    
    io.to(gameId).emit('gameEnd', {
      winner,
      reason: 'resignation'
    });
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
        lastMove: null
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
        }
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
        }
      });
      
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
    
    // Handle game disconnection
    for (const [gameId, game] of games.entries()) {
      if (game.players.white.id === socket.id || game.players.black.id === socket.id) {
        if (game.gameStatus === 'active') {
          const remainingPlayer = game.players.white.id === socket.id ? 
            game.players.black.socket : game.players.white.socket;
          
          remainingPlayer.emit('opponentDisconnected');
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
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from React build
app.use(express.static(path.join(__dirname, '../client/build')));

// API routes would go here (none needed for this app)

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
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
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
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (board[row][col] && board[row][col].isNode && board[row][col].color === playerColor) {
        count++;
      }
    }
  }
  return count;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('findMatch', () => {
    const playerId = socket.id;
    const playerName = `Player${Math.floor(Math.random() * 9000) + 1000}`;
    
    if (waitingPlayers.length > 0) {
      // Match with waiting player
      const opponent = waitingPlayers.shift();
      const gameId = uuidv4();
      
      const gameState = {
        id: gameId,
        players: {
          white: { id: opponent.id, name: opponent.name, socket: opponent.socket },
          black: { id: playerId, name: playerName, socket: socket }
        },
        board: createEmptyBoard(),
        currentPlayer: 'white',
        gameStatus: 'active',
        moveHistory: [],
        scores: { white: 0, black: 0 },
        lastMove: null
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
      waitingPlayers.push({ id: playerId, name: playerName, socket });
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
      game.scores[playerColor] = countNodes(game.board, playerColor);
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
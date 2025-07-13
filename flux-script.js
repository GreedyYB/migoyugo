// Game state
let gameState = {
    board: Array(8).fill(null).map(() => Array(8).fill(null)),
    currentPlayer: 'white',
    gameStarted: false,
    gameMode: 'human',
    scores: { white: 0, black: 0 },
    moveHistory: []
};

// Initialize the game
document.addEventListener('DOMContentLoaded', function() {
    initializeBoard();
    setupEventListeners();
});

function initializeBoard() {
    const board = document.getElementById('game-board');
    board.innerHTML = '';
    
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.addEventListener('click', handleCellClick);
            board.appendChild(cell);
        }
    }
}

function setupEventListeners() {
    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('reset-btn').addEventListener('click', resetGame);
    document.getElementById('rules-btn').addEventListener('click', showRules);
}

function handleCellClick(event) {
    if (!gameState.gameStarted) return;
    
    const row = parseInt(event.target.dataset.row);
    const col = parseInt(event.target.dataset.col);
    
    if (isValidMove(row, col)) {
        makeMove(row, col);
    }
}

function isValidMove(row, col) {
    return gameState.board[row][col] === null;
}

function makeMove(row, col) {
    // Place the piece
    gameState.board[row][col] = {
        color: gameState.currentPlayer,
        isNode: false
    };
    
    // Update visual board
    updateCell(row, col);
    
    // Check for vectors
    const vectors = checkForVectors(row, col);
    if (vectors.length > 0) {
        processVectors(vectors, row, col);
    }
    
    // Check for nexus (win condition)
    const nexus = checkForNexus(row, col);
    if (nexus) {
        endGame(`${gameState.currentPlayer} wins with a Nexus!`);
        return;
    }
    
    // Switch players
    gameState.currentPlayer = gameState.currentPlayer === 'white' ? 'black' : 'white';
    updatePlayerDisplay();
    
    // AI move if needed
    if (gameState.gameMode.startsWith('ai') && gameState.currentPlayer === 'black') {
        setTimeout(makeAIMove, 500);
    }
}

function checkForVectors(row, col) {
    const directions = [
        [-1, 0], [-1, 1], [0, 1], [1, 1]
    ];
    const vectors = [];
    
    for (const [dr, dc] of directions) {
        const line = [{row, col}];
        
        // Check positive direction
        let r = row + dr, c = col + dc;
        while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
               gameState.board[r][c] && gameState.board[r][c].color === gameState.currentPlayer) {
            line.push({row: r, col: c});
            r += dr;
            c += dc;
        }
        
        // Check negative direction
        r = row - dr;
        c = col - dc;
        while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
               gameState.board[r][c] && gameState.board[r][c].color === gameState.currentPlayer) {
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

function processVectors(vectors, newRow, newCol) {
    // Remove ions from vectors (except the new placement and existing nodes)
    vectors.forEach(vector => {
        vector.forEach(cell => {
            if (!(cell.row === newRow && cell.col === newCol) && 
                gameState.board[cell.row][cell.col] && 
                !gameState.board[cell.row][cell.col].isNode) {
                gameState.board[cell.row][cell.col] = null;
                updateCell(cell.row, cell.col);
            }
        });
    });
    
    // Make the new placement a node
    gameState.board[newRow][newCol].isNode = true;
    updateCell(newRow, newCol);
    
    // Update score
    gameState.scores[gameState.currentPlayer]++;
    updateScoreDisplay();
}

function checkForNexus(row, col) {
    const directions = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
    ];
    
    for (const [dr, dc] of directions) {
        const line = [{row, col}];
        
        // Check positive direction
        let r = row + dr, c = col + dc;
        while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
               gameState.board[r][c] && gameState.board[r][c].isNode && 
               gameState.board[r][c].color === gameState.currentPlayer) {
            line.push({row: r, col: c});
            r += dr;
            c += dc;
        }
        
        // Check negative direction
        r = row - dr;
        c = col - dc;
        while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
               gameState.board[r][c] && gameState.board[r][c].isNode && 
               gameState.board[r][c].color === gameState.currentPlayer) {
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

function makeAIMove() {
    const move = getAIMove();
    if (move) {
        makeMove(move.row, move.col);
    }
}

function getAIMove() {
    // Simple AI: find first valid move
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (isValidMove(row, col)) {
                return {row, col};
            }
        }
    }
    return null;
}

function updateCell(row, col) {
    const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    cell.innerHTML = '';
    
    const piece = gameState.board[row][col];
    if (piece) {
        const ion = document.createElement('div');
        ion.className = `ion ${piece.color}`;
        if (piece.isNode) {
            ion.classList.add('node');
        }
        cell.appendChild(ion);
    }
}

function updatePlayerDisplay() {
    document.getElementById('player-white').classList.toggle('active', gameState.currentPlayer === 'white');
    document.getElementById('player-black').classList.toggle('active', gameState.currentPlayer === 'black');
}

function updateScoreDisplay() {
    document.getElementById('white-score').textContent = gameState.scores.white;
    document.getElementById('black-score').textContent = gameState.scores.black;
}

function startGame() {
    gameState.gameStarted = true;
    gameState.gameMode = document.getElementById('game-mode-select').value;
    document.getElementById('start-btn').disabled = true;
    updatePlayerDisplay();
}

function resetGame() {
    gameState = {
        board: Array(8).fill(null).map(() => Array(8).fill(null)),
        currentPlayer: 'white',
        gameStarted: false,
        gameMode: 'human',
        scores: { white: 0, black: 0 },
        moveHistory: []
    };
    
    initializeBoard();
    updatePlayerDisplay();
    updateScoreDisplay();
    document.getElementById('start-btn').disabled = false;
}

function endGame(message) {
    gameState.gameStarted = false;
    alert(message);
}

function showRules() {
    alert(`migoyugo Game Rules:

1. Players take turns placing pieces (ions) on the 8x8 board
2. White always goes first
3. Form vectors (lines of exactly 4 pieces) to create nodes
4. When you form a vector, the last piece becomes a node and other pieces in the vector are removed
5. Win by forming a nexus (4 nodes in a line) or having the most nodes when the board is full

Controls:
- Click Start to begin
- Click on empty squares to place your pieces
- Choose opponent type before starting`);
} 
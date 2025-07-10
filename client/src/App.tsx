import React, { useState, useEffect, useCallback, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import './kuyoku-styles.css';

// Types
interface Cell {
  color: 'white' | 'black' | null;
  isNode: boolean;
  nodeType?: 'standard' | 'double' | 'triple' | 'quadruple';
}

interface GameState {
  board: (Cell | null)[][];
  currentPlayer: 'white' | 'black';
  scores: { white: number; black: number };
  gameStatus: 'waiting' | 'active' | 'finished';
  lastMove: { row: number; col: number; player: 'white' | 'black' } | null;
  players: { white: string; black: string };
  nexusLine?: { row: number; col: number }[] | null;
}

interface MoveHistoryEntry {
  row: number;
  col: number;
  player: 'white' | 'black';
  vectors: number;
  moveNumber: number;
}

// Authentication types
interface User {
  id: string;
  username: string;
  email: string;
  stats: {
    gamesPlayed: number;
    wins: number;
    losses: number;
  };
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  isGuest: boolean;
}

const INITIAL_BOARD: (Cell | null)[][] = Array(8).fill(null).map(() => Array(8).fill(null));

// Local game logic functions
const isValidMove = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black'): boolean => {
  if (row < 0 || row >= 8 || col < 0 || col >= 8) return false;
  if (board[row][col] !== null) return false;
  return !wouldCreateLineTooLong(board, row, col, playerColor);
};

const wouldCreateLineTooLong = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black'): boolean => {
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
           board[r][c] && board[r][c]!.color === playerColor) {
      count++;
      r += dr;
      c += dc;
    }
    
    // Count in negative direction
    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
           board[r][c] && board[r][c]!.color === playerColor) {
      count++;
      r -= dr;
      c -= dc;
    }
    
    if (count > 4) return true;
  }
  
  return false;
};

const checkForVectors = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black') => {
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
           board[r][c] && board[r][c]!.color === playerColor) {
      line.push({row: r, col: c});
      r += dr;
      c += dc;
    }
    
    // Collect in negative direction
    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
           board[r][c] && board[r][c]!.color === playerColor) {
      line.unshift({row: r, col: c});
      r -= dr;
      c -= dc;
    }
    
    if (line.length === 4) {
      vectors.push(line);
    }
  }
  
  return vectors;
};

const processVectors = (board: (Cell | null)[][], vectors: any[], row: number, col: number) => {
  if (vectors.length === 0) return { nodeType: null, removedCells: [] };
  
  const removedCells: {row: number, col: number}[] = [];
  
  // Remove ions from vectors (except nodes and the new placement)
  vectors.forEach(vector => {
    vector.forEach((cell: {row: number, col: number}) => {
      if (!(cell.row === row && cell.col === col) && 
          board[cell.row][cell.col] && 
          !board[cell.row][cell.col]!.isNode) {
        removedCells.push({row: cell.row, col: cell.col});
        board[cell.row][cell.col] = null;
      }
    });
  });
  
  // Determine node type based on number of vectors
  let nodeType: 'standard' | 'double' | 'triple' | 'quadruple' = 'standard';
  if (vectors.length === 2) nodeType = 'double';
  else if (vectors.length === 3) nodeType = 'triple';
  else if (vectors.length === 4) nodeType = 'quadruple';
  
  return { nodeType, removedCells };
};

const checkForNexus = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black') => {
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
           board[r][c] && board[r][c]!.isNode && board[r][c]!.color === playerColor) {
      line.push({row: r, col: c});
      r += dr;
      c += dc;
    }
    
    // Collect in negative direction
    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && 
           board[r][c] && board[r][c]!.isNode && board[r][c]!.color === playerColor) {
      line.unshift({row: r, col: c});
      r -= dr;
      c -= dc;
    }
    
    if (line.length === 4) {
      return line;
    }
  }
  
  return null;
};

const hasLegalMoves = (board: (Cell | null)[][], playerColor: 'white' | 'black'): boolean => {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (isValidMove(board, row, col, playerColor)) {
        return true;
      }
    }
  }
  return false;
};

const countNodes = (board: (Cell | null)[][], playerColor: 'white' | 'black'): number => {
  let count = 0;
  console.log(`DEBUG: Counting nodes for ${playerColor}`);
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
        console.log(`DEBUG: Node at ${row},${col} type=${cell.nodeType} value=${nodeValue}`);
        count += nodeValue;
      }
    }
  }
  console.log(`DEBUG: Total count for ${playerColor}: ${count}`);
  return count;
};

// Authentication validation functions
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateUsername = (username: string): boolean => {
  const usernameRegex = /^[a-zA-Z][a-zA-Z0-9]{5,19}$/;
  return usernameRegex.test(username);
};

const validatePassword = (password: string): boolean => {
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*]/.test(password);
  const hasMinLength = password.length >= 8;
  
  return hasUppercase && hasLowercase && hasNumber && hasSpecialChar && hasMinLength;
};

const getPasswordStrengthMessage = (password: string): string => {
  const issues = [];
  if (password.length < 8) issues.push('at least 8 characters');
  if (!/[A-Z]/.test(password)) issues.push('one uppercase letter');
  if (!/[a-z]/.test(password)) issues.push('one lowercase letter');
  if (!/\d/.test(password)) issues.push('one number');
  if (!/[!@#$%^&*]/.test(password)) issues.push('one special character (!@#$%^&*)');
  
  return issues.length > 0 ? `Password must contain: ${issues.join(', ')}` : '';
};

// Advanced AI System for Level 4 (2200-2400 Elo equivalent)

// Transposition Table for position caching
interface TranspositionEntry {
  hash: string;
  depth: number;
  score: number;
  flag: 'exact' | 'lowerbound' | 'upperbound';
  bestMove: {row: number, col: number} | null;
  age: number;
}

class TranspositionTable {
  private table = new Map<string, TranspositionEntry>();
  private maxSize = 100000; // Limit memory usage
  private currentAge = 0;

  get(hash: string): TranspositionEntry | null {
    return this.table.get(hash) || null;
  }

  set(hash: string, entry: TranspositionEntry): void {
    entry.age = this.currentAge;
    
    if (this.table.size >= this.maxSize) {
      // Remove oldest entries
      const entries = Array.from(this.table.entries());
      entries.sort((a, b) => a[1].age - b[1].age);
      const toRemove = entries.slice(0, Math.floor(this.maxSize * 0.1));
      toRemove.forEach(([key]) => this.table.delete(key));
    }
    
    this.table.set(hash, entry);
  }

  clear(): void {
    this.table.clear();
    this.currentAge++;
  }
}

// Opening Book - Strong opening principles for Kuyoku
const openingBook = new Map<string, {row: number, col: number, weight: number}[]>([
  // Empty board - control center
  ['', [
    {row: 3, col: 3, weight: 100},
    {row: 4, col: 4, weight: 100},
    {row: 3, col: 4, weight: 90},
    {row: 4, col: 3, weight: 90},
    {row: 2, col: 3, weight: 80},
    {row: 3, col: 2, weight: 80},
    {row: 5, col: 4, weight: 80},
    {row: 4, col: 5, weight: 80}
  ]],
  
  // After white plays center - respond with center control
  ['wI3,3', [
    {row: 4, col: 4, weight: 100},
    {row: 3, col: 4, weight: 95},
    {row: 4, col: 3, weight: 95},
    {row: 2, col: 2, weight: 85},
    {row: 5, col: 5, weight: 85}
  ]],
  
  ['wI4,4', [
    {row: 3, col: 3, weight: 100},
    {row: 3, col: 4, weight: 95},
    {row: 4, col: 3, weight: 95},
    {row: 2, col: 2, weight: 85},
    {row: 5, col: 5, weight: 85}
  ]],
  
  // Diagonal responses
  ['wI3,4', [
    {row: 4, col: 3, weight: 100},
    {row: 3, col: 3, weight: 90},
    {row: 4, col: 4, weight: 90},
    {row: 2, col: 5, weight: 85},
    {row: 5, col: 2, weight: 85}
  ]],
  
  ['wI4,3', [
    {row: 3, col: 4, weight: 100},
    {row: 3, col: 3, weight: 90},
    {row: 4, col: 4, weight: 90},
    {row: 2, col: 5, weight: 85},
    {row: 5, col: 2, weight: 85}
  ]],
  
  // Second move responses (after AI plays center)
  ['wI3,3,bI4,4', [
    {row: 2, col: 2, weight: 100},
    {row: 5, col: 5, weight: 100},
    {row: 3, col: 4, weight: 90},
    {row: 4, col: 3, weight: 90}
  ]],
  
  ['wI4,4,bI3,3', [
    {row: 2, col: 2, weight: 100},
    {row: 5, col: 5, weight: 100},
    {row: 3, col: 4, weight: 90},
    {row: 4, col: 3, weight: 90}
  ]],
  
  // Edge opening responses
  ['wI2,2', [
    {row: 3, col: 3, weight: 100},
    {row: 4, col: 4, weight: 95},
    {row: 5, col: 5, weight: 90}
  ]],
  
  ['wI5,5', [
    {row: 4, col: 4, weight: 100},
    {row: 3, col: 3, weight: 95},
    {row: 2, col: 2, weight: 90}
  ]]
]);

// Helper functions
const getAllValidMoves = (board: (Cell | null)[][], playerColor: 'white' | 'black'): {row: number, col: number}[] => {
  const moves = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (isValidMove(board, row, col, playerColor)) {
        moves.push({row, col});
      }
    }
  }
  return moves;
};

const makeMove = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black'): (Cell | null)[][] => {
  const newBoard = board.map(r => [...r]);
  newBoard[row][col] = { color: playerColor, isNode: false };
  
  // Process vectors if any
  const vectors = checkForVectors(newBoard, row, col, playerColor);
  if (vectors.length > 0) {
    const result = processVectors(newBoard, vectors, row, col);
    if (result.nodeType) {
      newBoard[row][col] = { color: playerColor, isNode: true, nodeType: result.nodeType };
    }
  }
  
  return newBoard;
};

  const getBoardString = (board: (Cell | null)[][]): string => {
    return board.flat().map(cell => {
      if (!cell) return '';
      return `${cell.color![0]}${cell.isNode ? 'N' : 'I'}`;
    }).join(',');
  };

// Advanced position evaluation
const evaluatePosition = (board: (Cell | null)[][], playerColor: 'white' | 'black'): number => {
  const opponentColor = playerColor === 'white' ? 'black' : 'white';
  let score = 0;
  
  // 1. Material evaluation (nodes and their point values)
  const playerNodes = countNodes(board, playerColor);
  const opponentNodes = countNodes(board, opponentColor);
  score += (playerNodes - opponentNodes) * 100;
  
  // 2. Immediate threats (nexus and vector formations)
  score += evaluateThreats(board, playerColor);
  
  // 3. Positional factors
  score += evaluatePositional(board, playerColor);
  
  // 4. Strategic factors
  score += evaluateStrategic(board, playerColor);
  
  // 5. Tactical patterns
  score += evaluateTactical(board, playerColor);
  
  return score;
};

const evaluateThreats = (board: (Cell | null)[][], playerColor: 'white' | 'black'): number => {
  let score = 0;
  const opponentColor = playerColor === 'white' ? 'black' : 'white';
  
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (!isValidMove(board, row, col, playerColor)) continue;
      
      // Test move for player
      const testBoard = board.map(r => [...r]);
      testBoard[row][col] = { color: playerColor, isNode: false };
      
      // Check for vectors
      const vectors = checkForVectors(testBoard, row, col, playerColor);
      if (vectors.length > 0) {
        score += 1000 * vectors.length; // Vector formation bonus
      }
      
      // Check for nexus (with node)
      testBoard[row][col] = { color: playerColor, isNode: true, nodeType: 'standard' };
      const nexus = checkForNexus(testBoard, row, col, playerColor);
      if (nexus) {
        score += 10000; // Instant win
      }
      
      // Check blocking opponent threats
      const opponentTestBoard = board.map(r => [...r]);
      opponentTestBoard[row][col] = { color: opponentColor, isNode: false };
      const opponentVectors = checkForVectors(opponentTestBoard, row, col, opponentColor);
      if (opponentVectors.length > 0) {
        score += 800 * opponentVectors.length; // Block opponent vectors
      }
      
      opponentTestBoard[row][col] = { color: opponentColor, isNode: true, nodeType: 'standard' };
      const opponentNexus = checkForNexus(opponentTestBoard, row, col, opponentColor);
      if (opponentNexus) {
        score += 9000; // Block opponent nexus
      }
    }
  }
  
  return score;
};

const evaluatePositional = (board: (Cell | null)[][], playerColor: 'white' | 'black'): number => {
  let score = 0;
  const opponentColor = playerColor === 'white' ? 'black' : 'white';
  
  // Center control evaluation
  const centerSquares = [[3,3], [3,4], [4,3], [4,4]];
  for (const [row, col] of centerSquares) {
    const cell = board[row][col];
    if (cell?.color === playerColor) {
      score += 50;
    } else if (cell?.color === opponentColor) {
      score -= 50;
    }
  }
  
  // Extended center control
  const extendedCenter = [[2,2], [2,3], [2,4], [2,5], [3,2], [3,5], [4,2], [4,5], [5,2], [5,3], [5,4], [5,5]];
  for (const [row, col] of extendedCenter) {
    const cell = board[row][col];
    if (cell?.color === playerColor) {
      score += 20;
    } else if (cell?.color === opponentColor) {
      score -= 20;
    }
  }
  
  // Piece activity and mobility
  score += evaluateMobility(board, playerColor) - evaluateMobility(board, opponentColor);
  
  return score;
};

const evaluateMobility = (board: (Cell | null)[][], playerColor: 'white' | 'black'): number => {
  let mobility = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (isValidMove(board, row, col, playerColor)) {
        mobility++;
      }
    }
  }
  return mobility * 5; // Each possible move is worth 5 points
};

const evaluateStrategic = (board: (Cell | null)[][], playerColor: 'white' | 'black'): number => {
  let score = 0;
  
  // Connectivity bonus - pieces supporting each other
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cell = board[row][col];
      if (cell?.color === playerColor) {
        let connections = 0;
        const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
        
        for (const [dr, dc] of directions) {
          const newRow = row + dr;
          const newCol = col + dc;
          if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
            const adjCell = board[newRow][newCol];
            if (adjCell?.color === playerColor) {
              connections++;
            }
          }
        }
        
        score += connections * 15; // Connectivity bonus
        
        // Node protection bonus
        if (cell.isNode) {
          score += connections * 25; // Extra bonus for protecting nodes
        }
      }
    }
  }
  
  return score;
};

const evaluateTactical = (board: (Cell | null)[][], playerColor: 'white' | 'black'): number => {
  let score = 0;
  
  // Look for fork opportunities (moves that create multiple threats)
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (!isValidMove(board, row, col, playerColor)) continue;
      
      const testBoard = board.map(r => [...r]);
      testBoard[row][col] = { color: playerColor, isNode: false };
      
      let threats = 0;
      
      // Count potential vectors from this position
      const vectors = checkForVectors(testBoard, row, col, playerColor);
      threats += vectors.length;
      
      // Check if this move creates multiple line possibilities
      const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
      for (const [dr, dc] of directions) {
        let lineLength = 1;
        
        // Count in positive direction
        let r = row + dr, c = col + dc;
        while (r >= 0 && r < 8 && c >= 0 && c < 8 && testBoard[r][c]?.color === playerColor) {
          lineLength++;
          r += dr;
          c += dc;
        }
        
        // Count in negative direction
        r = row - dr;
        c = col - dc;
        while (r >= 0 && r < 8 && c >= 0 && c < 8 && testBoard[r][c]?.color === playerColor) {
          lineLength++;
          r -= dr;
          c -= dc;
        }
        
        if (lineLength >= 3) {
          threats++;
        }
      }
      
      if (threats >= 2) {
        score += 200 * threats; // Fork bonus
      }
    }
  }
  
  return score;
};

// Minimax with Alpha-Beta Pruning
const minimax = (
  board: (Cell | null)[][], 
  depth: number, 
  alpha: number, 
  beta: number, 
  isMaximizing: boolean, 
  playerColor: 'white' | 'black',
  transTable: TranspositionTable
): {score: number, bestMove: {row: number, col: number} | null} => {
  
  // Generate position hash for transposition table
  const positionHash = JSON.stringify(board);
  const ttEntry = transTable.get(positionHash);
  
  if (ttEntry && ttEntry.depth >= depth) {
    if (ttEntry.flag === 'exact') {
      return {score: ttEntry.score, bestMove: ttEntry.bestMove};
    } else if (ttEntry.flag === 'lowerbound' && ttEntry.score >= beta) {
      return {score: ttEntry.score, bestMove: ttEntry.bestMove};
    } else if (ttEntry.flag === 'upperbound' && ttEntry.score <= alpha) {
      return {score: ttEntry.score, bestMove: ttEntry.bestMove};
    }
  }
  
  // Base case
  if (depth === 0) {
    const score = evaluatePosition(board, playerColor);
    return {score, bestMove: null};
  }
  
  const currentColor = isMaximizing ? playerColor : (playerColor === 'white' ? 'black' : 'white');
  const moves = getAllValidMoves(board, currentColor);
  
  if (moves.length === 0) {
    const score = evaluatePosition(board, playerColor);
    return {score, bestMove: null};
  }
  
  // Move ordering - prioritize center moves and high-value squares
  moves.sort((a, b) => {
    const aScore = evaluateMove(board, a.row, a.col, currentColor, 'ai-4');
    const bScore = evaluateMove(board, b.row, b.col, currentColor, 'ai-4');
    return bScore - aScore;
  });
  
  let bestMove: {row: number, col: number} | null = null;
  let bestScore = isMaximizing ? -Infinity : Infinity;
  
  for (const move of moves) {
    const newBoard = makeMove(board, move.row, move.col, currentColor);
    const result = minimax(newBoard, depth - 1, alpha, beta, !isMaximizing, playerColor, transTable);
    
    if (isMaximizing) {
      if (result.score > bestScore) {
        bestScore = result.score;
        bestMove = move;
      }
      alpha = Math.max(alpha, result.score);
    } else {
      if (result.score < bestScore) {
        bestScore = result.score;
        bestMove = move;
      }
      beta = Math.min(beta, result.score);
    }
    
    if (beta <= alpha) {
      break; // Alpha-beta pruning
    }
  }
  
  // Store in transposition table
  const flag = bestScore <= alpha ? 'upperbound' : bestScore >= beta ? 'lowerbound' : 'exact';
  transTable.set(positionHash, {
    hash: positionHash,
    depth,
    score: bestScore,
    flag,
    bestMove,
    age: 0
  });
  
  return {score: bestScore, bestMove};
};

// Global transposition table instance
const globalTransTable = new TranspositionTable();

// Check for "adjacent nodes + ion sacrifice" threat pattern (the tactic user discovered)
const checkAdjacentNodeThreat = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black'): boolean => {
  // This detects the pattern: Node-Node-Empty-Ion where Ion can sacrifice to create double threat
  const directions = [
    [-1, 0], [1, 0],   // vertical
    [0, -1], [0, 1],   // horizontal  
    [-1, -1], [1, 1],  // diagonal \
    [-1, 1], [1, -1]   // diagonal /
  ];
  
  for (const [dr, dc] of directions) {
    // Check if placing ion here creates the dangerous pattern
    // Pattern: [Node][Node][Empty][Ion-position][Empty] or [Empty][Ion-position][Empty][Node][Node]
    
    // Look in one direction for: Node-Node-Empty sequence
    let r = row + dr;
    let c = col + dc;
    
    // Check if next position is empty
    if (r >= 0 && r < 8 && c >= 0 && c < 8 && !board[r][c]) {
      // Look further for two adjacent nodes
      r += dr;
      c += dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8 && 
          board[r][c]?.color === playerColor && board[r][c]?.isNode) {
        
        r += dr;
        c += dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8 && 
            board[r][c]?.color === playerColor && board[r][c]?.isNode) {
          
          // Found pattern: [Ion][Empty][Node][Node] - this creates double threat
          return true;
        }
      }
    }
    
    // Check opposite direction for: Empty-Node-Node sequence  
    r = row - dr;
    c = col - dc;
    
    if (r >= 0 && r < 8 && c >= 0 && c < 8 && !board[r][c]) {
      r -= dr;
      c -= dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8 && 
          board[r][c]?.color === playerColor && board[r][c]?.isNode) {
        
        r -= dr;
        c -= dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8 && 
            board[r][c]?.color === playerColor && board[r][c]?.isNode) {
          
          // Found pattern: [Node][Node][Empty][Ion] - this creates double threat
          return true;
        }
      }
    }
  }
  
  return false;
};

// Helper function: Detects if placing a piece at (row, col) for playerColor creates three connected nodes with open ends
const createsDoubleEndedNodeThreat = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black'): boolean => {
  const directions = [
    [0, 1], [1, 0], [1, 1], [1, -1]
  ];
  for (const [dr, dc] of directions) {
    let count = 1;
    let ends = [false, false];
    // Forward direction
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c]?.color === playerColor && board[r][c]?.isNode) {
      count++;
      r += dr;
      c += dc;
    }
    if (r >= 0 && r < 8 && c >= 0 && c < 8 && !board[r][c]) ends[0] = true;
    // Backward direction
    r = row - dr; c = col - dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c]?.color === playerColor && board[r][c]?.isNode) {
      count++;
      r -= dr;
      c -= dc;
    }
    if (r >= 0 && r < 8 && c >= 0 && c < 8 && !board[r][c]) ends[1] = true;
    if (count === 3 && ends[0] && ends[1]) {
      return true;
    }
  }
  return false;
};

// Enhanced AI-4 evaluation with 2-ply lookahead (uses extra thinking time)
const evaluateAI4Move = (board: (Cell | null)[][], row: number, col: number): number => {
  let score = 0;
  const playerColor = 'black';
  const opponentColor = 'white';
  
  // Create test board
  const testBoard = board.map(r => [...r]);
  testBoard[row][col] = { color: playerColor, isNode: false };
  
  // PRIORITY 1: Vector Formation (instant scoring)
  const vectors = checkForVectors(testBoard, row, col, playerColor);
  if (vectors.length > 0) {
    score += 2000 * vectors.length; // Huge bonus for vectors
  }
  
  // PRIORITY 2: Check for nexus (instant win)
  if (vectors.length > 0) {
    testBoard[row][col] = { color: playerColor, isNode: true, nodeType: 'standard' };
    const nexus = checkForNexus(testBoard, row, col, playerColor);
    if (nexus) {
      score += 10000; // Instant win
    }
  }
  
  // PRIORITY 3: Block opponent threats (ENHANCED - nearly equal to vector formation)
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isValidMove(board, r, c, opponentColor) && r === row && c === col) {
        const opponentTestBoard = board.map(row => [...row]);
        opponentTestBoard[r][c] = { color: opponentColor, isNode: false };
        const opponentVectors = checkForVectors(opponentTestBoard, r, c, opponentColor);
        
        if (opponentVectors.length > 0) {
          score += 1900 * opponentVectors.length; // INCREASED: Almost as important as making vectors
          
          // Check if opponent can win with nexus
          opponentTestBoard[r][c] = { color: opponentColor, isNode: true, nodeType: 'standard' };
          const opponentNexus = checkForNexus(opponentTestBoard, r, c, opponentColor);
          if (opponentNexus) {
            score += 9500; // INCREASED: Must block winning moves
          }
        }
        
        // NEW: Check for "adjacent nodes + ion sacrifice" threat pattern
        const adjacentNodeThreat = checkAdjacentNodeThreat(board, r, c, opponentColor);
        if (adjacentNodeThreat) {
          score += 1800; // High priority - this creates double threats
        }
      }
    }
  }
  
  // PRIORITY 4: 2-PLY LOOKAHEAD (uses extra thinking time for deeper analysis)
  // After making this move, what are opponent's best responses?
  let bestOpponentResponse = -Infinity;
  let opponentMoves = 0;
  
  for (let r = 0; r < 8 && opponentMoves < 8; r++) { // Limit to 8 moves for performance
    for (let c = 0; c < 8 && opponentMoves < 8; c++) {
      if (isValidMove(testBoard, r, c, opponentColor)) {
        opponentMoves++;
        const opponentBoard = testBoard.map(row => [...row]);
        opponentBoard[r][c] = { color: opponentColor, isNode: false };
        
        let opponentScore = 0;
        
        // Check if opponent can form vectors
        const opponentVectors = checkForVectors(opponentBoard, r, c, opponentColor);
        if (opponentVectors.length > 0) {
          opponentScore += 2000 * opponentVectors.length;
          
          // Check if opponent can win with nexus
          opponentBoard[r][c] = { color: opponentColor, isNode: true, nodeType: 'standard' };
          const opponentNexus = checkForNexus(opponentBoard, r, c, opponentColor);
          if (opponentNexus) {
            opponentScore += 10000; // Opponent wins
          }
        }
        
        // Add positional value for opponent
        const oppCenterDist = Math.abs(r - 3.5) + Math.abs(c - 3.5);
        opponentScore += (7 - oppCenterDist) * 10;
        
        bestOpponentResponse = Math.max(bestOpponentResponse, opponentScore);
      }
    }
  }
  
  // Subtract opponent's best response potential (defensive thinking)
  if (bestOpponentResponse > -Infinity) {
    score -= bestOpponentResponse * 0.8; // 80% weight to opponent threats
  }
  
  // PRIORITY 5: Positional factors
  const centerDistance = Math.abs(row - 3.5) + Math.abs(col - 3.5);
  score += (7 - centerDistance) * 15; // Center control
  
  // PRIORITY 6: Connectivity (piece support)
  let connections = 0;
  const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
  for (const [dr, dc] of directions) {
    const newRow = row + dr;
    const newCol = col + dc;
    if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
      if (board[newRow][newCol]?.color === playerColor) {
        connections++;
      }
    }
  }
  score += connections * 25;
  
  // PRIORITY 7: Line potential (setup for future vectors)
  for (const [dr, dc] of directions) {
    let lineLength = 1;
    
    // Count in positive direction
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c]?.color === playerColor) {
      lineLength++;
      r += dr;
      c += dc;
    }
    
    // Count in negative direction
    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c]?.color === playerColor) {
      lineLength++;
      r -= dr;
      c -= dc;
    }
    
    if (lineLength >= 3) {
      score += 100 * lineLength; // Bonus for potential lines
    }
  }
  
  // PRIORITY 8: Fork opportunities (multiple threats)
  let forkPotential = 0;
  for (const [dr, dc] of directions) {
    let potentialLines = 0;
    const r1 = row + dr, c1 = col + dc;
    const r2 = row - dr, c2 = col - dc;
    
    if (r1 >= 0 && r1 < 8 && c1 >= 0 && c1 < 8 && !board[r1][c1]) {
      if (r1 + dr >= 0 && r1 + dr < 8 && c1 + dc >= 0 && c1 + dc < 8 && 
          board[r1 + dr][c1 + dc]?.color === playerColor) {
        potentialLines++;
      }
    }
    
    if (r2 >= 0 && r2 < 8 && c2 >= 0 && c2 < 8 && !board[r2][c2]) {
      if (r2 - dr >= 0 && r2 - dr < 8 && c2 - dc >= 0 && c2 - dc < 8 && 
          board[r2 - dr][c2 - dc]?.color === playerColor) {
        potentialLines++;
      }
    }
    
    forkPotential += potentialLines;
  }
  
  if (forkPotential >= 2) {
    score += 300 * forkPotential; // Bonus for creating multiple threats
  }
  
  return score;
};

// Simple AI logic
// AI Helper Functions
const evaluateMove = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black', difficulty: 'ai-1' | 'ai-2' | 'ai-3' | 'ai-4'): number => {
  // For AI-4, use the advanced evaluation
  if (difficulty === 'ai-4') {
    const testBoard = makeMove(board, row, col, playerColor);
    return evaluatePosition(testBoard, playerColor);
  }
  
  // Original evaluation for AI-1, AI-2, AI-3
  let score = 0;
  const opponentColor = playerColor === 'white' ? 'black' : 'white';
  
  // Create a copy of the board with the move played
  const testBoard = board.map(r => [...r]);
  testBoard[row][col] = { color: playerColor, isNode: false };
  
  // PRIORITY 1: Vector Formation (immediate win condition)
  const vectors = checkForVectors(testBoard, row, col, playerColor);
  if (vectors.length > 0) {
    score += 1000 * vectors.length; // Massive bonus for forming vectors
  }
  
  // PRIORITY 2: Block Opponent Threats (prevent opponent from winning)
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isValidMove(board, r, c, opponentColor)) {
        const opponentTestBoard = board.map(row => [...row]);
        opponentTestBoard[r][c] = { color: opponentColor, isNode: false };
        const opponentVectors = checkForVectors(opponentTestBoard, r, c, opponentColor);
        
        // Check for nexus threat (opponent can win immediately)
        opponentTestBoard[r][c] = { color: opponentColor, isNode: true, nodeType: 'standard' };
        const opponentNexus = checkForNexus(opponentTestBoard, r, c, opponentColor);
        
        if ((opponentVectors.length > 0 || opponentNexus) && r === row && c === col) {
          score += opponentNexus ? 9000 : 800; // Massive bonus for blocking nexus, high for vectors
        }
      }
    }
  }
  
  // PRIORITY 3: Check for Nexus Formation (game winner)
  testBoard[row][col] = { color: playerColor, isNode: true, nodeType: 'standard' };
  const nexus = checkForNexus(testBoard, row, col, playerColor);
  if (nexus) {
    score += 10000; // Instant win
  }
  
  // PRIORITY 4: Node Building (scoring opportunities)
  if (vectors.length > 0) {
    const nodeValue = vectors.length === 1 ? 1 : vectors.length === 2 ? 2 : vectors.length === 3 ? 3 : 4;
    score += nodeValue * 100; // Bonus based on node type
  }
  
  // PRIORITY 5: Center Control (general good play)
  const centerDistance = Math.abs(row - 3.5) + Math.abs(col - 3.5);
  score += (7 - centerDistance) * 10; // Prefer center positions
  
  // PRIORITY 6: Support Structures (set up future vectors)
  let supportCount = 0;
  const directions = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];
  for (const [dr, dc] of directions) {
    const adjRow = row + dr;
    const adjCol = col + dc;
    if (adjRow >= 0 && adjRow < 8 && adjCol >= 0 && adjCol < 8) {
      if (board[adjRow][adjCol] && board[adjRow][adjCol]!.color === playerColor) {
        supportCount++;
      }
    }
  }
  score += supportCount * 20; // Bonus for connecting with own pieces
  
  // Level 1 specific: Add some small evaluation noise to make it less perfect
  if (difficulty === 'ai-1') {
    score += Math.random() * 40 - 20; // ±20 point variation
  }
  
  return score;
};

// Advanced AI evaluation for Level 3 - Minimax with lookahead
// Simplified AI evaluation - removed complex alpha-beta for performance

const getAIMove = (board: (Cell | null)[][], difficulty: 'ai-1' | 'ai-2' | 'ai-3' | 'ai-4'): {row: number, col: number} | null => {
  // AI-4: Simplified strong AI (avoiding infinite loops)
  if (difficulty === 'ai-4') {
    // Must-block threat detection: block any cell where white can create a double-ended node threat next turn
    const mustBlockCells: {row: number, col: number}[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (!board[row][col]) {
          // Simulate white playing here
          const testBoard = board.map(r => [...r]);
          testBoard[row][col] = { color: 'white', isNode: false };
          // Check if this creates a double-ended node threat for white
          if (createsDoubleEndedNodeThreat(testBoard, row, col, 'white')) {
            mustBlockCells.push({row, col});
          }
        }
      }
    }
    if (mustBlockCells.length > 0) {
      // Pick the must-block cell with the best positional score
      let best = mustBlockCells[0];
      let bestScore = -Infinity;
      for (const cell of mustBlockCells) {
        const score = evaluateAI4Move(board, cell.row, cell.col);
        if (score > bestScore) {
          bestScore = score;
          best = cell;
        }
      }
      return best;
    }
    
    // Check opening book first
    const totalPieces = board.flat().filter(cell => cell !== null).length;
    
    // Opening book for first few moves
    if (totalPieces <= 3) {
      const centerMoves = [
        {row: 3, col: 3}, {row: 4, col: 4}, {row: 3, col: 4}, {row: 4, col: 3},
        {row: 2, col: 3}, {row: 3, col: 2}, {row: 5, col: 4}, {row: 4, col: 5}
      ];
      
      for (const move of centerMoves) {
        if (isValidMove(board, move.row, move.col, 'black')) {
          return move;
        }
      }
    }
    
    // Use enhanced tactical evaluation (depth 3 for performance)
    const validMoves: {row: number, col: number, score: number}[] = [];
    
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (isValidMove(board, row, col, 'black')) {
          const score = evaluateAI4Move(board, row, col);
          validMoves.push({row, col, score});
        }
      }
    }
    
    if (validMoves.length === 0) return null;
    
    // Sort and take best move
    validMoves.sort((a, b) => b.score - a.score);
    return validMoves[0];
  }
  
  // Original AI logic for levels 1-3
  const validMoves: {row: number, col: number, score: number}[] = [];
  
  // Evaluate all valid moves
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (isValidMove(board, row, col, 'black')) {
        const score = evaluateMove(board, row, col, 'black', difficulty);
        validMoves.push({row, col, score});
      }
    }
  }
  
  if (validMoves.length === 0) return null;
  
  if (difficulty === 'ai-1') {
    // Level 1 (~1000 Elo): Logical but imperfect play
    // Sort moves by score and pick from top 3 moves to add variety while staying competitive
    validMoves.sort((a, b) => b.score - a.score);
    const topMoves = validMoves.slice(0, Math.min(3, validMoves.length));
    return topMoves[Math.floor(Math.random() * topMoves.length)];
    
  } else if (difficulty === 'ai-2') {
    // Level 2 (~1400 Elo): Strong strategic play with perfect threat blocking
    validMoves.sort((a, b) => b.score - a.score);
    
    // Check if there are any critical blocking moves (800+ points = threat blocking)
    const criticalMoves = validMoves.filter(move => move.score >= 800);
    if (criticalMoves.length > 0) {
      // Always take the highest scoring critical move (perfect threat blocking)
      return criticalMoves[0];
    }
    
    // For non-critical moves, pick from top 5 moves for stronger but varied play
    const topMoves = validMoves.slice(0, Math.min(5, validMoves.length));
    return topMoves[Math.floor(Math.random() * topMoves.length)];
    
  } else {
    // Level 3 (~1600 Elo): Enhanced tactical play - ZERO RANDOMNESS, FAST RESPONSE
    validMoves.sort((a, b) => b.score - a.score);
    
    // Simple opening preference for center control
    const totalMoves = board.flat().filter(cell => cell !== null).length;
    if (totalMoves <= 2) {
      const centerMoves = [{row: 3, col: 3}, {row: 4, col: 4}, {row: 3, col: 4}, {row: 4, col: 3}];
      for (const center of centerMoves) {
        if (isValidMove(board, center.row, center.col, 'black')) {
          return center;
        }
      }
    }
    
    // Always block critical threats (9000+ = nexus threats)
    const criticalMoves = validMoves.filter(move => move.score >= 9000);
    if (criticalMoves.length > 0) {
      return criticalMoves[0];
    }
    
    // Always take winning opportunities (1000+ = win opportunities or threat blocks)  
    const winningMoves = validMoves.filter(move => move.score >= 1000);
    if (winningMoves.length > 0) {
      return winningMoves[0];
    }
    
    // For positional play: Enhanced evaluation of top moves only
    const topMoves = validMoves.slice(0, Math.min(5, validMoves.length));
    
    // Add simple lookahead bonus for the best moves
    for (const move of topMoves) {
      // Quick positional bonus for center control and connectivity
      const centerDistance = Math.abs(3.5 - move.row) + Math.abs(3.5 - move.col);
      const centerBonus = Math.max(0, 6 - centerDistance) * 2;
      
      // Connectivity bonus - check if move connects to existing pieces
      let connectivityBonus = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = move.row + dr;
          const nc = move.col + dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc]?.color === 'black') {
            connectivityBonus += 3;
          }
        }
      }
      
      move.score += centerBonus + connectivityBonus;
    }
    
    // Sort enhanced moves and take the best
    topMoves.sort((a, b) => b.score - a.score);
    return topMoves[0];
  }
};

// Helper function to get API URL
const getApiUrl = () => {
  return process.env.NODE_ENV === 'production' 
    ? process.env.REACT_APP_API_URL || 'https://web-production-7dd44.up.railway.app'
    : '';
};

// Tutorial animation helper functions
const createTutorialIon = (color: string): HTMLElement => {
  const ion = document.createElement('div');
  ion.className = `tutorial-demo-ion ${color}`;
  ion.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 50%;
    transition: all 0.3s ease;
    ${color === 'white' 
      ? 'background: #ecf0f1; border: 2px solid #2c3e50; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);'
      : 'background: #2c3e50; border: 2px solid #1a252f; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);'
    }
  `;
  return ion;
};

const addTutorialStyles = () => {
  if (!document.querySelector('#tutorial-animations')) {
    const style = document.createElement('style');
    style.id = 'tutorial-animations';
    style.textContent = `
      @keyframes ionAppear {
        0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
        50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.7; }
        100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      }
      .ion-appear { animation: ionAppear 0.5s ease-out forwards; }
      @keyframes ionFade {
        0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
      }
      .ion-fade { animation: ionFade 0.5s ease-out forwards !important; }
      @keyframes pulse {
        0% { transform: translateX(-50%) scale(1); opacity: 1; }
        50% { transform: translateX(-50%) scale(1.2); opacity: 0.7; }
        100% { transform: translateX(-50%) scale(1); opacity: 1; }
      }
      .pulsing-arrow { animation: pulse 1s infinite; }
      @keyframes nexus-pulse {
        0% { 
          box-shadow: inset 0 0 10px 2px rgba(212, 175, 55, 0.4);
          background-color: rgba(212, 175, 55, 0.2);
        }
        50% { 
          box-shadow: inset 0 0 20px 5px rgba(212, 175, 55, 0.7);
          background-color: rgba(212, 175, 55, 0.4);
        }
        100% { 
          box-shadow: inset 0 0 10px 2px rgba(212, 175, 55, 0.4);
          background-color: rgba(212, 175, 55, 0.2);
        }
      }
      @keyframes nodeAppear {
        0% {
          transform: translate(-50%, -50%) scale(0);
          opacity: 0;
        }
        50% {
          transform: translate(-50%, -50%) scale(1.2);
          opacity: 0.7;
        }
        100% {
          transform: translate(-50%, -50%) scale(1);
          opacity: 1;
        }
      }
      .node-appear {
        animation: nodeAppear 0.5s ease-out forwards;
      }
      .node-fade {
        animation: nodeFade 0.5s ease-out forwards !important;
      }
      @keyframes nodeFade {
        0% {
          transform: translate(-50%, -50%) scale(1);
          opacity: 1;
        }
        100% {
          transform: translate(-50%, -50%) scale(0.8);
          opacity: 0;
        }
      }
      .tutorial-demo-ion {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        transition: transform 0.3s ease;
      }
      .tutorial-demo-ion.node::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 8px;
        height: 8px;
        background-color: #e74c3c;
        border-radius: 50%;
        z-index: 2;
      }
    `;
    document.head.appendChild(style);
  }
};

const setupBoardDemo = (container: HTMLElement, animationRef: React.MutableRefObject<NodeJS.Timeout | null>) => {
  addTutorialStyles();
  const board = document.createElement('div');
  board.className = 'tutorial-demo-board';
  board.style.cssText = `
    display: grid;
    grid-template-columns: repeat(8, 30px);
    grid-template-rows: repeat(8, 30px);
    gap: 1px;
    background: #bdc3c7;
    padding: 5px;
    border-radius: 5px;
    border: 2px solid #2c3e50;
  `;

  for (let i = 0; i < 64; i++) {
    const cell = document.createElement('div');
    cell.className = 'tutorial-demo-cell';
    cell.style.cssText = `
      background: #d1e6f9;
      border-radius: 2px;
      position: relative;
      transition: background-color 0.2s;
    `;
    board.appendChild(cell);
  }

  container.appendChild(board);

  // Define the sequence of 8 moves
  const moves = [
    { color: 'white', pos: 'D5', cell: 8 * (8 - 5) + (3) },  // WD5
    { color: 'black', pos: 'F3', cell: 8 * (8 - 3) + (5) },  // BF3
    { color: 'white', pos: 'D4', cell: 8 * (8 - 4) + (3) },  // WD4
    { color: 'black', pos: 'F4', cell: 8 * (8 - 4) + (5) },  // BF4
    { color: 'white', pos: 'F5', cell: 8 * (8 - 5) + (5) },  // WF5
    { color: 'black', pos: 'E5', cell: 8 * (8 - 5) + (4) },  // BE5
    { color: 'white', pos: 'C4', cell: 8 * (8 - 4) + (2) },  // WC4
    { color: 'black', pos: 'D6', cell: 8 * (8 - 6) + (3) }   // BD6
  ];

  let currentMove = 0;
  
  const createAnimatedIon = (color: string) => {
    const ion = createTutorialIon(color);
    ion.classList.add('ion-appear');
    return ion;
  };
  
  const placeMove = () => {
    if (currentMove < moves.length) {
      const move = moves[currentMove];
      const ion = createAnimatedIon(move.color);
      board.children[move.cell].appendChild(ion);
      currentMove++;
      animationRef.current = setTimeout(placeMove, 1000);
    } else {
      // Wait 2 seconds before fading
      animationRef.current = setTimeout(() => {
        Array.from(board.children).forEach(cell => {
          const ion = cell.querySelector('.tutorial-demo-ion');
          if (ion) ion.classList.add('ion-fade');
        });
        
        animationRef.current = setTimeout(() => {
          clearTutorialBoard(board);
          currentMove = 0;
          placeMove();
        }, 500);
      }, 2000);
    }
  };

  animationRef.current = setTimeout(placeMove, 1000);
};

const setupVectorDemo = (container: HTMLElement, animationRef: React.MutableRefObject<NodeJS.Timeout | null>) => {
  addTutorialStyles();
  const board = createSmallBoard();
  container.appendChild(board);
  
  let step = 0;
  const whiteRow = [6, 7, 8, 9];    // Second row cells
  const blackRow = [12, 13, 14, 15]; // Third row cells
  
  const createPulsingArrow = () => {
    const arrow = document.createElement('div');
    arrow.className = 'pulsing-arrow';
    arrow.style.cssText = `
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 15px solid #2ecc71;
      animation: pulse 1s infinite;
    `;
    return arrow;
  };

  const createAnimatedIon = (color: string) => {
    const ion = createTutorialIon(color);
    ion.classList.add('ion-appear');
    return ion;
  };

  const resetDemo = () => {
    step = 0;
    startSequence();
  };

  const startSequence = () => {
    const sequence = () => {
      if (step < 6) { // Place first three pairs of ions
        const isWhite = step % 2 === 0;
        const cellIndex = Math.floor(step / 2);
        const ion = createAnimatedIon(isWhite ? 'white' : 'black');
        board.children[isWhite ? whiteRow[cellIndex] : blackRow[cellIndex]].appendChild(ion);
        step++;
        animationRef.current = setTimeout(sequence, 1000);
      } else if (step === 6) { // Add pulsing arrow only for white's fourth position
        const whiteArrow = createPulsingArrow();
        board.children[whiteRow[3]].appendChild(whiteArrow);
        step++;
        animationRef.current = setTimeout(sequence, 2000);
      } else if (step === 7) { // Place final white ion and highlight
        // Remove arrow
        const fourthCell = board.children[whiteRow[3]] as HTMLElement;
        const arrow = fourthCell.querySelector('.pulsing-arrow');
        if (arrow) fourthCell.removeChild(arrow);
        
        // Place final white ion
        const whiteIon = createAnimatedIon('white');
        fourthCell.appendChild(whiteIon);
        
        // Highlight only the white vector
        whiteRow.forEach(cellIndex => {
          const cell = board.children[cellIndex] as HTMLElement;
          cell.style.backgroundColor = 'rgba(46, 204, 113, 0.3)';
          cell.style.boxShadow = 'inset 0 0 10px rgba(46, 204, 113, 0.5)';
          cell.style.transition = 'all 0.5s ease';
        });
        
        step++;
        // Wait 3 seconds before fading everything
        animationRef.current = setTimeout(() => {
          // Fade out both ions and highlighting together
          Array.from(board.children).forEach(cell => {
            const ion = (cell as HTMLElement).querySelector('.tutorial-demo-ion');
            if (ion) ion.classList.add('ion-fade');
            (cell as HTMLElement).style.backgroundColor = '#d1e6f9';
            (cell as HTMLElement).style.boxShadow = 'none';
          });
          
          // Wait for fade animation to complete before cleanup
          animationRef.current = setTimeout(() => {
            clearTutorialBoard(board);
            resetDemo();
          }, 500);
        }, 3000);
      }
    };
    
    // Start with 1 second delay
    animationRef.current = setTimeout(sequence, 1000);
  };

  // Start the animation sequence with 1 second delay
  animationRef.current = setTimeout(startSequence, 1000);
};

const setupNodeDemo = (container: HTMLElement, animationRef: React.MutableRefObject<NodeJS.Timeout | null>) => {
  addTutorialStyles();
  const board = createSmallBoard();
  container.appendChild(board);
  
  let step = 0;
  const moves = [
    { color: 'white', pos: [1, 1] },
    { color: 'black', pos: [2, 1] },
    { color: 'white', pos: [1, 2] },
    { color: 'black', pos: [2, 2] },
    { color: 'white', pos: [1, 3] },
    { color: 'black', pos: [2, 3] },
    { color: 'white', pos: [1, 4] }  // Final move that creates the vector
  ];
  
  const createPulsingArrow = () => {
    const arrow = document.createElement('div');
    arrow.className = 'pulsing-arrow';
    arrow.style.cssText = `
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 15px solid #2ecc71;
      animation: pulse 1s infinite;
    `;
    return arrow;
  };

  const createAnimatedIon = (color: string, isNode = false) => {
    const ion = createTutorialIon(color);
    if (isNode) {
      ion.classList.add('node');
    }
    ion.classList.add('ion-appear');
    return ion;
  };
  
  const placeNextMove = () => {
    if (step < moves.length) {
      const move = moves[step];
      const [row, col] = move.pos;
      const index = row * 6 + col;
      const cell = board.children[index] as HTMLElement;
      
      if (cell) {
        if (step === moves.length - 1) {
          // Show arrow for final move
          const arrow = createPulsingArrow();
          cell.appendChild(arrow);
          animationRef.current = setTimeout(() => {
            cell.removeChild(arrow);
            const ion = createAnimatedIon('white', true);
            cell.appendChild(ion);
            
            // Highlight the vector and create node
            for (let i = 1; i <= 4; i++) {
              const vectorCell = board.children[1 * 6 + i] as HTMLElement;
              vectorCell.style.backgroundColor = 'rgba(46, 204, 113, 0.3)';
              vectorCell.style.boxShadow = 'inset 0 0 10px rgba(46, 204, 113, 0.5)';
              vectorCell.style.transition = 'all 0.3s ease';
              
              if (i < 4) {
                const whiteIon = vectorCell.querySelector('.tutorial-demo-ion');
                if (whiteIon) {
                  whiteIon.classList.add('ion-fade');
                }
              }
            }
            
            // Wait 3 seconds, then fade everything
            animationRef.current = setTimeout(() => {
              // Fade out all remaining ions (black ions and node)
              Array.from(board.children).forEach(cell => {
                const ion = (cell as HTMLElement).querySelector('.tutorial-demo-ion');
                if (ion) {
                  ion.classList.add('ion-fade');
                }
                (cell as HTMLElement).style.backgroundColor = '#d1e6f9';
                (cell as HTMLElement).style.boxShadow = 'none';
              });
              
              // Wait for fade animation to complete before cleanup and restart
              animationRef.current = setTimeout(() => {
                clearTutorialBoard(board);
                step = 0;
                animationRef.current = setTimeout(placeNextMove, 1000); // 1 second delay before restart
              }, 500);
            }, 3000);
          }, 1000);
        } else {
          const ion = createAnimatedIon(move.color);
          cell.appendChild(ion);
          step++;
          animationRef.current = setTimeout(placeNextMove, 1000);
        }
      }
    }
  };
  
  // Start with 1 second delay
  animationRef.current = setTimeout(placeNextMove, 1000);
};

const setupLongLineDemo = (container: HTMLElement, animationRef: React.MutableRefObject<NodeJS.Timeout | null>) => {
  addTutorialStyles();
  const board = createSmallBoard();
  container.appendChild(board);
  
  let step = 0;
  const moves = [
    { pos: [1, 0] },  // Column 6
    { pos: [1, 1] },  // Column 7
    { pos: [1, 3] },  // Column 9
    { pos: [1, 4] }   // Column 10
  ];
  
  const createPulsingArrow = () => {
    const arrow = document.createElement('div');
    arrow.className = 'pulsing-arrow';
    arrow.style.cssText = `
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 15px solid #2ecc71;
      animation: pulse 1s infinite;
      transition: opacity 0.3s ease;
    `;
    return arrow;
  };

  const createAnimatedIon = (color: string) => {
    const ion = createTutorialIon(color);
    ion.classList.add('ion-appear');
    return ion;
  };
  
  const placeNextMove = () => {
    if (step < moves.length) {
      const move = moves[step];
      const [row, col] = move.pos;
      const index = row * 6 + col;
      const cell = board.children[index] as HTMLElement;
      
      if (cell) {
        const ion = createAnimatedIon('white');
        cell.appendChild(ion);
        
        if (step === moves.length - 1) {
          // Wait 1 second after last ion before showing arrow
          animationRef.current = setTimeout(() => {
            const invalidCell = board.children[1 * 6 + 2] as HTMLElement; // Column 8
            const arrow = createPulsingArrow();
            invalidCell.appendChild(arrow);
            
            // After 1 second, show red X
            animationRef.current = setTimeout(() => {
              invalidCell.style.backgroundColor = 'rgba(231, 76, 60, 0.3)';
              invalidCell.style.boxShadow = 'inset 0 0 10px rgba(231, 76, 60, 0.5)';
              invalidCell.style.transition = 'all 0.3s ease';
              
              const x = document.createElement('div');
              x.textContent = '✕';
              x.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                color: #e74c3c;
                font-size: 24px;
                font-weight: bold;
                z-index: 2;
                transition: opacity 0.3s ease;
              `;
              invalidCell.appendChild(x);
              
              // After 3 seconds, fade everything together
              animationRef.current = setTimeout(() => {
                // Start fade animations
                arrow.style.opacity = '0';
                x.style.opacity = '0';
                invalidCell.style.backgroundColor = '#d1e6f9';
                invalidCell.style.boxShadow = 'none';
                
                // Fade ions
                Array.from(board.children).forEach(cell => {
                  const ion = (cell as HTMLElement).querySelector('.tutorial-demo-ion');
                  if (ion) {
                    ion.classList.add('ion-fade');
                  }
                });
                
                // Reset after fade animation completes
                animationRef.current = setTimeout(() => {
                  clearTutorialBoard(board);
                  step = 0;
                  animationRef.current = setTimeout(placeNextMove, 1000); // 1 second delay before restart
                }, 500);
              }, 3000);
            }, 1000);
          }, 1000);
        } else {
          step++;
          animationRef.current = setTimeout(placeNextMove, 1000);
        }
      }
    }
  };
  
  // Start with 1 second delay
  animationRef.current = setTimeout(placeNextMove, 1000);
};

const setupNexusDemo = (container: HTMLElement, animationRef: React.MutableRefObject<NodeJS.Timeout | null>) => {
  addTutorialStyles();
  const board = createSmallBoard();
  container.appendChild(board);
  
  const initialNodes = [
    { pos: [1, 1] },  // Column 7
    { pos: [1, 2] },  // Column 8
    { pos: [1, 4] }   // Column 10
  ];
  const finalNode = { pos: [1, 3] };  // Column 9
  
  const createPulsingArrow = () => {
    const arrow = document.createElement('div');
    arrow.className = 'pulsing-arrow';
    arrow.style.cssText = `
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 15px solid #2ecc71;
      animation: pulse 1s infinite;
    `;
    return arrow;
  };
  
  const createNodeWithAnimation = (color: string) => {
    const ion = createTutorialIon(color);
    ion.classList.add('node');
    ion.classList.add('node-appear');
    return ion;
  };
  
  const startSequence = () => {
    // Place first three nodes together with animation
    initialNodes.forEach(move => {
      const [row, col] = move.pos;
      const index = row * 6 + col;
      const cell = board.children[index] as HTMLElement;
      if (cell) {
        const ion = createNodeWithAnimation('white');
        cell.appendChild(ion);
      }
    });
    
    // After 1 second, show arrow at final position
    animationRef.current = setTimeout(() => {
      const finalCell = board.children[1 * 6 + 3] as HTMLElement; // Column 9
      const arrow = createPulsingArrow();
      finalCell.appendChild(arrow);
      
      // After 2 seconds, remove arrow and place final node
      animationRef.current = setTimeout(() => {
        finalCell.removeChild(arrow);
        const ion = createNodeWithAnimation('white');
        finalCell.appendChild(ion);
        
        // Highlight nexus
        for (let i = 1; i <= 4; i++) {
          const nexusCell = board.children[1 * 6 + i] as HTMLElement;
          nexusCell.style.animation = 'nexus-pulse 2s infinite ease-in-out';
        }
        
        // After 3 seconds, fade everything
        animationRef.current = setTimeout(() => {
          // Remove nexus animation and start fade-out
          Array.from(board.children).forEach(cell => {
            (cell as HTMLElement).style.animation = 'none';
            (cell as HTMLElement).style.transition = 'all 0.5s ease';
            (cell as HTMLElement).style.backgroundColor = '#d1e6f9';
            (cell as HTMLElement).style.boxShadow = 'none';
            
            const ion = (cell as HTMLElement).querySelector('.tutorial-demo-ion');
            if (ion) {
              ion.classList.add('node-fade');
            }
          });
          
          // Reset after fade animation completes
          animationRef.current = setTimeout(() => {
            clearTutorialBoard(board);
            animationRef.current = setTimeout(startSequence, 1000); // 1 second delay before restart
          }, 500);
        }, 3000);
      }, 2000);
    }, 1000);
  };
  
  // Start with 1 second delay
  animationRef.current = setTimeout(startSequence, 1000);
};

// Helper functions for tutorial demos
const createSmallBoard = (): HTMLElement => {
  const board = document.createElement('div');
  board.className = 'tutorial-demo-board';
  board.style.cssText = `
    display: grid;
    grid-template-columns: repeat(6, 40px);
    grid-template-rows: repeat(4, 40px);
    gap: 1px;
    background: #bdc3c7;
    padding: 5px;
    border-radius: 5px;
    border: 2px solid #2c3e50;
  `;

  for (let i = 0; i < 24; i++) {
    const cell = document.createElement('div');
    cell.className = 'tutorial-demo-cell';
    cell.style.cssText = `
      background: #d1e6f9;
      border-radius: 2px;
      position: relative;
      transition: background-color 0.2s;
    `;
    cell.dataset.row = Math.floor(i / 6).toString();
    cell.dataset.col = (i % 6).toString();
    board.appendChild(cell);
  }
  return board;
};

const clearTutorialBoard = (board: HTMLElement) => {
  if (!board || !board.classList.contains('tutorial-demo-board')) return;
  Array.from(board.children).forEach(cell => {
    if ((cell as HTMLElement).classList.contains('tutorial-demo-cell')) {
      while (cell.firstChild) {
        cell.removeChild(cell.firstChild);
      }
      (cell as HTMLElement).style.backgroundColor = '#d1e6f9';
      (cell as HTMLElement).style.boxShadow = 'none';
      (cell as HTMLElement).style.animation = 'none';
    }
  });
};

// Tutorial Demo Component
const TutorialDemo: React.FC<{ demoType: string }> = ({ demoType }) => {
  const animationRef = useRef<NodeJS.Timeout | null>(null);
  
  const demoRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      // Clean up any existing content and animations
      node.innerHTML = '';
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
      
      // Set up the animated demos
      switch (demoType) {
        case 'board':
          setupBoardDemo(node, animationRef);
          break;
        case 'vector':
          setupVectorDemo(node, animationRef);
          break;
        case 'node':
          setupNodeDemo(node, animationRef);
          break;
        case 'long-line':
          setupLongLineDemo(node, animationRef);
          break;
        case 'nexus':
          setupNexusDemo(node, animationRef);
          break;
        default:
          node.innerHTML = '<p>Demo coming soon...</p>';
      }
    }
    
    // Cleanup function
    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [demoType]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
    };
  }, []);

  return <div ref={demoRef} style={{ minHeight: '300px', display: 'flex', justifyContent: 'center', alignItems: 'center' }} />;
};

const App: React.FC = () => {
  // Game state
  const [gameState, setGameState] = useState<GameState>({
    board: Array(8).fill(null).map(() => Array(8).fill(null)),
    currentPlayer: 'white',
    scores: { white: 0, black: 0 },
    gameStatus: 'waiting',
    lastMove: null,
    players: { white: 'Player 1', black: 'Player 2' },
    nexusLine: null
  });

  // UI state
  const [showTutorial, setShowTutorial] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [showMatchmaking, setShowMatchmaking] = useState(false);
  const [showStatsAuth, setShowStatsAuth] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSearchingMatch, setIsSearchingMatch] = useState(false);
  const [userStats, setUserStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [showPWABanner, setShowPWABanner] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  
  // Mobile detection state
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  // Settings state
  const [currentTheme, setCurrentTheme] = useState('classic');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [customColors, setCustomColors] = useState({
    whiteIon: '#ecf0f1',
    blackIon: '#2c3e50',
    nodeColor: '#e74c3c',
    boardColor: '#d1e6f9'
  });

  // Review mode state
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [currentReviewMove, setCurrentReviewMove] = useState(0);
  const [moveHistory, setMoveHistory] = useState<MoveHistoryEntry[]>([]);
  const [boardHistory, setBoardHistory] = useState<(Cell | null)[][][]>([]);
  const [holdScrollInterval, setHoldScrollInterval] = useState<NodeJS.Timeout | null>(null);

  // Timer state
  const [timers, setTimers] = useState({ white: 600, black: 600 });
  const [activeTimer, setActiveTimer] = useState<'white' | 'black' | null>(null);

  // Game mode state
  const [gameMode, setGameMode] = useState<'local' | 'ai-1' | 'ai-2' | 'ai-3' | 'online'>('local');
  const [waitingForAI, setWaitingForAI] = useState(false);

  // Notification state
  const [notification, setNotification] = useState<{
    show: boolean;
    title: string;
    message: string;
    primaryButton?: string;
    secondaryButton?: string;
    onPrimary?: () => void;
    onSecondary?: () => void;
  }>({ show: false, title: '', message: '' });

  // Authentication state
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    isGuest: false
  });

  // Online game state
  const [socket, setSocket] = useState<any>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [playerColor, setPlayerColor] = useState<'white' | 'black' | null>(null);
  const [opponentName, setOpponentName] = useState<string>('');
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [minutesPerPlayer, setMinutesPerPlayer] = useState(10);
  const [incrementSeconds, setIncrementSeconds] = useState(0);
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [rematchState, setRematchState] = useState<{
    requested: boolean;
    fromPlayer: string | null;
    requestedBy?: string;
    waitingForResponse?: boolean;
  }>({ requested: false, fromPlayer: null });
  const [toast, setToast] = useState<string>('');
  const [showResignConfirmation, setShowResignConfirmation] = useState(false);
  const [showResignDrawModal, setShowResignDrawModal] = useState(false);
  const [showDrawOffer, setShowDrawOffer] = useState(false);
  const [pendingDrawFrom, setPendingDrawFrom] = useState<string | null>(null);
  const [originalGameState, setOriginalGameState] = useState<GameState | null>(null);
  const [showMobileControls, setShowMobileControls] = useState(false);

  // Room-based multiplayer state
  const [currentRoom, setCurrentRoom] = useState<{
    code: string;
    isHost: boolean;
    hostName: string;
    guestName?: string;
    status: 'waiting' | 'ready' | 'active';
  } | null>(null);
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');

  // Tutorial animation ref
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  // Load settings from localStorage on component mount
  useEffect(() => {
    setCurrentTheme('classic'); // Always force classic theme
    loadSavedSettings();
  }, []);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      const isMobile = window.innerWidth <= 600 || 
                      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobileDevice(isMobile);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Apply theme when currentTheme changes
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme, customColors]);

  // Load saved settings from localStorage
  const loadSavedSettings = () => {
    try {
      // Always use classic theme, ignore saved theme
      setCurrentTheme('classic');
      const savedSoundEnabled = localStorage.getItem('kuyokuSoundEnabled');
      const savedCustomColors = localStorage.getItem('kuyokuCustomColors');

      if (savedSoundEnabled !== null) {
        setSoundEnabled(JSON.parse(savedSoundEnabled));
      }

      if (savedCustomColors) {
        setCustomColors(JSON.parse(savedCustomColors));
      }
    } catch (error) {
      console.error('Error loading saved settings:', error);
    }
  };

  // Apply theme to document
  const applyTheme = (theme: string) => {
    document.documentElement.setAttribute('data-theme', theme);
    
    // If it's a custom theme, apply custom colors
    if (theme === 'custom') {
      applyCustomColors(customColors);
    } else {
      // Clear custom colors when switching away from custom theme
      clearCustomColors();
    }
  };

  // Apply custom colors to CSS variables
  const applyCustomColors = (colors: typeof customColors) => {
    const root = document.documentElement;
    root.style.setProperty('--white-ion', colors.whiteIon);
    root.style.setProperty('--black-ion', colors.blackIon);
    root.style.setProperty('--node-color', colors.nodeColor);
    root.style.setProperty('--board-color', colors.boardColor);
  };

  // Clear custom colors from CSS variables
  const clearCustomColors = () => {
    const root = document.documentElement;
    root.style.removeProperty('--white-ion');
    root.style.removeProperty('--black-ion');
    root.style.removeProperty('--node-color');
    root.style.removeProperty('--board-color');
  };

  // Handle theme change
  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    localStorage.setItem('kuyokuTheme', theme);
  };

  // Handle sound toggle
  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    localStorage.setItem('kuyokuSoundEnabled', JSON.stringify(enabled));
  };

  // Handle custom color change
  const handleCustomColorChange = (colorType: keyof typeof customColors, color: string) => {
    const newColors = { ...customColors, [colorType]: color };
    setCustomColors(newColors);
    localStorage.setItem('kuyokuCustomColors', JSON.stringify(newColors));
  };

  // Reset settings to defaults
  const resetSettings = () => {
    setCurrentTheme('classic');
    setSoundEnabled(true);
    setCustomColors({
      whiteIon: '#ecf0f1',
      blackIon: '#2c3e50',
      nodeColor: '#e74c3c',
      boardColor: '#d1e6f9'
    });
    
    localStorage.removeItem('kuyokuTheme');
    localStorage.removeItem('kuyokuSoundEnabled');
    localStorage.removeItem('kuyokuCustomColors');
    
    // Reset document theme and clear any custom colors
    document.documentElement.setAttribute('data-theme', 'classic');
    clearCustomColors();
  };

  // Sound function
  const playSound = (soundName: 'ion' | 'vector' | 'nexus') => {
    // Check if sound is enabled before playing
    if (!soundEnabled) {
      return;
    }
    
    try {
      const audio = new Audio(`/sounds/${soundName}.mp3`);
      audio.volume = 0.3; // Set to 30% volume
      audio.play().catch(e => console.log('Sound play failed:', e));
    } catch (e) {
      console.log('Sound loading failed:', e);
    }
  };

    // PWA installation detection
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      console.log('PWA: beforeinstallprompt event fired');
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later
      setDeferredPrompt(e);
      // Show our custom banner after a short delay
      setTimeout(() => {
        // Only show if not already installed and not dismissed recently
        const dismissed = localStorage.getItem('pwa-banner-dismissed');
        const dismissedTime = dismissed ? parseInt(dismissed) : 0;
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        if (!dismissedTime || dismissedTime < oneDayAgo) {
          setShowPWABanner(true);
        }
        }, 5000); // Show after 5 seconds on mobile (longer delay)
    };

    const handleAppInstalled = () => {
      console.log('PWA: App installed');
      setShowPWABanner(false);
      setDeferredPrompt(null);
    };

    // Enhanced mobile/iOS detection and debugging
    const userAgent = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    
    console.log('PWA: Device detection', {
      userAgent,
      isIOS,
      isStandalone,
      isMobile,
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform
    });
    
         // Show PWA banner for mobile devices (iOS or Android) that aren't already installed
    if (isMobile && !isStandalone) {
      console.log('PWA: Mobile device detected (not standalone), will show banner after 5 seconds');
      setTimeout(() => {
        const dismissed = localStorage.getItem('pwa-banner-dismissed');
        const dismissedTime = dismissed ? parseInt(dismissed) : 0;
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        console.log('PWA: Checking if should show banner', {
          dismissed,
          dismissedTime,
          oneDayAgo,
          shouldShow: !dismissedTime || dismissedTime < oneDayAgo
        });
        
        if (!dismissedTime || dismissedTime < oneDayAgo) {
          console.log('PWA: Showing mobile banner');
          setShowPWABanner(true);
        }
      }, 5000);
    } else if (isMobile && isStandalone) {
      console.log('PWA: Running in standalone mode - no banner needed');
    } else if (!isMobile) {
      console.log('PWA: Desktop device - will rely on beforeinstallprompt event');
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // PWA banner actions
  const handleInstallPWA = async () => {
    const userAgent = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    console.log('PWA: Install button clicked', { isIOS, deferredPrompt: !!deferredPrompt });
    
    if (isIOS) {
      // iOS doesn't support programmatic install, show instructions
      alert('To install: Tap the Share button in Safari, then select "Add to Home Screen"');
      setShowPWABanner(false);
      return;
    }
    
    if (!deferredPrompt) {
      console.log('PWA: No deferred prompt available - showing manual instructions');
      alert('To install: Use your browser menu to "Install App" or "Add to Home Screen"');
      setShowPWABanner(false);
      return;
    }
    
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('PWA: User choice:', outcome);
      
      if (outcome === 'accepted') {
        setShowPWABanner(false);
      }
      setDeferredPrompt(null);
    } catch (error) {
      console.error('PWA: Error during install prompt', error);
      alert('To install: Use your browser menu to "Install App" or "Add to Home Screen"');
      setShowPWABanner(false);
    }
  };

  const dismissPWABanner = () => {
    setShowPWABanner(false);
    localStorage.setItem('pwa-banner-dismissed', Date.now().toString());
  };

  // Dynamic viewport height detection for mobile
  useEffect(() => {
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    // Set initial value
    setVH();

    // Update on resize and orientation change
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', () => {
      // Delay to allow for browser UI changes
      setTimeout(setVH, 100);
    });

    return () => {
      window.removeEventListener('resize', setVH);
      window.removeEventListener('orientationchange', setVH);
    };
  }, []);

  // Check authentication status on component mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('authToken');
      if (token) {
        try {
          const response = await fetch(`${getApiUrl()}/api/auth/profile`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            setAuthState({
              isAuthenticated: true,
              user: data.user,
              isGuest: false
            });
          } else {
            // Token is invalid, remove it
            localStorage.removeItem('authToken');
          }
        } catch (error) {
          // Connection error, keep token but don't authenticate yet
          localStorage.removeItem('authToken');
        }
      }
    };
    
    checkAuth();
  }, []);

  // Initialize socket connection for online play
  useEffect(() => {
    console.log('Socket effect triggered with gameMode:', gameMode);
    if (gameMode === 'online') {
      const token = localStorage.getItem('authToken');
      console.log('Creating socket connection...', {
        production: process.env.NODE_ENV === 'production',
        connectionURL: process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000',
        hasToken: !!token,
        authState
      });
      
      // Determine socket URL based on environment
      const socketUrl = process.env.NODE_ENV === 'production' 
        ? process.env.REACT_APP_API_URL || 'https://web-production-7dd44.up.railway.app'
        : 'http://localhost:5000';
      
      console.log('Connecting to socket:', socketUrl, 'NODE_ENV:', process.env.NODE_ENV);
      
      const newSocket = io(socketUrl, {
        auth: {
          token: token,
          isGuest: authState.isGuest,
          user: authState.user
        }
      });
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Socket connected successfully:', newSocket.id);
      });

      newSocket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
      });

      newSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
      });

      newSocket.on('gameStart', (data) => {
        setGameId(data.gameId);
        setPlayerColor(data.playerColor);
        setOpponentName(data.opponentName);
        setGameState(prev => ({
          ...prev,
          ...data.gameState,
          gameStatus: 'active'
        }));
        
        // Apply standard timer settings for online games
        if (data.timerSettings) {
          console.log('Applying standard timer settings from server:', data.timerSettings);
          setTimerEnabled(data.timerSettings.timerEnabled);
          setMinutesPerPlayer(data.timerSettings.minutesPerPlayer);
          setIncrementSeconds(data.timerSettings.incrementSeconds);
          
          // Initialize timers from server data
          if (data.timerSettings.timerEnabled && data.timers) {
            setTimers(data.timers);
            setActiveTimer(data.gameState.currentPlayer);
          }
        }
        
        setIsGameStarted(true);
        setShowMatchmaking(false);
        setIsSearchingMatch(false);
        
        // Clear room state when game starts from a room
        if (data.fromRoom) {
          setCurrentRoom(null);
        }
        
        showToast(`Game start - you are playing as ${data.playerColor} (${data.timerSettings?.timerEnabled ? `${data.timerSettings.minutesPerPlayer}+${data.timerSettings.incrementSeconds}` : 'no timer'})`);
      });

      newSocket.on('waitingForOpponent', () => {
        setIsSearchingMatch(true);
      });

      newSocket.on('timerUpdate', (data) => {
        setTimers(data.timers);
        setActiveTimer(data.activeTimer);
      });

      newSocket.on('moveUpdate', (moveData) => {
        // Play appropriate sound effects
        if (moveData.gameOver && moveData.nexus) {
          playSound('nexus'); // Nexus formed
        } else if (moveData.vectors > 0) {
          playSound('vector'); // Vector formed
        } else {
          playSound('ion'); // Regular ion placement
        }

        setGameState(prev => ({
          ...prev,
          board: moveData.board,
          currentPlayer: moveData.currentPlayer,
          scores: moveData.scores,
          lastMove: { row: moveData.row, col: moveData.col, player: moveData.player },
          gameStatus: moveData.gameOver ? 'finished' : 'active',
          nexusLine: moveData.nexus || null
        }));

        // Add to move history
        setMoveHistory(prev => [
          ...prev,
          {
            row: moveData.row,
            col: moveData.col,
            player: moveData.player,
            vectors: moveData.vectors,
            moveNumber: prev.length + 1
          }
        ]);

        // Update timers from server
        if (moveData.timers) {
          setTimers(moveData.timers);
        }

        if (moveData.gameOver) {
          let message = '';
          if (moveData.winner === 'draw') {
            message = 'Game ended in a draw!';
          } else if (moveData.nexus) {
            message = `${moveData.winner} wins by Nexus!`;
          } else {
            message = `${moveData.winner} wins by node count!`;
          }
          // Add 1 second delay for players to see the final move
          setTimeout(() => {
          setNotification({
            title: 'Game Over',
            message,
            show: true
          });
          }, 1000);
          setActiveTimer(null);
        } else {
          setActiveTimer(moveData.currentPlayer);
        }
      });

      newSocket.on('gameEnd', (data) => {
        setGameState(prev => ({ ...prev, gameStatus: 'finished' }));
        setActiveTimer(null);
        
        // Update timers if provided (for timeout scenarios)
        if (data.timers) {
          setTimers(data.timers);
        }
        
        // Add 1 second delay for players to see the final move
        setTimeout(() => {
          let message = '';
          if (data.reason === 'draw') {
            message = 'The game has ended in a draw by mutual agreement.';
          } else if (data.reason === 'resignation') {
            message = `${data.winner} wins by resignation!`;
          } else if (data.reason === 'timeout') {
            message = `${data.winner} wins on time!`;
          } else {
            message = `${data.winner} wins!`;
          }
          
        setNotification({
            title: data.reason === 'timeout' ? 'Time Out' : (data.reason === 'draw' ? 'Game Drawn' : 'Game Over'),
            message,
          show: true
        });
        }, 1000);
      });

      newSocket.on('opponentDisconnected', () => {
        setGameState(prev => ({ ...prev, gameStatus: 'finished' }));
        // Add 1 second delay for players to see the final position
        setTimeout(() => {
        setNotification({
          title: 'Opponent Disconnected',
          message: 'Your opponent has disconnected from the game.',
          show: true
        });
        }, 1000);
        setActiveTimer(null);
      });

      // Debug: Listen for all socket events
      newSocket.onAny((event, ...args) => {
        console.log(`Socket event received: ${event}`, args);
      });

      // Rematch event handlers
      newSocket.on('rematchRequested', (data) => {
        console.log('*** REMATCH REQUESTED EVENT RECEIVED ***');
        console.log('Rematch requested by:', data.requesterName, 'Full data:', data);
        setRematchState({
          requested: true,
          fromPlayer: data.requesterName,
          requestedBy: data.requesterName,
          waitingForResponse: false
        });
        
        // Force update the notification to show the rematch request
        setNotification(prev => ({
          ...prev,
          show: true // Make sure modal stays open
        }));
      });

      newSocket.on('rematchRequestSent', () => {
        console.log('Rematch request sent confirmation received');
        setRematchState(prev => ({
          ...prev,
          waitingForResponse: true
        }));
        showToast('Rematch request sent to opponent');
      });

      newSocket.on('rematchAccepted', (data) => {
        console.log('Rematch accepted, starting new game:', data);
        
        // Exit review mode immediately if currently in review
        setIsReviewMode(false);
        setCurrentReviewMove(0);
        setOriginalGameState(null);
        
        // Reset rematch state
        setRematchState({
          requested: false,
          fromPlayer: null,
          requestedBy: '',
          waitingForResponse: false
        });
        
        // Set up new game
        setGameId(data.gameId);
        setPlayerColor(data.playerColor);
        setOpponentName(data.opponentName);
        setGameState(prev => ({
          ...prev,
          ...data.gameState,
          gameStatus: 'active'
        }));
        setMoveHistory([]);
        setNotification({ title: '', message: '', show: false });
        
        // Reset timers from server data
        if (data.timers) {
          setTimers(data.timers);
          setActiveTimer(data.gameState.currentPlayer);
        }
        
        showToast(`Rematch started - you are now playing as ${data.playerColor}`);
      });

      newSocket.on('rematchDeclined', () => {
        console.log('Rematch declined by opponent');
        setRematchState({
          requested: false,
          fromPlayer: null,
          requestedBy: '',
          waitingForResponse: false
        });
        // Close the modal completely and show toast notification
        setNotification({
          title: '',
          message: '',
          show: false
        });
        showToast('Opponent declined the rematch');
      });

      // Draw offer events
      newSocket.on('drawOffered', (data) => {
        console.log('Draw offer received from opponent');
        setPendingDrawFrom(data.fromPlayer);
        setShowDrawOffer(true);
      });

      newSocket.on('drawAccepted', () => {
        console.log('Draw offer accepted');
        setGameState(prev => ({ ...prev, gameStatus: 'finished' }));
        setIsGameStarted(false);
        // Add 1 second delay for players to see the final position
        setTimeout(() => {
          setNotification({
            title: 'Game Drawn',
            message: 'The game has ended in a draw by mutual agreement.',
            show: true
          });
        }, 1000);
        setActiveTimer(null);
      });

      newSocket.on('drawDeclined', () => {
        console.log('Draw offer declined');
        showToast('Opponent declined the draw offer');
      });

      // Room-based multiplayer event handlers
      newSocket.on('roomCreated', (data) => {
        setCurrentRoom({
          code: data.roomCode,
          isHost: true,
          hostName: data.playerName,
          status: 'waiting'
        });
        setShowRoomModal(false);
        showToast(`Room ${data.roomCode} created! Share this code with your friend.`);
      });

      newSocket.on('roomJoined', (data) => {
        console.log('roomJoined event received:', data);
        
        // Update room state for both host and guest
        setCurrentRoom(prev => {
          const isJoiningGuest = !prev; // If no previous room state, this socket is the guest joining
          
          if (isJoiningGuest) {
            // This is the guest joining
            showToast(`Joined room ${data.roomCode}!`);
            return {
              code: data.roomCode,
              isHost: false,
              hostName: data.host.name,
              guestName: data.guest.name,
              status: data.status
            };
          } else {
            // This is the host receiving the update that guest joined
            showToast(`${data.guest.name} joined the room!`);
            return {
              ...prev,
              guestName: data.guest.name,
              status: data.status
            };
          }
        });
        setShowRoomModal(false);
      });

      newSocket.on('guestLeft', (data) => {
        if (currentRoom && currentRoom.code === data.roomCode) {
          setCurrentRoom(prev => prev ? {
            ...prev,
            guestName: undefined,
            status: 'waiting'
          } : null);
          showToast(data.reason === 'disconnected' ? 'Guest disconnected' : 'Guest left the room');
        }
      });

      newSocket.on('roomClosed', (data) => {
        setCurrentRoom(null);
        showToast(data.message);
      });

      newSocket.on('roomError', (data) => {
        showToast(data.message);
      });

      return () => {
        newSocket.close();
      };
    }
  }, [gameMode, authState.isGuest, authState.user]);

  // Timer logic (only for local games - online games use server timers)
  useEffect(() => {
    if (!timerEnabled || !isGameStarted || gameState.gameStatus !== 'active' || !activeTimer || gameMode === 'online') {
      return;
    }

    const interval = setInterval(() => {
      setTimers(prev => {
        const newTimers = { ...prev };
        newTimers[activeTimer] -= 1;
        
        if (newTimers[activeTimer] <= 0) {
          // Time out
          const winner = activeTimer === 'white' ? 'black' : 'white';
          setGameState(prev => ({ ...prev, gameStatus: 'finished' }));
          // Add 1 second delay for players to see the final position
          setTimeout(() => {
          setNotification({
            title: 'Time Out',
            message: `${winner} wins on time!`,
            show: true
          });
          }, 1000);
          setActiveTimer(null);
        }
        
        return newTimers;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerEnabled, isGameStarted, gameState.gameStatus, activeTimer, gameMode]);

  const showToast = useCallback((message: string, duration: number = 4000) => {
    setToast(message);
    setTimeout(() => setToast(''), duration);
  }, []);

  // Start timer when game starts or player changes
  useEffect(() => {
    if (isGameStarted && gameState.gameStatus === 'active' && timerEnabled) {
      setActiveTimer(gameState.currentPlayer);
    }
  }, [isGameStarted, gameState.currentPlayer, gameState.gameStatus, timerEnabled]);

  // Authentication handlers
  const handleLogin = async (email: string, password: string) => {
    try {
      setAuthError('');
      const response = await fetch(`${getApiUrl()}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Store token in localStorage
        localStorage.setItem('authToken', data.token);
        
        setAuthState({
          isAuthenticated: true,
          user: data.user,
          isGuest: false
        });
        setShowLogin(false);
        showToast(`Welcome back, ${data.user.username}!`);
      } else {
        setAuthError(data.error || 'Login failed');
      }
    } catch (error) {
      setAuthError('Connection error. Please try again.');
    }
  };

  const handleSignup = async (email: string, username: string, password: string) => {
    try {
      setAuthError('');
      
      // Validate inputs
      if (!validateEmail(email)) {
        setAuthError('Please enter a valid email address');
        return;
      }
      if (!validateUsername(username)) {
        setAuthError('Username must be 6-20 characters, start with a letter, and contain only letters and numbers');
        return;
      }
      if (!validatePassword(password)) {
        setAuthError(getPasswordStrengthMessage(password));
        return;
      }
      
      const response = await fetch(`${getApiUrl()}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Store token and automatically log the user in
        localStorage.setItem('authToken', data.token);
        
        setAuthState({
          isAuthenticated: true,
          user: data.user,
          isGuest: false
        });
        
        setShowSignup(false);
        showToast(`Welcome, ${data.user.username}! Account created successfully.`);
      } else {
        setAuthError(data.error || 'Signup failed');
      }
    } catch (error) {
      setAuthError('Connection error. Please try again.');
    }
  };

  const handlePlayAsGuest = () => {
    setAuthState({
      isAuthenticated: false,
      user: null,
      isGuest: true
    });
    setShowMatchmaking(true);
  };

  const handleLogout = () => {
    // Clear stored token
    localStorage.removeItem('authToken');
    
    setAuthState({
      isAuthenticated: false,
      user: null,
      isGuest: false
    });
    if (gameMode === 'online') {
      setGameMode('local');
      resetGame();
    }
    showToast('Logged out successfully');
  };

  // Handle stats button click
  const handleViewStats = async () => {
    if (!authState.isAuthenticated) {
      setShowStatsAuth(true);
      return;
    }

    setStatsLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${getApiUrl()}/api/auth/stats`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setUserStats(data.stats);
        setShowStats(true);
      } else {
        setToast("New feature coming soon!");
        setTimeout(() => setToast(''), 3000);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
      setToast("New feature coming soon!");
      setTimeout(() => setToast(''), 3000);
    } finally {
      setStatsLoading(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const makeLocalMove = useCallback((row: number, col: number) => {
    // Check basic validity first
    if (row < 0 || row >= 8 || col < 0 || col >= 8) return;
    if (gameState.board[row][col] !== null) return;
    
    // Check if move would create a line too long and show specific message
    if (wouldCreateLineTooLong(gameState.board, row, col, gameState.currentPlayer)) {
      showToast("Illegal move. You may not create a line longer than 4 of your own color");
      return;
    }
    
    const currentPlayer = gameState.currentPlayer;
    const newBoard = gameState.board.map(r => [...r]);
    
    // Place the ion
    newBoard[row][col] = { color: currentPlayer, isNode: false };
    
    // Check for vectors
    const vectors = checkForVectors(newBoard, row, col, currentPlayer);
    const { nodeType } = processVectors(newBoard, vectors, row, col);
    
    // If vectors were formed, make this cell a node
    if (nodeType) {
      newBoard[row][col] = { color: currentPlayer, isNode: true, nodeType };
    }
    
    // Update scores
    const newScores = {
      white: countNodes(newBoard, 'white'),
      black: countNodes(newBoard, 'black')
    };
    
    // Check for nexus (winning condition)
    const nexus = checkForNexus(newBoard, row, col, currentPlayer);
    let gameOver = false;
    let winner: 'white' | 'black' | 'draw' | null = null;
    
    // Play appropriate sound based on what happened
    if (nexus) {
      gameOver = true;
      winner = currentPlayer;
      playSound('nexus'); // Nexus sound takes priority
    } else if (nodeType) {
      playSound('vector'); // Vector sound if no nexus
    } else {
      playSound('ion'); // Regular ion placement
    }
    
    if (!nexus) {
      // Check if next player has legal moves
      const nextPlayer = currentPlayer === 'white' ? 'black' : 'white';
      if (!hasLegalMoves(newBoard, nextPlayer)) {
        gameOver = true;
        if (newScores.white > newScores.black) winner = 'white';
        else if (newScores.black > newScores.white) winner = 'black';
        else winner = 'draw';
      }
    }
    
    // Add to move history
    setMoveHistory(prev => [
      ...prev,
      {
        row,
        col,
        player: currentPlayer,
        vectors: vectors.length,
        moveNumber: prev.length + 1
      }
    ]);
    
    if (gameOver) {
      setGameState(prev => ({
        ...prev,
        board: newBoard,
        scores: newScores,
        lastMove: { row, col, player: currentPlayer },
        gameStatus: 'finished',
        nexusLine: nexus || null
      }));
      
      let message = '';
      if (winner === 'draw') {
        message = 'Game ended in a draw!';
      } else if (nexus) {
        message = `${winner} wins by Nexus!`;
      } else {
        message = `${winner} wins by node count!`;
      }
      // Add 1 second delay for players to see the final move
      setTimeout(() => {
      setNotification({
        title: 'Game Over',
        message,
        show: true
      });
      }, 1000);
      setActiveTimer(null);
    } else {
      // Switch to next player
      const nextPlayer = currentPlayer === 'white' ? 'black' : 'white';
      setGameState(prev => ({
        ...prev,
        board: newBoard,
        currentPlayer: nextPlayer,
        scores: newScores,
        lastMove: { row, col, player: currentPlayer },
        gameStatus: 'active',
        nexusLine: null
      }));
    }
  }, [gameState.board, gameState.currentPlayer, setMoveHistory, setGameState, setNotification, setActiveTimer]);

  // AI move logic with human-like thinking time
  useEffect(() => {
    if (
      isGameStarted &&
      gameState.gameStatus === 'active' &&
      (gameMode === 'ai-1' || gameMode === 'ai-2' || gameMode === 'ai-3') &&
      playerColor &&
      gameState.currentPlayer !== playerColor
    ) {
      // AI's turn
      let minThinkTime, maxThinkTime;
      if (gameMode === 'ai-1') {
        minThinkTime = 1000;
        maxThinkTime = 2000;
      } else if (gameMode === 'ai-2') {
        minThinkTime = 1500;
        maxThinkTime = 2500;
      } else {
        minThinkTime = 2000;
        maxThinkTime = 4000;
      }
      const thinkTime = Math.floor(Math.random() * (maxThinkTime - minThinkTime + 1)) + minThinkTime;
      console.log(`${gameMode.toUpperCase()} thinking for ${thinkTime}ms...`);
      const timeout = setTimeout(() => {
        const aiMove = getAIMove(gameState.board, gameMode as 'ai-1' | 'ai-2' | 'ai-3');
        if (aiMove) {
          console.log(`${gameMode.toUpperCase()} selected move:`, aiMove);
          makeLocalMove(aiMove.row, aiMove.col);
        }
      }, thinkTime);
      return () => clearTimeout(timeout);
    }
  }, [gameState.currentPlayer, gameState.gameStatus, isGameStarted, gameMode, gameState.board, makeLocalMove, playerColor]);

  const handleCellClick = (row: number, col: number) => {
    if (!isGameStarted || gameState.gameStatus !== 'active' || isReviewMode) return;

    if (gameMode === 'online') {
      if (!playerColor || gameState.currentPlayer !== playerColor) return;
      if (gameState.board[row][col] !== null) return;
      if (wouldCreateLineTooLong(gameState.board, row, col, playerColor)) {
        showToast("Illegal move. You may not create a line longer than 4 of your own color");
        return;
      }
      socket?.emit('makeMove', { gameId, row, col });
    } else {
      // Local game (human vs human or vs AI)
      if (
        (gameMode === 'ai-1' || gameMode === 'ai-2' || gameMode === 'ai-3') &&
        playerColor &&
        gameState.currentPlayer !== playerColor
      ) {
        // Not human's turn
        return;
      }
      makeLocalMove(row, col);
    }
  };

  const startGame = () => {
    console.log('===== START GAME CLICKED =====');
    console.log('Game mode:', gameMode);
    console.log('Auth state:', {
      isAuthenticated: authState.isAuthenticated,
      isGuest: authState.isGuest,
      user: authState.user,
    });
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Current URL:', window.location.href);
    
    // Close mobile controls modal when starting any game
    setShowMobileControls(false);
    
    if (gameMode === 'online') {
      console.log('📡 ONLINE MODE SELECTED');
      // Check authentication status for online play
      if (!authState.isAuthenticated && !authState.isGuest) {
        console.log('🔐 User not authenticated - showing login modal');
        console.log('Setting showLogin to true...');
        // Show login modal directly for a more streamlined experience
        setShowLogin(true);
        console.log('Login modal should now be visible');
        return;
      }
      console.log('✅ User authenticated - showing matchmaking modal');
      console.log('Setting showMatchmaking to true...');
      setShowMatchmaking(true);
      console.log('Matchmaking modal should now be visible');
    } else {
      // Local game start
      if (gameMode === 'ai-1' || gameMode === 'ai-2' || gameMode === 'ai-3') {
        startAIGame();
        return;
      }
      
      const newBoard = Array(8).fill(null).map(() => Array(8).fill(null));
      setGameState({
        board: newBoard,
        currentPlayer: 'white',
        scores: { white: 0, black: 0 },
        gameStatus: 'active',
        lastMove: null,
        players: { 
          white: 'White', 
          black: 'Black'
        },
        nexusLine: null
      });
      setIsGameStarted(true);
      setMoveHistory([]);
      
      if (timerEnabled) {
        const totalSeconds = minutesPerPlayer * 60;
        setTimers({ white: totalSeconds, black: totalSeconds });
        setActiveTimer('white');
      }
    }
  };

  const findMatch = () => {
    console.log('findMatch called', {
      hasSocket: !!socket,
      socketConnected: socket?.connected,
      socketId: socket?.id
    });
    
    if (socket) {
      console.log('Emitting findMatch to server...');
      // Always use standard settings for online multiplayer
      const standardSettings = {
        timerEnabled: true,
        minutesPerPlayer: 10,
        incrementSeconds: 0
      };
      console.log('Using standard timer settings for online game:', standardSettings);
      socket.emit('findMatch', standardSettings);
      setIsSearchingMatch(true);
    } else {
      console.error('No socket available for findMatch');
    }
  };

  const cancelMatchmaking = () => {
    if (socket) {
      socket.emit('cancelMatchmaking');
    }
    setShowMatchmaking(false);
    setIsSearchingMatch(false);
  };

  const requestRematch = () => {
    console.log('Request rematch clicked!', {
      hasSocket: !!socket,
      gameId,
      socketConnected: socket?.connected,
      gameStatus: gameState.gameStatus,
      socketId: socket?.id
    });

    if (!socket || !gameId || gameState.gameStatus !== 'finished') {
      console.log('Cannot request rematch - missing requirements');
      return;
    }

    console.log('Emitting requestRematch to server...', {
      gameId,
      socketId: socket.id,
      connected: socket.connected
    });

    socket.emit('requestRematch', { gameId });
  };

  const respondToRematch = (accept: boolean) => {
    if (socket && gameId) {
      socket.emit('respondToRematch', { gameId, accept });
    }
    
    if (accept) {
      // Exit review mode immediately when accepting rematch
      setIsReviewMode(false);
      setCurrentReviewMove(0);
      setOriginalGameState(null);
    } else {
      // Reset rematch state and close modal on decline
      setRematchState({
        requested: false,
        fromPlayer: null,
        requestedBy: '',
        waitingForResponse: false
      });
      setNotification({
        title: '',
        message: '',
        show: false
      });
    }
  };

  const resignGame = () => {
    // Show confirmation modal instead of immediately resigning
    setShowResignConfirmation(true);
  };

  const confirmResignation = () => {
    setShowResignConfirmation(false);
    
    if (gameMode === 'online' && socket && gameId) {
      // Online game - send resign to server
      socket.emit('resign', { gameId });
    } else {
      // Local game - handle resignation locally
      const winner = gameState.currentPlayer === 'white' ? 'black' : 'white';
      setGameState(prev => ({ ...prev, gameStatus: 'finished' }));
      setNotification({
        title: 'Game Over',
        message: `${winner} wins by resignation!`,
        show: true
      });
      setIsGameStarted(false);
      setActiveTimer(null);
    }
  };

  const cancelResignation = () => {
    setShowResignConfirmation(false);
  };

  // Desktop: Show resign/draw modal
  const showResignDrawOptions = () => {
    setShowResignDrawModal(true);
  };

  const handleResignFromModal = () => {
    setShowResignDrawModal(false);
    setShowResignConfirmation(true);
  };

  const handleDrawFromModal = () => {
    setShowResignDrawModal(false);
    offerDraw();
  };

  const cancelResignDrawModal = () => {
    setShowResignDrawModal(false);
  };

  // Mobile: Direct draw offer
  const offerDraw = () => {
    // Only allow draw offers in online multiplayer games
    if (gameMode !== 'online') {
      showToast('Draw offers are only available in online multiplayer games');
      return;
    }
    
    if (gameMode === 'online' && socket && gameId) {
      // Online game - send draw offer to server
      socket.emit('draw-offer', { gameId });
      showToast('Draw offer sent');
    }
  };

  const respondToDrawOffer = (accept: boolean) => {
    setShowDrawOffer(false);
    setPendingDrawFrom(null);
    
    if (accept) {
      if (gameMode === 'online' && socket && gameId) {
        // Online game - send draw acceptance to server
        socket.emit('draw-accept', { gameId });
      } else {
        // Local game - end game as draw
        setGameState(prev => ({ ...prev, gameStatus: 'finished' }));
        setIsGameStarted(false);
        // Add 1 second delay for players to see the final position
        setTimeout(() => {
          setNotification({
            title: 'Game Drawn',
            message: 'The game has ended in a draw by mutual agreement.',
            show: true
          });
        }, 1000);
        setActiveTimer(null);
      }
    } else {
      if (gameMode === 'online' && socket && gameId) {
        // Online game - send draw rejection to server
        socket.emit('draw-decline', { gameId });
      } else {
        // Local game - just close the modal
        showToast('Draw offer declined');
      }
    }
  };

  // Room-based multiplayer functions
  const createRoom = () => {
    if (socket) {
      socket.emit('createRoom');
    }
  };

  const joinRoom = () => {
    if (socket && roomCodeInput.trim()) {
      socket.emit('joinRoom', { roomCode: roomCodeInput.trim() });
      setRoomCodeInput('');
    }
  };

  const leaveRoom = () => {
    if (socket && currentRoom) {
      socket.emit('leaveRoom', { roomCode: currentRoom.code });
      setCurrentRoom(null);
    }
  };

  const startRoomGame = () => {
    console.log('startRoomGame called', { socket: !!socket, currentRoom, isHost: currentRoom?.isHost });
    if (socket && currentRoom && currentRoom.isHost) {
      console.log('Emitting startRoomGame for room:', currentRoom.code);
      socket.emit('startRoomGame', { roomCode: currentRoom.code });
    } else {
      console.log('Cannot start room game - missing requirements');
    }
  };

  const resetGame = () => {
    setGameState({
      board: INITIAL_BOARD,
      currentPlayer: 'white',
      scores: { white: 0, black: 0 },
      gameStatus: 'waiting',
      lastMove: null,
      players: { white: 'White', black: 'Black' },
      nexusLine: null
    });
    setIsGameStarted(false);
    setMoveHistory([]);
    setActiveTimer(null);
    setPlayerColor(null);
    setOpponentName('');
    setGameId('');
    // Exit review mode if currently in review
    setIsReviewMode(false);
    setCurrentReviewMove(0);
    setOriginalGameState(null);
    setRematchState({
      requested: false,
      fromPlayer: null,
      requestedBy: '',
      waitingForResponse: false
    });
    if (timerEnabled) {
      const totalSeconds = minutesPerPlayer * 60;
      setTimers({ white: totalSeconds, black: totalSeconds });
    }
  };

  const getNotation = (col: number, row: number): string => {
    const colLetter = String.fromCharCode(97 + col); // a-h
    const rowNumber = 8 - row; // 8-1
    return colLetter + rowNumber;
  };

  // Tutorial steps configuration
  const tutorialSteps = [
    {
      title: "Basic Gameplay",
      message: "Kuyoku is played on an 8×8 board.<br>Players alternate turns,<br>white moves first, then black,<br>placing ions on empty cells.",
      demo: "board"
    },
    {
      title: "Building Vectors",
      message: "Your first tactical step is to create <b>Vectors</b>:<br>Vectors are lines of exactly 4 ions of your color,<br>horizontal, vertical, or diagonal.",
      demo: "vector"
    },
    {
      title: "Nodes",
      message: "When a Vector is formed, the last ion placed becomes a <b>Node</b> (with a red mark) and remains on the board while all other (non-<b>Node</b>) ions in the Vector are removed.",
      demo: "node"
    },
    {
      title: "No Long Lines",
      message: "You cannot place an ion that would create a line longer than 4 ions of your color.",
      demo: "long-line"
    },
    {
      title: "The Winning Goal",
      message: "Win by forming a <b>Nexus</b>:<br>A <b>Nexus</b> is a line of 4 Nodes of one color!",
      demo: "nexus"
    },
    {
      title: "Alternative Win",
      message: "<b>No legal moves:</b><br>If at any time either player is unable to play a legal move, the game ends and the player with the most Nodes wins.<br><br><b>Timer expiry:</b><br>If players have chosen to play using a timer, the game will end immediately if one player runs out of time, and the opponent will be awarded the win.<br><br><b>Resignation:</b><br>A player may choose to resign a game at any point and this will award the win to their opponent.",
      demo: null
    },
    {
      title: "How to Start a Multiplayer Game",
      message: `
        <b>Select 'Opponent':</b><br>
        On the main menu, find 'Opponent', and select 'Online Multiplayer'.<br><br>
        <b>Choose How to Play:</b><br>
        <ul style='margin:0 0 0 1.2em;padding:0;'>
          <li><b>Quick Match:</b> Click "Quick Match" to be paired with a random online opponent. The game will start automatically when a match is found.</li>
          <li><b>Create a Room:</b> Click "Create Room" to start a private game. You'll get a unique room code to share with a friend.</li>
          <li><b>Join a Room:</b> If your friend has already created a room, enter the room code they give you and click "Join Room."</li>
          <li><b>Play as Guest:</b> If you don't want to sign in, you can choose "Play as Guest" to join multiplayer games without creating an account.</li>
        </ul>
        <br>
        <b>Wait for Your Opponent:</b><br>
        Once both players are in the room (or a match is found), the game will begin automatically.
      `,
      demo: null
    },
    {
      title: "Ready to Play!",
      message: "You have two options - play against a human opponent or try your luck against our resident AI <b>CORE</b> (Cognitive, Operational Reasoning Engine).<br><br>You can play with a timer or without.<br>Choose from a 3-minute game or up to an hour on the clock.<br>You can even choose increments from 2 to 10 seconds which add time to your clock after every move.<br>Once you run out of time, it's game over.<br><br>Is it better to build your own Vectors or block your opponent?<br>Will you go for a Nexus or fill the board and see who ends up with the most Nodes?<br>The options are endless.<br><br>That's all you need to know!<br>Click 'Start' and enjoy playing Kuyoku!",
      demo: null
    }
  ];

  // Tutorial navigation functions
  const nextTutorialStep = () => {
    if (tutorialStep < tutorialSteps.length - 1) {
      setTutorialStep(tutorialStep + 1);
    } else {
      closeTutorial();
    }
  };

  const prevTutorialStep = () => {
    if (tutorialStep > 0) {
      setTutorialStep(tutorialStep - 1);
    }
  };

  const closeTutorial = () => {
    setShowTutorial(false);
    setTutorialStep(0);
  };

  // Review mode functions
  const enterReviewMode = () => {
    if (moveHistory.length === 0) return;
    
    setOriginalGameState({ ...gameState });
    setIsReviewMode(true);
    
    // Start at the last move (final position) instead of move 0
    const finalMoveIndex = moveHistory.length;
    goToMove(finalMoveIndex);
  };

  const exitReviewMode = () => {
    if (originalGameState) {
      setGameState(originalGameState);
      setOriginalGameState(null);
    }
    setIsReviewMode(false);
    setCurrentReviewMove(0);
  };

  const goToMove = useCallback((moveIndex: number) => {
    if (moveIndex < 0 || moveIndex > moveHistory.length) return;
    
    setCurrentReviewMove(moveIndex);
    
    // Reconstruct board state up to this move
    const board = Array(8).fill(null).map(() => Array(8).fill(null));
    let currentPlayer: 'white' | 'black' = 'white';
    
    for (let i = 0; i < moveIndex; i++) {
      const move = moveHistory[i];
      const { row, col, player } = move;
      
      // Place the ion
      board[row][col] = { color: player, isNode: false };
      
      // Check for vectors and process them
      const vectors = checkForVectors(board, row, col, player);
      const { nodeType } = processVectors(board, vectors, row, col);
      
      // If vectors were formed, make this cell a node
      if (nodeType) {
        board[row][col] = { color: player, isNode: true, nodeType };
      }
      
      currentPlayer = player === 'white' ? 'black' : 'white';
    }
    
    const scores = {
      white: countNodes(board, 'white'),
      black: countNodes(board, 'black')
    };
    
    const lastMove = moveIndex > 0 ? {
      row: moveHistory[moveIndex - 1].row,
      col: moveHistory[moveIndex - 1].col,
      player: moveHistory[moveIndex - 1].player
    } : null;
    
    // Check for nexus at the final position if this is the last move
    let nexusLine: { row: number; col: number }[] | null = null;
    if (moveIndex === moveHistory.length && lastMove) {
      nexusLine = checkForNexus(board, lastMove.row, lastMove.col, lastMove.player);
    }
    
    setGameState(prev => ({
      ...prev,
      board,
      currentPlayer,
      scores,
      lastMove,
      nexusLine
    }));
  }, [moveHistory, setCurrentReviewMove, setGameState]);

  const firstMove = () => {
    goToMove(0);
  };

  const lastMove = () => {
    goToMove(moveHistory.length);
  };

  const previousMove = useCallback(() => {
    if (currentReviewMove > 0) {
      goToMove(currentReviewMove - 1);
    }
  }, [currentReviewMove, goToMove]);

  const nextMove = useCallback(() => {
    if (currentReviewMove < moveHistory.length) {
      goToMove(currentReviewMove + 1);
    }
  }, [currentReviewMove, moveHistory.length, goToMove]);

  // Hold-to-scroll functionality
  const startHoldScroll = (direction: 'prev' | 'next', event?: React.MouseEvent | React.TouchEvent) => {
    event?.preventDefault();
    
    // Clear any existing timeouts/intervals
    if (holdScrollInterval) {
      clearTimeout(holdScrollInterval);
      setHoldScrollInterval(null);
    }
    
    const scrollFunction = direction === 'prev' ? previousMove : nextMove;
    
    // Immediate first move
    scrollFunction();
    
    // Wait 0.5 seconds before starting continuous scroll
    const timeout = setTimeout(() => {
      // Then continue scrolling every 500ms (2 moves per second)
      const interval = setInterval(() => {
        scrollFunction();
      }, 500);
      
      setHoldScrollInterval(interval);
      setHoldScrollInterval(null); // Clear timeout reference since it's done
    }, 500);
    
    setHoldScrollInterval(timeout);
  };

  const stopHoldScroll = (event?: React.MouseEvent | React.TouchEvent) => {
    event?.preventDefault();
    
    // Clear timeout if still waiting
    if (holdScrollInterval) {
      clearTimeout(holdScrollInterval);
      setHoldScrollInterval(null);
    }
    
    // Clear interval if scrolling
    if (holdScrollInterval) {
      clearInterval(holdScrollInterval);
      setHoldScrollInterval(null);
    }
  };

  // Cleanup hold timeout and interval when component unmounts or review mode exits
  useEffect(() => {
    return () => {
      if (holdScrollInterval) {
        clearTimeout(holdScrollInterval);
      }
      if (holdScrollInterval) {
        clearInterval(holdScrollInterval);
      }
    };
  }, [holdScrollInterval]);

  useEffect(() => {
    if (!isReviewMode) {
      if (holdScrollInterval) {
        clearTimeout(holdScrollInterval);
        setHoldScrollInterval(null);
      }
      if (holdScrollInterval) {
        clearInterval(holdScrollInterval);
        setHoldScrollInterval(null);
      }
    }
  }, [isReviewMode, holdScrollInterval]);

  const renderCell = (row: number, col: number) => {
    const cell = gameState.board[row][col];
    const isLastMove = gameState.lastMove?.row === row && gameState.lastMove?.col === col;
    const isNexusCell = gameState.nexusLine?.some(pos => pos.row === row && pos.col === col) || false;
    
    return (
      <div
        key={`${row}-${col}`}
        className={`cell ${isLastMove ? 'last-move' : ''} ${isNexusCell ? 'nexus-cell' : ''}`}
        onClick={() => handleCellClick(row, col)}
      >
        {/* Cell coordinate labels - only show on edges like a chess board */}
        {col === 0 && <div className="cell-row-label">{8 - row}</div>}
        {row === 7 && <div className="cell-col-label">{String.fromCharCode(97 + col)}</div>}
        
        {cell && (
          <>
            {/* Always render the ion (colored piece) */}
            <div className={`ion ${cell.color} ${isLastMove ? 'new-ion' : ''}`} />
            {/* If it's a node, also render the node indicator on top (no animation to avoid transform conflicts) */}
            {cell.isNode && (
              <div 
                className={`node ${cell.nodeType || 'standard'}`} 
                title={`Node type: ${cell.nodeType || 'standard'}`}
              />
            )}
          </>
        )}
      </div>
    );
  };

  const renderBoard = () => {
    return (
      <div className={`board ${isReviewMode ? 'review-mode' : 'current-state'}`} id="game-board">
        {gameState.board.map((row, rowIndex) =>
          row.map((_, colIndex) => renderCell(rowIndex, colIndex))
        )}
      </div>
    );
  };

  const renderMoveHistory = () => {
    return (
      <div className={`game-log ${isReviewMode ? 'with-review-controls' : ''}`} id="game-log">
        {Array.from({ length: Math.ceil(moveHistory.length / 2) }, (_, pairIndex) => {
          const whiteMove = moveHistory[pairIndex * 2];
          const blackMove = moveHistory[pairIndex * 2 + 1];
          const moveNumber = pairIndex + 1;
          
          return (
            <div key={pairIndex} className="log-entry">
              <span className="move-number">{moveNumber}.</span>
              <span 
                className={`white-move ${isReviewMode && whiteMove && currentReviewMove - 1 === pairIndex * 2 ? 'highlighted-move' : ''}`}
                onClick={() => isReviewMode && whiteMove ? goToMove(pairIndex * 2 + 1) : undefined}
                style={{ cursor: isReviewMode && whiteMove ? 'pointer' : 'default' }}
              >
                {whiteMove ? (
                  <span>
                    {getNotation(whiteMove.col, whiteMove.row)}
                    {whiteMove.vectors > 0 && <span className="node-indicator">●</span>}
                  </span>
                ) : ''}
              </span>
              <span 
                className={`black-move ${isReviewMode && blackMove && currentReviewMove - 1 === pairIndex * 2 + 1 ? 'highlighted-move' : ''}`}
                onClick={() => isReviewMode && blackMove ? goToMove(pairIndex * 2 + 2) : undefined}
                style={{ cursor: isReviewMode && blackMove ? 'pointer' : 'default' }}
              >
                {blackMove ? (
                  <span>
                    {getNotation(blackMove.col, blackMove.row)}
                    {blackMove.vectors > 0 && <span className="node-indicator">●</span>}
                  </span>
                ) : ''}
              </span>
            </div>
          );
        })}
        
        {/* Review mode controls */}
        {isReviewMode && (
          <div id="review-section">
            <div className="review-controls">
              <button 
                className="btn" 
                id="first-move-btn"
                onClick={firstMove}
                disabled={currentReviewMove <= 0}
                title="First Move"
              >
                <span className="arrow-icon">⏮</span>
              </button>
              <button 
                className="btn" 
                id="prev-move-btn"
                onMouseDown={(e) => startHoldScroll('prev', e)}
                onMouseUp={(e) => stopHoldScroll(e)}
                onMouseLeave={(e) => stopHoldScroll(e)}
                onTouchStart={(e) => startHoldScroll('prev', e)}
                onTouchEnd={(e) => stopHoldScroll(e)}
                disabled={currentReviewMove <= 0}
                title="Previous Move (Hold to scroll)"
              >
                <span className="arrow-icon">◀</span>
              </button>
              <span className="move-counter">
                Move {currentReviewMove} of {moveHistory.length}
              </span>
              <button 
                className="btn" 
                id="next-move-btn"
                onMouseDown={(e) => startHoldScroll('next', e)}
                onMouseUp={(e) => stopHoldScroll(e)}
                onMouseLeave={(e) => stopHoldScroll(e)}
                onTouchStart={(e) => startHoldScroll('next', e)}
                onTouchEnd={(e) => stopHoldScroll(e)}
                disabled={currentReviewMove >= moveHistory.length}
                title="Next Move (Hold to scroll)"
              >
                <span className="arrow-icon">▶</span>
              </button>
              <button 
                className="btn" 
                id="last-move-btn"
                onClick={lastMove}
                disabled={currentReviewMove >= moveHistory.length}
                title="Last Move"
              >
                <span className="arrow-icon">⏭</span>
              </button>
            </div>
            <div style={{ textAlign: 'center', marginTop: '5px' }}>
              <button 
                className="btn" 
                onClick={exitReviewMode}
                style={{ fontSize: '12px', padding: '4px 12px' }}
              >
                Exit Review
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Detects if placing a piece at (row, col) for playerColor creates three connected nodes with open ends
  const createsDoubleEndedNodeThreat = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black'): boolean => {
    const directions = [
      [0, 1], [1, 0], [1, 1], [1, -1]
    ];
    for (const [dr, dc] of directions) {
      let count = 1;
      let ends = [false, false];
      // Forward direction
      let r = row + dr, c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c]?.color === playerColor && board[r][c]?.isNode) {
        count++;
        r += dr;
        c += dc;
      }
      if (r >= 0 && r < 8 && c >= 0 && c < 8 && !board[r][c]) ends[0] = true;
      // Backward direction
      r = row - dr; c = col - dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c]?.color === playerColor && board[r][c]?.isNode) {
        count++;
        r -= dr;
        c -= dc;
      }
      if (r >= 0 && r < 8 && c >= 0 && c < 8 && !board[r][c]) ends[1] = true;
      if (count === 3 && ends[0] && ends[1]) {
        return true;
      }
    }
    return false;
  };

  // Add state for player color choice
  const [playerColorChoice, setPlayerColorChoice] = useState<'white' | 'black' | 'random'>('white');

  // When starting a new AI game, determine playerColor based on playerColorChoice
  const startAIGame = () => {
    let chosenColor: 'white' | 'black';
    if (playerColorChoice === 'random') {
      chosenColor = Math.random() < 0.5 ? 'white' : 'black';
    } else {
      chosenColor = playerColorChoice;
    }
    setPlayerColor(chosenColor);

    // Initialize the game state with the selected color as the starting player
    const newBoard = Array(8).fill(null).map(() => Array(8).fill(null));
    setGameState({
      board: newBoard,
      currentPlayer: chosenColor,
      scores: { white: 0, black: 0 },
      gameStatus: 'active',
      lastMove: null,
      players: {
        white: 'White',
        black: `CORE ${gameMode.toUpperCase()}`
      },
      nexusLine: null
    });
    setIsGameStarted(true);
    setMoveHistory([]);

    if (timerEnabled) {
      const totalSeconds = minutesPerPlayer * 60;
      setTimers({ white: totalSeconds, black: totalSeconds });
      setActiveTimer(chosenColor);
    }
  };

  // --- AI-4: Strongest AI ---
  // Opening Book for first 2 moves (center and adjacent to center)
  const openingBookAI4: { row: number; col: number }[] = [
    { row: 3, col: 3 }, { row: 3, col: 4 }, { row: 4, col: 3 }, { row: 4, col: 4 },
    { row: 2, col: 3 }, { row: 3, col: 2 }, { row: 5, col: 4 }, { row: 4, col: 5 }
  ];

  // Transposition Table for minimax
  const transTableAI4: Map<string, { score: number; bestMove: { row: number; col: number } | null; depth: number }> = new Map();

  function boardHash(board: (Cell | null)[][], player: 'white' | 'black', depth: number): string {
    return JSON.stringify(board) + '|' + player + '|' + depth;
  }

  function minimaxAI4(
    board: (Cell | null)[][],
    depth: number,
    alpha: number,
    beta: number,
    maximizingPlayer: boolean,
    playerColor: 'white' | 'black',
    originalDepth: number
  ): { score: number; bestMove: { row: number; col: number } | null } {
    const hash = boardHash(board, playerColor, depth);
    if (transTableAI4.has(hash)) {
      const entry = transTableAI4.get(hash)!;
      if (entry.depth >= depth) return { score: entry.score, bestMove: entry.bestMove };
    }
    // Terminal or depth limit
    const moves: { row: number; col: number }[] = getAllValidMoves(board, playerColor);
    if (depth === 0 || moves.length === 0) {
      const score = enhancedEvaluatePosition(board, playerColor, originalDepth - depth);
      return { score, bestMove: null };
    }
    // Move ordering: sort by heuristic
    moves.sort((a, b) => enhancedEvaluateMove(board, b.row, b.col, playerColor) - enhancedEvaluateMove(board, a.row, a.col, playerColor));
    let bestMove: { row: number; col: number } | null = null;
    let bestScore = maximizingPlayer ? -Infinity : Infinity;
    for (const move of moves) {
      const newBoard = makeMove(board, move.row, move.col, playerColor);
      const nextPlayer: 'white' | 'black' = playerColor === 'white' ? 'black' : 'white';
      const result = minimaxAI4(newBoard, depth - 1, alpha, beta, !maximizingPlayer, nextPlayer, originalDepth);
      if (maximizingPlayer) {
        if (result.score > bestScore) {
          bestScore = result.score;
          bestMove = move;
        }
        alpha = Math.max(alpha, bestScore);
        if (beta <= alpha) break;
      } else {
        if (result.score < bestScore) {
          bestScore = result.score;
          bestMove = move;
        }
        beta = Math.min(beta, bestScore);
        if (beta <= alpha) break;
      }
    }
    transTableAI4.set(hash, { score: bestScore, bestMove, depth });
    return { score: bestScore, bestMove };
  }

  // Enhanced evaluation function for AI-4
  function enhancedEvaluatePosition(
    board: (Cell | null)[][],
    playerColor: 'white' | 'black',
    ply: number
  ): number {
    // Dynamic weights: early game = center, late = threats
    const totalPieces = board.flat().filter(cell => cell !== null).length;
    let score = 0;
    // Center control (early game)
    if (totalPieces < 16) {
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        if (board[r][c]?.color === playerColor) {
          const centerDist = Math.abs(r - 3.5) + Math.abs(c - 3.5);
          score += (7 - centerDist) * 10;
        }
      }
    }
    // Threats, vectors, nexus (mid/late game)
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (board[r][c]?.color === playerColor) {
        // Vectors
        const vectors = checkForVectors(board, r, c, playerColor);
        score += 2000 * vectors.length;
        // Nexus
        if (vectors.length > 0) {
          const testBoard = board.map(row => [...row]);
          testBoard[r][c] = { color: playerColor, isNode: true, nodeType: 'standard' };
          if (checkForNexus(testBoard, r, c, playerColor)) score += 10000;
        }
        // Forks (multiple threats)
        let forkCount = 0;
        const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
        for (const [dr, dc] of directions) {
          let line = 1;
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr][cc]?.color === playerColor) {
            line++;
            rr += dr; cc += dc;
          }
          if (line >= 3) forkCount++;
        }
        if (forkCount >= 2) score += 300 * forkCount;
        // Connectivity
        let connections = 0;
        for (const [dr, dc] of directions) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc]?.color === playerColor) connections++;
        }
        score += connections * 25;
      }
      // Penalize isolated pieces
      if (board[r][c]?.color === playerColor) {
        let connected = false;
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc]?.color === playerColor) connected = true;
        }
        if (!connected) score -= 50;
      }
    }
    // Block opponent threats
    const oppColor = playerColor === 'white' ? 'black' : 'white';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (board[r][c]?.color === oppColor) {
        const vectors = checkForVectors(board, r, c, oppColor);
        score -= 1800 * vectors.length;
        const testBoard = board.map(row => [...row]);
        testBoard[r][c] = { color: oppColor, isNode: true, nodeType: 'standard' };
        if (checkForNexus(testBoard, r, c, oppColor)) score -= 9500;
      }
    }
    return score;
  }

  function enhancedEvaluateMove(
    board: (Cell | null)[][],
    row: number,
    col: number,
    playerColor: 'white' | 'black'
  ): number {
    const testBoard = makeMove(board, row, col, playerColor);
    return enhancedEvaluatePosition(testBoard, playerColor, 0);
  }

  // Replace getAIMove for ai-4
  const getAIMove = (
    board: (Cell | null)[][],
    difficulty: 'ai-1' | 'ai-2' | 'ai-3' | 'ai-4'
  ): { row: number; col: number } | null => {
    if (difficulty === 'ai-4') {
      // Opening book for first 2 moves
      const totalPieces = board.flat().filter(cell => cell !== null).length;
      if (totalPieces < 2) {
        for (const move of openingBookAI4) {
          if (isValidMove(board, move.row, move.col, 'black')) return move;
        }
      }
      // Minimax with alpha-beta, depth 3 (increase to 4 if fast enough)
      transTableAI4.clear();
      const { bestMove } = minimaxAI4(board, 3, -Infinity, Infinity, true, 'black', 3);
      return bestMove;
    }
    // ... existing code for ai-1, ai-2, ai-3 ...
    // ... existing code ...
    return null;
  };
  // ... existing code ...

  return (
    <div className="App">
      <header>
        <h1>Kuyoku</h1>
        {(authState.isAuthenticated || authState.isGuest) && (
          <div style={{ 
            position: 'absolute', 
            top: '20px', 
            right: '20px', 
            fontSize: '14px', 
            color: '#666',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            {authState.isAuthenticated ? (
              <>
                <span>Welcome, {authState.user?.username}!</span>
                <button 
                  className="btn" 
                  onClick={handleLogout}
                  style={{ fontSize: '12px', padding: '4px 8px', height: 'auto' }}
                >
                  Logout
                </button>
              </>
            ) : authState.isGuest ? (
              <span>Playing as Guest</span>
            ) : null}
          </div>
        )}
      </header>

      <div className="game-container">
        <div className="game-board-area">
          {/* Top player info */}
          <div className="player-info" style={{ width: 'calc(var(--board-size) + 4px)', boxSizing: 'border-box' }}>
              <div className={`player ${gameState.currentPlayer === 'white' ? 'active' : ''}`} id="player-white">
                <div className="player-color white"></div>
                <span>
                  {(() => {
                    if (!isGameStarted) {
                      return 'White';
                    } else if (gameMode === 'online' && playerColor) {
                      // Multiplayer game - show actual usernames without color labels
                      const whiteName = playerColor === 'white' ? 
                        (authState.user?.username || 'Guest') : 
                        opponentName;
                      return whiteName;
                    } else if ((gameMode === 'ai-1' || gameMode === 'ai-2' || gameMode === 'ai-3') && authState.isAuthenticated) {
                      // AI game with authenticated user - show username for white (human player)
                      return authState.user?.username;
                    } else {
                      // Local human vs human or unauthenticated - use gameState players
                      return gameState.players.white;
                    }
                  })()}
                </span>
                <span>Nodes: <span id="white-score">{gameState.scores.white}</span></span>
              </div>
              {timerEnabled && (
                <div className="player-timer" id="white-timer">
                  {formatTime(timers.white)}
                </div>
              )}
          </div>

          {/* Game board */}
          <div className="board-with-labels">
            <div>
              {renderBoard()}
            </div>
          </div>

          {/* Bottom player info */}
          <div className="player-info bottom" style={{ width: 'calc(var(--board-size) + 4px)', boxSizing: 'border-box' }}>
            <div className={`player ${gameState.currentPlayer === 'black' ? 'active' : ''}`} id="player-black">
              <div className="player-color black"></div>
              <span>
                {(() => {
                  if (!isGameStarted) {
                    return 'Black';
                  } else if (gameMode === 'online' && playerColor) {
                    // Multiplayer game - show actual usernames without color labels
                    const blackName = playerColor === 'black' ? 
                      (authState.user?.username || 'Guest') : 
                      opponentName;
                    return blackName;
                  } else if ((gameMode === 'ai-1' || gameMode === 'ai-2' || gameMode === 'ai-3') && authState.isAuthenticated) {
                    // AI game - black is always the AI, show AI name without color label
                    return gameState.players.black;
                  } else {
                    // Local human vs human or unauthenticated - use gameState players
                    return gameState.players.black;
                  }
                })()}
              </span>
              <span>Nodes: <span id="black-score">{gameState.scores.black}</span></span>
            </div>
            {timerEnabled && (
              <div className="player-timer" id="black-timer">
                {formatTime(timers.black)}
              </div>
            )}
          </div>
        </div>

        {/* Game controls */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          {/* Action buttons */}
          <div className="player-buttons" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '256px', marginBottom: '0' }}>
            <button 
              className="btn action-btn" 
              onClick={isGameStarted && gameState.gameStatus === 'active' ? 
                (gameMode === 'online' ? showResignDrawOptions : resignGame) : startGame}
              style={{ 
                height: '40px', 
                padding: '0 24px',
                backgroundColor: !isGameStarted ? '#28a745' : undefined,
                color: !isGameStarted ? 'white' : undefined
              }}
            >
              {isGameStarted && gameState.gameStatus === 'active' ? 
                (gameMode === 'online' ? 'Resign/Draw' : 'Resign') : 'Start'}
            </button>
            <button 
              className="btn action-btn" 
              onClick={resetGame}
              style={{ height: '40px', padding: '0 24px' }}
            >
              Reset
            </button>
          </div>

          {/* Mobile controls button - only show on mobile when game is not started */}
          {!isGameStarted && (
            <div className="mobile-controls-button" style={{ width: '256px', marginBottom: '10px' }}>
              <button 
                className="btn mobile-only" 
                onClick={() => setShowMobileControls(true)}
                style={{ width: '100%', height: '40px' }}
              >
                Game Settings
              </button>
            </div>
          )}

          {/* Game controls area */}
          <div className="game-controls-area" style={{ height: 'calc(var(--board-size) + 4px)', width: '256px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {!isGameStarted && (
              <div id="pregame-controls">
                <div className="option-row">
                  <label htmlFor="game-mode-select">Opponent:</label>
                  <select 
                    id="game-mode-select" 
                    className="control-select"
                    value={gameMode}
                    onChange={(e) => setGameMode(e.target.value as any)}
                  >
                    <option value="local">Local Play</option>
                    <option value="ai-1">CORE AI-1</option>
                    <option value="ai-2">CORE AI-2</option>
                    <option value="ai-3">CORE AI-3</option>
                    <option value="online">Online Multiplayer</option>
                  </select>
                </div>

                {/* Color selection segmented control for AI games */}
                {(gameMode.startsWith('ai-')) && (
                  <div className="option-row" style={{ marginTop: 8, marginBottom: 8, justifyContent: 'center' }}>
                    <span style={{ marginRight: 8 }}>Play as:</span>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button
                        type="button"
                        className={`color-choice-btn${playerColorChoice === 'white' ? ' selected' : ''}`}
                        aria-label="Play as White"
                        onClick={() => setPlayerColorChoice('white')}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', background: playerColorChoice === 'white' ? '#ecf0f1' : 'white', fontWeight: playerColorChoice === 'white' ? 'bold' : 'normal' }}
                      >
                        ⚪
                      </button>
                      <button
                        type="button"
                        className={`color-choice-btn${playerColorChoice === 'black' ? ' selected' : ''}`}
                        aria-label="Play as Black"
                        onClick={() => setPlayerColorChoice('black')}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', background: playerColorChoice === 'black' ? '#2c3e50' : 'white', color: playerColorChoice === 'black' ? 'white' : '#2c3e50', fontWeight: playerColorChoice === 'black' ? 'bold' : 'normal' }}
                      >
                        ⚫
                      </button>
                      <button
                        type="button"
                        className={`color-choice-btn${playerColorChoice === 'random' ? ' selected' : ''}`}
                        aria-label="Random Color"
                        onClick={() => setPlayerColorChoice('random')}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', background: playerColorChoice === 'random' ? '#f9e79f' : 'white', fontWeight: playerColorChoice === 'random' ? 'bold' : 'normal' }}
                      >
                        🎲
                      </button>
                    </div>
                  </div>
                )}

                <div className="option-row">
                  <label htmlFor="timer-toggle">Game Timer:</label>
                  <div className="toggle-container">
                    <span className="toggle-label">Off</span>
                    <label className="toggle small">
                      <input 
                        type="checkbox" 
                        id="timer-toggle" 
                        checked={timerEnabled}
                        onChange={(e) => setTimerEnabled(e.target.checked)}
                      />
                      <span className="slider round"></span>
                    </label>
                    <span className={`toggle-label ${timerEnabled ? 'active' : ''}`}>On</span>
                  </div>
                </div>

                {timerEnabled && (
                  <div className="timer-settings" id="timer-settings">
                    <div className="timer-row">
                      <div className="option-cell">
                        <label htmlFor="minutes-per-player">Minutes:</label>
                        <select 
                          id="minutes-per-player" 
                          className="control-select"
                          value={minutesPerPlayer}
                          onChange={(e) => setMinutesPerPlayer(parseInt(e.target.value))}
                        >
                          <option value="60">60</option>
                          <option value="30">30</option>
                          <option value="15">15</option>
                          <option value="10">10</option>
                          <option value="5">5</option>
                          <option value="3">3</option>
                        </select>
                      </div>
                      <div className="option-cell">
                        <label htmlFor="increment-seconds">Increment:</label>
                        <select 
                          id="increment-seconds" 
                          className="control-select"
                          value={incrementSeconds}
                          onChange={(e) => setIncrementSeconds(parseInt(e.target.value))}
                        >
                          <option value="10">10 sec</option>
                          <option value="5">5 sec</option>
                          <option value="2">2 sec</option>
                          <option value="0">0 sec</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Game log */}
            <div id="game-log-container">
              <div className="review-button-container" style={{ width: '236px', margin: '15px auto 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: '1.2em', margin: '0' }}>Game Log</h2>
                {moveHistory.length > 0 && !isReviewMode && (
                  <button 
                    className="review-button" 
                    onClick={enterReviewMode}
                    style={{ display: 'inline-block' }}
                  >
                    Review
                  </button>
                )}
              </div>
              {renderMoveHistory()}
            </div>
          </div>

          {/* Utility buttons */}
          <div className="utility-buttons-container" style={{ width: '256px', display: 'flex', alignItems: 'center', height: '40px', marginTop: '0', marginLeft: '-4px' }}>
            <div className="utility-buttons" style={{ display: 'flex', width: '100%', justifyContent: 'space-between' }}>
              <button 
                className="btn" 
                onClick={() => setShowTutorial(true)}
                style={{ height: '40px', flex: 1, margin: '0 5px' }}
              >
                Tutorial
              </button>
              <button 
                className="btn" 
                onClick={() => setShowRules(true)}
                style={{ height: '40px', flex: 1, margin: '0 5px' }}
              >
                Rules
              </button>
              <button 
                className="btn" 
                onClick={() => setShowSettings(true)}
                style={{ height: '40px', flex: 1, margin: '0 5px' }}
              >
                Settings
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tutorial popup */}
      {showTutorial && (
        <>
          <div className="overlay tutorial-overlay" style={{ display: 'block' }} onClick={closeTutorial} />
          <div className="tutorial-popup" id="tutorial-popup" style={{ display: 'block' }}>
            <div id="tutorial-content">
              <h2 id="tutorial-title">{tutorialSteps[tutorialStep]?.title}</h2>
              <div id="tutorial-message">
                <div dangerouslySetInnerHTML={{ __html: tutorialSteps[tutorialStep]?.message || '' }} />
              </div>
              <div id="tutorial-demo">
                {tutorialSteps[tutorialStep]?.demo && (
                  <TutorialDemo demoType={tutorialSteps[tutorialStep].demo!} />
                )}
              </div>
              <div className="tutorial-navigation">
                {tutorialStep > 0 && (
                  <button className="btn" onClick={prevTutorialStep}>
                    Previous
                  </button>
                )}
                {tutorialStep < tutorialSteps.length - 1 && (
                  <button className="btn" onClick={nextTutorialStep}>
                    Next
                  </button>
                )}
                {tutorialStep === tutorialSteps.length - 1 && (
                  <button className="btn" onClick={nextTutorialStep}>
                    Finish
                  </button>
                )}
                <button className="btn" onClick={closeTutorial}>
                  Close
                </button>
              </div>
            </div>
            <button 
              id="mobile-tutorial-close-x"
              onClick={closeTutorial}
              style={{ display: 'block' }}
            >
              ×
            </button>
          </div>
        </>
      )}

      {/* Rules popup */}
      {showRules && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setShowRules(false)} />
          <div className="notification rules-popup" style={{ display: 'block' }}>
            <h2>Kuyoku Game Rules</h2>
            
            <h3>Overview</h3>
            <p>Kuyoku is a strategic board game played on an 8x8 grid between two players: White and Black. It involves placing pieces (called "Ions") and forming special patterns to create "Nodes" and ultimately a "Nexus" to win.</p>
            
            <h3>Core Rules</h3>
            <ul>
              <li>Players take turns placing Ions (white or black) on an 8×8 board.</li>
              <li>White always moves first.</li>
              <li>The goal is to form "Vectors" (unbroken lines of exactly 4 Ions of the same color) horizontally, vertically, or diagonally.</li>
              <li>Players cannot form lines longer than 4 Ions of the same color.</li>
              <li>When a Vector is formed, the last Ion placed becomes a "Node" (marked with a red indicator) that stays on the board permanently.</li>
              <li>All other Ions in the Vector are removed from the board (except for existing Nodes).</li>
            </ul>
            
            <h3>Node Values</h3>
            <p>Creating multiple Vectors simultaneously creates more valuable Nodes:</p>
            <ul>
              <li>1 Vector = Standard Node (red dot)</li>
              <li>2 Vectors at once = Double Node (red horizontal oval)</li>
              <li>3 Vectors at once = Triple Node (red triangle)</li>
              <li>4 Vectors at once = Quadruple Node (red diamond)</li>
            </ul>
            
            <h3>Winning the Game</h3>
            <ul>
              <li>The main objective is to form a "Nexus" (a Vector of 4 Nodes) to win the game.</li>
              <li>If no player can form a Nexus and no more legal moves are possible, the player with the most Nodes wins.</li>
              <li>If both players have the same number of Nodes, the game is a draw.</li>
            </ul>
            
            <button className="btn" onClick={() => setShowRules(false)}>Close Rules</button>
          </div>
        </>
      )}



      {/* Settings popup */}
      {showSettings && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setShowSettings(false)} />
                      <div className="notification settings-dialog" style={{ display: 'block' }}>
            <h2>Settings</h2>
            
            {/* Theme Section */}
            <div className="settings-section">
              <h3>Theme</h3>
              <div className="option-row">
                <label>Theme:</label>
                <select 
                  className="control-select" 
                  value={currentTheme} 
                  onChange={(e) => handleThemeChange(e.target.value)}
                >
                <option value="classic">Classic</option>
                <option value="dark">Dark Mode</option>
                <option value="high-contrast">High Contrast</option>
                <option value="nature">Nature</option>
                                            <option value="felt">Felt</option>
                  <option value="custom">Custom</option>
              </select>
            </div>
              
              {/* Custom Colors (only show when custom theme selected) */}
              {currentTheme === 'custom' && (
                <div id="custom-colors" style={{ marginTop: '15px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '5px' }}>
                  <h4 style={{ marginBottom: '10px', fontSize: '1rem' }}>Custom Colors</h4>
                  
                  <div className="color-option">
                    <label>White Ion Color:</label>
                    <input
                      type="color"
                      value={customColors.whiteIon}
                      onChange={(e) => handleCustomColorChange('whiteIon', e.target.value)}
                    />
                  </div>
                  
                  <div className="color-option">
                    <label>Black Ion Color:</label>
                    <input
                      type="color"
                      value={customColors.blackIon}
                      onChange={(e) => handleCustomColorChange('blackIon', e.target.value)}
                    />
                  </div>
                  
                  <div className="color-option">
                    <label>Node Color:</label>
                    <input
                      type="color"
                      value={customColors.nodeColor}
                      onChange={(e) => handleCustomColorChange('nodeColor', e.target.value)}
                    />
                  </div>
                  
                  <div className="color-option">
                    <label>Board Color:</label>
                    <input
                      type="color"
                      value={customColors.boardColor}
                      onChange={(e) => handleCustomColorChange('boardColor', e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Sound Section */}
            <div className="settings-section">
              <h3>Sound</h3>
              <div className="option-row">
                <label>Sound Effects:</label>
                <div className="toggle-container">
                  <span className={`toggle-label ${!soundEnabled ? 'active' : ''}`}>Off</span>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={soundEnabled}
                      onChange={(e) => handleSoundToggle(e.target.checked)}
                    />
                    <span className="slider round"></span>
                  </label>
                  <span className={`toggle-label ${soundEnabled ? 'active' : ''}`}>On</span>
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="notification-buttons">
              <button className="btn" onClick={handleViewStats} disabled={statsLoading}>
                {statsLoading ? 'Loading...' : 'View Statistics'}
              </button>
              <button className="btn" onClick={resetSettings}>Reset to Defaults</button>
              <button className="btn" onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </>
      )}

      {/* Login modal */}
      {showLogin && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setShowLogin(false)} />
          <div className="notification" style={{ display: 'block' }}>
            <h2>Log In</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target as HTMLFormElement);
              handleLogin(
                formData.get('email') as string,
                formData.get('password') as string
              );
            }}>
              <div style={{ marginBottom: '15px' }}>
                <label htmlFor="login-email" style={{ display: 'block', marginBottom: '5px' }}>Email:</label>
                <input
                  type="email"
                  id="login-email"
                  name="email"
                  required
                  style={{ width: '100%', padding: '8px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label htmlFor="login-password" style={{ display: 'block', marginBottom: '5px' }}>Password:</label>
                <input
                  type="password"
                  id="login-password"
                  name="password"
                  required
                  style={{ width: '100%', padding: '8px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
              </div>
              {authError && (
                <div style={{ color: 'red', marginBottom: '15px', fontSize: '14px' }}>
                  {authError}
                </div>
              )}
              <div className="notification-buttons">
                <button type="submit" className="btn">Log In</button>
                <button type="button" className="btn" onClick={() => { setShowLogin(false); setShowSignup(true); }}>
                  Sign Up Instead
                </button>
                <button type="button" className="btn" onClick={() => { setShowLogin(false); handlePlayAsGuest(); }}>
                  Play as Guest
                </button>
                <button type="button" className="btn" onClick={() => setShowLogin(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Signup modal */}
      {showSignup && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setShowSignup(false)} />
          <div className="notification" style={{ display: 'block' }}>
            <h2>Sign Up</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target as HTMLFormElement);
              handleSignup(
                formData.get('email') as string,
                formData.get('username') as string,
                formData.get('password') as string
              );
            }}>
              <div style={{ marginBottom: '15px' }}>
                <label htmlFor="signup-email" style={{ display: 'block', marginBottom: '5px' }}>Email:</label>
                <input
                  type="email"
                  id="signup-email"
                  name="email"
                  required
                  style={{ width: '100%', padding: '8px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label htmlFor="signup-username" style={{ display: 'block', marginBottom: '5px' }}>Username (6-20 characters):</label>
                <input
                  type="text"
                  id="signup-username"
                  name="username"
                  required
                  minLength={6}
                  maxLength={20}
                  pattern="[a-zA-Z][a-zA-Z0-9]{5,19}"
                  title="Username must be 6-20 characters, start with a letter, and contain only letters and numbers"
                  style={{ width: '100%', padding: '8px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label htmlFor="signup-password" style={{ display: 'block', marginBottom: '5px' }}>Password:</label>
                <input
                  type="password"
                  id="signup-password"
                  name="password"
                  required
                  minLength={8}
                  style={{ width: '100%', padding: '8px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
                <small style={{ fontSize: '12px', color: '#666', display: 'block', marginTop: '5px' }}>
                  Must contain: 8+ characters, uppercase, lowercase, number, and special character (!@#$%^&*)
                </small>
              </div>
              {authError && (
                <div style={{ color: 'red', marginBottom: '15px', fontSize: '14px' }}>
                  {authError}
                </div>
              )}
              <div className="notification-buttons">
                <button type="submit" className="btn">Sign Up</button>
                <button type="button" className="btn" onClick={() => { setShowSignup(false); setShowLogin(true); }}>
                  Log In Instead
                </button>
                <button type="button" className="btn" onClick={() => { setShowSignup(false); handlePlayAsGuest(); }}>
                  Play as Guest
                </button>
                <button type="button" className="btn" onClick={() => setShowSignup(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Stats authentication modal */}
      {showStatsAuth && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setShowStatsAuth(false)} />
          <div className="notification stats-auth-modal" style={{ display: 'block' }}>
            <h2>Track Your Stats</h2>
            <p style={{ marginBottom: '20px', lineHeight: '1.5' }}>
              To view and track your game statistics, you need a player account. 
              Create an account to keep track of your wins, losses, and game history!
            </p>
            <div className="notification-buttons">
              <button 
                type="button" 
                className="btn" 
                onClick={() => { 
                  setShowStatsAuth(false); 
                  setShowLogin(true); 
                }}
              >
                Log In
              </button>
              <button 
                type="button" 
                className="btn" 
                onClick={() => { 
                  setShowStatsAuth(false); 
                  setShowSignup(true); 
                }}
              >
                Sign Up
              </button>
              <button type="button" className="btn" onClick={() => setShowStatsAuth(false)}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Matchmaking modal */}
      {showMatchmaking && !currentRoom && (
        <>
          <div className="overlay" style={{ display: 'block', zIndex: 10001 }} onClick={() => setShowMatchmaking(false)} />
          <div className="notification matchmaking-modal" style={{ display: 'block', zIndex: 10002 }}>
            <h2>Online Multiplayer</h2>
            <div style={{ marginBottom: '15px', fontSize: '0.9rem', color: '#666' }}>
              Playing as: <strong>
                {authState.isAuthenticated ? authState.user?.username : 
                 authState.isGuest ? `Guest${Math.floor(Math.random() * 9000) + 1000}` : 'Anonymous'}
              </strong>
            </div>
            
            {/* Standard timer settings info */}
            <div style={{ margin: '15px 0', padding: '10px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '4px' }}>
              <div style={{ fontSize: '0.9rem', color: '#495057', textAlign: 'center' }}>
                <strong>⏱️ Standard Time Control</strong>
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#007bff', textAlign: 'center', marginTop: '5px' }}>
                10 minutes + 0 seconds increment
              </div>
              <div style={{ fontSize: '0.8rem', color: '#666', textAlign: 'center', marginTop: '3px' }}>
                All online games use this time control
              </div>
            </div>
            
            {isSearchingMatch ? (
              <>
                <p>Searching for a match...</p>
            <div className="notification-buttons">
                  <button className="btn" onClick={cancelMatchmaking}>Cancel Search</button>
                </div>
              </>
            ) : (
                <>
                <p>Choose how to play:</p>
                <div className="notification-buttons">
                  <button className="btn" onClick={findMatch}>🎯 Quick Match</button>
                  <button className="btn" onClick={() => setShowRoomModal(true)}>🏠 Private Room</button>
                  <button className="btn" onClick={() => setShowMatchmaking(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Room modal */}
      {showRoomModal && (
        <>
          <div className="overlay" style={{ display: 'block', zIndex: 10001 }} onClick={() => setShowRoomModal(false)} />
          <div className="notification" style={{ display: 'block', zIndex: 10002 }}>
            <h2>Private Room</h2>
            <p>Create a room to invite a friend, or join an existing room:</p>
            
            <div style={{ margin: '20px 0' }}>
              <div style={{ marginBottom: '15px' }}>
                <input
                  type="text"
                  placeholder="Enter room code (e.g. ABC123)"
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    fontSize: '16px',
                    textAlign: 'center',
                    letterSpacing: '2px',
                    fontFamily: 'monospace'
                  }}
                  maxLength={6}
                />
              </div>
            </div>
            
            <div className="notification-buttons">
              <button className="btn" onClick={createRoom}>Create Room</button>
              <button 
                className="btn" 
                onClick={joinRoom}
                disabled={!roomCodeInput.trim()}
                style={{ 
                  opacity: roomCodeInput.trim() ? 1 : 0.5,
                  cursor: roomCodeInput.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                Join Room
              </button>
              <button className="btn" onClick={() => setShowRoomModal(false)}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {/* Current room display */}
      {currentRoom && (
        <>
          <div className="overlay" style={{ display: 'block', zIndex: 10001 }} />
          <div className="notification" style={{ display: 'block', zIndex: 10002 }}>
            <h2>Room {currentRoom.code}</h2>
            
            <div style={{ margin: '20px 0', textAlign: 'center' }}>
              <div style={{ 
                padding: '15px', 
                backgroundColor: '#f8f9fa', 
                border: '1px solid #dee2e6', 
                borderRadius: '8px',
                marginBottom: '15px'
              }}>
                <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '10px' }}>
                  Share this code with your friend:
                </div>
                <div style={{ 
                  fontSize: '2rem', 
                  fontWeight: 'bold', 
                  letterSpacing: '4px',
                  fontFamily: 'monospace',
                  color: '#007bff'
                }}>
                  {currentRoom.code}
                </div>
              </div>
              
              <div style={{ textAlign: 'left' }}>
                <div style={{ marginBottom: '8px' }}>
                  <strong>Host:</strong> {currentRoom.hostName} {currentRoom.isHost && '(You)'}
                </div>
                <div style={{ marginBottom: '15px' }}>
                  <strong>Guest:</strong> {currentRoom.guestName || 'Waiting...'}
                </div>
                
                {currentRoom.status === 'waiting' && (
                  <div style={{ 
                    padding: '10px', 
                    backgroundColor: '#fff3cd', 
                    border: '1px solid #ffeaa7',
                    borderRadius: '4px',
                    color: '#856404'
                  }}>
                    ⏳ Waiting for opponent to join...
                  </div>
                )}
                
                {currentRoom.status === 'ready' && (
                  <div style={{ 
                    padding: '10px', 
                    backgroundColor: '#d4edda', 
                    border: '1px solid #c3e6cb',
                    borderRadius: '4px',
                    color: '#155724'
                  }}>
                    ✅ Both players ready! {currentRoom.isHost ? 'You can start the game.' : 'Waiting for host to start...'}
                  </div>
                )}
              </div>
            </div>
            
            <div className="notification-buttons">
              {currentRoom.isHost && currentRoom.status === 'ready' && (
                <button 
                  className="btn" 
                  onClick={startRoomGame}
                  style={{ backgroundColor: '#28a745', color: 'white' }}
                >
                  Start Game
                </button>
              )}
              <button className="btn" onClick={leaveRoom}>Leave Room</button>
            </div>
          </div>
        </>
      )}

      {/* Game notification */}
      {notification.show && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setNotification(prev => ({ ...prev, show: false }))} />
          <div className={`notification ${notification.title === 'Game Drawn' ? 'game-drawn-modal' : ''}`} style={{ display: 'block' }}>
            <h2>{notification.title}</h2>
            {notification.title === 'Play Online' && !authState.isAuthenticated && !authState.isGuest ? (
              <div className="notification-buttons">
                <button className="btn" onClick={() => { setNotification(prev => ({ ...prev, show: false })); setShowLogin(true); }}>
                  Log In
                </button>
                <button className="btn" onClick={() => { setNotification(prev => ({ ...prev, show: false })); setShowSignup(true); }}>
                  Sign Up
                </button>
                <button className="btn" onClick={() => { setNotification(prev => ({ ...prev, show: false })); handlePlayAsGuest(); }}>
                  Play as Guest
                </button>
                <button className="btn" onClick={() => setNotification(prev => ({ ...prev, show: false }))}>
                  Cancel
                </button>
              </div>
            ) : (notification.title === 'Game Over' || notification.title === 'Game Drawn' || notification.title === 'Time Out' || notification.title === 'Opponent Disconnected') && gameMode === 'online' && gameState.gameStatus === 'finished' ? (
              <>
                <p style={{ whiteSpace: 'pre-line', lineHeight: '1.5' }}>{notification.message}</p>
                {rematchState.requested ? (
                  <>
                    <div style={{ margin: '15px 0', padding: '10px', backgroundColor: '#f0f8ff', border: '1px solid #007bff', borderRadius: '4px' }}>
                      <p style={{ margin: '0', fontWeight: 'bold', color: '#007bff' }}>
                        🎯 {rematchState.requestedBy} has challenged you to a rematch!
                      </p>
                      <p style={{ margin: '5px 0 0 0', fontSize: '0.9em', color: '#666' }}>
                        Do you accept the challenge?
                      </p>
                    </div>
                    <div className="notification-buttons">
                      {/* Show Review Game button for online games with move history */}
                      {moveHistory.length > 0 && (
                        <button 
                          className="btn" 
                          onClick={() => {
                            setNotification(prev => ({ ...prev, show: false }));
                            enterReviewMode();
                          }}
                          style={{ backgroundColor: '#17a2b8', color: 'white' }}
                        >
                          📋 Review Game
                        </button>
                      )}
                      <button className="btn" onClick={() => respondToRematch(true)} style={{ backgroundColor: '#28a745', color: 'white' }}>
                        ⚔️ Accept Rematch
                      </button>
                      <button className="btn" onClick={() => respondToRematch(false)} style={{ backgroundColor: '#dc3545', color: 'white' }}>
                        ❌ Decline
                      </button>
                      <button className="btn" onClick={() => {
                        // Auto-decline rematch when closing modal if a challenge is pending
                        respondToRematch(false);
                      }}>
                        Close
                      </button>
                    </div>
                  </>
                ) : rematchState.waitingForResponse ? (
                  <>
                    <div style={{ margin: '15px 0', padding: '10px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px' }}>
                      <p style={{ margin: '0', fontWeight: 'bold', color: '#856404' }}>
                        ⏳ Waiting for opponent's response...
                      </p>
                      <p style={{ margin: '5px 0 0 0', fontSize: '0.9em', color: '#666' }}>
                        Your rematch challenge has been sent!
                      </p>
                    </div>
                    <div className="notification-buttons">
                      {/* Show Review Game button for online games with move history */}
                      {moveHistory.length > 0 && (
                        <button 
                          className="btn" 
                          onClick={() => {
                            setNotification(prev => ({ ...prev, show: false }));
                            enterReviewMode();
                          }}
                          style={{ backgroundColor: '#17a2b8', color: 'white' }}
                        >
                          📋 Review Game
                        </button>
                      )}
                      <button className="btn" onClick={() => setNotification(prev => ({ ...prev, show: false }))}>
                        Continue Waiting
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ margin: '15px 0', padding: '10px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '4px' }}>
                      <p style={{ margin: '0', fontWeight: 'bold', color: '#495057' }}>
                        🔄 Want to play again?
                      </p>
                      <p style={{ margin: '5px 0 0 0', fontSize: '0.9em', color: '#666' }}>
                        Challenge your opponent to a rematch! Colors will be swapped.
                      </p>
                    </div>
                    <div className="notification-buttons">
                      {/* Show Review Game button for online games with move history */}
                      {moveHistory.length > 0 && (
                        <button 
                          className="btn" 
                          onClick={() => {
                            setNotification(prev => ({ ...prev, show: false }));
                            enterReviewMode();
                          }}
                          style={{ backgroundColor: '#28a745', color: 'white' }}
                        >
                          📋 Review Game
                        </button>
                      )}
                      <button 
                        className="btn" 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log('Button clicked - event fired!');
                          requestRematch();
                        }}
                        style={{ 
                          backgroundColor: '#007bff', 
                          color: 'white',
                          zIndex: 1002,
                          position: 'relative',
                          pointerEvents: 'auto',
                          cursor: 'pointer'
                        }}
                      >
                        🎯 Request Rematch
                      </button>

                      <button className="btn" onClick={() => setNotification(prev => ({ ...prev, show: false }))}>
                        Close
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (notification.title === 'Game Over' || notification.title === 'Game Drawn' || notification.title === 'Time Out') && moveHistory.length > 0 ? (
              <>
                <p style={{ whiteSpace: 'pre-line', lineHeight: '1.5' }}>{notification.message}</p>
                <div className="notification-buttons">
                  {/* Show Review Game button for all devices when there's move history */}
                  <button 
                    className="btn" 
                    onClick={() => {
                      setNotification(prev => ({ ...prev, show: false }));
                      enterReviewMode();
                    }}
                    style={{ backgroundColor: '#28a745', color: 'white' }}
                  >
                    📋 Review Game
                  </button>
                  <button className="btn" onClick={() => setNotification(prev => ({ ...prev, show: false }))}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ whiteSpace: 'pre-line', lineHeight: '1.5' }}>{notification.message}</p>
                <div className="notification-buttons">
                  <button className="btn" onClick={() => setNotification(prev => ({ ...prev, show: false }))}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Mobile Controls Modal */}
      {showMobileControls && (
        <>
          <div className="overlay" style={{ display: 'block', zIndex: 14999 }} onClick={() => setShowMobileControls(false)} />
          <div className="notification mobile-controls-modal" style={{ display: 'block' }}>
            <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>Opponent</h2>
            
            {/* Opponent selection */}
            <div className="option-row" style={{ marginBottom: '20px' }}>
              <label htmlFor="mobile-game-mode-select" style={{ fontWeight: 'bold', fontSize: '16px' }}>Opponent:</label>
              <select 
                id="mobile-game-mode-select" 
                className="control-select"
                value={gameMode}
                onChange={(e) => setGameMode(e.target.value as any)}
                style={{ 
                  width: '100%', 
                  padding: '12px', 
                  fontSize: '16px',
                  border: '2px solid #ccc',
                  borderRadius: '6px',
                  backgroundColor: '#fff'
                }}
              >
                <option value="local">Local Play</option>
                <option value="ai-1">CORE AI-1</option>
                <option value="ai-2">CORE AI-2</option>
                <option value="ai-3">CORE AI-3</option>
                <option value="online">Online Multiplayer</option>
              </select>
            </div>

            {/* Timer toggle */}
            <div className="option-row" style={{ marginBottom: '15px' }}>
              <label htmlFor="mobile-timer-toggle" style={{ fontWeight: 'bold', fontSize: '16px' }}>Game Timer:</label>
              <div className="toggle-container">
                <span className={`toggle-label ${!timerEnabled ? 'active' : ''}`}>Off</span>
                <label className="toggle">
                  <input 
                    type="checkbox" 
                    id="mobile-timer-toggle" 
                    checked={timerEnabled}
                    onChange={(e) => setTimerEnabled(e.target.checked)}
                  />
                  <span className="slider round"></span>
                </label>
                <span className={`toggle-label ${timerEnabled ? 'active' : ''}`}>On</span>
              </div>
            </div>

            {/* Timer settings */}
            {timerEnabled && (
              <div className="timer-settings" style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                <div className="timer-row" style={{ marginBottom: '15px' }}>
                  <div className="option-cell" style={{ flex: 1, marginRight: '10px' }}>
                    <label htmlFor="mobile-minutes-per-player" style={{ fontWeight: 'bold', fontSize: '14px' }}>Minutes:</label>
                    <select 
                      id="mobile-minutes-per-player" 
                      className="control-select"
                      value={minutesPerPlayer}
                      onChange={(e) => setMinutesPerPlayer(parseInt(e.target.value))}
                      style={{ 
                        width: '100%', 
                        padding: '10px', 
                        fontSize: '14px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        backgroundColor: '#fff'
                      }}
                    >
                      <option value="60">60</option>
                      <option value="30">30</option>
                      <option value="15">15</option>
                      <option value="10">10</option>
                      <option value="5">5</option>
                      <option value="3">3</option>
                    </select>
                  </div>
                  <div className="option-cell" style={{ flex: 1, marginLeft: '10px' }}>
                    <label htmlFor="mobile-increment-seconds" style={{ fontWeight: 'bold', fontSize: '14px' }}>Increment:</label>
                    <select 
                      id="mobile-increment-seconds" 
                      className="control-select"
                      value={incrementSeconds}
                      onChange={(e) => setIncrementSeconds(parseInt(e.target.value))}
                      style={{ 
                        width: '100%', 
                        padding: '10px', 
                        fontSize: '14px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        backgroundColor: '#fff'
                      }}
                    >
                      <option value="10">10 sec</option>
                      <option value="5">5 sec</option>
                      <option value="2">2 sec</option>
                      <option value="0">0 sec</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="notification-buttons">
              <button className="btn" onClick={() => setShowMobileControls(false)} style={{ width: '100%', padding: '12px', fontSize: '16px' }}>
                Apply Settings
              </button>
            </div>
          </div>
        </>
      )}

      {/* Resign Confirmation Modal */}
      {showResignConfirmation && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setShowResignConfirmation(false)} />
          <div className="notification" style={{ display: 'block' }}>
            <h2>⚠️ Confirm Resignation</h2>
            <p style={{ whiteSpace: 'pre-line', lineHeight: '1.5', margin: '20px 0' }}>
              Are you sure you want to resign this game?
              {'\n\n'}Your opponent will be declared the winner.
            </p>
            <div className="notification-buttons">
              <button 
                className="btn" 
                onClick={confirmResignation}
                style={{ 
                  backgroundColor: '#dc3545', 
                  color: 'white',
                  fontWeight: 'bold'
                }}
              >
                🏳️ Yes, Resign
              </button>
              <button 
                className="btn" 
                onClick={cancelResignation}
                style={{ 
                  backgroundColor: '#28a745', 
                  color: 'white',
                  fontWeight: 'bold'
                }}
              >
                ⚔️ Continue Playing
              </button>
            </div>
          </div>
        </>
      )}

      {/* Desktop Resign/Draw Modal */}
      {showResignDrawModal && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setShowResignDrawModal(false)} />
          <div className="notification" style={{ display: 'block' }}>
            <h2>🎯 Choose Your Action</h2>
            <p style={{ whiteSpace: 'pre-line', lineHeight: '1.5', margin: '20px 0' }}>
              What would you like to do?
            </p>
            <div className="notification-buttons">
              <button 
                className="btn" 
                onClick={handleResignFromModal}
                style={{ 
                  backgroundColor: '#dc3545', 
                  color: 'white',
                  fontWeight: 'bold'
                }}
              >
                🏳️ Resign Game
              </button>
              {gameMode === 'online' && (
                <button 
                  className="btn" 
                  onClick={handleDrawFromModal}
                  style={{ 
                    backgroundColor: '#17a2b8', 
                    color: 'white',
                    fontWeight: 'bold'
                  }}
                >
                  🤝 Offer Draw
                </button>
              )}
              <button 
                className="btn" 
                onClick={cancelResignDrawModal}
                style={{ 
                  backgroundColor: '#28a745', 
                  color: 'white',
                  fontWeight: 'bold'
                }}
              >
                ⚔️ Continue Playing
              </button>
            </div>
          </div>
        </>
      )}

      {/* Draw Offer Modal */}
      {showDrawOffer && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setShowDrawOffer(false)} />
          <div className="notification" style={{ display: 'block' }}>
            <h2>🤝 Draw Offer</h2>
            <p style={{ whiteSpace: 'pre-line', lineHeight: '1.5', margin: '20px 0' }}>
              {pendingDrawFrom === 'white' ? 'White' : 'Black'} player has offered a draw.
              {'\n\n'}Do you accept?
            </p>
            <div className="notification-buttons">
              <button 
                className="btn" 
                onClick={() => respondToDrawOffer(true)}
                style={{ 
                  backgroundColor: '#28a745', 
                  color: 'white',
                  fontWeight: 'bold'
                }}
              >
                ✅ Accept Draw
              </button>
              <button 
                className="btn" 
                onClick={() => respondToDrawOffer(false)}
                style={{ 
                  backgroundColor: '#dc3545', 
                  color: 'white',
                  fontWeight: 'bold'
                }}
              >
                ❌ Decline Draw
              </button>
            </div>
          </div>
        </>
      )}

      {/* Stats Modal */}
      {showStats && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setShowStats(false)} />
          <div className="notification" style={{ display: 'block' }}>
            <h2>📊 Player Statistics</h2>
            {userStats && (
              <div style={{ padding: '20px 0' }}>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '1fr 1fr', 
                  gap: '20px',
                  marginBottom: '20px' 
                }}>
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '15px', 
                    backgroundColor: '#f8f9fa', 
                    borderRadius: '8px',
                    border: '2px solid #e9ecef'
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2c3e50' }}>
                      {userStats.gamesPlayed}
                    </div>
                    <div style={{ fontSize: '14px', color: '#6c757d' }}>Games Played</div>
                  </div>
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '15px', 
                    backgroundColor: '#f8f9fa', 
                    borderRadius: '8px',
                    border: '2px solid #e9ecef'
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>
                      {userStats.winRate}%
                    </div>
                    <div style={{ fontSize: '14px', color: '#6c757d' }}>Win Rate</div>
                  </div>
                </div>

                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '1fr 1fr 1fr', 
                  gap: '15px',
                  marginBottom: '20px' 
                }}>
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '12px', 
                    backgroundColor: '#e8f5e8', 
                    borderRadius: '6px',
                    border: '1px solid #c3e6cb'
                  }}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#155724' }}>
                      {userStats.wins}
                    </div>
                    <div style={{ fontSize: '12px', color: '#155724' }}>Wins</div>
                  </div>
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '12px', 
                    backgroundColor: '#f8d7da', 
                    borderRadius: '6px',
                    border: '1px solid #f1b0b7'
                  }}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#721c24' }}>
                      {userStats.losses}
                    </div>
                    <div style={{ fontSize: '12px', color: '#721c24' }}>Losses</div>
                  </div>
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '12px', 
                    backgroundColor: '#fff3cd', 
                    borderRadius: '6px',
                    border: '1px solid #ffeaa7'
                  }}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#856404' }}>
                      {userStats.draws}
                    </div>
                    <div style={{ fontSize: '12px', color: '#856404' }}>Draws</div>
                  </div>
                </div>

                {userStats.currentStreak > 0 && (
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '15px', 
                    backgroundColor: userStats.streakType === 'win' ? '#e8f5e8' : '#f8d7da', 
                    borderRadius: '8px',
                    border: `2px solid ${userStats.streakType === 'win' ? '#c3e6cb' : '#f1b0b7'}`,
                    marginBottom: '20px'
                  }}>
                    <div style={{ 
                      fontSize: '18px', 
                      fontWeight: 'bold', 
                      color: userStats.streakType === 'win' ? '#155724' : '#721c24'
                    }}>
                      🔥 Current Streak: {userStats.currentStreak} {userStats.streakType === 'win' ? 'Wins' : 'Losses'}
                    </div>
                  </div>
                )}

                {authState.user && (
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '10px', 
                    color: '#6c757d', 
                    fontSize: '14px',
                    borderTop: '1px solid #e9ecef',
                    marginTop: '15px',
                    paddingTop: '15px'
                  }}>
                    Stats for {authState.user.username}
                  </div>
                )}
              </div>
            )}
            <div className="notification-buttons">
              <button className="btn" onClick={() => setShowStats(false)}>Close</button>
            </div>
          </div>
        </>
      )}

      {/* PWA Installation Banner */}
      {showPWABanner && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#2c3e50',
          color: 'white',
          padding: '15px 20px',
          borderRadius: '10px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 1000,
          maxWidth: '90vw',
          width: '400px',
          textAlign: 'center',
          animation: 'slideIn 0.3s ease-out'
        }}>
          <div style={{ marginBottom: '10px', fontSize: '16px', fontWeight: 'bold' }}>
            🎮 Install Kuyoku Game
          </div>
          <div style={{ marginBottom: '15px', fontSize: '14px', opacity: 0.9 }}>
            Add to your home screen for fullscreen play with no browser bars!
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button 
              onClick={handleInstallPWA}
              style={{
                backgroundColor: '#3498db',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '5px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              📱 Install App
            </button>
            <button 
              onClick={dismissPWABanner}
              style={{
                backgroundColor: 'transparent',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.3)',
                padding: '8px 16px',
                borderRadius: '5px',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              Maybe Later
            </button>
          </div>
        </div>
      )}

      {/* Mobile Review Bar - Only visible on mobile when in review mode */}
      {isReviewMode && isMobileDevice && (
        <div id="mobile-review-bar">
          <div className="review-buttons">
            <button 
              className="btn" 
              onClick={firstMove}
              disabled={currentReviewMove <= 0}
              title="First Move"
            >
              ⏮
            </button>
            <button 
              className="btn" 
              onMouseDown={(e) => startHoldScroll('prev', e)}
              onMouseUp={(e) => stopHoldScroll(e)}
              onMouseLeave={(e) => stopHoldScroll(e)}
              onTouchStart={(e) => startHoldScroll('prev', e)}
              onTouchEnd={(e) => stopHoldScroll(e)}
              disabled={currentReviewMove <= 0}
              title="Previous Move"
            >
              ◀
            </button>
            <button 
              className="btn" 
              onMouseDown={(e) => startHoldScroll('next', e)}
              onMouseUp={(e) => stopHoldScroll(e)}
              onMouseLeave={(e) => stopHoldScroll(e)}
              onTouchStart={(e) => startHoldScroll('next', e)}
              onTouchEnd={(e) => stopHoldScroll(e)}
              disabled={currentReviewMove >= moveHistory.length}
              title="Next Move"
            >
              ▶
            </button>
            <button 
              className="btn" 
              onClick={lastMove}
              disabled={currentReviewMove >= moveHistory.length}
              title="Last Move"
            >
              ⏭
            </button>
            <button 
              className="btn" 
              onClick={exitReviewMode}
              title="Exit Review"
              style={{ backgroundColor: '#dc3545', color: 'white' }}
            >
              ✕
            </button>
          </div>
          <div className="move-counter">
            Move {currentReviewMove} of {moveHistory.length}
          </div>
        </div>
      )}

      {/* Mobile Button Container - Only visible on mobile */}
      <div id="mobile-button-container">
        <div id="mobile-action-bar">
          <button 
            className="btn" 
            onClick={isGameStarted && gameState.gameStatus === 'active' ? resignGame : startGame}
            style={{ 
              backgroundColor: !isGameStarted ? '#28a745' : undefined,
              color: !isGameStarted ? 'white' : undefined
            }}
          >
            {isGameStarted && gameState.gameStatus === 'active' ? 'Resign' : 'Start'}
          </button>
          <button 
            className="btn" 
            onClick={isGameStarted && gameState.gameStatus === 'active' ? 
              (gameMode === 'online' ? offerDraw : () => setShowMobileControls(true)) : 
              () => setShowMobileControls(true)}
          >
            {isGameStarted && gameState.gameStatus === 'active' ? 
              (gameMode === 'online' ? 'Offer Draw' : 'Opponent') : 
              'Opponent'}
          </button>
          <button 
            className="btn" 
            onClick={resetGame}
          >
            Reset
          </button>
        </div>

        <div id="mobile-utility-bar">
          <button 
            className="btn" 
            onClick={() => setShowRules(true)}
          >
            Rules
          </button>
          <button 
            className="btn" 
            onClick={() => setShowTutorial(true)}
          >
            Tutorial
          </button>
          <button 
            className="btn" 
            onClick={() => setShowSettings(true)}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="toast" style={{ display: 'block' }}>
          {toast}
        </div>
      )}
    </div>
  );
};

export default App;


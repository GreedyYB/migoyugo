import React, { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import './flux-styles.css';

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

// Simple AI logic
// AI Helper Functions
const evaluateMove = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black', difficulty: 'ai-1' | 'ai-2' | 'ai-3'): number => {
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

const getAIMove = (board: (Cell | null)[][], difficulty: 'ai-1' | 'ai-2' | 'ai-3'): {row: number, col: number} | null => {
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

// Sound function
const playSound = (soundName: 'ion' | 'vector' | 'nexus') => {
  try {
    const audio = new Audio(`/sounds/${soundName}.mp3`);
    audio.volume = 0.3; // Set to 30% volume
    audio.play().catch(e => console.log('Sound play failed:', e));
  } catch (e) {
    console.log('Sound loading failed:', e);
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
  // Final node position: [1, 3] (Column 9)
  
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
    players: { white: 'Player 1', black: 'Player 2' }
  });

  // UI state
  const [showTutorial, setShowTutorial] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [showMatchmaking, setShowMatchmaking] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSearchingMatch, setIsSearchingMatch] = useState(false);

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
  // const [boardHistory, setBoardHistory] = useState<(Cell | null)[][][]>([]);
  const [holdScrollInterval, setHoldScrollInterval] = useState<NodeJS.Timeout | null>(null);

  // Timer state
  const [timers, setTimers] = useState({ white: 600, black: 600 });
  const [activeTimer, setActiveTimer] = useState<'white' | 'black' | null>(null);

  // Game mode state
  const [gameMode, setGameMode] = useState<'local' | 'ai-1' | 'ai-2' | 'ai-3' | 'online'>('local');
  // const [waitingForAI, setWaitingForAI] = useState(false);

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
  const [originalGameState, setOriginalGameState] = useState<GameState | null>(null);

  // Tutorial animation ref (used in TutorialDemo component)
  // const animationRef = useRef<NodeJS.Timeout | null>(null);

  // Load saved settings from localStorage
  const loadSavedSettings = () => {
    try {
      const savedTheme = localStorage.getItem('fluxTheme') || 'classic';
      const savedSoundEnabled = localStorage.getItem('fluxSoundEnabled');
      const savedCustomColors = localStorage.getItem('fluxCustomColors');

      setCurrentTheme(savedTheme);
      
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

  // Apply custom colors to CSS variables
  const applyCustomColors = useCallback((colors: typeof customColors) => {
    const root = document.documentElement;
    root.style.setProperty('--white-ion', colors.whiteIon);
    root.style.setProperty('--black-ion', colors.blackIon);
    root.style.setProperty('--node-color', colors.nodeColor);
    root.style.setProperty('--board-color', colors.boardColor);
  }, []);

  // Apply theme to document
  const applyTheme = useCallback((theme: string) => {
    document.documentElement.setAttribute('data-theme', theme);
    
    // If it's a custom theme, apply custom colors
    if (theme === 'custom') {
      applyCustomColors(customColors);
    }
  }, [customColors, applyCustomColors]);

  // Load settings from localStorage on component mount
  useEffect(() => {
    loadSavedSettings();
  }, []);

  // Apply theme when currentTheme changes
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme, applyTheme]);

  // Handle theme change
  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    localStorage.setItem('fluxTheme', theme);
  };

  // Handle sound toggle
  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    localStorage.setItem('fluxSoundEnabled', JSON.stringify(enabled));
  };

  // Handle custom color change
  const handleCustomColorChange = (colorType: keyof typeof customColors, color: string) => {
    const newColors = { ...customColors, [colorType]: color };
    setCustomColors(newColors);
    localStorage.setItem('fluxCustomColors', JSON.stringify(newColors));
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
    
    localStorage.removeItem('fluxTheme');
    localStorage.removeItem('fluxSoundEnabled');
    localStorage.removeItem('fluxCustomColors');
    
    // Reset document theme
    document.documentElement.setAttribute('data-theme', 'classic');
  };

  const showToast = useCallback((message: string, duration: number = 4000) => {
    setToast(message);
    setTimeout(() => setToast(''), duration);
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
          
          // Initialize timers
          if (data.timerSettings.timerEnabled) {
            const timeInSeconds = data.timerSettings.minutesPerPlayer * 60;
            setTimers({
              white: timeInSeconds,
              black: timeInSeconds
            });
            setActiveTimer(data.gameState.currentPlayer);
          }
        }
        
        setIsGameStarted(true);
        setShowMatchmaking(false);
        setIsSearchingMatch(false);
        showToast(`Game start - you are playing as ${data.playerColor} (${data.timerSettings?.timerEnabled ? `${data.timerSettings.minutesPerPlayer}+${data.timerSettings.incrementSeconds}` : 'no timer'})`);
      });

      newSocket.on('waitingForOpponent', () => {
        setIsSearchingMatch(true);
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
          gameStatus: moveData.gameOver ? 'finished' : 'active'
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

        if (moveData.gameOver) {
          let message = '';
          if (moveData.winner === 'draw') {
            message = 'Game ended in a draw!';
          } else if (moveData.nexus) {
            message = `${moveData.winner} wins by Nexus!`;
          } else {
            message = `${moveData.winner} wins by node count!`;
          }
          setNotification({
            title: 'Game Over',
            message,
            show: true
          });
          setActiveTimer(null);
        }
      });

      newSocket.on('gameEnd', (data) => {
        setGameState(prev => ({ ...prev, gameStatus: 'finished' }));
        setNotification({
          title: 'Game Over',
          message: data.reason === 'resignation' ? 
            `${data.winner} wins by resignation!` : 
            `${data.winner} wins!`,
          show: true
        });
        setActiveTimer(null);
      });

      newSocket.on('opponentDisconnected', () => {
        setNotification({
          title: 'Opponent Disconnected',
          message: 'Your opponent has disconnected from the game.',
          show: true
        });
        setGameState(prev => ({ ...prev, gameStatus: 'finished' }));
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

      return () => {
        newSocket.close();
      };
    }
  }, [gameMode, authState.isGuest, authState.user, authState, showToast]);

  // Timer logic
  useEffect(() => {
    if (!timerEnabled || !isGameStarted || gameState.gameStatus !== 'active' || !activeTimer) {
      return;
    }

    const interval = setInterval(() => {
      setTimers(prev => {
        const newTimers = { ...prev };
        newTimers[activeTimer] -= 1;
        
        if (newTimers[activeTimer] <= 0) {
          // Time out
          const winner = activeTimer === 'white' ? 'black' : 'white';
          setNotification({
            title: 'Time Out',
            message: `${winner} wins on time!`,
            show: true
          });
          setGameState(prev => ({ ...prev, gameStatus: 'finished' }));
          setActiveTimer(null);
        }
        
        return newTimers;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerEnabled, isGameStarted, gameState.gameStatus, activeTimer]);



  // Start timer when game starts or player changes
  useEffect(() => {
    if (isGameStarted && gameState.gameStatus === 'active' && timerEnabled) {
      setActiveTimer(gameState.currentPlayer);
    }
  }, [isGameStarted, gameState.currentPlayer, gameState.gameStatus, timerEnabled]);

  // Authentication handlers
  const handleLogin = async (username: string, password: string) => {
    try {
      setAuthError('');
      const response = await fetch(`${getApiUrl()}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
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

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const makeLocalMove = useCallback((row: number, col: number) => {
    if (!isValidMove(gameState.board, row, col, gameState.currentPlayer)) return;
    
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
        gameStatus: 'finished'
      }));
      
      let message = '';
      if (winner === 'draw') {
        message = 'Game ended in a draw!';
      } else if (nexus) {
        message = `${winner} wins by Nexus!`;
      } else {
        message = `${winner} wins by node count!`;
      }
      setNotification({
        title: 'Game Over',
        message,
        show: true
      });
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
        gameStatus: 'active'
      }));
    }
  }, [gameState.board, gameState.currentPlayer, setMoveHistory, setGameState, setNotification, setActiveTimer]);

  // AI move logic with human-like thinking time
  useEffect(() => {
    if (isGameStarted && 
        gameState.gameStatus === 'active' && 
        (gameMode === 'ai-1' || gameMode === 'ai-2' || gameMode === 'ai-3') && 
        gameState.currentPlayer === 'black') {
      
      // Variable thinking time based on AI level (makes AI feel more human)
      let minThinkTime, maxThinkTime;
      if (gameMode === 'ai-1') {
        minThinkTime = 1000; // 1 second minimum
        maxThinkTime = 2000; // 2 seconds maximum
      } else if (gameMode === 'ai-2') {
        minThinkTime = 1500; // 1.5 seconds minimum  
        maxThinkTime = 2500; // 2.5 seconds maximum
      } else {
        // ai-3: Fast tactical play with reasonable thinking time
        minThinkTime = 1500; // 1.5 seconds minimum
        maxThinkTime = 2500; // 2.5 seconds maximum
      }
      
      const thinkTime = Math.floor(Math.random() * (maxThinkTime - minThinkTime + 1)) + minThinkTime;
      console.log(`${gameMode.toUpperCase()} thinking for ${thinkTime}ms...`);
      
      const timeout = setTimeout(() => {
        const aiMove = getAIMove(gameState.board, gameMode as 'ai-1' | 'ai-2' | 'ai-3');
        if (aiMove) {
          console.log(`${gameMode.toUpperCase()} selected move:`, aiMove);
          // Use the same makeLocalMove function that human players use
          makeLocalMove(aiMove.row, aiMove.col);
        }
      }, thinkTime);
      
      return () => clearTimeout(timeout);
    }
  }, [gameState.currentPlayer, gameState.gameStatus, isGameStarted, gameMode, gameState.board, makeLocalMove]);

  const handleCellClick = (row: number, col: number) => {
    if (!isGameStarted || gameState.gameStatus !== 'active' || isReviewMode) return;
    
    if (gameMode === 'online') {
      if (!playerColor || gameState.currentPlayer !== playerColor) return;
      if (gameState.board[row][col] !== null) return;
      
      socket?.emit('makeMove', { gameId, row, col });
    } else {
      // Local game (human vs human or vs AI)
      if (gameMode === 'ai-1' || gameMode === 'ai-2' || gameMode === 'ai-3') {
        // In AI mode, only allow human (white) moves
        if (gameState.currentPlayer !== 'white') return;
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
      const newBoard = Array(8).fill(null).map(() => Array(8).fill(null));
      setGameState({
        board: newBoard,
        currentPlayer: 'white',
        scores: { white: 0, black: 0 },
        gameStatus: 'active',
        lastMove: null,
        players: { 
          white: 'White', 
          black: gameMode === 'local' ? 'Black' : `CORE ${gameMode.toUpperCase()}`
        }
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
    
    if (!accept) {
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

  const resetGame = () => {
    setGameState({
      board: INITIAL_BOARD,
      currentPlayer: 'white',
      scores: { white: 0, black: 0 },
      gameStatus: 'waiting',
      lastMove: null,
      players: { white: 'White', black: 'Black' }
    });
    setIsGameStarted(false);
    setMoveHistory([]);
    setActiveTimer(null);
    setPlayerColor(null);
    setOpponentName('');
    setGameId('');
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
      message: "Flux is played on an 8×8 board.<br>Players alternate turns,<br>white moves first, then black,<br>placing ions on empty cells.",
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
      title: "Ready to Play!",
      message: "You have two options - play against a human opponent or try your luck against our resident AI <b>CORE</b> (Cognitive, Operational Reasoning Engine).<br><br>You can play with a timer or without.<br>Choose from a 3-minute game or up to an hour on the clock.<br>You can even choose increments from 2 to 10 seconds which add time to your clock after every move.<br>Once you run out of time, it's game over.<br><br>Is it better to build your own Vectors or block your opponent?<br>Will you go for a Nexus or fill the board and see who ends up with the most Nodes?<br>The options are endless.<br><br>That's all you need to know!<br>Click 'Start' and enjoy playing Flux!",
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
    setCurrentReviewMove(0);
    
    // Reset to initial board state
    const initialBoard = Array(8).fill(null).map(() => Array(8).fill(null));
    setGameState(prev => ({
      ...prev,
      board: initialBoard,
      currentPlayer: 'white',
      scores: { white: 0, black: 0 },
      lastMove: null
    }));
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
    
    setGameState(prev => ({
      ...prev,
      board,
      currentPlayer,
      scores,
      lastMove
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
    
    return (
      <div
        key={`${row}-${col}`}
        className={`cell ${isLastMove ? 'last-move' : ''}`}
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

  return (
    <div className="App">
      <header>
        <h1>Flux</h1>
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
          <div className="player-bar-row" style={{ display: 'flex', alignItems: 'center' }}>
            <div className="player-info" style={{ marginRight: '10px', width: 'calc(var(--board-size) + 4px)', boxSizing: 'border-box' }}>
              <div className={`player ${gameState.currentPlayer === 'white' ? 'active' : ''}`} id="player-white">
                <div className="player-color white"></div>
                <span>
                  {(() => {
                    if (!isGameStarted) {
                      return 'White';
                    } else if (gameMode === 'online' && playerColor) {
                      // Multiplayer game - show actual usernames with color
                      const whiteName = playerColor === 'white' ? 
                        (authState.user?.username || 'Guest') : 
                        opponentName;
                      return `${whiteName} (white)`;
                    } else if ((gameMode === 'ai-1' || gameMode === 'ai-2') && authState.isAuthenticated) {
                      // AI game with authenticated user - show username for white (human player)
                      return `${authState.user?.username} (white)`;
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
                    // Multiplayer game - show actual usernames with color
                    const blackName = playerColor === 'black' ? 
                      (authState.user?.username || 'Guest') : 
                      opponentName;
                    return `${blackName} (black)`;
                  } else if ((gameMode === 'ai-1' || gameMode === 'ai-2') && authState.isAuthenticated) {
                    // AI game - black is always the AI, show AI name with color
                    return `${gameState.players.black} (black)`;
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
          <div className="player-buttons" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '256px', marginBottom: '5px' }}>
            <button 
              className="btn action-btn" 
              onClick={isGameStarted && gameState.gameStatus === 'active' ? resignGame : startGame}
              style={{ height: '40px', padding: '0 24px' }}
            >
              {isGameStarted && gameState.gameStatus === 'active' ? 'Resign' : 'Start'}
            </button>
            <button 
              className="btn action-btn" 
              onClick={resetGame}
              style={{ height: '40px', padding: '0 24px' }}
            >
              Reset
            </button>
          </div>

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
              <div className="review-button-container" style={{ width: '236px', margin: '20px auto 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
          <div className="utility-buttons-container" style={{ width: '256px', display: 'flex', alignItems: 'center', height: '40px', marginTop: '5px', marginLeft: '-4px' }}>
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
            <h2>Flux Game Rules</h2>
            
            <h3>Overview</h3>
            <p>Flux is a strategic board game played on an 8x8 grid between two players: White and Black. It involves placing pieces (called "Ions") and forming special patterns to create "Nodes" and ultimately a "Nexus" to win.</p>
            
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

      {/* Mobile Pregame Modal */}
      {!isGameStarted && !showLogin && !showSignup && !showMatchmaking && (
        <>
          <div className="overlay" style={{ display: 'block' }} />
          <div id="pregame-modal" className="notification">
            <h2>Game Setup</h2>
            <div id="pregame-controls-mobile">
              <div className="option-row">
                <label htmlFor="mobile-game-mode-select">Opponent:</label>
                <select 
                  id="mobile-game-mode-select" 
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

              <div className="option-row">
                <label htmlFor="mobile-timer-toggle">Game Timer:</label>
                <div className="toggle-container">
                  <span className="toggle-label">Off</span>
                  <label className="toggle small">
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

              {timerEnabled && (
                <div className="timer-settings">
                  <div className="timer-row">
                    <div className="option-cell">
                      <label>Minutes:</label>
                      <select 
                        className="control-select"
                        value={minutesPerPlayer}
                        onChange={(e) => setMinutesPerPlayer(Number(e.target.value))}
                      >
                        <option value={1}>1</option>
                        <option value={3}>3</option>
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={15}>15</option>
                        <option value={30}>30</option>
                      </select>
                    </div>
                    <div className="option-cell">
                      <label>Increment:</label>
                      <select 
                        className="control-select"
                        value={incrementSeconds}
                        onChange={(e) => setIncrementSeconds(Number(e.target.value))}
                      >
                        <option value={0}>0s</option>
                        <option value={3}>3s</option>
                        <option value={5}>5s</option>
                        <option value={10}>10s</option>
                        <option value={15}>15s</option>
                        <option value={30}>30s</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <button id="pregame-start-btn" className="btn" onClick={startGame}>
                Start Game
              </button>
            </div>
          </div>
        </>
      )}

      {/* Settings popup */}
      {showSettings && (
        <>
          <div className="overlay" style={{ display: 'block' }} onClick={() => setShowSettings(false)} />
          <div className="notification settings-dialog" style={{ display: 'block', maxWidth: '500px' }}>
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
                  <option value="ocean">Ocean</option>
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
          <div className="notification" style={{ display: 'block', maxWidth: '400px', zIndex: 2100 }}>
            <h2>Log In</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target as HTMLFormElement);
              handleLogin(
                formData.get('username') as string,
                formData.get('password') as string
              );
            }}>
              <div style={{ marginBottom: '15px' }}>
                <label htmlFor="login-username" style={{ display: 'block', marginBottom: '5px' }}>Username:</label>
                <input
                  type="text"
                  id="login-username"
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
          <div className="notification" style={{ display: 'block', maxWidth: '400px', zIndex: 2100 }}>
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

      {/* Matchmaking modal */}
      {showMatchmaking && (
        <>
          <div className="overlay" style={{ display: 'block' }} />
          <div className="notification" style={{ display: 'block', position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 2000 }}>
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
            
            <p>{isSearchingMatch ? 'Searching for a match...' : 'Ready to find an opponent?'}</p>
            <div className="notification-buttons">
              {!isSearchingMatch ? (
                <>
                  <button className="btn" onClick={findMatch}>Find Match</button>
                  <button className="btn" onClick={() => setShowMatchmaking(false)}>Cancel</button>
                </>
              ) : (
                <button className="btn" onClick={cancelMatchmaking}>Cancel Search</button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Game notification */}
      {notification.show && (
        <>
          <div className="overlay" style={{ display: 'block' }} />
          <div className="notification" style={{ display: 'block' }}>
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
            ) : notification.title === 'Game Over' && gameMode === 'online' && gameState.gameStatus === 'finished' ? (
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

      {/* Resign Confirmation Modal */}
      {showResignConfirmation && (
        <>
          <div className="overlay" style={{ display: 'block' }} />
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


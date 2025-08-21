// Helper functions
import React from 'react';
import { Cell } from './gameLogic';
import { 
  isValidMove, 
  checkForVectors, 
  processVectors, 
  checkForNexus 
} from './gameLogic';

const copyBoard = (board: (Cell | null)[][]) => board.map(r => [...r]);

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

// Helper function to check if a cell is "empty" (no node present, even if ion exists)
const isEmptyCell = (board: (Cell | null)[][], row: number, col: number): boolean => {
  return !board[row][col] || !board[row][col]?.isNode;
};

// 1. THREE NODE THREAT: Detect if opponent has 3 connected nodes with 1 empty gap
const detectThreeNodeThreat = (board: (Cell | null)[][], opponentColor: 'white' | 'black'): {row: number, col: number}[] => {
  const threats: {row: number, col: number}[] = [];
  const directions = [[-1, 0], [0, 1], [1, 1], [1, 0]]; // All 4 main directions
  
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      for (const [dr, dc] of directions) {
        // Check for pattern: Node-Node-Empty-Node or Node-Empty-Node-Node or Empty-Node-Node-Node
        const positions = [];
        for (let i = 0; i < 4; i++) {
          const r = row + i * dr;
          const c = col + i * dc;
          if (r >= 0 && r < 8 && c >= 0 && c < 8) {
            positions.push({row: r, col: c, cell: board[r][c]});
          }
        }
        
        if (positions.length === 4) {
          const nodes = positions.filter(p => p.cell?.color === opponentColor && p.cell?.isNode);
          const empties = positions.filter(p => isEmptyCell(board, p.row, p.col));
          
          // Check if we have exactly 3 nodes and 1 empty in the line
          if (nodes.length === 3 && empties.length === 1) {
            threats.push({row: empties[0].row, col: empties[0].col});
          }
        }
      }
    }
  }
  
  return threats;
};

// 2. NEXUS FORK: Detect if opponent can create double threat by placing node in center
const detectNexusFork = (board: (Cell | null)[][], opponentColor: 'white' | 'black'): {row: number, col: number}[] => {
  const forkThreats: {row: number, col: number}[] = [];
  const directions = [[-1, 0], [0, 1], [1, 1], [1, 0]];
  
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (!isEmptyCell(board, row, col)) continue;
      
      for (const [dr, dc] of directions) {
        // Check for pattern: Node-Empty-Node-Empty-[THIS CELL]-Empty-Node
        // This would create two threats if opponent places node here
        
        let nodesOnLeft = 0;
        let nodesOnRight = 0;
        
        // Check left side (2 positions)
        for (let i = 1; i <= 2; i++) {
          const r = row - i * dr;
          const c = col - i * dc;
          if (r >= 0 && r < 8 && c >= 0 && c < 8) {
            const cell = board[r][c];
            if (cell?.color === opponentColor && cell?.isNode) {
              nodesOnLeft++;
            }
          }
        }
        
        // Check right side (2 positions)
        for (let i = 1; i <= 2; i++) {
          const r = row + i * dr;
          const c = col + i * dc;
          if (r >= 0 && r < 8 && c >= 0 && c < 8) {
            const cell = board[r][c];
            if (cell?.color === opponentColor && cell?.isNode) {
              nodesOnRight++;
            }
          }
        }
        
        // If placing a node here would connect with nodes on both sides
        // and create 3+ connected nodes, it's a fork threat
        if (nodesOnLeft >= 1 && nodesOnRight >= 1 && (nodesOnLeft + nodesOnRight >= 2)) {
          forkThreats.push({row, col});
        }
      }
    }
  }
  
  return forkThreats;
};

// 2b. VECTOR-TO-FORK THREAT: Detect if opponent can create fork by first forming vector
const detectVectorToForkThreat = (board: (Cell | null)[][], opponentColor: 'white' | 'black'): {row: number, col: number}[] => {
  const vectorToForkThreats: {row: number, col: number}[] = [];
  const directions = [[-1, 0], [0, 1], [1, 1], [1, 0]];
  
  // For each empty cell, check if opponent placing there creates a vector that leads to fork
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (!isEmptyCell(board, row, col)) continue;
      
      // Simulate opponent placing a piece here
      const testBoard = copyBoard(board);
      testBoard[row][col] = { color: opponentColor, isNode: false };
      
      // Check if this creates any vectors
      const vectors = checkForVectors(testBoard, row, col, opponentColor);
      
      if (vectors.length > 0) {
        // Simulate the vector formation (piece becomes node, others removed)
        const postVectorBoard = copyBoard(testBoard);
        
        // Process each vector
        for (const vector of vectors) {
          // The placed piece becomes a node
          postVectorBoard[row][col] = { color: opponentColor, isNode: true, nodeType: 'standard' };
          
          // Remove other pieces in the vector (except the new node)
          for (const pos of vector) {
            if (pos.row !== row || pos.col !== col) {
              postVectorBoard[pos.row][pos.col] = null;
            }
          }
        }
        
        // Now check if this results in a nexus fork situation
        // Look for 2+ connected nodes with empty cells on both ends
        for (const [dr, dc] of directions) {
          const line = [];
          
          // Build line in this direction starting from the new node
          for (let i = -3; i <= 3; i++) {
            const r = row + i * dr;
            const c = col + i * dc;
            if (r >= 0 && r < 8 && c >= 0 && c < 8) {
              line.push({
                row: r, 
                col: c, 
                cell: postVectorBoard[r][c],
                isEmpty: isEmptyCell(postVectorBoard, r, c)
              });
            }
          }
          
          // Look for patterns like: Empty-Node-Node-Empty or Empty-Node-Node-Node-Empty
          for (let start = 0; start < line.length - 3; start++) {
            const segment = line.slice(start, start + 4);
            const nodes = segment.filter(p => p.cell?.color === opponentColor && p.cell?.isNode);
            const empties = segment.filter(p => p.isEmpty);
            
            // If we have 2+ nodes with empties on both ends, it's a fork threat
            if (nodes.length >= 2 && segment[0].isEmpty && segment[segment.length - 1].isEmpty) {
              vectorToForkThreats.push({row, col});
              break;
            }
          }
        }
      }
    }
  }
  
  return vectorToForkThreats;
};

// 3. VECTOR TRAP: Check if forming vector removes defending ions
const detectVectorTrap = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black'): boolean => {
  const opponentColor = playerColor === 'white' ? 'black' : 'white';
  
  // Simulate placing the piece and forming vectors
  const testBoard = copyBoard(board);
  testBoard[row][col] = { color: playerColor, isNode: false };
  
  const vectors = checkForVectors(testBoard, row, col, playerColor);
  
  if (vectors.length === 0) return false; // No vector formed, no trap
  
  // For each vector, check what ions would be removed
  for (const vector of vectors) {
    for (const pos of vector) {
      if (pos.row === row && pos.col === col) continue; // Skip the new piece
      
      // This ion would be removed - check if it was defending anything critical
      const ionRow = pos.row;
      const ionCol = pos.col;
      
      // Temporarily remove this ion and check for new threats
      const boardWithoutIon = copyBoard(testBoard);
      boardWithoutIon[ionRow][ionCol] = null;
      
      // Check if removing this ion exposes us to Three Node Threat
      const threeNodeThreats = detectThreeNodeThreat(boardWithoutIon, opponentColor);
      if (threeNodeThreats.some(threat => threat.row === ionRow && threat.col === ionCol)) {
        return true; // This is a trap!
      }
      
      // Check if removing this ion exposes us to Nexus Fork
      const nexusForksExposed = detectNexusFork(boardWithoutIon, opponentColor);
      if (nexusForksExposed.some(fork => fork.row === ionRow && fork.col === ionCol)) {
        return true; // This is a trap!
      }
    }
  }
  
  return false;
};

// Simple AI logic
// AI Helper Functions
const evaluateMove = (board: (Cell | null)[][], row: number, col: number, playerColor: 'white' | 'black', difficulty: 'ai-1' | 'ai-2' | 'ai-3'): number => {
  // Original evaluation for AI-1, AI-2, AI-3
  let score = 0;
  const opponentColor = playerColor === 'white' ? 'black' : 'white';
  
  // Create a copy of the board with the move played
  const testBoard = copyBoard(board);
  
  // ABSOLUTE PRIORITY 0: Immediate Nexus Win (check if this move wins the game)
  testBoard[row][col] = { color: playerColor, isNode: true, nodeType: 'standard' };
  const immediateNexus = checkForNexus(testBoard, row, col, playerColor);
  if (immediateNexus) {
    score += 100000; // MASSIVE BONUS - ALWAYS TAKE WINNING MOVES!
  }
  
  // Reset the test board for other checks
  testBoard[row][col] = { color: playerColor, isNode: false };
  
  // PRIORITY 1: Vector Formation (immediate win condition)
  const vectors = checkForVectors(testBoard, row, col, playerColor);
  if (vectors.length > 0) {
    score += 1000 * vectors.length; // Massive bonus for forming vectors
  }
  
  // ENHANCED PRIORITY 2: Advanced Threat Detection for AI-3
  if (difficulty === 'ai-3') {
    // Check for Three Node Threats (MUST BLOCK)
    const threeNodeThreats = detectThreeNodeThreat(board, opponentColor);
    if (threeNodeThreats.some(threat => threat.row === row && threat.col === col)) {
      score += 15000; // CRITICAL: Must block three node threat immediately
    }
    
    // Check for Nexus Forks (MUST BLOCK)
    const nexusForks = detectNexusFork(board, opponentColor);
    if (nexusForks.some(fork => fork.row === row && fork.col === col)) {
      score += 12000; // CRITICAL: Must block nexus fork
    }
    
    // Check for Vector-to-Fork Threats (MUST BLOCK) - NEW!
    const vectorToForkThreats = detectVectorToForkThreat(board, opponentColor);
    if (vectorToForkThreats.some(threat => threat.row === row && threat.col === col)) {
      score += 13000; // CRITICAL: Must block vector-to-fork setup
    }
    
    // Check for Vector Trap (MUST AVOID)
    if (detectVectorTrap(board, row, col, playerColor)) {
      score -= 20000; // CRITICAL: Avoid vector traps at all costs
    }
  }
  
  // PRIORITY 2: Block Opponent Threats (prevent opponent from winning)
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isValidMove(board, r, c, opponentColor)) {
        const opponentTestBoard = copyBoard(board);
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

// Export all helper functions
export {
  copyBoard,
  getAllValidMoves,
  makeMove,
  createsDoubleEndedNodeThreat,
  isEmptyCell,
  detectThreeNodeThreat,
  detectNexusFork,
  detectVectorToForkThreat,
  detectVectorTrap,
  evaluateMove
};
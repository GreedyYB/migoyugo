// Ensure the use of this part of algorithm

// --- MCTS for AI-3 ---
import React from 'react';
import { Cell } from './gameLogic';
import { countNodes, checkForNexus } from './gameLogic';
import { 
  getAllValidMoves, 
  makeMove, 
  evaluateMove 
} from './helperFunctions';

function mcts(
    board: (Cell | null)[][],
    playerColor: 'white' | 'black',
    iterations: number = 200,
    rolloutDepth: number = 8
  ): { row: number; col: number } | null {
    const validMoves = getAllValidMoves(board, playerColor);
    if (validMoves.length === 0) return null;
    const moveStats = validMoves.map(move => ({
      move,
      wins: 0,
      playouts: 0
    }));
  
    for (let i = 0; i < iterations; i++) {
      const moveIdx = Math.floor(Math.random() * validMoves.length);
      const { row, col } = validMoves[moveIdx];
      let simBoard = makeMove(board, row, col, playerColor);
      let simPlayer: 'white' | 'black' = playerColor === 'white' ? 'black' : 'white';
      let winner: 'white' | 'black' | 'draw' | null = null;
      let depth = 0;
      let lastMove = { row, col, player: playerColor };
      while (depth < rolloutDepth) {
        const moves = getAllValidMoves(simBoard, simPlayer);
        if (moves.length === 0) {
          // Node count tiebreak
          const whiteNodes = countNodes(simBoard, 'white');
          const blackNodes = countNodes(simBoard, 'black');
          if (whiteNodes > blackNodes) winner = 'white';
          else if (blackNodes > whiteNodes) winner = 'black';
          else winner = 'draw';
          break;
        }
        // Pick best move by evaluateMove (greedy rollout)
        let bestScore = -Infinity;
        let best = moves[0];
        for (const m of moves) {
          const score = evaluateMove(simBoard, m.row, m.col, simPlayer, 'ai-3');
          if (score > bestScore) {
            bestScore = score;
            best = m;
          }
        }
        simBoard = makeMove(simBoard, best.row, best.col, simPlayer);
        lastMove = { row: best.row, col: best.col, player: simPlayer };
        // Check for nexus win
        if (checkForNexus(simBoard, best.row, best.col, simPlayer)) {
          winner = simPlayer;
          break;
        }
        simPlayer = simPlayer === 'white' ? 'black' : 'white';
        depth++;
      }
      // Score for black (AI)
      if (winner === 'black') moveStats[moveIdx].wins++;
      moveStats[moveIdx].playouts++;
    }
    // Pick move with highest win rate
    moveStats.sort((a, b) => (b.wins / b.playouts) - (a.wins / a.playouts));
    return moveStats[0].move;
  }

// Export the MCTS function
export { mcts };
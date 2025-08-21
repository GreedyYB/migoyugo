// Local game logic functions

// These are the basic game functions which are being used in the App.tsx to check for valid moves
// and to check for the nexus line along with the vectors.

// Types
interface Cell {
  color: 'white' | 'black' | null;
  isNode: boolean;
  nodeType?: 'standard' | 'double' | 'triple' | 'quadruple';
}

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
    
          // Remove dots from vectors (except nodes and the new placement)
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

// Export all game logic functions
export {
  isValidMove,
  wouldCreateLineTooLong,
  checkForVectors,
  processVectors,
  checkForNexus,
  hasLegalMoves,
  countNodes
};

// Export the Cell type as well
export type { Cell };
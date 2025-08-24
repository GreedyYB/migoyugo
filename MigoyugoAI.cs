using System;
using System.Collections.Generic;
using System.Linq;

namespace MigoyugoAI
{
    public class MigoyugoAI
    {
        // Board representation: 0=empty, 1=white migo, 2=black migo, 3=white yugo, 4=black yugo
        private int[,] board;
        private const int BOARD_SIZE = 8;
        private const int EMPTY = 0;
        private const int WHITE_MIGO = 1;
        private const int BLACK_MIGO = 2;
        private const int WHITE_YUGO = 3;
        private const int BLACK_YUGO = 4;
        
        // Performance optimization: pre-calculated line directions
        private static readonly (int, int)[] DIRECTIONS = {
            (1, 0), (0, 1), (1, 1), (1, -1)  // horizontal, vertical, diagonal down-right, diagonal up-right
        };
        
        // Evaluation weights
        private const int IGO_WIN_SCORE = 10000;
        private const int YUGO_SCORE = 100;
        private const int BOARD_CONTROL_SCORE = 10;
        private const int BLOCKING_SCORE = 50;
        
        // Search configuration
        private const int DEFAULT_SEARCH_DEPTH = 4;
        private int currentSearchDepth;
        
        public MigoyugoAI()
        {
            board = new int[BOARD_SIZE, BOARD_SIZE];
            currentSearchDepth = DEFAULT_SEARCH_DEPTH;
        }
        
        public void SetSearchDepth(int depth)
        {
            currentSearchDepth = depth;
        }
        
        // Main AI move calculation
        public (int row, int col) GetBestMove(bool isWhiteTurn)
        {
            // Check for immediate win
            var winMove = FindWinningMove(isWhiteTurn);
            if (winMove.HasValue)
                return winMove.Value;
                
            // Check for immediate block
            var blockMove = FindBlockingMove(isWhiteTurn);
            if (blockMove.HasValue)
                return blockMove.Value;
                
            // Use minimax with alpha-beta pruning
            return GetMinimaxMove(isWhiteTurn);
        }
        
        // Find immediate winning move
        private (int row, int col)? FindWinningMove(bool isWhiteTurn)
        {
            int playerPiece = isWhiteTurn ? WHITE_MIGO : BLACK_MIGO;
            int playerYugo = isWhiteTurn ? WHITE_YUGO : BLACK_YUGO;
            
            for (int row = 0; row < BOARD_SIZE; row++)
            {
                for (int col = 0; col < BOARD_SIZE; col++)
                {
                    if (board[row, col] == EMPTY && IsValidMove(row, col, isWhiteTurn))
                    {
                        // Temporarily place piece
                        board[row, col] = playerPiece;
                        
                        // Check if this creates a Yugo line
                        if (CheckForYugoCreation(row, col, isWhiteTurn))
                        {
                            // Check if this creates an Igo (4 Yugos in line)
                            if (CheckForIgo(isWhiteTurn))
                            {
                                board[row, col] = EMPTY; // Restore board
                                return (row, col);
                            }
                        }
                        
                        board[row, col] = EMPTY; // Restore board
                    }
                }
            }
            return null;
        }
        
        // Find immediate blocking move
        private (int row, int col)? FindBlockingMove(bool isWhiteTurn)
        {
            bool opponentIsWhite = !isWhiteTurn;
            return FindWinningMove(opponentIsWhite);
        }
        
        // Minimax with alpha-beta pruning
        private (int row, int col) GetMinimaxMove(bool isWhiteTurn)
        {
            var validMoves = GetValidMoves(isWhiteTurn);
            if (!validMoves.Any())
                return (-1, -1); // No valid moves
                
            int bestScore = isWhiteTurn ? int.MinValue : int.MaxValue;
            (int row, int col) bestMove = validMoves[0];
            
            foreach (var move in validMoves)
            {
                // Make move
                int originalValue = board[move.row, move.col];
                board[move.row, move.col] = isWhiteTurn ? WHITE_MIGO : BLACK_MIGO;
                
                // Check for Yugo creation
                bool yugoCreated = CheckForYugoCreation(move.row, move.col, isWhiteTurn);
                
                // Evaluate position
                int score = Minimax(currentSearchDepth - 1, !isWhiteTurn, int.MinValue, int.MaxValue);
                
                // Undo move
                board[move.row, move.col] = originalValue;
                if (yugoCreated)
                {
                    // Would need to restore Yugos here in full implementation
                }
                
                // Update best move
                if (isWhiteTurn && score > bestScore)
                {
                    bestScore = score;
                    bestMove = move;
                }
                else if (!isWhiteTurn && score < bestScore)
                {
                    bestScore = score;
                    bestMove = move;
                }
            }
            
            return bestMove;
        }
        
        // Minimax algorithm with alpha-beta pruning
        private int Minimax(int depth, bool isWhiteTurn, int alpha, int beta)
        {
            // Terminal conditions
            if (CheckForIgo(isWhiteTurn))
                return isWhiteTurn ? IGO_WIN_SCORE : -IGO_WIN_SCORE;
                
            if (depth == 0)
                return EvaluatePosition();
                
            var validMoves = GetValidMoves(isWhiteTurn);
            if (!validMoves.Any())
                return EvaluatePosition(); // No moves available
                
            if (isWhiteTurn)
            {
                int maxScore = int.MinValue;
                foreach (var move in validMoves)
                {
                    // Make move
                    int originalValue = board[move.row, move.col];
                    board[move.row, move.col] = WHITE_MIGO;
                    bool yugoCreated = CheckForYugoCreation(move.row, move.col, isWhiteTurn);
                    
                    int score = Minimax(depth - 1, false, alpha, beta);
                    
                    // Undo move
                    board[move.row, move.col] = originalValue;
                    
                    maxScore = Math.Max(maxScore, score);
                    alpha = Math.Max(alpha, score);
                    if (beta <= alpha)
                        break; // Beta cutoff
                }
                return maxScore;
            }
            else
            {
                int minScore = int.MaxValue;
                foreach (var move in validMoves)
                {
                    // Make move
                    int originalValue = board[move.row, move.col];
                    board[move.row, move.col] = BLACK_MIGO;
                    bool yugoCreated = CheckForYugoCreation(move.row, move.col, isWhiteTurn);
                    
                    int score = Minimax(depth - 1, true, alpha, beta);
                    
                    // Undo move
                    board[move.row, move.col] = originalValue;
                    
                    minScore = Math.Min(minScore, score);
                    beta = Math.Min(beta, score);
                    if (beta <= alpha)
                        break; // Alpha cutoff
                }
                return minScore;
            }
        }
        
        // Get all valid moves for current player
        private List<(int row, int col)> GetValidMoves(bool isWhiteTurn)
        {
            var moves = new List<(int row, int col)>();
            for (int row = 0; row < BOARD_SIZE; row++)
            {
                for (int col = 0; col < BOARD_SIZE; col++)
                {
                    if (board[row, col] == EMPTY && IsValidMove(row, col, isWhiteTurn))
                    {
                        moves.Add((row, col));
                    }
                }
            }
            return moves;
        }
        
        // Check if move is valid (doesn't create lines longer than 4)
        private bool IsValidMove(int row, int col, bool isWhiteTurn)
        {
            int playerPiece = isWhiteTurn ? WHITE_MIGO : BLACK_MIGO;
            int playerYugo = isWhiteTurn ? WHITE_YUGO : BLACK_YUGO;
            
            // Temporarily place piece
            board[row, col] = playerPiece;
            
            // Check all directions for lines longer than 4
            foreach (var (dr, dc) in DIRECTIONS)
            {
                int count = 1; // Count the piece we just placed
                
                // Count in positive direction
                for (int i = 1; i < 5; i++)
                {
                    int r = row + i * dr;
                    int c = col + i * dc;
                    if (!IsInBounds(r, c) || (board[r, c] != playerPiece && board[r, c] != playerYugo))
                        break;
                    count++;
                }
                
                // Count in negative direction
                for (int i = 1; i < 5; i++)
                {
                    int r = row - i * dr;
                    int c = col - i * dc;
                    if (!IsInBounds(r, c) || (board[r, c] != playerPiece && board[r, c] != playerYugo))
                        break;
                    count++;
                }
                
                if (count > 4)
                {
                    board[row, col] = EMPTY; // Restore board
                    return false;
                }
            }
            
            board[row, col] = EMPTY; // Restore board
            return true;
        }
        
        // Check if placing a piece creates a Yugo
        private bool CheckForYugoCreation(int row, int col, bool isWhiteTurn)
        {
            int playerPiece = isWhiteTurn ? WHITE_MIGO : BLACK_MIGO;
            int playerYugo = isWhiteTurn ? WHITE_YUGO : BLACK_YUGO;
            
            foreach (var (dr, dc) in DIRECTIONS)
            {
                int count = 1;
                var pieces = new List<(int r, int c)> { (row, col) };
                
                // Count in positive direction
                for (int i = 1; i < 4; i++)
                {
                    int r = row + i * dr;
                    int c = col + i * dc;
                    if (!IsInBounds(r, c) || (board[r, c] != playerPiece && board[r, c] != playerYugo))
                        break;
                    pieces.Add((r, c));
                    count++;
                }
                
                // Count in negative direction
                for (int i = 1; i < 4; i++)
                {
                    int r = row - i * dr;
                    int c = col - i * dc;
                    if (!IsInBounds(r, c) || (board[r, c] != playerPiece && board[r, c] != playerYugo))
                        break;
                    pieces.Add((r, c));
                    count++;
                }
                
                if (count == 4)
                {
                    // Create Yugo and remove other pieces
                    foreach (var (r, c) in pieces)
                    {
                        if (r == row && c == col)
                            board[r, c] = playerYugo;
                        else
                            board[r, c] = EMPTY;
                    }
                    return true;
                }
            }
            return false;
        }
        
        // Check for Igo (4 Yugos in a line)
        private bool CheckForIgo(bool isWhiteTurn)
        {
            int playerYugo = isWhiteTurn ? WHITE_YUGO : BLACK_YUGO;
            
            foreach (var (dr, dc) in DIRECTIONS)
            {
                for (int startRow = 0; startRow < BOARD_SIZE; startRow++)
                {
                    for (int startCol = 0; startCol < BOARD_SIZE; startCol++)
                    {
                        int count = 0;
                        for (int i = 0; i < 4; i++)
                        {
                            int r = startRow + i * dr;
                            int c = startCol + i * dc;
                            if (!IsInBounds(r, c) || board[r, c] != playerYugo)
                                break;
                            count++;
                        }
                        if (count == 4)
                            return true;
                    }
                }
            }
            return false;
        }
        
        // Evaluate current board position
        private int EvaluatePosition()
        {
            int whiteYugos = CountYugos(true);
            int blackYugos = CountYugos(false);
            
            // Check for Igo wins first
            if (CheckForIgo(true))
                return IGO_WIN_SCORE;
            if (CheckForIgo(false))
                return -IGO_WIN_SCORE;
                
            // Evaluate based on Yugo count and board control
            int yugoDifference = (whiteYugos - blackYugos) * YUGO_SCORE;
            int boardControl = EvaluateBoardControl();
            
            return yugoDifference + boardControl;
        }
        
        // Count Yugos for a player
        private int CountYugos(bool isWhite)
        {
            int yugoType = isWhite ? WHITE_YUGO : BLACK_YUGO;
            int count = 0;
            for (int row = 0; row < BOARD_SIZE; row++)
            {
                for (int col = 0; col < BOARD_SIZE; col++)
                {
                    if (board[row, col] == yugoType)
                        count++;
                }
            }
            return count;
        }
        
        // Evaluate board control (potential for future Yugos)
        private int EvaluateBoardControl()
        {
            int whiteControl = 0;
            int blackControl = 0;
            
            // Count potential lines of 3 pieces
            foreach (var (dr, dc) in DIRECTIONS)
            {
                for (int row = 0; row < BOARD_SIZE; row++)
                {
                    for (int col = 0; col < BOARD_SIZE; col++)
                    {
                        int whiteCount = 0;
                        int blackCount = 0;
                        int emptyCount = 0;
                        
                        for (int i = 0; i < 4; i++)
                        {
                            int r = row + i * dr;
                            int c = col + i * dc;
                            if (!IsInBounds(r, c))
                                break;
                                
                            if (board[r, c] == WHITE_MIGO || board[r, c] == WHITE_YUGO)
                                whiteCount++;
                            else if (board[r, c] == BLACK_MIGO || board[r, c] == BLACK_YUGO)
                                blackCount++;
                            else if (board[r, c] == EMPTY)
                                emptyCount++;
                        }
                        
                        if (whiteCount == 3 && emptyCount == 1)
                            whiteControl += BOARD_CONTROL_SCORE;
                        if (blackCount == 3 && emptyCount == 1)
                            blackControl += BOARD_CONTROL_SCORE;
                    }
                }
            }
            
            return whiteControl - blackControl;
        }
        
        // Utility methods
        private bool IsInBounds(int row, int col)
        {
            return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
        }
        
        // Make a move on the board
        public void MakeMove(int row, int col, bool isWhiteTurn)
        {
            if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE)
                throw new ArgumentException("Invalid move coordinates");
                
            if (board[row, col] != EMPTY)
                throw new ArgumentException("Position already occupied");
                
            if (!IsValidMove(row, col, isWhiteTurn))
                throw new ArgumentException("Invalid move - would create line longer than 4");
                
            board[row, col] = isWhiteTurn ? WHITE_MIGO : BLACK_MIGO;
            CheckForYugoCreation(row, col, isWhiteTurn);
        }
        
        // Get board state for display
        public int[,] GetBoard()
        {
            return (int[,])board.Clone();
        }
        
        // Reset board
        public void ResetBoard()
        {
            board = new int[BOARD_SIZE, BOARD_SIZE];
        }
    }
}

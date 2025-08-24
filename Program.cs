using System;
using System.Threading.Tasks;
using MigoyugoAI;

namespace MigoyugoGame
{
    class Program
    {
        static MigoyugoAI ai = new MigoyugoAI();
        static bool gameRunning = true;
        static bool isWhiteTurn = true; // White always goes first
        
        static async Task Main(string[] args)
        {
            Console.WriteLine("=== Migoyugo AI ===");
            Console.WriteLine("White always moves first. Enter moves as 'A1', 'B3', etc.");
            Console.WriteLine("Type 'quit' to exit, 'reset' to start new game.");
            Console.WriteLine();
            
            // Configure AI
            Console.Write("Enter search depth (1-6, default 4): ");
            string depthInput = Console.ReadLine();
            if (int.TryParse(depthInput, out int depth) && depth >= 1 && depth <= 6)
            {
                ai.SetSearchDepth(depth);
                Console.WriteLine($"Search depth set to {depth}");
            }
            else
            {
                Console.WriteLine("Using default search depth of 4");
            }
            Console.WriteLine();
            
            while (gameRunning)
            {
                DisplayBoard();
                
                if (isWhiteTurn)
                {
                    Console.WriteLine("Your turn (White)");
                    await HandlePlayerMove();
                }
                else
                {
                    Console.WriteLine("AI thinking... (Black)");
                    await HandleAIMove();
                }
                
                // Check for game end
                if (CheckGameEnd())
                {
                    DisplayBoard();
                    Console.WriteLine("Game Over!");
                    Console.Write("Play again? (y/n): ");
                    string response = Console.ReadLine()?.ToLower();
                    if (response != "y" && response != "yes")
                        gameRunning = false;
                    else
                        ResetGame();
                }
                
                isWhiteTurn = !isWhiteTurn;
            }
        }
        
        static void DisplayBoard()
        {
            Console.WriteLine();
            Console.WriteLine("   A B C D E F G H");
            Console.WriteLine("  ---------------");
            
            for (int row = 7; row >= 0; row--)
            {
                Console.Write($"{row + 1} |");
                for (int col = 0; col < 8; col++)
                {
                    int cell = ai.GetBoard()[row, col];
                    char symbol = cell switch
                    {
                        0 => '.',  // Empty
                        1 => 'W',  // White Migo
                        2 => 'B',  // Black Migo
                        3 => 'Y',  // White Yugo
                        4 => 'Z',  // Black Yugo
                        _ => '?'
                    };
                    Console.Write($" {symbol}");
                }
                Console.WriteLine($"| {row + 1}");
            }
            
            Console.WriteLine("  ---------------");
            Console.WriteLine("   A B C D E F G H");
            Console.WriteLine();
        }
        
        static async Task HandlePlayerMove()
        {
            while (true)
            {
                Console.Write("Enter move (e.g., A1): ");
                string input = Console.ReadLine()?.Trim().ToUpper();
                
                if (string.IsNullOrEmpty(input))
                    continue;
                    
                if (input == "QUIT")
                {
                    gameRunning = false;
                    return;
                }
                
                if (input == "RESET")
                {
                    ResetGame();
                    return;
                }
                
                if (ParseMove(input, out int row, out int col))
                {
                    try
                    {
                        ai.MakeMove(row, col, true);
                        return;
                    }
                    catch (ArgumentException ex)
                    {
                        Console.WriteLine($"Invalid move: {ex.Message}");
                    }
                }
                else
                {
                    Console.WriteLine("Invalid format. Use letters A-H and numbers 1-8 (e.g., A1)");
                }
            }
        }
        
        static async Task HandleAIMove()
        {
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            
            var move = ai.GetBestMove(false);
            stopwatch.Stop();
            
            if (move.row == -1 || move.col == -1)
            {
                Console.WriteLine("AI has no valid moves!");
                return;
            }
            
            ai.MakeMove(move.row, move.col, false);
            
            char colChar = (char)('A' + move.col);
            Console.WriteLine($"AI plays {colChar}{move.row + 1} (took {stopwatch.ElapsedMilliseconds}ms)");
        }
        
        static bool ParseMove(string input, out int row, out int col)
        {
            row = col = -1;
            
            if (input.Length != 2)
                return false;
                
            char colChar = input[0];
            char rowChar = input[1];
            
            if (colChar < 'A' || colChar > 'H')
                return false;
                
            if (rowChar < '1' || rowChar > '8')
                return false;
                
            col = colChar - 'A';
            row = rowChar - '1';
            
            return true;
        }
        
        static bool CheckGameEnd()
        {
            // Check for Igo wins
            if (ai.GetBestMove(true).row == -1 && ai.GetBestMove(false).row == -1)
            {
                // No valid moves for either player - Wego
                int whiteYugos = CountYugos(true);
                int blackYugos = CountYugos(false);
                
                if (whiteYugos > blackYugos)
                    Console.WriteLine("Wego! White wins with more Yugos.");
                else if (blackYugos > whiteYugos)
                    Console.WriteLine("Wego! Black wins with more Yugos.");
                else
                    Console.WriteLine("Wego! Game is a draw.");
                    
                return true;
            }
            
            return false;
        }
        
        static int CountYugos(bool isWhite)
        {
            int count = 0;
            var board = ai.GetBoard();
            int yugoType = isWhite ? 3 : 4; // White Yugo = 3, Black Yugo = 4
            
            for (int row = 0; row < 8; row++)
            {
                for (int col = 0; col < 8; col++)
                {
                    if (board[row, col] == yugoType)
                        count++;
                }
            }
            return count;
        }
        
        static void ResetGame()
        {
            ai.ResetBoard();
            isWhiteTurn = true;
            Console.WriteLine("Game reset!");
        }
    }
}

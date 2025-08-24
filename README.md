# Migoyugo AI

A high-performance C# implementation of the Migoyugo board game AI using minimax algorithm with alpha-beta pruning.

## Game Rules

Migoyugo is a strategic board game for two players on an 8x8 grid:

- **Migos**: Players place pieces (Migos) on empty squares
- **Yugos**: When 4 pieces form a line, they become a permanent Yugo
- **Igo**: Win by creating 4 Yugos in a line
- **Wego**: If no legal moves remain, player with most Yugos wins
- **No long lines**: Cannot create lines longer than 4 pieces

## Features

- **Minimax with Alpha-Beta Pruning**: Optimized search algorithm
- **Immediate Win/Block Detection**: Fast response to critical moves
- **Configurable Search Depth**: Adjustable from 1-6 moves ahead
- **Performance Optimized**: Written in C# for maximum speed
- **Text-based Interface**: Clean, playable console interface

## Build Instructions

### Prerequisites
- .NET 8.0 SDK or later
- Windows, macOS, or Linux

### Build Commands

```bash
# Build in Release mode for maximum performance
dotnet build -c Release

# Run the game
dotnet run -c Release
```

## Usage

1. **Start the game**: Run `dotnet run -c Release`
2. **Set search depth**: Enter 1-6 (default: 4)
3. **Make moves**: Enter coordinates like "A1", "B3", etc.
4. **Commands**:
   - `quit`: Exit the game
   - `reset`: Start a new game

## Performance Notes

- **Search Depth 4**: Good balance of speed vs. strategy (recommended)
- **Search Depth 5-6**: Stronger play but slower response
- **Search Depth 1-3**: Faster but weaker play

## Board Display

```
   A B C D E F G H
  ---------------
8 | . . . . . . . . | 8
7 | . . . . . . . . | 7
6 | . . . . . . . . | 6
5 | . . . . . . . . | 5
4 | . . . . . . . . | 4
3 | . . . . . . . . | 3
2 | . . . . . . . . | 2
1 | . . . . . . . . | 1
  ---------------
   A B C D E F G H
```

**Symbols**:
- `.` = Empty square
- `W` = White Migo
- `B` = Black Migo  
- `Y` = White Yugo
- `Z` = Black Yugo

## AI Strategy

The AI uses several optimization techniques:

1. **Immediate Win Detection**: Checks for winning moves first
2. **Blocking Detection**: Prevents opponent wins when possible
3. **Alpha-Beta Pruning**: Reduces search space significantly
4. **Position Evaluation**: Considers Yugo count and board control
5. **Move Ordering**: Prioritizes promising moves for better pruning

## Configuration

You can modify the AI behavior by changing constants in `MigoyugoAI.cs`:

- `DEFAULT_SEARCH_DEPTH`: Default search depth
- `IGO_WIN_SCORE`: Score for winning moves
- `YUGO_SCORE`: Score per Yugo
- `BOARD_CONTROL_SCORE`: Score for board control
- `BLOCKING_SCORE`: Score for blocking moves 

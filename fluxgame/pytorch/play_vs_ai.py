import sys
import os
import numpy as np

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
from fluxgame.FluxGame import KuyokuGame
from fluxgame.pytorch.NNetWrapper import NNetWrapper
from MCTS import MCTS

# Helper for attribute-style args
class dotdict(dict):
    def __getattr__(self, name):
        return self[name]
    def __setattr__(self, name, value):
        self[name] = value
    def __delattr__(self, name):
        del self[name]

def display(board):
    def symbol(x):
        if x == 0:
            return '.'
        elif x == 1:
            return '○'  # White Ion
        elif x == -1:
            return '●'  # Black Ion
        elif x in [2, 3, 4, 5]:
            return '◇'  # White Node
        elif x in [-2, -3, -4, -5]:
            return '◆'  # Black Node
        else:
            return '?'  # Unknown
    for row in board:
        print(' '.join(symbol(x) for x in row))
    print()

g = KuyokuGame(8)
nnet = NNetWrapper(g)
nnet.load_checkpoint('./', 'best.pth.tar')

args = dotdict({
    'numMCTSSims': 25,
    'cpuct': 1.0,
})
mcts = MCTS(g, nnet, args)

def ai_player(board):
    pi = mcts.getActionProb(board, temp=0)
    return np.argmax(pi)

def human_player(board):
    valid = g.getValidMoves(board, 1)
    display(board)
    print("Valid moves (0-63):", [i for i, v in enumerate(valid) if v])
    while True:
        try:
            move = int(input("Enter your move (0-63): "))
            if 0 <= move < 64 and valid[move]:
                return move
            else:
                print("Invalid move. Try again.")
        except Exception:
            print("Please enter a valid integer between 0 and 63.")

def play_game():
    board = g.getInitBoard()
    player = 1  # Human is white, goes first
    while True:
        if player == 1:
            action = human_player(board)
        else:
            print("AI is thinking...")
            action = ai_player(board * player)
        board, player = g.getNextState(board, player, action)
        if g.getGameEnded(board, -player) != 0:
            display(board)
            result = g.getGameEnded(board, -player)
            if result == 1:
                print("White (You) win!")
            elif result == -1:
                print("Black (AI) wins!")
            else:
                print("Draw!")
            break

if __name__ == '__main__':
    play_game() 
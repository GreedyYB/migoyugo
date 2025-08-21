# migoyugo

A strategic board game built with React and Node.js.

## Recent Updates
- ✅ Tutorial animations fully working and looping
- ✅ Auto-push to GitHub configured

## Features
- 8x8 strategic board gameplay
- Tutorial system with animations
- Online multiplayer support
- Deployed on Railway and Vercel

## Development
```bash
# Frontend only (for testing animations)
cd client && npm start

# Full stack
npm start
```

## Auto-Push Test
This line was added to test automatic GitHub pushing.

## Game Overview

migoyugo is a strategic board game played on an 8x8 grid between two players: White and Black. Players place "Ions" to form "Vectors" (lines of exactly 4), which create "Nodes" that remain on the board. The goal is to form a "Nexus" (4 Nodes in a line) to win.

## Features

- **Online Multiplayer**: Real-time gameplay using Socket.IO
- **Local Play**: Play against another person on the same device
- **AI Opponents**: CORE AI-1 and AI-2 difficulty levels
- **Timer System**: Configurable time controls
- **Move History**: Complete game log with notation
- **Responsive Design**: Works on desktop and mobile devices
- **Multiple Themes**: Classic, Dark, High Contrast, Nature, and Ocean themes

## Technology Stack

- **Frontend**: React 18 with TypeScript
- **Backend**: Node.js with Express
- **Real-time Communication**: Socket.IO
- **Deployment**: Railway (or any Node.js hosting platform)

## Local Development Setup

### Prerequisites

- Node.js (version 16 or higher)
- npm

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd migoyugo-react
```

2. Install server dependencies:
```bash
npm install
```

3. Install client dependencies:
```bash
cd client
npm install
cd ..
```

### Running the Application

#### Development Mode (with hot reload)

1. Start both server and client in development mode:
```bash
npm run dev
```

This will start:
- Server on http://localhost:5000
- Client on http://localhost:3000

#### Production Mode

1. Build the client:
```bash
npm run build
```

2. Start the server:
```bash
npm start
```

The application will be available at http://localhost:5000

## Deployment to Railway

### Method 1: GitHub Integration (Recommended)

1. Push your code to a GitHub repository
2. Go to [Railway](https://railway.app)
3. Sign up/Login and create a new project
4. Connect your GitHub repository
5. Railway will automatically detect the Node.js app and deploy it
6. Your app will be available at the provided Railway URL

### Method 2: Railway CLI

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login to Railway:
```bash
railway login
```

3. Initialize and deploy:
```bash
railway init
railway up
```

### Environment Variables

No additional environment variables are required for basic functionality. The app will automatically detect production mode and serve the built React app.

## Game Rules

### Core Rules
- Players take turns placing Ions (white or black) on an 8×8 board
- White always moves first
- Form "Vectors" (unbroken lines of exactly 4 Ions) horizontally, vertically, or diagonally
- Cannot form lines longer than 4 Ions of the same color
- When a Vector is formed, the last Ion becomes a "Node" and other Ions are removed

### Node Types
- 1 Vector = Standard Node (red dot)
- 2 Vectors at once = Double Node (red oval)
- 3 Vectors at once = Triple Node (red triangle)
- 4 Vectors at once = Quadruple Node (red diamond)

### Winning
- Form a "Nexus" (Vector of 4 Nodes) to win immediately
- If no Nexus is possible, player with most Nodes wins
- Equal Nodes = Draw

## Project Structure

```
migoyugo-react/
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.tsx        # Main React component
│   │   ├── migoyugo-styles.css # Original game styles
│   │   └── ...
│   └── package.json
├── server/                 # Node.js backend
│   └── index.js           # Express server with Socket.IO
├── package.json           # Root package.json
├── railway.json           # Railway deployment config
├── Procfile              # Process file for deployment
└── README.md
```

## API/Socket Events

### Client to Server
- `findMatch`: Request to find an online opponent
- `cancelMatchmaking`: Cancel matchmaking request
- `makeMove`: Make a move in the game
- `resign`: Resign from current game

### Server to Client
- `gameStart`: Game found and started
- `waitingForOpponent`: Waiting for opponent to join
- `moveUpdate`: Move made by opponent
- `gameEnd`: Game ended (resignation, etc.)
- `opponentDisconnected`: Opponent left the game

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues or questions, please create an issue in the GitHub repository. 

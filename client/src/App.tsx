'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import TutorialDemo from './components/Demo';
import { 
  handleLogin, 
  handleSignup, 
  handlePlayAsGuest, 
  handleLogout, 
  handleViewStats,
  getApiUrl 
} from './components/Authentication';
// Evaluation functions were being used for Advanced AI, 
// but I have retained them separately for future reference.
import {
  evaluateThreats,
  evaluatePositional,
  evaluateMobility,
  evaluateStrategic,
  evaluateTactical
} from './components/Evaluation';
import {
  isValidMove,
  wouldCreateLineTooLong,
  checkForVectors,
  processVectors,
  checkForNexus,
  hasLegalMoves,
  countNodes,
  Cell
} from './components/gameLogic';
import {
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
} from './components/helperFunctions';
import { mcts } from './components/AI3mcts';
import './migoyugo-styles.css';

// Types
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

const App: React.FC = () => {
  // Game state
  const [gameState, setGameState] = useState<GameState>({
    board: copyBoard(INITIAL_BOARD),
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
    boardColor: '#d1e6f9',
    hoverColor: '#a8c3e8', // classic hover color (darker than board)
    lastMoveColor: 'rgba(46, 204, 113, 0.2)' // classic last move color
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
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
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

  // Animation state for ion placement and removal
  const [newlyPlacedDots, setNewlyPlacedDots] = useState<Set<string>>(new Set());
  const [fadingDots, setFadingDots] = useState<Set<string>>(new Set());

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
    // Always set theme to classic, ignore saved theme
    setCurrentTheme('classic');

    const savedSoundEnabled = localStorage.getItem('migoyugoSoundEnabled');
    const savedCustomColors = localStorage.getItem('migoyugoCustomColors');

    if (savedSoundEnabled) {
      setSoundEnabled(JSON.parse(savedSoundEnabled));
    }
    if (savedCustomColors) {
      setCustomColors(JSON.parse(savedCustomColors));
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
    root.style.setProperty('--hover-color', colors.hoverColor);
    root.style.setProperty('--last-move-color', colors.lastMoveColor);
  };

  // Clear custom colors from CSS variables
  const clearCustomColors = () => {
    const root = document.documentElement;
    root.style.removeProperty('--white-ion');
    root.style.removeProperty('--black-ion');
    root.style.removeProperty('--node-color');
    root.style.removeProperty('--board-color');
    root.style.removeProperty('--hover-color');
    root.style.removeProperty('--last-move-color');
  };

  // Handle theme change
  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    localStorage.setItem('migoyugoTheme', theme);
  };

  // Handle sound toggle
  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    localStorage.setItem('migoyugoSoundEnabled', JSON.stringify(enabled));
  };

  // Handle custom color change
  const handleCustomColorChange = (colorType: keyof typeof customColors, color: string) => {
    const newColors = { ...customColors, [colorType]: color };
    setCustomColors(newColors);
    localStorage.setItem('migoyugoCustomColors', JSON.stringify(newColors));
  };

  // Reset settings to defaults
  const resetSettings = () => {
    // Reset state to default values
    setCurrentTheme('classic');
    setSoundEnabled(true);
    setCustomColors({
      whiteIon: '#ecf0f1',
      blackIon: '#2c3e50',
      nodeColor: '#e74c3c',
      boardColor: '#d1e6f9',
      hoverColor: '#a8c3e8',
      lastMoveColor: 'rgba(46, 204, 113, 0.2)'
    });
  
    // Remove from localStorage
    localStorage.removeItem('migoyugoTheme');
    localStorage.removeItem('migoyugoSoundEnabled');
    localStorage.removeItem('migoyugoCustomColors');
  
    // Show confirmation
    showToast('Settings have been reset to default.');
  };

  // Sound function
  const playSound = (soundName: 'chip' | 'vector' | 'nexus') => {
    // Check if sound is enabled before playing
    if (!soundEnabled) {
      console.log(`Sound disabled - ${soundName} not played`);
      return;
    }
    
    try {
      const audio = new Audio(`/sounds/${soundName}.mp3`);
      // Set volume based on sound type
      if (soundName === 'nexus') {
        audio.volume = 0.168; // Reduced nexus/lock volume by additional 30% (from 24% to 16.8%)
      } else {
        audio.volume = 0.3; // Standard volume for chip and vector sounds
      }
      console.log(`Playing sound: ${soundName}.mp3 at volume ${audio.volume}`);
      audio.play().catch(e => console.log(`Sound play failed for ${soundName}:`, e));
    } catch (e) {
      console.log(`Sound loading failed for ${soundName}:`, e);
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
            
            // Check if user has an active game to reconnect to
            // This will trigger socket connection and potential reconnection
            setGameMode('online');
          } else {
            // Token is invalid, remove it
            localStorage.removeItem('authToken');
          }
        } catch (error) {
          // Connection error, keep token but don't authenticate yet
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
        setOpponentDisconnected(false);
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
        // Validate timer sync - check if we missed any updates
        if (data.timestamp) {
          const timeDiff = Date.now() - data.timestamp;
          // If more than 3 seconds difference, request sync
          if (timeDiff > 3000) {
            console.log('Timer sync issue detected, requesting sync...');
            newSocket.emit('requestTimerSync', { gameId });
            return;
          }
        }
        
        setTimers(data.timers);
        setActiveTimer(data.activeTimer);
      });

      newSocket.on('timerSync', (data) => {
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
          playSound('chip'); // Regular chip placement
        }

        // Trigger animations for online moves
        setGameState(prev => {
          // Calculate removed dots by comparing old and new boards
          if (moveData.vectors > 0) {
            const removedCells: {row: number, col: number}[] = [];
            for (let row = 0; row < 8; row++) {
              for (let col = 0; col < 8; col++) {
                // If there was an ion here before but not now (except the new placement)
                if (prev.board[row][col] && !moveData.board[row][col] && 
                    !(row === moveData.row && col === moveData.col)) {
                  removedCells.push({row, col});
                }
              }
            }
            if (removedCells.length > 0) {
              addFadeOutAnimation(removedCells);
            }
          }
          
          // Trigger bounce-in animation for newly placed dot
          addNewDotAnimation(moveData.row, moveData.col);

          return {
            ...prev,
            board: moveData.board,
            currentPlayer: moveData.currentPlayer,
            scores: moveData.scores,
            lastMove: { row: moveData.row, col: moveData.col, player: moveData.player },
            gameStatus: moveData.gameOver ? 'finished' : 'active',
            nexusLine: moveData.nexus || null
          };
        });

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
          // Validate timer sync for move updates too
          if (moveData.timestamp) {
            const timeDiff = Date.now() - moveData.timestamp;
            if (timeDiff > 3000) {
              console.log('Move timer sync issue detected, requesting sync...');
              newSocket.emit('requestTimerSync', { gameId });
            }
          }
          setTimers(moveData.timers);
        }

        if (moveData.gameOver) {
          let message = '';
          if (moveData.winner === 'draw') {
            message = 'Game ended in a draw!';
          } else if (moveData.nexus) {
            message = `${moveData.winner} wins with a Lock!`;
          } else {
            message = `${moveData.winner} wins by node count!`;
          }
          // Add 1 second delay for players to see the final move
          showGameOverNotification('Game Over', message);
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

      newSocket.on('opponentDisconnected', (data) => {
  console.log('Opponent disconnected:', data);
  setOpponentDisconnected(true);
});

newSocket.on('opponentReconnected', () => {
  console.log('Opponent reconnected');
  setOpponentDisconnected(false);
});

newSocket.on('gameReconnected', (data) => {
  console.log('Reconnected to existing game:', data);
  
  // Set up the game state similar to gameStart
  setGameId(data.gameId);
  setPlayerColor(data.playerColor);
  setOpponentName(data.opponentName);
  setGameState(prev => ({
    ...prev,
    ...data.gameState,
    gameStatus: 'active'
  }));
  setTimers(data.timers);
  setActiveTimer(data.gameState.currentPlayer);
  setOpponentDisconnected(false);
  setIsGameStarted(true);
  
  // Set game mode and hide menus
  setGameMode('online');
  setShowMatchmaking(false);
  setIsSearchingMatch(false);
  
  console.log('Game reconnection complete');
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
        setOpponentDisconnected(false);
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
          showGameOverNotification('Time Out', `${winner} wins on time!`);
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

  // Helper function to initialize timers
  const initializeTimers = () => {
    if (timerEnabled) {
      const totalSeconds = minutesPerPlayer * 60;
      setTimers({ white: totalSeconds, black: totalSeconds });
    }
  };

  // Helper function to show game over notification with delay
  const showGameOverNotification = (title: string, message: string, delay: number = 1000) => {
    setTimeout(() => {
      setNotification({
        title,
        message,
        show: true
      });
    }, delay);
  };

  // Start timer when game starts or player changes
  useEffect(() => {
    if (isGameStarted && gameState.gameStatus === 'active' && timerEnabled) {
      setActiveTimer(gameState.currentPlayer);
    }
  }, [isGameStarted, gameState.currentPlayer, gameState.gameStatus, timerEnabled]);

  // Request timer sync when reconnecting to online game
  useEffect(() => {
    if (socket && gameId && gameMode === 'online' && isGameStarted) {
      // Request current timer state when reconnecting
      socket.emit('requestTimerSync', { gameId });
    }
  }, [socket, gameId, gameMode, isGameStarted]);

  // Authentication handlers
  const handleLoginWrapper = async (email: string, password: string) => {
    await handleLogin(email, password, setAuthError, setAuthState, setShowLogin, showToast);
  };

  const handleSignupWrapper = async (email: string, username: string, password: string) => {
    await handleSignup(email, username, password, setAuthError, setAuthState, setShowSignup, showToast);
  };

  const handlePlayAsGuestWrapper = () => {
    handlePlayAsGuest(setAuthState, setShowMatchmaking);
  };

  const handleLogoutWrapper = () => {
    handleLogout(setAuthState, setGameMode, resetGame, showToast);
  };

  // Handle stats button click
  const handleViewStatsWrapper = async () => {
    await handleViewStats(authState, setShowStatsAuth, setStatsLoading, setUserStats, setShowStats, setToast);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const makeLocalMove = useCallback((row: number, col: number) => {
    // Check basic validity first
    if (!isValidMove(gameState.board, row, col, gameState.currentPlayer)) {
    if (wouldCreateLineTooLong(gameState.board, row, col, gameState.currentPlayer)) {
      showToast("Illegal move. You may not create a line longer than 4 of your own color");
      }
      return;
    }
    
    const currentPlayer = gameState.currentPlayer;
    const newBoard = copyBoard(gameState.board);
    
    // Place the ion
    newBoard[row][col] = { color: currentPlayer, isNode: false };
    
    // Check for vectors
    const vectors = checkForVectors(newBoard, row, col, currentPlayer);
    const { nodeType, removedCells } = processVectors(newBoard, vectors, row, col);
    
            // Trigger fade-out animation for removed dots
    if (removedCells.length > 0) {
      addFadeOutAnimation(removedCells);
    }
    
    // Trigger bounce-in animation for newly placed dot
    addNewDotAnimation(row, col);
    
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
      playSound('chip'); // Regular chip placement
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
        message = `${winner} wins with a Lock!`;
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
            console.log('AI effect check:', {
      isGameStarted,
      gameStatus: gameState.gameStatus,
      gameMode,
      playerColor,
      currentPlayer: gameState.currentPlayer,
    });
    const aiTurnInStandardMode = isGameStarted &&
      gameState.gameStatus === 'active' &&
              (gameMode === 'ai-1' || gameMode === 'ai-2' || gameMode === 'ai-3') &&
      playerColor &&
      gameState.currentPlayer !== playerColor;

    const aiTurnInSelfPlay = false;

    if (aiTurnInStandardMode || aiTurnInSelfPlay) {
      // AI's turn
      let minThinkTime, maxThinkTime;
              const currentEngine = gameMode as 'ai-1' | 'ai-2' | 'ai-3';

      if (currentEngine === 'ai-1') {
        minThinkTime = 1000;
        maxThinkTime = 2000;
      } else if (currentEngine === 'ai-2') {
        minThinkTime = 1500;
        maxThinkTime = 2500;
      } else if (currentEngine === 'ai-3') {
        minThinkTime = 2000;
        maxThinkTime = 4000;
      } else {
        minThinkTime = 2500;
        maxThinkTime = 5000;
      }
      const thinkTime = Math.floor(Math.random() * (maxThinkTime - minThinkTime + 1)) + minThinkTime;
      console.log(`${currentEngine.toUpperCase()} thinking for ${thinkTime}ms...`);
      const timeout = setTimeout(() => {
        let aiMove;
        
        // AI-1, AI-2, AI-3 logic
        const validMoves: { row: number; col: number; score: number }[] = [];
        for (let row = 0; row < 8; row++) {
          for (let col = 0; col < 8; col++) {
            if (isValidMove(gameState.board, row, col, 'black')) {
              const score = evaluateMove(gameState.board, row, col, 'black', currentEngine as 'ai-1' | 'ai-2' | 'ai-3');
              validMoves.push({ row, col, score });
            }
          }
        }
        if (validMoves.length > 0) {
          validMoves.sort((a, b) => b.score - a.score);
          if (currentEngine === 'ai-1') {
            const topMoves = validMoves.slice(0, Math.min(3, validMoves.length));
            aiMove = topMoves[Math.floor(Math.random() * topMoves.length)];
          } else if (currentEngine === 'ai-2') {
            const criticalMoves = validMoves.filter(move => move.score >= 800);
            if (criticalMoves.length > 0) {
              aiMove = criticalMoves[0];
            } else {
              const topMoves = validMoves.slice(0, Math.min(5, validMoves.length));
              aiMove = topMoves[Math.floor(Math.random() * topMoves.length)];
            }
          } else { // ai-3
            const criticalMoves = validMoves.filter(move => move.score >= 9000);
            if (criticalMoves.length > 0) {
              aiMove = criticalMoves[0];
            } else {
              const winningMoves = validMoves.filter(move => move.score >= 1000);
              if (winningMoves.length > 0) {
                aiMove = winningMoves[0];
              } else {
                const topMoves = validMoves.slice(0, Math.min(5, validMoves.length));
                aiMove = topMoves[0];
              }
            }
          }
        }
        
        if (aiMove) {
          console.log(`${currentEngine.toUpperCase()} selected move:`, aiMove);
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
      
      const newBoard = copyBoard(INITIAL_BOARD);
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
        initializeTimers();
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
      initializeTimers();
    }
    
    // Clear any active animations
    setNewlyPlacedDots(new Set());
    setFadingDots(new Set());
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
      message: "<span style=\"color: red; font-weight: bold;\">Migoyugo</span> is played on an 8×8 board.<br>Players alternate turns,<br>white moves first, then black,<br>placing pieces called <span style=\"color: red; font-weight: bold;\">Migos</span> on empty squares.",
      demo: "board"
    },
    {
      title: "Building Yugos",
      message: "Your first tactical step is to create a <span style=\"color: red; font-weight: bold;\">Yugo</span>. A Yugo is created when you build an unbroken line of exactly 4 pieces of your own color, horizontal, vertical, or diagonal.",
      demo: "vector"
    },
    {
      title: "Yugos",
      message: "When a <span style=\"color: red; font-weight: bold;\">Yugo</span> is created, it is identified with a red mark in the middle of the piece. At that same moment, all Migos in the line of 4 disappear, while any Yugos already in that line remain. Yugos can never be moved or removed from the board.",
      demo: "node"
    },
    {
      title: "No Long Lines",
      message: "You may not place a Migo on any square that would create an unbroken line longer than 4 pieces (any combination of Migos/Yugos) of your own color.",
      demo: "long-line"
    },
    {
      title: "The Winning Goal",
      message: "Win by forming an <span style=\"color: red; font-weight: bold;\">Igo</span>. An Igo is an unbroken line of 4 Yugos of one color, horizontal, vertical or diagonal.",
      demo: "nexus"
    },
    {
      title: "Alternative Win",
      message: "<b>No legal moves:</b><br>If at any time either player is unable to play a legal move, or all 64 squares are covered, the game ends with a <span style=\"color: red; font-weight: bold;\">Wego</span>, and the player with the most Yugos wins. If both players have the same number of Yugos, the game is a draw by Wego.<br><br><b>Timer expiry:</b><br>If players have chosen to play using a timer, the game will end immediately if one player runs out of time, and the opponent will be awarded the win.<br><br><b>Resignation:</b><br>A player may choose to resign a game at any point and this will award the win to their opponent.",
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
      message: "You have two options - play against a human opponent or try your luck against one of the AI levels.<br><br>You can play with a timer or without.<br>Choose from a 3-minute game or up to an hour on the clock.<br>You can even choose increments from 2 to 10 seconds which add time to your clock after every move.<br>Once you run out of time, it's game over.<br><br>Is it better to build your own Yugos or block your opponent?<br>Will you go for an Igo or fill the board and see who ends up with the most Yugos?<br>The options are endless.<br><br>That's all you need to know!<br>Click 'Start' and enjoy playing <span style=\"color: red; font-weight: bold;\">Migoyugo</span>!",
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
    
    // Clear any active animations
    setNewlyPlacedDots(new Set());
    setFadingDots(new Set());
    
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
    const board = copyBoard(INITIAL_BOARD);
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

  // Helper functions for animation management
  const addNewDotAnimation = (row: number, col: number) => {
    // Don't animate in review mode
    if (isReviewMode) return;
    
    const cellKey = `${row}-${col}`;
    setNewlyPlacedDots(prev => new Set([...Array.from(prev), cellKey]));
    
    // Remove the animation class after 200ms (duration of bounce-in animation)
    setTimeout(() => {
      setNewlyPlacedDots(prev => {
        const newSet = new Set(prev);
        newSet.delete(cellKey);
        return newSet;
      });
    }, 200);
  };

  const addFadeOutAnimation = (cellsToFade: {row: number, col: number}[]) => {
    // Don't animate in review mode
    if (isReviewMode) return;
    
    const cellKeys = cellsToFade.map(({row, col}) => `${row}-${col}`);
    setFadingDots(prev => new Set([...Array.from(prev), ...cellKeys]));
    
    // Remove the animation class after 200ms (duration of fade-out animation)
    setTimeout(() => {
      setFadingDots(prev => {
        const newSet = new Set(prev);
        cellKeys.forEach(key => newSet.delete(key));
        return newSet;
      });
    }, 200);
  };

  const renderCell = (row: number, col: number) => {
    const cell = gameState.board[row][col];
    const cellKey = `${row}-${col}`;
    // Only highlight the current last move
    const isLastMove = gameState.lastMove?.row === row && gameState.lastMove?.col === col;
    const isNexusCell = gameState.nexusLine?.some(pos => pos.row === row && pos.col === col) || false;
    const isNewlyPlaced = newlyPlacedDots.has(cellKey);
    const isFading = fadingDots.has(cellKey);
    
    return (
      <div
        key={`${row}-${col}`}
        className={`cell${isLastMove ? ' last-move' : ''}${isNexusCell ? ' nexus-cell' : ''}`}
        onClick={() => handleCellClick(row, col)}
      >
        {/* Cell coordinate labels - only show on edges like a chess board */}
        {col === 0 && <div className="cell-row-label">{8 - row}</div>}
        {row === 7 && <div className="cell-col-label">{String.fromCharCode(97 + col)}</div>}
        {cell && (
          <>
            {/* Always render the dot (colored piece) with animation classes */}
            <div className={`dot ${cell.color}${isNewlyPlaced ? ' new-dot' : ''}${isFading ? ' fade-out' : ''}`} />
            {/* If it's a node, also render the node indicator on top */}
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

  // Add state for player color choice
  const [playerColorChoice, setPlayerColorChoice] = useState<'white' | 'black' | 'random'>('white');

  // When starting a new AI game, determine playerColor based on playerColorChoice
  const startAIGame = () => {
    // Defensive: default to 'white' if playerColorChoice is null/undefined
    let chosenColor: 'white' | 'black';
    if (playerColorChoice === 'random') {
      chosenColor = Math.random() < 0.5 ? 'white' : 'black';
    } else if (playerColorChoice === 'white' || playerColorChoice === 'black') {
      chosenColor = playerColorChoice;
    } else {
      chosenColor = 'white'; // fallback default
    }
    setPlayerColor(chosenColor);

    // Initialize the game state - White always goes first
    const newBoard = copyBoard(INITIAL_BOARD);
    setGameState({
      board: newBoard,
      currentPlayer: 'white',
      scores: { white: 0, black: 0 },
      gameStatus: 'active',
      lastMove: null,
      players: {
        white: chosenColor === 'white' ? 'White' : `CORE ${gameMode.toUpperCase()}`,
        black: chosenColor === 'black' ? 'White' : `CORE ${gameMode.toUpperCase()}`
      },
      nexusLine: null
    });
    setIsGameStarted(true);
    setMoveHistory([]);

    if (timerEnabled) {
      initializeTimers();
      setActiveTimer(chosenColor);
    }
  };

  // AI move selection for different difficulty levels
  const getAIMove = (
    board: (Cell | null)[][],
    difficulty: 'ai-1' | 'ai-2' | 'ai-3'
  ): { row: number; col: number } | null => {
    const validMoves: { row: number; col: number; score: number }[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (isValidMove(board, row, col, 'black')) {
          const score = evaluateMove(board, row, col, 'black', difficulty);
          validMoves.push({ row, col, score });
        }
      }
    }
    if (validMoves.length === 0) return null;
    if (difficulty === 'ai-1') {
      validMoves.sort((a, b) => b.score - a.score);
      const topMoves = validMoves.slice(0, Math.min(3, validMoves.length));
      return topMoves[Math.floor(Math.random() * topMoves.length)];
    } else if (difficulty === 'ai-2') {
      validMoves.sort((a, b) => b.score - a.score);
      const criticalMoves = validMoves.filter(move => move.score >= 800);
      if (criticalMoves.length > 0) {
        return criticalMoves[0];
      }
      const topMoves = validMoves.slice(0, Math.min(5, validMoves.length));
      return topMoves[Math.floor(Math.random() * topMoves.length)];
    } else { // AI-3 now uses MCTS
      return mcts(board, 'black', 200, 8);
    }
  };

  return (
    <div className="App">
      <header>
        <img 
          src="/migoyugo-logo.png" 
          alt="migoyugo" 
          style={{
            height: '60px',
            maxWidth: '300px',
            objectFit: 'contain',
            margin: '10px auto',
            display: 'block'
          }}
        />
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
                  onClick={handleLogoutWrapper}
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
                <span>Links: <span id="white-score">{gameState.scores.white}</span></span>
              </div>
              {timerEnabled && (
  <div className="player-timer" id="white-timer">
    {formatTime(timers.white)}
  </div>
)}
          </div>

          {/* Game board */}
          <div className="board-with-labels">
            <div style={{ position: 'relative' }}>
              {renderBoard()}
              
              {/* Disconnect Modal */}
              {gameMode === 'online' && opponentDisconnected && (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '0',
                  right: '0',
                  transform: 'translateY(-50%)',
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  border: '2px solid #dc3545',
                  borderRadius: '8px',
                  padding: '20px',
                  margin: '0 10px',
                  textAlign: 'center',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                  zIndex: 1000
                }}>
                  <div style={{
                    color: '#dc3545',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    marginBottom: '10px'
                  }}>
                    Your opponent has disconnected
                  </div>
                  <div style={{
                    color: '#333',
                    fontSize: '14px',
                    lineHeight: '1.4'
                  }}>
                    Their timer will continue to count down until they return, or time out.
                  </div>
                </div>
              )}
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
                              <span>Links: <span id="black-score">{gameState.scores.black}</span></span>
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
                  <TutorialDemo demoType={tutorialSteps[tutorialStep].demo as "board" | "vector" | "node" | "long-line" | "nexus"} />
                )}
              </div>
              <div className="tutorial-navigation">
                {tutorialStep > 0 ? (
                  <button className="btn" onClick={prevTutorialStep}>
                    Previous
                  </button>
                ) : (
                  <button className="btn" style={{ visibility: 'hidden' }}>
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
          <div className="notification settings-dialog" style={{ display: 'block' }}>
            <h2><span style={{color: 'red', fontWeight: 'bold'}}>Migoyugo</span> Game Rules</h2>
            
            <br />
                        <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 10, textAlign: 'left' }}>
              <h3 style={{ color: 'red' }}>The Game</h3>
              <ul style={{ listStyleType: 'disc', paddingLeft: '20px', marginBottom: '30px' }}>
                <li><strong>Migoyugo</strong> is a board game for two players</li>
                <li>it is an abstract strategy game that features complete information and no reliance on luck or chance</li>
              </ul>
              
              <h3 style={{ color: 'red' }}>The Board</h3>
              <ul style={{ listStyleType: 'disc', paddingLeft: '20px', marginBottom: '30px' }}>
                <li>The Migoyugo board is an 8 X 8 grid of 64 squares, all of the same color</li>
                <li>The board is made up of eight rows (1-8 from bottom to top) and eight columns (A-H from left to right)</li>
              </ul>
              
              <h3 style={{ color: 'red' }}>The Migo</h3>
              <ul style={{ listStyleType: 'disc', paddingLeft: '20px', marginBottom: '30px' }}>
                <li>White always moves first by placing a piece, called a <strong>Migo</strong>, on any open square on the board</li>
                <li>Players take turns placing Migos, alternating white and black</li>
                <li>A player may place a Migo on any open square on the board, unless it will create an unbroken line longer than 4 pieces of their own colour</li>
              </ul>
              
              <h3 style={{ color: 'red' }}>The Yugo</h3>
              <ul style={{ listStyleType: 'disc', paddingLeft: '20px', marginBottom: '30px' }}>
                <li>When you form an unbroken line (horizontal, vertical or diagonal) of exactly 4 pieces of your own color, the last Migo placed in this line becomes a <strong>Yugo</strong>, represented by a red mark in the center</li>
                <li>When a Yugo is created, all Migos in the line are removed, leaving behind only the Yugo created and any other Yugos in that line</li>
                <li>Yugos can never be moved or removed from the board</li>
              </ul>
              
              <h3 style={{ color: 'red' }}>Yugo Types</h3>
              <ul style={{ listStyleType: 'disc', paddingLeft: '20px', marginBottom: '20px' }}>
                <li>Yugos are marked differently depending on how many lines are formed in a single move:</li>
              </ul>
              <table style={{ width: '100%', borderCollapse: 'collapse', margin: '10px 0 30px 0', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Lines Formed</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Yugo Type</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Marker Symbol</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>1 line</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>Single Yugo</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>
                      <div style={{ 
                        width: '12px', 
                        height: '12px', 
                        borderRadius: '50%', 
                        backgroundColor: '#e74c3c', 
                        display: 'inline-block' 
                      }}></div> (red dot)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>2 intersecting lines at once</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>Double Yugo</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>
                      <div style={{ 
                        width: '16px', 
                        height: '8px', 
                        backgroundColor: '#e74c3c', 
                        borderRadius: '50%',
                        display: 'inline-block' 
                      }}></div> (red oval)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>3 intersecting lines at once</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>Triple Yugo</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>
                      <div style={{ 
                        width: '12px', 
                        height: '12px', 
                        backgroundColor: '#e74c3c', 
                        clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
                        display: 'inline-block' 
                      }}></div> (red triangle)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>4 intersecting lines at once</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>Quadruple Yugo</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>
                      <div style={{ 
                        width: '12px', 
                        height: '12px', 
                        backgroundColor: '#e74c3c', 
                        transform: 'rotate(45deg)',
                        display: 'inline-block' 
                      }}></div> (red diamond)
                    </td>
                  </tr>
                </tbody>
              </table>
              
              <h3 style={{ color: 'red' }}>No Long Lines</h3>
              <ul style={{ listStyleType: 'disc', paddingLeft: '20px', marginBottom: '30px' }}>
                <li>At no time may either player create a line of more than 4 in a row of any combination of Migos and/or Yugos</li>
              </ul>
              
              <h3 style={{ color: 'red' }}>Winning</h3>
              <ul style={{ listStyleType: 'disc', paddingLeft: '20px', marginBottom: '20px' }}>
                <li>Form an unbroken line (horizontal, vertical or diagonal) of exactly 4 Yugos of your own color and you win instantly with an <strong>Igo</strong></li>
                <li>If no Igo can be made and no legal moves are available to either player at any time, the game ends with a <strong>Wego</strong>, and the player with the most Yugos is declared the winner. If both players have the same number of Yugos, the game is drawn</li>
                <li>If a player resigns, the opponent is declared the winner</li>
                <li>If the players compete using a clock, a player is declared the winner if the opponent's clock runs out of time</li>
              </ul>
            </div>

            <div className="notification-buttons">
              <button className="btn" onClick={() => setShowRules(false)}>Close</button>
            </div>
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
                    <label>White Chip Color:</label>
                    <input
                      type="color"
                      value={customColors.whiteIon}
                      onChange={(e) => handleCustomColorChange('whiteIon', e.target.value)}
                    />
                  </div>
                  
                  <div className="color-option">
                    <label>Black Chip Color:</label>
                    <input
                      type="color"
                      value={customColors.blackIon}
                      onChange={(e) => handleCustomColorChange('blackIon', e.target.value)}
                    />
                  </div>
                  
                  <div className="color-option">
                    <label>Link Color:</label>
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
                  
                  <div className="color-option">
                    <label>Hover Color:</label>
                    <input
                      type="color"
                      value={customColors.hoverColor}
                      onChange={(e) => handleCustomColorChange('hoverColor', e.target.value)}
                    />
                  </div>
                  
                  <div className="color-option">
                    <label>Last Move Indicator:</label>
                    <input
                      type="color"
                      value={customColors.lastMoveColor}
                      onChange={(e) => handleCustomColorChange('lastMoveColor', e.target.value)}
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
              <button className="btn" onClick={handleViewStatsWrapper} disabled={statsLoading}>
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
              handleLoginWrapper(
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
                <button type="button" className="btn" onClick={() => { setShowLogin(false); handlePlayAsGuestWrapper(); }}>
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
              handleSignupWrapper(
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
                <button type="button" className="btn" onClick={() => { setShowSignup(false); handlePlayAsGuestWrapper(); }}>
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
                <button className="btn" onClick={() => { setNotification(prev => ({ ...prev, show: false })); handlePlayAsGuestWrapper(); }}>
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

            {/* Color selection for AI games */}
            {(gameMode.startsWith('ai-')) && (
              <div className="option-row" style={{ marginBottom: '20px', justifyContent: 'center' }}>
                <span style={{ fontWeight: 'bold', fontSize: '16px', marginRight: '12px' }}>Play as:</span>
                <div style={{ display: 'inline-flex', gap: '8px' }}>
                  <button
                    type="button"
                    className={`color-choice-btn${playerColorChoice === 'white' ? ' selected' : ''}`}
                    aria-label="Play as White"
                    onClick={() => setPlayerColorChoice('white')}
                    style={{ 
                      padding: '8px 12px', 
                      borderRadius: '6px', 
                      border: '2px solid #ccc', 
                      background: playerColorChoice === 'white' ? '#ecf0f1' : 'white', 
                      fontWeight: playerColorChoice === 'white' ? 'bold' : 'normal',
                      fontSize: '16px',
                      cursor: 'pointer'
                    }}
                  >
                    ⚪
                  </button>
                  <button
                    type="button"
                    className={`color-choice-btn${playerColorChoice === 'black' ? ' selected' : ''}`}
                    aria-label="Play as Black"
                    onClick={() => setPlayerColorChoice('black')}
                    style={{ 
                      padding: '8px 12px', 
                      borderRadius: '6px', 
                      border: '2px solid #ccc', 
                      background: playerColorChoice === 'black' ? '#2c3e50' : 'white', 
                      color: playerColorChoice === 'black' ? 'white' : '#2c3e50', 
                      fontWeight: playerColorChoice === 'black' ? 'bold' : 'normal',
                      fontSize: '16px',
                      cursor: 'pointer'
                    }}
                  >
                    ⚫
                  </button>
                </div>
              </div>
            )}

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
            🎮 Install migoyugo Game
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
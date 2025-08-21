import React, { useState, useEffect, useCallback, useRef } from 'react';

/*
 * Tutorial Demo Component
 * 
 * This component provides animated demonstrations for the Migoyugo game tutorial.
 * It includes demos for:
 * - Board gameplay (8x8 grid with move sequences)
 * - Vector formation (4-in-a-row detection)
 * - Node creation (Yugo formation from Migos)
 * - Long line prevention (invalid move demonstration)
 * - Nexus formation (special game mechanics)
 * 
 * Usage in App.tsx:
 * import TutorialDemo from './components/Demo';
 * <TutorialDemo demoType="board" />
 * 
 * Available demo types: 'board', 'vector', 'node', 'long-line', 'nexus'
 */

// Component props interface
interface TutorialDemoProps {
  demoType: 'board' | 'vector' | 'node' | 'long-line' | 'nexus';
}

// Tutorial animation helper functions
const createTutorialDot = (color: string): HTMLElement => {
  const dot = document.createElement('div');
  dot.className = `tutorial-demo-dot ${color}`;
  dot.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 50%;
    transition: all 0.3s ease;
    ${color === 'white' 
      ? 'background: #ecf0f1; border: 2px solid #2c3e50; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);'
      : 'background: #2c3e50; border: 2px solid #1a252f; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);'
    }
  `;
  return dot;
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
      const ion = createTutorialDot(color);
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
      const ion = createTutorialDot(color);
      ion.classList.add('ion-appear');
      return ion;
    };
  
    const resetDemo = () => {
      step = 0;
      startSequence();
    };
  
    const startSequence = () => {
      const sequence = () => {
        if (step < 6) { // Place first three pairs of dots
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
          // Wait 3 seconds before fading
          animationRef.current = setTimeout(() => {
            // Fade out both dots and highlighting together
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
      const ion = createTutorialDot(color);
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
              const yugoIon = createAnimatedIon('white', true);
              cell.appendChild(yugoIon);
              
              // Highlight the vector line
              for (let i = 1; i <= 4; i++) {
                const vectorCell = board.children[1 * 6 + i] as HTMLElement;
                vectorCell.style.backgroundColor = 'rgba(46, 204, 113, 0.3)';
                vectorCell.style.boxShadow = 'inset 0 0 10px rgba(46, 204, 113, 0.5)';
                vectorCell.style.transition = 'all 0.3s ease';
              }
              
              // Wait 0.3 seconds after Yugo appears, then fade out the 3 Migos
              animationRef.current = setTimeout(() => {
                // Get the 3 white Migos (not the Yugo) - correct class name
                const migoElements: HTMLElement[] = [];
                for (let i = 1; i <= 3; i++) {
                  const migoCell = board.children[1 * 6 + i] as HTMLElement;
                  const migoIon = migoCell.querySelector('.tutorial-demo-dot:not(.node)');
                  if (migoIon) {
                    migoElements.push(migoIon as HTMLElement);
                  }
                }
                
                console.log('Found Migos to fade:', migoElements.length); // Debug log
                
                // Apply fade-out to each Migo using CSS class (to override !important)
                migoElements.forEach((migo) => {
                  migo.classList.remove('ion-appear'); // Remove appear animation
                  migo.classList.add('ion-fade'); // Add fade animation
                  
                  // Remove the element after fade completes
                  setTimeout(() => {
                    if (migo.parentNode) {
                      migo.parentNode.removeChild(migo);
                    }
                  }, 500);
                });
              }, 300);
              
              // Wait 3 seconds total, then fade everything
              animationRef.current = setTimeout(() => {
                // Fade out all remaining dots (black dots and node)
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
      const ion = createTutorialDot(color);
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
                  
                  // Fade dots
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
    const finalNode = { pos: [1, 3] };  // Column 9
    
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
      const ion = createTutorialDot(color);
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
  const TutorialDemo: React.FC<TutorialDemoProps> = ({ demoType }) => {
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

export default TutorialDemo;

// Named exports for individual functions if needed
export { 
  TutorialDemo,
  setupBoardDemo,
  setupVectorDemo,
  setupNodeDemo,
  setupLongLineDemo,
  setupNexusDemo,
  createTutorialDot,
  addTutorialStyles
};

/*
 * Export Summary:
 * 
 * Default export: TutorialDemo component
 * 
 * Import examples:
 * import TutorialDemo from './components/Demo';
 * import { setupBoardDemo, createTutorialDot } from './components/Demo';
 * 
 * The TutorialDemo component accepts a demoType prop with these values:
 * - 'board'
 * - 'vector'
 * - 'node'
 * - 'long-line'
 * - 'nexus'
 * 
 * File structure:
 * - React imports and TypeScript interfaces
 * - Helper functions (createTutorialDot, addTutorialStyles)
 * - Demo setup functions (setupBoardDemo, setupVectorDemo, etc.)
 * - Main TutorialDemo component
 * - Exports (default and named)
 * 
 * Migration notes:
 * - Moved from App.tsx as part of code cleanup
 * - All dependencies and functions are now self-contained
 * - Ready for import into App.tsx or other components
 * 
 * File: client/src/components/Demo.tsx
 * Created: Code cleanup and modularization
 */
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

// Create database connection
const dbPath = path.join(__dirname, 'flux_game.db');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Create users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          email_verified BOOLEAN DEFAULT FALSE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          wins INTEGER DEFAULT 0,
          losses INTEGER DEFAULT 0,
          draws INTEGER DEFAULT 0,
          current_streak INTEGER DEFAULT 0,
          streak_type TEXT DEFAULT 'none'
        )
      `, (err) => {
        if (err) {
          console.error('Error creating users table:', err);
          reject(err);
        } else {
          console.log('Database initialized successfully');
          resolve();
        }
      });
    });
  });
}

// User management functions
function createUser(email, username, password) {
  return new Promise(async (resolve, reject) => {
    try {
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      
      db.run(
        'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
        [email, username, passwordHash],
        function(err) {
          if (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
              reject(new Error('Email or username already exists'));
            } else {
              reject(err);
            }
          } else {
            resolve({
              id: this.lastID,
              email,
              username,
              wins: 0,
              losses: 0,
              draws: 0
            });
          }
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

function getUserByEmail(email) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM users WHERE email = ?',
      [email],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM users WHERE username = ?',
      [username],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

function getUserById(id) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, email, username, wins, losses, draws, created_at FROM users WHERE id = ?',
      [id],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function getUserStats(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT wins, losses, draws, current_streak, streak_type FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          const gamesPlayed = row.wins + row.losses + row.draws;
          const winRate = gamesPlayed > 0 ? ((row.wins / gamesPlayed) * 100).toFixed(1) : '0.0';
          
          resolve({
            gamesPlayed,
            wins: row.wins,
            losses: row.losses,
            draws: row.draws,
            winRate: parseFloat(winRate),
            currentStreak: row.current_streak,
            streakType: row.streak_type
          });
        }
      }
    );
  });
}

function updateUserStats(userId, result) {
  return new Promise((resolve, reject) => {
    let column;
    if (result === 'win') column = 'wins';
    else if (result === 'loss') column = 'losses';
    else if (result === 'draw') column = 'draws';
    else return reject(new Error('Invalid result'));

    // Get current stats first to calculate streak
    db.get(
      'SELECT current_streak, streak_type FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) return reject(err);
        
        let newStreak = 0;
        let newStreakType = 'none';
        
        if (row) {
          if (result === 'win') {
            if (row.streak_type === 'win') {
              newStreak = row.current_streak + 1;
            } else {
              newStreak = 1;
            }
            newStreakType = 'win';
          } else if (result === 'loss') {
            if (row.streak_type === 'loss') {
              newStreak = row.current_streak + 1;
            } else {
              newStreak = 1;
            }
            newStreakType = 'loss';
          } else { // draw
            newStreak = 0;
            newStreakType = 'none';
          }
        }

        db.run(
          `UPDATE users SET ${column} = ${column} + 1, current_streak = ?, streak_type = ? WHERE id = ?`,
          [newStreak, newStreakType, userId],
          function(err) {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      }
    );
  });
}

module.exports = {
  initializeDatabase,
  createUser,
  getUserByEmail,
  getUserByUsername,
  getUserById,
  verifyPassword,
  updateUserStats,
  getUserStats
}; 
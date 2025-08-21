import React from 'react';

// Authentication validation functions
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateUsername = (username: string): boolean => {
  const usernameRegex = /^[a-zA-Z][a-zA-Z0-9]{5,19}$/;
  return usernameRegex.test(username);
};

const validatePassword = (password: string): boolean => {
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*]/.test(password);
  const hasMinLength = password.length >= 8;
  
  return hasUppercase && hasLowercase && hasNumber && hasSpecialChar && hasMinLength;
};

const getPasswordStrengthMessage = (password: string): string => {
  const issues = [];
  if (password.length < 8) issues.push('at least 8 characters');
  if (!/[A-Z]/.test(password)) issues.push('one uppercase letter');
  if (!/[a-z]/.test(password)) issues.push('one lowercase letter');
  if (!/\d/.test(password)) issues.push('one number');
  if (!/[!@#$%^&*]/.test(password)) issues.push('one special character (!@#$%^&*)');
  
  return issues.length > 0 ? `Password must contain: ${issues.join(', ')}` : '';
};

// Helper function to get API URL
const getApiUrl = () => {
  return process.env.NODE_ENV === 'production' 
    ? process.env.REACT_APP_API_URL || 'https://web-production-7dd44.up.railway.app'
    : '';
};

// Authentication handler functions
const handleLogin = async (
  email: string, 
  password: string,
  setAuthError: (error: string) => void,
  setAuthState: (state: any) => void,
  setShowLogin: (show: boolean) => void,
  showToast: (message: string) => void
) => {
  try {
    setAuthError('');
    const response = await fetch(`${getApiUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      // Store token in localStorage
      localStorage.setItem('authToken', data.token);
      
      setAuthState({
        isAuthenticated: true,
        user: data.user,
        isGuest: false
      });
      setShowLogin(false);
      showToast(`Welcome back, ${data.user.username}!`);
    } else {
      setAuthError(data.error || 'Login failed');
    }
  } catch (error) {
    setAuthError('Connection error. Please try again.');
  }
};

const handleSignup = async (
  email: string, 
  username: string, 
  password: string,
  setAuthError: (error: string) => void,
  setAuthState: (state: any) => void,
  setShowSignup: (show: boolean) => void,
  showToast: (message: string) => void
) => {
  try {
    setAuthError('');
    
    // Validate inputs
    if (!validateEmail(email)) {
      setAuthError('Please enter a valid email address');
      return;
    }
    if (!validateUsername(username)) {
      setAuthError('Username must be 6-20 characters, start with a letter, and contain only letters and numbers');
      return;
    }
    if (!validatePassword(password)) {
      setAuthError(getPasswordStrengthMessage(password));
      return;
    }
    
    const response = await fetch(`${getApiUrl()}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      // Store token and automatically log the user in
      localStorage.setItem('authToken', data.token);
      
      setAuthState({
        isAuthenticated: true,
        user: data.user,
        isGuest: false
      });
      
      setShowSignup(false);
      showToast(`Welcome, ${data.user.username}! Account created successfully.`);
    } else {
      setAuthError(data.error || 'Signup failed');
    }
  } catch (error) {
    setAuthError('Connection error. Please try again.');
  }
};

const handlePlayAsGuest = (
  setAuthState: (state: any) => void,
  setShowMatchmaking: (show: boolean) => void
) => {
  setAuthState({
    isAuthenticated: false,
    user: null,
    isGuest: true
  });
  setShowMatchmaking(true);
};

const handleLogout = (
  setAuthState: (state: any) => void,
  setGameMode: (mode: 'local' | 'ai-1' | 'ai-2' | 'ai-3' | 'online') => void,
  resetGame: () => void,
  showToast: (message: string) => void
) => {
  // Clear stored token
  localStorage.removeItem('authToken');
  
  setAuthState({
    isAuthenticated: false,
    user: null,
    isGuest: false
  });
  
  setGameMode('local');
  resetGame();
  showToast('Logged out successfully');
};

const handleViewStats = async (
  authState: any,
  setShowStatsAuth: (show: boolean) => void,
  setStatsLoading: (loading: boolean) => void,
  setUserStats: (stats: any) => void,
  setShowStats: (show: boolean) => void,
  setToast: (toast: string) => void
) => {
  if (!authState.isAuthenticated) {
    setShowStatsAuth(true);
    return;
  }

  setStatsLoading(true);
  try {
    const token = localStorage.getItem('authToken');
    const response = await fetch(`${getApiUrl()}/api/auth/stats`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      setUserStats(data.stats);
      setShowStats(true);
    } else {
      setToast("New feature coming soon!");
      setTimeout(() => setToast(''), 3000);
    }
  } catch (error) {
    console.error('Error fetching stats:', error);
    setToast("New feature coming soon!");
    setTimeout(() => setToast(''), 3000);
  } finally {
    setStatsLoading(false);
  }
};

// Export all functions
export {
  validateEmail,
  validateUsername,
  validatePassword,
  getPasswordStrengthMessage,
  getApiUrl,
  handleLogin,
  handleSignup,
  handlePlayAsGuest,
  handleLogout,
  handleViewStats
};
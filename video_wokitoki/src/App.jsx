import { useState, useEffect } from 'react';
import Auth from './components/Auth';
import WalkieTalkie from './components/WalkieTalkie';
import { io } from 'socket.io-client';

// Initialize socket dynamically based on current host (supports proxy/Cloudflare)
const socketURL = window.location.hostname === 'localhost' && window.location.port === '5173' 
  ? 'http://localhost:3001' 
  : undefined; // Default connects to current host

const socket = io(socketURL, { 
  autoConnect: false 
});

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    // Check local storage for persistent login
    const token = localStorage.getItem('wt_token');
    const username = localStorage.getItem('wt_username');
    if (token && username) {
      setUser({ username, token });
      socket.connect();
      socket.emit('user-joined', { username });
    }
  }, []);

  const handleLogin = (username, token) => {
    localStorage.setItem('wt_token', token);
    localStorage.setItem('wt_username', username);
    setUser({ username, token });
    socket.connect();
    socket.emit('user-joined', { username });
  };

  const handleLogout = () => {
    localStorage.removeItem('wt_token');
    localStorage.removeItem('wt_username');
    setUser(null);
    socket.disconnect();
  };

  return (
    <div className="app-container">
      {!user ? (
        <Auth onLogin={handleLogin} />
      ) : (
        <WalkieTalkie user={user} socket={socket} onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;

import { useState } from 'react';
import { User, Lock, LogIn, UserPlus } from 'lucide-react';

export default function Auth({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const endpoint = isLogin ? '/api/login' : '/api/register';
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      // Check if response is JSON
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned non-JSON response. Is the server running?");
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Something went wrong');

      if (isLogin) {
        onLogin(data.username, data.token);
      } else {
        setIsLogin(true); // Switch to login after successful register
        alert('Registration successful! Please login.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-container glass-panel">
      <h1>{isLogin ? 'Welcome Back' : 'Join Comms'}</h1>
      
      {error && <div style={{ color: 'var(--danger)', textAlign: 'center' }}>{error}</div>}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div style={{ position: 'relative' }}>
          <User size={18} style={{ position: 'absolute', left: '12px', top: '20px', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Username" 
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ paddingLeft: '40px' }}
            required 
          />
        </div>
        <div style={{ position: 'relative' }}>
          <Lock size={18} style={{ position: 'absolute', left: '12px', top: '20px', color: 'var(--text-muted)' }} />
          <input 
            type="password" 
            placeholder="Password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ paddingLeft: '40px' }}
            required 
          />
        </div>

        <button type="submit" className="btn-primary" style={{ marginTop: '10px' }}>
          {isLogin ? <><LogIn size={20} /> Login</> : <><UserPlus size={20} /> Register</>}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: '10px', color: 'var(--text-muted)' }}>
        {isLogin ? "Don't have an account? " : "Already have an account? "}
        <a 
          href="#" 
          onClick={(e) => { e.preventDefault(); setIsLogin(!isLogin); setError(null); }}
          style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 'bold' }}
        >
          {isLogin ? "Register" : "Login"}
        </a>
      </div>
    </div>
  );
}

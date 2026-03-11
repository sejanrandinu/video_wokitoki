import { useEffect, useRef, useState } from 'react';
import { LogOut, Mic, Users, Video, VideoOff, MicOff, Settings, CheckCircle } from 'lucide-react';

export default function WalkieTalkie({ user, socket, onLogout }) {
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [isReceivingCall, setIsReceivingCall] = useState(null); // caller username
  const [isTransmitting, setIsTransmitting] = useState(false);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);

  useEffect(() => {
    // Listen for online users
    socket.on('online-users', (users) => {
      // Filter out self
      const others = users.filter(u => u.username !== user.username);
      setOnlineUsers(others);
    });

    socket.on('incoming-call', ({ callerUsername }) => {
      setIsReceivingCall(callerUsername);
    });

    socket.on('call-ended', () => {
      endCall(false);
    });

    // WebRTC Signaling handlers
    socket.on('webrtc-offer', async ({ offer, callerUsername }) => {
      setSelectedUser(callerUsername);
      await createPeerConnection(callerUsername);
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      socket.emit('webrtc-answer', { targetUsername: callerUsername, answer, answererUsername: user.username });
      setIsConnected(true);
      setIsReceivingCall(null);
    });

    socket.on('webrtc-answer', async ({ answer }) => {
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      setIsConnected(true);
      setIsCalling(false);
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding received ice candidate', e);
        }
      }
    });

    // Initialize local media
    initLocalMedia();

    return () => {
      socket.off('online-users');
      socket.off('incoming-call');
      socket.off('call-ended');
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('ice-candidate');
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);

  const initLocalMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      // Start with tracks disabled until PTT is pressed
      setStreamEnabled(false);
    } catch (err) {
      console.error('Failed to access media devices', err);
      alert('Camera and microphone access is required.');
    }
  };

  const setStreamEnabled = (enabled) => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.enabled = enabled;
      });
      setIsTransmitting(enabled);
    }
  };

  const createPeerConnection = async (targetUser) => {
    // STUN servers for WebRTC
    const rtcConfig = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { targetUsername: targetUser, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }
  };

  const initiateCall = async () => {
    if (!selectedUser) return alert('Select a user first');
    setIsCalling(true);
    socket.emit('initiate-call', { targetUsername: selectedUser, callerUsername: user.username });
    
    await createPeerConnection(selectedUser);
    const offer = await peerConnectionRef.current.createOffer();
    await peerConnectionRef.current.setLocalDescription(offer);
    
    socket.emit('webrtc-offer', { targetUsername: selectedUser, offer, callerUsername: user.username });
  };

  const answerCall = async () => {
    // Handled in socket.on('webrtc-offer') directly for now via auto-answer
    // But realistically the user should click "Accept"
    // For simplicity, we auto connect WebRTC behind the scenes, and just show UI changes
  };

  const endCall = (emit = true) => {
    if (emit && selectedUser) {
      socket.emit('call-ended', { targetUsername: selectedUser });
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setIsConnected(false);
    setIsCalling(false);
    setIsReceivingCall(null);
  };

  const handlePttDown = () => {
    if (isConnected) setStreamEnabled(true);
  };

  const handlePttUp = () => {
    if (isConnected) setStreamEnabled(false);
  };

  return (
    <div className="app-container" style={{ padding: '0px' }}>
      
      {/* Top Navigation */}
      <div className="header glass-panel" style={{ borderRadius: '0 0 20px 20px', borderTop: 'none' }}>
        <div className="header-brand">
          <Settings size={28} />
          <span>Comms Engine</span>
        </div>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
            <div className="status-dot"></div>
            {user.username}
          </div>
          <button onClick={onLogout} className="btn-danger" style={{ padding: '8px 16px', fontSize: '14px' }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>

      <div className="wt-layout">
        
        {/* Sidebar: Online Users */}
        <div className="users-list-panel glass-panel">
          <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={20} color="var(--primary)" /> Directory
          </h2>
          <div className="online-users-list">
            {onlineUsers.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>
                No active operators
              </div>
            ) : (
              onlineUsers.map((u) => (
                <div 
                  key={u.username} 
                  className={`user-item ${selectedUser === u.username ? 'active' : ''}`}
                  onClick={() => !isConnected && setSelectedUser(u.username)}
                >
                  <div className="user-info">
                    <div className="status-dot"></div>
                    <strong>{u.username}</strong>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Main Video & Controls Panel */}
        <div className="main-comms-panel">
          <div className="video-grid glass-panel" style={{ padding: '20px', minHeight: '400px' }}>
            
            {/* Local Video */}
            <div className="video-card">
              <video ref={localVideoRef} autoPlay muted playsInline></video>
              <div className="video-label">
                {isTransmitting ? <Video size={16} color="var(--success)"/> : <VideoOff size={16} color="var(--danger)"/>}
                {isTransmitting ? <Mic size={16} color="var(--success)"/> : <MicOff size={16} color="var(--danger)"/>}
                You (TX)
              </div>
            </div>

            {/* Remote Video */}
            <div className="video-card">
              {isConnected ? (
                <video ref={remoteVideoRef} autoPlay playsInline></video>
              ) : (
                <div style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', color: 'var(--text-muted)' }}>
                  <Users size={48} opacity={0.5} style={{ marginBottom: '10px' }} />
                  <p>{isCalling ? 'Calling...' : isReceivingCall ? `Incoming from ${isReceivingCall}` : 'Channel Standby'}</p>
                </div>
              )}
              <div className="video-label" style={{ right: '16px', left: 'auto' }}>
                <CheckCircle size={16} color={isConnected ? "var(--success)" : "var(--text-muted)"} />
                RX {isConnected && `- ${selectedUser}`}
              </div>
            </div>
            
          </div>

          {/* Connection Controls & PTT */}
          <div className="controls-panel glass-panel">
            {!isConnected ? (
              <div style={{ display: 'flex', gap: '20px' }}>
                <button 
                  className="btn-primary" 
                  onClick={initiateCall} 
                  disabled={!selectedUser || isCalling}
                  style={{ width: '200px' }}
                >
                  {isCalling ? 'Connecting...' : 'Secure Channel'}
                </button>
                {isReceivingCall && (
                  <button className="btn-success" onClick={() => setIsConnected(true)}>
                    Accept Codec
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
                <button className="btn-danger" onClick={endCall} style={{ padding: '12px 20px', height: '48px' }}>
                  End Auth
                </button>
                
                {/* BIG PUSH TO TALK BUTTON */}
                <button 
                  className={`ptt-button ${isTransmitting ? 'active' : ''}`}
                  onMouseDown={handlePttDown}
                  onMouseUp={handlePttUp}
                  onMouseLeave={handlePttUp}
                  onTouchStart={handlePttDown}
                  onTouchEnd={handlePttUp}
                >
                  <Mic size={32} />
                  <span>PTT</span>
                </button>
                
                <div style={{ color: 'var(--text-muted)', width: '100px', textAlign: 'center' }}>
                  {isTransmitting ? (
                    <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>TX ACTIVE</span>
                  ) : (
                    <span>HOLD TO TALK</span>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

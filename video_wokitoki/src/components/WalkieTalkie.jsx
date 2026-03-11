import { useEffect, useRef, useState } from 'react';
import { LogOut, Mic, Users, Video, VideoOff, MicOff, Settings, CheckCircle } from 'lucide-react';

export default function WalkieTalkie({ user, socket, onLogout }) {
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]); // Multiple selection for groups
  const [isConnected, setIsConnected] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [isReceivingCall, setIsReceivingCall] = useState(null); // { callerUsername, participants, callMode }
  
  const [callMode, setCallMode] = useState('ptt'); // 'ptt' or 'video'
  const [activeParticipants, setActiveParticipants] = useState([]); // Users currently in call
  
  // Media States (Separate controls)
  const [camEnabled, setCamEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  // PTT state overrides mic when in PTT mode
  const [isPttPressed, setIsPttPressed] = useState(false);

  // Refs for tracking
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnections = useRef(new Map()); // Map username -> RTCPeerConnection
  const remoteStreams = useRef(new Map()); // Map username -> MediaStream
  const pendingCandidates = useRef(new Map()); // Map username -> Array of RTCIceCandidate

  // To trigger rerender when remote streams change
  const [streamCount, setStreamCount] = useState(0);

  useEffect(() => {
    socket.on('online-users', (users) => {
      const others = users.filter(u => u.username !== user.username);
      setOnlineUsers(others);
    });

    socket.on('incoming-group-call', ({ callerUsername, participants, callMode: incomingCallMode }) => {
      setIsReceivingCall({ callerUsername, participants, callMode: incomingCallMode });
    });

    socket.on('user-left-group', ({ leaverUsername }) => {
      endConnectionWithUser(leaverUsername);
      setActiveParticipants(prev => {
        const next = prev.filter(u => u !== leaverUsername);
        if (next.length === 0) endCall(false); // End call if no one is left
        return next;
      });
    });

    socket.on('webrtc-offer', async ({ offer, callerUsername }) => {
      if (!peerConnections.current.has(callerUsername)) {
        await createPeerConnection(callerUsername);
      }
      const pc = peerConnections.current.get(callerUsername);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socket.emit('webrtc-answer', { targetUsername: callerUsername, answer, answererUsername: user.username });

      // Drain queued candidates
      const queue = pendingCandidates.current.get(callerUsername) || [];
      queue.forEach(c => pc.addIceCandidate(c).catch(console.error));
      pendingCandidates.current.set(callerUsername, []);
    });

    socket.on('webrtc-answer', async ({ answer, answererUsername }) => {
      const pc = peerConnections.current.get(answererUsername);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));

        // Drain queued candidates
        const queue = pendingCandidates.current.get(answererUsername) || [];
        queue.forEach(c => pc.addIceCandidate(c).catch(console.error));
        pendingCandidates.current.set(answererUsername, []);
      }
    });

    socket.on('ice-candidate', async ({ candidate, senderUsername }) => {
      try {
        const iceCandidate = new RTCIceCandidate(candidate);
        const pc = peerConnections.current.get(senderUsername);
        
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(iceCandidate);
        } else {
          // If connection isn't fully ready, store the candidate
          const queue = pendingCandidates.current.get(senderUsername) || [];
          queue.push(iceCandidate);
          pendingCandidates.current.set(senderUsername, queue);
        }
      } catch (e) {
        console.error('Error adding ice candidate', e);
      }
    });

    initLocalMedia();

    return () => {
      socket.off('online-users');
      socket.off('incoming-group-call');
      socket.off('user-left-group');
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('ice-candidate');
      
      endCall(true);
    };
  }, []); // Run once

  const toggleUserSelection = (username) => {
    if (isConnected) return;
    setSelectedUsers(prev => 
      prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username]
    );
  };

  const initLocalMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      updateLocalTracksState(); // Mute/Unmute according to initial state
    } catch (err) {
      console.error('Media required', err);
    }
  };

  // Centralized media controller to update what is sent over the wire
  useEffect(() => {
    updateLocalTracksState();
  }, [camEnabled, micEnabled, isPttPressed, callMode, isConnected]);

  const updateLocalTracksState = () => {
    if (!localStreamRef.current) return;
    
    // Video: Controlled by camEnabled
    localStreamRef.current.getVideoTracks().forEach(track => {
      track.enabled = camEnabled && isConnected;
    });

    // Audio: If video mode = micEnabled. If PTT mode = micEnabled AND PTT is pressed.
    const isTransmittingAudio = isConnected && micEnabled && (callMode === 'video' || isPttPressed);
    
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = isTransmittingAudio;
    });
  };

  const createPeerConnection = async (targetUser) => {
    if (!localStreamRef.current) await initLocalMedia();

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    peerConnections.current.set(targetUser, pc);
    pendingCandidates.current.set(targetUser, []);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { targetUsername: targetUser, candidate: event.candidate, senderUsername: user.username });
      }
    };

    pc.ontrack = (event) => {
      remoteStreams.current.set(targetUser, event.streams[0]);
      setStreamCount(prev => prev + 1); // trigger rerender
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }
    
    return pc;
  };

  // Mesh Logic: A user calls multiple users. Every user must connect with every other active user.
  const initiateCall = async () => {
    if (selectedUsers.length === 0) return alert('Select at least one operator');
    setIsCalling(true);
    
    const groupId = Math.random().toString(36).substring(7); // Simple group ID
    socket.emit('initiate-group-call', { 
        targetUsernames: selectedUsers, 
        callerUsername: user.username, 
        groupId,
        callMode
    });
    
    const parts = [user.username, ...selectedUsers];
    setActiveParticipants(selectedUsers);
    
    // Create offers and Connections for everyone we selected
    for (const targetUser of selectedUsers) {
        const pc = await createPeerConnection(targetUser);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', { targetUsername: targetUser, offer, callerUsername: user.username });
    }

    setIsConnected(true);
    setIsCalling(false);
  };

  const answerCall = async () => {
    if (!isReceivingCall) return;
    
    setCallMode(isReceivingCall.callMode); // Adopt caller's mode
    setIsConnected(true);
    setIsReceivingCall(null);
    
    const others = isReceivingCall.participants.filter(p => p !== user.username);
    setActiveParticipants(others);
    
    // To prevent offer collision in a Mesh, only the user with "lower" username sends the new offers to other participants.
    // However, the caller already sent offers to everyone. 
    // We only need to connect to other RECEIVERS we haven't connected to.
    for (const targetUser of others) {
        if (targetUser === isReceivingCall.callerUsername) continue; // Will be handled by incoming offer
        
        // Dictionary order tie-breaker
        if (user.username < targetUser) {
            const pc = await createPeerConnection(targetUser);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('webrtc-offer', { targetUsername: targetUser, offer, callerUsername: user.username });
        }
    }
  };

  const endConnectionWithUser = (targetUsername) => {
    const pc = peerConnections.current.get(targetUsername);
    if (pc) {
      pc.close();
      peerConnections.current.delete(targetUsername);
    }
    remoteStreams.current.delete(targetUsername);
    setStreamCount(prev => prev - 1);
  };

  const endCall = (emit = true) => {
    if (emit && isConnected && activeParticipants.length > 0) {
      socket.emit('end-group-call', { participants: activeParticipants, leaverUsername: user.username });
    }
    
    // Close all peer connections
    Array.from(peerConnections.current.values()).forEach(pc => pc.close());
    peerConnections.current.clear();
    remoteStreams.current.clear();
    setStreamCount(0);
    
    setActiveParticipants([]);
    setIsConnected(false);
    setIsCalling(false);
    setIsReceivingCall(null);
  };

  // Render logic for multiple video streams
  const ArrayOfRemoteStreams = Array.from(remoteStreams.current.entries());

  return (
    <div className="app-container" style={{ padding: '0px' }}>
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
                  className={`user-item ${selectedUsers.includes(u.username) ? 'active' : ''}`}
                  onClick={() => toggleUserSelection(u.username)}
                  style={{ opacity: isConnected ? 0.5 : 1 }}
                >
                  <div className="user-info">
                    <div className="status-dot"></div>
                    <strong>{u.username}</strong>
                  </div>
                  {selectedUsers.includes(u.username) && <CheckCircle size={16} color="var(--primary)" />}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="main-comms-panel">
          <div className="video-grid glass-panel" style={{ padding: '20px', minHeight: '400px' }}>
            
            <div className="video-card">
              <video ref={localVideoRef} autoPlay muted playsInline></video>
              <div className="video-label" style={{ background: 'rgba(0,0,0,0.8)' }}>
                {camEnabled ? <Video size={16} color="var(--success)"/> : <VideoOff size={16} color="var(--danger)"/>}
                
                {callMode === 'ptt' ? (
                   isPttPressed && micEnabled ? <Mic size={16} color="var(--success)"/> : <MicOff size={16} color="var(--danger)"/>
                ) : (
                   micEnabled ? <Mic size={16} color="var(--success)"/> : <MicOff size={16} color="var(--danger)"/>
                )}
                You (TX)
              </div>
            </div>

            {ArrayOfRemoteStreams.length === 0 && !isReceivingCall ? (
              <div className="video-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text-muted)' }}>
                <Users size={48} opacity={0.5} style={{ marginBottom: '10px' }} />
                <p>{isCalling ? 'Connecting to Group...' : 'Channel Standby'}</p>
              </div>
            ) : null}

            {isReceivingCall && !isConnected && (
              <div className="video-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <p style={{ marginBottom: '20px', fontSize: '1.2rem' }}>
                  Group {isReceivingCall.callMode === 'video' ? 'Video Call' : 'Walkie-Talkie'} 
                  <br/>from <strong style={{ color: 'var(--primary)' }}>{isReceivingCall.callerUsername}</strong>
                </p>
                <button className="btn-success" onClick={answerCall}>Accept Channel</button>
              </div>
            )}

            {ArrayOfRemoteStreams.map(([username, stream]) => (
              <div className="video-card" key={username}>
                <video 
                  autoPlay 
                  playsInline 
                  ref={el => { if (el && stream) el.srcObject = stream }}
                ></video>
                <div className="video-label" style={{ right: '16px', left: 'auto' }}>
                  <CheckCircle size={16} color="var(--success)" />
                  RX - {username}
                </div>
              </div>
            ))}
          </div>

          <div className="controls-panel glass-panel">
            {!isConnected ? (
              <div style={{ display: 'flex', gap: '20px', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <div className="mode-selection-buttons">
                  <button 
                    className={callMode === 'ptt' ? 'btn-primary' : 'btn-danger'} 
                    onClick={() => setCallMode('ptt')}
                    style={{ background: callMode !== 'ptt' ? 'rgba(255,255,255,0.1)' : '' }}
                  >
                    Walkie-Talkie Group
                  </button>
                  <button 
                    className={callMode === 'video' ? 'btn-primary' : 'btn-danger'} 
                    onClick={() => setCallMode('video')}
                    style={{ background: callMode !== 'video' ? 'rgba(255,255,255,0.1)' : '' }}
                  >
                    Video Call Group
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '20px' }}>
                  <button 
                    className="btn-success" 
                    onClick={initiateCall} 
                    disabled={selectedUsers.length === 0 || isCalling}
                    style={{ width: '300px' }}
                  >
                    {isCalling ? 'Connecting...' : `Connect Secure Channel (${selectedUsers.length})`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="active-controls-wrapper">
                
                <div className="cam-mic-wrapper">
                  <button 
                    onClick={() => setCamEnabled(!camEnabled)}
                    style={{ 
                      width: '60px', height: '60px', borderRadius: '30px', border: 'none',
                      background: camEnabled ? 'rgba(0,0,0,0.5)' : 'var(--danger)',
                      color: 'white', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
                    }}
                  >
                    {camEnabled ? <Video size={20} /> : <VideoOff size={20} />}
                    <span style={{ fontSize: '10px', marginTop: '2px' }}>Cam</span>
                  </button>

                  {/* Independent Mic Mute (Applies to both PTT and Video modes) */}
                  <button 
                    onClick={() => setMicEnabled(!micEnabled)}
                    style={{ 
                      width: '60px', height: '60px', borderRadius: '30px', border: 'none',
                      background: micEnabled ? 'rgba(0,0,0,0.5)' : 'var(--danger)',
                      color: 'white', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
                    }}
                  >
                    {micEnabled ? <Mic size={20} /> : <MicOff size={20} />}
                    <span style={{ fontSize: '10px', marginTop: '2px' }}>Mic</span>
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '40px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {callMode === 'ptt' && (
                    <div className="ptt-wrapper">
                      <button 
                        className={`ptt-button ${isPttPressed ? 'active' : ''}`}
                        onMouseDown={() => { if (isConnected) setIsPttPressed(true); }}
                        onMouseUp={() => { if (isConnected) setIsPttPressed(false); }}
                        onMouseLeave={() => { if (isConnected) setIsPttPressed(false); }}
                        onTouchStart={() => { if (isConnected) setIsPttPressed(true); }}
                        onTouchEnd={() => { if (isConnected) setIsPttPressed(false); }}
                        onContextMenu={(e) => e.preventDefault()}
                        style={{ opacity: !micEnabled ? 0.5 : 1, pointerEvents: !micEnabled ? 'none' : 'auto' }}
                      >
                        <Mic size={32} />
                        <span>PTT</span>
                      </button>
                      <div style={{ color: 'var(--text-muted)', width: '150px', textAlign: 'center' }}>
                        {!micEnabled ? (
                          <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>MIC MUTED</span>
                        ) : isPttPressed ? (
                          <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>BROADCASTING</span>
                        ) : (
                          <span>HOLD TO TALK</span>
                        )}
                      </div>
                    </div>
                  )}

                  {callMode === 'video' && (
                    <div style={{ color: 'var(--text-muted)', width: '150px', textAlign: 'center' }}>
                      <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '1.2rem' }}>LIVE GROUP CALL</span>
                      <br/>
                      <span>({activeParticipants.length + 1} operators)</span>
                    </div>
                  )}

                  <button className="btn-danger" onClick={() => endCall(true)} style={{ padding: '12px 20px', height: '48px', fontSize: '16px' }}>
                    End Protocol
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

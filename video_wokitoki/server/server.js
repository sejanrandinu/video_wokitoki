const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Simple setup for Socket.IO with CORS enabling connections from our React Vite app
const io = new Server(server, {
    cors: {
        origin: '*', // For development. In production, provide explicit URL.
        methods: ['GET', 'POST']
    }
});

const JWT_SECRET = 'super-secret-key-change-me-later';

// API Endpoints for Authentication
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Username already taken' });
                }
                return res.status(500).json({ error: 'Database error' });
            }
            res.status(201).json({ message: 'User registered successfully', userId: this.lastID });
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error during registration' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(400).json({ error: 'User not found' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid password' });

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, username: user.username, userId: user.id });
    });
});

// Map socket.id -> { username, userId }
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Register user session with socket
    socket.on('user-joined', (userData) => {
        connectedUsers.set(socket.id, userData);
        console.log(`User ${userData.username} joined.`);
        io.emit('online-users', Array.from(connectedUsers.values()));
    });

    // Mesh WebRTC Signaling routing by username
    socket.on('webrtc-offer', ({ targetUsername, offer, callerUsername }) => {
        const targetSocketId = [...connectedUsers.entries()].find(([id, user]) => user.username === targetUsername)?.[0];
        if (targetSocketId) {
            io.to(targetSocketId).emit('webrtc-offer', { offer, callerUsername });
        }
    });

    socket.on('webrtc-answer', ({ targetUsername, answer, answererUsername }) => {
        const targetSocketId = [...connectedUsers.entries()].find(([id, user]) => user.username === targetUsername)?.[0];
        if (targetSocketId) {
            io.to(targetSocketId).emit('webrtc-answer', { answer, answererUsername });
        }
    });

    socket.on('ice-candidate', ({ targetUsername, candidate, senderUsername }) => {
        const targetSocketId = [...connectedUsers.entries()].find(([id, user]) => user.username === targetUsername)?.[0];
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice-candidate', { candidate, senderUsername });
        }
    });

    // Group Call Initiation
    socket.on('initiate-group-call', ({ targetUsernames, callerUsername, groupId, callMode }) => {
        // Find socket IDs of all target users
        targetUsernames.forEach(targetUsername => {
            const targetSocketId = [...connectedUsers.entries()].find(([id, user]) => user.username === targetUsername)?.[0];
            if (targetSocketId) {
                // Send the invite with the full participant list so they can mesh connect
                io.to(targetSocketId).emit('incoming-group-call', { 
                    callerUsername, 
                    groupId, 
                    callMode,
                    participants: [callerUsername, ...targetUsernames] 
                });
            }
        });
    });

    socket.on('end-group-call', ({ participants, leaverUsername }) => {
        // A user ended their participation, notify others to close their peer connection
        participants.forEach(targetUsername => {
            if (targetUsername === leaverUsername) return;
            const targetSocketId = [...connectedUsers.entries()].find(([id, user]) => user.username === targetUsername)?.[0];
            if (targetSocketId) {
                io.to(targetSocketId).emit('user-left-group', { leaverUsername });
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const user = connectedUsers.get(socket.id);
        if (user) {
            io.emit('user-left-group', { leaverUsername: user.username });
        }
        connectedUsers.delete(socket.id);
        io.emit('online-users', Array.from(connectedUsers.values()));
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

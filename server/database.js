const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to SQLite database
// Priority: Glitch (.data), Docker/HF (/data), Local (./)
let dbPath;
if (process.env.PROJECT_DOMAIN) {
    dbPath = path.resolve(__dirname, '../.data/database.sqlite');
} else if (require('fs').existsSync('/data')) {
    dbPath = '/data/database.sqlite';
} else {
    dbPath = path.resolve(__dirname, 'database.sqlite');
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        // Initialize tables
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Error creating users table:', err.message);
            } else {
                console.log('Users table ready.');
            }
        });
    }
});

module.exports = db;

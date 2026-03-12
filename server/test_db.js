const db = require('./database');
const bcrypt = require('bcrypt');

async function test() {
    const username = 'testuser' + Date.now();
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function(err) {
        if (err) {
            console.error('Test failed:', err.message);
        } else {
            console.log('Test successful, user ID:', this.lastID);
        }
        process.exit(0);
    });
}

test();

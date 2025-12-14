const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('stats.json');
const db = low(adapter);

// Initialize DB safely
db.defaults({
    users: [], // Array of { id, username, joinedAt }
    logins: [] // Array of { userId, timestamp }
}).write();

module.exports = {
    // Register a user if they are new
    registerUser: (user) => {
        const existing = db.get('users').find({ id: user.id }).value();
        if (!existing) {
            db.get('users').push({
                id: user.id,
                username: user.username,
                firstName: user.first_name,
                joinedAt: new Date().toISOString()
            }).write();
            console.log(`[STATS] New User Registered: ${user.first_name} (${user.id})`);
            return true; // New user
        }
        return false; // Existing user
    },

    // Log a "login" (start command)
    logInteraction: (userId) => {
        db.get('logins').push({
            userId: userId,
            timestamp: new Date().toISOString()
        }).write();
    },

    // Get Analytics
    getStats: () => {
        const totalUsers = db.get('users').size().value();
        const totalInteractions = db.get('logins').size().value();
        // Calculate active users today
        const todayStr = new Date().toISOString().split('T')[0];
        const activeToday = db.get('logins')
            .filter(l => l.timestamp && l.timestamp.startsWith(todayStr))
            .map('userId')
            .uniq()
            .size()
            .value();

        return {
            totalUsers,
            totalInteractions,
            activeToday
        };
    },

    getRecentUsers: (limit = 5) => {
        return db.get('users').takeRight(limit).value();
    }
};

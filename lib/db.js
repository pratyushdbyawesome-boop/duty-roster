const { Redis } = require('@upstash/redis');

function getRedis() {
    return Redis.fromEnv();
}

module.exports = { getRedis };

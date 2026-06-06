const redis = require('redis')

const redisClient = redis.createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
})

const maxTokens = 10
const tokenRate = maxTokens / 60000 // tokens per millisecond

async function rateLimit(req, res, next) {
    const ip = req.ip

    const currentTime = Date.now()
    const key = `rate_limit:${ip}`

    let bucket
    const exists = await redisClient.exists(key)
    if (!exists) {
        bucket = { tokens: maxTokens, lastTime: currentTime }
    } else {
        bucket = await redisClient.hGetAll(key)
    }

    const elapsed = currentTime - Number(bucket.lastTime)
    bucket.tokens = Math.min(Number(bucket.tokens) + elapsed * tokenRate, maxTokens)
    bucket.lastTime = currentTime

    if (bucket.tokens >= 1) {
        bucket.tokens -= 1
        await redisClient.hSet(key, bucket)
        await redisClient.expire(key, 60)
        next()
    } else {
        await redisClient.hSet(key, bucket)
        await redisClient.expire(key, 60)
        res.status(429).send("TOO MANY REQUESTS\n")
    }
}

module.exports = { redisClient, rateLimit }

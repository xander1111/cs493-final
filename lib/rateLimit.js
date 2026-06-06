const { application } = require('express')
const redis = require('redis')

const redisHost = process.env.REDIS_HOST
const redisPort = process.env.REDIS_PORT

const redisClient = redis.createClient({
    url: `redis://${redisHost}:${redisPort}`
})

module.exports = { redisClient }
const express = require('express');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const { redisClient, rateLimit } = require('./lib/rateLimit')

const api = require('./api');

const { connectToDb, getDbReference } = require('./lib/mongo');

const app = express();
const port = process.env.PORT || 8000;

async function seedAdmin() {
    const email = process.env.ADMIN_EMAIL || 'admin@test.com';
    const password = process.env.ADMIN_PASSWORD || 'adminpass';

    const users = getDbReference().collection('users');
    const existing = await users.findOne({ email });
    if (existing) return;

    const hashed = await bcrypt.hash(password, 8);
    await users.insertOne({ name: 'Admin', email, password: hashed, role: 'admin' });
    console.log(`Seeded admin user: ${email}`);
}

connectToDb(async () => {
    await seedAdmin();
    await redisClient.connect();

    app.listen(port, () => {
        console.log(`Server is listening on port ${port}`);
    });
});


/*
 * Morgan is a popular logger.
 */
app.use(morgan('dev'));

app.use(express.json());
app.use(express.static('public'));

/*
 * All routes for the API are written in modules in the api/ directory.  The
 * top-level router lives in api/index.js.  That's what we include here, and
 * it provides all of the routes.
 */
app.use(rateLimit);
app.use('/', api);

app.use(function (req, res, next) {
    res.status(404).json({
        error: "Requested resource " + req.originalUrl + " does not exist"
    });
});

/*
 * This route will catch any errors thrown from our API endpoints and return
 * a response with a 500 status to the client.
 */
app.use(function (err, req, res, next) {
    console.error("== Error:", err)
    res.status(500).send({
        err: "Server error.  Please try again later."
    })
})


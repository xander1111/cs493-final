const router = require('express').Router();
const { ObjectId } = require('mongodb');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { validateAgainstSchema, extractValidFields } = require('../lib/validation');
const { requireAuthorization, tryAuthorization } = require('../lib/auth');
const { getDbReference } = require('../lib/mongo');

exports.router = router;

const userSchema = {
    name: { required: true },
    email: { required: true },
    password: { required: true },
    role: { required: true }
};

const loginSchema = {
    email: { required: true },
    password: { required: true },
}

/*
 * Route to create a new user account
 */
router.post('/', tryAuthorization, async function (req, res, next) {
    if (validateAgainstSchema(req.body, userSchema)) {
        const collection = getDbReference().collection("users");

        const newUser = extractValidFields(req.body, userSchema);

        if (!req.locals.isAdmin && newUser.role !== 'student') {
            res.status(403).json({
                "error": "user not authenticated to create this type of user"
            });
            return;
        }

        const emailInUse = await collection.findOne({ email: newUser.email });
        if (emailInUse) {
            res.status(409).json({
                "error": "email already in use"  // Does give away some info; provides a way to enumerate emails in use. Could be solved by instead always returning the same message (something like 'check your email for a verification code/link') and only sending an email if it's not already in use
            });
            return;
        }

        const hashedPass = await bcrypt.hash(newUser.password, 8);

        const result = await collection.insertOne({
            name: newUser.name,
            email: newUser.email,
            password: hashedPass,
            role: newUser.role
        });

        res.status(200).json({
            "status": "ok",
            "id": result.insertedId
        });
    } else {
        res.status(400).json({
            "error": "Request body is not a valid user object"
        });
    }
});

router.post('/login', async function (req, res, next) {
    if (validateAgainstSchema(req.body, loginSchema)) {
        const collection = getDbReference().collection("users");
        const loginDetails = extractValidFields(req.body, loginSchema);

        const user = await collection.findOne({ email: loginDetails.email });
        if (!user) {
            res.status(401).json({
                "error": "invalid login"
            });
            return;
        }

        const password_hash = user.password;

        const valid_login = await bcrypt.compare(loginDetails.password, password_hash);

        if (valid_login) {
            const payload = { "userid": user._id, "role": user.role };
            const expiration = { "expiresIn": "24h" };
            const token = jwt.sign(payload, process.env.JWT_SECRET_KEY, expiration);

            res.status(200).json({
                "status": "ok",
                "token": token
            });
        } else {
            res.status(401).json({
                "error": "invalid login"
            });
        }

    } else {
        res.status(400).json({
            "error": "Request body is not a valid login object"
        });
    }
});

router.get('/:userid', requireAuthorization, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.userid)) {
        res.status(400).json({
            error: "Invalid userid"
        });
        return;
    }

    const userid = new ObjectId(req.params.userid);

    if (req.locals.userid !== userid.toString() && !req.locals.isAdmin) {
        res.status(401).json({
            "error": "user not authorized to access this resource"
        });
        return;
    }

    const collection = getDbReference().collection("users");
    const coursesCollection = getDbReference().collection("courses");

    const user = await collection.findOne({ _id: userid });
    if (user) {
        let courses = [];
	if (user.role === "student") {
	    courses = await coursesCollection
	        .find({ students: userid })
		.project({ _id: 1 })
		.toArray();
	} else {
	    courses = await coursesCollection
		.find({ instructorid: userid })
		.project({ _id: 1 })
		.toArray();
        }
	res.status(200).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
	    courses: courses.map(c => c._id)
        });
    } else {
        next();
    }
});

const router = require('express').Router();
const { ObjectId } = require('mongodb');

const { validateAgainstSchema, extractValidFields } = require('../lib/validation');
const { requireAuthorization, tryAuthorization } = require('../lib/auth');
const { getDbReference } = require('../lib/mongo');

exports.router = router;

const courseSchema = {
    instructorid: { required: true },
    subject: { required: true },
    number: { required: true },
    title: { required: true },
    term: { required: true },
};

router.get('/', function (req, res, next) {
    // TODO
});

router.post('/', function (req, res, next) {
    // TODO
});

router.get('/:courseid', function (req, res, next) {
    // TODO
});

router.patch('/:courseid', function (req, res, next) {
    // TODO
});

router.delete('/:courseid', function (req, res, next) {
    // TODO
});

router.get('/:courseid/students', function (req, res, next) {
    // TODO
});

router.post('/:courseid/students', function (req, res, next) {
    // TODO
});

router.get('/:courseid/roster', function (req, res, next) {
    // TODO
});

router.get('/:courseid/assignments', function (req, res, next) {
    // TODO
});


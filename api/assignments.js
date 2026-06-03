const router = require('express').Router();
const { ObjectId } = require('mongodb');

const { validateAgainstSchema, extractValidFields } = require('../lib/validation');
const { requireAuthorization, tryAuthorization } = require('../lib/auth');
const { getDbReference } = require('../lib/mongo');

exports.router = router;

const assignmentSchema = {
    courseid: { required: true },
    title: { required: true },
    points: { required: true },
    due: { required: true }
};

router.post('/', function (req, res, next) {
    // TODO
});

router.get('/:assignmentid', function (req, res, next) {
    // TODO
});

router.patch('/:assignmentid', function (req, res, next) {
    // TODO
});

router.delete('/:assignmentid', function (req, res, next) {
    // TODO
});

router.get('/:assignmentid/submissions', function (req, res, next) {
    // TODO
});

router.post('/:assignmentid/submissions', function (req, res, next) {
    // TODO
});

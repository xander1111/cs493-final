const router = require('express').Router();
const { ObjectId } = require('mongodb');
const multer = require('multer');

const { validateAgainstSchema, extractValidFields } = require('../lib/validation');
const { requireAuthorization } = require('../lib/auth');
const { getDbReference, getAssignmentsBucket, getAssignmentsFilesCollection } = require('../lib/mongo');

exports.router = router;

const assignmentSchema = {
    courseId: { required: true },
    title: { required: true },
    points: { required: true },
    due: { required: true }
};

const upload = multer({ storage: multer.memoryStorage() });


async function isInstructorOrAdmin(req, courseId) {
    if (req.locals.isAdmin) return true;
    if (req.locals.role !== 'instructor') return false;
    const course = await getDbReference().collection('courses').findOne({ _id: courseId });
    return course && course.instructorid && course.instructorid.toString() === req.locals.userid;
}


router.post('/', requireAuthorization, async function (req, res, next) {
    if (!validateAgainstSchema(req.body, assignmentSchema)) {
        return res.status(400).json({ error: "Request body is not a valid assignment object" });
    }

    const body = extractValidFields(req.body, assignmentSchema);

    if (!ObjectId.isValid(body.courseId)) {
        return res.status(400).json({ error: "Invalid courseId" });
    }

    const courseId = new ObjectId(body.courseId);
    const course = await getDbReference().collection('courses').findOne({ _id: courseId });
    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    if (!(await isInstructorOrAdmin(req, courseId))) {
        return res.status(403).json({ error: "Not authorized to create assignments for this course" });
    }

    const result = await getDbReference().collection('assignments').insertOne({
        courseId: courseId,
        title: body.title,
        points: body.points,
        due: body.due
    });

    res.status(201).json({ id: result.insertedId });
});


router.get('/:assignmentid', async function (req, res, next) {
    if (!ObjectId.isValid(req.params.assignmentid)) {
        return res.status(404).json({ error: "Assignment not found" });
    }

    const assignment = await getDbReference().collection('assignments').findOne({
        _id: new ObjectId(req.params.assignmentid)
    });

    if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
    }

    res.status(200).json(assignment);
});


router.patch('/:assignmentid', requireAuthorization, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.assignmentid)) {
        return res.status(404).json({ error: "Assignment not found" });
    }

    const assignmentId = new ObjectId(req.params.assignmentid);
    const assignment = await getDbReference().collection('assignments').findOne({ _id: assignmentId });

    if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
    }

    if (!(await isInstructorOrAdmin(req, assignment.courseId))) {
        return res.status(403).json({ error: "Not authorized to update this assignment" });
    }

    const updates = extractValidFields(req.body, assignmentSchema);
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "Request body does not contain any valid assignment fields" });
    }

    if (updates.courseId) {
        if (!ObjectId.isValid(updates.courseId)) {
            return res.status(400).json({ error: "Invalid courseId" });
        }
        updates.courseId = new ObjectId(updates.courseId);
    }

    await getDbReference().collection('assignments').updateOne({ _id: assignmentId }, { $set: updates });
    res.status(200).send();
});


router.delete('/:assignmentid', requireAuthorization, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.assignmentid)) {
        return res.status(404).json({ error: "Assignment not found" });
    }

    const assignmentId = new ObjectId(req.params.assignmentid);
    const assignment = await getDbReference().collection('assignments').findOne({ _id: assignmentId });

    if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
    }

    if (!(await isInstructorOrAdmin(req, assignment.courseId))) {
        return res.status(403).json({ error: "Not authorized to delete this assignment" });
    }

    const bucket = getAssignmentsBucket();
    const submissionFiles = await getAssignmentsFilesCollection()
        .find({ "metadata.assignmentId": assignmentId })
        .toArray();
    for (const file of submissionFiles) {
        await bucket.delete(file._id);
    }

    await getDbReference().collection('assignments').deleteOne({ _id: assignmentId });
    res.status(204).send();
});


router.get('/:assignmentid/submissions', requireAuthorization, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.assignmentid)) {
        return res.status(404).json({ error: "Assignment not found" });
    }

    const assignmentId = new ObjectId(req.params.assignmentid);
    const assignment = await getDbReference().collection('assignments').findOne({ _id: assignmentId });

    if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
    }

    if (!(await isInstructorOrAdmin(req, assignment.courseId))) {
        return res.status(403).json({ error: "Not authorized to view submissions for this assignment" });
    }

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    const filter = { "metadata.assignmentId": assignmentId };
    if (req.query.studentId && ObjectId.isValid(req.query.studentId)) {
        filter["metadata.studentId"] = new ObjectId(req.query.studentId);
    }

    const filesCollection = getAssignmentsFilesCollection();
    const totalCount = await filesCollection.countDocuments(filter);
    const files = await filesCollection.find(filter).skip(skip).limit(pageSize).toArray();

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const submissions = files.map(file => ({
        _id: file._id,
        assignmentId: file.metadata.assignmentId,
        studentId: file.metadata.studentId,
        timestamp: file.metadata.timestamp,
        grade: file.metadata.grade,
        file: `${baseUrl}/assignments/${req.params.assignmentid}/submissions/download/${file._id}`
    }));

    res.status(200).json({
        submissions,
        page,
        totalPages: Math.ceil(totalCount / pageSize),
        pageSize,
        totalCount
    });
});


router.post('/:assignmentid/submissions', requireAuthorization, upload.single('file'), async function (req, res, next) {
    if (!ObjectId.isValid(req.params.assignmentid)) {
        return res.status(404).json({ error: "Assignment not found" });
    }

    if (!req.file) {
        return res.status(400).json({ error: "Request must include a file" });
    }

    if (req.locals.role !== 'student') {
        return res.status(403).json({ error: "Only students can submit assignments" });
    }

    const assignmentId = new ObjectId(req.params.assignmentid);
    const assignment = await getDbReference().collection('assignments').findOne({ _id: assignmentId });

    if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
    }

    const studentId = new ObjectId(req.locals.userid);
    const course = await getDbReference().collection('courses').findOne({
        _id: assignment.courseId,
        students: studentId
    });

    if (!course) {
        return res.status(403).json({ error: "Student is not enrolled in this course" });
    }

    const bucket = getAssignmentsBucket();
    const uploadStream = bucket.openUploadStream(req.file.originalname, {
        contentType: req.file.mimetype,
        metadata: {
            assignmentId: assignmentId,
            studentId: studentId,
            timestamp: new Date(),
            grade: null
        }
    });

    uploadStream.end(req.file.buffer);

    uploadStream.on('finish', () => {
        res.status(201).json({ id: uploadStream.id });
    });

    uploadStream.on('error', next);
});


router.get('/:assignmentid/submissions/download/:fileid', requireAuthorization, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.fileid)) {
        return res.status(404).json({ error: "Submission not found" });
    }

    const fileId = new ObjectId(req.params.fileid);
    const file = await getAssignmentsFilesCollection().findOne({ _id: fileId });

    if (!file) {
        return res.status(404).json({ error: "Submission not found" });
    }

    const assignmentId = file.metadata.assignmentId;
    const assignment = await getDbReference().collection('assignments').findOne({ _id: assignmentId });

    if (!req.locals.isAdmin) {
        const isInstructor = req.locals.role === 'instructor' &&
            assignment && await isInstructorOrAdmin(req, assignment.courseId);
        const isOwner = file.metadata.studentId.toString() === req.locals.userid;

        if (!isInstructor && !isOwner) {
            return res.status(403).json({ error: "Not authorized to download this submission" });
        }
    }

    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);

    const downloadStream = getAssignmentsBucket().openDownloadStream(fileId);
    downloadStream.pipe(res);
    downloadStream.on('error', next);
});

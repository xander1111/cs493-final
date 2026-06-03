const router = require('express').Router();
const { ObjectId } = require('mongodb');

const { validateAgainstSchema, extractValidFields } = require('../lib/validation');
const { requireAuthorization } = require('../lib/auth');
const { getDbReference, getAssignmentsBucket, getAssignmentsFilesCollection } = require('../lib/mongo');

exports.router = router;

const courseSchema = {
    instructorid: { required: true },
    subject: { required: true },
    number: { required: true },
    title: { required: true },
    term: { required: true },
};

function isInstructorOrAdmin(req, course) {
    if (req.locals.isAdmin) return true;
    if (req.locals.role !== 'instructor') return false;
    return course.instructorid && course.instructorid.toString() === req.locals.userid;
}


router.get('/', async function (req, res, next) {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    const filter = {};
    if (req.query.subject) filter.subject = req.query.subject;
    if (req.query.number)  filter.number  = req.query.number;
    if (req.query.term)    filter.term    = req.query.term;

    const collection = getDbReference().collection('courses');
    const projection = { students: 0 };

    const totalCount = await collection.countDocuments(filter);
    const courses = await collection
        .find(filter, { projection })
        .skip(skip)
        .limit(pageSize)
        .toArray();

    res.status(200).json({
        courses,
        page,
        totalPages: Math.ceil(totalCount / pageSize),
        pageSize,
        totalCount
    });
});


router.post('/', requireAuthorization, async function (req, res, next) {
    if (!req.locals.isAdmin) {
        return res.status(403).json({ error: "Only admins can create courses" });
    }

    if (!validateAgainstSchema(req.body, courseSchema)) {
        return res.status(400).json({ error: "Request body is not a valid course object" });
    }

    const body = extractValidFields(req.body, courseSchema);

    if (!ObjectId.isValid(body.instructorid)) {
        return res.status(400).json({ error: "Invalid instructorid" });
    }

    const instructorId = new ObjectId(body.instructorid);
    const instructor = await getDbReference().collection('users').findOne({
        _id: instructorId,
        role: 'instructor'
    });
    if (!instructor) {
        return res.status(400).json({ error: "instructorid must reference a user with the instructor role" });
    }

    const result = await getDbReference().collection('courses').insertOne({
        instructorid: instructorId,
        subject: body.subject,
        number: body.number,
        title: body.title,
        term: body.term,
        students: []
    });

    res.status(201).json({ id: result.insertedId });
});


router.get('/:courseid', async function (req, res, next) {
    if (!ObjectId.isValid(req.params.courseid)) {
        return res.status(404).json({ error: "Course not found" });
    }

    const course = await getDbReference().collection('courses').findOne(
        { _id: new ObjectId(req.params.courseid) },
        { projection: { students: 0 } }
    );

    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    res.status(200).json(course);
});


router.patch('/:courseid', requireAuthorization, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.courseid)) {
        return res.status(404).json({ error: "Course not found" });
    }

    const courseId = new ObjectId(req.params.courseid);
    const course = await getDbReference().collection('courses').findOne({ _id: courseId });

    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    if (!isInstructorOrAdmin(req, course)) {
        return res.status(403).json({ error: "Not authorized to update this course" });
    }

    const updates = extractValidFields(req.body, courseSchema);
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "Request body does not contain any valid course fields" });
    }

    if (updates.instructorid) {
        if (!ObjectId.isValid(updates.instructorid)) {
            return res.status(400).json({ error: "Invalid instructorid" });
        }
        updates.instructorid = new ObjectId(updates.instructorid);
    }

    await getDbReference().collection('courses').updateOne({ _id: courseId }, { $set: updates });
    res.status(200).send();
});


router.delete('/:courseid', requireAuthorization, async function (req, res, next) {
    if (!req.locals.isAdmin) {
        return res.status(403).json({ error: "Only admins can delete courses" });
    }

    if (!ObjectId.isValid(req.params.courseid)) {
        return res.status(404).json({ error: "Course not found" });
    }

    const courseId = new ObjectId(req.params.courseid);
    const course = await getDbReference().collection('courses').findOne({ _id: courseId });

    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    const assignments = await getDbReference().collection('assignments')
        .find({ courseId: courseId })
        .toArray();

    const bucket = getAssignmentsBucket();
    for (const assignment of assignments) {
        const files = await getAssignmentsFilesCollection()
            .find({ "metadata.assignmentId": assignment._id })
            .toArray();
        for (const file of files) {
            await bucket.delete(file._id);
        }
    }

    await getDbReference().collection('assignments').deleteMany({ courseId: courseId });
    await getDbReference().collection('courses').deleteOne({ _id: courseId });

    res.status(204).send();
});


router.get('/:courseid/students', requireAuthorization, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.courseid)) {
        return res.status(404).json({ error: "Course not found" });
    }

    const course = await getDbReference().collection('courses').findOne({
        _id: new ObjectId(req.params.courseid)
    });

    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    if (!isInstructorOrAdmin(req, course)) {
        return res.status(403).json({ error: "Not authorized to view students for this course" });
    }

    res.status(200).json({ students: course.students || [] });
});


router.post('/:courseid/students', requireAuthorization, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.courseid)) {
        return res.status(404).json({ error: "Course not found" });
    }

    const courseId = new ObjectId(req.params.courseid);
    const course = await getDbReference().collection('courses').findOne({ _id: courseId });

    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    if (!isInstructorOrAdmin(req, course)) {
        return res.status(403).json({ error: "Not authorized to modify enrollment for this course" });
    }

    const { add, remove } = req.body;
    if (!Array.isArray(add) && !Array.isArray(remove)) {
        return res.status(400).json({ error: "Request body must include an 'add' or 'remove' array" });
    }

    const collection = getDbReference().collection('courses');

    if (Array.isArray(add) && add.length > 0) {
        const addIds = add.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
        if (addIds.length > 0) {
            await collection.updateOne({ _id: courseId }, { $addToSet: { students: { $each: addIds } } });
        }
    }

    if (Array.isArray(remove) && remove.length > 0) {
        const removeIds = remove.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
        if (removeIds.length > 0) {
            await collection.updateOne({ _id: courseId }, { $pull: { students: { $in: removeIds } } });
        }
    }

    res.status(200).send();
});


router.get('/:courseid/roster', requireAuthorization, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.courseid)) {
        return res.status(404).json({ error: "Course not found" });
    }

    const course = await getDbReference().collection('courses').findOne({
        _id: new ObjectId(req.params.courseid)
    });

    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    if (!isInstructorOrAdmin(req, course)) {
        return res.status(403).json({ error: "Not authorized to download roster for this course" });
    }

    const studentIds = (course.students || []).map(id => new ObjectId(id));
    const students = studentIds.length > 0
        ? await getDbReference().collection('users').find({ _id: { $in: studentIds } }).toArray()
        : [];

    const csv = students
        .map(s => `"${s._id}","${s.name}","${s.email}"`)
        .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="roster-${req.params.courseid}.csv"`);
    res.status(200).send(csv);
});


router.get('/:courseid/assignments', async function (req, res, next) {
    if (!ObjectId.isValid(req.params.courseid)) {
        return res.status(404).json({ error: "Course not found" });
    }

    const courseId = new ObjectId(req.params.courseid);
    const course = await getDbReference().collection('courses').findOne({ _id: courseId });

    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    const assignments = await getDbReference().collection('assignments')
        .find({ courseId: courseId })
        .toArray();

    res.status(200).json({ assignments });
});

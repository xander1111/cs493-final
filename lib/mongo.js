/*
 * Module for working with a MongoDB connection.
 */

const { MongoClient, GridFSBucket } = require('mongodb')

const mongoHost = process.env.MONGO_HOST || 'localhost'
const mongoPort = process.env.MONGO_PORT || 27017
const mongoUser = process.env.MONGO_USER
const mongoPassword = process.env.MONGO_USER_PASSWORD
const mongoDbName = process.env.MONGO_INITDB_DATABASE

const mongoUrl = `mongodb://${mongoUser}:${mongoPassword}@${mongoHost}:${mongoPort}/${mongoDbName}`

let db = null
let _closeDbConnection = null

let assignmentsBucket = null
let assignmentsFilesCollection = null

exports.connectToDb = function (callback) {
  MongoClient.connect(mongoUrl).then(async function (client) {
    db = client.db(mongoDbName);
    _closeDbConnection = function () {
      client.close();
    }

    assignmentsBucket = new GridFSBucket(db, { bucketName: 'assignments' });
    assignmentsFilesCollection = await db.collection('assignments.files');

    callback();
  })
}

exports.getDbReference = function () {
  return db;
}

exports.closeDbConnection = function (callback) {
  _closeDbConnection(callback);
}

exports.getAssignmentsBucket = function () {
  return assignmentsBucket;
}

exports.getAssignmentsFilesCollection = function () {
  return assignmentsFilesCollection;
}


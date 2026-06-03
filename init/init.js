const { MongoClient } = require('mongodb');

const mongoHost = process.env.MONGO_HOST || "localhost";
const mongoPort = process.env.MONGO_PORT || 27017;
const mongoUser = process.env.MONGO_INITDB_ROOT_USERNAME;
const mongoPassword = process.env.MONGO_INITDB_ROOT_PASSWORD;
const mongoRootDBName = process.env.MONGO_ROOT_DB;

const userName = process.env.MONGO_USER;  // new user name
const userPassword = process.env.MONGO_USER_PASSWORD;  // new user password
const dbName = process.env.MONGO_INITDB_DATABASE;  // database to give user permissions in

const mongoURL =
  `mongodb://${mongoUser}:${mongoPassword}@` +
  `${mongoHost}:${mongoPort}/${mongoRootDBName}`;

function status(s) {
    console.log(`init: ${s}`);
}

async function main() {
    if (!mongoPassword) {
        status("must set MONGO_INITDB_ROOT_PASSWORD to the root password");
        process.exit(1);
    }

    if (!userPassword) {
        status("must set MONGO_USER_PASSWORD to the new user password");
        process.exit(1);
    }

    status("connecting...");

    const client = await MongoClient.connect(mongoURL);

    const db = client.db(dbName);

    status("database created");

    const res = await db.command({
        createUser: userName,
        pwd: userPassword,
        roles: [ { role: "readWrite", db: dbName } ]
    });

    status("user created");
    status("user: " + userName);
    status(res);

    await client.close();

    status("connection closed");
}

main();

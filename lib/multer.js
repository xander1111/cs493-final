/*
 * Multer utilities
 */

const multer = require('multer');

const imageTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

exports.imageTypes = imageTypes;

exports.photoUploader = multer({ 
    storage: multer.memoryStorage(),
    fileFilter: (req, file, callback) => {
        callback(null, !!imageTypes[file.mimetype]);
    }
});


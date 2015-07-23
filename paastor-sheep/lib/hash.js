'use strict';
var crypto = require('crypto');
exports = module.exports = function (pass) {
    return crypto.createHash('sha256').update(pass).digest('base64');
};

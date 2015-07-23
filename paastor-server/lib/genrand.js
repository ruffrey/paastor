'use strict';
var crypto = require('crypto');
/**
 * Asynchronously get a crypto random string of a certain length with chars 0-9 a-z A-Z.
 * @param number len
 * @param function cb - With arguments: [err, randOut, totalTimeReadable]
 */
exports = module.exports = function randomValueBase64 (len, cb) {
    var starttime = process.hrtime();
    return crypto.randomBytes(Math.ceil(len * 3 / 4), function (err, buf) {
            if (err) {
                return cb(err);
            }
            var randOut = buf
                .toString('base64')   // convert to base64 format
                .slice(0, len)        // return required number of characters
                .replace(/\+/g, '0')  // replace '+' with '0'
                .replace(/\//g, '0');  // replace '/' with '0'
            var endtime = process.hrtime(starttime);
            var totalTimeReadable = (endtime[0] > 0 ? endtime[0] + 's ' : '') + (endtime[1] / 1000000).toFixed(3) + 'ms' ;
            cb(null, randOut, totalTimeReadable);
        });
};

var express = require('express');
var router = express.Router();
var debug = require('debug')('paastor');
var config = require('../config');

/* GET home page. */
router.get('/', function(req, res) {
    res.render('index', { title: 'Paastor' });
});
router.get('/conf/:_id/:conf', function(req, res, next) {
    req.Account
    .findOne({ _id: req.params._id })
    .exec(function (err, account) {
        console.log(err, account);
        var genericMessage = new Error("Invalid ID or confirmation code. It may have already been used.");
        genericMessage.status = 404;
        if (err) {
            debug('confirmation error', err);
            return res.render('error', {
                error: genericMessage
            });
        }
        if (!account) {
            return res.render('error', {
                error: genericMessage
            });
        }
        console.log(account.conf);
        account.conf = null;
        account.save(function (err, saved) {
            if (err) {
                return next(err);
            }
            res.render('conf', {
                title: 'Email confirmed',
                message: 'Sign in to continue.'
            });


            // admin notification that an account has been confirmed
            req.mandrill('/messages/send', {
                message: {
                    to: [{email: config.email.from, name: 'Paastor'}],
                    from_email: config.email.from,
                    subject: "[Paastor] - confirmed",
                    text: "Confirmed account: " + saved.email + " (" + saved._id + ")"
                }
            },
            function (err, data) {
                if (err) {
                    debug('mandrill error', err, data);
                    return next(err);
                }

                debug('Account confirmation notification to admin.', saved.email, saved._id);
            });


        });
    });
});
router.get('/password-reset/:_id/:conf', function(req, res, next) {
    req.Account
    .findOne({ _id: req.params._id, conf: req.params.conf })
    .exec(function (err, account) {
        var genericMessage = new Error("Invalid ID or reset code.");
        genericMessage.status = 404;
        if (err) {
            debug('password reset error', err);
            return next(genericMessage);
        }
        if (!account) {
            return next(genericMessage);
        }
        res.render('reset', {
            title: 'Password reset',
            message: 'Change your password, then log in again.',
            conf: account.conf,
            _id: account._id
        });
    });
});
module.exports = router;

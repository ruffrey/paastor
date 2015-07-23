'use strict';
var express = require('express');
var router = express.Router();
var debug = require('debug')('paastor');
var SheepClient = require('../sheep-client');
var SheepSshClient = require('../sheep-ssh-client');
// var mongoose = require('mongoose');
var async = require('async');
// var fs = require('fs');
// var os = require('os');
var uuid = require('uuid');
var packageJson = require('../package.json');
var sheepPackageJson = { version: '0.3.43' };
var hash = require('../lib/hash');
var config = require('../config');
// var stripe = require('stripe')(config.stripe.secret);

// var PAASTOR_KEY = __dirname + '/../paastor-key';
var regexId = /[^a-z0-9\-]/;

var getInfo = function () {
    var info = {
        name: packageJson.name,
        version: packageJson.version
    };
    // Object.keys(os).forEach(function (key) {
    //     var osProp = os[key];
    //     if (osProp instanceof Function) {
    //         info[key] = osProp();
    //     }
    //     else {
    //         info[key] = osProp;
    //     }
    // });
    return info;
};

/**
 * Get available plans for purchase
 */
router.get('/plans', function (req, res) {
    res.send(req.plans);
});

//
// Authentication API
//

// Is this still in use?
router.put('/confirmation/:_id/:conf', function (req, res, next) {
    req.Account
    .findOne({ _id: req.params._id, conf: req.params.conf })
    .exec(function (err, account) {
        if (err) {
            return next(err);
        }
        if (!account) {
            return res.send(404);
        }
        account.conf = null;
        account.save(function (err, saved) {
            if (err) {
                return next(err);
            }
            res.send({ message: "Account confirmed. Ok to log in." });


            // Emailing the administrator with a notification that somebody confirmed account
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

                debug('New account notification to admin.', saved.email, saved._id);
            });

        });
    });
});
/**
 * PUT /forgot/:email
 */
router.put('/forgot/:email', function (req, res, next) {
    if (!req.params.email) {
        return res.send(400, { error: "Missing email" });
    }
    req.Account.findOne({ email: req.params.email }, function (err, account) {
        if (err) {
            return next(err);
        }
        var message = { message: 'Password reset requested' };
        // give no indication if the email was wrong
        if (!account) {
            return res.send(message);
        }
        account.passwordReset(function (err, acct) {
            if (err) {
                return next(err);
            }
            //send an e-mail
            req.mandrill('/messages/send', {
                message: {
                    to: [{email: acct.email, name: acct.email}],
                    from_email: config.email.from,
                    subject: "Reset your Paastor password",
                    text: "There was a request to reset your Paastor password.\nThe link below will reset it.\n\n"
                        + config.url + '/password-reset/' + acct._id + '/' + acct.conf
                }
            }, function (err, data) {
                if (err) {
                    debug('mandrill error', err, data);
                    return next(err);
                }
                res.send(message);
            });
        });
    });
});
/**
 * PUT /password-reset/:_id/:conf
 * @arg string req.body.password
 */
router.put('/password-reset/:_id/:conf', function (req, res, next) {
    req.Account
    .findOne({ _id: req.params._id, conf: req.params.conf })
    .exec(function (err, account) {
        if (err) {
            return next(err);
        }
        if (!account) {
            return res.send(404);
        }
        var passCheckFail = account.isPasswordInvalid(req.body.password);
        if (passCheckFail) {
            return res.send(400, { error: passCheckFail });
        }
        account.password = req.body.password;
        account.conf = null;
        account.save(function (err, saved) {
            if (err) {
                return next(err);
            }
            req.session.user = saved.toObject();
            res.send(account);
        });
    });
});

/**
 * POST /accounts
 * Create an account.
 */
router.post('/accounts', function (req, res, next) {

    // preliminary validations

    if (!req.body.email || typeof req.body.email !== 'string') {
        return res.send(400, { error: "Email is required."});
    }
    if (!req.body.password || typeof req.body.password !== 'string') {
        return res.send(400, { error: "Password is required."});
    }

    // disallow the plus sign in email address
    if (req.body.email.indexOf('+') !== -1) {
        return res.send(400, {
            error: "At this time, we do not allow the plus (+) character in email addresses."
        });
    }

    // is the account in use?
    req.Account
    .findOne({ email: req.body.email })
    .exec(function (err, account) {
        if (err) {
            return next(err);
        }
        if (account) {
            return res.send(400, { error: "Account already exists." });
        }

        var newAccount = new req.Account();

        var passwordNotOk = newAccount.isPasswordInvalid(req.body.password);
        var emailNotOk = newAccount.isEmailInvalid(req.body.email);
        var validationError = passwordNotOk || emailNotOk;

        if (validationError) {
            return res.send(400, { error: validationError });
        }

        newAccount.email = req.body.email;
        newAccount.password = req.body.password;

        newAccount.save(function (err, saved) {
            if (err) {
                return next(err);
            }

            // Transactional welcome and account confirmation email
            req.mandrill('/messages/send', {
                message: {
                    to: [{email: saved.email, name: saved.email}],
                    from_email: config.email.from,
                    subject: "Confirm your Paastor account",
                    text: "Thanks for signing up for Paastor. Visit this link to confirm your account. If you didn't sign up, please disregard this message.\n\n"
                        + config.url + '/conf/' + saved._id + '/' + saved.conf
                }
            }, function (err, data) {
                if (err) {
                    debug('mandrill error', err, data);
                    return next(err);
                }

                // RES.SEND
                // notice, does not log them in. need to conf account first.
                res.send(saved);
            });



            // Emailing the administrator with a notification that somebody signed up.
            req.mandrill('/messages/send', {
                message: {
                    to: [{email: config.email.from, name: 'Paastor'}],
                    from_email: config.email.from,
                    subject: "[Paastor] - new account",
                    text: "New account: " + saved.email + " (" + saved._id + ")"
                }
            },
            function (err, data) {
                if (err) {
                    debug('mandrill error', err, data);
                    return next(err);
                }

                debug('New account notification to admin.', saved.email, saved._id);
            });


        });
    });
});

/**
 * POST /login
 * @arg {string} req.body.email
 * @arg {string} req.body.password
 * @returns Account
 */
router.post('/login', function (req, res, next) {
    req.Account
    .findOne({ email: req.body.email, password: hash(req.body.password) })
    .exec(function (err, account) {
        if (err) {
            return next(err);
        }
        if (!account) {
            setTimeout(function () {
                res.send(401, { error: 'Auth failed' });
            }, 500);
            return;
        }
        if (account.conf && account.conf.indexOf('conf-') !== -1) {
            return res.send(401, { error: 'Account must be confirmed before logging in.' });
        }
        req.session.user = account.toObject();
        res.send(account);

        // if somebody logs in, kill off any password reset tokens
        if (account.conf && account.conf.indexOf('reset-') !== -1) {
            account.conf = null;
        }
        account.seen = new Date();
        account.save(function (err, saved) {
            if (err) {
                debug('FAILED saving account info after logging in', err, account);
            }
        });
    });
});

/**
 * DELETE /login
 *
 * Log out.
 */
router.delete('/login', function (req, res) {
    req.session.user = null;
    res.send({ message: 'Logged out' });
});



//
// ---- DMZ ----
//



//
// API
//

// Require authorization.
router.all('*', function (req, res, next) {
    if (!req.session || !req.session.user || !req.session.user.email) {
        res.send(401, { error: 'Not authorized' });
        return;
    }
    next();
});

/**
 * GET /
 */
router.get('/', function (req, res) {
      res.send(getInfo());
});

router.get('/account/subscriptions', function (req, res, next) {
    req.Account.findOne({ email: req.session.user.email }).exec(function (err, account) {
        if (err) {
            return next(err);
        }
        account.getSubscriptions(function (err, subscriptions) {
            if (err) {
                return next(err);
            }
            if (!subscriptions) {
                debug('empty subscriptions response, with no error');
            }
            subscriptions = subscriptions || {data: []};
            res.send(subscriptions.data);
        });
    });
});

router.post('/account/subscriptions', function (req, res, next) {
    if (!req.body.quantity) {
        return res.send(400, { error: "Missing quantity" });
    }
    if (!req.body.id) {
        return res.send(400, { error: "Missing plan or subscription" });
    }
    req.Account.findOne({ email: req.session.user.email }).exec(function (err, account) {
        if (err) {
            return next(err);
        }
        req.Vps.count().where('account', req.session.user._id).exec(function (err, vpsTotal) {
            if (err) {
                return next(err);
            }
            // are they downgrading too far?

            var qty = parseFloat(req.body.quantity);
            if (isNaN(qty)) {
                return res.send(400, { error: "Invalid quantity" });
            }
            qty = Math.floor(qty);
            var afterQtyRemoved = account.limit_servers + (qty);
            if (qty < 0 && afterQtyRemoved < vpsTotal) {
                return res.send(400, { error: "Cannot remove that many subscriptions - you must delete servers first. You have " + vpsTotal + " servers." });
            }

            account.addSubscription(req.body, function (err, subscriptions) {
                if (err) {
                    return next(err);
                }
                subscriptions = subscriptions || {data: []};
                res.send(subscriptions.data);

                // email about changes.
                var msgText = "Your Paastor service has changed.\n\n"
                            + (req.body.quantity < 0 ? "DOWNGRADE" : "UPGRADE")
                            + "\n\n"
                            + (req.body.quantity > 0 ? "+" : "") + req.body.quantity + "x "
                            + (req.body.name || req.body.id);
                if (req.body.quantity > 0) {
                    msgText += "\n\nA receipt will be sent after the payment is confirmed.";
                }
                req.mandrill('/messages/send', {
                    message: {
                        to: [{email: account.email, name: account.email}],
                        from_email: config.email.from,
                        subject: "Confirmation of Paastor service change",
                        text: msgText
                    }
                }, function (err, data) {
                    if (err) {
                        debug('mandrill error', err, data);
                    }
                });


            });
        });
    });
});

/**
 * GET /account?select=sshkey_pub,sshkey_private
 */
router.get('/account', function (req, res, next) {
    req.Account.findOne({ email: req.session.user.email }).exec(function (err, account) {
        if (err) {
            return next(err);
        }
        if (!account) {
            res.send(404, { error: "Not logged in" });
            return;
        }
        var out = {};
        // selecting hidden properties
        if (req.query.select) {
            var select = req.query.select.split(',');
            var objectOptions = { transform: true };
            select.forEach(function (field) {
                objectOptions[field] = true;
            });
            out = account.toObject(objectOptions);
        }
        else {
            out = account;
        }
        res.send(out);
    });
});
router.get('/account/card', function (req, res, next) {
    req.Account.findOne({ email: req.session.user.email }).exec(function (err, account) {
        if (err) {
            return next(err);
        }
        account.getCard(function (err, card) {
            if (err) {
                return next(err);
            }
            // scrub some info.
            if (!card) {
                return res.send({});
            }
            res.send({
                exp_month: card.exp_month,
                exp_year: card.exp_year,
                last4: card.last4,
                type: card.type
            });
        });
    });
});
router.put('/account/card/:cardToken', function (req, res, next) {
    req.Account.findOne({ email: req.session.user.email }).exec(function (err, account) {
        if (err) {
            return next(err);
        }
        account.setCard(req.params.cardToken, function (err, card) {
            if (err) {
                return next(err);
            }
            // scrub some info.
            res.send({
                exp_month: card.exp_month,
                exp_year: card.exp_year,
                last4: card.last4,
                type: card.type
            });
        });
    });
});

/**
 * PATCH /account
 * @arg {string} req.body.password
 */
router.patch('/account', function (req, res, next) {
    req.Account.findOne({ email: req.session.user.email }).exec(function (err, account) {
        if (err) {
            return next(err);
        }
        if (!account) {
            return res.send(404, { error: "Account not found" });
        }
        var passwordSucks = account.isPasswordInvalid(req.body.password);
        if (passwordSucks) {
            return res.send(400, { error: passwordSucks });
        }
        account.password = req.body.password;
        account.save(function (err, saved) {
            if(err) {
                return next(err);
            }
            req.session.user = saved.toObject();
            res.send(saved);
        });
    });
});


/**
 * GET /vps
 * Get basic information about all Vps objects.
 * @return array<Vps>
 */
router.get('/vps', function (req, res, next) {
    req.Vps.find({ account: req.session.user._id }).exec(function (err, vps) {
        if (err) {
            return next(err);
        }
        res.send(vps);
    });
});
/**
 * GET /vps/:_id
 * Get detailed information about one Vps.
 * @returns Vps
 */
router.get('/vps/:_id', function (req, res, next) {
    req.Vps
    .findOne({ account: req.session.user._id, _id: req.params._id })
    .exec(function (err, vps) {
        if (err) {
            return next(err);
        }
        if (!vps) {
            return res.send(404, { error: "Not found or still being provisioned\n" });
        }

        // if the vps is in good standing, get info about it.
        new SheepClient(vps.ip, vps.secret).info(function (err, info) {
            vps = vps.toObject();
            if (err) {
                debug('error getting vps info', err);
                vps.info = {error: err};
            }
            else if (info && info.cpus) {
                var sum = 0;
                var tot = 0;
                info.cpus.forEach(function (cpu) {
                    tot += cpu.times.idle;
                    sum += cpu.times.irq;
                    sum += cpu.times.nice;
                    sum += cpu.times.sys;
                    sum += cpu.times.user;
                });
                info.totalcpu = tot;
                info.freecpu = tot - sum;
                info.cpuPer = ((info.totalcpu - info.freecpu) / info.totalcpu) * 100;
            }
            if (info) {
                info.memPer = ((info.totalmem - info.freemem) / info.totalmem) * 100;
                info.usedmem = (info.totalmem - info.freemem) / 1024 / 1024;
            }
            vps.info = info;
            vps.sheepLatest = sheepPackageJson.version;
            res.send(vps);
        });
    });
});

/**
 * Provision a new sheep.
 */
router.post('/vps', function (req, res, next) {
    var client;
    var finalVps;
    var logs;

    req.Account.findOne({ _id: req.session.user._id }).exec(function (err, account) {
        if (err) {
            return next(err);
        }
        if (account.conf && account.conf.indexOf('conf-') !== -1) {
            return next(400, { error: "Confirm your account first." });
        }
        req.Vps.count({ account: account._id }).exec(function (err, count) {
            if (err) {
                return next(err);
            }
            if (count >= account.limit_servers) {
                return res.send(400, { error: "Upgrade your plan to add more servers." });
            }
            checkVpsExists();
        });
    });

    function checkVpsExists() {
        req.Vps.findById(req.body._id).exec(function (err, v) {
            if (err) {
                return next(err);
            }
            if (v) {
                return res.send(400, {
                    error: 'Sorry, that server name is already taken. Please choose another.'
                });
            }
            makeVps();
        });
    }

    function makeVps() {
        if (!req.body.ip) {
            return res.send(400, { error: "Missing ip." });
        }
        if (req.body.ip.split('.').length !== 4 || isNaN(parseFloat(req.body.ip))) {
            return res.send(400, { error: "Invalid ip." });
        }
        if (!req.body.password) {
            return res.send(400, { error: "Missing root password." });
        }
        if (!req.body._id) {
            return res.send(400, { error: "Missing name (_id)." });
        }
        if (regexId.test(req.body._id)) {
            return res.send(400, { error: "Invalid characters in name (_id), only use a-z, 0-9, and dash (-)." });
        }
        if (!req.body.infrastructure || typeof req.body.infrastructure !== 'string') {
            return res.send(400, { error: "Missing infrastructure string." });
        }

        req.body.account = req.session.user._id;
        req.body.secret = req.body.secret || 'secret-' + uuid.v4() + '-' + uuid.v4() + '-' + uuid.v4();

        finalVps = req.body;

        logs = 'Saving some server info\n';

        req.body.logs = logs;
        new req.Vps(req.body).save(function (err, vps) {
            if (err) {
                return next(err);
            }

            finalVps = vps;
            logs += 'Connecting to the server\n';
            finalVps.logs = logs;
            finalVps.save();

            client = new SheepSshClient(finalVps.ip, req.body.password, function (err) {
                if (err) {
                    return next(err);
                }

                doit();
            });

            // client.on('data', function (data) {
            client.on('setup', function (data) {
                logs += data + '\n';
            });
            // client.on('error', function (data) {
            //     logs += data;
            // });
        });

        var logUpdate = function () {
            req.Vps.update({ _id: finalVps._id }, { logs: logs }, function (err, upd) {
                if (finalVps.status === 'install') {
                    setTimeout(logUpdate, 1500);
                }
            });
        };

        setTimeout(logUpdate, 1200);
    }

    function doit() {
        async.series([
            client.aptUpdate,
            client.installGit,
            client.installNode,

            function install(cb) {
                var newSheep = finalVps.toObject({
                    secret: true,
                    logs: false
                });
                client.installSheep(newSheep, cb);
            },
            function saveVps(cb) {
                finalVps.status = 'ok';
                finalVps.save(function (err, vps){
                    if(err) {
                        return cb(err, vps);
                    }
                    debug('Vps created via controller post', vps);
                    finalVps = vps;
                    cb();
                });
            }

        ], function (err, data) {
            if (err) {
                debug('create vps error', err);
                debug('create vps data', data);

                finalVps.logs = logs;
                finalVps.logs += "\nINSTALLATION FAILED";
                finalVps.logs += err;
                finalVps.logs += data;

                finalVps.status = 'error';
                finalVps.save(function(err, saved) {
                    if (err) {
                        return next(err);
                    }
                });
                return next(err);
            }
            res.send(finalVps);

            // then remove logs
            finalVps.logs = "";
            finalVps.save(function (err) {
                if (err) {
                    debug('ERROR deleting vps logs');
                }
            });
        });
    }
});

/**
 * PUT /vps/:_id/update-sheep
 * @param {string} req.body.password root password
 */
router.put('/vps/:_id/update-sheep', function (req, res, next) {
    if (!req.body.password) {
        return res.send(400, { error: "Root password is required." });
    }

    req.Vps.findOne({ _id: req.params._id, account: req.session.user._id }).exec(function (err, vps) {
        if(err) {
            return next(err);
        }
        if(!vps) {
            return res.send(404);
        }
        vps.status = 'update';
        vps.save(function (err, saved) {
            if (err) {
                return next(err);
            }
            vps = saved;
            var client = new SheepSshClient(vps.ip, req.body.password, function (err) {
                if (err) {
                    return next(err);
                }

                client.installSheep(vps.toObject({ secret: true, logs: false }), function (err) {
                    if (err) {
                        return next(err);
                    }
                    vps.status = 'ok';
                    vps.save(function (err, saved) {
                        if (err) {
                            return next(err);
                        }
                        res.send(saved);
                    });
                });
            });
        });

    });

});

/**
 * POST /vps/:_id/redis
 */
router.post('/vps/:_id/redis', function (req, res, next) {
    if (!req.body.rootPassword) {
        return res.send(400, { error: "Root password is required." });
    }

    req.Vps.findOne({ _id: req.params._id, account: req.session.user._id }).exec(function (err, vps) {
        if (err) {
            return next(err);
        }
        if (!vps) {
            return res.send(404);
        }
        vps.status = 'install_redis';
        vps.save(function (err, saved) {
            if (err) {
                return next(err);
            }
            vps = saved;
            var client = new SheepSshClient(vps.ip, req.body.rootPassword, function (err) {
                if (err) {
                    return next(err);
                }

                client.installRedis(req.body, function (err, redisPassword) {
                    if (err) {
                        return next(err);
                    }
                    vps.status = 'ok';
                    vps.redis = true;
                    vps.save(function (err, saved) {
                        if (err) {
                            return next(err);
                        }
                        res.send({ password: redisPassword });
                    });
                });
            });
        });

    });

});
router.delete('/vps/:_id/redis', function (req, res, next) {
    var rootPassword = req.body.rootPassword || req.query.rootPassword;
    if (!rootPassword) {
        return res.send(400, { error: "Root password is required to remove Redis." });
    }
    req.Vps.findOne({ _id: req.params._id, account: req.session.user._id }).exec(function (err, vps) {
        if (err) {
            return next(err);
        }
        if (!vps) {
            return res.send(404);
        }
        vps.status = 'uninstall_redis';
        vps.save(function (err, saved) {
            if (err) {
                return next(err);
            }
            vps = saved;
            var client = new SheepSshClient(vps.ip, rootPassword, function (err) {
                if (err) {
                    return next(err);
                }

                client.uninstallRedis(function (err) {
                    if (err) {
                        return next(err);
                    }
                    vps.status = 'ok';
                    vps.redis = false;
                    vps.save(function (err, saved) {
                        if (err) {
                            return next(err);
                        }
                        res.send(saved);
                    });
                });
            });
        });

    });
});

/**
 * POST /vps/:_id/mongo
 */
router.post('/vps/:_id/mongo', function (req, res, next) {
    if (!req.body.rootPassword) {
        return res.send(400, { error: "Root password is required." });
    }

    req.Vps.findOne({ _id: req.params._id, account: req.session.user._id }).exec(function (err, vps) {
        if(err) {
            return next(err);
        }
        if(!vps) {
            return res.send(404);
        }
        vps.status = 'install_mongo';
        vps.save(function (err, saved) {
            if (err) {
                return next(err);
            }
            vps = saved;
            var client = new SheepSshClient(vps.ip, req.body.rootPassword, function (err) {
                if (err) {
                    return next(err);
                }

                client.installMongo(req.body, function (err) {
                    if (err) {
                        return next(err);
                    }
                    vps.status = 'ok';
                    vps.mongo = true;
                    vps.save(function (err, saved) {
                        if (err) {
                            return next(err);
                        }
                        res.send(vps);
                    })
                });
            });
        });

    });

});
router.delete('/vps/:_id/mongo', function (req, res, next) {
    var rootPassword = req.body.rootPassword || req.query.rootPassword;
    if (!rootPassword) {
        return res.send(400, { error: "Root password is required to remove Mongo." });
    }
    req.Vps.findOne({ _id: req.params._id, account: req.session.user._id }).exec(function (err, vps) {
        if(err) {
            return next(err);
        }
        if(!vps) {
            return res.send(404);
        }
        vps.status = 'uninstall_mongo';
        vps.save(function (err, saved) {
            if (err) {
                return next(err);
            }
            vps = saved;
            var client = new SheepSshClient(vps.ip, rootPassword, function (err) {
                if (err) {
                    return next(err);
                }

                client.uninstallMongo(function (err) {
                    if (err) {
                        return next(err);
                    }
                    vps.status = 'ok';
                    vps.mongo = false;
                    vps.save(function (err, saved) {
                        if (err) {
                            return next(err);
                        }
                        res.send(saved);
                    })
                });
            });
        });

    });
});

/**
 * PATCH /vps/:_id
 * @arg {Vps} req.body
 */
router.patch('/vps/:_id', function (req, res, next) {
    req.Vps.findOne({ _id: req.params._id, account: req.session.user._id }).exec(function (err, vps) {
        if(err) {
            return next(err);
        }
        if(!vps) {
            return res.send(404);
        }
        for(var i in req.body) {
            vps[i] = req.body[i];
        }
        vps.save(function (err, saved) {
            if(err) {
                return next(err);
            }
            res.send(saved);
        });
    });
});
/**
 * DELETE /vps/:_id
 */
router.delete('/vps/:_id', function (req, res, next) {
    req.Vps.findOne({ _id: req.params._id, account: req.session.user._id }).exec(function (err, vps) {
        if(err) {
            return next(err);
        }
        if(!vps) {
            return res.send(404);
        }
        vps.remove(function (err) {
            if(err) {
                return next(err);
            }
            res.send(200);
        });
    });
});


/**
 * POST /vps/:vps/apps
 * Does not
 * @arg {App} req.body
 * @returns App
 */
router.post('/vps/:vps/apps', function (req, res, next) {
    var app = req.body;
    var vps;

    // Validations

    var invalidName = new Error("Invalid app name (_id).");
    invalidName.status = 400;
    var envInvalid = new Error("Invalid JSON for environment.");
    envInvalid.status = 400;

    if (!req.body._id || typeof req.body._id !== 'string' || regexId.test(req.body._id)) {
        return next(invalidName);
    }

    try {
        app.env = JSON.parse(app.env);
    }
    catch (ex) {
        return next(envInvalid);
    }
    var envTypeTestsFail = typeof app.env !== 'object' || app.env instanceof Array;
    if (envTypeTestsFail) {
        return next(envInvalid);
    }

    // Validations are done


    async.series([

        function gettingVpsInfo(cb) {
            req.Vps
            .findOne()
            .where('_id', req.params.vps)
            .where('account', req.session.user._id).exec(function (err, _vps) {
                if (err) {
                    debug('error during vps retrieval', err);
                    return cb(err);
                }
                if (!_vps) {
                    err = new Error(req.params.vps + " not found");
                    err.status = 404;
                    return next(err);
                }
                vps = _vps;
                cb(err);
            });
        },
        function postingToSheep(cb) {
            new SheepClient(vps.ip, vps.secret).createApp(app, function (err, sheepApp) {
                if (err) {
                    return cb(err, sheepApp);
                }

                app = sheepApp;
                cb();
            });
        }

    ], function finished(err, arg) {
        if (err) {
            debug('Error during POST /api/vps/:vps/apps', err, arg);
            return next(err);
        }
        res.send(app);
    });

});

/**
 * PUT package `pkg` for app push.
 */
router.put('/vps/:vps/apps/:_id/pkg', function (req, res, next) {
    if (!req.body.pkg || typeof req.body.pkg !== 'string') {
        return res.send(400, { error: "pkg should be a base64 encoded zip file"});
    }

    req.Vps.findById(req.params.vps).where('account', req.session.user._id).exec(function (err, vps) {
        if (err) {
            err.status = 404;
            return next(err);
        }

        new SheepClient(vps.ip, vps.secret)
        .pushPackage(req.params._id, req.body, function (err, sheepApp) {
            if (err) {
                return next(err);
            }
            res.send(sheepApp);
        });
    });
});

/**
 * DELETE an app.
 * /vps/:vps/apps/:_id
 */
router.delete('/vps/:vps/apps/:_id', function (req, res, next) {
    req.Vps.findById(req.params.vps).where('account', req.session.user._id).exec(function (err, vps) {
        if (err) {
            err.status = 404;
            return next(err);
        }

        new SheepClient(vps.ip, vps.secret)
        .removeApp(req.params._id, function (err, data) {
            if (err) {
                return next(err);
            }
            res.send(data);
        });
    });
});

/**
 * GET server logs.
 */
router.get('/vps/:vps/logs', function (req, res, next) {
    req.Vps.findById(req.params.vps).where('account', req.session.user._id).exec(function (err, vps) {
        if (err) {
            err.status = 404;
            return next(err);
        }

        new SheepClient(vps.ip, vps.secret)
        .serverLogs(function (err, data) {
            if (err) {
                return next(err);
            }
            res.send(data);
        });
    });
});

/**
 * PUT for app environment update
 */
router.put('/vps/:vps/apps/:_id/env', function (req, res, next) {
    req.Vps.findById(req.params.vps).where('account', req.session.user._id).exec(function (err, vps) {
        if (err) {
            return next(err);
        }
        if (!vps) {
            err = new Error("Server not found by _id " + req.params.vps);
            err.status = 404;
            return next(err);
        }

        new SheepClient(vps.ip, vps.secret)
        .action(req.params._id, 'env', req.body, function (err, sheepApp) {
            if (err) {
                return next(err);
            }
            res.send(sheepApp);
        });
    });
});
/**
 * PUT an environment variable like { key: 'NODE_ENV', val: 'production' }
 */
router.put('/vps/:vps/apps/:_id/setvar', function (req, res, next) {
    req.Vps.findById(req.params.vps).where('account', req.session.user._id).exec(function (err, vps) {
        if (err) {
            return next(err);
        }
        if (!vps) {
            err = new Error("Server not found by _id " + req.params.vps);
            err.status = 404;
            return next(err);
        }

        new SheepClient(vps.ip, vps.secret)
        .setvar(req.params._id, req.body.key, req.body.val, function (err, sheepApp) {
            if (err) {
                return next(err);
            }
            res.send(sheepApp);
        });
    });
});
/**
 * PUT for app SSL update
 */
router.put('/vps/:vps/apps/:_id/ssl', function (req, res, next) {
    req.Vps.findById(req.params.vps).where('account', req.session.user._id).exec(function (err, vps) {
        if (err) {
            return next(err);
        }
        if (!vps) {
            err = new Error("Server not found by _id " + req.params.vps);
            err.status = 404;
            return next(err);
        }

        new SheepClient(vps.ip, vps.secret)
        .setSsl(req.params._id, req.body, function (err, sheepApp) {
            if (err) {
                return next(err);
            }
            res.send(sheepApp);
        });
    });
});
/**
 * PUT for an action like start, stop, restart
 */
router.put('/vps/:vps/apps/:_id/:action', function (req, res, next) {
    req.Vps.findById(req.params.vps).where('account', req.session.user._id).exec(function (err, vps) {
        if (err) {
            return next(err);
        }
        if (!vps) {
            err = new Error("Server not found by _id " + req.params.vps);
            err.status = 404;
            return next(err);
        }

        new SheepClient(vps.ip, vps.secret)
        .action(req.params._id, req.params.action, function (err, data) {
            if (err) {
                err.status = 400;
                return next(err);
            }
            res.send(data);
        });
    });
});

/**
 * GET application logs
 */
router.get('/vps/:vps/apps/:_id/logs', function (req, res, next) {
    req.Vps.findById(req.params.vps).where('account', req.session.user._id).exec(function (err, vps) {
        if (err) {
            return next(err);
        }
        if (!vps) {
            err = new Error("Server found by _id " + req.params.vps);
            err.status = 404;
            return next(err);
        }

        new SheepClient(vps.ip, vps.secret)
        .appLogs(req.params._id, function (err, data) {
            if (err) {
                err.status = 400;
                return next(err);
            }
            res.send(data);
        });
    });
});
/**
 * POST install a new version of node.js
 */
router.post('/vps/:vps/node/:version', function (req, res, next) {
    req.Vps.findById(req.params.vps).where('account', req.session.user._id).exec(function (err, vps) {
        if (err) {
            return next(err);
        }
        if (!vps) {
            err = new Error("Server found by _id " + req.params.vps);
            err.status = 404;
            return next(err);
        }

        new SheepClient(vps.ip, vps.secret)
        .installNodeVersion(req.params.version, function (err, data) {
            if (err) {
                err.status = 400;
                return next(err);
            }
            res.send(data);
        });
    });
});


/**
 * GET /models
 * @returns array<Model>
 */
// router.get('/models', function (req, res) {
//     var modelNames = Object.keys(mongoose.modelSchemas);
//     var modelDefs = modelNames.map(function (name) {
//         var model = mongoose.modelSchemas[name];
//         var propNames = Object.keys(model.paths);
//         var props = propNames.map(function (prop) {
//             var propOpts = model.paths[prop].options;
//             propOpts.name = prop;
//             return propOpts;
//         });
//         return {
//             name: name,
//             props: props
//         };
//     });
//     res.send(modelDefs);
// });


/**
 * PUT /account/keygen
 */
// router.put('/account/keygen', function (req, res, next) {
//     req.Account
//     .findOne({ _id: req.session._id })
//     .exec(function (err, account) {
//         if (err) {
//             return next(err);
//         }
//         account.keygen(function (err, saved) {
//             if (err) {
//                 return next(err);
//             }
//             res.send(saved.toJSON({ sshkey_pub: true }));
//         });
//     });
// });

module.exports = router;

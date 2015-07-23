'use strict';
var mongoose = require('mongoose');
var debug = require('debug')('mongoose');
var ObjectId = mongoose.Schema.Types.ObjectId;
var uuid = require('uuid');
var hash = require('./lib/hash');
var config = require('./config');
var keygen = require('ssh-keygen');
var strength = require('strength');
var _ = require('lodash');
var stripe = require('stripe')(config.stripe.secret);

mongoose.connect(config.mongo);
mongoose.connection.on('connected', function () {
    debug('connected');
});
mongoose.connection.on('error', function (err) {
    debug('error', err);
});
// unless passing `true` for that key, most of the
// props will be removed.
var removeHiddens = function (doc, ret, options) {
    options = _.defaults(options, {
        _id: true,
        __v: false,
        password: false,
        secret: false,
        conf: false,
        sshkey_pub: false,
        sshkey_private: false,
        created: false,
        seen: false,
        stripe: false
    });
    var neverShow = ['conf', 'password', 'stripe', '__v'];
    Object.keys(options).forEach(function (key) {
        if (neverShow.indexOf(key) !== -1 || !options[key]) {
            delete ret[key];
        }
    });
};
var opts = {
    toJSON: {
        minimize: false,
        transform: removeHiddens
    },
    toObject: {
        minimize: false,
        transform: removeHiddens
    }
};

var models = {};

/**
 * Account Model
 */
var AccountSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: Object,
        required: true
    },
    conf: {
        type: String
    },
    sshkey_pub: {
        type: String,
        required: true
    },
    sshkey_private: {
        type: String,
        required: true
    },
    created: {
        type: Date,
        default: Date.now
    },
    seen: {
        type: Date,
        default: Date.now
    },
    stripe: {
        type: String
    },
    limit_servers: {
        type: Number,
        default: 1
    }
}, opts);
AccountSchema.options.toObject.transform = removeHiddens;
AccountSchema.options.toJSON.transform = removeHiddens;
AccountSchema.method('isPasswordInvalid', function (password) {
    if (!password) {
        return 'Missing password';
    }
    if (typeof password !== 'string') {
        return 'Password must be a string';
    }
    if (strength(password) < 1) {
        return 'Password is weak';
    }
    return null;
});
AccountSchema.method('isEmailInvalid', function (email) {
    if (!email) {
        return 'Missing email';
    }
    if (typeof email !== 'string') {
        return 'Email must be a string';
    }
    var emailArrAt = email.split('@');
    var emailArrPeriod = emailArrAt[1].split('.');
    if (
        emailArrAt.length === 1
        || emailArrPeriod.length === 1
        || !emailArrPeriod[0]
        || !emailArrPeriod[1]
        || !emailArrPeriod[1].length >= 2
    ) {
        return 'Email format is invalid.';
    }
    return null;
});
// generate a new ssh key, and add it to the model.
// returns Account
AccountSchema.method('keygen', function (callback) {
    var doc = this;
    keygen({}, function (err, out) {
        if (err) {
            return callback(err);
        }
        doc.sshkey_pub = out.pubKey;
        doc.sshkey_private = out.key;
        doc.save(callback);
    });
});
var getConf = function () {
    return uuid.v4() + '-' + uuid.v4() + '-' + uuid.v4();
};
AccountSchema.method('passwordReset', function (callback) {
    this.conf = 'reset-' + getConf();
    this.save(callback);
});
// if a customer doesnt exist, create one
AccountSchema.method('getCustomer', function (callback) {
    var doc = this;
    if (!doc.stripe) {
        stripe.customers.create(
              {
                  email: doc.email,
                  description: doc._id.toString()
              },
              function (err, customer) {
                  if (err) {
                      debug('stripe res error', err);
                      callback(err);
                      return;
                  }
                  debug('stripe customer created', doc.email, customer);
                  doc.stripe = customer.id;
                  doc.save(function (err, account) {
                      if (err) {
                          debug('error saving stripe customer to account', err);
                          callback(err);
                          return;
                      }
                      debug('saved account with stripe customer', account);
                      callback(null, customer);
                  });
          }
        );
        return;
    }
    stripe.customers.retrieve(doc.stripe, callback);
});
// returns Card
AccountSchema.method('getCard', function (callback) {
    var doc = this;
    doc.getCustomer(function (err, cust) {
        if (err) {
            return callback(err);
        }
        var cards = cust.cards.data;
        if (!cards.length) {
            return callback(null, null);
        }
        var defaultCard = null;
        cards.forEach(function (c) {
            if (c.id === cust.default_card) {
                defaultCard = c;
            }
        });
        callback(null, defaultCard);
    });
});
// returns Card
AccountSchema.method('setCard', function (cardToken, callback) {
    var doc = this;
    if (!cardToken || typeof cardToken !== 'string') {
        return callback(new Error("Card token was not a string"));
    }
    if (!doc.stripe) {
        return callback(new Error("Unable to create a card for a non-customer"));
    }
    stripe.customers.update(doc.stripe, { card: cardToken }, function (err, customer) {
        if (err) {
            return callback(err);
        }
        doc.getCard(callback);
    });
});
// returns array of subscriptions
AccountSchema.method('getSubscriptions', function (callback) {
    var doc = this;
    if (!doc.stripe) {
        return callback(new Error("Unable to get subscriptions for a non-customer"));
    }
    stripe.customers.listSubscriptions(doc.stripe, callback);
});
// returns array of subscriptions
// downgrades are done by passing a negative number to quantity
AccountSchema.method('addSubscription', function (plan, callback) {
    var doc = this;
    if (!doc.stripe) {
        return callback(new Error("Unable to get subscriptions for a non-customer"));
    }
    if (!plan) {
        return callback(new Error("Missing plan"));
    }
    if (!plan.id) {
        return callback(new Error("Missing plan id"));
    }
    if (typeof plan.quantity !== 'number') {
        return callback(new Error("Missing or invalid plan quantity"));
    }
    // ensure integers only
    plan.quantity = Math.floor(plan.quantity);

    doc.getSubscriptions(function (err, subscriptions) {
        if (err) {
            return callback(err);
        }
        subscriptions = subscriptions || { data: [] };
        subscriptions = subscriptions.data;
        var alreadySubscribed = false;
        subscriptions.forEach(function (sub) {
            if (sub.plan.id === plan.id) {
                alreadySubscribed = sub;
            }
        });


        var handleSubscription = function(err, subscription) {
            if (err) {
                return callback(err);
            }
            // apply changes to the plan.
            if (plan.id.indexOf('server') !== -1) {
                doc.limit_servers += plan.quantity;
            }
            else {
                debug('INVALID PLAN - cannot apply limit changes to account', doc.email);
            }
            doc.save(function (err, saved) {
                if (err) {
                    debug('FAIL applying subscription limit', err);
                    return callback(new Error('Please contact support. Your subscription was created but something failed while increasing your plan limits. We sincerely apologize.'));
                }
                doc.getSubscriptions(callback);
            });
          };


        // Update existing subscription
        if (alreadySubscribed) {
            debug('already subscribed', doc.email, plan.id);
            var sendData = {
                  prorate: true,
                  quantity: alreadySubscribed.quantity += plan.quantity
              };
              if (plan.coupon) {
                  sendData.coupon = plan.coupon;
              }
            stripe.customers.updateSubscription(
                  doc.stripe,
                  alreadySubscribed.id,
                  sendData,
                  handleSubscription
            );
        }
        else {
            debug('new subscription', doc.email, plan.id);
            var sendData = {
                plan: plan.id,
                prorate: true,
                quantity: plan.quantity
            };
              if (plan.coupon) {
                  sendData.coupon = plan.coupon;
              }
            stripe.customers.createSubscription(
                doc.stripe,
                sendData,
                handleSubscription
            );
        }
    });
});

AccountSchema.pre('validate', function (next) {
    var doc = this;
    doc.wasNew = doc.isNew;
    if (doc.isDirectModified('password')) {
        doc.password = hash(this.password);
        doc.conf = null;
    }

    // a new record will need a new ssh key and confirmation
    if (doc.isNew) {
        debug('new account, making ssh key');
        doc.conf = 'conf-' + getConf();
        keygen({}, function (err, out) {
            if (err) {
                debug('error making ssh key');
                return next(err);
            }
            debug('new ssh key is', out);
            doc.sshkey_pub = out.pubKey;
            doc.sshkey_private = out.key;
            next();
        });
    }
    else {
        next();
    }
});
AccountSchema.post('save', function (doc) {
    if (!doc.stripe) {
        stripe.customers.create(
              {
                  email: doc.email,
                  description: doc._id.toString()
              },
              function (err, customer) {
                  if (err) {
                      debug('stripe res error', err);
                      return;
                  }
                  debug('stripe customer created', doc.email, customer);
                  doc.stripe = customer.id;
                  doc.save(function (err, account) {
                      if (err) {
                          debug('error saving stripe customer to account', err);
                          return;
                      }
                      debug('saved account with stripe customer', account);
                  });
          }
        );
    }
});
models.Account = mongoose.model('Account', AccountSchema);


/**
 * Vps Model
 */
models.Vps = mongoose.model('Vps', new mongoose.Schema({
    _id: {
        type: String,
        required: true,
        unique: true,
        description: "The name of this VPS box, which should be unique."
    },
    account: {
        type: ObjectId,
        ref: 'Account',
        required: true
    },
    ip: {
        type: String,
        required: true,
        description: "The ip address for this server."
    },
    infrastructure: {
        type: String,
        required: true,
        description: "The name of the place where it is hosted, for informational purposes."
    },
    secret: {
        type: String,
        required: true,
        description: "The secret for Paastor-Secret http header."
    },
    logs: {
        type: String,
        default: "",
        description: "Some recent logs from the box."
    },
    status: {
        type: String,
        default: "install",
        description: "install, error, ok, etc."
    },
    redis: {
        type: Boolean,
        default: false,
        description: "Whether this server has redis."
    },
    mongo: {
        type: Boolean,
        default: false,
        description: "Whether this server has mongo."
    }
}, opts));


/**
 * Express middleware attaching models to `req[modelName]`
 */
module.exports = function (req, res, next) {

    for (var modelName in models) {
        req[modelName] = mongoose.model(modelName);
    }

    next();
};

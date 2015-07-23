'use strict';
var config = require('./config');
var debug = require('debug')('paastor');

/**
 * Handle uncaught exceptions.
 */
process.on('uncaughtException', function (err) {
    debug('\n------ uncaughtException ------\n', err.message);
    debug(err.stack, '\n');
    process.exit(1);
});

var express = require('express');
var redis = require('redis');
var session = require('express-session');
var RedisStore = require('connect-redis')(session);
var express = require('express');
var redisClient = redis.createClient(config.redisSession.port, config.redisSession.host);
redisClient.on('connect', function () {
    debug('Redis is connected');
});
redisClient.on('error', function (err) {
    debug('Redis error', err);
});

redisClient.auth(config.redisSession.password, function (err) {
    if (err) {
        debug('Redis auth error', err);
        return;
    }
    debug('Redis authenticated');
});

var path = require('path');
var favicon = require('static-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var Mandrill = require('node-mandrill');

var home = require('./routes/home');
var api = require('./routes/api');

var dataModels = require('./models');
var mandrill = new Mandrill(config.email.key);
var stripe = require('stripe')(config.stripe.secret);

var stripePlans = [];
stripe.plans.list({ limit: 100 }, function (err, plans) {
    if (err) {
        debug(err);
        return;
    }
    plans = plans || { data: [] };
    var output = plans.data.map(function (plan) {
        return {
            id: plan.id,
            name: plan.name,
            amount: plan.amount,
            interval: plan.interval
        };
    });
    output.sort(function (a, b) {
        if (a.amount > b.amount) {
            return 1;
        }
        if (a.amount < b.amount) {
            return -1;
        }
        return 0;
    });
    debug('Got ' + output.length + ' plans from Stripe');
    stripePlans = output;
});

var app = express();
if (process.env.NODE_ENV === 'production') {
    app.enable('trust proxy');
    app.use(function (req, res, next) {
        if (req.headers && req.headers.referrer && req.headers.referrer.indexOf('http://') !== -1) {
            return res.redirect(301, config.url + req.url);
        }
        if (req.host && req.host.indexOf('www.') !== -1) {
            return res.redirect(301, config.url + req.url);
        }
        next();
    });
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(dataModels);
app.use(function (req, res, next) {
    req.mandrill = mandrill;
    req.plans = stripePlans;
    next();
});

app.use(favicon());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(logger('dev'));
app.use(session({
    store: new RedisStore({
        client: redisClient
    }),
    secret: config.redisSession.secret,
    resave: true,
    saveUninitialized: true,
    unset: 'destroy'
}));
app.use(function (req, res, next) {
    res.set('X-Powered-By', undefined);

    next();
});
app.use('/', home);
app.use('/api/', api);

/// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Paastor route not matched');
    err.status = 404;
    next(err);
});


// will print stacktrace

app.use(function errHandler(err, req, res, next) {
    res.status(err.status || 500);
    var output = {
        message: err.message,
        error: err
    };
    if (process.env.NODE_ENV === 'production') {
        delete err.stack;
    }
    if (req.accepts('json')) {
        return res.send(output);
    }
    res.render('error', output);
});



exports = module.exports = app;

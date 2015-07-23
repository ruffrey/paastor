(function () {
'use strict';

var debug = require('debug')('sheep:proxy');
var debugRequest = require('debug')('sheep:request');
var debugProcess = require('debug')('sheep:process');

var sheepPort = 3000;
var proxyPort = process.env.NODE_ENV === 'production' ? 80 : 3001;
var proxyPortSecure = process.env.NODE_ENV === 'production' ? 443 : 3002;

var hash = require('./lib/hash');
var fs = require('fs');
var path = require('path');
var systemInfo = require('./system.json');

var sheep = require('./api');
var apiServer;

var pem = require('pem');
var userApps;
var routeTable = {};
var certTable = {};
var DEFAULT_KEY; // TODO!!
var DEFAULT_CERT; // TODO!!

var http = require('http');
var https = require('https');
var crypto = require('crypto');
var async = require('async');
var HttpProxy = require('http-proxy');
var Proxy = new HttpProxy.createProxy();
var proxyServer; // The http proxy server listening on port 80
var proxyServerSecure; // The https proxy server listening on port 443

// These are the files used by the proxy and sheep directly.
var files = {
    system: __dirname + '/system.json',
    sheepCert: __dirname + '/../sheep.cert',
    sheepKey: __dirname + '/../sheep.key',
    apps: __dirname + '/../sheep_apps/apps.json'
};

var getCredentialsContext = function (params){
      return crypto.createCredentials({
        key: params.key,
        passphrase: params.passphrase,
        cert: params.cert,
        ca: params.ca
    }).context;
};

var listenForExceptions = function (cb) {
    /**
     * Handle uncaught exceptions.
     * TODO: something else?
     */
    process.on('uncaughtException', function (err) {
        debugProcess('\n\n------ UNCAUGHT EXCEPTION ON PROXY SERVER PROCESS ------\n', err.message);
        debugProcess(err.stack, '\n\n');
        debugProcess('\n------ end stack trace from uncaught exception ------\n', err.message);
        // process.exit(1);
        // ignore
    });
    cb();
};

var startMessage = function (cb) {
    debug('\n--------------- Proxy Start ---------------\n');
    debug('NODE_ENV', process.env.NODE_ENV);
    debug('api port', sheepPort);
    debug('proxy port', proxyPort);
    cb();
};

/**
 * The Paastor-Secret can be reset by passing an env variable HASH_RESET
 */
var resetHashCheck = function (cb) {
    if (process.env.HASH_RESET) {
        systemInfo.secret = hash(process.env.HASH_RESET);
        debug('New secret requested');
        fs.writeFileSync(files.system, JSON.stringify(systemInfo, null, 2), 'utf8');
        debug('Wrote new hashed secret');
    }
    cb();
};

/**
 * Create self-signed ssl certificate for sheep instance, if it does not exist.
 */
 var checkCertificate = function (cb) {

    if (!fs.existsSync(files.sheepCert) || !fs.existsSync(files.sheepKey)) {
        debug('SSL certificate for sheep does not exist. Creating...');
        pem.createCertificate({
            days: 5 * 365,
            selfSigned: true
        }, function(err, keys) {

            if (err) {
                debug('unable to generate sheep ssl certificate', err);
                throw err;
            }

            DEFAULT_KEY = keys.serviceKey;
            DEFAULT_CERT = keys.certificate;

            fs.writeFileSync(files.sheepKey, DEFAULT_KEY, { encoding: 'utf8' });
            fs.writeFileSync(files.sheepCert, DEFAULT_CERT, { encoding: 'utf8' });
            debug('SSL certificates created successfully.');

            cb();
        });
    }
    else {
        DEFAULT_KEY = fs.readFileSync(files.sheepKey);
        DEFAULT_CERT = fs.readFileSync(files.sheepCert);
        cb();
    }
};

/**
 * First build the certs table, for when SSL is used.
 *
 *         {
 *            'somehost.com': '127.0.0.1:3050'
 *        }
 *
 * Build the routing table, where keys are the hostname and the value is an
 * object such that:
 *
 *         {
 *            'somehost.com': '127.0.0.1:3050'
 *        }
 *
 *
 * Requests to the system IP will be proxied to the sheep instance.
 */
var reloadRouteTable = function (cb) {
    cb = cb || function (err) { };
    var start = process.hrtime();

    /**
     * Reload apps by reading the apps.json file.
     * Cleaning junk out of the contents if somehow it got in there.
     * Ensure app entries have all the data we need.
     */
    fs.readFile(files.apps, { encoding: 'utf8' }, function (err, contents) {
        if (err) {
            debug('CRITICAL ERROR READING apps.json', err);
            return cb(err);
        }
        // validating the apps.json contents
        var applist = null;
        try {
            applist = JSON.parse(contents);
        }
        catch (ex) {
            debug('CRITICAL ERROR PARSING apps.json', ex);
            return cb(ex);
        }
        if (!(applist instanceof Array)) {
            return cb(new Error("CRITICAL ERROR in apps.json - it is not an array."));
        }

        /*
         * Reload the userApps, checking each app and ignoring it if it is
         * missing critical properties.
         */
        userApps = [];
        applist.forEach(function (app) {
            if (!app || typeof app !== 'object') {
                debug('Ignoring invalid entry in apps.json', app);
                return;
            }
            if (!(app.domains instanceof Array)) {
                debug('Ignoring invalid app in apps.json - bad domains array', app);
                return;
            }
            if (typeof app.port !== 'number') {
                debug('Ignoring invalid app in apps.json - port is not a number', app);
                return;
            }
            if (typeof app.env !== 'object') {
                debug('Warn: app is missing env object', app);
            }
            app.env = app.env || {};
            userApps.push(app);
        });
        makeCerts();
    });

    /**
     * For the ssl enabled apps, add their credentials to the certificates tables.
     */
    var makeCerts = function () {
        var sheepCredentialsContext = getCredentialsContext({
            key: DEFAULT_KEY,
            cert: DEFAULT_CERT
        });
        certTable[systemInfo.ip] = sheepCredentialsContext;

        userApps.forEach(function (app) {
            if (app.key && app.cert && typeof app.key === 'string' && typeof app.cert === 'string') {

                if (app.ca && typeof app.ca === 'string') {
                    // clean up the CA cert text in case there are several, which is likely.
                    var splitter = '-----END CERTIFICATE-----';
                    var beginMessage = '-----BEGIN CERTIFICATE-----';
                    var certificateParts = app.ca.split(splitter);

                    certificateParts = certificateParts.filter(function (caCert) {
                        return caCert && caCert.indexOf(beginMessage) !== -1;
                    });

                    app.ca = certificateParts.map(function (caCert) {
                        return caCert += splitter;
                    });

                }

                app.domains.forEach(function (domain) {
                    var contextOpts = {
                        key: app.key,
                        cert: app.cert
                    };
                    if (app.passphrase) {
                        contextOpts.passphrase = app.passphrase;
                    }
                    if (app.ca) {
                        contextOpts.ca = app.ca;
                    }
                    certTable[domain] = getCredentialsContext(contextOpts);
                });
            }
        });
        debug('SSL table reloaded successfully.');
        makeTable();
    };

    var makeTable = function () {
        // route main IP requests to sheep
        routeTable[systemInfo.ip] = "http://127.0.0.1:" + sheepPort;

        userApps.forEach(function (app) {

            var unavail = ['start', 'ok', 'restart'].indexOf(app.status) === -1;
            if (unavail) {
                debug(app._id + ' is unavailable. Status: ' + app.status);
            }

            app.domains.forEach(function (domain) {
                if (!domain) {
                    return;
                }
                if (unavail) {
                    routeTable[domain] = 503;
                    return;
                }
                var localPath = "http://127.0.0.1:" + app.port;
                routeTable[domain] = localPath;
                // debug('Routing requests for', domain, 'to', localPath);
            });
        });

        // Some logging, then done.
        var reloadTimeMs = (process.hrtime(start)[1] / 1000000);
        debug('routes reloaded', reloadTimeMs.toFixed(3) + 'ms', Object.keys(routeTable));
        cb();
    };

};

/**
 * Start the sheep API server.
 */
var startApiServer = function (cb) {

    apiServer = sheep.listen(sheepPort, function () {
        debug('Sheep api server listening on port ' + apiServer.address().port);
        cb();

        sheep.events.on('app-start', function (appInfo) {
            debug('app-start', appInfo._id);
            reloadRouteTable();
        });
    });

    apiServer.on('error', function (err) {
        debug('SHEEP STARTUP ERROR', err);
        cb(err);
    });

    apiServer.on('close', function (code) {
        debug('SHEEP CLOSE', code);
        startApiServer(function (err) {
            debug('SHEEP RESTART', err || "");
        });
    });
};

/**
 * Setup and start the proxy server.
 * It accepts HTTP, HTTPS, and web sockets. Then sending them back to
 * the apps being hosted on this server.
 */
var startProxyServer = function (cb) {
    var secureOptions = {
        SNICallback: function (hostname) {
            return certTable[hostname];
        },
        key: DEFAULT_KEY,
        cert: DEFAULT_CERT,
        hostnameOnly: true
    };

    var proxyServerMiddleware = function (req, res) {

        var internalRoute = routeTable[req.headers.host];
        debugRequest('proxying', req.headers.host, 'to', internalRoute);

        // By default, requests that do not match a host are ignored.
        if (!internalRoute) {
            setTimeout(function () {
                var NO_RESPONSE = 444;
                var NO_RESPONSE_MESSAGE = JSON.stringify({ error: "No response" });
                res.statusCode = NO_RESPONSE;
                res.setHeader('Content-Type', 'application/json');
                res.end(NO_RESPONSE_MESSAGE);
            }, 500);
            return;
        }

        if (internalRoute === 503) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({error: "Service unavailable"}));
            return;
        }


          Proxy.web(req, res, {
            target: internalRoute,
            ws: true
        }, function (err) {
            if (err) {
                debug('FAIL Proxy.web', err);
            }
        });
    };

    // HTTP
    proxyServer = http.createServer(proxyServerMiddleware);
    proxyServer.listen(proxyPort, function () {
        debug('HTTP proxy server listening on port ' + proxyPort);
        cb();
    });
    proxyServer.on('error', function (err) {
        debug('HTTP PROXY STARTUP ERROR', err);
        cb(err);
    });
    proxyServer.on('close', function (code) {
        debug('HTTPS PROXY CLOSE', code);
        proxyServer = http.createServer(proxyServerMiddleware);
    });

    // HTTPS
    proxyServerSecure = https.createServer(secureOptions, proxyServerMiddleware);
    proxyServerSecure.listen(proxyPortSecure, function () {
        debug('HTTPS proxy server listening on port ' + proxyPortSecure);
        cb();
    });
    proxyServerSecure.on('error', function (err) {
        debug('HTTPS PROXY ERROR', err);
        cb(err);
    });
    proxyServerSecure.on('close', function (code) {
        debug('HTTPS PROXY CLOSE', code);
        proxyServerSecure = https.createServer(secureOptions, proxyServerMiddleware);
    });
};



// Startup tasks are exec'd here
async.series([
    listenForExceptions,
    startMessage,
    resetHashCheck,
    checkCertificate,
    startApiServer,
    reloadRouteTable,
    startProxyServer
], function (err) {
    if (err) {
        debug('FAILURE - proxy startup', err);
        return;
    }
    debug('Proxy startup success');

    /**
     * Periodically reload the routing table, so when apps are
     * removed, the changes are reflected in the table.
     */
    setInterval(reloadRouteTable, 5 * 60 * 1000);
});


})();

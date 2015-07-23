var sheep; // this app
(function () {
'use strict';

var debug = require('debug')('sheep:api');
var logger = require('debug')('sheep:http');
var connect = require('connect');
var path = require('path');
var child_process = require('child_process');
var exec = child_process.exec;
var bodyParser = require('body-parser');
var os = require('os');
var url = require('url');
var fs = require('fs');
var extract = require('tarball-extract');
var rimraf = require('rimraf');
var router = require('urlrouter');
var packageJson = require('./package.json');
var systemInfo = require('./system.json');
var hash = require('./lib/hash');
var forever = require('forever-monitor');
var async = require('async');
var disk = require('nodejs-disks');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var stripColorCodes = require('stripcolorcodes');
var semver = require('semver');
var getHome = function () {
    return process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
};

/**
 * Location where apps should be stored and saved.
 */
var APPS_PATH = path.join(__dirname, '../sheep_apps/');
/**
 * Location where apps should put their logs
 */
var LOGS_PATH = path.join(__dirname, '../sheep_logs/');

/**
 * Location of the apps.json stored apps.
 */
var APPS_FILE = path.join(APPS_PATH, 'apps.json');

/**
 * local memory cache of running child processes
 */
var PROCESSES = {};

var AppService; // instance of APPS

/**
 * Recursively get the size of a directory.
 */
function readSizeRecursive(item, cb) {
    fs.lstat(item, function(err, stats) {
        var total = stats.size;

        if (!err && stats.isDirectory()) {
            fs.readdir(item, function(err, list) {
                if (err) {
                    return cb(err);
                }

                async.forEach(
                    list,
                    function(diritem, callback) {
                        readSizeRecursive(path.join(item, diritem), function(err, size) {
                            total += size;
                            callback(err);
                        });
                    },
                    function(err) {
                        cb(err, total);
                    }
                );
            });
        }
        else {
            cb(err, total);
        }
  });
}
function getNpmPath(ver) {
    return '/usr/local/nvm/v' + ver + '/bin/npm';
}
function getNvmPath() {
    return '/usr/local/bin/nvm';
}
/**
 * Given a file path, is it a valid package.json with all the info to spawn
 * a child process?
 */
function packageJsonChecker(jsonFilePath, callback) {
    fs.readFile(jsonFilePath, { encoding: 'utf8' }, function (err, contents) {
        if (err) {
            return callback(err);
        }

        var packageJson = null;
        try {
            packageJson = JSON.parse(contents);
        }
        catch (ex) {
            return callback(new Error("Invalid package.json - " + err));
        }
        if (!packageJson) {
            return callback(new Error("Invalid package.json - " + packageJson));
        }
        if (!packageJson.engines || !packageJson.engines.node) {
            return callback(new Error("engines.node does not exist."));
        }
        if (!packageJson.engines || !packageJson.engines.node) {
            return callback(new Error("engines.node does not exist."));
        }
        if (!semver.valid(packageJson.engines.node)) {
            return callback(new Error("engines.node is not a valid version format. See semver."));
        }
        if (/[^v0-9\.]/.test(packageJson.engines.node)) {
            return callback(new Error("engines.node must be a specific version and cannot be a range."));
        }
        if (!packageJson.main || typeof packageJson.main !== 'string') {
            return callback(new Error("package.json must have a script specified in the 'main' field."));
        }
        if (!packageJson.domains || !packageJson.domains instanceof Array) {
            return callback(new Error("package.json must have a 'domains' array."));
        }
        var hasInvalidDomain = false;
        packageJson.domains.forEach(function (domain) {
            if (!domain || typeof domain !== 'string') {
                hasInvalidDomain = false;
                return;
            }
        });
        if (hasInvalidDomain) {
            return callback(new Error("package.json has an invalid domain."));
        }

        callback(null, packageJson);
    });
}

/**
 * Local memory cache of apps, with methods for manipulating them.
 * All disk saves are async and accept an optional callback, but return
 * the data you need.
 */
function APPS () {
    var apps = [];
    var self = this;

    /**
     * @param string appId optional
     * @returns array|object All apps, a single app, or null if the one app was not found.
     */
    self.get = function (appId) {
        if (!appId) {
            return apps;
        }
        var requestedApp = null;
        apps.every(function (app) {
            if (app._id === appId) {
                requestedApp = app;
                return false;
            }
            return true;
        });
        return requestedApp;
    };

    /**
     * Save the apps inside this class to disk.
     * @param function callback Optional
     * @returns undefined
     */
    self.save = function (callback) {
        callback = callback || function (err, apps) { };
        var appsJson = "";
        try {
            appsJson = JSON.stringify(apps, null, 2);
        }
        catch (ex) {
            debug('CRITICAL ERROR during stringify of apps', ex);
            debug('REFUSING to save apps.json');
            return callback(ex, apps);
        }
        fs.writeFile(APPS_FILE, appsJson, { encoding: 'utf8' }, function (err) {
            if (err) {
                debug('APPS SAVE FAIL', err);
            }
            callback(err, apps);
        });
    };

    /**
     * @returns array The new list of apps.
     */
    self.add = function (app, callback) {
        callback = callback || function (err) { };
        apps.push(app);
        self.save(callback);

        return apps;
    };

    /**
     * Remove an app from the cache and save the change to disk.
     * @param string appId
     * @param function callback Optional
     * @returns object The removed app, or null if not found.
     */
    self.remove = function (appId, callback) {
        callback = callback || function (err, removedApp) { };

        var requestedAppIndex = null;
        var requestedApp = null;

        apps.every(function (a, ix) {
            if(a._id === appId) {
                requestedAppIndex = ix;
                return false;
            }
            return true;
        });

        if(requestedAppIndex === null) {
            var msg = 'App not found by id ' + appId;
            debug(msg);
            var err = new Error(msg);
            err.statusCode = 404;
            callback(err, requestedApp);
            return requestedApp;
        }

        requestedApp = apps.splice(requestedAppIndex, 1);
        self.kill(requestedApp._id, function (saved) {
            if (err) {
                return callback(err);
            }
            self.save(callback);
        });

        return requestedApp;
    };

    /**
     * Reload the list of apps.
     * @param function callback Optional
     * @returns undefined
     */
    self.refresh = function (callback) {
        callback = callback || function (err, apps) { };
        fs.readFile(APPS_FILE, {encoding: 'utf8'}, function (err, appsFile) {
            if (err) {
                debug('Error reading apps file', err);
                return callback(new Error('Error reading apps file'));
            }

            try {
                apps = JSON.parse(appsFile);
            }
            catch(_err) {
                err = _err;
            }
            callback(err, apps);
        });
    };

    /**
     * Update an appId with the given params. Leave other properties alone.
     * @param string appId
     * @param object params The stuff to update, key: value pairs.
     * @param callback optional
     * @returns object The updated app, or null if it failed.
     */
    self.update = function (appId, params, callback) {
        var app = self.get(appId);

        if (!app) {
            var msg = 'App not found during update: ' + appId;
            debug(msg);
            var err = new Error(msg);
            err.statusCode = 404;
            callback(err, app);
            return app;
        }

        if (typeof params === 'object') {
            Object.keys(params).forEach(function (key) {
                app[key] = params[key];
            });
        }
        else {
            var errMsgParams = 'App ' + appId + ' update failed: params is not an object';
            debug(errMsgParams);
            var errParams = new Error(errMsgParams);
            errParams.statusCode = 400;
            callback(errParams, app);
            return null;
        }

        var requestedAppIndex = null;
        apps.every(function (a, ix) {
            if (a._id === appId) {
                requestedAppIndex = ix;
                return false;
            }
            return true;
        });

        if (requestedAppIndex === null) {
            var msgApp = 'Could not find app ' + appId + ' all of a sudden during update!';
            debug(msgApp);
            var errApp = new Error(msgApp);
            errApp.statusCode = 500;
            callback(errApp, app);
            return null;
        }

        apps[requestedAppIndex] = app;
        self.save(callback);

        return app;
    };

    /**
     * Asynchronously start up an app and add it to the PROCESSES object
     * at the key 'appId' if it has no errors in the first few moments
     * of being forked.
     *
     * When it exits while status is still 'ok', the app will be updated
     * as 'exit' and removed from the PROCESSES object.
     *
     * It WILL try to restart itself a few times on exit before giving up.
     *
     * @param string appId
     * @param function callback Required, with args (err, child_process)
     * @returns undefined
     */
    self.start = function (appId, cb) {

        var child;
        var finalEnv;
        var err;

        var requestedApp = self.get(appId);

        if (!requestedApp) {
            err = new Error('App not found', appId);
            err.statusCode = 404;
            return cb(err);
        }

        if (PROCESSES[appId]) {
            return cb(new Error("Process is already running for app " + appId));
        }

        async.series([
            /**
             * Checking the package.json file, extracting information like the
             * main script, node runtime version, and domains. Saving the info.
             */
            function (callback) {
                var jsonpath = path.join(APPS_PATH, requestedApp._id, 'package.json');
                packageJsonChecker(jsonpath, function (err, packageJson) {
                    if (err) {
                        return callback(err);
                    }

                    requestedApp = self.update(requestedApp._id, {
                        domains: packageJson.domains,
                        engines: packageJson.engines,
                        main: packageJson.main
                    }, callback);
                });
            },
            function (callback) {
                var fullScriptPath = path.join(APPS_PATH, requestedApp._id, requestedApp.main);
                fs.exists(fullScriptPath, function (exists) {
                    if (!exists) {
                        return callback(new Error("main script does not exist: " + requestedApp.main));
                    }
                    callback();
                });
            },
            function (callback) {
                /**
                 * Forks a child process and returns that child.
                 *
                 * Also executes the callback after the startup period.
                 *
                 * This is the actual function for forking child processes and
                 * ensuring they live for a little while.
                 */

                debug('Forking child node process for app ' + appId);

                finalEnv = JSON.parse(JSON.stringify(requestedApp.env));
                finalEnv.PAASTOR_PORT = requestedApp.port;

                child = new (forever.Monitor)(requestedApp.main, {
                    max: 10000,
                    silent: true,
                    sourceDir: path.join(APPS_PATH, requestedApp._id),
                    killTree: true,
                    cwd: path.join(APPS_PATH, requestedApp._id),
                    env: finalEnv,
                    command: getNvmPath() + ' run ' + requestedApp.engines.node,
                    outFile: requestedApp.outFile,
                    errFile: requestedApp.errFile
                });
                child.appId = appId;
                PROCESSES[appId] = child;
                // callback gets put here
                child.on('start', startHandler(callback));
                child.start();
            }
        ], cb);



        /**
         * This is what gets passed into forkit() and is executed
         * after the app is started.
         *
         * It determines if a startup error occurred. If so it will
         * callback() that error. Otherwise it will add some listeners
         * including a watch on 'exit' that will automatically
         * restart the process for a few rounds.
         */
        function startHandler(callback) {
            return function () {

                var trackErr = "";

                child.on('error', function (err) {
                    debug('app error', appId, err);
                    trackErr += err + '\n';
                    self.update(appId, { status: 'error' });
                });

                // Determines whether to try restarting it.
                child.on('exit', function () {
                    debug('app exit', appId);
                    trackErr += 'premature exit';
                    delete PROCESSES[appId];

                    self.update(appId, { status: 'exit' });
                });

                setTimeout(function () {
                    child.removeAllListeners();
                    if (trackErr) {
                        return callback(trackErr, child);
                    }
                    child.on('stop', function () {
                        debug('app stop', appId);
                        self.update(appId, { status: 'stop' });
                    });
                    child.on('restart', function () {
                        debug('app restart', appId);
                        self.update(appId, { status: 'restart' });
                    });
                    child.on('error', function (err) {
                        debug('app error', appId, err);
                        self.update(appId, { status: '' });
                    });
                    child.on('exit', function () {
                        debug('app exit', appId);
                        delete PROCESSES[appId];
                    });
                    var didSave = self.update(appId, { status: 'start' });
                    if (!didSave) {
                        debug("App started successfully, but some data was not saved.'", requestedApp);
                    }

                    callback(trackErr || null, child);

                    process.nextTick(function () {
                        // the proxy listens to this and will reload the routing tables
                        sheep.events.emit('app-start', requestedApp);
                    });
                }, 5000);

            };
        }

    };

    /**
     * Async killing of a process by appId.
     * @params string appId
     * @param function callback
     * @returns undefined
     */
    self.kill = function (appId, callback) {
        debug('Kill: requested', appId);
        callback = callback || function (err) { };
        var requestedApp = self.get(appId);
        if (!requestedApp) {
            callback(new Error(appId + " is not on this server."));
            return;
        }

        var child = PROCESSES[appId];
        if (!child) {
            callback(new Error(appId + " is present, but not running."));
            return;
        }
        debug('Kill: found child', child.appId);
        // debug('Kill: child', typeof child.kill);
        try {
            child.stop(true);
        }
        catch (ex) {
            return callback(ex);
        }
        debug('Kill: done');
        delete PROCESSES[appId];
        var updatedApp = self.update(appId, { status: 'stop' }, callback);
        if (!updatedApp) {
            callback(new Error("Stopped the app, but could not save its state."));
            return;
        }
    };
}

/**
 * Get information about this sheep.
 */
function getInfo (callback) {
    var info = {
        name: packageJson.name,
        version: packageJson.version
    };

    var bytesToReadable = function (bytes) {
        var kb = 1024;
        var mb = 1024 * kb;
        var gb = 1024 * mb;

        if (bytes < kb) {
            return bytes + ' B';
        }
        if (bytes < mb) {
            return (bytes/kb).toFixed(2) + ' KB';
        }
        if (bytes < gb) {
            return (bytes/mb).toFixed(2) + ' MB';
        }
        return (bytes/gb).toFixed(2) + ' GB';
    };

    async.parallel([
        function (cb) {
            // list all drives and get their stats
            disk.drives(function (err, drives) {
                if (err) {
                    return cb(err);
                }
                disk.drivesDetail(drives, function (err, data) {
                    if (err) {
                        return cb(err);
                    }

                    info.drives = data;
                    cb();
                });
            });
        },
        function (cb) {
            readSizeRecursive(APPS_PATH, function (err, size) {
                if (err) {
                    cb(err);
                }
                info.apps_size = bytesToReadable(size);
                cb();
            });
        },
        function (cb) {
            readSizeRecursive(LOGS_PATH, function (err, size) {
                if (err) {
                    cb(err);
                }
                info.logs_size = bytesToReadable(size);
                cb();
            });
        },
        function (cb) {
            // get the rest of the information

                Object.keys(os).forEach(function (key) {
                    var osProp = os[key];
                    if (key === 'getNetworkInterfaces') {
                        return;
                    }
                    if (osProp instanceof Function) {
                        info[key] = osProp();
                    }
                    else {
                        info[key] = osProp;
                    }
                });

                // info.env = process.env;

                info.processes = Object.keys(PROCESSES);
                info.apps = JSON.parse(JSON.stringify(AppService.get())); // copy as JSON
                if (info.apps && info.apps.length) {
                    // remove potentially sensitive info that is not necessary,
                    // but indicate that the app has SSL capabilities
                    info.apps.forEach(function (a) {
                        if (a.cert || a.key) {
                            a.ssl = true;
                        }
                        delete a.cert;
                        delete a.passphrase;
                        delete a.key;
                        delete a.ca;
                    });
                }
                cb(null);
        },
        function (cb) {
            exec(getNvmPath() + ' ls', function (err, stdout) {
                var cleaned = stripColorCodes(stdout);
                var list = cleaned.split('\n');
                var outList = [];
                list.forEach(function (ver) {
                    var trimmed = ver.trim();
                    trimmed = trimmed.replace(/[^0-9\.]/g,'');
                    if (trimmed && outList.indexOf(trimmed) === -1 ) {
                        outList.push(trimmed);
                    }
                });
                info.node_versions = outList;
                cb();
            });
        }
    ], function (err) {
        callback(err, info);
    });

}



// Setting up necessary directory and file structure.
if (!fs.existsSync(APPS_PATH)) {
    debug('SETUP: apps folder does not exist. creating', APPS_PATH);
    fs.mkdirSync(APPS_PATH);
}
if (!fs.existsSync(LOGS_PATH)) {
    debug('SETUP: logs folder does not exist. creating', LOGS_PATH);
    fs.mkdirSync(LOGS_PATH);
}
var makeAppsFile = function () {
    debug('SETUP: writing new apps.json');
    fs.writeFileSync(APPS_FILE, '[]', { encoding: 'utf8'});
};
// make sure it is a valid file on startup.
var checkAppsFile = function () {
    var appsContents = "";
    try {
        appsContents = fs.readFileSync(APPS_FILE, { encoding: 'utf8' });
    }
    catch (ex) {
        debug('SETUP: error reading apps.json', ex);
        makeAppsFile();
        appsContents = "[]";
    }
    try {
        appsContents = JSON.parse(appsContents);
    }
    catch (ex) {
        debug('SETUP: Invalid JSON of apps.json', ex);
        makeAppsFile();
        // TODO: implement reconstructing apps.json from directory
    }
};
checkAppsFile();


/**
 * Instantiate a new service and attempt to start all cached apps.
 */
AppService = new APPS();
AppService.refresh(function (err, apps) {
    if (err) {
        debug('ERROR reloading apps on startup', err);
        return;
    }
    debug('Successfully reloaded apps on startup.', apps.length);

    AppService.get().forEach(function (app) {
        // intentionally stopped
        if (app.status === 'stop' || app.status === 'error' || app.status === 'created') {
            debug('not restarting app because status=' + app.status, app._id);
            return;
        }

        debug('attempting to restart app on sheep boot', app._id);
        AppService.start(app._id, function (err) {
            if (err) {
                debug('app restart failed on sheep boot', app._id, err);
                return;
            }
        });
    });
});



/**
 * Connect.js server
 */
sheep = connect();

/**
 * Custom events are emitted at
 */
var Evts__ = function () {};
util.inherits(Evts__, EventEmitter);
sheep.events = new Evts__();

sheep.use(bodyParser.json({ limit: '100mb' }));

sheep.use(function pretimer(req, res, next) {
    req.startTime = process.hrtime();
    next();
});
sheep.use(function makeLikeExpress(req, res, next) {

    res.send = function (code, data) {
        if (typeof code === 'number') {
            res.statusCode = code;
        }
        else {
            data = code;
        }

        var output = data;
        if (typeof data === 'object') {
            try {
                output = JSON.stringify(data);
            }
            catch (ex) {
                debug('Failed to stringify response', ex);
            }
        }
        res.end(output);
        var reqTime = process.hrtime(req.startTime);
        logger(req.method, req.pathname, res.statusCode, ((reqTime[0] * 1000) + (reqTime[1] / 1000000)).toFixed(1) + 'ms');
    };

    var parsedUrl = url.parse(req.url, true);
    req.query = parsedUrl.query || {};
    req.path = parsedUrl.path;
    req.pathname = parsedUrl.pathname;
    res.setHeader('Content-Type', 'application/json');
    next();
});
sheep.use(function noFavicon(req, res, next) {
    if (req.url === '/favicon.ico') {
        var err = new Error("Not found");
        err.statusCode = 404;
        return next(err);
    }
    next();
});

sheep.use(function authMiddleware(req, res, next) {
    var secret = req.headers['paastor-secret'] || req.query['Paastor-Secret'];
    var err;
    if (!secret || typeof secret !== 'string') {
        err = new Error('Unauthorized');
        err.statusCode = 401;
    }
    else if (hash(secret) !== systemInfo.secret) {
        err = new Error('Authorization failed');
        err.statusCode = 401;
    }

    if(err) {
        setTimeout(function () {
            debug('Failed auth middleware', err);
            next(err);
        }, 500);
        return;
    }
    next();
});


/**
 * URL Routes
 */
var routes = router(function (sheep) {

    sheep.get('/', function (req, res, next) {
        getInfo(function (err, info) {
            if (err) {
                return next(err);
            }
            res.send(info);
        });

    });

    sheep.get('/apps/:_id/logs', function (req, res, next) {
        var requestedApp = AppService.get(req.params._id);
        if (!requestedApp) {
            var err = new Error("Logs can not be found by appId " + req.params._id);
            err.statusCode = 404;
            return next(err);
        }
        var logs = {};
        async.parallel([
            // function (cb) {
            //     fs.readFile(requestedApp.logFile, { encoding: 'utf8' }, function (err, contents) {
            //         if (err) {
            //             return cb(err, contents);
            //         }
            //         logs.logs = contents;
            //         cb();
            //     });
            // },
            function (cb) {
                fs.readFile(requestedApp.outFile, { encoding: 'utf8' }, function (err, contents) {
                    if (err) {
                        return cb(err, contents);
                    }
                    logs.stdout = contents;
                    cb();
                });
            },
            function (cb) {
                fs.readFile(requestedApp.errFile, { encoding: 'utf8' }, function (err, contents) {
                    if (err) {
                        return cb(err, contents);
                    }
                    logs.stderr = contents;
                    cb();
                });
            }
        ], function (err) {
            if (err) {
                logs.error = err;
            }
            res.send(logs);
        });
    });

    /**
     * sheep.createApp()
     */
    sheep.post('/apps', function (req, res, next) {
        var apps = AppService.get();

        var newApp = req.body;

        //
        // Validations for the app being posted.
        //

        var validationError = null;
        if (typeof newApp._id !== 'string') {
            validationError = new Error('Invalid app _id: ' + newApp._id);
        }
        else {
            if(AppService.get(newApp._id)) {
                validationError = new Error('App _id is taken: ' + newApp._id);
            }
        }

        if (!validationError && typeof newApp.env !== 'object') {
            // let it slide
            try {
                newApp.env = JSON.parse(newApp.env);
            } catch (ignored) {
                newApp.env = {};
            }
        }

        if (validationError) {
            validationError.status = 400;
            return next(validationError);
        }

        // Assign a port
        debug('assigning port to new app', newApp._id);
        var appPort = 3050;
        var portNotInUse = function () {
            var notinuse = AppService.get().every(function (p) {
                return p.port !== appPort;
            });
            return notinuse;
        };
        while (!portNotInUse()) {
            appPort++;
        }
        debug('port chosen for new app ' + newApp._id, appPort);
        newApp.port = appPort;

        // Set log files
        // newApp.logFile = path.join(LOGS_PATH, newApp._id + '.log');
        newApp.outFile = path.join(LOGS_PATH, newApp._id + '-out.log');
        newApp.errFile = path.join(LOGS_PATH, newApp._id + '-err.log');

        newApp.status = 'created';

        var saved = AppService.add(newApp);
        if (!saved) {
            return next(new Error("New app could not be saved: " + newApp._id));
        }
        res.send(saved);

    });

    /**
     * Push a new version of the app
     */
    sheep.put('/apps/:_id/pkg', function (req, res, next) {
        debug('pushed package for ' + req.params._id,
            req.body.noNpm ? 'no npm install' : 'will npm install');

        var requestedApp = AppService.get(req.params._id);
        if (!requestedApp) {
            return res.send(404, { error: "Not found by app Id: " + req.params._id });
        }

        var newApp = req.body;
        newApp._id = req.params._id;
        var validationError = null;
        if (!validationError && typeof newApp.pkg !== 'string') {
            validationError = new Error('Invalid app package');
        }
        if (!validationError && !newApp.pkg.length) {
            validationError = new Error('App package is empty');
        }
        if (validationError) {
            validationError.status = 400;
            return next(validationError);
        }

        var pkg = newApp.pkg; // this is a zip file
        // var zipFileData = new Buffer(pkg, 'base64');
        var zipFilePath = path.join(APPS_PATH, newApp._id + '.tgz');
        var outputDir = path.join(APPS_PATH, newApp._id);
        debug('trying to remove then write zip file to disk', zipFilePath);
        // cleanup any existing archives first
        try{
            debug('try cleanup zip path', zipFilePath);
            fs.unlinkSync(zipFilePath);
            debug('cleaned up zip path', zipFilePath);
        } catch(cleanupErr) {
            debug('OK warn: pre-cleanup zip failed', zipFilePath, cleanupErr);
        }
        try {
            debug('try cleanup outputDir', outputDir);
            rimraf.sync(outputDir);
            debug('cleaned up outputDir', outputDir);
        } catch(cleanupErr) {
            debug('OK warn: pre-cleanup outputDir failed', outputDir, cleanupErr);
        }

        fs.writeFileSync(zipFilePath, new Buffer(pkg, 'base64'));
        debug('got pkg and wrote to', zipFilePath);

        // delete the package because it's huge
        delete newApp.pkg;

        // Expand the package archive.
        extract.extractTarball(zipFilePath, outputDir, function (err) {
            if (err) {
                debug('extract error', err);
                return next(err);
            }
            debug('Confirming extraction');
            var extractedFolder = fs.existsSync(outputDir);
            if (!extractedFolder) {
                debug('Extract succeeded but there are no files', outputDir);
                return next(new Error("Failed to extract files"));
            }
            debug('Files are now extracted at', outputDir);

            debug('Checking package.json', outputDir);

            packageJsonChecker(path.join(outputDir, 'package.json'), function (err, packageJson) {

                if (err) {
                    return next(err);
                }


                var respond = function (stdout) {
                    AppService.update(newApp._id, { status: 'pushed', logs: stdout || 'push ok' });

                    res.send(newApp);

                    // clean up the zip file, while leaving the extracted app
                    debug('Removing zip file', zipFilePath);
                    fs.unlink(zipFilePath, function (err) {
                        if (err) {
                            debug('FAIL removing zip for app ' + newApp._id, err);
                        }
                    });

                };

                if (newApp.noNpm) {
                    respond();
                    return;
                }

                debug('npm install - ' + newApp._id);
                exec('cd ' + outputDir + ' && ' + getNpmPath(packageJson.engines.node) + ' install', function (err, stdout, stderr) {
                    if (err) {
                        debug('FAILED npm install', err, stdout, stderr);
                        AppService.update(
                            newApp._id,
                            { status: 'install_fail', logs: stdout + '\n\n' + err }
                        );
                        return next(err);
                    }

                    debug('Success: npm install.\n', stdout, '\n');
                    respond(stdout);

                });
            });

        });

    });

    sheep.put('/apps/:_id/start', function (req, res, next) {

        // Attempt to start the app
        AppService.start(req.params._id, function (err, child) {
            if (err) {
                return next(err);
            }
            var app = AppService.get(req.params._id);
            res.send(app);
        });

    });
    sheep.put('/apps/:_id/restart', function (req, res, next) {

        AppService.kill(req.params._id, function (err) {
            if (err) {
                return next(err);
            }
            setTimeout(function () {
                AppService.start(req.params._id, function (err, child) {
                    if (err) {
                        return next(err);
                    }
                    res.send(AppService.get(req.params._id));
                });
            }, 3000);
        });

    });

    sheep.put('/apps/:_id/kill', function (req, res, next) {
        AppService.kill(req.params._id, function (err) {
            if (err) {
                return next(err);
            }
            res.send({ message: req.params._id + ' was stopped.' });
        });
    });
    // update the entire environment
    sheep.put('/apps/:_id/env', function (req, res, next) {
        debug('request to replace app env', req.params._id);
        var app = AppService.get(req.params._id);
        if (!app) {
            var err = new Error("App not found by _id during env update. " + req.params._id);
            err.statusCode = 404;
            return next(err);
        }

        app.env = req.body;
        app = AppService.update(req.params._id, { env: app.env });
        if (!app) {
            return next(new Error("Updating app env failed."));
        }

        res.send(app);
    });
    // update a specific key
    sheep.put('/apps/:_id/setvar', function (req, res, next) {
        debug('request to update app env ' + req.body.key, req.params._id);
        var app = AppService.get(req.params._id);
        if (!app) {
            var err = new Error("App not found by _id " + req.body._id);
            err.statusCode = 404;
            return next(err);
        }

        // checking for numeric values and parsing them accordingly
        if (req.body.val) {
            // ignore leading zeroes
            if (req.body.val[0] !== '0') {
                // is it a number
                if (!isNaN(req.body.val)) {
                    var floated = parseFloat(req.body.val);
                    if (!isNaN(floated)) {
                        req.body.val = floated;
                    }
                }
            }
        }

        app.env = app.env || {};
        app.env[req.body.key] = req.body.val;
        app = AppService.update(req.params._id, { env: app.env });
        if (!app) {
            return next(new Error("Updating app env " + req.body.key + " failed."));
        }

        res.send(app);
    });
    // update the ssl info
    sheep.put('/apps/:_id/ssl', function (req, res, next) {
        debug('request to replace app SSL', req.params._id);
        var app = AppService.get(req.params._id);
        if (!app) {
            var err = new Error("App not found by _id during SSL update. " + req.params._id);
            err.statusCode = 404;
            return next(err);
        }


        app = AppService.update(req.params._id, {
            key: req.body.key,
            cert: req.body.cert,
            passphrase: req.body.passphrase,
            ca: req.body.ca
        });
        if (!app) {
            return next(new Error("Updating app SSL failed."));
        }

        res.send(app);
    });
    sheep.get('/apps/:_id', function (req, res, next) {
        var app = AppService.get(req.params._id);
        if (!app) {
            return next();
        }
        res.send(app);
    });



    // get server logs
    sheep.get('/logs', function (req, res, next) {
        var logs = {};
        async.parallel([
            function (cb) {
                fs.readFile('/root/sheep.log', { encoding: 'utf8' }, function (err, contents) {
                    // send back the contents anyways
                    logs.logs = contents;
                    cb(err);
                });
            },
            function (cb) {
                fs.readFile('/root/sheep-out.log', { encoding: 'utf8' }, function (err, contents) {
                    // send back the contents anyways
                    logs.stdout = contents;
                    cb(err);
                });
            },
            function (cb) {
                fs.readFile('/root/sheep-err.log', { encoding: 'utf8' }, function (err, contents) {
                    // send back the contents anyways
                    logs.stderr = contents;
                    cb(err);
                });
            },
        ], function (err) {
            if (err) {
                logs.error = err;
            }
            res.send(logs);
        });

    });

    /**
     *
     */
    sheep.post('/node/:version', function (req, res, next) {
        debug('sheep request to install node ' + req.params.version);

        var twoMegs = 2 * 1024 * 1024 * 1024;

        var isValidVer = semver.valid(req.params.version);
        if (!isValidVer) {
            return res.send(400, { error: 'Version is not valid: ' + req.params.version });
        }

        var alreadyResponded = false;
        var waitForFailure = 4000;

        exec(getNvmPath() + ' install ' + req.params.version,
            { maxBuffer: twoMegs},
            function (err) {
                if (err) {
                    debug('FAILED install - Node ' + req.params.version, err);
                    if (!alreadyResponded) {
                        res.send(500, { error: "Error installing node version "
                            + req.params.version + " - " + err });
                        alreadyResponded = true;
                    }
                    return;
                }

                var msg = 'SUCCESS install - Node ' + req.params.version;
                debug(msg);

                if (alreadyResponded) {
                    // already failed or succeeded
                    return;
                }
                res.send(200, { message: msg });
                alreadyResponded = true;
            }
        );

        setTimeout(function () {
            if (alreadyResponded) {
                return;
            }
            alreadyResponded = true;
            res.send(200, {
                message: 'Started installation of Node version ' + req.params.version
            });
        }, waitForFailure);
    });

    // remove an app
    sheep.delete('/apps/:_id', function (req, res, next) {

        debug('request to delete app', req.params._id);

        var app = AppService.remove(req.params._id);
        if (!app) {
            return next(new Error("Removing app failed"));
        }
        res.send(app);
    });
});

sheep.use(routes);

// Error handlers
sheep.use(function notFoundMiddleware(req, res, next) {
    var err = new Error('Sheep route not matched');
    err.statusCode = 404;
    next(err);
});

sheep.use(function errorMiddleware(err, req, res, next) {
    res.statusCode = err.statusCode || 500;
    var data = {
        message: err.message,
        error: err
    };
    res.send(data);
});

})();

module.exports = sheep;

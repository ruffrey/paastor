'use strict';
var request = require('request');
request = request.defaults({ strictSSL: false });
var rimraf = require('rimraf');
var _ = require('lodash');
var debug = require('debug')('sheep-client');
var url = require('url');
var fs = require('fs');
var path = require('path');
var archiver = require('archiver');
var exec = require('child_process').exec;
var uuid = require('uuid');
var path = require('path');
var os = require('os');
var async = require('async');

var git = function () {
    this.clone = function (sshPrivateKey, repoUrl, branchName, outputFolder, callback) {
        var tempGitSshFile = path.join(os.tmpdir(), 'git-ssh-' + uuid.v4());
        var tempKeyFile = path.join(os.tmpdir(), 'key-' + uuid.v4());

        async.parallel([
            function (cb) {
                fs.writeFile(
                    tempKeyFile,
                    sshPrivateKey,
                    { encoding: 'utf8' },
                    cb
                );
            },
            function (cb) {
                fs.writeFile(
                    tempGitSshFile,
                    '#!/bin/bash\n  ssh -i ' + tempKeyFile + ' $1 $2',
                    { encoding: 'utf8' },
                    cb
                );
            }
        ], doClone);

        function doClone(err, arg) {
            if (err) {
                return callback(err, arg);
            }
            var gitCmd = 'git clone ' + repoUrl + ' ' + outputFolder;
            var execOpts = {
                env: {
                    GIT_SSH: tempGitSshFile
                }
            };
            exec(gitCmd, execOpts, doCheckout);
        }

        function doCheckout(err, stdout, stderr) {
            if (err) {
                return callback(err, stderr);
            }
            debug('git clone', stdout);

            exec('git checkout ' + branchName, cleanup);
        }

        function cleanup(err, stdout, stderr) {
            if (err) {
                return callback(err, stderr);
            }
            debug('git checkout', stdout);

            async.parallel([
                function (cb) {
                    fs.unlink(tempKeyFile, cb);
                },
                function (cb) {
                    fs.unlink(tempGitSshFile, cb);
                }
            ], function (err, arg) {
                if (err) {
                    return callback(err, arg);
                }
                callback();
            });
        }
    };
};

/**
 *
 */
function SheepClient(urlBase, secret) {
    var sheep = this;

    if (typeof urlBase !== 'string') {
        debug('tried to instantiate without urlBase', urlBase);
        // throw new Error('SheepClient urlBase is invalid: ' + urlBase);
    }
    if (typeof secret !== 'string') {
        debug('tried to instantiate without secret', secret);
        // throw new Error('SheepClient secret is invalid: ' + secret);
    }

    var defaults = {
        url: (urlBase.indexOf('127.0.0.1') === -1 ? 'https' : 'http' ) + '://' + urlBase,
        json: true,
        body: {},
        qs: null,
        headers: {
            'Paastor-Secret': secret
        }
    };

    sheep.getOptions = function (apiPath) {
        var generatedOptions = _.clone(defaults);
        generatedOptions.url = url.resolve(generatedOptions.url, apiPath);
        return generatedOptions;
    };

    sheep._request = function (opts, callback) {

        request(opts, function (err, response, body) {

            if (err) {
                debug('Sheep request error: ' + err + '  ' + opts.url, body);
                return callback(err, body);
            }
            if (response && response.statusCode !== 200) {
                debug("Sheep failed statusCode: " + response.statusCode, opts.url);
                err = new Error("Sheep says " + (JSON.stringify(body ? (body.message || body.error || body) : "no response")));
            }
            if (!response) {
                debug("No response from sheep using opts", opts);
            }

            callback(err, body);

        });
    };

    // make a default ping when instantiating the client
    // ACTUALLY - don't do this.
    // sheep._request(this.getOptions('/'), function (err) {
    //     if (err) {
    //         debug('Error reaching sheep on instantiation of client', urlBase);
    //     }
    //     else {
    //         debug('Sheep client ping successful', urlBase);
    //     }
    // });



    sheep.info = function (callback) {
        var opts = this.getOptions('/');
        opts.method = 'GET';
        sheep._request(opts, callback);
    };

    sheep.serverLogs = function (callback) {
        var opts = this.getOptions('/logs');
        opts.method = 'GET';
        sheep._request(opts, callback);
    };

    sheep.appLogs = function (appId, callback) {
        if (!appId) {
            return callback(new Error("Cannot get logs without app _id."));
        }
        var opts = this.getOptions('/apps/' + appId + '/logs');
        opts.method = 'GET';
        sheep._request(opts, callback);
    };

    /**
     * Perform a PUT and specified action to the app.
     * @param {string} app id
     * @param {string} strActionName An action to perform from the following: 'start', 'restart', 'kill'
     * @param {object} body Optional
     * @param {function} callback
     */
    sheep.action = function (id, strActionName, body, callback) {
        var opts = sheep.getOptions('/apps/' + id + '/' + strActionName);
        // only three args
        if (body instanceof Function && !callback) {
            callback = body;
        }
        else if(typeof body === 'object') {
            opts.body = body;
        }
        opts.method = 'PUT';
        sheep._request(opts, callback);
    };

    sheep.createApp = function (params, callback) {
        var opts = sheep.getOptions('/apps');
        opts.method = 'POST';
        opts.body = params;
        sheep._request(opts, callback);
    };

    sheep.setvar = function (id, envKey, envVal, callback) {
        var opts = sheep.getOptions('/apps/' + id + '/setvar');
        opts.method = 'PUT';
        opts.body = {
            key: envKey,
            val: envVal
        };
        sheep._request(opts, callback);
    };

    sheep.setSsl = function (id, sslParams, callback) {
        var opts = sheep.getOptions('/apps/' + id + '/ssl');
        opts.method = 'PUT';
        opts.body = sslParams;
        sheep._request(opts, callback);
    };

    this.pushPackage = function (appId, params, callback) {

        if (!params) {
            return callback(new Error("Push package params: invalid", params));
        }
        if (!params.pkg || typeof params.pkg !== 'string') {
            return callback(new Error("Package must be a base64 encoded zip file.", params.pkg));
        }
        if (params.pkg.length < 80) {
            return callback(new Error("Package seems too small to be an entire app.", params.pkg));
        }
        debug('push package: ' + appId, 'noNpm: ' + params.noNpm);
        var opts = sheep.getOptions('/apps/' + appId + '/pkg');
        opts.body = params;
        opts.method = "PUT";
        sheep._request(opts, callback);
    };

    this.removeApp = function (appId, callback) {
        var opts = sheep.getOptions('/apps/' + appId);
        opts.method = 'DELETE';
        sheep._request(opts, callback);
    };

    // this takes a very long time.
    this.installNodeVersion = function (ver, callback) {
        var opts = sheep.getOptions('/node/' + ver);
        opts.method = 'POST';
        sheep._request(opts, callback);
    };


    return this;


    // OLD VERSION of create app. Has example of checking out from git.

    // sheep.createApp = function (params, callback) {

    //     var opts = sheep.getOptions('/apps');
    //     opts.method = 'POST';
    //     opts.body = params;
    //     var repoPath;
    //     var zipPath;

    //     // package was already supplied as a base64 string of a blob tar archive
    //     if (opts.pkg) {
    //         debug('app was already packaged');
    //         doRequest();
    //         return;
    //     }


    //     debug('About to download app from git', opts.body.gitUrl, opts.body.gitBranch);

    //     repoPath = path.join(os.tmpdir(), opts.body._id);
    //     zipPath = path.join(os.tmpdir(), opts.body._id + '.tgz');

    //     // clean the dir if it already existed
    //     try {
    //         rimraf.sync(repoPath);
    //     } catch(ignored) { }
    //     try {
    //         fs.unlinkSync(zipPath);
    //     } catch(ignored) { }

    //     // check out the app
    //     git.clone(opts.body.sshkey_private, opts.body.gitUrl, repoPath, opts.body.gitBranch, function (err, stderr) {
    //           if (err) {
    //               debug('err during git task', err, stderr);
    //             return callback(err);
    //           }
    //           debug('Cloned to', repoPath);
    //           debug('Checked out', opts.body.gitBranch);

    //           // for security, dispose of the key since it is no longer needed.
    //           delete opts.body.sshkey_private;

    //           // now on the branch. zip the branch. done synchronously.
    //           debug('Creating archive file at', zipPath);
    //           var output = fs.createWriteStream(zipPath);
    //           var archive = archiver('tar', {
    //             gzip: true,
    //             gzipOptions: {
    //                 level: 1
    //             }
    //         });

    //         archive.on('error', function (err) {
    //             debug('Error saving archive', err);
    //               return callback(err);
    //         });

    //         // When finished writing the archive
    //         output.on('close', archiveOnCloseHandler);
    //         // Commands to finish the archive and trigger
    //         archive.pipe(output);
    //         archive.bulk([
    //               { expand: true, cwd: repoPath, src: [ '**/*'] }
    //         ]);
    //         archive.finalize();


    //         function archiveOnCloseHandler() {
    //               debug('archiver done: ' + zipPath, archive.pointer() + ' total bytes');

    //               debug('Getting data as base64');
    //               fs.readFile(zipPath, { encoding: 'base64' }, function (err, data) {
    //                   if (err) {
    //                       debug('read archive error', err);
    //                       return callback(err);
    //                   }

    //                 debug('Got archive as base64');
    //                   opts.body.pkg = data;

    //                 doRequest();
    //                 debug('Making request to sheep', opts.method, opts.url);
    //                 cleanup();

    //               });
    //         }

    //     });

    //     function doRequest() {
    //         sheep._request(opts, function finalCallback(err, body) {
    //             if (err) {

    //                 // opts.pkg is often GIGANTIC because it is a base64 zip blob.
    //                 // So instead of ruining the debugging info, we just log the length.
    //                 opts.body.pkg_length_was = opts.body.pkg ? opts.body.pkg.length : 0;
    //                 delete opts.body.pkg;

    //                 debug('Sheep returned error on app post', opts, err);
    //                 return callback(err, body);
    //             }
    //             if (!body) {
    //                 debug('Sheep returned empty body - but no error - after app post!!!');
    //                 return callback(new Error("Empty response body from VPS after post"), body);
    //             }
    //             if (!body.path) {
    //                 err = new Error('Sheep did not respond with the path to the extracted archive');
    //                 debug(err, body);
    //                 return callback(err, body);
    //             }

    //             callback(err, body);
    //         });
    //     }

    //     function cleanup() {
    //         // Afterwards - remove temp dir async
    //         rimraf(repoPath, function (err) {
    //             if(err) {
    //                 debug('Error removing repoPath', repoPath, err);
    //             }
    //         });
    //         fs.unlink(zipPath, function (err) {
    //             if(err) {
    //                 debug('Error removing zipPath', zipPath, err);
    //             }
    //         });
    //     }

    // };



}


exports = module.exports = SheepClient;

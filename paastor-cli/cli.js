#!/usr/bin/env node
'use strict';

var Paastor = require('./client');
require('colors');

// API endpoint to use
var paastorUrl;
// use Local process
if (process.env.l) {
    paastorUrl = "http://localhost:2999/api";
}
else if (process.env.paastorUrl) {
    paastorUrl = process.env.paastorUrl;
}

var client = new Paastor({
    paastorUrl: paastorUrl
});

var program = require('commander');
var prompt = require('promptly').prompt;
var Table = require('cli-table');

var semver = require('semver');
var packageJson = require('./package.json');

var archiver = require('archiver');
var os = require('os');
var tempDir = os.tmpdir();
var async = require('async');

var fs = require('fs');
var path = require('path');
var home = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
var paastorConfigFilepath = path.join(home, '.paastor');
var cookies = "";
var saveCookies = function (c) {
    try {
        fs.writeFileSync(paastorConfigFilepath, c.join('; '), { encoding: 'utf8' });
    }
    catch (ex) {
        console.error('Failed to save cookie session.'.red, ex);
    }
};
// Generic handler for request calls
var handler = function (cb) {
    return function (err, res, body) {
        res = res || {};
        if (err) {
            console.error('Error'.red.bold,
                res.statusCode || 0, body ? body.message || body.error || body : 'No response');
            return;
        }
        if (res.statusCode !== 200) {
            console.warn('Fail'.yellow.bold,
                res.statusCode, body.message || body.error || body);
            return;
        }
        if (res.headers['set-cookie']) {
            saveCookies(res.headers['set-cookie']);
        }
        cb(body, res);
    };
};

/**
 * Loading up the current cookies.
 */
try {
    cookies = fs.readFileSync(paastorConfigFilepath, { encoding: 'utf8' });
}
catch (ex) {
    saveCookies([]);
}



var RESERVED_ENV_KEYS = ['PAASTOR_PORT'];

program.version(packageJson.version);

/**
 * login
 */
program
.command('login')
.option('-u, --user [email]', 'username (email)')
.option('-p, --pass [pass]', 'password')
.description('Sign into Paastor (prompts for credentials or use -u, --user and -p, --pass)')
.action(function (options) {
    var email = options.user;
    var password = options.pass;
    var promptUser = function () {
        prompt('Email:', {
            validator: function (v) {
                if (!v) {
                    throw new Error("Try again");
                }
                return v;
            },
            retry: true
        }, function (err, value) {
            email = value;

            if (!password) {
                promptPass();
            }
            else {
                doreq();
            }

        });
    };
    var promptPass = function () {
        prompt('Password:', {
            validator: function (v) {
                if (!v) {
                    throw new Error("Try again");
                }
                return v;
            },
            retry: true,
            silent: true
        }, function (err, value) {
            password = value;
            doreq();
        });
    };
    var doreq = function () {
        var params = {
            email: email,
            password: password,
            cookies: cookies
        };
        client.login(params, handler(function (data, res) {
            console.log('Ok'.green.bold, 'Logged in as', email);
        }));
    };


    if (email && password) {
        doreq();
        return;
    }
    if (email) {
        promptPass();
        return;
    }

    promptUser();

});

/**
 * logout and empty the cookie file
 */
program
.command('logout')
.description('Sign out of Paastor')
.action(function () {
    saveCookies([]);
    console.log('Ok'.green.bold, 'Logged out successfully');
});


program
.command('servers')
.description('Get a list of servers for this account')
.action(function () {
    client.listServers({ cookies: cookies}, handler(function (servers, res) {
        console.log('\n');

        if (!servers.length) {
            console.log(' - no servers - ');
            return;
        }
        // organized by infrastructure
        var infras = {};
        servers.forEach(function (s) {
            infras[s.infrastructure] = infras[s.infrastructure] || [];
            infras[s.infrastructure].push(s);
        });
        Object.keys(infras).forEach(function (key) {
            console.log('\n infrastructure', key.cyan);
            infras[key].forEach(function (s) {
                console.log('    ', s._id[ s.status == 'ok' ? 'green' : 'yellow' ]);
                console.log('      ', s.status);
                console.log('      ', s.ip);
            });
        });
        console.log('\n\n  To get detailed info:   pstr server [_id]\n');
    }));
});


program
.command('logs [server] [app]')
.description('Get the logs for a server (when no app param) or an app on the server')
.action(function (vps, appId, options) {
    if (!vps) {
        console.warn('server is required');
        return;
    }

    client.getLogs({
        vps: vps,
        app: appId,
        cookies: cookies
    }, handler(function (logObject, res) {

        if (!logObject) {
            console.log('No logs were retrieved.\n');
            return;
        }

        console.log('------');

        console.log('begin stderr'.bold);
        console.log('------');
        console.log(logObject.stderr);

        console.log('------\nend stderr'.bold);
        console.log('------');

        console.log('begin stdout'.bold);
        console.log('------');
        console.log(logObject.stdout);

        console.log('------\nend stdout'.bold);


        if (logObject.error) {
            console.log('Sheep returned error while reading logs:\n'.red, logObject.error, '\n');
        }
    }));
});


program
.command('server [_id]')
.description('Get detailed info about a server')
.action(function (_id) {
    if (!_id) {
        console.error('Missing server name (_id)');
        return;
    }
    client.getServerInfo({ vps: _id, cookies: cookies }, handler(function (data, res) {

        console.log('\n', data._id.bold.green, 'on', data.infrastructure.cyan, 'at', data.ip, '\n');


        var info = data.info;
        if (!info || info.error) {
            console.error('  ', !info ? "No response from sheep" : info.error);
            return;
        }

        console.log('  Node versions:'.bold, '\n   ',
            info.node_versions ? info.node_versions.join(', ') : 'unknown', '\n');

        console.log('  CPU:'.bold);
        console.log('   ', info.cpus.length, 'cores');
        var cpuUsedPer = ((info.totalcpu - info.freecpu)/info.totalcpu * 100).toFixed(2);
        console.log('   ', cpuUsedPer + '% used');
        console.log('\n');


        console.log('  RAM:'.bold);
        console.log('   ', ((info.totalmem - info.freemem)/1024/1024).toFixed(2) + ' MB',
            '/', info.totalmem/1024/1024 + ' MB');
        console.log('   ', ((info.totalmem - info.freemem)/info.totalmem * 100).toFixed(2) + '% used');
        console.log('\n');


        console.log('  Storage:'.bold);
        console.log('    Apps:', info.apps_size);
        console.log('    Logs:', info.logs_size);

        if (!info.drives || !info.drives.length) {
            console.warn('    failed reading drive info');
        }
        info.drives = info.drives || [];
        info.drives.forEach(function (drive) {
            console.log('\n    ' + drive.mountpoint);
            console.log('     ', drive.used, '/', drive.total);
            console.log('     ', drive.usedPer + '% full');
        });
        console.log('\n');


        // List apps on this server
        console.log('  Apps:'.bold,
            Object.keys(info.processes).length, 'up /', info.apps.length, 'total');

        // Apps table
        var table = new Table();
        // table header
        table.push(['_id'.bold, 'Running'.bold, 'Last status'.bold, 'Environment'.bold, 'Node'.bold]);

        info.apps.forEach(function (a) {

            var envText = "";

            if (typeof a.env === 'object') {
                var envKeys = Object.keys(a.env);
                if (!envKeys.length) {
                    envText = 'env is empty';
                }
                else {
                    envKeys.forEach(function (envKey) {
                        if (envText) {
                            envText += '\n';
                        }
                        envText += envKey + '=' + a.env[envKey];
                    });
                }
            }
            else {
                envText = 'error reading env'.yellow;
            }

            table.push([
                a._id.bold,
                info.processes.indexOf(a._id) !== -1 ? 'yes'.green : 'no'.red,
                a.status,
                envText,
                a.engines && a.engines.node ? a.engines.node : 'unknown'
            ]);
        });

        console.log(table.toString(), '\n');
    }));
});

/**
 * Push app to vps
 */
program
.command('push [server] [app]')
.option('-n, --no-npm', 'Do not run npm install')
.description('Push an app to your server (both must already exist)')
.action(function (vpsId, appId, options) {

    if (!vpsId) {
        program.help();
        return;
    }
    if (!appId) {
        console.warn('You must specify an app');
        return;
    }

    console.log('\n  push'.bold, vpsId, appId, '\n');

    var zipPath;
    var app;
    var appJson = null;
    async.series([
        function (cb) {
            console.log('  Checking package.json');
            fs.readFile('./package.json', { encoding: 'utf8' }, function (err, contents) {
                if (err) {
                    console.error('   ', err.toString().red);
                    return;
                }


                // Valid package.json

                try {
                    appJson = JSON.parse(contents);
                }
                catch (ex) {
                    console.error('    Unable to parse package.json'.red, ex);
                    return;
                }
                if (!appJson) {
                    console.error('    package.json is invalid'.red);
                    return;
                }
                console.log('    package.json exists'.green);


                // Node version

                if (!appJson.engines || typeof appJson.engines.node !== 'string') {
                    console.error('    package.json must indicate node engine'.red);
                    console.error('    example: { "engines": { "node": "0.10.31" } }');
                    return;
                }
                var validVersionString = '>=0.6.0 <0.11.0';
                var isValidSemver = semver.valid(appJson.engines.node);
                var isNotSpecificVersion = /[^v0-9\.]/.test(appJson.engines.node);
                var isInRange;
                try {
                    // this will crash when there is an "x" as in "0.10.x"
                    isInRange = semver.satisfies(appJson.engines.node, validVersionString);
                }
                catch (ignored) {
                    isNotSpecificVersion = true;
                }
                if (isNotSpecificVersion) {
                    console.error('    Paastor requires "engines.node" to be a full semver version, not a range, with no spaces or "x".'.yellow);
                    console.error('    engines.node is "' + appJson.engines.node + '"');
                    console.error('    valid format is "major.minor.patch" like "0.10.31"');
                    return;
                }
                if (!isValidSemver) {
                    console.error('    "engines.node" must be a valid semver.');
                    return;
                }
                if (!isInRange) {
                    console.error('    "engines.node" must be ' + validVersionString);
                    return;
                }

                console.log(('    version ok ' + appJson.engines.node).green);

                // domains
				var domainsArrayIsNotValid = !appJson.domains || !(appJson.domains instanceof Array) || !appJson.domains.forEach;
                if (domainsArrayIsNotValid) {
                    console.error('    "domains" must be an array.'.red);
					return;
                }
                var domainsInvalid = false;
				var checkDomain = function (domain) {
					if (!domain || typeof domain !== 'string') {
						console.error(('    domain ' + JSON.stringify(domain) + ' is invalid.').red);
						domainsInvalid = true;
					}
				};
                appJson.domains.forEach(checkDomain);
                if (domainsInvalid) {
                    return;
                }
                if (!appJson.domains.length) {
                    console.error('    At least one domain must be specified in package.json "domains".'.red);
                    console.error('    Example: { "domains": ["www.example.com"] }');
                    return;
                }
                console.log('    Domains look ok'.green);

                cb();
            });
        },
        function (cb) {
            console.log('  Checking server...');
            client.getServerInfo({ vps: vpsId, cookies: cookies }, function (err, res, vps) {
                if (err) {
                    return cb(err);
                }
                if (res.statusCode !== 200) {
					var errNot200 = new Error('Status: ' + res.statusCode + ' '
						+ (res.body.message || res.body.error));
                    return cb(errNot200);
                }
                console.log('    Found'.green, vps._id.green);
                if (vps.status !== 'ok') {
                    return cb(new Error('Server status is not ok: ' + vps.status));
                }
                if (vps.info.error) {
					var errVpsInfo = new Error('Could not gather server info: '
						+ JSON.stringify(vps.info.error));
                    return cb(errVpsInfo);
                }
                console.log('    Status ok'.green);

                vps.info.apps = vps.info.apps || [];
                vps.info.apps.forEach(function (a) {
                    if (a._id === appId) {
                        app = a;
                    }
                });
                if (!app) {
                    return cb(new Error('That app was not found. Did you create it yet? Use the create-app command.'));
                }

                if (vps.info.node_versions.toString().indexOf(appJson.engines.node) === -1) {
                    var errNodeVerNotInstalled = new Error('Node version ' + appJson.engines.node
						+ ' is not installed on the server.');
					return cb(errNodeVerNotInstalled);
                }

                console.log('   ', appJson.engines.node.green, 'installed'.green);
                cb();
            });
        },
        function (cb) {
            console.log('  Creating package from current directory...');
            var datestring = +new Date();
            zipPath = path.join(tempDir, datestring + '.tgz');
              var output = fs.createWriteStream(zipPath);
              var archive = archiver('tar', {
                gzip: true,
                gzipOptions: {
                    level: 1
                }
            });
            var fileOptions = [
                  { expand: true, cwd: './', src: [ '**/*'] }
            ];
            if (options.npm) {
                fileOptions[0].src.push('!node_modules/**/*');
            }
            archive.on('error', function (err) {
                console.error('  Error packing your app.', err);
                  return cb(err);
            });

            // When finished writing the archive
            output.on('close', archiveOnCloseHandler);
            // Commands to finish the archive and trigger
            archive.pipe(output);
            archive.bulk(fileOptions);
            archive.finalize();


            function archiveOnCloseHandler() {
                  console.log('    Package created.'.green,
                      ((archive.pointer()/1024/1024).toFixed(3) + 'mb').grey);

                  console.log('  Prepping package for sending...');
                  fs.readFile(zipPath, { encoding: 'base64' }, function (err, data) {
                      if (err) {
                          console.error('    Could not read the package data.'.red, err);
                          return cb(err);
                      }
                      if (!data) {
                          console.error('    No error occurred, but package is empty.'.red);
                          return cb(new Error("Empty package"));
                      }

                    console.log('    Package is ready to send.'.green);
                      app.pkg = data;

                    cb();

                  });
            }

        },

        function (cb) {
            if (!options.npm) {
                app.noNpm = true;
                console.log('  Uploading...');
                console.log('    no npm install'.grey);
            }
            else {
                console.log('  Uploading and running npm install...');
            }
            app.vps = vpsId;
            app.app = appId;
            app.cookies = cookies;
            client.pushPackage(app, handler(function (data, res) {
                console.log('    Ok'.green);
                cb();
            }));

        },

        function (cb) {
            console.log('  Stopping app...');
            client.stopApp({ vps: vpsId, app: appId, cookies: cookies }, function (err, res, body) {
                if (err || res.statusCode !== 200) {
                    console.log('    Not stopped. '.yellow);
                }
                else {
                    console.log('    Stopped.'.green);
                }
                cb();
            });
        },

        function (cb) {
            console.log('  Starting app...');
            client.startApp({ vps: vpsId, app: appId, cookies: cookies }, handler(function (data, res) {
                console.log('    Started'.green);
                cb();
            }));
        }

    ],
    function (err, data) {

        if (err) {
            console.error('   ', (err.message || err.error || err).red);
        }

        console.log('\n  Cleaning up package...');
        try {
            fs.unlinkSync(zipPath);
        } catch (ex) { }
        console.log('    Package cleaned.'.green);

        if (!err) {
            console.log('\n  Push complete.'.green.bold);
            console.log('\n');
        }

    });
});

/**
 * Stop app app to vps
 */
program
.command('create-app [server] [app]')
.description('Create an app')
.action(function (vpsId, appId) {
    if (!vpsId || !appId) {
        console.error('server and app _id are required.');
        return;
    }

    client.createApp({
        vps: vpsId,
        _id: appId,
        env: '{}',
        cookies: cookies
    }, handler(function (data, res) {
        console.log(('  Created app ' + appId + ' on server ' + vpsId).green);
    }));

});

/**
 * Stop app app to vps
 */
program
.command('stop [server] [app]')
.description('Stop an app')
.action(function (vpsId, appId) {
    if (!vpsId || !appId) {
        console.error('server and app _id are required.');
        return;
    }
    console.log('Stopping app...');

    client.stopApp({ vps: vpsId, app: appId, cookies: cookies }, handler(function (data, res) {
        console.log(('  Stopped ' + appId).green);
    }));

});

/**
 * Start app
 */
program
.command('start [server] [app]')
.description('Start an app')
.action(function (vpsId, appId) {
    if (!vpsId || !appId) {
        console.error('server and app _id are required.');
        return;
    }
    console.log('Starting app...');

    client.startApp({ vps: vpsId, app: appId, cookies: cookies }, handler(function (data, res) {
        console.log(('  Started ' + appId).green);
    }));

});

/**
 * Stop and start an app in one fell swoop
 */
program
.command('restart [server] [app]')
.description('Stop then immediately start an app')
.action(function (vpsId, appId) {
    if (!vpsId || !appId) {
        console.error('server and app _id are required.');
        return;
    }
    console.log('Restarting app...');

    client.restartApp({ vps: vpsId, app: appId, cookies: cookies }, handler(function (data, res) {
        console.log(('  Successfully restarted ' + appId).green);
    }));

});

// Set an environment variable
program
.command('setenv [server] [app]')
.description('Initiate the process of setting an app environment variable (must restart app to take effect)')
.action(function (vpsId, appId) {
    var envKey;
    var envVal;

    if (!vpsId || !appId) {
        console.error("server and app are both required");
        return;
    }

    prompt('Environment variable name:', {
        validator: function (v) {
            if (!v) {
                throw new Error("Try again");
            }
            if (!isNaN(v[0])) {
                throw new Error("  First character of variable name must be a letter");
            }
            if (/[^a-z0-9\_]/gi.test(v)) {
                throw new Error("\n Only the following characters are allowed for an environment variable name:\n  a-z\n  A-Z\n  0-9\n  _    (underscore)\n");
            }
            if (RESERVED_ENV_KEYS.indexOf(v) !== -1) {
                throw new Error("The key " + v + " is reserved and may not be used");
            }
            return v;
        },
        retry: true
    }, function (err, value) {
        if (err) {
            console.error(err);
            return;
        }
        envKey = value;

        prompt('Environment variable value:', {
            validator: function (v) {
                if (!v) {
                    throw new Error("Try again");
                }
                return v;
            },
            retry: true
        }, function (err, value) {
            if (err) {
                console.error(err);
                return;
            }
            envVal = value;
            prompt('\n\n------\nConfirmation:\n    ' + envKey + '=' + envVal + '\n\n(Hit enter to confirm, ctrl+c to cancel)',
            {
                default: 'OK', // this is here so an <enter> will allow proceeding
                retry: false,
                silent: true
            },
            function (err, value) {
                // if we made it to here, they hit enter as a confirmation. a little hacky above.
                doreq();
            });
        });

    });

    function doreq() {
        client.setenv({
            vps: vpsId,
            app: appId,
            key: envKey,
            val: envVal,
            cookies: cookies
        }, handler(function (data, res) {
            console.log('Environment variable has been set.'.green.bold);
            console.log('You must restart the application for the change to take effect.');
        }));
    }
});


/**
 * Install a version of Node.js on the specified server.
 */
program
.command('install-node [server] [version]')
.description('Trigger the installation of a version of Node.js, to be available to apps.')
.action(function (vpsId, ver) {
    if (!vpsId || !ver) {
        console.error('server and node version are required.');
        return;
    }
    var isValidSemver = semver.valid(ver);
    if (!isValidSemver) {
        console.error('Version must be a valid semver, like "0.10.31"', '\n  (' + ver + ')');
        return;
    }

    var installParams = { vps: vpsId, version: ver, cookies: cookies };
    var afterInstallHandler = handler(function (data, res) {
        var outputMsg = data
            ? data.message || data.error || 'Successfully started installation. Check back later.'
            : 'Unknown response from server';
        console.log(('  ' + outputMsg ).green);
    });

    client.installNode(installParams, afterInstallHandler);

});




program.parse(process.argv);

if (!program.args.length) {
    program.help();
}

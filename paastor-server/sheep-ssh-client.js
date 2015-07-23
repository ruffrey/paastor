'use strict';
var Connection = require('ssh2');
var debug = require('debug')('sheep-ssh-client');
var async = require('async');
var hash = require('./lib/hash');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var config = require('./config');
var _ = require('lodash');
var genrand = require('./lib/genrand.js');
var redis = require('redis');
var MongoClient = require('mongodb').MongoClient;
function randomInt (low, high) {
    return Math.floor(Math.random() * (high - low) + low);
}

/**
 * Connect via ssh to a sheep box.
 * An EventEmitter.
 *
 * @param {string} hostname
 * @param {string} rootPassword
 * @param {function} callback (err, strOutput)
 */
function SheepSshClient(hostname, rootPassword, callback) {
    var sheep = this;

    var options = {
        host: hostname,
        username: 'root',
        port: 22,
        password: rootPassword
          // privateKey: require('fs').readFileSync('/here/is/my/key')
    };

    var ENV = 'DEBIAN_FRONTEND=noninteractive '; // space on the end!

    /**
     * This wrapper executes the callback as
     * `cb(err, data)`
     * where `err` is the contents of STDERR
     * and `data` is the contents of STDOUT.
     */
    var execCommandHandler = function (command, connection, cb) {

        return function onConnectionReady() {

            var stdErrOutput = "";
            var stdOutData = "";
            sheep.emit('data', '\n\nsheep: ' + command + '\n\n');
            connection.exec(ENV + command, function commandWasExecuted(err, stream) {
                if (err) {
                    debug('connection.exec error', command, err);
                    if (cb) {
                        cb(err);
                    }
                    return;
                }

                stream
                .on('exit', function (code, signal) {
                      sheep.emit('exit', code, signal);
                      var txt = 'Stream - exit - code: ' + code + ', signal: ' + signal;
                      debug(txt);
                      stdOutData += "\nEXIT";
                })
                .on('close', function () {
                      sheep.emit('close');
                      debug('Stream - close');
                      if (connection && connection.end) {
                          connection.end();
                      }
                      stdOutData += "\nCLOSE";

                      var finalErr = stdErrOutput ? new Error(stdErrOutput) : null;
                      if(cb) {
                          cb(finalErr, stdOutData);
                      }
                })
                .on('data', function (data) {
                      debug('STDOUT: ' + data);
                      sheep.emit('data', "  " + data);
                      stdOutData += data;
                })
                .stderr.on('data', function (data) {
                      debug('STDERR: ' + data);
                      try {
                          sheep.emit('error', "  " + data);
                      }
                      catch (ex) {
                          debug('ERROR EMITTING error event during ssh client');
                      }
                      stdErrOutput += data;
                });
            });

        };
      };

      /**
       * Execute a terminal `command` and run the callback with
       * `cb(errSTDERR, outputSTDOUT)`
       *
       * @param {string} command
       * @param {function} cb - callback function with `err, output` arguments
       */
    sheep.exec = function (command, cb) {
        debug('exec command:', command);

        var connection = new Connection();

        connection
        .on('error', function (err) {
            debug('exec command: connection error before executing', command, err);
            cb(err);
        })
        .on('ready', execCommandHandler(command, connection, cb))
        .connect(options);
    };
    // This is a test of the connection that occurs when you instantiate the SheepSshClient
    sheep.exec('cd /root', callback);


    /**
     * Pass this to an array of strings in a map function to get asychronously executable array of functions, for `async.series`.
     * All output will be appended to the `outputString`.
     *
     * Usage: `['array of', 'string commands'].map(buildAsyncCommandList)`
     */
    var buildAsyncCommandList = function (sheep, outputString) {
        return function (cmd) {
            return function (cb) {
                sheep.exec(cmd, function (err, data) {
                    // errors are ignored because stderr is a bitch
                    outputString += "\n" + data;
                    cb();
                });
            };
        };
    };

    sheep.aptUpdate = function (callback) {
        sheep.emit('setup', 'Updating package list');
        sheep.exec('apt-get update', callback);
    };

    sheep.installGit = function (callback) {
        sheep.emit('setup', 'Installing some dependencies');
        sheep.exec('apt-get install git zip unzip -y', callback);
    };
    sheep.uninstallGit = function (callback) {
        sheep.exec('apt-get remove git -y', callback);
    };

    sheep.installNode = function (callback) {
        debug('Installing Node');
        sheep.emit('setup', 'Installing Node.js and version manager');

        var output = "";

        var commands = [

            // Installing node from source, fixed version.
            // "apt-get install curl -y",
            // "curl -sL https://deb.nodesource.com/setup | bash -",
            // "sudo apt-get install nodejs -y",


            // Installing nvm
            // nvm needs curl.
            // compiling node versions from source, which is necessary sometimes with nvm
            // if there is not a binary available, requires the build packages.
            "apt-get install curl build-essential libssl-dev git-core -y",
            "wget -qO- https://raw.githubusercontent.com/xtuple/nvm/master/install.sh | sudo bash",
            "nvm install 0.10.31",

            // test that it worked
            "node --version",
            // forever monitor
            "npm install -g forever",
            // test that forever is installed
            "forever list"
        ].map(buildAsyncCommandList(sheep, output));

        async.series(commands, function finished(err, data) {
            if (err) {
                return callback(err, data);
            }
            callback(null, output);
        });
    };

    sheep.installMongo = function (settings, callback) {
        debug('installing mongodb');
        sheep.emit('setup', 'Installing Mongodb');

        settings = _.defaults(settings, {
            localOnly: true,
            username: '',
            password: '',
            port: 27017
        });
        async.series([
            function (cb) {
                sheep.emit('setup', 'Some cleanup first');
                sheep.uninstallMongo(function (err) {
                    if (err) {
                        debug('WARN: uninstall mongo', err);
                    }
                    cb();
                });
            },
            function (cb) {
                sheep.exec('apt-get install mongodb ufw -y', function (err, data) {
                    if (err) {
                        debug('WARN: mongo install', data);
                    }
                    cb(null);
                });
            },
            function (cb) {
                if (settings.localOnly) {
                    return cb();
                }
                sheep.exec('ufw allow ' + settings.port, function (err, data) {
                    if (err) {
                        debug('WARN: ufw enable', err);
                    }
                    cb();
                });
            },
            function (cb) {
                if (settings.localOnly) {
                    return cb();
                }
                sheep.exec(
                    "sed -i 's/bind_ip = 127.0.0.1/bind_ip = " + hostname + "/' /etc/mongodb.conf",
                    function (err, data) {
                        if (err) {
                            debug('WARN: setting port', err);
                        }
                        cb();
                    });
            },
            function (cb) {
                sheep.exec(
                    "sed -i 's/#port = 27017/port = " + settings.port + "/' /etc/mongodb.conf",
                    function (err, data) {
                        if (err) {
                            debug('WARN: setting port', err);
                        }
                        cb();
                    });
            },
            function (cb) {
                if (settings.localOnly) {
                    return cb();
                }
                sheep.exec("reboot", function (err, data) {
                    if (err) {
                        debug('WARN: mongo reboot', err);
                    }
                    cb();
                });
            },
            // the test. attempt to connect.
            function (cb) {
                if (settings.localOnly) {
                    sheep.exec("which mongo", function (err, data) {
                        if (err) {
                            return cb(err);
                        }
                        if (!data || data.indexOf('mongo') === -1) {
                            return cb(new Error("MongoDB seems to have not installed correctly. Please check the server."));
                        }
                        cb();
                    });

                    return;
                }
                setTimeout(function () {
                    sheep.emit('setup', 'Checking connection to new MongoDB');

                    MongoClient.connect(
                        "mongodb://" + hostname + ":" + settings.port + "/admin",
                        mongoClientOnConnect
                    );

                    function mongoClientOnConnect(err, db) {
                        if(err) {
                            sheep.emit('setup', err);
                            debug('Mongo install - connect error', err);
                            cb(err);
                            return;
                        }
                        var userOpts = {
                            roles: [
                                "readWriteAnyDatabase",
                                "userAdminAnyDatabase"
                                // "dbAdminAnyDatabase",
                                // "root",
                                // "restore"
                                // '__system'
                            ],
                            readOnly: false
                        };
                        db.addUser(settings.username, settings.password, userOpts, function (err, result) {

                            try {
                                db.close();
                            }
                            catch (ignored) { }

                            if (err) {
                                debug('Mongo install - addUser', err);
                                sheep.emit('setup', err);
                                cb(err);
                                return;
                            }
                            sheep.emit('setup', 'Mongo added new superuser');

                            // test the connection
                            var testuri = "mongodb://" + settings.username
                                + ":" + settings.password + "@" + hostname + ":" + settings.port + '/asdf?authSource=admin';

                            MongoClient.connect(testuri, function (err, dbtest) {
                                if (err) {
                                    sheep.emit('setup', err);
                                    debug('Mongo install - connect error', err);
                                    cb(err);
                                    return;
                                }
                                else {
                                    sheep.emit('setup', 'Connected as new user');
                                    dbtest.close();
                                }

                                cb();

                            });
                        });
                    }

                }, 15000);
            },
            // require auth after creating user!
            function (cb) {
                if (!settings.username && !settings.password) {
                    return cb();
                }
                sheep.exec(
                    "sed -i 's/#auth = true/auth = true/' /etc/mongodb.conf",
                    function (err, data) {
                        if (err) {
                            debug('WARN: setting port', err);
                        }
                        cb();
                    });
            },
        ], callback);
    };
    sheep.uninstallMongo = function (callback) {
        sheep.exec('killall mongod', function (err) {
            if (err) {
                debug('WARN: mongo kill during uninstall', err);
            }
            sheep.exec(
                'apt-get remove mongodb mongodb-clients mongodb-server mongodb-dev -y && rm -f -r /var/log/mongodb/ && rm -f -r rm -f -r /var/lib/mongodb && apt-get purge mongodb mongodb-clients mongodb-server mongodb-dev -y && rm -f /etc/mongodb.conf',
                callback
            );
        });
    };

    sheep.installRedis = function (settings, callback) {
        var keyLength = randomInt(48, 96);
        settings = _.defaults(settings, {
            password: "",
            generatePassword: true,
            port: 6379, // default redis port
            localOnly: true
        });

        if (!settings.generatePassword) {
            doInstall();
            return;
        }

        genrand(keyLength, function (err, pass) {
            if (err) {
                debug('Warn: genrand failed', err);
                sheep.emit('setup', err);
                callback(err);
                return;
            }
            settings.password = pass;
            doInstall();
        });


        function doInstall() {
            debug('installing redis');
            async.series([
                function (cb) {
                    sheep.uninstallRedis(function (err, data) {
                        if (err) {
                            debug('Warn: redis install, pre-remove', err);
                        }
                        cb();
                    });
                },
                function (cb) {
                    sheep.exec('apt-get install redis-server ufw -y', function (err, data) {
                        if (err) {
                            debug('WARN: redis install', err);
                        }
                        cb();
                    });
                },
                function (cb) {
                    if (settings.localOnly) {
                        return cb();
                    }
                    sheep.exec('ufw allow ' + settings.port, function (err, data) {
                        if (err) {
                            debug('WARN: ufw enable', err);
                        }
                        cb();
                    });
                },
                function (cb) {
                    if (settings.localOnly) {
                        return cb();
                    }
                    sheep.exec("sed -i 's/bind 127.0.0.1/bind 127.0.0.1 " + hostname + "/' /etc/redis/redis.conf",
                        function (err, data) {
                            if (err) {
                                debug('WARN: setting port', err);
                            }
                            cb();
                        });
                },
                function (cb) {
                    if (!settings.password) {
                        return cb();
                    }
                    sheep.exec("echo 'requirepass " + settings.password + "' >> /etc/redis/redis.conf", function (err, data) {
                        if (err) {
                            debug('WARN: setting password', err);
                        }
                        cb();
                    });
                },
                function (cb) {
                    sheep.exec("sed -i 's/port 6379/port " + settings.port + "/' /etc/redis/redis.conf",
                        function (err, data) {
                            if (err) {
                                debug('WARN: setting port', err);
                            }
                            cb();
                        });
                },
                function (cb) {
                    if (settings.localOnly) {
                        return cb();
                    }
                    sheep.exec("reboot", function (err, data) {
                        if (err) {
                            debug('WARN: redis reboot', err);
                        }
                        cb();
                    });
                },
                // the test. attempt to connect.
                function (cb) {
                    if (settings.localOnly) {
                        sheep.exec("which redis-cli", function (err, data) {
                            if (err) {
                                return cb(err);
                            }
                            if (!data || data.indexOf('redis-cli') === -1) {
                                return cb(new Error("Redis seems to have not installed correctly. Please check the server."));
                            }
                            cb();
                        });

                        return;
                    }
                    setTimeout(function () {
                        var didAuth = false;
                        var didConnect = false;

                        var redisClient = redis.createClient(settings.port, hostname);

                        redisClient.on('connect', function () {
                            didConnect = true;
                            if (didAuth) {
                                cb();
                                redisClient.end();
                            }
                        });
                        redisClient.auth(settings.password, function () {
                            didAuth = true;
                            if (didConnect) {
                                cb();
                                redisClient.end();
                            }
                        });
                        redisClient.on('error', function (err) {
                            cb(err);
                            redisClient.end();
                        });

                    }, 15000);
                }
            ], function (err) {
                if (err) {
                    return callback(err);
                }
                callback(null, settings.password);
            });
        }
    };
    sheep.uninstallRedis = function (callback) {
        sheep.exec('killall redis-server', function (err, data) {
            if (err) {
                debug('WARN: Redis uninstall', err);
            }
            sheep.exec(
                'apt-get remove redis-server -y && rm -f -r /var/log/redis && apt-get purge redis-server -y && rm -f /etc/redis/redis.conf',
                callback
            );
        });
    };

    /**
     * @param {object} vps - the vps options
     */
    sheep.installSheep = function (vpsObject, callback) {
        if (!vpsObject) {
            return callback(new Error("Missing server object on install sheep"));
        }
        // protect against passing in a Mongoose object
        var vps = vpsObject.toObject ? vpsObject.toObject() : vpsObject;
        if (!vps._id) {
            return callback(new Error("Missing server _id"));
        }
        if (!vps.secret) {
            return callback(new Error("Missing server secret"));
        }

        delete vps.logs;

        async.series([
            function pre_apache2_stop(cb) {
                sheep.emit('setup', 'Stopping some services');
                sheep.exec('service apache2 stop', function (err, data) {
                    if (err) {
                        debug('WARN: ', err);
                    }
                    cb();
                });
            },
            function pre_apache2_remove(cb) {
                sheep.emit('setup', 'Removing conflicting dependencies');
                sheep.exec('apt-get remove apache2* -y', function (err, data) {
                    if (err) {
                        debug('WARN: ', err);
                    }
                    cb();
                });
            },
            function pre_stop(cb) {
                sheep.emit('setup', 'Stopping any existing sheep');
                sheep.exec('forever stopall', function (err, data) {
                    if (err) {
                        debug('WARN: stopall failed', err);
                        // fall through
                    }
                    cb();
                });
            },
            function pre_cleanup(cb) {
                sheep.emit('setup', 'Pre-install cleanup');
                sheep.exec('rm -r -f /root/sheep && rm -f /root/sheep.zip*', function (err, data) {
                    if (err) {
                        debug('install sheep - pre-clean directory - error', err);
                        return cb(err, data);
                    }
                    // cron files
                    sheep.emit('setup', 'Removing any existing Sheep instances');
                    sheep.exec('rm -f /root/start.sh && rm -f /etc/cron.d/sheep', function (err, data) {
                        if (err) {
                            debug('install sheep - pre-clean cron files - error', err);
                            return cb(err, data);
                        }
                        cb();
                    });
                });
            },
            function clone(cb) {
                sheep.emit('setup', 'Downloading Sheep');
                sheep.exec('cd /root/ && wget ' + config.sheepDownload, function (err, data) {
                    if (err) {
                        debug('WARN: ', err);
                    }
                    cb();
                });
            },
            function unpack(cb) {
                sheep.emit('setup', 'Unpacking Sheep');
                sheep.exec('cd /root/ && unzip -o sheep.zip && cp -R build/tmp/ /root/sheep/', function (err, data) {
                    if (err) {
                        debug('WARN: ', err);
                    }
                    cb();
                });
            },
            function systemFile(cb) {
                debug('writing system.json');
                sheep.emit('setup', 'Configuring system.json');

                vps.secret = hash(vps.secret);
                var vpsSystemJson = JSON.stringify(vps);
                sheep.exec("rm -f /root/sheep/system.json && echo '" + vpsSystemJson + "' >> /root/sheep/system.json", function (err, data) {
                    if (err) {
                        return cb(err, data);
                    }
                    cb();
                });
            },
            function startup(cb) {
                debug('Copying startup scripts');
                sheep.emit('setup', 'Configuring startup script');
                sheep.exec('cp /root/sheep/scripts/start.sh /root/', function (err, data) {
                    if (err) {
                        return cb(err, data);
                    }
                    cb();
                });
            },
            function cron(cb) {
                debug('Copying cron job');
                sheep.emit('setup', 'Configuring startup tasks');
                sheep.exec('cp /root/sheep/scripts/sheep /etc/cron.d/', function (err, data) {
                    if (err) {
                        debug('Error copying cron script', err);
                        return cb(err, data);
                    }
                    cb();
                });
            },
            function reboot(cb) {
                sheep.emit('setup', 'Rebooting...');
                sheep.exec("reboot && echo 'rebooting, brb in 25 seconds'", function (err, data) {
                    if (err) {
                        debug('error issuing reboot', err);
                        return cb(err, data);
                    }
                    setTimeout(function () {
                        cb();
                    }, 25000);
                });
            },
            function test1(cb) {
                sheep.emit('setup', 'And we are back!');
                sheep.emit('setup', 'Checking for Sheep');

                sheep.exec('forever list', function (err, data) {
                    if (err) {
                        sheep.emit('setup', 'Server may be slow to reboot');
                        return cb(err, data);
                    }
                    if (data.indexOf('/root/sheep/proxy.js') === -1) {
                        return cb(new Error("Installed, but is not running"), data);
                    }
                    cb();
                });
            },
            function test2(cb) {
                sheep.emit('setup', 'Making a test call to the Sheep API');
                sheep.exec('curl -X GET http://localhost:3000/', function (err, data) {
                    if (!data) {
                        return cb(new Error("Failed to reach the running service over curl", data));
                    }
                    cb();
                });
            }


        ], callback);
    };


    return sheep;
}
util.inherits(SheepSshClient, EventEmitter);

exports = module.exports = SheepSshClient;

'use strict';
var should = require('should');
var SheepSshClient = require('../sheep-ssh-client');
var vpsCredentials = require('./vps-credentials.json');
var uuid = require('uuid');

if (!vpsCredentials.hostname || !vpsCredentials.rootPassword) {
    console.warn("VPS test server has not been setup properly. Check spec/vps-credentials.json. Tests will be skipped.");
    return;
}

var client;

describe('sheep-ssh-client', function () {
    this.timeout(12000);
    it('connects', function (done) {
        new SheepSshClient(vpsCredentials.hostname, vpsCredentials.rootPassword, function (err, output) {
            if (err) {
                return done(err);
            }
            output.should.be.a.String;
            output.should.not.be.empty;
            done();
        });
    });

    describe('apt-get update', function () {
        this.timeout(1000 * 60 * 1);
        before(function (done) {
            client = new SheepSshClient(vpsCredentials.hostname, vpsCredentials.rootPassword, done);
        });
        it('works', function (done) {
            client.aptUpdate(function (err, data) {
                if (err) {
                    return done(err);
                }
                done();
            });
        });
    });

    describe('installing git', function () {
        this.timeout(1000 * 30);
        before(function (done) {
            client = new SheepSshClient(vpsCredentials.hostname, vpsCredentials.rootPassword, done);
        });
        it('works', function (done) {
            client.installGit(function (err, data) {
                if (err) {
                    return done(err);
                }
                done();
            });
        });
    });

    describe('installing node.js', function () {
        this.timeout(1000 * 60);
        before(function (done) {
            client = new SheepSshClient(
                vpsCredentials.hostname, 
                vpsCredentials.rootPassword, 
                done
            );
        });
        it('works', function (done) {
            client.installNode(function (err, data) {
                if (err) {
                    return done(err);
                }
                done();
            });
        });
    });

    describe('installing mongo', function () {
        this.timeout(1000 * 30);
        before(function (done) {
            client = new SheepSshClient(vpsCredentials.hostname, vpsCredentials.rootPassword, done);
        });
        it('works', function (done) {
            client.installMongo(function (err, data) {
                if (err) {
                    return done(err);
                }
                done();
            });
        });
    });

    describe('installing redis', function () {
        this.timeout(1000 * 30);
        before(function (done) {
            client = new SheepSshClient(vpsCredentials.hostname, vpsCredentials.rootPassword, done);
        });
        it('works', function (done) {
            client.installRedis(function (err, data) {
                if (err) {
                    return done(err);
                }
                done();
            });
        });
    });
    
    describe.only('installing sheep', function () {
        this.timeout(1000 * 60 * 2);
        before(function (done) {
            client = new SheepSshClient(vpsCredentials.hostname, vpsCredentials.rootPassword, done);
        });
        it('works', function (done) {

            var vps = {
                _id: "my-vps-id-" + uuid.v4(),
                host: vpsCredentials.hostname,
                infrastructure: "aws-east",
                secret: "asdf"
            };

            client.installSheep(vps, function (err, data) {
                if (err) {
                    return done(err);
                }
                done();
            });
        });
    });
    

    describe('installing paastor', function () {
        this.timeout(1000 * 60 * 2);
        before(function (done) {
            client = new SheepSshClient(vpsCredentials.hostname, vpsCredentials.rootPassword, done);
        });
        it('works', function (done) {
            client.installPaastor(function (err, data) {
                if (err) {
                    return done(err);
                }
                done();
            });
        });
    });

});
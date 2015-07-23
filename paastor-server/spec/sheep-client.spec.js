'use strict';
require('../sheep/bin/www');

var SheepClient = require('../sheep-client');
var sheep = new SheepClient('http://localhost:3000', 'asdf');
var should = require('should');
var uuid = require('node-uuid');
var rimraf = require('rimraf');
var path = require('path');

var request = require('supertest');

describe('sheep-client', function () {
    this.timeout(30000);

    after(function deleteTmpCrap() {
        var paastorTmp = path.join(__dirname, '../tmp/');
        var sheepTmp = path.join(__dirname, '../sheep/tmp/');
        rimraf.sync(paastorTmp);
        rimraf.sync(sheepTmp);
    });

    describe('getting information about the sheep vps', function () {
        it('responds with an object of expected properties', function (done) {
            sheep.info(function (err, info) {
                info.should.be.an.Object;
                info.uptime.should.be.a.Number;
                info.freemem.should.be.a.Number;
                info.totalmem.should.be.a.Number;
                info.cpus.should.be.an.Array;
                (info.cpus.length > 0).should.be.ok;
                info.type.should.be.a.String;
                info.release.should.be.a.String;
                info.arch.should.be.a.String;
                info.platform.should.be.a.String;
                done();
            });
        });
    });

    describe('getting all apps on a vps', function () {
        it('lists them in an array', function (done) {
            sheep.getAllApps(function (err, apps) {
                if(err) {
                    return done(err);
                }
                should.exist(apps);
                apps.should.be.an.Array;
                done();
            });
        });
    });

    describe('createApp', function () {
        var appParams = {
            _id: "someApp-" + uuid.v4(),
            vps: "someVps-" + uuid.v4(),
            gitUrl: 'https://github.com/ruffrey/wwx.git',
            gitBranch: 'master',
            script: 'app.js',
            port: 4003,
            env: { NODE_ENV: "development" },
            domains: ['five.github.io']
        };

        after(function (done) {
            sheep.removeApp(appParams._id, done);
        });

        it('works', function (done) {
            sheep.createApp(appParams, function (err, newApp) {
                if(err) {
                    return done(err);
                }

                newApp._id.should.equal(appParams._id);
                
                // defined by the sheep
                newApp.path.should.be.a.String;

                // See if the app is running
                request('http://localhost:4003')
                .get('/')
                .expect(200, done);

            });
        });
    });

    describe('deleting an app', function () {
        var appParams = {
            _id: "someApp-" + uuid.v4(),
            vps: "someVps-" + uuid.v4(),
            gitUrl: 'https://github.com/ruffrey/wwx.git',
            gitBranch: 'master',
            script: 'app.js',
            port: 4003,
            env: { NODE_ENV: "test" },
            domains: ['five.github.io']
        };

        before(function (done) {
            sheep.createApp(appParams, function (err, newApp) {
                appParams = newApp;
                done(err);
            });
        });

        it('checks that the app exists before we delete it', function (done) {
            sheep.getApp(appParams._id, function (err, app) {
                should.not.exist(err);
                app.should.be.an.Object.and.not.an.Array;
                app._id.should.be.a.String;
                app._id.should.equal(appParams._id);
                done();
            });
        });

        it('removes the app', function (done) {

            sheep.removeApp(appParams._id, function (err) {
                should.not.exist(err);
                sheep.getApp(appParams._id, function (err, body) {
                    err.should.be.an.Object;
                    body.error.status.should.equal(404);
                    done();
                });
            });
        });

    });
});
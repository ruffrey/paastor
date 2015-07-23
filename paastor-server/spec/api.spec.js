var should = require('should');

var paastor = require('../paastor');
var request = require('supertest');
var agent = request.agent(paastor);

var uuid = require('node-uuid');
var paastorCredentials = require('./paastor-credentials.json');
var hash = require('../hash');
paastorCredentials.password = hash(paastorCredentials.password);


describe('paastor API', function () {
    this.timeout(30000);
    before(function (done) {
        agent
        .post('/api/login')
        .send(paastorCredentials)
        .expect(200, function (err, res) {
            if (err) {
                return done(err);
            }
            done();
        });
    });

    describe('/settings', function () {
        it('responds with array at main route', function (done) {
            agent
            .get('/api/settings')
            .expect(200)
            .end(function (err, res) {
                if(err) return done(err);
                res.body.should.be.an.Array;

                for(var i=0; i<res.body.length; i++) {
                    var setting = res.body[i];
                    setting._id.should.be.a.String;
                    setting.value.should.be.a.String;
                }

                done();
            });
        });

        describe('posting a setting', function () {
            var setting = {
                _id: "setting" + uuid.v4(),
                value: "value" + uuid.v4()
            };
            after(function (done) {
                agent
                .delete('/api/settings/' + setting._id)
                .expect(200, done);
            });

            it('returns the created setting', function (done) {
                agent
                .post('/api/settings')
                .send(setting)
                .expect(200)
                .end(function (err, res) {
                    if(err) return done(err);
                    res.body.should.be.an.Object.and.not.an.Array;
                    res.body._id.should.equal(setting._id);
                    res.body.value.should.equal(setting.value);
                    done();
                });
            });

            it('exists in the database', function (done) {
                agent
                .get('/api/settings/' + setting._id)
                .expect(200)
                .end(function (err, res) {
                    if(err) return done(err);
                    res.body._id.should.equal(setting._id);
                    res.body.value.should.equal(setting.value);
                    done();
                });
            });

            it('can be changed', function (done) {
                var newValue = uuid.v4();

                agent
                .put('/api/settings/' + setting._id)
                .send({ value: newValue })
                .expect(200)
                .end(function (err, res) {
                    if(err) return done(err);
                    res.body.should.be.an.Object.and.not.an.Array;
                    res.body._id.should.equal(setting._id);
                    res.body.value.should.equal(newValue);
                    res.body.value.should.not.equal(setting.value);
                    done();
                });
            });

        });

    });

    describe('/vps', function () {

        it('lists an array of vps objects at main route', function (done) {
            agent
            .get('/api/vps')
            .expect(200)
            .end(function (err, res) {
                if(err) return done(err);
                res.body.should.be.an.Array;

                res.body.forEach(function (vps) {
                    vps._id.should.be.a.String;
                    vps.host.should.be.a.String;
                    vps.infrastructure.should.be.a.String;
                    vps.password.should.be.a.String;
                    vps.secret.should.be.a.String;
                    vps.services.should.be.an.Object.and.not.an.Array;
                    vps.env.should.be.an.Object.and.not.an.Array;
                });

                done();
            });
        });

        describe('creating a new one via POST vps', function () {
            var vps = {
                _id: "my-vps-id-" + uuid.v4(),
                host: "127.0.0.3",
                infrastructure: "aws-east",
                password: "jinx1212",
                secret: "asdf",
                services: {},
                env: { NODE_ENV: "test" }
            };

            after(function (done) {
                agent
                .delete('/api/vps/' + vps._id)
                .expect(200, done);
            });

            it('returns the created vps', function (done) {
                agent
                .post('/api/vps')
                .send(vps)
                .expect(200)
                .end(function (err, res) {
                    if(err) return done(err);
                    res.body.should.be.an.Object.and.not.an.Array;
                    res.body._id.should.equal(vps._id);
                    res.body.host.should.equal(vps.host);
                    res.body.infrastructure.should.equal(vps.infrastructure);
                    res.body.password.should.equal(vps.password);
                    res.body.secret.should.equal(vps.secret);
                    res.body.services.should.be.an.Object.and.not.an.Array;
                    res.body.env.should.be.an.Object.and.not.an.Array;
                    done();
                });
            });

            it('exists in the database', function (done) {
                agent
                .get('/api/vps/' + vps._id)
                .expect(200)
                .end(function (err, res) {
                    if(err) return done(err);
                    res.body.should.be.an.Object.and.not.an.Array;
                    res.body._id.should.equal(vps._id);
                    res.body.host.should.equal(vps.host);
                    res.body.infrastructure.should.equal(vps.infrastructure);
                    res.body.password.should.equal(vps.password);
                    res.body.secret.should.equal(vps.secret);
                    res.body.services.should.be.an.Object;
                    res.body.env.should.be.an.Object;
                    done();
                });
            });

            it('can be changed', function (done) {
                var newPassword = uuid.v4();

                agent
                .patch('/api/vps/' + vps._id)
                .send({ password: newPassword })
                .expect(200)
                .end(function (err, res) {
                    if(err) return done(err);
                    res.body.should.be.an.Object.and.not.an.Array;
                    res.body._id.should.equal(vps._id);
                    res.body.password.should.equal(newPassword);
                    res.body.password.should.not.equal(vps.password);
                    done();
                });
            });

        });

    });

    describe('/vps/:vps/apps', function () {

        describe('posting an app', function () {
            var vps = {
                _id: "my-vps-id-" + uuid.v4(),
                host: "localhost:3000",
                infrastructure: "aws-east",
                password: "jinx1212",
                secret: "asdf",
                services: {},
                env: { NODE_ENV: "test" }
            };

            var app = {
                _id: "my-app-" + uuid.v4(),
                vps: vps._id,
                gitUrl: "https://github.com/ruffrey/wwx",
                gitBranch: "master",
                script: "app.js",
                env: { NODE_ENV: "development", PORT: 4005 },
                port: 4005,
                domains: ["stripe.mailsac.com"]
            };

            before(function (done) {
                agent
                .post('/api/vps')
                .send(vps)
                .expect(200, done);
            });

            after(function (done) {
                agent
                .delete('/api/vps/' + vps._id)
                .expect(200, function (err, body) {
                    if(err) return done(err);

                    agent
                    .delete('/api/apps/' + app._id)
                    .expect(200, done);
                });

            });

            it('returns the created app', function (done) {
                agent
                .post('/api/vps/' + vps._id + '/apps')
                .send(app)
                .expect(200)
                .end(function (err, res) {
                    if(err) {
                        return done(err);
                    }
                    res.body._id.should.be.a.String;
                    res.body.vps.should.be.a.String;
                    res.body.gitUrl.should.be.a.String;
                    res.body.gitBranch.should.be.a.String;
                    res.body.script.should.be.a.String;
                    res.body.env.should.be.an.Object.and.not.an.Array;
                    res.body.port.should.be.a.Number;
                    res.body.domains.should.be.an.Array;
                    done();
                });
            });

        });

        describe('actions on an existing app', function () {
            var vps = {
                _id: "my-vps-id-" + uuid.v4(),
                host: "localhost:3000",
                infrastructure: "aws-east",
                password: "jinx1212",
                secret: "asdf",
                services: {},
                env: { NODE_ENV: "test" }
            };

            var app = {
                _id: "my-app-" + uuid.v4(),
                vps: vps._id,
                gitUrl: "https://github.com/ruffrey/wwx",
                gitBranch: "master",
                script: "app.js",
                env: { NODE_ENV: "development", PORT: 4009 },
                port: 4009,
                domains: ["wwx.asdf.co"]
            };

            before(function (done) {
                agent
                .post('/api/vps')
                .send(vps)
                .expect(200, function (err, res) {
                    if(err) return done(err);
                    
                    agent
                    .post('/api/vps/' + vps._id + '/apps')
                    .send(app)
                    .expect(200, done);
                });
            });

            after(function (done) {
                agent
                .delete('/api/vps/' + vps._id)
                .expect(200, done);

            });

            describe('restart', function () {
                it('works', function (done) {
                    agent
                    .post('/api/vps/' + vps._id + '/apps/' + app._id + '/restart')
                    .expect(200, done);
                });
            });
            describe('stop', function () {
                it('works', function (done) {
                    agent
                    .post('/api/vps/' + vps._id + '/apps/' + app._id + '/stop')
                    .expect(200, done);
                });
            });
            describe('start', function () {
                it('works', function (done) {
                    agent
                    .post('/api/vps/' + vps._id + '/apps/' + app._id + '/start')
                    .expect(200, done);
                });
            });
            // TODO
            xdescribe('iterate', function () {
                it('works', function (done) {
                    agent
                    .post('/api/vps/' + vps._id + '/apps/' + app._id + '/iterate')
                    .expect(200, done);
                });
            });
        });

    });
});
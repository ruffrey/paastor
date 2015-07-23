exports = module.exports = function (ngApp) {
    ngApp.controller('VpsViewController', [
        '$scope',
        '$routeParams',
        '$interval',
        'Vps',
        'App',
        function ($scope, $routeParams, $interval, Vps, App) {
            $scope.isUpgrading = false;
            $scope.message = "";
            $scope.vps = null;

            var getvps = function () {
                $scope.message = "";
                Vps.get($routeParams._id, function (err, vps) {
                    $scope.message = "";
                    if (err) {
                        $scope.vps = {};
                        $scope.message = err.message || err.error || err;
                        return;
                    }
                    // likely a static html page response
                    if (typeof vps.info === 'string') {
                        vps.info = { error: vps.info };
                    }
                    if (!vps.info || vps.info.error) {
                        $scope.message = "Unable to retrieve server stats. Your server is not reachable. ";
                        if (vps.info) {
                            if (vps.info.message) {
                                $scope.message += vps.info.message + ' ';
                            }
                            if (vps.info.error && vps.info.error.message) {
                                $scope.message += vps.info.error.message;
                            }
                        }
                    }
                    // making sure proper objects are available for view.
                    if (!vps.info) {
                        vps.info = { apps: [] };
                    }
                    if (!vps.info.apps) {
                        vps.info.apps = [];
                    }
                    vps.info.apps.forEach(function (a) {
                        a.env = JSON.stringify(a.env);
                    });
                    $scope.vps = vps || $scope.vps;
                });
            };
            // $interval(getvps, 8000);
            getvps();

            // remove vps
            $scope.remove = function () {
                $scope.message = '';
                var conf = confirm("Really remove this server?");
                if (!conf) {
                    return;
                }
                Vps.remove($scope.vps._id, function (err) {
                    if (err) {
                        $scope.message = err.message || err.error || err;
                        return;
                    }
                    window.open('/#/list', '_self');
                });
            };

            $scope.updateSheep = function () {
                $scope.message = '';
                $scope.isUpgrading = true;
                Vps.updateSheep($scope.vps._id, { password: $scope.password }, function (err, vps) {
                    $scope.password = "";
                    $scope.isUpgrading = false;
                    if (err) {
                        $scope.message = err.message || err.error || err;
                        return;
                    }
                    getvps();
                    $scope.showUpdatePanel = false;
                });
            };

            $scope.removeApp = function (app) {
                var conf = confirm("Really remove this app?");
                if (!conf) {
                    return;
                }
                app.processing = true;
                app.message = "";
                // in case they reinstalled the sheep on this box and apps remained
                app.vps = $scope.vps._id;
                App.remove(app, function (err, result) {
                    app.processing = false;
                    if (err) {
                        app.message = err.message || err.error || err;
                        return;
                    }
                    getvps();
                });
            };

            $scope.action = function (app, action) {
                app.processing = true;
                app.message = "";
                App.action({
                    action: action,
                    vps: app.vps,
                    _id: app._id
                }, function (err, result) {
                    app.processing = false;
                    if (err) {
                        app.message = err.message || err.error || err;
                        return;
                    }
                    getvps();
                });
            };

            $scope.setEnv = function (app) {
                app.processing = true;
                app.message = "";
                var newEnv;
                try {
                    var newEnv = JSON.parse(app.newEnv);
                }
                catch (ignored) {
                    app.message = "Invalid JSON.";
                    app.processing = false;
                    return;
                }
                App.setEnv({
                    vps: app.vps,
                    _id: app._id
                }, newEnv, function (err, result) {
                    app.processing = false;
                    if (err) {
                        app.message = err.message || err.error || err;
                        return;
                    }
                    getvps();
                });
            };


        }
    ]);
};

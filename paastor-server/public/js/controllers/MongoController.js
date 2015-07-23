
exports = module.exports = function (ngApp) {
    ngApp.controller('MongoController', [
        '$scope',
        'Vps',
        '$routeParams',
        '$log',
        function ($scope, Vps, $routeParams, $log) {
            $scope.vps = null;
            $scope.message = "";
            $scope.loading = false;
            $scope.removed = false;
            $scope.installed = false;
            $scope.sshPassword = "";

            var minport = 27000;
            var maxport = 27999;
            var notallowed = [27014, 27374, 27950];
            var randPort = function () {
                var outport = Math.floor(Math.random() * (maxport - minport + 1)) + minport;
                // recursion
                if (notallowed.indexOf(outport) !== -1) {
                    $log.debug('ports collided', outport);
                    outport = randPort();
                }
                return outport;
            };
            $scope.portgen = function () {
                $scope.mongo.port = randPort();
            };

            $scope.mongo = {
                port: 27017,
                password: "",
                username: "",
                localOnly: true,
                rootPassword: ""
            };

            Vps.get($routeParams.vps, function (err, vps) {
                if (err) {
                    $scope.message = err.message || err.error || err;
                    return;
                }
                $scope.vps = vps;
            })

            $scope.install = function (params) {
                if ($scope.mongo.username && !$scope.mongo.password) {
                    $scope.message = "Password is required when using a username.";
                    return;
                }
                if ($scope.mongo.password && !$scope.mongo.username) {
                    $scope.message = "Username is required when using a password.";
                    return;
                }
                $scope.removed = false;
                $scope.loading = true;
                $scope.message = "Installing MongoDB...";

                Vps.installMongo($scope.vps._id, $scope.mongo, function (err, res) {
                    $scope.loading = false;
                    if (err) {
                        $scope.message = err.message || err.error || err || "Connection hung";
                        return;
                    }
                    $scope.installed = true;
                    $scope.message = "";
                });
            };

            $scope.uninstall = function () {
                $scope.installed = false;
                $scope.loading = true;
                $scope.message = "Removing MongoDB...";

                Vps.uninstallMongo({ _id: $scope.vps._id, rootPassword: $scope.mongo.rootPassword}, function (err, res) {
                    $scope.loading = false;
                    if (err) {
                        $scope.message = err.message || err.error || err;
                        return;
                    }
                    $scope.mongo = res;
                    $scope.vps.mongo = false;
                    $scope.removed = true;
                    $scope.message = "";
                });
            };

        }
    ]);    
};
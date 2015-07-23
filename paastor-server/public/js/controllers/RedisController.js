
exports = module.exports = function (ngApp) {
    ngApp.controller('RedisController', [
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

            var minport = 7011;
            var maxport = 7470;
            var notallowed = [7022, 7023, 7025, 7047, 7080, 7262, 7306, 7307, 7312, 7396, 7400, 7401, 7402];
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
                $scope.redis.port = randPort();
            };

            $scope.redis = {
                port: 6379,
                password: "",
                generatePassword: true,
                noPassword: false,
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
                $scope.removed = false;
                $scope.loading = true;
                $scope.message = "Installing Redis...";

                Vps.installRedis($scope.vps._id, $scope.redis, function (err, res) {
                    $scope.loading = false;
                    if (err) {
                        $scope.message = err.message || err.error || err;
                        return;
                    }
                    $scope.redis.password = res.password;
                    $scope.vps.redis = true;
                    $scope.installed = true;
                    $scope.message = "";
                });
            };

            $scope.uninstall = function () {
                $scope.installed = false;
                $scope.loading = true;
                $scope.message = "Removing Redis...";

                Vps.uninstallRedis({ _id: $scope.vps._id, rootPassword: $scope.redis.rootPassword}, function (err, res) {
                    $scope.loading = false;
                    if (err) {
                        $scope.message = err.message || err.error || err;
                        return;
                    }
                    $scope.redis = res;
                    $scope.vps.redis = false;
                    $scope.removed = true;
                    $scope.message = "";
                });
            };

        }
    ]);    
};
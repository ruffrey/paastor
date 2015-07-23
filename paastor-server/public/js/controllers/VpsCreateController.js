'use strict';
exports = module.exports = function (ngApp) {
    ngApp.controller('VpsCreateController', [
        '$scope',
        'Vps',
        '$timeout',
        '$interval',
        function ($scope, Vps, $timeout, $interval) {
            $scope.vps = {};
            $scope.message = "";
            $scope.saving = false;
            $scope.done = false;
            $scope.logs = "";
            $scope.logcheck = null; // timer
            var logElement = document.getElementById('server-logs');
            var setScroll = function () {
                logElement.scrollTop = logElement.scrollHeight;
            };
            var checkLogs = function () {
                Vps.get($scope.vps._id, function (err, vps) {
                    if (err) {
                        $scope.logs += err.message || err.error || err;
                    }
                    else if (vps) {
                        $scope.logs = vps.logs;
                    }

                    if (vps && vps.status !== "install") {
                        $interval.cancel($scope.logcheck);
                    }
                    // BAD
                    $timeout(setScroll, 1);
                });
            };

            $scope.save = function () {
                $scope.saving = true;
                $scope.message = "Installing your server. This will take several minutes. Please do not leave the page.";

                $scope.logs = "";
                $scope.logcheck = $interval(checkLogs, 3000);

                Vps.create($scope.vps, function (err, data) {
                    $scope.saving = false;
                    $interval.cancel($scope.logcheck);
                    if (err) {
                        $scope.message = err.message || err.error;
                        if ($scope.logs) {
                            $scope.logs += $scope.message;
                        }
                        if (data !== 400) {
                            Vps.remove($scope.vps._id, function (err, data) {
                                if (err) {
                                    console.error('error removing vps after failed creation', err);
                                    return;
                                }
                                console.log('removed vps after failed creation', data);
                            });
                        }
                        // BAD
                        setScroll();
                        return;
                    }
                    $scope.message = "Done.";
                    $scope.done = true;
                    $scope.vps = data;
                });
            };

        }
    ]);
};

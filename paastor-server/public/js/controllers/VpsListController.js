var uuid = require('uuid');
exports = module.exports = function (ngApp) {
    ngApp.controller('VpsListController', [
        '$scope',
        '$rootScope',
        '$location',
        'Vps',
        'Account',
        function ($scope, $rootScope, $location, Vps, Account) {
            $scope.$location = $location;
            $scope.vpses = null;
            $scope.message = "";

            Vps.getAll(function (err, vpses) {
                if (err) {
                    $scope.message = err.error;
                    return;
                }
                $scope.vpses = vpses;
            });

            $scope.hidekey = function () {
                delete $rootScope.account.sshkey_pub;
            };

            $scope.viewSshKey = function () {
                $scope.message = "";
                Account.get("sshkey_pub", function (err, account) {
                    if (err) {
                        $scope.message = err.error;
                        return;
                    }
                    $rootScope.account = account;
                });
            };

            $scope.rekeygen = function () {
                $scope.message = "";
                var really = confirm('Confirm ssh key regeneration.\n\nThis can never be undone.');
                if (!really) {
                    return;
                }
                Account.keygen(function (err, account) {
                    if (err) {
                        $scope.message = err.error;
                        return;
                    }
                    $rootScope.account = account;
                });
            };
        }
    ]);    
};
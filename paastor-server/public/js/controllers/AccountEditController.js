
exports = module.exports = function (ngApp) {
    ngApp.controller('AccountEditController', [
        '$scope',
        'Account',
        'Payments',
        '$rootScope',
        function ($scope, Account, Payments, $rootScope) {
            $scope.vps = {};
            $scope.message = "";
            $scope.password = "";
            $scope.passwordConf = "";
            $scope.card = null;
            $scope.newCard = {};

            Account.getCard(function (err, card) {
                if (err) {
                    $scope.message = err.error;
                    return;
                }
                $scope.card = card;
            });

            $scope.changePassword = function () {
                $scope.message = "";
                if (!$scope.password) {
                    $scope.message = "Password is required."
                    return;
                }
                if ($scope.password !== $scope.passwordConf) {
                    $scope.message = "Passwords don't match.";
                    return;
                }
                Account.update({
                    password: $scope.password
                }, function (err, account) {
                    if (err) {
                        $scope.message = err.error;
                        return;
                    }
                    $scope.password = "";
                    $scope.passwordConf = "";
                    $scope.message = "Password was changed.";
                });
                
            };

            $scope.setCard = function () {
                $scope.message = "";
                Payments.card($scope.newCard, function (err, card) {
                    console.log(err, card);
                    if (err) {
                        $scope.message = err.error;
                        $scope.$apply();
                        return;
                    }
                    $scope.card = card;
                    $scope.newCard = {};
                    $scope.message = "Successfully updated card.";
                });
            };
        }
    ]);    
};
var hash = require('../../../lib/hash');

exports = module.exports = function (ngApp) {
    ngApp.controller('NavController', [
        '$scope',
        '$rootScope',
        '$location',
        'Account',
        function ($scope, $rootScope, $location, Account) {
            $scope.signin = {
                email: "",
                password: ""
            };
            $scope.signup = {
                email: "",
                password: ""
            };
            $scope.confirming = {
                _id: "",
                conf: ""
            };
            $scope.resetPass;
            $scope.message = "";

            Account.get(function (err, account) {
                if (err && window.location.hash && window.location.hash !== '#/') {
                    window.open('/#/', '_self');
                    return;
                }
                if (!account && window.location.hash && window.location.hash !== '#/') {
                    window.open('/#/', '_self');
                    return;
                }
                $rootScope.account = account;
            });


            $scope.login = function () {
                $scope.message = "";

                if (!$scope.signin.email) {
                    $scope.message = "Missing email";
                    return;
                }
                if (!$scope.signin.password) {
                    $scope.message = "Missing password";
                    return;
                }
                
                Account.login({ email: $scope.signin.email, password: $scope.signin.password }, function (err, data) {
                    if (err) {
                        $scope.message = err.error;
                        return;
                    }
                    $scope.signin = {};
                    $rootScope.account = data;
                    $location.path('/list');
                });
            };

            $scope.logout = function () {
                $scope.message = "";
                Account.logout(function (err) {
                    if (err) {
                        $scope.message = err.error;
                        return;
                    }
                    $rootScope.account = null;
                    window.open('/#/', '_self');
                });
            };

            $scope.register = function () {
                $scope.message = "";
                Account.create($scope.signup, function (err, account) {
                    if (err) {
                        $scope.message = err.error;
                        return;
                    }
                    // do not log them in. need to confirm account first.
                    $scope.message = "Success! Check your email to confirm your account.";
                    $scope.signup = {};
                });
            };

            $scope.forgot = function () {
                $scope.message = "";
                if (!$scope.signin.email) {
                    $scope.message = "Put in your email first";
                    return;
                }
                Account.forgotPassword($scope.signin.email, function (err, data) {
                    if (err) {
                        $scope.message = err.error;
                        return;
                    }
                    $scope.signin = {};
                    $scope.message = data.message;
                });
            };

            $scope.doPasswordReset = function () {
                $scope.message = "";
                if (!$scope.resetPass.password) {
                    $scope.message = "Password is required.";
                    return;
                }
                if ($scope.resetPass.password !== $scope.resetPass.passwordConf) {
                    $scope.message = "Passwords must match.";
                    return;
                }
                
                Account.resetPassword($scope.resetPass._id, $scope.resetPass.conf, $scope.resetPass.password, function (err, account) {
                    if (err) {
                        $scope.message = err.error;
                        return;
                    }
                    $rootScope.account = account;
                    $scope.resetPass = {};
                    window.open('/#/', '_self');
                });
            };
        }
    ]); 
};
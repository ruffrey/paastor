var uuid = require('uuid');
exports = module.exports = function (ngApp) {
    ngApp.controller('ManageServicesController', [
        '$scope',
        '$rootScope',
        'Account',
        'Payments',
        function ($scope, $rootScope, Account, Payments) {
            $scope.Math = window.Math;

            $scope.message = "";
            $scope.hasNoCard = false;
            $scope.subMsg = ""; // subscription message
            $scope.buyMsg = ""; // purchase message
            
            // Pre load some data
            $scope.subscriptions = [];
            $scope.plans = [];
            $scope.card = null;

            Payments.getPlans(function (err, data) {
                if (err) {
                    $scope.message = err.error;
                    return;
                }
                $scope.plans = data;
            });
            $scope.subs = function () {
                Payments.getSubscriptions(function (err, data) {
                    if (err) {
                        $scope.message = err.error;
                        return;
                    }
                    $scope.subscriptions = data;
                });
            };
            $scope.subs();
            Account.getCard(function (err, card) {
                if (err) {
                    $scope.message = err.error;
                    return;
                }
                if (!card || !card.last4) {
                    $scope.hasNoCard = true;
                }
            });


            $scope.addService = function (plan) {
                $scope.buyMsg = "";
                plan.quantity = Math.floor(parseFloat(plan.quantity));
                if (isNaN(plan.quantity) || plan.quantity < 1) {
                    $scope.buyMsg = "Plan quantity is invalid.";
                    return;
                }

                var conf = confirm('Please confirm this subscription.\n\nYou will be billed ' + plan.interval + 'ly at $' + ((plan.amount * plan.quantity)/100).toFixed(2) + ' for the following service:\n\n' +plan.quantity + 'x ' + plan.name);
                if (!conf) {
                    return;
                }
                Payments.addSubscription(plan, function (err, subscriptions) {
                    if (err) {
                        $scope.buyMsg = err.error;
                        return;
                    }
                    Account.get(function (err, account) {
                        if (err) {
                            return;
                        }
                        $rootScope.account = account;
                    });
                    $scope.subscriptions = subscriptions;
                });
            };

            $scope.downgrade = function (sub) {
                $scope.subMsg = "";
                sub.down = Math.floor(parseFloat(sub.down));
                if (isNaN(sub.down) || sub.down < 1) {
                    $scope.subMsg = "Downgrade quantity is invalid.";
                    return;
                }
                if (sub.down > sub.quantity) {
                    $scope.subMsg = "Downgrade quantity cannot exceed current subscription quantity.";
                    return;
                }

                var conf = confirm("Please confirm your downgrade. ALL CREDITS will be lost and the changes will be applied IMMEDIATELY.\n\nREMOVE " + sub.down + "x " + sub.plan.name + "\n\nNew quantity will be " + (sub.quantity - sub.down) + "x");
                if (!conf) {
                    return;
                }
                var plan = {
                    quantity: -sub.down,
                    id: sub.plan.id,
                    name: sub.plan.name
                };
                Payments.addSubscription(plan, function (err, subscriptions) {
                    if (err) {
                        $scope.subMsg = err.error;
                        return;
                    }
                    Account.get(function (err, account) {
                        if (err) {
                            return;
                        }
                        $rootScope.account = account;
                    });
                    $scope.subscriptions = subscriptions;
                });
            };
        }
    ]);    
};

exports = module.exports = function (ngApp) {
    ngApp.controller('AppSslController', [
        '$scope',
        'App',
        '$routeParams',
        function ($scope, App, $routeParams) {
            $scope.app = {vps: $routeParams.vps, _id: $routeParams.app };
            $scope.message = "";
            $scope.saving = false;
            $scope.done = false;

            $scope.save = function () {
                $scope.saving = true;
                $scope.message = "";

                App.setSsl($scope.app, function (err, data) {
                    $scope.saving = false;
                    if (err) {
                        $scope.message = err.message || err.error || err;
                        return
                    }
                    $scope.done = true;
                    $scope.saving = false;
                });
            };

        }
    ]);    
};
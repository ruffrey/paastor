
exports = module.exports = function (ngApp) {
    ngApp.controller('AppCreateController', [
        '$scope',
        'Vps',
        'App',
        '$routeParams',
        '$interval',
        function ($scope, Vps, App, $routeParams, $interval) {
            $scope.app = {vps: $routeParams._id };
            $scope.message = "";
            $scope.saving = false;
            $scope.done = false;
            $scope.logs = "";

            $scope.save = function () {
                $scope.saving = true;
                $scope.message = "Creating and starting the app. This will take several minutes.";

                App.create($scope.app, function (err, data) {
                    $scope.saving = false;
                    if (err) {
                        $scope.message = err.message || err.error || err;
                        return
                    }
                    
                    $scope.message = "Done.";
                    $scope.saving = false;
                    $scope.done = true;
                });
            };

        }
    ]);    
};
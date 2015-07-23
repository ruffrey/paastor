angular.module('readableTime', []).filter('readableTime', require('./readable-time'));
Stripe.setPublishableKey( 
    location.hostname.indexOf('paastor.com') === -1 
    ? 'pk_test_GdSOMC1qnIe80eWMZkhVoDXR' 
    : 'pk_live_pcMlMokqIbmjbureLdobpP8D' 
);

var ngmodules = ['ngResource', 'readableTime'];
if (window.location.pathname === '/') {
    ngmodules.push('ngRoute');
}
var paastor = angular.module('paastor', ngmodules);

require('./controllers/NavController')(paastor);
require('./controllers/VpsCreateController')(paastor);
require('./controllers/VpsListController')(paastor);
require('./controllers/VpsViewController')(paastor);
require('./controllers/AppCreateController')(paastor);
require('./controllers/AppSslController')(paastor);
require('./controllers/RedisController')(paastor);
require('./controllers/MongoController')(paastor);
require('./controllers/AccountEditController')(paastor);
require('./controllers/ManageServicesController')(paastor);

require('./services.js')(paastor);

paastor.directive('paEnter', require('./directives/pa-enter.js'));

if (window.location.pathname === '/') {
    paastor
    .config(['$routeProvider',
        function ($routeProvider) {

            $routeProvider
            .when('/', {
                templateUrl: 'build/html/home.html'
            })
            .when('/manage-services', {
                templateUrl: 'build/html/manage-services.html',
                controller: 'ManageServicesController'
            })
              .when('/account', {
                templateUrl: 'build/html/account-edit.html',
                controller: 'AccountEditController'
            })
            .when('/list', {
                templateUrl: 'build/html/vps-list.html',
                controller: 'VpsListController'
            })
            .when('/vps', {
                templateUrl: 'build/html/vps-create.html',
                controller: 'VpsCreateController'
            })
            .when('/vps/:_id', {
                templateUrl: 'build/html/vps-view.html',
                controller: 'VpsViewController'
            })
            .when('/vps/:_id/app', {
                templateUrl: 'build/html/app-create.html',
                controller: 'AppCreateController'
            })
            .when('/vps/:vps/ssl/:app', {
                templateUrl: 'build/html/app-ssl.html',
                controller: 'AppSslController'
            })
            .when('/vps/:vps/redis', {
                templateUrl: 'build/html/redis.html',
                controller: 'RedisController'
            })
            .when('/vps/:vps/mongo', {
                templateUrl: 'build/html/mongo.html',
                controller: 'MongoController'
            })
            .otherwise({
                templateUrl: 'build/html/404.html'
            });

        }
    ]);
}
else {
    
}

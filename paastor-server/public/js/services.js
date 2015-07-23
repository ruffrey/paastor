exports = module.exports = function (paastor) {
    var success = function (callback) {
        return function (data) { callback(null, data); };
    };
    var fail = function (callback) {
        return function (err, status) { callback(err || { error: "Error. No response from Paastor." }, status); };
    };
    // Account
    paastor.factory('Account', ['$http',
        function ($http) {
            return {
                confirm: function (_id, conf, callback) {
                    $http
                    .put('/api/confirmation/' + _id + '/' + conf)
                    .success(success(callback)).error(fail(callback));
                },
                resetPassword: function (_id, conf, password, callback) {
                    $http
                    .put('/api/password-reset/' + _id + '/' + conf, { password: password })
                    .success(success(callback)).error(fail(callback));
                },
                forgotPassword: function (email, callback) {
                    $http
                    .put('/api/forgot/' + email)
                    .success(success(callback)).error(fail(callback));
                },
                create: function (account, callback) {
                    $http
                    .post('/api/accounts', account)
                    .success(success(callback)).error(fail(callback));
                },
                login: function (params, callback) {
                    $http
                    .post('/api/login', params)
                    .success(success(callback)).error(fail(callback));
                },
                logout: function (callback) {
                    $http({
                        url: '/api/login',
                        method: 'DELETE'
                    })
                    .success(success(callback)).error(fail(callback));
                },
                get: function (fields, callback) {
                    var query = "?";
                    if (fields && callback) {
                        query += 'select=' + fields;
                    }
                    else if (fields && !callback) {
                        callback = fields;
                    }
                    $http.get('/api/account' + query)
                    .success(success(callback)).error(fail(callback));
                },
                update: function (params, callback) {
                    $http({
                        url: '/api/account',
                        method: 'PATCH',
                        data: params
                    })
                    .success(success(callback)).error(fail(callback));
                },
                setCard: function (cardToken, callback) {
                    $http.put('/api/account/card/' + cardToken)
                    .success(success(callback)).error(fail(callback));
                },
                getCard: function (callback) {
                    $http.get('/api/account/card')
                    .success(success(callback)).error(fail(callback));
                },
                keygen: function (callback) {
                    $http.put('/api/account/keygen')
                    .success(success(callback)).error(fail(callback));
                }
            };
        }
    ]);
    // Vps
    paastor.factory('Vps', ['$http',
        function ($http) {
            return {
                getAll: function (callback) {
                    $http
                    .get('/api/vps')
                    .success(success(callback)).error(fail(callback));
                },
                get: function (_id, callback) {
                    $http
                    .get('/api/vps/' + _id)
                    .success(success(callback)).error(fail(callback));
                },
                create: function (params, callback) {
                    $http
                    .post('/api/vps', params)
                    .success(success(callback)).error(fail(callback));
                },
                update: function (params, callback) {
                    $http({
                        url: '/api/vps/' + params._id,
                        method: 'PATCH',
                        data: params
                    })
                    .success(success(callback)).error(fail(callback));
                },
                remove: function (_id, callback) {
                    $http({
                        url: '/api/vps/' + _id,
                        method: 'DELETE'
                    })
                    .success(success(callback)).error(fail(callback));
                },
                updateSheep: function (_id, params, callback) {
                    $http.put('/api/vps/' + _id + '/update-sheep', params)
                    .success(success(callback)).error(fail(callback));
                },
                installRedis: function (_id, params, callback) {
                    $http.post('/api/vps/' + _id + '/redis', params)
                    .success(success(callback)).error(fail(callback));
                },
                uninstallRedis: function (params, callback) {
                    $http.delete('/api/vps/' + params._id + '/redis', { params: params })
                    .success(success(callback)).error(fail(callback));
                },
                installMongo: function (_id, params, callback) {
                    $http.post('/api/vps/' + _id + '/mongo', params)
                    .success(success(callback)).error(fail(callback));
                },
                uninstallMongo: function (params, callback) {
                    $http.delete('/api/vps/' + params._id + '/mongo', { params: params })
                    .success(success(callback)).error(fail(callback));
                }
            };
        }
    ]);
    // App
    paastor.factory('App', ['$http',
        function ($http) {
            return {
                create: function (params, callback) {
                    $http
                    .post('/api/vps/' + params.vps + '/apps', params)
                    .success(success(callback)).error(fail(callback));
                },
                remove: function (params, callback) {
                    $http({
                        url: '/api/vps/' + params.vps + '/apps/' + params._id,
                        method: 'DELETE'
                    })
                    .success(success(callback)).error(fail(callback));
                },
                setEnv: function (params, newEnv, callback) {
                    $http
                    .put('/api/vps/' + params.vps +'/apps/' + params._id + '/env', newEnv)
                    .success(success(callback)).error(fail(callback));
                },
                setSsl: function (params, callback) {
                    $http
                    .put('/api/vps/' + params.vps +'/apps/' + params._id + '/ssl', params)
                    .success(success(callback)).error(fail(callback));
                },
                action: function (params, callback) {
                    $http
                    .put('/api/vps/' + params.vps +'/apps/' + params._id + '/' + params.action)
                    .success(success(callback)).error(fail(callback));
                }
            };
        }
    ]);
    // Payments
    paastor.factory('Payments', [ '$http', 'Account',
        function ($http, Account) {
            return {
                card: function (params, callback) {
                    Stripe.card.createToken({
                        number: params.number,
                        cvc: params.cvc,
                        exp_month: params.exp_month,
                        exp_year: params.exp_year,
                        name: params.name,
                        address_line1: params.address_line1,
                        address_line2: params.address_line2,
                        address_city: params.address_city,
                        address_state: params.address_state,
                        address_zip: params.address_zip,
                        address_country: params.address_country
                    }, function (status, res) {
                        if (res.error) {
                            return callback({ error: res.error.message });
                        }
                        var cardToken = res.id;
                        Account.setCard(cardToken, callback);
                    });
                },
                getPlans: function (callback) {
                    $http.get('/api/plans')
                    .success(success(callback)).error(fail(callback));
                },
                getSubscriptions: function (callback) {
                    $http.get('/api/account/subscriptions')
                    .success(success(callback)).error(fail(callback));
                },
                addSubscription: function (plan, callback) {
                    $http.post('/api/account/subscriptions', plan)
                    .success(success(callback)).error(fail(callback));
                }
            }
        }
    ]);
};

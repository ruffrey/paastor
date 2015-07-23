var config = require('../config');
var stripe = require('stripe')(config.stripe.secret);
var async = require('async');

var plans = [];

var pricePerServer = 0.99;

for (var i=0; i < 51; i++) {

    var plan = {
        currency: 'usd',
        id: 'server-' + i,
        interval: 'year',
        name: i + (i === 1 ? ' server' : ' servers @' + pricePerServer),
        amount: Math.floor( pricePerServer * i * 12 * 100),
        statement_description: 'PAASTOR'
    };
    plans.push(plan);
}

async.each(plans, function (plan, cb) {
    stripe.plans.create(plan, function (err, data) {
        if (err) {
            console.error('  ERROR', err, plan.id);
        }
        cb();
    });
}, function (err, data) {
    if (err) {
        console.error('ERROR', err);
        return;
    }
    console.log('\nDONE');
});
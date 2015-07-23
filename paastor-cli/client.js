'use strict';

/**
 * Generic wrapper client for Paastor.
 *
 * All `callback` functions receive three arguments:
 *
 *      callback(error, res, body)
 *
 * @param {object} options
 * @param {string} [options.paastorUrl=https://paastor.com/api]
 */
function Client (options) {
    var self = this;
    options = options || {};

    self.cookies = [];

    var paastorUrl = options.paastorUrl || "https://paastor.com/api";

    var request = require('request').defaults({
        // cookies
        jar: true,
        rejectUnauthorized: false
    });


    /**
     * Log in.
     * @param {object} params
     * @param {string} [params.email]
     * @param {string} [params.password]
     * @param {function} callback
     */
    self.login = function (params, callback) {
        request({
            method: 'POST',
            uri: paastorUrl + '/login',
            json: true,
            body: params
        }, callback);
    };

    /**
     * List all servers.
     * @param {object} params - Optional
     * @param {array} [params.cookies] - Optional
     * @param {function} callback
     */
    self.listServers = function (params, callback) {
        var cookies = params.cookies || self.cookies;
        delete params.cookies;

        if (typeof params === 'function' && !callback) {
            callback = params;
        }
        request({
            method: 'GET',
            uri: paastorUrl + '/vps',
            json: true,
            headers: {
                'Cookie': cookies
            }
        }, callback);
    };

    /**
     * Get logs for a server or an app on a server.
     * @param {object} params
     * @param {string} [params.vps] - The server _id.
     * @param {string} [params.app] - The app _id.
     * @param {array} [params.cookies] - Optional
     * @param {function} callback
     */
    self.getLogs = function (params, callback) {

        var reqUrl = paastorUrl + '/vps/' + params.vps;
        if (!params.app) {
            reqUrl += '/logs';
        }
        else {
            reqUrl += '/apps/' + params.app + '/logs';
        }

        var cookies = params.cookies || self.cookies;
        delete params.cookies;

        request({
            method: 'GET',
            uri: reqUrl,
            json: true,
            headers: {
                'Cookie': cookies
            }
        }, callback);
    };

    /**
     * Get detailed diagnostic info about a server.
     * @param {object} params
     * @param {string} [params.vps] - The server _id.
     * @param {array} [params.cookies] - Optional
     * @param {function} callback
     */
    self.getServerInfo = function (params, callback) {
        var cookies = params.cookies || self.cookies;
        delete params.cookies;

        request({
            method: 'GET',
            uri: paastorUrl + '/vps/' + params.vps,
            json: true,
            headers: {
                'Cookie': cookies
            }
        }, callback);
    };

    /**
     * Stop a currently running app.
     * @param {object} params
     * @param {string} [params.vps] - The server _id.
     * @param {string} [params.app] - The app _id.
     * @param {array} [params.cookies] - Optional
     * @param {function} callback
     */
    self.stopApp = function (params, callback) {
        var cookies = params.cookies || self.cookies;
        delete params.cookies;

        request({
            method: 'PUT',
            uri: paastorUrl + '/vps/' + params.vps + '/apps/' + params.app + '/kill',
            json: true,
            headers: {
                'Cookie': cookies
            }
        }, callback);
    };

    /**
     * Start a currently running app.
     * @param {object} params
     * @param {string} [params.vps] - The server _id.
     * @param {string} [params.app] - The app _id.
     * @param {array} [params.cookies] - Optional
     * @param {function} callback
     */
    self.startApp = function (params, callback) {
        var cookies = params.cookies || self.cookies;
        delete params.cookies;

        request({
            method: 'PUT',
            uri: paastorUrl + '/vps/' + params.vps + '/apps/' + params.app + '/start',
            json: true,
            headers: {
                'Cookie': cookies
            }
        }, callback);
    };

    /**
     * Start a currently running app.
     * @param {object} params
     * @param {string} [params.vps] - The server _id.
     * @param {string} [params.app] - The app _id.
     * @param {array} [params.cookies] - Optional
     * @param {function} callback
     */
    self.restartApp = function (params, callback) {
        var cookies = params.cookies || self.cookies;
        delete params.cookies;

        request({
            method: 'PUT',
            uri: paastorUrl + '/vps/' + params.vps + '/apps/' + params.app + '/restart',
            json: true,
            headers: {
                'Cookie': cookies
            }
        }, callback);
    };

    /**
     * Set / change environment variable
     * @param {object} params
     * @param {string} [params.vps] - The server _id.
     * @param {string} [params.app] - The app _id.
     * @param {array} [params.key] - The env var name
     * @param {array} [params.val] - The env var value
     * @param {function} callback
     */
    self.setenv = function (params, callback) {

        var cookies = params.cookies || self.cookies;
        delete params.cookies;

        request({
            method: 'PUT',
            uri: paastorUrl + '/vps/' + params.vps + '/apps/' + params.app + '/setvar',
            json: true,
            body: params,
            headers: {
                'Cookie': cookies
            }
        }, callback);
    };

    /**
     * Set / change environment variable
     * @param {object} params
     * @param {string} [params.vps] - The server _id.
     * @param {string} [params.version] - The version of Node.js to install.
     * @param {function} callback
     */
    self.installNode = function (params, callback) {

        var cookies = params.cookies || self.cookies;
        delete params.cookies;

        request({
            method: 'POST',
            uri: paastorUrl + '/vps/' + params.vps + '/node/' + params.version,
            json: true,
            headers: {
                'Cookie': cookies
            }
        }, callback);
    };

    self.pushPackage = function (params, callback) {

        var cookies = params.cookies || self.cookies;
        delete params.cookies;

        var uri = paastorUrl + '/vps/' + params.vps + '/apps/' + params.app + '/pkg';

        delete params.vps;
        delete params.app;

        request({
            method: 'PUT',
            uri: uri,
            json: true,
            headers: {
                'Cookie': cookies
            },
            body: params
        }, callback);
    };

    self.createApp = function (params, callback) {
        var cookies = params.cookies || self.cookies;
        delete params.cookies;

        var uri = paastorUrl + '/vps/' + params.vps + '/apps';

        delete params.vps;
        delete params.app;

        request({
            method: 'POST',
            uri: uri,
            json: true,
            headers: {
                'Cookie': cookies
            },
            body: params
        }, callback);
    };
}

exports = module.exports = Client;

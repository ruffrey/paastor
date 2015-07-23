'use strict';
// Test http server
var http = require('http');
var port = process.env.PAASTOR_PORT || 3006;

http.createServer(function (req, res) {
    var sometime = +new Date();
    console.log(req.method, req.url, sometime);
    res.writeHead(200, {'Content-Type': 'application/json'});
    var message = { message: "it works", sometime: sometime };
    res.end(JSON.stringify(message));
}).listen(port, '127.0.0.1');
console.log('Server running at http://127.0.0.1:' + port);

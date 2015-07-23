'use strict';
var debug = require('debug')('paastor');
var logger = require('debug')('redir');
var app = require('../paastor');
var http = require('http');
var https = require('https');
var fs = require('fs');

// if (process.env.NODE_ENV === 'production') {

//     var sslServer = https.createServer({
//         key: fs.readFileSync(__dirname + '/../paastor.key'),
//         cert: fs.readFileSync(__dirname + '/../paastor.crt'),
//         ca: [fs.readFileSync(__dirname + '/../gd_bundle-g2-g1.crt')] // godaddy ssl CA
//     }, app).listen(3443, function () {
//           debug('Paastor SSL server listening on port ' + sslServer.address().port);
//     });

//     var server = http.createServer(function (req, res) {
//         var secureLocation = 'https://' + req.headers.host + req.url;
//          logger(+new Date(), secureLocation);
//          res.writeHead(302, {
//                'Content-Type': 'text/plain', 
//                'Location': secureLocation
//            });
//          res.end('Redirecting to SSL\n');
//       }).listen(3380, function () {
//           debug('Paastor redirect service listening on port ' + server.address().port);
//     });

// }
// else {
    var server = http.createServer(app).listen(process.env.PAASTOR_PORT || 2999, function () {
          debug('Paastor redirect service listening on port ' + server.address().port);
    });
// }

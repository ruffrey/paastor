[![NPM version](https://badge.fury.io/js/paastor.svg)](http://badge.fury.io/js/paastor)

# Deploy to [Paastor](https://paastor.com) via command line interface (CLI)

[Quickstart Usage Guide](https://paastor.com/pages/usage.html)

[CLI Documentation](https://paastor.com/pages/pstr-cli.html)

```bash
npm install -g paastor
```

Then use the `pstr` tool:

```bash
pstr [commands go here]
```

# Use the client library programmatically

```bash
npm install paastor --save
```

```javascript
var Paastor = require('paastor');
var paastor = new Paastor();
paastor.login({ email: 'asdf', password: 'asdfasdf' }, function (data, res, body) {
    console.log('logged in');

    paastor.listServers(function (err, servers) {
        console.log('servers', servers);
    });

    paastor.getLogs({ vps: 'myserver', app: 'chatty' }, function (err, logs) {
        console.log('logs', logs);
    });

});
```

----
###### Copyright (c) 2014 Jeff Parrish
###### MIT License

var config = {
    redisSession: {
        host: 'localhost',
        port: '6379',
        secret: ''
    },
    mongo: "mongodb://localhost/paastor",
    email: {
        key: "",
        from: "hello@mydomain.com"
    },
    url: "http://localhost:2999",
    stripe: {
        public: '',
        secret: ''
    },
    sheepDownload: "http://localhost/or-something"
};

if (process.env.NODE_ENV === 'production') {
    config.redisSession = {
        host: process.env.REDIS_HOST || config.redisSession.host,
        port: process.env.REDIS_PORT || config.redisSession.port,
        secret: process.env.REDIS_SECRET || config.redisSession.secret,
        password: process.env.REDIS_PASS || config.redisSession.password
    };

   config.url = "https://paastor.com";
   config.mongo = "some-uri"
   config.stripe = {
        public: '',
        secret: ''
    };
}

exports = module.exports = config;

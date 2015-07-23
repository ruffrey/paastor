#!/bin/sh

if [ $(ps aux | grep $USER | grep node | grep -v grep | wc -l | tr -s "\n") -eq 0 ]
then
        echo "$(date) Forever not running, will try to start the app."
        NODE_ENV=production DEBUG=sheep:proxy,sheep:request,sheep:api,sheep:http /usr/local/nvm/v0.10.31/bin/node /usr/local/bin/forever -l /root/sheep.log -o sheep-out.log -e sheep-err.log -a -m 10000 --plain start /root/sheep/proxy.js
else
    echo "$(date) Node or Forever is running, no need to start."
fi

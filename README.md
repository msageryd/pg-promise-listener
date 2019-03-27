# pg-promise-listener

Resilient notification listener for pg-promise

The code in this module is mostly copied from Vitaly Tomilov's example code, which can be found here:
https://github.com/vitaly-t/pg-promise/wiki/Robust-Listeners

## Install

```
npm install github:msageryd/pg-promise-listener --save
```

## Use

Example:

```javascript
const Listener = require('msageryd/pg-promise-listener');
const pgp = require('pg-promise')();

const myConnection = pgp({
  host: 'localhost',
  port: 5432,
  database: 'myDatabase',
  user: 'myUser',
  password: 'myPassword',
});

function messageHandler(message) {
  console.log(message);
}

const listener = new Listener({
  dbConnection: myConnection,
  onDatabaseNotification: messageHandler,
  channel: 'myChannel',
});
```

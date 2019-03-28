# pg-promise-listener

Resilient notification listener for pg-promise

The code in this module is mostly copied from Vitaly Tomilov's example code, which can be found here:
https://github.com/vitaly-t/pg-promise/wiki/Robust-Listeners

## Install

```
npm install pg-promise-listener --save
```

## Use

Example:

```javascript
const Listener = require('pg-promise-listener');
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

## Sending notifications from Postgres

```sql
SELECT pg_notify('myChannel', 'My message');
```

## Keeping connections alive on AWS

Thank you @boromisp for reasearching and documenting a keep-alive problem (mostly on AWS).

Link to write-up: https://github.com/vitaly-t/pg-promise/issues/593

## SelfCheck

If you do run your servers on AWS, you have probably already implemented a /health endpoint. In order to discover all kinds of problems pg-promise-listener has a selfCheck method. This method returns a promise, which is only resolved after a complete roundtrip to the Postgres server like this:

1. Tell the database to send a notification with a special message (actually just a guid)
2. Wait for a message with this guid to arrive from the database server
3. Resolve the promise with **true** if the notification arrives within `selfCheckTimeout` milliseconds (defaults to 2000ms)
4. Otherwise resolve the promise with **false**

N.B. There will be no rejection of the promise, so you won't have to bother with `.catch` if you "then" the promise, or `try..catch` if you await the promise.

In your request handler for the /health endpoint, you could do the following:

```javascript
const isReady = await listener.selfCheck();
if (isReady) {
  res.writeHead(200);
} else {
  res.writeHead(500);
}
return res.end();
```

## Sending and receiving JSON

It's very convenient to have a single notification trigger connected to multiple tables. It's also convenient to use JSON as the payload format. In order to do this we need:

- Dynamically read some field values from the updated/inserted table row.
- Send the json in a stringified format (pg_notify can only send strings)

### The trigger function

```sql
CREATE OR REPLACE FUNCTION main.tr_notify()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    _id int;
    _project_id int;
    _another_field varchar;
    _json jsonb;
    _row jsonb;
BEGIN
    _row = row_to_json(NEW);

    --Try to read field values from the row
    --By using json functions we can do this in a "late binding"-fashion without
    --getting errors for non existing fields
    _id = _row ->> 'id';
    _project_id = _row->> 'project_id';
    _another_field = _row->> 'another_field';

    _json = jsonb_build_object(
      'tableName', TG_TABLE_NAME,
      'op', TG_OP,
      'id',_id,
      'projectId', _project_id
      'anotherField', _another_field
    );

    --Strip null values from the json to get rid of fields that does not exist in this particular table
    _json = jsonb_strip_nulls(_json);

    --Send the message as a stringified json
    PERFORM pg_notify('myChannel', _json::varchar);

    RETURN NULL;
  END;
$function$;
```

### Creating triggers

Our trigger function can now be used in triggers on multiple tables

```sql
CREATE TRIGGER ai_au__my_table__notify
AFTER UPDATE OR INSERT ON my_table
FOR EACH ROW
EXECUTE PROCEDURE tr_notify();

CREATE TRIGGER ai_au__my_other_table__notify
AFTER UPDATE OR INSERT ON my_other_table
FOR EACH ROW
EXECUTE PROCEDURE tr_notify();
```

### Parsing JSON in the listener

As a convenience, the listener can parse your JSON data. Just tell `Listener` that you want this.

```javascript
const listener = new Listener({
  dbConnection: myConnection,
  onDatabaseNotification: messageHandler,
  channel: 'myChannel',
  parseJson: true,
});
```

### Output

The parsed message might look like this after inserting a record in my_table:

```json
{
  "id": 2,
  "op": "INSERT",
  "projectId": 1,
  "tableName": "my_table"
}
```

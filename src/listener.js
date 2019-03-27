//Original inspiration:
//https://github.com/vitaly-t/pg-promise/wiki/Robust-Listeners

//Self-ping each second to check
const PING_INTERVAL = 1000;

//Any message with this string will be thrown away.
//We are using a guid to ensure that we won't clash with an actual messages.
const PING_MESSAGE = '0a7735a0-93b6-4830-835b-72d0f552381c';
const SELF_CHECK_MESSAGE = 'f75976d0-dbb6-441f-b62a-264dc689d933';

//Default: retry 10 times, with 5-second intervals
const DEFAULT_RETRY_COUNT = 10;
const DEFAULT_RETRY_INTERVAL = 5000;
const DEFAULT_SELF_CHECK_TIMEOUT = 20000;

module.exports = DatabaseListener = function({
  dbConnection, //pg-promise-connection to your database
  onDatabaseNotification, //callback for message handling
  channel, //name of your channel, i.e. the channel name with NOTIFY in your database
  logger = null, //If you don't like console.log, insert your own logger
  parseJson = false, //Can your notify-messages be parsed from json?
  maxRetryCount = DEFAULT_RETRY_COUNT,
  retryInterval = DEFAULT_RETRY_INTERVAL,
  selfCheckTimeout = DEFAULT_SELF_CHECK_TIMEOUT,
}) {
  if (!dbConnection) throw new Error('DatabaseListener: Missing dbConnection');
  if (!channel) throw new Error('DatabaseListener: Missing channel name');

  this.logger = logger || console.log;
  this.db = dbConnection;
  this.channel = channel;
  this.onDatabaseNotification = onDatabaseNotification;
  this.parseJson = parseJson;
  this.maxRetryCount = maxRetryCount;
  this.retryInterval = retryInterval;
  this.selfCheckTimeout = selfCheckTimeout;

  // global connection for permanent event listeners
  this.connection = null;

  this.selfCheck = () => {
    return new Promise((resolve, reject) => {
      this.selfCheckCallback = () => resolve(true);
      setTimeout(() => resolve(false), this.selfCheckTimeout);
      this.connection.none('NOTIFY $1~, $2', [this.channel, SELF_CHECK_MESSAGE]);
    });
  };

  const onNotification = data => {
    if (data.payload === PING_MESSAGE) return;

    if (data.payload === SELF_CHECK_MESSAGE) {
      return this.selfCheckCallback && this.selfCheckCallback();
    }

    let message = data.payload;
    if (this.parseJson) {
      try {
        message = JSON.parse(data.payload);
      } catch (e) {
        this.logger(e);
        this.logger(data);
      }
    }

    if (this.onDatabaseNotification) {
      this.onDatabaseNotification(message);
    } else {
      this.logger(message);
    }
  };

  const setListeners = client => {
    client.on('notification', onNotification);
    return this.connection.none('LISTEN $1~', this.channel).catch(error => {
      this.logger(error); // unlikely to happen
    });
  };

  const removeListeners = client => {
    client.removeListener('notification', onNotification);
  };

  const onConnectionLost = (err, e) => {
    this.logger('Connectivity Problem:', err);
    this.connection = null; // prevent use of the connection
    removeListeners(e.client);
    reconnect(this.retryInterval, this.maxRetryCount)
      .then(() => {
        this.logger('Successfully Reconnected');
      })
      .catch(() => {
        this.logger('Connection Lost Permanently');
        process.exit(); // exiting the process
      });
  };

  const reconnect = (delay, maxAttempts) => {
    delay = delay > 0 ? parseInt(delay) : 0;
    maxAttempts = maxAttempts > 0 ? parseInt(maxAttempts) : 1;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        this.db
          .connect({direct: true, onLost: onConnectionLost})
          .then(obj => {
            // global connection is now available
            this.connection = obj;
            resolve(obj);
            return setListeners(obj.client);
          })
          .catch(error => {
            this.logger('Error Connecting:', error);
            if (--maxAttempts) {
              reconnect(delay, maxAttempts)
                .then(resolve)
                .catch(reject);
            } else {
              reject(error);
            }
          });
      }, delay);
    });
  };

  const sendNotifications = () => {
    //Initiate a "notify" from the database to check that we are connected
    setInterval(() => {
      if (this.connection) {
        this.connection.none('NOTIFY $1~, $2', [this.channel, PING_MESSAGE]).catch(error => {
          this.logger('Failed to Notify:', error); // unlikely to happen
        });
      }
    }, PING_INTERVAL);
  };

  const init = () => {
    return reconnect() // same as reconnect(0, 1)
      .then(obj => {
        this.logger('Successful Initial database Connection');
        sendNotifications();
      })
      .catch(error => {
        this.logger('Failed Initial database Connection:', error);
      });
  };

  init();
};

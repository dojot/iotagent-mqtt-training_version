'use strict';

const IotAgentMqtt = require('./agent').IoTAgentMqtt;
const logger = require("@dojot/dojot-module-logger").logger;

const service = new IotAgentMqtt();
service.init().then(() => {
  logger.info(`... Succeeded to initialize IoT Agent MQTT - training version!`);
}).catch((error) => {
  logger.error(`... Failed to initialize IoT Agent MQTT - training version (${error})`);
  process.kill(process.pid, "SIGTERM");
});
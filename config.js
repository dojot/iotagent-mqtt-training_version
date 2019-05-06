'use strict';

var config = {};

config.backend_host = process.env.BACKEND_HOST || 'mosca-redis';
config.backend_port = process.env.BACKEND_PORT || 6379;
config.mqtt_port = process.env.MQTT_PORT || 1883;

module.exports = config;

'use strict';

const mosca = require('mosca');
const redis = require("redis");
const iotalib = require('@dojot/iotagent-nodejs');
const logger = require("@dojot/dojot-module-logger").logger;
const config = require('./config');

class IotAgentMqtt {

    constructor() {
        // Cache:
        //        key -> MQTT topic
        //        value -> List of obj({tenant, deviceId})
        this.deviceToDojotCache = {};

        // Cache:
        //        key -> str({tenant, deviceId})
        //        value -> MQTT topic
        this.dojotToDeviceCache = {};

        // MQTT Broker:
        this.broker = new mosca.Server(
            {
                backend: {
                    type: 'redis',
                    redis: redis,
                    db: 12,
                    port: config.backend_port,
                    host: config.backend_host,
                    return_buffers: true
                },
                persistence: {
                  factory: mosca.persistence.Redis,
                  host: config.backend_host
                },
                interfaces: [
                    {
                        type: "mqtt",
                        port: config.mqtt_port
                    }
                ],
                logger: { name: 'MoscaServer', level: 'info' }
            }
        );
        this.broker.authenticate = (_client, _username, _password, callback) => {
            // all clients
            callback(null, true);
        };

        this.broker.authorizePublish = (_client, topic, _payload, callback) => {
            // cached topics
            if(this.deviceToDojotCache.hasOwnProperty(topic)) {
                logger.debug(`Authorized to publish to topic ${topic}.`);
                callback(null, true);
            }
            else {
                logger.debug(`Not authorized to publish to topic ${topic}.`);
                callback(null, false);
            }
        };

        this.broker.authorizeSubscribe = (_client, _topic, callback) => {
            // all topics
            callback(null, true);
        };

        // Agent:
        this.iota = new iotalib.IoTAgent();
    }

    _registerMqttBrokerHandlers() {
        // Fired when a client connects to mosca server
        this.broker.on('clientConnected', (client) => {
            logger.info(`Client ID ${client.id} has connected to.`);
        });

        // Fired when a client disconnects from mosca server
        this.broker.on('clientDisconnected', (client) => {
            logger.info(`Client ID ${client.id} has disconnected.`);
        });

        // Fired when a message is received by mosca server
        // (from device to dojot)
        this.broker.on('published', (packet, client) => {
            // ignore meta (internal) topics
            if ((packet.topic.split('/')[0] == '$SYS') ||
            (client === undefined) || (client === null)) {
                  return;
            }

            // handle packet
            let data;
            try {
                data = JSON.parse(packet.payload.toString());
            }
            catch (ex) {
                logger.warn(`Payload ${packet.payload.toString()} is not valid JSON. Ignoring (${ex}).`);
                return;
            }

            logger.debug(`Device to dojot (client: ${client.id} topic: ${packet.topic} payload: ${packet.payload.toString()}`);


            let metadata = {};
            if ("timestamp" in data) {
                // ISO timestamp
                const ts = Date.parse(data.timestamp);
                if (!isNaN(ts)) {
                    metadata.timestamp = ts;
                }
            }

            //send data to dojot
            for(const device of this.deviceToDojotCache[packet.topic]){
                logger.debug(`Forwarding data ${JSON.stringify(data)} with metadada ${JSON.stringify(metadata)} to ${JSON.stringify(device)}`);
                let meta = {};
                Object.assign(meta, metadata);
                this.iota.updateAttrs(device.d, device.t, data, meta);
            }
        });
    }

    _registerKafkaHandlers() {
        // Handle device.create event
        this.iota.messenger.on('iotagent.device', 'device.create', (tenant, event) => {
            logger.debug(`Got device.create event ${JSON.stringify(event)} for tenant ${tenant}.`);
            this._handleCreateEvent(tenant, event);
        });

        // Handle device.update event
        this.iota.messenger.on('iotagent.device', 'device.update', (tenant, event) => {
            logger.debug(`Got device.update event ${JSON.stringify(event)} for tenant ${tenant}.`);
           this._handleUpdateEvent(tenant, event);
        });

        // Handle device.remove event
        this.iota.messenger.on('iotagent.device', 'device.remove', (tenant, event) => {
            logger.debug(`Got device.remove event ${JSON.stringify(event)} for tenant ${tenant}.`);
            this._handleRemoveEvent(tenant, event);
        });

        // Handle device.configure event
        this.iota.messenger.on('iotagent.device', 'device.configure', (tenant, event) => {
            logger.debug(`Got device.configure event ${JSON.stringify(event)} for tenant ${tenant}.`);
            this._handleConfigureEvent(tenant, event);
        });
    }

    _addToCaches(topicPrefix, device) {
        // device to dojot cache
        let topic = `${topicPrefix}/attrs`;
        if(this.deviceToDojotCache.hasOwnProperty(topic)) {
            this.deviceToDojotCache[topic].push(device);
        }
        else {
            this.deviceToDojotCache[topic] = [device];
        }
        logger.debug(`Cache 1: ${JSON.stringify(this.deviceToDojotCache)}`);

        // dojot to device cache
        topic = `${topicPrefix}/config`;
        this.dojotToDeviceCache[JSON.stringify(device)] = topic;
        logger.debug(`Cache 2: ${JSON.stringify(this.dojotToDeviceCache)}`);
    }

    _removeFromCaches(device) {
        // device to dojot cache
        for(let topic in this.deviceToDojotCache) {
            this.deviceToDojotCache[topic] = this.deviceToDojotCache[topic].filter((v) => {
                return JSON.stringify(v) !== JSON.stringify(device);
            });
            if(this.deviceToDojotCache[topic].length === 0) {
                delete this.deviceToDojotCache[topic];
            }
        }
        logger.debug(`Cache 1: ${JSON.stringify(this.deviceToDojotCache)}`);

        // dojot to device cache
        if(this.dojotToDeviceCache.hasOwnProperty(JSON.stringify(device))) {
            delete this.dojotToDeviceCache[JSON.stringify(device)];
        }
        logger.debug(`Cache 2: ${JSON.stringify(this.dojotToDeviceCache)}`);
    }

    _handleCreateEvent(tenant, event) {
        for(let template in event.data.attrs) {
            for(let attr of event.data.attrs[template]) {
                // broadcast
                if (attr.label.toUpperCase() === 'SN') {
                    let sn = attr.static_value;
                    let topicPrefix = `/_dojot/${sn}`;
                    let deviceId = event.data.id;
                    return this._addToCaches(topicPrefix, {t: tenant, d: deviceId});
                }
            }
        }

        // unicast
        let deviceId = event.data.id;
        let topicPrefix = `/${tenant}/${deviceId}`;
        return this._addToCaches(topicPrefix, {t: tenant, d: deviceId});
    }

    _handleUpdateEvent(tenant, event) {
        this._removeFromCaches({t: tenant, d: event.data.id});
        return this._handleCreateEvent(tenant, event);

    }

    _handleRemoveEvent(tenant, event) {
        return this._removeFromCaches({t: tenant, d: event.data.id});
    }

    _handleConfigureEvent(tenant, event) {
        let device = {t: tenant, d: event.data.id};
        let deviceStr = JSON.stringify(device);
        if(this.dojotToDeviceCache.hasOwnProperty(deviceStr)) {
            delete event.data.id;
            let topic = this.dojotToDeviceCache[deviceStr];
            let message = {
                'topic': topic,
                'payload': JSON.stringify(event.data.attrs),
                'qos': 0,
                'retain': false
              };
              // publish from dojot to device
              this.broker.publish(message, () => {
                  logger.debug(`Published message ${JSON.stringify(message)} on topic ${topic}`);
               });
        }
        else {
            logger.debug(`Ignoring event ${event} for ${tenant}.`);
        }
    }

    init() {
        return this.iota.init().then(() => {
            logger.info(`Initializing IoT Agent MQTT - training version ...`);
            // register MQTT Broker handlers
            this._registerMqttBrokerHandlers();

            // register Kafka handlers
            this._registerKafkaHandlers();

            // force device.create events for devices created before starting the iotagent
            this.iota.messenger.generateDeviceCreateEventForActiveDevices();

            return Promise.resolve();
        }).catch((error) => {
            return Promise.reject(error);
        });
    }
}

module.exports = {
    IoTAgentMqtt: IotAgentMqtt
};
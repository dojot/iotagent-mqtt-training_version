# IoT Agent MQTT - Training Version

This iot-agent is ONLY FOR TRAINING PURPOSES.

## How to send data to dojot

If a dojot's device has a static attribute 'SN' (Serial Number), it must publish to MQTT topic:

```javascript
/_dojot/{REPLACE BY SN}/attrs
```

Otherwise, it must publish to topic:

```javascript
/{REPLACE BY TENANT}/{REPLACE BY DEVICE ID}/attrs
```

In the first case, all dojot's devices with the same SN will receive a copy of the message. In the second case, a single dojot's device will receive the message.

## How to receive data from dojot

To receive data from multiple dojot's devices, the physical device must subscrite to MQTT topic:

```javascript
/_dojot/{REPLACE BY SN}/config
```

So, any actuation for a dojot's device with 'SN' static attribute will be forwarded to this physical device.

To receive data from a single device, it must subscrite to MQTT topic:

```javascript
/{REPLACE BY TENANT}/{REPLACE BY DEVICE ID/config
```

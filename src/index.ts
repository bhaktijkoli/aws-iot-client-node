import { config } from 'dotenv'
import { AttachThingPrincipalCommand, CreateKeysAndCertificateCommand, CreateThingCommand, IoTClient } from "@aws-sdk/client-iot";
import { BatchAssociateClientDeviceWithCoreDeviceCommand, GetConnectivityInfoCommand, GreengrassV2Client } from "@aws-sdk/client-greengrassv2";
import { mqtt, io, iot, greengrass } from 'aws-iot-device-sdk-v2';
import path from 'path';
import fs from 'fs';

config()

// Get ENVs
const AWS_REGION = process.env.AWS_REGION
const AWS_ACCESS_KEY_ID = String(process.env.AWS_ACCESS_KEY_ID)
const AWS_SECRET_ACCESS_KEY = String(process.env.AWS_SECRET_ACCESS_KEY)
const DEVICE_NAME = process.env.DEVICE_NAME
const DEVICE_TYPE = process.env.DEVICE_TYPE
const CORE_DEVICE_NAME = process.env.CORE_DEVICE_NAME

// Create Clients
const awsIoTClient = new IoTClient({
    region: AWS_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
});
const awsGreengrassClient = new GreengrassV2Client({
    region: AWS_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
})

// Register Device
const registerDevice = async () => {

    const command = new CreateThingCommand({
        thingName: DEVICE_NAME,
        thingTypeName: DEVICE_TYPE,
    });
    const response = await awsIoTClient.send(command);
    console.log({ response })
}

// Create and Attach Certificate
const createCertificate = async () => {
    const certsDir = path.join(__dirname, '..', 'certs')
    if (fs.existsSync(certsDir) === false) {
        fs.mkdirSync(certsDir)
    }
    const certificatePemFile = path.join(certsDir, 'cert.pem.crt')
    const publicFile = path.join(certsDir, 'public.pem.key')
    const privateFile = path.join(certsDir, 'private.pem.key')

    if (fs.existsSync(certificatePemFile) || fs.existsSync(publicFile) || fs.existsSync(privateFile)) {
        return
    }
    // Create Certificate
    const createCommand = new CreateKeysAndCertificateCommand({
        setAsActive: true
    })
    const createResponse = await awsIoTClient.send(createCommand);
    const { certificatePem, keyPair } = createResponse
    if (!certificatePem || !keyPair) {
        return
    }
    const { PrivateKey, PublicKey } = keyPair
    fs.writeFileSync(certificatePemFile, String(certificatePem), 'utf-8')
    fs.writeFileSync(privateFile, String(PrivateKey), 'utf-8')
    fs.writeFileSync(publicFile, String(PublicKey), 'utf-8')
    console.log({ createResponse })

    // Attach Certificate to Thing
    const attachCommand = new AttachThingPrincipalCommand({
        principal: String(createResponse.certificateArn),
        thingName: DEVICE_NAME
    });
    const attachResponse = await awsIoTClient.send(attachCommand);
    console.log({ attachResponse });
}

// Associate Device with Code Device
const associateDevice = async () => {
    const command = new BatchAssociateClientDeviceWithCoreDeviceCommand({
        coreDeviceThingName: CORE_DEVICE_NAME,
        entries: [
            { thingName: DEVICE_NAME }
        ]
    });
    const response = await awsGreengrassClient.send(command)
    console.log({ response })
}

// Get Endpoint
const getEndpoint = async () => {
    const command = new GetConnectivityInfoCommand({
        thingName: CORE_DEVICE_NAME
    });
    const response = await awsGreengrassClient.send(command);
    const { connectivityInfo } = response
    if (!connectivityInfo) {
        return
    }
    const { hostAddress, portNumber } = connectivityInfo[0]
    const url = `mqtt://${hostAddress}:${portNumber}`
    console.log({ url });
}

// Discover and Conenct
const discoverAndConnect = async () => {
    // Certificates
    const certsDir = path.join(__dirname, '..', 'certs')
    const rootCertificateFilePath = path.join(__dirname, '..', 'AmazonRootCA1.pem')
    const certificatePemFilePath = path.join(certsDir, 'cert.pem.crt')
    const privateFilePath = path.join(certsDir, 'private.pem.key')
    if (!fs.existsSync(rootCertificateFilePath) || !fs.existsSync(certificatePemFilePath) || !fs.existsSync(privateFilePath)) {
        console.log("Certificates not found");
        return
    }
    const rootCertificate = fs.readFileSync(rootCertificateFilePath, 'utf-8')
    const certificate = fs.readFileSync(certificatePemFilePath, 'utf-8')
    const privateKey = fs.readFileSync(privateFilePath, 'utf-8')

    // Create Socket, TLS Config
    const client_bootstrap = new io.ClientBootstrap();
    const socket_options = new io.SocketOptions(io.SocketType.STREAM, io.SocketDomain.IPV4, 3000);
    const tls_options = io.TlsContextOptions.create_client_with_mtls(certificate, privateKey)
    tls_options.override_default_trust_store(rootCertificate);
    tls_options.certificate_filepath = certificatePemFilePath;
    tls_options.private_key_filepath = privateFilePath;
    if (io.is_alpn_available()) {
        tls_options.alpn_list.push('x-amzn-http-ca');
    }
    const tls_ctx = new io.ClientTlsContext(tls_options);

    // Discover Core Devices
    const discovery = new greengrass.DiscoveryClient(client_bootstrap, socket_options, tls_ctx, AWS_REGION as string);
    try {
        const discovery_response: greengrass.model.DiscoverResponse = await discovery.discover(DEVICE_NAME as string)
        const mqtt_client = new mqtt.MqttClient(client_bootstrap);
        let attempted_cores: string[] = [];
        let connections: mqtt.MqttClientConnection[] = [];
        for (const gg_group of discovery_response.gg_groups) {
            for (const core of gg_group.cores) {
                for (const endpoint of core.connectivity) {
                    // Create MQTT Config
                    const mqtt_config = iot.AwsIotMqttConnectionConfigBuilder.new_mtls_builder(certificate, privateKey)
                        .with_certificate_authority(gg_group.certificate_authorities[0])
                        .with_client_id(DEVICE_NAME as string)
                        .with_clean_session(true)
                        .with_socket_options(new io.SocketOptions(io.SocketType.STREAM, io.SocketDomain.IPV4, 3000))
                        .build();
                    mqtt_config.host_name = endpoint.host_address;
                    mqtt_config.port = endpoint.port;
                    console.log(`Trying endpoint=${JSON.stringify(endpoint)}`);
                    const mqtt_connection = mqtt_client.new_connection(mqtt_config);
                    mqtt_client
                    mqtt_connection.on('error', (error) => {
                        console.warn(`Connection to endpoint=${JSON.stringify(endpoint)} failed: ${error}`);
                    });
                    mqtt_connection.on('connect', () => {
                        attempted_cores.push(core.thing_arn.toString());
                        connections.push(mqtt_connection)
                        console.log(`Connected to endpoint=${JSON.stringify(endpoint)}`);
                    })
                    // Connect to MQTT
                    await mqtt_connection.connect()
                }
            }
        }
        // Successfull MQTT Connections
        for (const connection of connections) {
            const payload = {
                message: "Hello"
            }
            let result = await connection.publish("test/topic", payload, mqtt.QoS.AtMostOnce);
            console.log("publish results", result);
            result = await connection.subscribe('test/topic/response', mqtt.QoS.AtLeastOnce, (topic, payload) => {
                console.log("Recieved", { topic, payload });
            })
            console.log("subscribe results", result);

        }
    } catch (error) {
        console.log(error);

    }
}


const start = async () => {
    await registerDevice()
    await createCertificate()
    await associateDevice()
    await getEndpoint()
    await discoverAndConnect()
    process.stdin.resume();
}

start()
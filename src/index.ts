import { config } from 'dotenv'
import { AttachThingPrincipalCommand, CreateKeysAndCertificateCommand, CreateThingCommand, IoTClient } from "@aws-sdk/client-iot";
import { BatchAssociateClientDeviceWithCoreDeviceCommand, GreengrassV2Client } from "@aws-sdk/client-greengrassv2";
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

const start = async () => {
    await registerDevice()
    await createCertificate()
    await associateDevice()
    process.exit(0)
}

start()
import { config } from 'dotenv'
import crypto from "crypto"
import { CreateKeysAndCertificateCommand, CreateThingCommand, IoTClient } from "@aws-sdk/client-iot";
import path from 'path';
import fs from 'fs';

config()

// Get ENVs
const AWS_REGION = process.env.AWS_REGION
const AWS_ACCESS_KEY_ID = String(process.env.AWS_ACCESS_KEY_ID)
const AWS_SECRET_ACCESS_KEY = String(process.env.AWS_SECRET_ACCESS_KEY)
const DEVICE_NAME = process.env.DEVICE_NAME
const DEVICE_TYPE = process.env.DEVICE_TYPE

// Create Clients
const awsIoTClient = new IoTClient({
    region: AWS_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
});

const registerDevice = async () => {

    const command = new CreateThingCommand({
        thingName: DEVICE_NAME,
        thingTypeName: DEVICE_TYPE,
    });
    const response = await awsIoTClient.send(command);
    console.log({ response })
    console.log("Device Register");
}

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

    const command = new CreateKeysAndCertificateCommand({
        setAsActive: true
    })
    const response = await awsIoTClient.send(command);
    const { certificatePem, keyPair } = response
    if (!certificatePem || !keyPair) {
        return
    }
    const { PrivateKey, PublicKey } = keyPair
    fs.writeFileSync(certificatePemFile, String(certificatePem), 'utf-8')
    fs.writeFileSync(privateFile, String(PrivateKey), 'utf-8')
    fs.writeFileSync(publicFile, String(PublicKey), 'utf-8')
    console.log({ response })
}

const start = async () => {
    // await registerDevice()
    await createCertificate()
    process.exit(0)
}

start()
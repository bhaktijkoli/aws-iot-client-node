import { config } from 'dotenv'
import { CreateThingCommand, IoTClient } from "@aws-sdk/client-iot";

config()

const AWS_REGION = process.env.AWS_REGION
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY
const DEVICE_NAME = process.env.DEVICE_NAME
const DEVICE_TYPE = process.env.DEVICE_TYPE

const registerDevice = async () => {
    const client = new IoTClient({
        region: AWS_REGION,
        credentials: {
            accessKeyId: AWS_ACCESS_KEY_ID,
            secretAccessKey: AWS_SECRET_ACCESS_KEY,
        },
    });
    const command = new CreateThingCommand({
        thingName: DEVICE_NAME,
        thingTypeName: DEVICE_TYPE,
    });
    const response = await client.send(command);
    console.log({ response })
    console.log("Device Register");

}

const start = async () => {
    await registerDevice()
    process.exit(0)
}

start()
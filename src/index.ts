import { SerialPort, SerialPortOpenOptions } from "serialport"
import { EventEmitter } from 'stream';
import { v4 } from "uuid";
import { JobHandler, ParsedData } from "./models/JobHandler";
import JobItem from "./models/JobItem";
import { DefaultFunctionSignature, ModemCallback } from "./models/ModemCallback";
import ModemResponse, { CheckModemResponse, CheckPinStatus, InitializeResponse, InitializeStatus, ModemErrorRaw, QueryStatus } from "./models/ModemResponse";
import SimConfig from "./models/SimConfig";
export default class Sim800L {
    public events = new EventEmitter();
    public simConfig: SimConfig = {
        customCnmi: "2,1,2,1,0",
        deliveryReport: true,
        autoDeleteFromSim: true
    }
    public initialized = false

    private port: SerialPort;
    private queue: JobItem[] = []
    private busy = false
    private timeouts: Record<string, any>[] = []
    private logger: Console
    private dataBuffer = ''


    /**
     * Creates an instance of Sim800L.
     * @param {OpenOptions} options
     * @memberof Sim800L
     */
    constructor(options: SerialPortOpenOptions<any>, simConfig: SimConfig) {
        try {
            // parsing the options (setting autoOpen to false in the meantime)
            this.port = new SerialPort(options as SerialPortOpenOptions<any>)
            this.simConfig = { ...this.simConfig, ...simConfig }
            this.logger = this.simConfig.logger || console as Console
            this.logger.log("SIM800L -  initialization")
            // Forwarding all events
            this.attachingEvents()
            this.initialize()
            this.logger.debug("SIM800L -  instance created")
        } catch (error) {
            throw error;
        }
    }

    /**
     *Returns a list of available serial ports, is available statically for config purposes
     *
     * @static
     * @return {*}  {Promise<SerialPortInfo[]>}
     * @memberof Sim800L
     */
    static async list(): Promise<Record<string, any>[]> {
        return await SerialPort.list();
    }

    /**
     *Opens the port communication (emits a "open" event you can listen on the @events property)
     *
     * @memberof Sim800L
     */

    public close(): void {
        try {
            this.logger.log("SIM800L -  closing serial port")
            this.port.close()
            this.logger.debug("SIM800L -  serial port closed")
        } catch (error) {
            this.logger.error("SIM800L -  unable to close serial port")
            throw error
        }
    }
    public initialize = async (callback?: ModemCallback<InitializeResponse>): Promise<ModemResponse<InitializeResponse> | void> => {
        if (typeof callback !== 'function') {
            return promisify(this.initialize)
        }
        else {
            try {
                const modemChecked = (await this.checkModem() as ModemResponse<CheckModemResponse>)
                if (!(modemChecked.result == 'success')) {
                    this.events.emit("error", modemChecked)
                    callback(modemChecked)
                    return
                }
                this.logger.info("SIM800L - Trying to enable ")
                await this.execCommand(undefined, 'AT+CMEE=2', 'verbose')

                const pinChecked = await this.checkPinRequired() as ModemResponse<CheckPinStatus>
                if (!(pinChecked.result == "success")) {
                    // We switch, if !NEED_PIN we can callback and return
                    if (!(pinChecked.error?.content.status == InitializeStatus.NEED_PIN) || !this.simConfig.pin) {
                        this.events.emit("error", pinChecked)
                        callback(pinChecked)
                        return
                    }
                    // We will try to unlock the SIM, once, emit an event and throw the hell out of the app if it does not work
                    const unlocked = await this.unlockSim(undefined, this.simConfig.pin)
                    // If failure we callback
                }

                this.initialized = true
                this.events.emit("initialized")
            } catch (error) {
                callback(null, new Error('unhandled initialization failure'))
            }
        }
        return
    }

    public checkModem = async (callback?: ModemCallback<InitializeResponse>): Promise<ModemResponse<CheckModemResponse> | void> => {
        if (typeof callback !== 'function') {
            return promisify(this.checkModem)
        }
        else {
            this.logger.log("SIM800L -  checking modem connection")
            try {
                // We define the handler, which will search of an OK end of query
                const handler: JobHandler = (buffer, job) => {
                    if (isOk(parseBuffer(buffer))) {
                        this.logger.info("SIM800L -  modem online")
                        job.callback!({
                            uuid: job.uuid,
                            type: job.type,
                            result: "success",
                            data: {
                                raw: buffer,
                                processed: {
                                    status: QueryStatus.OK,
                                    message: "Modem is Online"
                                }
                            }
                        })
                        job.ended = true
                    } else if (isError(parseBuffer(buffer)).error) {
                        this.logger.error("SIM800L -  modem error")
                        job.callback!({
                            uuid: job.uuid,
                            type: job.type,
                            result: "failure",
                            error: {
                                type: "checkError",
                                content: buffer
                            }
                        })
                        job.ended = true
                    }
                }
                // Exec command AT
                await this.execCommand(callback, 'AT', 'check-modem', handler)
            } catch (error: any) {
                callback(null, new Error(error || 'unhandled modem check failure'))
            }
        }
    }
    public checkPinRequired = async (callback?: ModemCallback<InitializeResponse>): Promise<ModemResponse<CheckPinStatus> | void> => {
        if (typeof callback !== 'function') {
            return promisify(this.checkPinRequired)
        }
        else {
            try {
                this.logger.log("SIM800L -  checking pin lock status")
                const handler: JobHandler = (buffer, job) => {
                    const parsedBuffer = parseBuffer(buffer)
                    if (isOk(parsedBuffer)) {
                        // command has been received, we can intercept the field that starts with +CPIN and extract the
                        // status
                        const field = parsedBuffer.find((part) => {
                            return part.startsWith("+CPIN")
                        })
                        if (!field || !(field?.split(" ").length > 1)) {
                            // can't parse the result, throw an error
                            this.logger.error("SIM800L -  can't parse pin lock status")
                            throw "pin-check : can't parse result"
                        }
                        // we get rid of the first split and join the rest
                        const keyFields = field.split(" ")
                        keyFields.splice(0, 1)
                        const key = keyFields.join(" ")
                        let status = getInitializationStatus(key)
                        this.logger.info(`SIM800L -  pin lock : ${getStatusMessage(status)} `)
                        job.callback!({
                            uuid: job.uuid,
                            type: "pin-check",
                            result: status == InitializeStatus.READY ? "success" : "failure",
                            data: status == InitializeStatus.READY ? {
                                raw: buffer,
                                processed: {
                                    status,
                                    message: getStatusMessage(status)
                                }
                            } : undefined,
                            error: status !== InitializeStatus.READY ? {
                                type: "pin-required",
                                content: {
                                    status,
                                    message: getStatusMessage(status)
                                }
                            } : undefined
                        })
                        job.ended = true
                    }
                    if (isError(parsedBuffer).error) {
                        this.logger.error("SIM800L - pin lock : sim error")
                        job.callback!({
                            uuid: job.uuid,
                            type: job.type,
                            result: "failure",
                            error: {
                                type: "checkPinError",
                                content: {
                                    status: InitializeStatus.ERROR,
                                    message: isError(parsedBuffer).message
                                }
                            }
                        })
                        job.ended = true
                    }
                }
                await this.execCommand(callback, 'AT+CPIN?', 'check-pin', handler)
            } catch (error: any) {
                callback(null, new Error(error || 'unhandled pin check failure'))
            }
        }
    }
    public unlockSim = async (callback: ModemCallback | undefined, pin: string) => {
        if (typeof callback !== 'function') {
            return promisify(this.unlockSim, pin)
        } else {
            const handler: JobHandler = (buffer, job) => {
                const parsedBuffer = parseBuffer(buffer)
                if (isError(parsedBuffer).error) {
                    // pin is probably wrong, we need to callback
                    this.logger.error("SIM800L - WRONG PIN ! CHECK PIN ASAP")
                    job.callback!({
                        uuid: job.uuid,
                        type: job.type,
                        result: "failure",
                        error: {
                            type: "sim-unlock",
                            content: {
                                status: InitializeStatus.PIN_INCORRECT,
                                message: isError(parsedBuffer).message
                            }
                        }
                    })
                }
                // if not error, it can be "okay", we just log it as we're waiting for the +CPIN info
                if (isOk(parsedBuffer)) {
                    this.logger.info("SIM800L - pin accepted, waiting for unlock")
                }
                // Now, we're looking into the last part of parsedData and search for "+CPIN: "
                if (parsedBuffer.length && parsedBuffer[parsedBuffer.length - 1].startsWith("+CPIN: ")) {
                    // we extract the status, it looks a lot like checkpinrequired
                    const key = parsedBuffer[parsedBuffer.length - 1].split("+CPIN: ").length ? parsedBuffer[parsedBuffer.length - 1].split("+CPIN: ")[1] : null
                    const status = key ? getInitializationStatus(key) : InitializeStatus.ERROR
                    this.logger.info(`SIM800L -  pin lock : ${getStatusMessage(status)} `)
                    job.callback!({
                        uuid: job.uuid,
                        type: "pin-check",
                        result: status == InitializeStatus.READY ? "success" : "failure",
                        data: status == InitializeStatus.READY ? {
                            raw: buffer,
                            processed: {
                                status,
                                message: getStatusMessage(status)
                            }
                        } : undefined,
                        error: status !== InitializeStatus.READY ? {
                            type: "pin-required",
                            content: {
                                status,
                                message: getStatusMessage(status)
                            }
                        } : undefined
                    })
                    job.ended = true
                }
            }
            await this.execCommand(callback, `AT+CPIN=${pin}`, 'pin-unlock', handler)
        }
    }

    public execCommand = (callback: ModemCallback | undefined, command: string, type: string, handler = defaultHandler): Promise<ModemResponse> | void => {
        if (typeof callback !== 'function') {
            return promisify(this.execCommand, command, type, handler)
        }
        this.logger.log(`SIM800L -  queuing command ${command.length > 15 ? `${command.substring(0, 15)}...` : command} `)
        // We create a queue item
        this.queue.push({
            uuid: v4(),
            callback,
            handler,
            command,
            type,
            timeoutIdentifier: null,
            ended: false
        })
        // We cycle nextEvent()
        this.nextEvent()
    }

    private handleIncomingData = (buffer: any) => {
        this.busy = true
        const received = buffer.toString()
        this.dataBuffer += received
        // if there is a queue, we can call the handler
        if (this.queue.length) {
            const job = this.queue[0]
            job.handler(this.dataBuffer, job, this.events, this.logger)
        } else {
            // This is incoming data, we need to create a job, unshift it and handle the data
            const job = {
                uuid: v4(),
                handler: incomingHandler,
                command: '',
                type: 'incoming',
                timeoutIdentifier: null,
                ended: false
            }
            this.queue.unshift(job)
            incomingHandler(this.dataBuffer, job, this.events, this.logger)
        }
        this.busy = false
        this.nextEvent()
    }
    private nextEvent() {
        this.logger.info(`SIM800L -  current queue length - ${this.queue.length}`)
        if (!this.queue.length) {
            return
        }
        // if the job has ended, we clear it
        const job = this.queue[0]
        if (job.ended) {
            this.logger.info(`SIM800L -  job ${job.uuid} has ended and will be wiped out of existence`)
            this.clear()
            return
        }
        //
        if (this.busy) {
            return
        }
        this.busy = true
        // Finding the first item in the queue

        // setting the 10s timeout
        if (!job.timeoutIdentifier) {
            this.logger.info(`SIM800L -  processing event #${job.uuid}`)
            // If we're here, this is the first time we process this event
            job.timeoutIdentifier = setTimeout(() => {
                this.logger.debug(`SIM800L -  preparing to cancel job #${job.uuid}`)
                this.cancelEvent(job.uuid)
            }, 10000)
            if (job.command) {
                this.port.write(`${job.command}\r`, undefined, (err: any) => {
                    if (err) {
                        if (job.callback) {
                            job.callback(null, err)
                        }
                        else {
                            // event error
                            this.events.emit("error", err)
                        }
                    }
                })
            }
        }
        this.busy = false
    }
    private attachingEvents() {
        this.logger.info("SIM800L -  attaching serialport events")
        this.port.on('open', () => {
            this.events.emit('open');
        });
        this.port.on("data", this.handleIncomingData)
        this.logger.debug("SIM800L -  serialport events attached")
    }
    private cancelEvent(uuid: string) {
        this.logger.warn(`SIM800L -  ${uuid} - TIMEOUT`)
        // Find the job and calling its callback with the Error timeout
        const job = this.queue.find((queuedJob) => {
            return queuedJob.uuid == uuid
        })
        if (job && job.callback) {
            job.callback(null, new Error(`job #${job.uuid} - timeout at ${new Date().toISOString()}`))
            this.events.emit("error", {
                uuid: job.uuid,
                type: job.type,
                result: "failure",
                error: {
                    type: "unhandled",
                    content: parseBuffer(this.dataBuffer)
                }
            } as ModemResponse<ParsedData>)
        }
        if (job && job.type == 'incoming') {
            // this was an unhandled event, emitting the event
            this.events.emit("incoming", {
                uuid: job.uuid,
                type: job.type,
                result: "failure",
                error: {
                    type: "unhandled",
                    content: parseBuffer(this.dataBuffer)
                }
            } as ModemResponse<ParsedData>)
        }
        this.queue = this.queue.filter((job) => {
            return !(job.uuid == uuid)
        })
        this.dataBuffer = ''
        this.busy = false
        this.nextEvent()
    }
    private clear() {
        if (this.queue.length && this.queue[0].timeoutIdentifier) {
            clearTimeout((this.queue[0].timeoutIdentifier))
        }
        this.busy = false
        this.dataBuffer = ''
        this.queue.shift()
        this.nextEvent()
    }

}

//  ________  ___  ___  ________  ________  ________  ________  _________   
// |\   ____\|\  \|\  \|\   __  \|\   __  \|\   __  \|\   __  \|\___   ___\ 
// \ \  \___|\ \  \\\  \ \  \|\  \ \  \|\  \ \  \|\  \ \  \|\  \|___ \  \_| 
//  \ \_____  \ \  \\\  \ \   ____\ \   ____\ \  \\\  \ \   _  _\   \ \  \  
//   \|____|\  \ \  \\\  \ \  \___|\ \  \___|\ \  \\\  \ \  \\  \|   \ \  \ 
//     ____\_\  \ \_______\ \__\    \ \__\    \ \_______\ \__\\ _\    \ \__\
//    |\_________\|_______|\|__|     \|__|     \|_______|\|__|\|__|    \|__|
//    \|_________|                                                          


function promisify(functionSignature: DefaultFunctionSignature, ...args: any[]): Promise<ModemResponse> {
    return new Promise((resolve, reject) => {
        functionSignature((result, err) => {
            if (err) {
                reject(err)
            } else if (result) {
                resolve(result)
            }
        }, ...args)
    })
}

function getStatusMessage(status: InitializeStatus): string {
    switch (status) {
        case InitializeStatus.READY:
            return "modem is ready"
        case InitializeStatus.NEED_PIN:
            return "please provide a pin number to unlock the SIM Card"
        case InitializeStatus.PIN_INCORRECT:
            return "please think twice before hitting refresh mate, you'll probably lock your sim card"
        case InitializeStatus.NEED_PUK:
            return "told ya"
        case InitializeStatus.ERROR:
            return "can't figure out what's wrong, please check if sim is properly inserted"
    }
}
function getInitializationStatus(key: string): InitializeStatus {
    switch (key) {
        case "READY":
            return InitializeStatus.READY;
        case "SIM PIN":
            return InitializeStatus.NEED_PIN;
        case "SIM PUK":
            return InitializeStatus.NEED_PUK;
        default:
            return InitializeStatus.ERROR
    }
}
function parseBuffer(buffer: string): string[] {
    return buffer.split(/[\r\n]{1,2}/).filter((value => {
        return !/^[\r\n]{1,2}$/.test(value) && value.length
    }))
}
function isOk(parsedData: ParsedData) {
    return parsedData.length ? parsedData[parsedData.length - 1] == 'OK' : false
}
function isError(parsedData: ParsedData): ModemErrorRaw {
    const field = parsedData.length && parsedData[parsedData.length - 1] ? parsedData[parsedData.length - 1].split(" ERROR: ") : null
    if (field && field.length && field[0] == "+CME") {
        // extracting message
        field.splice(0, 1)
        const message = field.length ? field.join(" ") : undefined
        return { error: true, raw: parsedData, ...{ message } }
    } else if (parsedData && parsedData.length) {
        return parsedData[parsedData.length - 1] == "ERROR" ? { error: true, message: `${parsedData.join(" - ")}`, raw: parsedData } : { error: false }
    } else {
        return { error: false }
    }
}

//  ___  ___  ________  ________   ________  ___       _______   ________  ________      
// |\  \|\  \|\   __  \|\   ___  \|\   ___ \|\  \     |\  ___ \ |\   __  \|\   ____\     
// \ \  \\\  \ \  \|\  \ \  \\ \  \ \  \_|\ \ \  \    \ \   __/|\ \  \|\  \ \  \___|_    
//  \ \   __  \ \   __  \ \  \\ \  \ \  \ \\ \ \  \    \ \  \_|/_\ \   _  _\ \_____  \   
//   \ \  \ \  \ \  \ \  \ \  \\ \  \ \  \_\\ \ \  \____\ \  \_|\ \ \  \\  \\|____|\  \  
//    \ \__\ \__\ \__\ \__\ \__\\ \__\ \_______\ \_______\ \_______\ \__\\ _\ ____\_\  \ 
//     \|__|\|__|\|__|\|__|\|__| \|__|\|_______|\|_______|\|_______|\|__|\|__|\_________\
//                                                                           \|_________|



const defaultHandler: JobHandler = (buffer: string, job: JobItem, emitter?: EventEmitter, logger?: Console): void => {
    try {
        logger?.info("SIM800L -  using default event handler")
        const parsedData = parseBuffer(buffer)
        // If it ends with okay, resolve
        if (isOk(parsedData)) {
            if (job.callback) {
                job.callback({
                    uuid: job.uuid,
                    type: job.type,
                    result: 'success',
                    data: {
                        raw: buffer,
                        processed: parsedData
                    }
                })
            }
            job.ended = true
        }
        if (isError(parsedData).error) {
            if (job.callback) {
                job.callback({
                    uuid: job.uuid,
                    type: job.type,
                    result: 'failure',
                    error: {
                        type: "generic",
                        content: {
                            status: QueryStatus.ERROR,
                            message: isError(parsedData).message
                        }
                    }
                })
            }
            job.ended = true
        }
        // If callback, we need to resolve it somehow to allow the event loop to continue
    } catch (error: any) {
        job.ended = true
    }
}
const incomingHandler: JobHandler = (buffer: string, job: JobItem, emitter?: EventEmitter, logger?: Console) => {
    try {
        logger?.info("SIM800L -  using incoming event handler")
        const parsedData = parseBuffer(buffer)
        // Incoming handler when there is no queue, taking care of emitting events (eg: sms... delivery report...)
        // There are no callbacks for the incomingHanlder as it is initiated by the server itself, but it emits events


    } catch (error: any) {
        job.ended = true
    }
}

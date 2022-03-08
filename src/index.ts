import { SerialPort, SerialPortOpenOptions } from "serialport"
import { EventEmitter } from 'stream';
import { v4 } from "uuid";
import { JobHandler, ParsedData } from "./models/JobHandler";
import JobItem from "./models/JobItem";
import { DefaultFunctionSignature, ModemCallback } from "./models/ModemCallback";
import ModemResponse, { CheckModemResponse, InitializeResponse, InitializeStatus, QueryStatus } from "./models/ModemResponse";
export default class Sim800L {
    public events = new EventEmitter();
    public simConfig: Record<string, any>
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
    constructor(options: SerialPortOpenOptions<any>, simConfig: Record<string, any>) {
        try {
            // parsing the options (setting autoOpen to false in the meantime)
            this.port = new SerialPort(options as SerialPortOpenOptions<any>)
            this.simConfig = simConfig
            this.logger = this.simConfig && this.simConfig.logger ? this.simConfig.logger : console as Console
            this.logger.log("SIM800L: initialization")
            // Forwarding all events
            this.attachingEvents()
            this.logger.debug("SIM800L: instance created")
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
            this.logger.log("SIM800L: closing serial port")
            this.port.close()
            this.logger.debug("SIM800L: serial port closed")
        } catch (error) {
            this.logger.error("SIM800L: unable to close serial port")
            throw error
        }
    }
    public initialize = async (callback?: ModemCallback<InitializeResponse>): Promise<ModemResponse<InitializeResponse> | void> => {
        if (typeof callback !== 'function') {
            return promisify(this.initialize)
        }
        else {
            try {
                const modemChecked = (await this.checkModem() as ModemResponse)
                if (!(modemChecked.result == 'success')) {
                    callback(modemChecked)
                    return
                }
                this.initialized = true
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
            try {
                // We define the handler, which will search of an OK end of query
                const handler: JobHandler = (buffer, job) => {
                    if (isOk(parseBuffer(buffer))) {
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
                    } else if (isError(parseBuffer(buffer))) {
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
    public checkPinRequired = async (callback?: ModemCallback<InitializeResponse>): Promise<ModemResponse<CheckModemResponse> | void> => {
        if (typeof callback !== 'function') {
            return promisify(this.checkPinRequired)
        }
        else {
            try {
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
                            throw "pin-check : can't parse result"
                        }
                        // we get rid of the first split and join the rest
                        const keyFields = field.split(" ")
                        keyFields.splice(0, 1)
                        const key = keyFields.join(" ")
                        let status: InitializeStatus
                        console.log(key)
                        switch (key) {
                            case "READY":
                                status = InitializeStatus.READY;
                                break;
                            case "SIM PIN":
                                status = InitializeStatus.NEED_PIN;
                                break;
                            case "SIM PUK":
                                status = InitializeStatus.NEED_PUK;
                                break;
                            default:
                                status = InitializeStatus.ERROR
                                break;
                        }
                        job.callback!({
                            uuid: job.uuid,
                            type: "pin-check",
                            result: status == InitializeStatus.READY ? "success" : "failure",
                            data: status == InitializeStatus.READY ? {
                                raw: buffer,
                                processed: {
                                    status,
                                    message: "modem ready"
                                }
                            } : undefined,
                            error: status !== InitializeStatus.READY ? {
                                type: "pin-required",
                                content: status
                            } : undefined
                        })
                        job.ended = true
                    }
                    if (isError(parsedBuffer)) {
                        job.callback!({
                            uuid: job.uuid,
                            type: job.type,
                            result: "failure",
                            error: {
                                type: "checkPinError - probably no sim",
                                content: InitializeStatus.ERROR
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

    public execCommand = (callback: ModemCallback | undefined, command: string, type: string, handler = defaultHandler): Promise<ModemResponse> | void => {
        if (typeof callback !== 'function') {
            return promisify(this.execCommand, command, type, handler)
        }
        this.logger.log(`SIM800L: queuing command ${command.length > 15 ? `${command.substring(0, 15)}...` : command} `)
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
        this.logger.info(`SIM800L: current queue length - ${this.queue.length}`)
        if (!this.queue.length) {
            return
        }
        // if the job has ended, we clear it
        const job = this.queue[0]
        if (job.ended) {
            this.logger.info(`SIM800L: job ${job.uuid} has ended and will be wiped out of existence`)
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
            this.logger.info(`SIM800L: processing event #${job.uuid}`)
            // If we're here, this is the first time we process this event
            job.timeoutIdentifier = setTimeout(() => {
                this.logger.debug(`SIM800L: preparing to cancel job #${job.uuid}`)
                this.cancelEvent(job.uuid)
            }, 10000)
            if (job.command) {
                this.port.write(`${job.command}\r`, undefined, (err: any) => {
                    if (err) {
                        if (job.callback) {
                            job.callback(null, err)
                        }
                        else {
                            throw new Error(err)
                        }
                    }
                })
            }
        }
        this.busy = false
    }
    private attachingEvents() {
        this.logger.info("SIM800L: attaching serialport events")
        this.port.on('open', () => {
            this.events.emit('open');
        });
        this.port.on("data", this.handleIncomingData)
        this.logger.debug("SIM800L: serialport events attached")
    }
    private cancelEvent(uuid: string) {
        this.logger.warn(`SIM800L: ${uuid} - TIMEOUT`)
        // Find the job and calling its callback with the Error timeout
        const job = this.queue.find((queuedJob) => {
            return queuedJob.uuid == uuid
        })
        if (job && job.callback) {
            job.callback(null, new Error(`job #${job.uuid} - timeout at ${new Date().toISOString()}`))
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

function parseBuffer(buffer: string): string[] {
    return buffer.split(/[\r\n]{1,2}/).filter((value => {
        return !/^[\r\n]{1,2}$/.test(value) && value.length
    }))
}
function isOk(parsedData: ParsedData) {
    return parsedData.length ? parsedData[parsedData.length - 1] == 'OK' : false
}
function isError(parsedData: ParsedData) {
    return parsedData.length ? parsedData[parsedData.length - 1] == 'ERROR' : false
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
        logger?.info("SIM800L: using default event handler")
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
        if (isError(parsedData)) {
            if (job.callback) {
                job.callback({
                    uuid: job.uuid,
                    type: job.type,
                    result: 'failure',
                    error: {
                        type: "generic",
                        content: parsedData
                    }
                })
            }
            job.ended = true
        }
        // If callback, we need to resolve it somehow to allow the event loop to continue
    } catch (error: any) {
        job.ended = true
        if (job.callback) { job.callback(null, new Error(error)) }
    }
}
const incomingHandler: JobHandler = (buffer: string, job: JobItem, emitter?: EventEmitter, logger?: Console) => {
    try {
        logger?.info("SIM800L: using incoming event handler")
        const parsedData = parseBuffer(buffer)
        // Incoming handler when there is no queue, taking care of emitting events (eg: sms... delivery report...)
        // There are no callbacks for the incomingHanlder as it is initiated by the server itself, but it emits events


    } catch (error: any) {
        job.ended = true
    }
}

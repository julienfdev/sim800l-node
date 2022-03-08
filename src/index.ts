import { SerialPort, SerialPortOpenOptions } from "serialport"
import { EventEmitter } from 'stream';
import { v4 } from "uuid";
import { JobHandler } from "./models/JobHandler";
import JobItem from "./models/JobItem";
import ModemResponse from "./models/ModemResponse";

const defaultHandler: JobHandler = (buffer: string, callback?: (result: ModemResponse, error: Error) => void, emitter?: EventEmitter, logger?: Console): void => {
    logger?.info("SIM800L: using default event handler")
    // Do something
    console.log(buffer)
}
const incomingHandler: JobHandler = (buffer: string, callback?: (result: ModemResponse, error: Error) => void, emitter?: EventEmitter, logger?: Console) => {
    logger?.info("SIM800L: using incoming event handler")
    // Incoming handler when there is no queue, taking care of emitting events (eg: sms... delivery report...)
    console.log(buffer)
}

export default class Sim800L {
    public events = new EventEmitter();
    public simConfig: Record<string, any>
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
    public execCommand(command: string, type: string, handler = defaultHandler, callback?: (result: any, err?: Error) => any): Promise<ModemResponse> | void {
        if (typeof callback !== 'function') {
            return new Promise((resolve, reject) => {
                this.execCommand(command, type, handler, (result, err) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve(result)
                    }
                })
            })
        }
        this.logger.log(`SIM800L: queuing command ${command.length > 15 ? `${command.substring(0, 15)}...` : command} `)
        // We create a queue item
        this.queue.push({
            uuid: v4(),
            callback,
            handler,
            command,
            type,
            timeoutIdentifier: null
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
            job.handler(this.dataBuffer, job.callback ? job.callback : undefined, this.events, this.logger)
        } else {
            // This is incoming data, we need to create a job, unshift it and handle the data
            this.queue.unshift({
                uuid: v4(),
                handler: incomingHandler,
                command: '',
                type: 'incoming',
                timeoutIdentifier: null
            })
        }
    }
    private nextEvent() {
        this.logger.info(`SIM800L: current queue length - ${this.queue.length}`)
        if (!this.queue.length || this.busy) {
            return
        }
        this.busy = true
        // Finding the first item in the queue
        const job = this.queue[0]
        // setting the 10s timeout
        job.timeoutIdentifier = setTimeout(() => {
            this.logger.debug(`SIM800L: preparing to cancel job #${job.uuid}`)
            this.cancelEvent(job.uuid)
        }, 10000)
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
        this.queue = this.queue.filter((job) => {
            return !(job.uuid == uuid)
        })
        this.dataBuffer = ''
        this.busy = false
        this.nextEvent()
    }
    private clear() {
        this.busy = false
        this.dataBuffer = ''
        this.queue.shift()
        this.nextEvent()
    }

}

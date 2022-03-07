import { SerialPortOpenOptions } from "serialport";
import { SerialPort } from "serialport";
import { EventEmitter } from "stream";
import { iOpenOptions, OpenOptions, SerialPortInfo } from "./models/ISerial";
import { SimConfig } from "./models/ISim";

export default class Sim800L {
    public events = new EventEmitter()
    public simConfig: SimConfig = {
        // Default sim config (see serialport-gsm)
    }

    private port: SerialPort

    /**
     * Creates an instance of Sim800L.
     * @param {OpenOptions} options
     * @memberof Sim800L
     */
    constructor(options: OpenOptions, simConfig?: SimConfig) {
        try {
            // parsing the options (setting autoOpen to false in the meantime)
            const parsedOptions = iOpenOptions.parse(options)
            this.port = new SerialPort(parsedOptions as SerialPortOpenOptions<any>)
            // Forwarding all events
            this.attachingEvents()
        } catch (error) {
            throw error
        }
    }



    /**
     *Returns a list of available serial ports, is available statically for config purposes
     *
     * @static
     * @return {*}  {Promise<SerialPortInfo[]>}
     * @memberof Sim800L
     */
    static async list(): Promise<SerialPortInfo[]> {
        return await SerialPort.list()
    }

    /**
     *Opens the port communication (emits a "open" event you can listen on the @events property)
     *
     * @memberof Sim800L
     */
    public open(): void {
        try {
            this.port.open()
        } catch (error) {
            throw error
        }
    }


    private attachingEvents() {
        this.port.on("close", () => {
            this.events.emit("close")
        })
        this.port.on("data", (chunk: any) => {
            this.events.emit("data", chunk)
        })
        this.port.on("end", () => {
            this.events.emit("end")
        })
        this.port.on("error", (err) => {
            this.events.emit("error", err)
        })
        this.port.on("pause", () => {
            this.events.emit("pause")
        })
        this.port.on("readable", () => {
            this.events.emit("readable")
        })
        this.port.on("resume", () => {
            this.events.emit("resume")
        })
        this.port.on("open", () => {
            this.events.emit("open")
        })
    }
}


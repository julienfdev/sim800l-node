/**
 * @typedef {Object} openOptions
 * @property {boolean} [autoOpen=true] Automatically opens the port on `nextTick`.
 * @property {number=} [baudRate=9600] The baud rate of the port to be opened. This should match one of the commonly available baud rates, such as 110, 300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, or 115200. Custom rates are supported best effort per platform. The device connected to the serial port is not guaranteed to support the requested baud rate, even if the port itself supports that baud rate.
 * @property {number} [dataBits=8] Must be one of these: 8, 7, 6, or 5.
 * @property {number} [highWaterMark=65536] The size of the read and write buffers defaults to 64k.
 * @property {boolean} [lock=true] Prevent other processes from opening the port. Windows does not currently support `false`.
 * @property {number} [stopBits=1] Must be one of these: 1 or 2.
 * @property {string} [parity=none] Must be one of these: 'none', 'even', 'mark', 'odd', 'space'.
 * @property {boolean} [rtscts=false] flow control setting
 * @property {boolean} [xon=false] flow control setting
 * @property {boolean} [xoff=false] flow control setting
 * @property {boolean} [xany=false] flow control setting
 * @property {object=} bindingOptions sets binding-specific options
 * @property {Binding=} Binding The hardware access binding. `Bindings` are how Node-Serialport talks to the underlying system. Will default to the static property `Serialport.Binding`.
 * @property {number} [bindingOptions.vmin=1] see [`man termios`](http://linux.die.net/man/3/termios) LinuxBinding and DarwinBinding
 * @property {number} [bindingOptions.vtime=0] see [`man termios`](http://linux.die.net/man/3/termios) LinuxBinding and DarwinBinding
 */

import { z } from "zod"

export const iOpenOptions = z.object({
    autoOpen: z.boolean().default(false),
    dataBits: z.number().default(8).refine((dataBits) => [5, 6, 7, 8].includes(dataBits)),
    highWaterMark: z.number().default(65536),
    lock: z.boolean().default(true),
    stopBits: z.number().default(1).refine((stopBits) => [1, 2].includes(stopBits)),
    parity: z.enum(["none", "even", "mark", "odd", "space"]).default("none"),
    rtscts: z.boolean().default(false),
    xon: z.boolean().default(false),
    xoff: z.boolean().default(false),
    xany: z.boolean().default(false),
    path: z.string(),
    baudRate: z.number().default(9600).refine((baudRate) => [110, 300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200].includes(baudRate), "unsupported baudRate")
})
export const iSerialPortInfo = z.object({
    path: z.string(),
    manufacturer: z.string().optional(),
    serialNumber: z.string().optional(),
    pnpId: z.string().optional(),
    locationId: z.string().optional(),
    vendorId: z.string().optional(),
    productId: z.string().optional()
})
const iOpenOptionsType = iOpenOptions.partial().extend({
    path: z.string(),
    baudRate: z.number().default(9600).refine((baudRate) => [110, 300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200].includes(baudRate), "unsupported baudRate")
})

export type OpenOptions = z.infer<typeof iOpenOptionsType>
export type SerialPortInfo = z.infer<typeof iSerialPortInfo>
import { EventEmitter } from "stream";
import { JobHandler } from "./JobHandler";
import { ModemCallback } from "./ModemCallback";
import ModemResponse from "./ModemResponse";

export default interface JobItem {
    uuid: string,
    callback?: ModemCallback
    handler: JobHandler
    command: string,
    type: string,
    timeoutIdentifier: any,
    ended: boolean,
    overrideTimeout?: number,
    inbox?: Record<string, any>[],
    outbox?: Record<string, any>[] // Message interface TBD
}
import { EventEmitter } from "stream";
import { JobHandler } from "./JobHandler";
import ModemResponse from "./ModemResponse";

export default interface JobItem {
    uuid: string,
    callback?: (result: ModemResponse | null, err?: Error) => void,
    handler: JobHandler
    command: string,
    type: string,
    timeoutIdentifier: any
}
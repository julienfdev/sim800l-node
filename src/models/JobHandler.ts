import { EventEmitter } from "stream";
import ModemResponse from "./ModemResponse";

export type JobHandler = (buffer: string, callback?: (result: ModemResponse, error: Error) => void, emitter?: EventEmitter, logger?: Console) => void
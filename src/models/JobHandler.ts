import { EventEmitter } from "stream";
import JobItem from "./JobItem";

export type JobHandler = (buffer: string, job: JobItem, emitter?: EventEmitter, logger?: Console) => void
import { EventEmitter } from 'stream';
import { JobItem } from './JobItem';
import Logger from './Logger';

export type JobHandler = (buffer: string, job: JobItem, emitter: EventEmitter, logger?: Logger) => void;
export type ParsedData = string[];

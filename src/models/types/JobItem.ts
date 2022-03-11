import { JobHandler } from './JobHandler';
import { ModemCallback } from './ModemCallback';

export interface JobItem {
  uuid: string;
  callback?: ModemCallback;
  handler: JobHandler;
  command: string;
  type: string;
  timeoutIdentifier: any;
  ended: boolean;
  overrideTimeout?: number;
  subcommands?: string[];
  subcommandIndex: number;
  reference?: string;
}

import { SerialPort } from 'serialport';
import Logger from './Logger';
import { Flatten, GetReturnType, UnpackPromise } from './Util';

export default interface SimConfig {
  customCnmi?: string;
  deliveryReport?: boolean;
  autoDeleteFromSim?: boolean;
  pin?: string;
  smsc?: string;
  logger?: Logger;
}
export type PortInfo = Flatten<UnpackPromise<GetReturnType<typeof SerialPort.list>>>;

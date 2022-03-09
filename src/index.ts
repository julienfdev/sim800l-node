import chalk from 'chalk';
import { SerialPort, SerialPortOpenOptions } from 'serialport';
import { EventEmitter } from 'stream';
import { v4 } from 'uuid';
import { JobHandler, ParsedData } from '@/models/types/JobHandler';
import JobItem from '@/models/types/JobItem';
import { DefaultFunctionSignature, ModemCallback } from '@/models/types/ModemCallback';
import ModemResponse, {
  CheckModemResponse,
  CheckNetworkData,
  CheckPinStatus,
  ConnectionStatus,
  InitializeResponse,
  InitializeStatus,
  ModemErrorRaw,
  QueryStatus,
} from '@/models/types/ModemResponse';
import SimConfig from '@/models/types/SimConfig';
export default class Sim800L {
  public events = new EventEmitter();
  public simConfig: SimConfig = {
    customCnmi: '2,1,2,1,0',
    deliveryReport: true,
    autoDeleteFromSim: true,
  };
  private initialized = false;
  private networkReady = false;
  private simUnlocked = false;
  private networkRetry = 0;
  private retryNumber = 0;
  private resetNumber = 0;
  private brownoutNumber = 0;
  private port: SerialPort;
  private queue: JobItem[] = [];
  private busy = false;
  private logger: Console;
  private dataBuffer = '';
  private networkMonitorInterval?: NodeJS.Timer;
  private inbox = []; // Typing

  // GETTERS
  get isInitialized() {
    return this.initialized;
  }
  get isNetworkReady() {
    return this.networkReady;
  }
  get isSimUnlocked() {
    return this.simUnlocked;
  }

  /**
   * Creates an instance of Sim800L.
   * @param {OpenOptions} options
   * @memberof Sim800L
   */
  constructor(options: SerialPortOpenOptions<any>, simConfig: SimConfig) {
    try {
      // parsing the options (setting autoOpen to false in the meantime)
      this.port = new SerialPort(options as SerialPortOpenOptions<any>);
      this.simConfig = { ...this.simConfig, ...simConfig };
      this.logger = this.simConfig.logger || (console as Console);
      this.logger.log(chalk.bold.bgCyanBright.black('==== SIM800L interface module ====  '));
      // Forwarding all events
      this.attachingEvents();
      this.initialize();
      this.brownoutDetector();
      this.logger.debug(`${new Date().toISOString()} - SIM800L - instance created`);
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
      this.initialized = false;
      this.logger.log(`${new Date().toISOString()} - SIM800L - closing serial port`);
      this.port.close();
      this.logger.debug(`${new Date().toISOString()} - SIM800L - serial port closed`);
    } catch (error) {
      this.initialized = false;
      this.logger.error(chalk.bgRedBright.black(`${new Date().toISOString()} - SIM800L - unable to close serial port`));
      throw error;
    }
  }
  public initialize = async (
    callback?: ModemCallback<InitializeResponse>,
  ): Promise<ModemResponse<InitializeResponse> | void> => {
    if (typeof callback !== 'function') {
      return promisify(this.initialize);
    } else {
      try {
        this.logger.info(`${new Date().toISOString()} - SIM800L - checking if modem is online`);
        const modemChecked = (await this.checkModem()) as ModemResponse<CheckModemResponse>;
        if (!(modemChecked.result === 'success')) {
          this.events.emit('error', modemChecked);
          callback(modemChecked);
          return;
        }
        this.logger.info(`${new Date().toISOString()} - SIM800L - enabling verbose mode `);
        await this.execCommand(null, 'AT+CMEE=2', 'verbose');

        const pinChecked = (await this.checkPinRequired()) as ModemResponse<CheckPinStatus>;
        if (!(pinChecked.result === 'success')) {
          // We switch, if !NEED_PIN we can callback and return
          if (!(pinChecked.error?.content.status === InitializeStatus.NEED_PIN) || !this.simConfig.pin) {
            this.events.emit('error', pinChecked);
            callback(pinChecked);
            return;
          }
          // We will try to unlock the SIM, once, emit an event and throw the hell out of the app if it does not work
          const unlocked = (await this.unlockSim(null, this.simConfig.pin)) as ModemResponse;
          if (!(unlocked.result === 'success')) {
            this.events.emit('error', unlocked);
            callback(unlocked);
          }
        }
        // finally, we update the cnmi config
        const updatedConfig = await this.updateCnmiConfig(null, this.simConfig.customCnmi!);
        if (!(updatedConfig.result === 'success')) {
          this.events.emit('error', updatedConfig);
          callback(updatedConfig);
        }
        // And we set the SMS mode to PDU
        await this.setSmsMode(null);

        // Holy cow
        this.initialized = true;
        this.logger.log(chalk.bgGreenBright.black(`${new Date().toISOString()} - SIM800L - modem is initialized and ready! 👌`));
        this.events.emit('initialized');
        this.retryNumber = 0;
        this.checkNetwork(null);
      } catch (error) {
        callback(null, new Error('unhandled initialization failure'));
        // Trying to reset
        this.retryNumber += 1;
        if (this.retryNumber < 3) this.resetModem(undefined, undefined, true);
      }
    }
    return;
  };

  public checkModem = async (
    callback?: ModemCallback<InitializeResponse>,
  ): Promise<ModemResponse<CheckModemResponse> | void> => {
    if (typeof callback !== 'function') {
      return promisify(this.checkModem);
    } else {
      this.logger.log(`${new Date().toISOString()} - SIM800L - checking modem connection`);
      try {
        // We define the handler, which will search of an OK end of query
        const handler: JobHandler = (buffer, job) => {
          if (isOk(parseBuffer(buffer))) {
            this.logger.info(`${new Date().toISOString()} - SIM800L - modem online`);
            job.callback!({
              uuid: job.uuid,
              type: job.type,
              result: 'success',
              data: {
                raw: buffer,
                processed: {
                  status: QueryStatus.OK,
                  message: 'Modem is Online',
                },
              },
            });
            job.ended = true;
          } else if (isError(parseBuffer(buffer)).error) {
            this.logger.error(chalk.bgRedBright.black(`${new Date().toISOString()} - SIM800L - modem error`));
            job.callback!({
              uuid: job.uuid,
              type: job.type,
              result: 'failure',
              error: {
                type: 'checkError',
                content: buffer,
              },
            });
            job.ended = true;
          }
        };
        // Exec command AT
        await this.execCommand(callback, 'AT', 'check-modem', handler);
      } catch (error: any) {
        callback(null, new Error(error || 'unhandled modem check failure'));
      }
    }
  };
  public checkPinRequired = async (
    callback?: ModemCallback<InitializeResponse>,
  ): Promise<ModemResponse<CheckPinStatus> | void> => {
    if (typeof callback !== 'function') {
      return promisify(this.checkPinRequired);
    } else {
      try {
        this.logger.log(`${new Date().toISOString()} - SIM800L - checking pin lock status`);
        const handler: JobHandler = (buffer, job) => {
          const parsedBuffer = parseBuffer(buffer);
          if (isOk(parsedBuffer)) {
            // command has been received, we can intercept the field that starts with +CPIN and extract the
            // status
            const field = parsedBuffer.find((part) => {
              return part.startsWith('+CPIN');
            });
            if (!field || !(field?.split(' ').length > 1)) {
              // can't parse the result, throw an error
              this.logger.error(chalk.bgRedBright.black("SIM800L - can't parse pin lock status"));
              throw new Error("pin-check : can't parse result");
            }
            // we get rid of the first split and join the rest
            const keyFields = field.split(' ');
            keyFields.splice(0, 1);
            const key = keyFields.join(' ');
            const status = getInitializationStatus(key);
            this.simUnlocked = status == InitializeStatus.READY;
            this.logger.info(`${new Date().toISOString()} - SIM800L - pin lock : ${getStatusMessage(status)} `);
            job.callback!({
              uuid: job.uuid,
              type: 'pin-check',
              result: status === InitializeStatus.READY ? 'success' : 'failure',
              data:
                status === InitializeStatus.READY
                  ? {
                      raw: buffer,
                      processed: {
                        status,
                        message: getStatusMessage(status),
                      },
                    }
                  : undefined,
              error:
                status !== InitializeStatus.READY
                  ? {
                      type: 'pin-required',
                      content: {
                        status,
                        message: getStatusMessage(status),
                      },
                    }
                  : undefined,
            });
            job.ended = true;
          }
          if (isError(parsedBuffer).error) {
            this.logger.error(chalk.bgRedBright.black(`${new Date().toISOString()} - SIM800L - pin lock : sim error`));
            job.callback!({
              uuid: job.uuid,
              type: job.type,
              result: 'failure',
              error: {
                type: 'checkPinError',
                content: {
                  status: InitializeStatus.ERROR,
                  message: isError(parsedBuffer).message,
                },
              },
            });
            job.ended = true;
          }
        };
        await this.execCommand(callback, 'AT+CPIN?', 'check-pin', handler);
      } catch (error: any) {
        callback(null, new Error(error || 'unhandled pin check failure'));
      }
    }
  };
  public unlockSim = async (callback: ModemCallback | undefined | null, pin: string) => {
    if (typeof callback !== 'function') {
      return promisify(this.unlockSim, pin);
    } else {
      const handler: JobHandler = (buffer, job) => {
        const parsedBuffer = parseBuffer(buffer);
        if (isError(parsedBuffer).error) {
          // pin is probably wrong, we need to callback
          this.logger.error(chalk.bgRedBright.black(`${new Date().toISOString()} - SIM800L - WRONG PIN ! CHECK PIN ASAP`));
          job.callback!({
            uuid: job.uuid,
            type: job.type,
            result: 'failure',
            error: {
              type: 'sim-unlock',
              content: {
                status: InitializeStatus.PIN_INCORRECT,
                message: isError(parsedBuffer).message,
              },
            },
          });
        }
        // if not error, it can be "okay", we just log it as we're waiting for the +CPIN info
        if (isOk(parsedBuffer)) {
          this.logger.info(`${new Date().toISOString()} - SIM800L - pin accepted, waiting for unlock`);
        }
        // Now, we're looking into the last part of parsedData and search for "+CPIN: "
        if (parsedBuffer.length && parsedBuffer[parsedBuffer.length - 1].startsWith('+CPIN: ')) {
          // we extract the status, it looks a lot like checkpinrequired
          const key = parsedBuffer[parsedBuffer.length - 1].split('+CPIN: ').length
            ? parsedBuffer[parsedBuffer.length - 1].split('+CPIN: ')[1]
            : null;
          const status = key ? getInitializationStatus(key) : InitializeStatus.ERROR;
          this.logger.info(`${new Date().toISOString()} - SIM800L - pin lock : ${getStatusMessage(status)} `);
          job.callback!({
            uuid: job.uuid,
            type: 'pin-check',
            result: status === InitializeStatus.READY ? 'success' : 'failure',
            data:
              status === InitializeStatus.READY
                ? {
                    raw: buffer,
                    processed: {
                      status,
                      message: getStatusMessage(status),
                    },
                  }
                : undefined,
            error:
              status !== InitializeStatus.READY
                ? {
                    type: 'pin-required',
                    content: {
                      status,
                      message: getStatusMessage(status),
                    },
                  }
                : undefined,
          });
          job.ended = true;
        }
      };
      await this.execCommand(callback, `AT+CPIN=${pin}`, 'pin-unlock', handler);
    }
  };
  public updateCnmiConfig = async (
    callback: ModemCallback | undefined | null,
    cnmi: string,
  ): Promise<ModemResponse> => {
    if (typeof callback !== 'function') {
      return promisify(this.updateCnmiConfig, cnmi);
    } else {
      this.logger.log(`${new Date().toISOString()} - SIM800L - updating CNMI config with values ${cnmi}`);
      const handler = defaultHandler; // We just need an OK or ERROR, defaultHandler is perfect for that
      return (await this.execCommand(callback, `AT+CNMI=${cnmi}`, 'cnmi-config', handler)) as ModemResponse;
    }
  };
  public resetModem = async (callback: ModemCallback | undefined | null, mode = '1,1', reInitialize = false) => {
    if (typeof callback !== 'function') {
      return promisify(this.resetModem, mode, reInitialize);
    } else {
      // if too many retry, we throw
      if (this.retryNumber > 5) {
        throw new Error('Too many retries');
      }
      //
      this.logger.warn(chalk.bgYellowBright.black(`${new Date().toISOString()} - SIM800L - modem will reset`));
      const handler: JobHandler = (buffer, job) => {
        // Very simple handler, once called, it just sets a timeout of a few seconds resetting the whole object
        setTimeout(() => {
          this.logger.warn(chalk.bgYellowBright.black(`${new Date().toISOString()} - SIM800L - modem is reset`));
          job.ended = true;
          this.queue = [];
          if (reInitialize) this.initialize();
          callback({
            uuid: job.uuid,
            type: job.type,
            result: 'success',
          });
        }, 6000);
      };

      // calling the reset vector
      await this.execCommand(callback, `AT+CFUN=${mode}`, 'reset', handler);
      this.resetNumber += 1;
      this.initialized = false;
      this.retryNumber = 0;
      this.networkRetry = 0;
      this.brownoutNumber = 0;
      this.networkReady = false;
      this.dataBuffer = '';
      this.logger.warn(chalk.bgYellowBright.black(`${new Date().toISOString()} - SIM800L - modem is resetting... please wait...`));
    }
  };

  public checkNetwork = async (callback: ModemCallback | undefined | null, force = false) => {
    if (typeof callback !== 'function') {
      return promisify(this.checkNetwork, force);
    } else {
      this.logger.log(`${new Date().toISOString()} - SIM800L - getting carrier reg status`);
      const handler: JobHandler = (buffer, job) => {
        const parsedBuffer = parseBuffer(buffer);
        // Checks if parsedBuffer bears network info
        if (parsedBuffer) {
          const part = parsedBuffer.find((value) => value.startsWith('+CREG: '));
          if (!part || part.split('+CREG: ').length < 2) {
            callback({
              uuid: job.uuid,
              type: job.type,
              result: 'failure',
              error: {
                type: 'parse-error',
                content: parsedBuffer,
              },
            });
            job.ended = true;
            return;
          }
          const [networkAction, networkStatus] = part.split('+CREG: ')[1].split(',');
          if (isNaN(parseInt(networkAction, 10)) || isNaN(parseInt(networkStatus, 10))) {
            callback({
              uuid: job.uuid,
              type: job.type,
              result: 'failure',
              error: {
                type: 'parse-error-comma',
                content: parsedBuffer,
              },
            });
            job.ended = true;
            return;
          }
          callback({
            uuid: job.uuid,
            type: job.type,
            result: 'success',
            data: {
              raw: parsedBuffer,
              processed: {
                networkAction: parseInt(networkAction, 10),
                networkStatus: parseInt(networkStatus, 10),
              },
            },
          });
          this.events.emit('network', {
            networkAction: parseInt(networkAction, 10),
            networkStatus: parseInt(networkStatus, 10),
          });
          job.ended = true;
          return;
        } else if (isError(parsedBuffer).error) {
          callback({
            uuid: job.uuid,
            type: job.type,
            result: 'failure',
            error: {
              type: 'command',
              content: isError(parsedBuffer),
            },
          });
          return;
        }
      };
      return await this.execCommand(callback, 'AT+CREG?', 'check-network', handler);
    }
  };

  public activateCReg = async (callback: ModemCallback | undefined | null) => {
    // TBD
  };

  public execCommand = (
    callback: ModemCallback | undefined | null,
    command: string,
    type: string,
    handler = defaultHandler,
    timeout?: number,
  ): Promise<ModemResponse> | void => {
    if (typeof callback !== 'function') {
      return promisify(this.execCommand, command, type, handler);
    }
    this.logger.log(`${new Date().toISOString()} - SIM800L - queuing command ${command.length > 15 ? `${command.substring(0, 15)}...` : command} `);
    // We create a queue item
    this.queue.push({
      uuid: v4(),
      callback,
      handler,
      command,
      type,
      timeoutIdentifier: null,
      overrideTimeout: timeout,
      ended: false,
    });
    // We cycle nextEvent()
    this.nextEvent();
  };

  private setSmsMode = async (callback: ModemCallback | undefined | null, mode = 0) => {
    if (typeof callback !== 'function') {
      return promisify(this.setSmsMode, mode);
    } else {
      return await this.execCommand(callback, 'AT+CMGF=0', 'set-sms-mode');
    }
  };

  private handleIncomingData = (buffer: any) => {
    this.busy = true;
    const received = buffer.toString();
    this.dataBuffer += received;
    // if there is a queue, we can call the handler
    if (this.queue.length) {
      // If the job has ended, we need to unshift it before assigning it
      if (this.queue[0].ended) {
        this.queue.unshift();
      }
      const job = this.queue[0];
      job.handler(this.dataBuffer, job, this.events, this.logger);
    } else {
      // This is incoming data, we need to create a job, unshift it and handle the data
      const job = {
        uuid: v4(),
        handler: this.incomingHandler,
        command: '',
        type: 'incoming',
        timeoutIdentifier: null,
        ended: false,
      };
      this.queue.unshift(job);
      this.incomingHandler(this.dataBuffer, job, this.events, this.logger);
    }
    this.busy = false;
    this.nextEvent();
  };
  private nextEvent() {
    this.logger.info(`${new Date().toISOString()} - SIM800L - current queue length - ${this.queue.length}`);
    if (!this.queue.length) {
      return;
    }
    // if the job has ended, we clear it
    const job = this.queue[0];
    if (job.ended) {
      this.logger.info(`${new Date().toISOString()} - SIM800L - job ${job.uuid} has ended and will be wiped out of existence`);
      this.clear();
      return;
    }
    //
    if (this.busy) {
      return;
    }
    this.busy = true;
    // Finding the first item in the queue

    // setting the 10s timeout
    if (!job.timeoutIdentifier) {
      this.logger.info(`${new Date().toISOString()} - SIM800L - processing event #${job.uuid}`);
      // If we're here, this is the first time we process this event
      job.timeoutIdentifier = setTimeout(() => {
        this.logger.debug(`${new Date().toISOString()} - SIM800L - preparing to cancel job #${job.uuid}`);
        this.cancelEvent(job.uuid);
      }, job.overrideTimeout || 15000);
      if (job.command) {
        this.port.write(`${job.command}\r`, undefined, (err: any) => {
          if (err) {
            if (job.callback) {
              job.callback(null, err);
            } else {
              // event error
              this.events.emit('error', err);
            }
          }
        });
      }
    }
    this.busy = false;
  }
  private attachingEvents() {
    this.logger.info(`${new Date().toISOString()} - SIM800L - attaching serialport events`);
    this.port.on('open', () => {
      this.events.emit('open');
    });
    this.port.on('data', this.handleIncomingData);
    this.logger.debug(`${new Date().toISOString()} - SIM800L - serialport events attached`);
    // this.events.on('initialized', () => {});
    this.events.on('network', this.networkInternalHandler);
    this.events.on('brownout', this.brownoutHandler);
  }
  private cancelEvent(uuid: string) {
    this.logger.warn(`${new Date().toISOString()} - SIM800L - ${uuid} - TIMEOUT`);
    // Find the job and calling its callback with the Error timeout
    const job = this.queue.find((queuedJob) => {
      return queuedJob.uuid === uuid;
    });
    if (job && job.callback) {
      job.callback({
        uuid: job.uuid,
        type: job.type,
        result: 'failure',
        error: {
          type: 'unhandled',
          content: parseBuffer(this.dataBuffer),
        },
      });
      this.events.emit('error', {
        uuid: job.uuid,
        type: job.type,
        result: 'failure',
        error: {
          type: 'unhandled',
          content: parseBuffer(this.dataBuffer),
        },
      } as ModemResponse<ParsedData>);
    }
    if (job && job.type === 'incoming') {
      // this was an unhandled event, emitting the event
      this.events.emit('incoming', {
        uuid: job.uuid,
        type: job.type,
        result: 'failure',
        error: {
          type: 'unhandled',
          content: parseBuffer(this.dataBuffer),
        },
      } as ModemResponse<ParsedData>);
    }
    if (job) {
      this.events.emit('timeout', job);
    }
    this.queue = this.queue.filter((item) => {
      return !(item.uuid === uuid);
    });
    this.dataBuffer = '';
    this.busy = false;
    this.nextEvent();
  }
  private clear() {
    if (this.queue.length && this.queue[0].timeoutIdentifier) {
      clearTimeout(this.queue[0].timeoutIdentifier);
    }
    this.busy = false;
    this.dataBuffer = '';
    this.queue.shift();
    this.nextEvent();
  }

  private networkInternalHandler = (network: CheckNetworkData) => {
    this.logger.log(`${new Date().toISOString()} - SIM800L - network-event, status: ${network.networkStatus}`);
    if (!this.networkMonitorInterval) {
      this.logger.info(`${new Date().toISOString()} - SIM800L - now monitoring network events`);
      this.networkMonitorInterval = this.setupNetworkMonitor();
    }
    if ([ConnectionStatus.REGISTERED, ConnectionStatus.ROAMING].includes(network.networkStatus) && !this.networkReady) {
      this.logger.log(`${new Date().toISOString()} - SIM800L - network is ready`);
      this.networkReady = true;
    }
    if (
      ![ConnectionStatus.REGISTERED, ConnectionStatus.IN_PROGRESS, ConnectionStatus.ROAMING].includes(
        network.networkStatus,
      ) &&
      this.networkReady
    ) {
      this.logger.log(`${new Date().toISOString()} - SIM800L - network issue, status: ${network.networkStatus}, ${4 - this.networkRetry} remaining`);
      this.networkReady = false;
      this.networkRetry += 1;
    } else {
      if (this.networkReady) {
        this.logger.debug(`${new Date().toISOString()} - SIM800L - network: everything is fine`);
        this.networkRetry = 0;
      } else {
        this.networkRetry += 1;
        this.logger.info(`${new Date().toISOString()} - SIM800L - waiting for network, ${4 - this.networkRetry} remaining`);
      }
    }
    if (this.networkRetry > 3) {
      this.logger.warn(chalk.bgYellowBright.black(`SIM800 - network hanging, trying to reset`));
      this.resetModem(undefined, undefined, true);
    }
  };
  private brownoutHandler = () => {
    if (this.brownoutNumber > 3) {
      this.resetModem(undefined, undefined, true);
    }
    this.brownoutNumber += 1;
  };
  private setupNetworkMonitor() {
    return setInterval(async () => {
      if (this.initialized) {
        // preventing to clutter the networkRetry when modem isn't initialized
        await this.checkNetwork(undefined);
      }
    }, 30000);
  }
  private brownoutDetector() {
    return setInterval(async () => {
      const result = await this.checkModem(undefined);
      if ((result as ModemResponse).result === 'failure' || !this.initialized) {
        this.events.emit('brownout');
      } else {
        this.brownoutNumber = 0;
      }
    }, 20000);
  }

  // Internal Incoming Handlers (those who need access to the sim)

  private incomingHandler: JobHandler = async (
    buffer: string,
    job: JobItem,
    emitter?: EventEmitter,
    logger?: Console,
  ) => {
    try {
      logger?.info(`${new Date().toISOString()} - SIM800L - using incoming event handler`);
      const parsedData = parseBuffer(buffer);
      // Incoming handler when there is no queue, taking care of emitting events (eg: sms... delivery report...)
      // There are no callbacks for the incomingHanlder as it is initiated by the server itself, but it emits events
      if (isNetworkReadyIncomingBuffer(parsedData)) {
        logger?.log(`${new Date().toISOString()} - SIM800L - incoming network confirmation, updating`);
        if (emitter) {
          emitter.emit('network', { networkStatus: ConnectionStatus.REGISTERED });
        }
        // MISSING CALLBACKS
        job.ended = true;
      }
      if (isNewSms(parsedData)) {
        // console.log(parsedData);
        job.ended = true;
      }
      if (isNetworkInfo(parsedData)) {
        this.checkNetwork(undefined);
        // CALLBACK
        job.ended = true;
      }
    } catch (error: any) {
      job.ended = true;
    }
  };
}

//  ________  ___  ___  ________  ________  ________  ________  _________
// |\   ____\|\  \|\  \|\   __  \|\   __  \|\   __  \|\   __  \|\___   ___\
// \ \  \___|\ \  \\\  \ \  \|\  \ \  \|\  \ \  \|\  \ \  \|\  \|___ \  \_|
//  \ \_____  \ \  \\\  \ \   ____\ \   ____\ \  \\\  \ \   _  _\   \ \  \
//   \|____|\  \ \  \\\  \ \  \___|\ \  \___|\ \  \\\  \ \  \\  \|   \ \  \
//     ____\_\  \ \_______\ \__\    \ \__\    \ \_______\ \__\\ _\    \ \__\
//    |\_________\|_______|\|__|     \|__|     \|_______|\|__|\|__|    \|__|
//    \|_________|

function promisify(functionSignature: DefaultFunctionSignature, ...args: any[]): Promise<ModemResponse> {
  return new Promise((resolve, reject) => {
    functionSignature((result, err) => {
      if (err) {
        reject(err);
      } else if (result) {
        resolve(result);
      }
    }, ...args);
  });
}

function getStatusMessage(status: InitializeStatus): string {
  switch (status) {
    case InitializeStatus.READY:
      return 'modem is ready';
    case InitializeStatus.NEED_PIN:
      return 'please provide a pin number to unlock the SIM Card';
    case InitializeStatus.PIN_INCORRECT:
      return "please think twice before hitting refresh mate, you'll probably lock your sim card";
    case InitializeStatus.NEED_PUK:
      return 'told ya';
    case InitializeStatus.ERROR:
      return "can't figure out what's wrong, please check if sim is properly inserted";
  }
}
function getInitializationStatus(key: string): InitializeStatus {
  switch (key) {
    case 'READY':
      return InitializeStatus.READY;
    case 'SIM PIN':
      return InitializeStatus.NEED_PIN;
    case 'SIM PUK':
      return InitializeStatus.NEED_PUK;
    default:
      return InitializeStatus.ERROR;
  }
}
function parseBuffer(buffer: string): string[] {
  return buffer.split(/[\r\n]{1,2}/).filter((value) => {
    return !/^[\r\n]{1,2}$/.test(value) && value.length;
  });
}
function isOk(parsedData: ParsedData) {
  return parsedData.length ? parsedData[parsedData.length - 1] === 'OK' : false;
}
function isError(parsedData: ParsedData): ModemErrorRaw {
  const field =
    parsedData.length && parsedData[parsedData.length - 1] ? parsedData[parsedData.length - 1].split(' ERROR: ') : null;
  if (field && field.length && field[0] === '+CME') {
    // extracting message
    // console.error(chalk.red('ERROR ERROR LOL '));
    field.splice(0, 1);
    const message = field.length ? field.join(' ') : undefined;
    return { error: true, raw: parsedData, ...{ message } };
  } else if (parsedData && parsedData.length) {
    return parsedData[parsedData.length - 1] === 'ERROR'
      ? { error: true, message: `${parsedData.join(' - ')}`, raw: parsedData }
      : { error: false };
  } else {
    return { error: false };
  }
}
function isNetworkReadyIncomingBuffer(parsedData: ParsedData): boolean {
  return parsedData.includes('Call Ready') && parsedData.includes('SMS Ready');
}
function isNewSms(parsedData: ParsedData): boolean {
  return findKey(parsedData, '+CMTI: ');
}
function isNetworkInfo(parsedData: ParsedData): boolean {
  return findKey(parsedData, '+CREG: ');
}

function findKey(parsedData: ParsedData, key: string) {
  return !!parsedData.find((value) => value.startsWith(key));
}

//  ___  ___  ________  ________   ________  ___       _______   ________  ________
// |\  \|\  \|\   __  \|\   ___  \|\   ___ \|\  \     |\  ___ \ |\   __  \|\   ____\
// \ \  \\\  \ \  \|\  \ \  \\ \  \ \  \_|\ \ \  \    \ \   __/|\ \  \|\  \ \  \___|_
//  \ \   __  \ \   __  \ \  \\ \  \ \  \ \\ \ \  \    \ \  \_|/_\ \   _  _\ \_____  \
//   \ \  \ \  \ \  \ \  \ \  \\ \  \ \  \_\\ \ \  \____\ \  \_|\ \ \  \\  \\|____|\  \
//    \ \__\ \__\ \__\ \__\ \__\\ \__\ \_______\ \_______\ \_______\ \__\\ _\ ____\_\  \
//     \|__|\|__|\|__|\|__|\|__| \|__|\|_______|\|_______|\|_______|\|__|\|__|\_________\
//                                                                           \|_________|

const defaultHandler: JobHandler = (buffer: string, job: JobItem, emitter?: EventEmitter, logger?: Console): void => {
  try {
    logger?.info(`${new Date().toISOString()} - SIM800L - using default event handler`);
    const parsedData = parseBuffer(buffer);
    // If it ends with okay, resolve
    if (isOk(parsedData)) {
      if (job.callback) {
        job.callback({
          uuid: job.uuid,
          type: job.type,
          result: 'success',
          data: {
            raw: buffer,
            processed: parsedData,
          },
        });
      }
      job.ended = true;
    }
    if (isError(parsedData).error) {
      if (job.callback) {
        job.callback({
          uuid: job.uuid,
          type: job.type,
          result: 'failure',
          error: {
            type: 'generic',
            content: {
              status: QueryStatus.ERROR,
              message: isError(parsedData).message,
            },
          },
        });
      }
      job.ended = true;
    }
    // If callback, we need to resolve it somehow to allow the event loop to continue
  } catch (error: any) {
    job.ended = true;
  }
};

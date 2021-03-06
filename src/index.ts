/**
 * SIM800L-Node, a modern TypeScript package for SIM800L family modems
 * @author Julien Ferand <hello@julienferand.dev>
 */

export { Sms } from './models/Sms';
export { SmsStatusChangeEvent, SmsErrorEvent, DeliveryReportRawObject } from './models/types/Sms';
export { ModemResponse, CheckNetworkData } from './models/types/ModemResponse';
export { JobItem } from './models/types/JobItem';
import { Sms } from './models/Sms';
import { DeliveryReportRawObject, SmsCreationOptions, SmsStatus } from './models/types/Sms';
import { SerialPort, SerialPortOpenOptions } from 'serialport';
import { EventEmitter } from 'stream';
import { v4 } from 'uuid';
import { PortInfo } from './models/types/SimConfig';
import { JobHandler, ParsedData } from './models/types/JobHandler';
import { JobItem } from './models/types/JobItem';
import { CommandParams, ModemCallback, ModemFunction, PromisifyFunctionSignature } from './models/types/ModemCallback';
import ModemResponse, {
  CheckModemResponse,
  CheckNetworkData,
  CheckPinStatus,
  ConnectionStatus,
  InitializeResponse,
  InitializeStatus,
  ModemErrorRaw,
  QueryStatus,
} from './models/types/ModemResponse';
import SimConfig from './models/types/SimConfig';
import Logger from './models/types/Logger';
import InboundSms from './models/InboundSms';

class Sim800L extends EventEmitter {
  public simConfig: SimConfig = {
    customCnmi: '2,1,2,1,0',
    deliveryReport: true,
    autoDeleteFromSim: true,
  };
  public port: SerialPort;
  private initialized = false;
  private networkReady = false;
  private simUnlocked = false;
  private networkRetry = 0;
  private retryNumber = 0;
  private resetNumber = 0;
  private brownoutNumber = 0;
  private queue: JobItem[] = [];
  private busy = false;
  private dataBuffer = '';
  private networkMonitorInterval?: NodeJS.Timer;
  private inbox: InboundSms[] = [];
  public outbox: Sms[] = [];
  public logger: Logger = {
    error: () => {
      /**/
    },
    warn: () => {
      /**/
    },
    info: () => {
      /**/
    },
    verbose: () => {
      /**/
    },
    debug: () => {
      /**/
    },
  };

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
   * Returns an object abstracting a SIM800L family serial modem.
   *
   * @param {SerialPortOpenOptions} options - The options you provide to the "serialport" dependency
   * @param {SimConfig} simConfig - The additional
   */
  constructor(options: SerialPortOpenOptions<any>, simConfig: SimConfig) {
    super();
    try {
      // parsing the options (setting autoOpen to false in the meantime)
      this.port = new SerialPort(options as SerialPortOpenOptions<any>);
      this.simConfig = { ...this.simConfig, ...simConfig };
      this.logger = this.simConfig.logger || this.logger;
      this.logger.info('==== SIM800L interface module ====  ');
      // Forwarding all events
      this.attachingEvents();
      this.initialize(null, {});
      this.brownoutDetector();
      this.spooler();
      this.logger.debug(`sim800l - instance created`);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Returns a list of available serial ports, is available statically for config purposes
   *
   * @returns {PromisePortInfo[]} An array of serial ports available
   */
  static async list(): Promise<PortInfo[]> {
    return await SerialPort.list();
  }

  /**
   * Closes the current serialport communication tunnel
   *
   * @returns void
   */
  public close(): void {
    try {
      this.initialized = false;
      this.logger.info(`close - closing serial port`);
      this.port.close();
      this.logger.debug(`close - serial port closed`);
    } catch (error) {
      this.initialized = false;
      this.logger.error(`close - unable to close serial port`);
      throw error;
    }
  }

  /**
   * A function creating an Sms attached to this particular Sim800L instance
   *
   * @param {string} receipient - The number you want to send your sms to (international format by default)
   * @param {string} text - The content of your SMS (UTF-8 recommended)
   * @param {SmsCreationOptions} [options = {}] - You can specify various parameters like a special smsc or delivery reports activation.
   * @returns {Sms} An instance of the Sms class
   */
  public createSms = (receipient: string, text: string, options = {} as SmsCreationOptions) => {
    const sms = new Sms(receipient, text, options, this);
    this.outbox.push(sms);
    return sms; // neat
  };

  /**
   * Initialization routine for the modem. Can be called after cold-boot.
   * The function checks if the modem is online, enables verbose mode, checks if pin is required, unlock the sim and updates the config of the modem
   *
   * @param {ModemCallback | null} callback - optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency
   * @param {{}} params - empty object provided for type consistency
   * @returns {Promise<ModemResponse> | void} A Promise resolving the ModemResponse. If a callback is provided, the function will use the callback instead and return void
   */
  public initialize: ModemFunction<{}> = async (callback: ModemCallback | null, params = {}): Promise<any> => {
    if (typeof callback !== 'function') {
      return promisify(this.initialize, params);
    } else {
      this.logger.info('Initializing modem');
      try {
        this.logger.verbose(`initialize - checking if modem is online`);
        const modemChecked = await this.checkModem(null, {});
        if (!(modemChecked.result === 'success')) {
          this.emit('error', modemChecked);
          callback(modemChecked);
          return;
        }
        this.logger.verbose(`initialize - enabling modem verbose mode `);
        await this.execCommand(null, { command: 'AT+CMEE=2', type: 'verbose' });

        this.logger.verbose('initialize - checking if pin is required');
        const pinChecked = (await this.checkPinRequired(null, {})) as ModemResponse<CheckPinStatus>;
        if (!(pinChecked.result === 'success')) {
          // We switch, if !NEED_PIN we can callback and return
          if (!(pinChecked.error?.content.status === InitializeStatus.NEED_PIN) || !this.simConfig.pin) {
            this.emit('error', pinChecked);
            callback(pinChecked);
            return;
          }
          // We will try to unlock the SIM, once, emit an event and throw the hell out of the app if it does not work
          this.logger.verbose('initialize - unlocking SIM');
          const unlocked = (await this.unlockSim(null, { pin: this.simConfig.pin })) as ModemResponse;
          if (!(unlocked.result === 'success')) {
            this.logger.error(`initialize - unable to unlock SIM, ${unlocked.error?.content.message}`);
            this.emit('error', unlocked);
            callback(unlocked);
          }
        }
        // finally, we update the cnmi config
        if (this.simConfig.customCnmi) {
          const updatedConfig = await this.updateCnmiConfig(null, { cnmi: this.simConfig.customCnmi });
          if (!(updatedConfig.result === 'success')) {
            this.logger.error('initialize - unable to upload CNMI config');
            this.emit('error', updatedConfig);
            callback(updatedConfig);
          }
        }
        // And we set the SMS mode to PDU
        this.setSmsMode(null, {});

        // Holy cow
        this.initialized = true;
        this.logger.info(`modem is initialized and ready! ????`);
        this.emit('initialized');
        this.retryNumber = 0;
        this.resetNumber = 0;
        this.checkNetwork(null, {});
      } catch (error) {
        this.logger.error('initialize - unhandled initialization failure');
        callback(null, new Error('unhandled initialization failure'));
        // Trying to reset
        this.retryNumber += 1;
        if (this.retryNumber < 3) this.resetModem(null, { reInitialize: true });
      }
    }
    return;
  };

  /**
   * checkModem can be used to make sure the modem is in a ready state to accept AT commands
   *
   * @param {ModemCallback | null} callback - optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency
   * @param {{}} params - empty object provided for type consistency
   * @returns {Promise<ModemResponse<CheckModemResponse>> | void} A Promise resolving the ModemResponse. If a callback is provided, the function will use the callback instead and return void
   */
  public checkModem: ModemFunction<{}, CheckModemResponse> = async (
    callback: ModemCallback | null,
    params = {},
  ): Promise<any> => {
    if (typeof callback !== 'function') {
      return promisify(this.checkModem, params);
    } else {
      this.logger.verbose(`checkmodem - checking modem connection`);
      try {
        // We define the handler, which will search of an OK end of query
        const handler: JobHandler = (buffer, job, emitter) => {
          sneakyDelivery(buffer, emitter);
          if (isOk(buffer)) {
            this.emit('modemready', true);
            this.logger.debug(`checkmodem - modem online`);
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
          } else if (getError(buffer).isError) {
            this.emit('modemready', false);
            this.logger.error(`checkmodem - modem error`);
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
        this.execCommand(callback, { command: 'AT', type: 'check-modem', handler });
      } catch (error: any) {
        this.logger.error('checkmodem - unhandled modem check failure');
        callback(null, new Error(error || 'unhandled modem check failure'));
      }
    }
  };

  /**
   * A function used to determine the SIM current state
   *
   * @param {ModemCallback | null} callback - optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency
   * @param {{}} params - empty object provided for type consistency
   * @returns {Promise<ModemResponse> | void} A Promise resolving the ModemResponse, containing the current SimStatus. If a callback is provided, the function will use the callback instead and return void
   */
  public checkPinRequired: ModemFunction<{}, CheckPinStatus> = async (
    callback: ModemCallback | null,
    params = {},
  ): Promise<any> => {
    if (typeof callback !== 'function') {
      return promisify(this.checkPinRequired, params);
    } else {
      try {
        this.logger.verbose(`checkpinrequired - checking pin lock status`);
        const handler: JobHandler = (buffer, job) => {
          const parsedBuffer = parseBuffer(buffer);
          this.logger.debug(`checkpinrequired - buffer : ${parsedBuffer}`);
          if (isOk(buffer)) {
            // command has been received, we can intercept the field that starts with +CPIN and extract the
            // status
            const field = parsedBuffer.find((part) => {
              return part.startsWith('+CPIN');
            });
            if (!field || !(field?.split(' ').length > 1)) {
              // can't parse the result, throw an error
              this.logger.error('checkpinrequired - CPIN field parse error');
              job.callback!({
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
            // we get rid of the first split and join the rest
            const keyFields = field.split(' ');
            keyFields.splice(0, 1);
            const key = keyFields.join(' ');
            const status = getInitializationStatus(key);
            this.simUnlocked = status === InitializeStatus.READY;
            this.logger.verbose(`checkpinrequired - result : ${getStatusMessage(status)} `);
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
          if (getError(buffer).isError) {
            this.logger.error(`checkpinrequired - parse error`);
            job.callback!({
              uuid: job.uuid,
              type: job.type,
              result: 'failure',
              error: {
                type: 'checkPinError',
                content: {
                  status: InitializeStatus.ERROR,
                  message: getError(buffer).message,
                },
              },
            });
            job.ended = true;
          }
        };
        this.execCommand(callback, { command: 'AT+CPIN?', type: 'check-pin', handler });
      } catch (error: any) {
        this.logger.error(`checkpinrequired - unhandled pin check failure`);
        callback(null, new Error(error || 'unhandled pin check failure'));
      }
    }
  };

  /**
   * unlockSim does exactly what you think it does
   *
   * @param {ModemCallback | null} callback - optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency
   * @param {{pin: string}} params - an object containing a pin property used to unlock the sim. the pin must be passed as a string
   * @returns {Promise<ModemResponse> | void} A Promise resolving the ModemResponse, containing the result. If a callback is provided, the function will use the callback instead and return void
   */
  public unlockSim: ModemFunction<{ pin: string }> = async (callback: ModemCallback | null, { pin }): Promise<any> => {
    if (typeof callback !== 'function') {
      return promisify(this.unlockSim, { pin });
    } else {
      this.logger.verbose('unlocksim - unlocking SIM');
      const handler: JobHandler = (buffer, job) => {
        const parsedBuffer = parseBuffer(buffer);
        this.logger.debug(`unlocksim - ${parsedBuffer}`);
        if (getError(buffer).isError) {
          // pin is probably wrong, we need to callback
          this.logger.error(`unlocksim - WRONG PIN ! CHECK PIN ASAP`);
          job.callback!({
            uuid: job.uuid,
            type: job.type,
            result: 'failure',
            error: {
              type: 'sim-unlock',
              content: {
                status: InitializeStatus.PIN_INCORRECT,
                message: getError(buffer).message,
              },
            },
          });
        }
        // if not error, it can be "okay", we just log it as we're waiting for the +CPIN info
        if (isOk(buffer)) {
          this.logger.verbose(`unlocksim - PIN accepted, waiting on SIM unlock`);
        }
        // Now, we're looking into the last part of parsedData and search for "+CPIN: "
        if (parsedBuffer.length && parsedBuffer[parsedBuffer.length - 1].startsWith('+CPIN: ')) {
          // we extract the status, it looks a lot like checkpinrequired
          const key = parsedBuffer[parsedBuffer.length - 1].split('+CPIN: ').length
            ? parsedBuffer[parsedBuffer.length - 1].split('+CPIN: ')[1]
            : null;
          const status = key ? getInitializationStatus(key) : InitializeStatus.ERROR;
          this.logger.verbose(`checkpinrequired - result : ${getStatusMessage(status)} `);
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
      this.execCommand(callback, { command: `AT+CPIN=${pin}`, type: 'pin-unlock', handler });
    }
  };

  /**
   * You can call updateCnmiConfig with a custom parameter to change the SMS message indications configuration
   *
   * @param {ModemCallback | null} callback - optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency
   * @param {{cnmi: string}} params - an object containing the cnmi string
   * @returns {Promise<ModemResponse> | void} A Promise resolving the ModemResponse, containing the result. If a callback is provided, the function will use the callback instead and return void
   */
  public updateCnmiConfig: ModemFunction<{ cnmi: string }> = async (callback, { cnmi }): Promise<any> => {
    if (typeof callback !== 'function') {
      return promisify(this.updateCnmiConfig, { cnmi });
    } else {
      this.logger.verbose(`updatecnmiconfig - updating CNMI config with values ${cnmi}`);
      const handler = defaultHandler; // We just need an OK or ERROR, defaultHandler is perfect for that
      this.execCommand(callback, { command: `AT+CNMI=${cnmi}`, type: 'cnmi-config', handler });
    }
  };

  /**
   * resetModem is a function that can save you from a dead-end situation, call it to soft-reset the modem, with the mode configuration you want to reset in (optional)
   * another parameter can be pass to automatically reinitialize the modem afterwards
   *
   * @param {ModemCallback | null} callback - optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency
   * @param {{cnmi: string}} params - empty object provided for type consistency
   * @returns {Promise<ModemResponse> | void} A Promise resolving the ModemResponse, containing the current SimStatus. If a callback is provided, the function will use the callback instead and return void
   */
  public resetModem: ModemFunction<{ mode?: string; reInitialize?: boolean }> = async (
    callback: ModemCallback | undefined | null,
    { mode = '1,1', reInitialize = false },
  ): Promise<any> => {
    if (typeof callback !== 'function') {
      return promisify(this.resetModem, { mode, reInitialize });
    } else {
      // if too many retry, we throw
      if (this.resetNumber > 5) {
        this.logger.error('resetmodem - modem has reset too many times');
        throw new Error('Too many retries');
      }
      //
      this.logger.warn(`resetmodem - modem will reset`);
      const handler: JobHandler = (buffer, job, emitter) => {
        sneakyDelivery(buffer, emitter);
        // Very simple handler, once called, it just sets a timeout of a few seconds resetting the whole object
        setTimeout(() => {
          this.logger.warn(`resetmodem - modem has reset`);
          job.ended = true;
          this.queue = [];
          if (reInitialize) this.initialize(null, {});
          callback({
            uuid: job.uuid,
            type: job.type,
            result: 'success',
          });
        }, 6000);
      };
      // in case we're hanging on a sms query, sending the escape key
      this.execCommand(null, { command: '\r' + String.fromCharCode(27), type: 'reset-sms', immediate: true });
      // calling the reset vector
      this.execCommand(callback, { command: `AT+CFUN=${mode}`, type: 'reset', handler });
      this.logger.warn(`resetmodem - modem is resetting...`);

      this.resetNumber += 1;
      this.initialized = false;
      this.retryNumber = 0;
      this.networkRetry = 0;
      this.brownoutNumber = 0;
      this.networkReady = false;
      this.dataBuffer = '';
    }
  };

  /**
   * A function that returns the current state of network connection
   * WIP : update to return the carrier name and force connect to it if idling
   *
   * @param {ModemCallback | null} callback - optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency
   * @param {{force: boolean}} params - an object containing the -for now- unused force parameter
   * @returns {Promise<ModemResponse> | void} A Promise resolving the ModemResponse, containing the current network status. If a callback is provided, the function will use the callback instead and return void
   */
  public checkNetwork: ModemFunction<{ force?: boolean }> = async (
    callback: ModemCallback | undefined | null,
    { force = false },
  ): Promise<any> => {
    if (typeof callback !== 'function') {
      return promisify(this.checkNetwork, { force });
    } else {
      this.logger.verbose(`checknetwork - getting carrier registration status`);
      const handler: JobHandler = (buffer, job, emitter) => {
        const parsedBuffer = parseBuffer(buffer);
        // Checks if parsedBuffer bears network info
        sneakyDelivery(buffer, emitter);
        if (isOk(buffer)) {
          this.logger.debug(`checknetwork - buffer : ${parsedBuffer}`);
          const part = parsedBuffer.find((value) => value.startsWith('+CREG: '));
          if (!part || part.split('+CREG: ').length < 2) {
            this.logger.error('checknetwork - parse error: +CREG field');
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
            this.logger.error('checknetwork - parse error: +CREG content');
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
          this.logger.verbose(`checknetwork - status: ${networkStatus}`);
          this.emit('networkstatus', {
            networkAction: parseInt(networkAction, 10),
            networkStatus: parseInt(networkStatus, 10),
          });
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
          this.emit('network', {
            networkAction: parseInt(networkAction, 10),
            networkStatus: parseInt(networkStatus, 10),
          });
          job.ended = true;
          return;
        } else if (getError(buffer).isError) {
          this.logger.error('checknetwork - unhandled command error');
          callback({
            uuid: job.uuid,
            type: job.type,
            result: 'failure',
            error: {
              type: 'command',
              content: getError(buffer).message,
            },
          });
          return;
        }
      };
      return this.execCommand(callback, { command: 'AT+CREG?', type: 'check-network', handler });
    }
  };

  /**
   * WIP
   * @returns {void} WIP
   */
  public activateCReg: ModemFunction = async (callback): Promise<any> => {
    // TBD
  };

  /**
   * execCommand is the core function of the SIM800L class, it handles the AT commands, create and queue the jobs.
   *
   * Each job is associated with a handler that will hold the job place in the queue until the incoming data appears satisfactory, errors, or tiemout. By default, the handler will only search for OK, ERROR, or > results,
   * you can provide a better handling of specific commands, just remember to call job.ended = true when you want to stop hanging the queue for incoming data
   *
   * @param {ModemCallback | null} callback - optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency
   * @param {CommandParams} params - an object containing all the parameters for creating the job and handling the response, some are required (command, type).
   * @returns {Promise<ModemResponse> | void} A Promise resolving the ModemResponse, containing the Response. If a callback is provided, the function will use the callback instead and return void
   */
  public execCommand: ModemFunction<CommandParams> = (
    callback,
    { command, type, handler = defaultHandler, immediate = false, subcommands = [], reference, timeout },
  ): any => {
    if (typeof callback !== 'function') {
      return promisify(this.execCommand, { command, type, handler, immediate });
    }
    const uuid = v4();
    this.logger.debug(
      `execcommand - queuing command ${command.length > 15 ? `${command.substring(0, 15)}...` : command} with uuid ${
        uuid.split('-')[0]
      }`,
    );
    // We create a queue item
    const item: JobItem = {
      uuid,
      callback,
      handler,
      command,
      type,
      timeoutIdentifier: null,
      overrideTimeout: timeout,
      ended: false,
      subcommandIndex: 0,
      subcommands,
      reference,
    };
    if (!immediate) {
      this.queue.push(item);
      this.nextEvent();
    } else {
      // current queue item must have ended or not started yet
      this.logger.debug(`execcommand - trying to execute command ${uuid.split('-')[0]} now`);
      this.queue.unshift(item);
      this.nextEvent();
      this.logger.debug(`execcommand - executing command ${uuid.split('-')[0]} instantly`);
    }
    // We cycle nextEvent()
  };

  /**
   * Sets the SMS mode (pass 0 for PDU or 1 to text mode). Please note that the Sms class currently does not support text mode, use at your own discretion
   *
   * @param {ModemCallback | null} callback - optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency
   * @param {{force: boolean}} params - an object containing mode parameter
   * @returns {Promise<ModemResponse> | void} A Promise resolving the ModemResponse, containing the result. If a callback is provided, the function will use the callback instead and return void
   */
  public setSmsMode: ModemFunction<{ mode?: number }> = async (callback, { mode = 0 }): Promise<any> => {
    if (typeof callback !== 'function') {
      return promisify(this.setSmsMode, { mode });
    } else {
      this.logger.verbose(`setsmsmode - setting ${mode === 0 ? 'PDU' : 'TEXT'} mode`);
      this.execCommand(callback, { command: 'AT+CMGF=0', type: 'set-sms-mode' });
    }
  };

  private handleIncomingData = (buffer: any) => {
    this.busy = true;
    const received = buffer.toString() as string;
    this.dataBuffer += received;
    this.logger.debug(`handleincoming - adding ${received.replace(/(\r\n)|[\r\n]{1}/g, ' | ')} to buffer`);
    // if there is a queue, we can call the handler
    if (this.queue.length) {
      // If the job has ended, we need to unshift it before assigning it

      if (this.queue[0].ended) {
        this.logger.debug(`handleincoming - wiping ended event ${this.queue[0].uuid.split('-')[0]}`);
        this.queue.shift();
      }
      const job = this.queue[0];
      this.logger.debug(`handleincoming - calling ${this.queue[0].uuid.split('-')[0]} handler`);
      job.handler(this.dataBuffer, job, this, this.logger);
    } else {
      // This is incoming data, we need to create a job, unshift it and handle the data
      const uuid = v4();
      this.logger.debug(`handleincoming - new data received, creating job ${uuid.split('-')[0]}`);
      const job = {
        uuid,
        handler: this.incomingHandler,
        command: '',
        type: 'incoming',
        timeoutIdentifier: null,
        ended: false,
        subcommandIndex: 0,
      };
      this.queue.unshift(job);
      this.incomingHandler(this.dataBuffer, job, this, this.logger);
    }
    this.busy = false;
    this.nextEvent();
  };
  private nextEvent() {
    this.logger.debug(`nextevent - current queue length: ${this.queue.length}`);
    if (!this.queue.length) {
      return;
    }
    // if the job has ended, we clear it
    const job = this.queue[0];
    if (job && job.ended) {
      this.logger.debug(`nextevent - wiping ended event ${this.queue[0].uuid.split('-')[0]}`);
      this.clear();
      return;
    }
    //
    if (this.busy) {
      this.logger.debug(`nextevent - handler busy, skipping`);
      return;
    }
    this.busy = true;
    // Finding the first item in the queue

    // setting the 10s timeout
    if (!job.timeoutIdentifier) {
      this.logger.debug(`nextevent - now processing event ${job.uuid.split('-')[0]}`);
      // If we're here, this is the first time we process this event
      job.timeoutIdentifier = setTimeout(() => {
        this.cancelEvent(job.uuid);
      }, job.overrideTimeout || 15000);
      if (job.command || job.command.length) {
        this.logger.debug(
          `write - sending command ${job.uuid.split('-')[0]} : ${
            job.command.length > 15 ? `${job.command.substring(0, 15)}...` : job.command
          }`,
        );
        this.port.write(
          `${job.command}${
            job.command.endsWith(String.fromCharCode(26)) || job.command.endsWith(String.fromCharCode(27)) ? '' : '\r'
          }`,
          undefined,
          (err: any) => {
            if (err) {
              this.logger.error(`write - unable to write to port ${this.port.port}`);
              if (job.callback) {
                job.callback(null, err);
              } else {
                // event error
                this.emit('error', err);
              }
            }
          },
        );
      }
    }
    this.busy = false;
  }
  private attachingEvents() {
    this.logger.verbose(`events - attaching serialport events`);
    this.port.on('open', () => {
      this.emit('open');
    });
    this.port.on('data', this.handleIncomingData);
    // this.on('initialized', () => {});
    this.on('network', this.networkInternalHandler);
    this.on('brownout', this.brownoutHandler);
    this.logger.verbose(`events - serialport events attached`);
  }
  private cancelEvent(uuid: string) {
    this.logger.verbose(`timeout - event ${uuid.split('-')[0]} has timed out`);
    this.logger.debug(`timeout - raw buffer at timeout : ${this.dataBuffer.replace(/(\r\n)|[\r\n]{1}/g, ' | ')}`);
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
      this.emit('error', {
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
      this.emit('incoming', {
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
      this.emit('timeout', job);
    }
    this.queue = this.queue.filter((item) => {
      return !(item.uuid === uuid);
    });
    this.dataBuffer = '';
    this.busy = false;
    this.nextEvent();
  }
  private clear() {
    this.logger.debug('clear - clearing buffer');
    if (this.queue.length && this.queue[0].timeoutIdentifier) {
      clearTimeout(this.queue[0].timeoutIdentifier);
    }
    this.busy = false;
    this.dataBuffer = '';
    this.queue.shift();
    this.nextEvent();
  }

  private networkInternalHandler = (network: CheckNetworkData) => {
    this.logger.verbose(`networkhandler - CREG status has changed: ${network.networkStatus}`);
    if (!this.networkMonitorInterval) {
      this.logger.verbose(`networkhandler - setting network monitoring watchdog`);
      this.networkMonitorInterval = this.setupNetworkMonitor();
    }
    if ([ConnectionStatus.REGISTERED, ConnectionStatus.ROAMING].includes(network.networkStatus) && !this.networkReady) {
      this.logger.warn(`networkhandler - network is now ready`);
      this.networkReady = true;
    }
    if (
      ![ConnectionStatus.REGISTERED, ConnectionStatus.IN_PROGRESS, ConnectionStatus.ROAMING].includes(
        network.networkStatus,
      ) &&
      this.networkReady
    ) {
      this.logger.warn(`networkhandler - network lost, status: ${network.networkStatus}`);
      this.logger.verbose(`networkhandler - ${4 - this.networkRetry} checks remaining before modem reset`);
      this.networkReady = false;
      this.networkRetry += 1;
    } else {
      if (this.networkReady) {
        this.logger.debug(`networkhandler - network online`);
        this.networkRetry = 0;
      } else {
        this.logger.warn(`networkhandler - waiting for network, status: ${network.networkStatus}`);
        this.logger.verbose(`networkhandler - ${4 - this.networkRetry} checks remaining before modem reset`);
        this.networkRetry += 1;
      }
    }
    if (this.networkRetry > 3) {
      this.logger.warn(`networkhandler - network is hanging, resetting`);
      this.resetModem(null, { reInitialize: true });
    }
  };

  private brownoutHandler = () => {
    if (this.brownoutNumber > 3) {
      this.resetModem(null, { reInitialize: true });
    }
    this.logger.warn('brownout - modem is unreachable, retrying');
    this.logger.verbose(`brownout - ${4 - this.brownoutNumber} checks remaining before modem reset`);
    this.brownoutNumber += 1;
  };

  // private brownoutHandler = () => {
  //   this.resetModem(undefined, undefined, true);
  // };

  private setupNetworkMonitor() {
    return setInterval(async () => {
      if (this.initialized) {
        // preventing to clutter the networkRetry when modem isn't initialized
        this.checkNetwork(null, {});
      }
    }, 60000);
  }
  private brownoutDetector() {
    return setInterval(async () => {
      const result = await this.checkModem(null, {});
      if ((result as ModemResponse).result === 'failure' || !this.initialized) {
        this.emit('brownout');
      } else {
        this.brownoutNumber = 0;
      }
    }, 20000);
  }

  private spooler() {
    return setInterval(() => {
      if (this.isNetworkReady && this.isInitialized) {
        // if there is something inside the inbox, we check the first element
        if (this.outbox.length) {
          const sms = this.outbox[0];
          if (sms.sendFlag && sms.status === SmsStatus.IDLE) {
            sms.sendFlag = false;
            sms.send();
          } else if (sms.status === SmsStatus.SENT || SmsStatus.DELIVERED) {
            spliceFromSpooler(sms.id, this.outbox);
          } else if (!sms.sendFlag && sms.status === SmsStatus.IDLE) {
            // We push it at the end of the line
            this.outbox.push(this.outbox.shift()!);
          }
        }
      }
    }, 500);
  }

  // Internal Incoming Handlers (those who need access to the sim)

  private incomingHandler: JobHandler = async (buffer, job, emitter, logger) => {
    try {
      logger?.verbose(`incominghandler - handling incoming data`);
      const parsedData = parseBuffer(buffer);
      // Incoming handler when there is no queue, taking care of emitting events (eg: sms... delivery report...)
      // There are no callbacks for the incomingHanlder as it is initiated by the server itself, but it emits events
      sneakyDelivery(buffer, emitter);
      if (isNetworkReadyIncomingBuffer(parsedData)) {
        logger?.debug(`incominghandler - +CREG network ready, updating`);
        if (emitter) {
          emitter.emit('network', { networkStatus: ConnectionStatus.REGISTERED });
        }
        // MISSING CALLBACKS
        job.ended = true;
      }
      if (isNewSms(parsedData)) {
        logger?.debug(`incominghandler - +CMTI new sms, handling`);
        // console.log(parsedData);
        job.ended = true;
      }
      if (isDeliveryReport(parsedData)) {
        // If CDS key is not the last key of the buffer, we can emit a DeliveryReportRawObject and end the job
        const cdsIndex = parsedData.findIndex((key) => {
          return key.startsWith('+CDS: ');
        });
        if (parsedData.length > cdsIndex + 1 && buffer.endsWith('\r\n')) {
          this.emit('deliveryreport', {
            shortId: parseInt(parsedData[cdsIndex].replace('+CDS: ', ''), 10),
            data: parsedData[cdsIndex + 1],
          } as DeliveryReportRawObject);
          job.ended = true;
        }
      }
      if (isNetworkInfo(parsedData)) {
        logger?.debug('incominghandler - +CREG information, checking status');
        this.checkNetwork(null, {});
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

export const promisify: PromisifyFunctionSignature = <T>(
  functionSignature: ModemFunction<T>,
  options: T,
): Promise<ModemResponse> => {
  return new Promise((resolve, reject) => {
    functionSignature((result, err) => {
      if (err) {
        reject(err);
      } else if (result) {
        resolve(result);
      }
    }, options);
  });
};

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

/**
 * Parses the raw buffer input and returns a filtered array
 *
 * @param {string} buffer - the raw buffer input
 * @returns {string[]} A filtered array of strings representing the individual buffer lines
 */
export function parseBuffer(buffer: string): string[] {
  return buffer.split(/[\r\n]{1,2}/).filter((value) => {
    return !/^[\r\n]{1,2}$/.test(value) && value.length;
  });
}
/**
 * Parsing the buffer to tell if the command has been properly executed
 *
 * @param {string} buffer - the raw buffer input
 * @returns {boolean} A boolean describing if the command has been properly executed
 */
export function isOk(buffer: string): boolean {
  const parsedData = parseBuffer(buffer);
  const okField = parsedData.length ? parsedData[parsedData.length - 1] === 'OK' : false;
  const bufferComplete = buffer.endsWith('\r\n');
  return okField && bufferComplete;
}

/**
 * Catches the ">" character indicating that the modem waits for an input
 *
 * @param {ParsedData} parsedData - the parsed buffer input
 * @returns {boolean} A boolean describing if the modem is waiting for an input
 */
export function isWaitingForInput(parsedData: ParsedData): boolean {
  return parsedData.length ? parsedData[parsedData.length - 1] === '> ' : false;
}

/**
 * Intercepts the known error reporting patterns of the SIM800L, it also tries to get a formatted message describing the error
 *
 * @param {string} buffer - the raw buffer input
 * @returns {ModemErrorRaw} The response object containing an isError boolean and the result
 */
export function getError(buffer: string): ModemErrorRaw {
  const parsedData = parseBuffer(buffer);
  const bufferComplete = buffer.endsWith('\r\n');
  const field =
    parsedData.length && parsedData[parsedData.length - 1] ? parsedData[parsedData.length - 1].split(' ERROR: ') : null;
  // If buffer is complete, in case we haven't received all the line after a +Cxx error (this happens, thanks UART)
  if (bufferComplete) {
    if (field && field.length > 1 && field[0].startsWith('+C')) {
      // extracting message
      field.splice(0, 1);
      const message = field.length ? field.join(' ') : undefined;
      return { isError: true, raw: parsedData, ...{ message } };
    } else if (parsedData && parsedData.length) {
      return parsedData[parsedData.length - 1] === 'ERROR'
        ? { isError: true, message: `${parsedData.join(' - ')}`, raw: parsedData }
        : { isError: false };
    } else {
      return { isError: false };
    }
  } else {
    return { isError: false };
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

function isDeliveryReport(parsedData: ParsedData) {
  return findKey(parsedData, '+CDS: ');
}
export function sneakyDelivery(buffer: string, emitter: EventEmitter) {
  const parsedData = parseBuffer(buffer);
  if (isDeliveryReport(parsedData)) {
    // If CDS key is not the last key of the buffer, we can emit a DeliveryReportRawObject and end the job
    const cdsIndex = parsedData.findIndex((key) => {
      return key.startsWith('+CDS: ');
    });
    if (parsedData.length > cdsIndex + 1 && buffer.endsWith('\r\n')) {
      emitter.emit('deliveryreport', {
        shortId: parseInt(parsedData[cdsIndex].replace('+CDS: ', ''), 10),
        data: parsedData[cdsIndex + 1],
      } as DeliveryReportRawObject);
    }
  }
}
function spliceFromSpooler(id: string, spooler: Sms[]) {
  const index = spooler.findIndex((sms) => {
    return sms.id === id;
  });
  if (index > -1) {
    spooler.splice(index, 1);
  }
}
//  ___  ___  ________  ________   ________  ___       _______   ________  ________
// |\  \|\  \|\   __  \|\   ___  \|\   ___ \|\  \     |\  ___ \ |\   __  \|\   ____\
// \ \  \\\  \ \  \|\  \ \  \\ \  \ \  \_|\ \ \  \    \ \   __/|\ \  \|\  \ \  \___|_
//  \ \   __  \ \   __  \ \  \\ \  \ \  \ \\ \ \  \    \ \  \_|/_\ \   _  _\ \_____  \
//   \ \  \ \  \ \  \ \  \ \  \\ \  \ \  \_\\ \ \  \____\ \  \_|\ \ \  \\  \\|____|\  \
//    \ \__\ \__\ \__\ \__\ \__\\ \__\ \_______\ \_______\ \_______\ \__\\ _\ ____\_\  \
//     \|__|\|__|\|__|\|__|\|__| \|__|\|_______|\|_______|\|_______|\|__|\|__|\_________\
//                                                                           \|_________|

const defaultHandler: JobHandler = (buffer, job, emitter, logger?): void => {
  try {
    sneakyDelivery(buffer, emitter);
    logger?.verbose(`defaulthandler - using default handler`);
    const parsedData = parseBuffer(buffer);
    logger?.debug(`defaulthandler - buffer : ${parsedData}`);
    // If it ends with okay, resolve
    if (isOk(buffer)) {
      logger?.debug('defaulthandler - data OK');
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
    if (getError(buffer).isError) {
      logger?.error('defaulthandler - data ERROR');
      if (job.callback) {
        job.callback({
          uuid: job.uuid,
          type: job.type,
          result: 'failure',
          error: {
            type: 'generic',
            content: {
              status: QueryStatus.ERROR,
              message: getError(buffer).message,
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

export default Sim800L;

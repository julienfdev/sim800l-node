import { EventEmitter } from 'stream';
import Sim800L, { getError, isOk, isWaitingForInput, parseBuffer, promisify } from '..';
import {
  DeliveryReportRawObject,
  NumberType,
  SmsCreationOptions,
  SmsEncoding,
  SmsPduChunk,
  SmsPduData,
  SmsStatus,
} from './types/Sms';
import { pduMessage, PDUParser } from 'pdu.ts';
import { v4 } from 'uuid';
import { JobHandler } from './types/JobHandler';
import Logger from './types/Logger';
import { ModemFunction } from './types/ModemCallback';
import ModemResponse from './types/ModemResponse';

export class Sms extends EventEmitter {
  private _id = v4();
  private _smsc?;
  private _smscType: NumberType = NumberType.INTERNATIONAL;
  private _receiver: string;
  private _receiverType: NumberType = NumberType.INTERNATIONAL;
  private _encoding: SmsEncoding = '16bit';
  private _text: string;
  private _requestDeliveryReport: boolean = true;
  private _autoSend = false;
  private _data: SmsPduChunk[] = [];
  private _modem: Sim800L;
  private _shortRef = '';
  private logger: Logger;

  // Getters TBD

  // Getters TBD

  /**
   * Creates an instance of the Sms class. the Sms is an object abstracting the logic required to handle and send SMS in PDU mode
   * As it's designed to work with a Sim800L modem, an instance of Sim800L must be provided, you can also use the createSms() method from the Sim800L instance directly
   *
   * @param {string} receipient - The receipient number (international format preffered)
   * @param {string} text - The content of the message
   * @param {SmsCreationOptions} [options={}] - an object containing various options like delivery report activation, custom smsc, number format...
   * @param {Sim800L} modem - an instance of Sim800L which will send the Sms
   */
  constructor(receipient: string, text: string, options: SmsCreationOptions = {}, modem: Sim800L) {
    super();
    this._receiver = receipient;
    this._text = text;
    if (options) {
      this._smscType = options.numberFormat || this._smscType;
      this._receiverType = options.numberFormat || this._receiverType;
      this._encoding = options.encoding || this._encoding;
      this._requestDeliveryReport = options.deliveryReport || this._requestDeliveryReport;
      this._smsc = options.smsc;
      this._autoSend = options.autoSend || this._autoSend;
      this._id = options.customId || this._id;
    }
    this._modem = modem;
    this.logger = this._modem.logger;
    this.prepare();
    // If we need a report, we need to subscribe to the deliveryreport event of our modem
    this._modem.on('deliveryreport', this.deliveryReportHandler);
  }
  // When updating text (if IDLE), updating PDU... getter/setter on text
  // Set number type

  // Send (takes a Sim800L instance)
  private prepare = () => {
    try {
      // Preparing SMS
      this.logger.verbose('smscreate - generating pdu data');

      // HANDLE NUMBER FORMATTING WIP (would be cool to add locales option)
      this._receiver = this._receiver.replace(/[.\s-+]/g, '');
      // HANDLE NUMBER FORMATTING

      const parsed = this.gerneratePduData({
        smsc: this._smsc!,
        smsc_type: this._smscType,
        encoding: this._encoding,
        receiver: this._receiver,
        receiver_type: this._receiverType,
        request_status: this._requestDeliveryReport,
        text: this._text,
      });
      this._data = parsed.map((data) => {
        return {
          id: v4(),
          shortId: 0,
          data,
          status: SmsStatus.IDLE,
        };
      });
      if (this._autoSend) {
        this.logger.verbose('smscreate - autosend set, queuing the SMS');
        this.send();
      }
    } catch (error: any) {
      this.logger.error(`smscreate - unable to prepare the SMS: ${error}`);
      throw error instanceof Error ? error : new Error(error);
    }
  };


  /**
   * Sending the Sms (each part if multipart). uses an handler that updates the sms status property.
   * 
   * If using the deliveryReport property, the Sms will also listen and handle deliveryreport Events emitted by the Modem
   *
   */
  public send = async (): Promise<void> => {
    for (const part of this._data) {
      this.logger.debug(`smssend - queuing part ${part.id.split('-')[0]} of SMS ${this._id.split('-')[0]}`);
      part.status = SmsStatus.SENDING;
      this.sendPart(null, { part })
        .then((data: ModemResponse | void) => {
          // TBD if needed

        })
        .catch((error: any) => {
          throw error instanceof Error ? error : new Error(error);
        });
    }
  };

  private gerneratePduData = (data: pduMessage) => {
    const parser = PDUParser;
    return parser.Generate(data) as unknown[] as SmsPduData[];
  };

  private sendPart: ModemFunction<{ part: SmsPduChunk }> = async (callback, { part }): Promise<any> => {
    if (typeof callback !== 'function') {
      return promisify(this.sendPart, { part });
    } else {
      this._modem.execCommand(callback, {
        command: `AT+CMGS=${part.data.tpdu_length}`,
        type: 'sms-send',
        handler: this.smsHandler,
        timeout: 20000,
        subcommands: [`${part.data.smsc_tpdu}${String.fromCharCode(26)}`],
        reference: part.id,
      });
    }
  };

  private smsHandler: JobHandler = (buffer, job) => {
    // Handle
    this.logger.verbose(`smshandler - using SMS handler`);
    const parsed = parseBuffer(buffer);
    this.logger.debug(`smshandler - buffer: ${parsed}`);
    if (isWaitingForInput(parsed)) {
      // we make sure we've got a subcommand to write, if not we write error
      this.logger.debug(`smshandler - handler is waiting for input, sending subcommand`);
      this._modem.port.write(`${job.subcommands?.length ? job.subcommands[0] : `ERROR\r`}`);
    }
    if (isOk(buffer)) {
      this.logger.verbose(`smshandler - PDU part ${job.reference} sent`);
      // callback success
      job.callback!({
        uuid: job.uuid,
        type: 'sms-sent',
        result: 'success',
        data: {
          raw: parsed,
          processed: 'debug',
        },
      });
      job.ended = true;
      // if we've got a reference, we can find and update the status of the part, and its shortId
      const referenceChunk = parsed.find((chunk) => {
        return chunk.includes('+CMGS: ');
      });
      if (job.reference) {
        const part = this._data.find((chunk) => {
          return job.reference === chunk.id;
        });
        if (part) {
          part.status = SmsStatus.SENT;
          part.shortId = referenceChunk ? parseInt(referenceChunk?.replace('+CMGS: ', ''), 10) : 0;
        }
      }
    }
    if (getError(parsed).isError) {
      // callback failure
      // callback success
      this.logger.verbose(`smshandler - PDU part ${job.reference} couldn't be send`);
      job.callback!({
        uuid: job.uuid,
        type: 'sms-sent',
        result: 'failure',
        error: {
          content: getError(parsed).message,
          type: 'unknown',
        },
      });
      job.ended = true;
      // if we've got a reference, we can find and update the status of the part
      if (job.reference) {
        const part = this._data.find((chunk) => {
          return job.reference === chunk.id;
        });
        if (part) part.status = SmsStatus.ERROR;
      }
    }
  };
  private deliveryReportHandler = async (delivery: DeliveryReportRawObject) => {
    // parsing the data
    try {
      const parser = PDUParser.Parse(delivery.data);
      if (parser && parser.reference && !isNaN(parser.reference) && parser.tpdu_type === 'SMS-STATUS-REPORT') {
        // let's see if we've got a part with this shortId
        const part = this._data.find((chunk) => {
          return chunk.shortId === parser.reference;
        });
        if (part) {
          part.status = SmsStatus.DELIVERED;
        }
        this._modem.execCommand(null, { command: `AT+CMGD=${parser.reference}`, type: 'delete-delivery' });
      }
    } catch (error) {
      this.logger.error(`Ïdeliveryhandler - parse error ${error}`);
    }
  };
}

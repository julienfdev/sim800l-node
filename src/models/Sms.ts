import { EventEmitter } from 'stream';
import Sim800L, { isError, isOk, isWaitingForInput, parseBuffer, promisify } from '..';
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
import { JobHandler, ParsedData } from './types/JobHandler';
import Logger from './types/Logger';
import { ModemCallback } from './types/ModemCallback';
import ModemResponse from './types/ModemResponse';

export class Sms extends EventEmitter {
  //
  // MAKE PRIVATE AND WRITE GETTERS AFTER DEBUG
  _id = v4();
  _smsc?;
  _smscType: NumberType = NumberType.INTERNATIONAL;
  _receiver: string;
  _receiverType: NumberType = NumberType.INTERNATIONAL;
  _encoding: SmsEncoding = '16bit';
  _text: string;
  _requestDeliveryReport: boolean = true;
  _autoSend = false;
  _data: SmsPduChunk[] = [];
  _modem: Sim800L;
  _shortRef = '';

  private logger: Logger;
  // MAKE PRIVATE AFTER DEBUG
  // Get events

  // Get Events

  constructor(number: string, text: string, options = {} as SmsCreationOptions, modem: Sim800L) {
    super();
    this._receiver = number;
    this._text = text;
    if (options) {
      this._smscType = options.numberFormat || this._smscType;
      this._receiverType = options.numberFormat || this._receiverType;
      this._encoding = options.encoding || this._encoding;
      this._requestDeliveryReport = options.deliveryReport || this._requestDeliveryReport;
      this._smsc = options.smsc;
      this._autoSend = options.autoSend || this._autoSend;
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

  public send = async () => {
    try {
      for (const part of this._data) {
        this.logger.debug(`smssend - queuing part ${part.id.split('-')[0]} of SMS ${this._id.split('-')[0]}`);
        part.status = SmsStatus.SENDING;
        this.sendPart(null, part).then((data: ModemResponse | void) => {});
      }
    } catch (error: any) {
      throw error instanceof Error ? error : new Error(error);
    }
  };

  private gerneratePduData = (data: pduMessage) => {
    const parser = PDUParser;
    return parser.Generate(data) as unknown[] as SmsPduData[];
  };

  private sendPart = async (callback: null | undefined | ModemCallback, part: SmsPduChunk) => {
    if (typeof callback !== 'function') {
      return promisify(this.sendPart, part);
    } else {
      return await this._modem.execCommand(
        callback,
        `AT+CMGS=${part.data.tpdu_length}`,
        'sms-send',
        this.smsHandler,
        false,
        20000,
        [`${part.data.smsc_tpdu}${String.fromCharCode(26)}`],
        part.id,
      );
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
    if (isOk(parsed)) {
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
          return job.reference == chunk.id;
        });
        if (part) {
          part.status = SmsStatus.SENT;
          part.shortId = referenceChunk ? parseInt(referenceChunk?.replace('+CMGS: ', '')) : 0;
        }
      }
    }
    if (isError(parsed).error) {
      // callback failure
      // callback success
      this.logger.verbose(`smshandler - PDU part ${job.reference} couldn't be send`);
      job.callback!({
        uuid: job.uuid,
        type: 'sms-sent',
        result: 'failure',
        error: {
          content: isError(parsed).message,
          type: 'unknown',
        },
      });
      job.ended = true;
      // if we've got a reference, we can find and update the status of the part
      if (job.reference) {
        const part = this._data.find((chunk) => {
          return job.reference == chunk.id;
        });
        if (part) part.status = SmsStatus.ERROR;
      }
    }
  };
  private deliveryReportHandler = async (delivery: DeliveryReportRawObject) => {
    // parsing the data
    try {
      const parser = PDUParser.Parse(delivery.data);
      if (parser && parser.reference && !isNaN(parser.reference) && parser.tpdu_type == 'SMS-STATUS-REPORT') {
        // let's see if we've got a part with this shortId
        const part = this._data.find((chunk) => {
          return chunk.shortId === parser.reference;
        });
        if (part) {
          part.status = SmsStatus.SENT;
        }
        this._modem.execCommand(undefined, `AT+CMGD=${parser.reference}`, 'delete-delivery');
      }
    } catch (error) {
      this.logger.error(`Ïdeliveryhandler - parse error ${error}`);
    }
  };
}

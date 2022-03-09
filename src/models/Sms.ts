import { EventEmitter } from 'stream';
import Sim800L from '..';
import { NumberType, SmsCreationOptions, SmsEncoding, SmsPduChunk } from './types/Sms';

export class Sms extends EventEmitter {
  // SMS TO SEND
  private _smsc?: string;
  private _smscType: NumberType = NumberType.INTERNATIONAL;
  private _receiver: string;
  private _receiverType: NumberType = NumberType.INTERNATIONAL;
  private _encoding: SmsEncoding = '16bit';
  private _text: string;
  private _requestDeliveryReport: boolean = true;
  private _autoSend = false;
  private _parts = 0;
  private _data: SmsPduChunk[] = [];
  private _modem: Sim800L;

  // Get events

  constructor(number: string, text: string, options = {} as SmsCreationOptions, modem: Sim800L) {
    super();
    this._receiver = number;
    this._text = text;
    if (options) {
      this._smscType = options.numberFormat || this._smscType;
      this._receiverType = options.numberFormat || this._receiverType;
      this._encoding = options.encoding || this._encoding;
      this._requestDeliveryReport = options.deliveryReport || this._requestDeliveryReport;
      this._smsc = options.smsc || this._smsc;
      this._autoSend = options.autoSend || this._autoSend;
    }
    this._modem = modem;
    // PDU logic
  }
  // When updating text (if IDLE), updating PDU... getter/setter on text
  // Set number type

  // Send (takes a Sim800L instance)
}

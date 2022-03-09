import { NumberType, SmsCreationOptions, SmsEncoding, SmsPduChunk } from './types/Sms';

export class Sms {
  // SMS TO SEND
  private _smsc?: string;
  private _smscType: NumberType = NumberType.INTERNATIONAL;
  private _receiver: string;
  private _receiverType: NumberType = NumberType.INTERNATIONAL;
  private _encoding: SmsEncoding = '16bit';
  private _text: string;
  private _requestDeliveryReport: boolean = true;
  private _parts = 0;
  private _data: SmsPduChunk[] = [];

  constructor(number: string, text: string, options?: SmsCreationOptions) {
    this._receiver = number;
    this._text = text;
    if (options) {
      this._smscType = options.numberFormat || this._smscType;
      this._receiverType = options.numberFormat || this._receiverType;
      this._encoding = options.encoding || this._encoding;
      this._requestDeliveryReport = options.deliveryReport || this._requestDeliveryReport;
      this._smsc = options.smsc;
    }

    // PDU logic
  }
  // When updating text (if IDLE), updating PDU... getter/setter on text
  // Set number type

  // Send (takes a Sim800L instance)
}
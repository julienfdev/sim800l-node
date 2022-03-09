export enum NumberType {
  INTERNATIONAL = 91,
  UNKNOWN = 81,
}
export enum SmsStatus {
  IDLE,
  SENDING,
  SENT,
  ERROR,
  UNKNOWN,
}

export type SmsEncoding = '16bit' | '8bit' | '7bit';
export type SmsPduChunk = {
  // ID or something maybe ?
  id: string;
  shortId: number;
  data: SmsPduData;
  status: SmsStatus;
};

export interface SmsCreationOptions {
  numberFormat?: NumberType;
  smsc?: string;
  encoding?: SmsEncoding;
  deliveryReport?: boolean;
  autoSend?: boolean;
}
export interface SmsPduData {
  tpdu_length: number;
  smsc_tpdu: string;
}

export type DeliveryReportRawObject = {
  shortId: number;
  data: string;
};

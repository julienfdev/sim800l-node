export enum NumberType {
  INTERNATIONAL = 91,
  UNKNOWN = 81,
}
export enum SmsStatus {
  IDLE,
  SENDING,
  SENT,
  DELIVERED,
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
  customId?: string;
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

export type SmsStatusChangeEvent = {
  part: string;
  sms: string;
  partStatus: SmsStatus;
  smsStatus: SmsStatus;
  message?: string
};

export type SmsErrorEvent = {
  part: string;
  sms: string;
  error: string;
  errorStatus?: string | number;
};

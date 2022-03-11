export interface ModemResponse<SuccessType = any, ErrorType = any> {
  uuid: string;
  type: string;
  result: 'success' | 'failure';
  data?: {
    raw: string | string[];
    processed: SuccessType;
  };
  error?: {
    type: string;
    content: ErrorType;
  };
}
export default ModemResponse;

export enum InitializeStatus {
  READY,
  NEED_PIN,
  PIN_INCORRECT,
  NEED_PUK,
  ERROR,
}
export enum ConnectionAction {
  DISABLE_REGISTRATION,
  ENABLE_REGISTRATION,
  ENABLE_FULL,
}
export enum ConnectionStatus {
  NOT_REGISTERED_IDLE,
  REGISTERED,
  IN_PROGRESS,
  DENIED,
  UNKNOWN,
  ROAMING,
}
export enum QueryStatus {
  OK,
  ERROR,
}

export type InitializeResponse = {
  status: InitializeStatus | QueryStatus;
  message: string;
};

export type CheckModemResponse = {
  status: QueryStatus;
  message: string;
};

export type CheckPinStatus = {
  status: InitializeStatus;
  message: string;
};
export type CheckNetworkData = {
  networkAction: number;
  networkStatus: ConnectionStatus;
};

export type ModemErrorRaw = {
  isError: boolean;
  message?: string;
  raw?: string | string[];
};

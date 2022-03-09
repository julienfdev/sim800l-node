import ModemResponse from './ModemResponse';

export type ModemCallback<T = any, R = any> = (result: ModemResponse<T, R> | null, err?: Error) => void;

export type DefaultFunctionSignature = (callback: ModemCallback, ...args: any[]) => any;

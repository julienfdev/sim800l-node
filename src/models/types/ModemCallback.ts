import { JobHandler } from './JobHandler';
import ModemResponse from './ModemResponse';

export type ModemCallback<SuccessType = any, ErrorType = any> = (
  result: ModemResponse<SuccessType, ErrorType> | null,
  err?: Error,
) => void;

// export type DefaultFunctionSignature = (callback: ModemCallback, ...args: any[]) => any;

export type ModemFunction<Params = any, SuccessType = any, ErrorType = any> = {
  (callback: null, params: Params): Promise<ModemResponse<SuccessType, ErrorType>>;
  (callback: ModemCallback<SuccessType, ErrorType>, params: Params): void;
};

export type PromisifyFunctionSignature = <Options = any, SuccessType = any, ErrorType = any>(
  functionSignature: ModemFunction<Options>,
  options: Options,
) => Promise<ModemResponse<SuccessType, ErrorType>>;

export type CommandParams = {
  command: string;
  type: string;
  handler?: JobHandler;
  immediate?: boolean;
  subcommands?: string[];
  reference?: string;
  timeout?: number;
};

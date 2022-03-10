import { SerialPort } from "serialport";

export type Flatten<T> = T extends (infer Z)[] ? Z : T;
export type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
export type GetReturnType<Type> = Type extends () => infer Return ? Return : never;



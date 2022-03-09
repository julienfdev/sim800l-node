export default interface Logger {
  error: (...any: any) => any;
  warn: (...any: any) => any;
  info: (...any: any) => any;
  verbose: (...any: any) => any;
  debug: (...any: any) => any;
}

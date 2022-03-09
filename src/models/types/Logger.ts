export default interface Logger {
  error: (...args: any) => any;
  warn: (...args: any) => any;
  info: (...args: any) => any;
  verbose: (...args: any) => any;
  debug: (...args: any) => any;
}

export default interface SimConfig {
  customCnmi?: string;
  deliveryReport?: boolean;
  autoDeleteFromSim?: boolean;
  pin?: string;
  smsc?: string;
  logger?: Console;
}

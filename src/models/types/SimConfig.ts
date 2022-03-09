import Logger from "./Logger";

export default interface SimConfig {
  customCnmi?: string;
  deliveryReport?: boolean;
  autoDeleteFromSim?: boolean;
  pin?: string;
  smsc?: string;
  logger?: Logger;
}

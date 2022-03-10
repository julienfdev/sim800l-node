# Sim800l-node
SIM800L-node is a modern TypeScript package providing an asynchronous serial interface for SIM800L type GSM modems.
It features a SIM800L Class shielding the user from tedious AT commands configuration and management and implementing a basic FI/FO job queue.
It also exposes an interface to plug your own logger in
An object oriented SMS class provides an abstraction layer for the messaging related logic, eg : multipart formatting, PDU encoding / parsing, and Delivery reports handling
Due to the asynchronous and unpredictable nature of UART + GSM communication, the package also make a good use of Events.

## Roadmap
This project is under active development, and new features will be added on the fly.
### What's working atm
- Core initialization from cold boot to ready-state
- AT commands queuing and execution
- Network state monitoring and anti-brownout watchdog
- SMS jobs creation and execution
- Delivery reports

### What's next
- An extensive documentation
- SMS object configuration
- Network methods (Network selection, listing, configuration...)
- SMS Inbox
## Documentation

### Hardware
TBD

### Installation
TBD

### Usage
TBD

### API
TBD

### Events
TBD
### More advanced concepts
TBD

### Contribution
TBD
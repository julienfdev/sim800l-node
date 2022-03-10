# Sim800l-node
SIM800L-node is a modern TypeScript package providing an asynchronous serial interface for SIM800L type GSM modems.

It features a SIM800L Class shielding the user from tedious AT commands configuration and management and implementing a basic FI/FO job queue; it also exposes an interface to plug your own logger in.

An object oriented SMS class provides an abstraction layer for the messaging related logic, eg : multipart formatting, PDU encoding / parsing, and Delivery reports handling.

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

## Hardware
TBD

## Installation
TBD

## Usage
TBD

## API

### Table of Contents
**Exported Functions**
<dl>
<dt><a href="#parseBuffer">parseBuffer(buffer: string)</a> ⇒ <code>Array.&lt;string&gt;</code></dt>
<dd><p>Parses the raw buffer input and returns a filtered array</p>
</dd>
<dt><a href="#isOk">isOk(buffer: string)</a> ⇒ <code>boolean</code></dt>
<dd><p>Parsing the buffer to tell if the command has been properly executed</p>
</dd>
<dt><a href="#isWaitingForInput">isWaitingForInput(parsedData: ParsedData)</a> ⇒ <code>boolean</code></dt>
<dd><p>Catches the &quot;&gt;&quot; character indicating that the modem waits for an input</p>
</dd>
<dt><a href="#getError">getError(parsedData: ParsedData)</a> ⇒ <code>ModemErrorRaw</code></dt>
<dd><p>Intercepts the known error reporting patterns of the SIM800L, it also tries to get a formatted message describing the error</p>
</dd>
</dl>

**Class**

- [Sim800l-node](#sim800l-node)
  - [Roadmap](#roadmap)
    - [What's working atm](#whats-working-atm)
    - [What's next](#whats-next)
  - [Hardware](#hardware)
  - [Installation](#installation)
  - [Usage](#usage)
  - [API](#api)
    - [Table of Contents](#table-of-contents)
    - [Details](#details)
    - [new Sim800L(options, simConfig)](#new-sim800loptions-simconfig)
    - [sim800L.createSms(receipient, text, [options]) ⇒ <code>Sms</code>](#sim800lcreatesmsreceipient-text-options--sms)
    - [sim800L.initialize(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>](#sim800linitializecallback-params--promisemodemresponse--void)
    - [sim800L.checkModem(callback, params) ⇒ <code>Promise.&lt;ModemResponse.&lt;CheckModemResponse&gt;&gt;</code> \| <code>void</code>](#sim800lcheckmodemcallback-params--promisemodemresponsecheckmodemresponse--void)
    - [sim800L.checkPinRequired(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>](#sim800lcheckpinrequiredcallback-params--promisemodemresponse--void)
    - [sim800L.unlockSim(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>](#sim800lunlocksimcallback-params--promisemodemresponse--void)
    - [sim800L.updateCnmiConfig(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>](#sim800lupdatecnmiconfigcallback-params--promisemodemresponse--void)
    - [sim800L.resetModem(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>](#sim800lresetmodemcallback-params--promisemodemresponse--void)
    - [sim800L.checkNetwork(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>](#sim800lchecknetworkcallback-params--promisemodemresponse--void)
    - [sim800L.activateCReg() ⇒ <code>void</code>](#sim800lactivatecreg--void)
    - [sim800L.execCommand(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>](#sim800lexeccommandcallback-params--promisemodemresponse--void)
    - [sim800L.setSmsMode(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>](#sim800lsetsmsmodecallback-params--promisemodemresponse--void)
    - [sim800L.close() ⇒](#sim800lclose-)
    - [Sim800L.list() ⇒ <code>Array.&lt;PromisePortInfo&gt;</code>](#sim800llist--arraypromiseportinfo)
  - [\_\_awaiter](#__awaiter)
  - [parseBuffer(buffer) ⇒ <code>Array.&lt;string&gt;</code>](#parsebufferbuffer--arraystring)
  - [isOk(buffer) ⇒ <code>boolean</code>](#isokbuffer--boolean)
  - [isWaitingForInput(parsedData) ⇒ <code>boolean</code>](#iswaitingforinputparseddata--boolean)
  - [getError(parsedData) ⇒ <code>ModemErrorRaw</code>](#geterrorparseddata--modemerrorraw)
    - [Events](#events)
    - [More advanced concepts](#more-advanced-concepts)
    - [Contribution](#contribution)

### Details


<a name="new_Sim800L_new"></a>

### new Sim800L(options, simConfig)
Returns an object abstracting a SIM800L family serial modem.


| Param     | Type                               | Description                                            |
| --------- | ---------------------------------- | ------------------------------------------------------ |
| options   | <code>SerialPortOpenOptions</code> | The options you provide to the "serialport" dependency |
| simConfig | <code>SimConfig</code>             | The additional                                         |

<a name="Sim800L+createSms"></a>

### sim800L.createSms(receipient, text, [options]) ⇒ <code>Sms</code>
A function creating an Sms attached to this particular Sim800L instance

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Sms</code> - An instance of the Sms class  

| Param      | Type                            | Default         | Description                                                                            |
| ---------- | ------------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| receipient | <code>string</code>             |                 | The number you want to send your sms to (international format by default)              |
| text       | <code>string</code>             |                 | The content of your SMS (UTF-8 recommended)                                            |
| [options]  | <code>SmsCreationOptions</code> | <code>{}</code> | You can specify various parameters like a special smsc or delivery reports activation. |

<a name="Sim800L+initialize"></a>

### sim800L.initialize(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>
Initialization routine for the modem. Can be called after cold-boot.
The function checks if the modem is online, enables verbose mode, checks if pin is required, unlock the sim and updates the config of the modem

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code> - A Promise resolving the ModemResponse. If a callback is provided, the function will use the callback instead and return void  

| Param    | Type                                            | Description                                                                                                               |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| callback | <code>ModemCallback</code> \| <code>null</code> | optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency |
| params   | <code>Object</code>                             | empty object provided for type consistency                                                                                |

<a name="Sim800L+checkModem"></a>

### sim800L.checkModem(callback, params) ⇒ <code>Promise.&lt;ModemResponse.&lt;CheckModemResponse&gt;&gt;</code> \| <code>void</code>
checkModem can be used to make sure the modem is in a ready state to accept AT commands

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Promise.&lt;ModemResponse.&lt;CheckModemResponse&gt;&gt;</code> \| <code>void</code> - A Promise resolving the ModemResponse. If a callback is provided, the function will use the callback instead and return void  

| Param    | Type                                            | Description                                                                                                               |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| callback | <code>ModemCallback</code> \| <code>null</code> | optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency |
| params   | <code>Object</code>                             | empty object provided for type consistency                                                                                |

<a name="Sim800L+checkPinRequired"></a>

### sim800L.checkPinRequired(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>
A function used to determine the SIM current state

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code> - A Promise resolving the ModemResponse, containing the current SimStatus. If a callback is provided, the function will use the callback instead and return void  

| Param    | Type                                            | Description                                                                                                               |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| callback | <code>ModemCallback</code> \| <code>null</code> | optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency |
| params   | <code>Object</code>                             | empty object provided for type consistency                                                                                |

<a name="Sim800L+unlockSim"></a>

### sim800L.unlockSim(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>
unlockSim does exactly what you think it does

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code> - A Promise resolving the ModemResponse, containing the result. If a callback is provided, the function will use the callback instead and return void  

| Param    | Type                                            | Description                                                                                                               |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| callback | <code>ModemCallback</code> \| <code>null</code> | optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency |
| params   | <code>Object</code>                             | an object containing a pin property used to unlock the sim. the pin must be passed as a string                            |

<a name="Sim800L+updateCnmiConfig"></a>

### sim800L.updateCnmiConfig(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>
You can call updateCnmiConfig with a custom parameter to change the SMS message indications configuration

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code> - A Promise resolving the ModemResponse, containing the result. If a callback is provided, the function will use the callback instead and return void  

| Param    | Type                                            | Description                                                                                                               |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| callback | <code>ModemCallback</code> \| <code>null</code> | optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency |
| params   | <code>Object</code>                             | an object containing the cnmi string                                                                                      |

<a name="Sim800L+resetModem"></a>

### sim800L.resetModem(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>
resetModem is a function that can save you from a dead-end situation, call it to soft-reset the modem, with the mode configuration you want to reset in (optional)
another parameter can be pass to automatically reinitialize the modem afterwards

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code> - A Promise resolving the ModemResponse, containing the current SimStatus. If a callback is provided, the function will use the callback instead and return void  

| Param    | Type                                            | Description                                                                                                               |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| callback | <code>ModemCallback</code> \| <code>null</code> | optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency |
| params   | <code>Object</code>                             | empty object provided for type consistency                                                                                |

<a name="Sim800L+checkNetwork"></a>

### sim800L.checkNetwork(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>
A function that returns the current state of network connection
WIP : update to return the carrier name and force connect to it if idling

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code> - A Promise resolving the ModemResponse, containing the current network status. If a callback is provided, the function will use the callback instead and return void  

| Param    | Type                                            | Description                                                                                                               |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| callback | <code>ModemCallback</code> \| <code>null</code> | optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency |
| params   | <code>Object</code>                             | an object containing the -for now- unused force parameter                                                                 |

<a name="Sim800L+activateCReg"></a>

### sim800L.activateCReg() ⇒ <code>void</code>
WIP

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>void</code> - WIP  
<a name="Sim800L+execCommand"></a>

### sim800L.execCommand(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>
execCommand is the core function of the SIM800L class, it handles the AT commands, create and queue the jobs.

Each job is associated with a handler that will hold the job place in the queue until the incoming data appears satisfactory, errors, or tiemout. By default, the handler will only search for OK, ERROR, or > results,
you can provide a better handling of specific commands, just remember to call job.ended = true when you want to stop hanging the queue for incoming data

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code> - A Promise resolving the ModemResponse, containing the Response. If a callback is provided, the function will use the callback instead and return void  

| Param    | Type                                            | Description                                                                                                                |
| -------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| callback | <code>ModemCallback</code> \| <code>null</code> | optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency  |
| params   | <code>CommandParams</code>                      | an object containing all the parameters for creating the job and handling the response, some are required (command, type). |

<a name="Sim800L+setSmsMode"></a>

### sim800L.setSmsMode(callback, params) ⇒ <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code>
Sets the SMS mode (pass 0 for PDU or 1 to text mode). Please note that the Sms class currently does not support text mode, use at your own discretion

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Promise.&lt;ModemResponse&gt;</code> \| <code>void</code> - A Promise resolving the ModemResponse, containing the result. If a callback is provided, the function will use the callback instead and return void  

| Param    | Type                                            | Description                                                                                                               |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| callback | <code>ModemCallback</code> \| <code>null</code> | optional callback to handle ModemResponse the way you entend to. Must be set to null if not provided for type consistency |
| params   | <code>Object</code>                             | an object containing mode parameter                                                                                       |

<a name="Sim800L+close"></a>

### sim800L.close() ⇒
Closes the current serialport communication tunnel

**Kind**: instance method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: void  
<a name="Sim800L.list"></a>

### Sim800L.list() ⇒ <code>Array.&lt;PromisePortInfo&gt;</code>
Returns a list of available serial ports, is available statically for config purposes

**Kind**: static method of [<code>Sim800L</code>](#Sim800L)  
**Returns**: <code>Array.&lt;PromisePortInfo&gt;</code> - An array of serial ports available  
<a name="__awaiter"></a>

## \_\_awaiter
SIM800L-Node, a modern TypeScript package for SIM800L family modems

**Kind**: global variable  
**Author**: Julien Ferand <hello@julienferand.dev>  
<a name="parseBuffer"></a>

## parseBuffer(buffer) ⇒ <code>Array.&lt;string&gt;</code>
Parses the raw buffer input and returns a filtered array

**Kind**: global function  
**Returns**: <code>Array.&lt;string&gt;</code> - A filtered array of strings representing the individual buffer lines  

| Param  | Type                | Description          |
| ------ | ------------------- | -------------------- |
| buffer | <code>string</code> | the raw buffer input |

<a name="isOk"></a>

## isOk(buffer) ⇒ <code>boolean</code>
Parsing the buffer to tell if the command has been properly executed

**Kind**: global function  
**Returns**: <code>boolean</code> - A boolean describing if the command has been properly executed  

| Param  | Type                | Description          |
| ------ | ------------------- | -------------------- |
| buffer | <code>string</code> | the raw buffer input |

<a name="isWaitingForInput"></a>

## isWaitingForInput(parsedData) ⇒ <code>boolean</code>
Catches the ">" character indicating that the modem waits for an input

**Kind**: global function  
**Returns**: <code>boolean</code> - A boolean describing if the modem is waiting for an input  

| Param      | Type                    | Description             |
| ---------- | ----------------------- | ----------------------- |
| parsedData | <code>ParsedData</code> | the parsed buffer input |

<a name="getError"></a>

## getError(parsedData) ⇒ <code>ModemErrorRaw</code>
Intercepts the known error reporting patterns of the SIM800L, it also tries to get a formatted message describing the error

**Kind**: global function  
**Returns**: <code>ModemErrorRaw</code> - The response object containing an isError boolean and the result  

| Param      | Type                    | Description             |
| ---------- | ----------------------- | ----------------------- |
| parsedData | <code>ParsedData</code> | the parsed buffer input |


### Events
TBD
### More advanced concepts
TBD

### Contribution
Feel free to contribute to the project by suggesting or developing new features.
Please observe these very few rules : 
- Fork the project
- Create and publish a branch named `wip/yourfeature`
- Create a pull request on `master`
- Enjoy !

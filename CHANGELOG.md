# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- each network check emits a networkstatus event
- each modem check emits a modemready event
### Removed
### Changed
- Sms.send() now returns a boolean to announce if network was ready when it tried to send the sms
### Fixed

## [0.4.0] - 2022-03-11 
### Added
- Sms now emits a typed statuschange event
- Added smserror event to Sms, which fetches the maximum error info possible 
- Mapped delivery report status byte to comprehensive text
- Sms getter and setter public properties
### Changed
- Better isError handling : waiting for buffer to completely end even when catching an error
- Refactored Sms class pdu generation
## [0.3.2] - 2022-03-10
### Added
- JSDoc type hinting
- Documentation in README.md
- ### Changed
-  Complete overhaul of typings and type annotations
    - Better code readability
    - Type hinting for function now offers accurate overloads
    - Modem functions now shares the same generic signature
- Improved error detection and handling
## [0.2.1] - 2022-03-09
### Added
- SMS can now be created with a custom ID field

### Fixed
- Corrected variables scope in Sms class

## [0.2.0] - 2022-03-09
### Added
Initial changelog release

### Changed
### Removed
### Fixed

[unreleased]: https://github.com/julienfdev/sim800l-node/tree/develop
[0.4.0]: https://github.com/julienfdev/sim800l-node/tree/1cf80981219132c13f09bed762315d1ba1dc5280
[0.3.2]: https://github.com/julienfdev/sim800l-node/tree/b53ecd7ca5f6023ed0ea3c97ebb751bbc06d9a1a
[0.2.1]: https://github.com/julienfdev/sim800l-node/tree/73e3630b4f90db55ef9a033d2e7b8bef036ce5f8
[0.2.0]: https://github.com/julienfdev/sim800l-node/tree/f6cc0e1dfd189900dc2d206111214b04c03e8956

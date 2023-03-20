## Unreleased

## 0.1.5

- Added
  - Add support for refs (types are supported as well)
  - Add support for state types
  - Add support for opt-out in one of:
    - `@abstract` JSDoc comment
    - `abstract` modifier
    - `react-declassify-disable` comment
- Fixed
  - Keep generator/async flags
  - Fix renaming failure in some cases
  - Fix local variable conflict when the name was introduced in an inner block.
  - Fix `this.props`, `this.setState`, and so on not being accounted for when they are declared in the constructor.

## 0.1.4

- Added
  - Add support for `const { ... } = this.state`
  - Rename methods if necessary
- Misc
  - Refactoring

## 0.1.3

- Added
  - Add support for `this.state` initialization in constructor
  - Add support for `defaultProps`
- Misc
  - Heavily refactored internal analysis

## 0.1.2

- Added
  - Add support for `export default class` declarations
  - Add support for class fields initialized as functions
- Fixed
  - Fix emission of hoisted props

## 0.1.1

- Added
  - Transform `P` type argument
  - Transform `setState` (simple case)

## 0.1.0

Initial experimental release.
